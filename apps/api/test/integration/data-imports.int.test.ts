import {
  computeRecordsDigest,
  computeDatasetHash,
  type MappingDefinition,
} from '@smarttag/import-core';
import { cleanupDataImports, processValidateJob } from '@smarttag/import-processing';
import type {
  DataImportDto,
  DatasetDetailDto,
  DatasetRecordDetailDto,
  DatasetRecordPageDto,
  DatasetVersionDetailDto,
  MappingProfileDto,
} from '@smarttag/shared-types';
import { buildXlsxWorkbook } from '@smarttag/tabular-sources/testing';
import { createHash } from 'node:crypto';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  createTestApp,
  createUser,
  loginAs,
  resetDatabase,
  seedSampleAssets,
  seedTenants,
  type TestApp,
} from './helpers';
import {
  GOOD_ROWS,
  HEADERS,
  createVariableDataTemplate,
  hangTagCsv,
  hangTagMapping,
  importSettings,
  importStorage,
  mappedImport,
  startImportWorker,
  uploadCsv,
  validatedImport,
  waitForImport,
} from './import-helpers';

const sha256 = (content: Buffer) => createHash('sha256').update(content).digest('hex');

describe('data imports: CSV/XLSX → mapping → validation → immutable dataset versions', () => {
  let t: TestApp;
  let worker: { close(): Promise<void> };
  let tenants: Awaited<ReturnType<typeof seedTenants>>;
  let operator: TestAgent;
  let versionId: string;

  beforeAll(async () => {
    t = await createTestApp();
    worker = await startImportWorker(t);
  });
  afterAll(async () => {
    await worker.close();
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    tenants = await seedTenants(t.prisma);
    await createUser(t.prisma, 'data.a@test.local', [
      { organizationId: tenants.orgA.id, roles: ['DATA_OPERATOR'] },
    ]);
    await seedSampleAssets(t.prisma, tenants.orgA.id, tenants.users.adminA.id);
    const designer = await loginAs(t, 'designer.a@test.local');
    versionId = (await createVariableDataTemplate(designer)).version.id;
    operator = await loginAs(t, 'data.a@test.local');
  });

  it('CSV: upload stores the original file with its checksum and inspects it in the background', async () => {
    const content = hangTagCsv(GOOD_ROWS);
    const uploaded = await uploadCsv(operator, versionId, content);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const created = uploaded.body as DataImportDto;
    expect(created.source).toMatchObject({
      format: 'CSV',
      sizeBytes: content.length,
      checksumSha256: sha256(content),
      status: 'STORED',
    });
    expect(['UPLOADED', 'INSPECTING', 'MAPPING_REQUIRED']).toContain(created.status);

    const inspected = await waitForImport(operator, created.id);
    expect(inspected.status).toBe('MAPPING_REQUIRED');
    expect(inspected.sourceSettings).toEqual({
      format: 'CSV',
      encoding: 'UTF-8',
      delimiter: ',',
      headerRow: 1,
    });
    expect(inspected.columns.map((column) => `${column.header} — ${column.letter}`)).toEqual(
      HEADERS.map((header, index) => `${header} — ${String.fromCharCode(65 + index)}`),
    );
    expect(inspected.dataRowCount).toBe(3);
    // Deterministic suggestions: exact label "Color" is exact, "PRODUCT NAME" needs confirmation.
    expect(inspected.suggestions.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'product_name', match: 'NORMALIZED_KEY', exact: false }),
        expect.objectContaining({ field: 'color', match: 'CASE_INSENSITIVE_KEY' }),
      ]),
    );

    const stored = await t.prisma.dataSourceFile.findFirstOrThrow({
      where: { id: inspected.source.id },
    });
    const object = await importStorage(t).getObject(stored.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of object.body as AsyncIterable<Buffer>) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    expect(bytes.equals(content)).toBe(true);
    const audit = await t.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'DATA_IMPORT_CREATED' },
    });
    expect(audit.metadata).toMatchObject({
      sourceChecksumSha256: sha256(content),
      sizeBytes: content.length,
      format: 'CSV',
    });
  });

  it('CSV: required mapping, validation through the Phase 3 engine, row review and finalization', async () => {
    const uploaded = await uploadCsv(operator, versionId, hangTagCsv(GOOD_ROWS));
    const inspected = await waitForImport(operator, (uploaded.body as DataImportDto).id);

    // A mapping without GTIN is stored but incomplete.
    const full = hangTagMapping(inspected.columns);
    const partial: MappingDefinition = {
      ...full,
      entries: full.entries.filter((entry) => entry.field !== 'gtin'),
    };
    const incomplete = await operator
      .patch(`${API}/data-imports/${inspected.id}/mapping`)
      .send({ expectedRevision: inspected.revision, mapping: partial, profile: null });
    expect(incomplete.status).toBe(200);
    const incompleteDto = incomplete.body as DataImportDto;
    expect(incompleteDto.status).toBe('MAPPING_REQUIRED');
    expect(incompleteDto.mappingValidation?.issues).toEqual([
      expect.objectContaining({
        code: 'REQUIRED_MAPPING_MISSING',
        message: 'Required field "gtin" (GTIN) is not mapped and has no default',
      }),
    ]);
    const blocked = await operator
      .post(`${API}/data-imports/${inspected.id}/validate`)
      .send({ expectedRevision: incompleteDto.revision });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('MAPPING_INCOMPLETE');

    // Two columns for one field are refused.
    const twice: MappingDefinition = {
      ...full,
      entries: [...full.entries, { ...full.entries[0]!, field: 'gtin' }],
    };
    const refused = await operator
      .patch(`${API}/data-imports/${inspected.id}/mapping`)
      .send({ expectedRevision: incompleteDto.revision, mapping: twice, profile: null });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('TARGET_FIELD_ALREADY_MAPPED');

    // A stale revision is a conflict.
    const stale = await operator
      .patch(`${API}/data-imports/${inspected.id}/mapping`)
      .send({ expectedRevision: inspected.revision, mapping: full, profile: null });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const mapped = await operator
      .patch(`${API}/data-imports/${inspected.id}/mapping`)
      .send({ expectedRevision: incompleteDto.revision, mapping: full, profile: null });
    expect((mapped.body as DataImportDto).status).toBe('READY_TO_VALIDATE');
    const requested = await operator
      .post(`${API}/data-imports/${inspected.id}/validate`)
      .send({ expectedRevision: (mapped.body as DataImportDto).revision });
    expect(requested.status).toBe(200);
    const validated = await waitForImport(operator, inspected.id);
    expect(validated.status, JSON.stringify(validated.failure)).toBe('READY');
    expect(validated.validation).toMatchObject({
      rowCount: 3,
      validCount: 3,
      warningCount: 0,
      errorCount: 0,
      blankRowCount: 0,
    });
    expect(validated.validation?.summary.layoutChecked).toBe(false);

    const rows = (await operator.get(`${API}/data-imports/${inspected.id}/rows`))
      .body as DatasetRecordPageDto;
    expect(rows.total).toBe(3);
    expect(rows.items.map((row) => [row.sequence, row.rowNumber, row.status])).toEqual([
      [1, 2, 'VALID'],
      [2, 3, 'VALID'],
      [3, 4, 'VALID'],
    ]);
    // Decimal comma normalized to exact decimal text; defaults applied by validateDataRecord.
    expect(rows.items[1]!.record).toMatchObject({
      price: '1234.50',
      currency: 'USD',
      country_of_origin: 'Bangladesh',
      is_sustainable: false,
      product_image: null,
    });
    expect(rows.items[0]!.resolvedInputHash).toMatch(/^[0-9a-f]{64}$/);

    const finalized = await operator.post(`${API}/data-imports/${inspected.id}/finalize`).send({
      expectedRevision: validated.revision,
      acknowledgeWarnings: false,
      dataset: { mode: 'NEW', name: 'FW26 hang tags', description: 'Customer ABC' },
    });
    expect(finalized.status, JSON.stringify(finalized.body)).toBe(200);
    const version = finalized.body as DatasetVersionDetailDto;
    expect(version).toMatchObject({
      status: 'FINALIZED',
      versionNumber: 1,
      rowCount: 3,
      validCount: 3,
      errorCount: 0,
    });
    expect(version.templateVersion.id).toBe(versionId);
    expect(version.sourceChecksumSha256).toBe(validated.source.checksumSha256);

    // The dataset hash is reproducible from the stored records and the mapping snapshot.
    const records = await t.prisma.datasetRecord.findMany({
      where: { datasetVersionId: version.id },
      orderBy: { sequence: 'asc' },
    });
    const recordsDigest = await computeRecordsDigest(records.map((record) => record.recordHash));
    expect(recordsDigest).toBe(version.recordsDigest);
    expect(
      await computeDatasetHash({
        templateVersionHash: version.templateVersion.documentHash,
        dataSchemaHash: version.dataSchemaHash,
        mapping: version.mappingSnapshot,
        normalizationVersion: version.importConfiguration.normalizationVersion,
        recordCount: version.rowCount,
        recordsDigest,
      }),
    ).toBe(version.datasetHash);

    const dataset = (await operator.get(`${API}/datasets/${version.dataset.id}`))
      .body as DatasetDetailDto;
    expect(dataset).toMatchObject({ name: 'FW26 hang tags', versionCount: 1 });
    const detail = (await operator.get(`${API}/dataset-versions/${version.id}/records/2`))
      .body as DatasetRecordDetailDto;
    expect(detail).toMatchObject({
      previousSequence: 1,
      nextSequence: 3,
      record: { rowNumber: 3 },
    });
    const events = await t.prisma.auditEvent.findMany({
      where: {
        action: { in: ['DATASET_CREATED', 'DATASET_VERSION_FINALIZED', 'DATA_IMPORT_VALIDATED'] },
      },
    });
    expect(events.map((event) => event.action).sort()).toEqual([
      'DATASET_CREATED',
      'DATASET_VERSION_FINALIZED',
      'DATA_IMPORT_VALIDATED',
    ]);
    // Aggregates only: no row values in audit metadata.
    expect(JSON.stringify(events.map((event) => event.metadata))).not.toContain(
      'Premium Cotton Shirt',
    );
  });

  it('invalid rows: row-level IMPORT/DATA/OBJECT issues, and finalization is blocked by errors', async () => {
    const validated = await validatedImport(
      operator,
      versionId,
      hangTagCsv([
        GOOD_ROWS[0]!,
        ['YT-2046', 'Linen Shirt', 'White', 'M', '19.99', '9501234567891', ''],
        ['YT-2047', 'Denim Jacket', 'Blue', 'L', '89,00', '9501234567893', ''],
        ['YT-2048', '', 'Blue', 'XXXL', '10,00', '9501234567891', ''],
      ]),
    );
    expect(validated.status).toBe('HAS_ERRORS');
    expect(validated.validation).toMatchObject({ rowCount: 4, validCount: 1, errorCount: 3 });
    const codes = validated.validation!.summary.issueCounts.map(
      (count) => `${count.layer}:${count.code}`,
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        'IMPORT:DECIMAL_PARSE_FAILED',
        'OBJECT:BARCODE_VALUE_INVALID',
        'DATA:REQUIRED_VALUE_EMPTY',
        'DATA:VALUE_NOT_ALLOWED',
      ]),
    );

    const errors = (await operator.get(`${API}/data-imports/${validated.id}/rows?status=ERROR`))
      .body as DatasetRecordPageDto;
    expect(errors.items.map((row) => row.rowNumber)).toEqual([3, 4, 5]);
    expect(errors.items[0]!.issues[0]).toMatchObject({
      layer: 'IMPORT',
      code: 'DECIMAL_PARSE_FAILED',
      column: { letter: 'E', header: 'RETAIL' },
      message:
        'Price: cannot parse "19.99" using decimal separator "," and thousands separator ".": the digits are not grouped in threes by the thousands separator',
    });
    expect(errors.items[1]!.issues).toEqual([
      expect.objectContaining({
        layer: 'OBJECT',
        code: 'BARCODE_VALUE_INVALID',
        message: expect.stringContaining('Check digit should be 1') as string,
      }),
    ]);
    const searched = (await operator.get(`${API}/data-imports/${validated.id}/rows?search=denim`))
      .body as DatasetRecordPageDto;
    expect(searched.items.map((row) => row.rowNumber)).toEqual([4]);

    const finalize = await operator.post(`${API}/data-imports/${validated.id}/finalize`).send({
      expectedRevision: validated.revision,
      acknowledgeWarnings: true,
      dataset: { mode: 'NEW', name: 'Broken data' },
    });
    expect(finalize.status).toBe(409);
    expect(finalize.body.error.code).toBe('DATASET_HAS_ERRORS');
    expect(await t.prisma.dataset.count()).toBe(0);
    expect(await t.prisma.datasetVersion.count({ where: { status: 'FINALIZED' } })).toBe(0);
  });

  it('warnings require acknowledgement; duplicates are kept and reported', async () => {
    const warnDocument = await t.prisma.templateVersion.findUniqueOrThrow({
      where: { id: versionId },
    });
    // Missing optional values warn under the WARN policy: make "color" optional first.
    const document = warnDocument.documentJson as {
      settings: { missingDataPolicy: string };
      dataSchema: { fields: { key: string; required: boolean }[] };
    };
    document.settings.missingDataPolicy = 'WARN';
    document.dataSchema.fields.find((field) => field.key === 'color')!.required = false;
    const designer = await loginAs(t, 'designer.a@test.local');
    const saved = await designer
      .patch(`${API}/template-versions/${versionId}`)
      .send({ document, expectedRevision: warnDocument.revision });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    const validated = await validatedImport(
      operator,
      versionId,
      hangTagCsv([
        GOOD_ROWS[0]!,
        GOOD_ROWS[0]!,
        ['YT-2049', 'Polo', '', 'S', '25,00', '9501234567891', ''],
      ]),
    );
    expect(validated.status).toBe('READY_WITH_WARNINGS');
    expect(validated.validation).toMatchObject({
      rowCount: 3,
      validCount: 2,
      warningCount: 1,
      duplicateRowCount: 1,
    });
    const duplicates = (
      await operator.get(`${API}/data-imports/${validated.id}/rows?duplicates=true`)
    ).body as DatasetRecordPageDto;
    expect(duplicates.items).toEqual([
      expect.objectContaining({ sequence: 2, duplicateOf: { sequence: 1, rowNumber: 2 } }),
    ]);

    const unacknowledged = await operator
      .post(`${API}/data-imports/${validated.id}/finalize`)
      .send({
        expectedRevision: validated.revision,
        acknowledgeWarnings: false,
        dataset: { mode: 'NEW', name: 'With warnings' },
      });
    expect(unacknowledged.status).toBe(409);
    expect(unacknowledged.body.error).toMatchObject({
      code: 'WARNINGS_NOT_ACKNOWLEDGED',
      message: expect.stringContaining('1 rows with warnings') as string,
    });
    const acknowledged = await operator.post(`${API}/data-imports/${validated.id}/finalize`).send({
      expectedRevision: validated.revision,
      acknowledgeWarnings: true,
      dataset: { mode: 'NEW', name: 'With warnings' },
    });
    expect(acknowledged.status, JSON.stringify(acknowledged.body)).toBe(200);
    const version = acknowledged.body as DatasetVersionDetailDto;
    // Both identical rows are in the dataset: quantities are never deduplicated.
    expect(version).toMatchObject({ rowCount: 3, warningCount: 1, duplicateRowCount: 1 });
    expect(version.warningsAcknowledgedAt).not.toBeNull();
  });

  it('finalized dataset versions are immutable at the API and in the database; revisions become version 2', async () => {
    const first = await validatedImport(operator, versionId, hangTagCsv(GOOD_ROWS));
    const version1 = (
      await operator.post(`${API}/data-imports/${first.id}/finalize`).send({
        expectedRevision: first.revision,
        acknowledgeWarnings: false,
        dataset: { mode: 'NEW', name: 'Immutable' },
      })
    ).body as DatasetVersionDetailDto;

    const again = await operator.post(`${API}/data-imports/${first.id}/finalize`).send({
      expectedRevision: first.revision + 1,
      acknowledgeWarnings: false,
      dataset: { mode: 'EXISTING', datasetId: version1.dataset.id },
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DATASET_IMMUTABLE');
    const remap = await operator.patch(`${API}/data-imports/${first.id}/mapping`).send({
      expectedRevision: first.revision + 1,
      mapping: hangTagMapping(first.columns),
      profile: null,
    });
    expect(remap.body.error.code).toBe('DATASET_IMMUTABLE');

    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE dataset_records SET row_number = 99 WHERE dataset_version_id = '${version1.id}'`,
      ),
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      t.prisma.$executeRawUnsafe(
        `DELETE FROM dataset_records WHERE dataset_version_id = '${version1.id}'`,
      ),
    ).rejects.toThrow(/cannot be deleted/);
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE dataset_versions SET dataset_hash = '${'0'.repeat(64)}' WHERE id = '${version1.id}'`,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      t.prisma.$executeRawUnsafe(`DELETE FROM dataset_versions WHERE id = '${version1.id}'`),
    ).rejects.toThrow(/cannot be deleted/);
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE data_imports SET status = 'VALIDATING' WHERE id = '${first.id}'`,
      ),
    ).rejects.toThrow(/FINALIZED and cannot be changed/);

    // A corrected upload becomes Dataset Version 2; version 1 is unchanged.
    const second = await validatedImport(
      operator,
      versionId,
      hangTagCsv([...GOOD_ROWS, ['YT-2050', 'Scarf', 'Red', 'S', '12,50', '9501234567891', '']]),
    );
    const version2 = (
      await operator.post(`${API}/data-imports/${second.id}/finalize`).send({
        expectedRevision: second.revision,
        acknowledgeWarnings: false,
        dataset: { mode: 'EXISTING', datasetId: version1.dataset.id },
      })
    ).body as DatasetVersionDetailDto;
    expect(version2).toMatchObject({ versionNumber: 2, rowCount: 4 });
    expect(version2.datasetHash).not.toBe(version1.datasetHash);
    const reread = (await operator.get(`${API}/dataset-versions/${version1.id}`))
      .body as DatasetVersionDetailDto;
    expect(reread).toMatchObject({
      versionNumber: 1,
      rowCount: 3,
      datasetHash: version1.datasetHash,
    });
  });

  it('dataset version numbers stay unique under concurrent finalization', async () => {
    const [a, b] = await Promise.all([
      validatedImport(operator, versionId, hangTagCsv(GOOD_ROWS)),
      validatedImport(operator, versionId, hangTagCsv(GOOD_ROWS.slice(0, 2))),
    ]);
    const dataset = (await operator.post(`${API}/datasets`).send({ name: 'Concurrent' }))
      .body as DatasetDetailDto;
    const results = await Promise.all(
      [a, b].map((item) =>
        operator.post(`${API}/data-imports/${item.id}/finalize`).send({
          expectedRevision: item.revision,
          acknowledgeWarnings: false,
          dataset: { mode: 'EXISTING', datasetId: dataset.id },
        }),
      ),
    );
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(
      results.map((result) => (result.body as DatasetVersionDetailDto).versionNumber).sort(),
    ).toEqual([1, 2]);

    // The same import finalized twice at the same time: exactly one succeeds.
    const c = await validatedImport(operator, versionId, hangTagCsv(GOOD_ROWS));
    const racing = await Promise.all(
      [1, 2].map(() =>
        operator.post(`${API}/data-imports/${c.id}/finalize`).send({
          expectedRevision: c.revision,
          acknowledgeWarnings: false,
          dataset: { mode: 'EXISTING', datasetId: dataset.id },
        }),
      ),
    );
    expect(racing.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await t.prisma.datasetVersion.count({ where: { datasetId: dataset.id } })).toBe(3);
  });

  it('XLSX: chooses the second sheet and its header row, keeps typed values, validates and finalizes', async () => {
    const workbook = buildXlsxWorkbook({
      sheets: [
        { name: 'Instructions', rows: [['Fill in the Tags sheet']] },
        {
          name: 'Tags',
          rows: [
            ['Customer ABC — FW26'],
            ['STYLE_NO', 'PRODUCT NAME', 'Color', 'SIZE_CODE', 'RETAIL', 'EAN_CODE', 'IMAGE'],
            ['YT-2045', 'Premium Cotton Shirt', 'Navy', 'XL', 39.95, 9501234567891, null],
            [
              'YT-2046',
              'Linen Shirt',
              'White',
              'M',
              { formula: 'E3*2', cached: 79.9 },
              { zeroPadded: 9501234567891 },
              null,
            ],
          ],
        },
      ],
    });
    const uploaded = await operator
      .post(`${API}/template-versions/${versionId}/imports`)
      .attach('file', workbook, { filename: 'tags.xlsx', contentType: 'application/octet-stream' });
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const inspected = await waitForImport(operator, (uploaded.body as DataImportDto).id);
    expect(inspected.status).toBe('MAPPING_REQUIRED');
    expect(inspected.inspection?.sheets.map((sheet) => sheet.name)).toEqual([
      'Instructions',
      'Tags',
    ]);
    // Several sheets: nothing is assumed.
    expect(inspected.sourceSettings).toEqual({ format: 'XLSX', sheetName: null, headerRow: 1 });
    expect(inspected.sourceProblems).toEqual([expect.objectContaining({ code: 'SHEET_REQUIRED' })]);

    const selected = await operator
      .patch(`${API}/data-imports/${inspected.id}/source-settings`)
      .send({
        expectedRevision: inspected.revision,
        settings: { format: 'XLSX', sheetName: 'Tags', headerRow: 2 },
      });
    expect(selected.status, JSON.stringify(selected.body)).toBe(200);
    const settled = selected.body as DataImportDto;
    expect(settled.sourceProblems).toEqual([]);
    expect(settled.dataRowCount).toBe(2);
    expect(settled.columns.map((column) => column.header)).toEqual(HEADERS);

    const badHeader = await operator
      .patch(`${API}/data-imports/${inspected.id}/source-settings`)
      .send({
        expectedRevision: settled.revision,
        settings: { format: 'XLSX', sheetName: 'Tags', headerRow: 30 },
      });
    expect(badHeader.status).toBe(422);
    expect(badHeader.body.error.code).toBe('INVALID_SOURCE_SETTINGS');

    const mapping = hangTagMapping(settled.columns);
    const mapped = await operator
      .patch(`${API}/data-imports/${inspected.id}/mapping`)
      .send({ expectedRevision: settled.revision, mapping, profile: null });
    const requested = await operator
      .post(`${API}/data-imports/${inspected.id}/validate`)
      .send({ expectedRevision: (mapped.body as DataImportDto).revision });
    expect(requested.status).toBe(200);
    const validated = await waitForImport(operator, inspected.id);
    expect(validated.status).toBe('READY_WITH_WARNINGS');
    const rows = (await operator.get(`${API}/data-imports/${inspected.id}/rows`))
      .body as DatasetRecordPageDto;
    expect(
      rows.items.map((row) => [row.rowNumber, row.record.price, row.record.gtin, row.status]),
    ).toEqual([
      [3, '39.95', '9501234567891', 'VALID'],
      [4, '79.9', '9501234567891', 'WARNING'],
    ]);
    expect(rows.items[1]!.issues).toEqual([
      expect.objectContaining({
        layer: 'IMPORT',
        code: 'FORMULA_CACHED_VALUE',
        severity: 'WARNING',
      }),
    ]);
  });

  it('CSV source settings: a new delimiter re-inspects the file without a new upload', async () => {
    const semicolon = Buffer.from('STYLE_NO;PRODUCT NAME\nYT-2045;Shirt\n', 'utf8');
    const uploaded = await uploadCsv(operator, versionId, semicolon);
    const inspected = await waitForImport(operator, (uploaded.body as DataImportDto).id);
    expect(inspected.sourceSettings).toMatchObject({ delimiter: ';' });
    const changed = await operator
      .patch(`${API}/data-imports/${inspected.id}/source-settings`)
      .send({
        expectedRevision: inspected.revision,
        settings: { format: 'CSV', encoding: 'UTF-8', delimiter: ',', headerRow: 1 },
      });
    expect(changed.status).toBe(200);
    expect(['INSPECTING', 'MAPPING_REQUIRED']).toContain((changed.body as DataImportDto).status);
    const reinspected = await waitForImport(operator, inspected.id);
    expect(reinspected.columns.map((column) => column.header)).toEqual(['STYLE_NO;PRODUCT NAME']);
    expect(await t.prisma.dataSourceFile.count()).toBe(1);
  });

  it('mapping profiles: saved from an import, suggested for compatible files, revisions keep history', async () => {
    const first = await mappedImport(operator, versionId, hangTagCsv(GOOD_ROWS));
    const created = await operator
      .post(`${API}/mapping-profiles`)
      .send({ name: 'Customer ABC — ERP export', importId: first.id });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const profile = created.body as MappingProfileDto;
    expect(profile).toMatchObject({
      currentRevision: 1,
      dataSchemaHash: first.templateVersion.dataSchemaHash,
    });
    expect(profile.definition.mapping.entries.map((entry) => entry.field)).toEqual([
      'color',
      'gtin',
      'price',
      'product_image',
      'product_name',
      'size',
      'style',
    ]);

    // A second file with reordered columns: the profile is compatible and resolves by header.
    const reordered = Buffer.from(
      [
        'EAN_CODE,RETAIL,STYLE_NO,PRODUCT NAME,Color,SIZE_CODE,IMAGE',
        '9501234567891,"39,95",YT-2045,Shirt,Navy,XL,',
      ].join('\n'),
      'utf8',
    );
    const second = await waitForImport(
      operator,
      ((await uploadCsv(operator, versionId, reordered)).body as DataImportDto).id,
    );
    const evaluation = second.profileEvaluations.find(
      (candidate) => candidate.profileId === profile.id,
    )!;
    expect(evaluation).toMatchObject({
      compatibility: 'COMPATIBLE',
      schemaMatches: true,
      layoutMatches: false,
    });
    expect(evaluation.mapping.entries.find((entry) => entry.field === 'gtin')?.column).toEqual({
      index: 0,
      header: 'EAN_CODE',
    });
    const applied = await operator.patch(`${API}/data-imports/${second.id}/mapping`).send({
      expectedRevision: second.revision,
      mapping: evaluation.mapping,
      profile: { id: profile.id, revision: 1 },
    });
    expect(applied.status).toBe(200);
    expect(applied.body as DataImportDto).toMatchObject({
      status: 'READY_TO_VALIDATE',
      mappingProfile: { id: profile.id, revision: 1 },
    });

    // A file missing a mapped column requires review.
    const missing = Buffer.from(
      ['STYLE_NO,PRODUCT NAME,Color,SIZE_CODE,RETAIL', 'YT-2045,Shirt,Navy,XL,"39,95"'].join('\n'),
      'utf8',
    );
    const third = await waitForImport(
      operator,
      ((await uploadCsv(operator, versionId, missing)).body as DataImportDto).id,
    );
    expect(
      third.profileEvaluations.find((candidate) => candidate.profileId === profile.id),
    ).toMatchObject({ compatibility: 'REQUIRES_REVIEW' });

    const renamed = await operator
      .patch(`${API}/mapping-profiles/${profile.id}`)
      .send({ expectedRevision: 1, name: 'ABC ERP v2' });
    expect(renamed.body as MappingProfileDto).toMatchObject({
      currentRevision: 2,
      name: 'ABC ERP v2',
    });
    expect(
      (renamed.body as MappingProfileDto).revisions.map((revision) => [
        revision.revision,
        revision.name,
      ]),
    ).toEqual([
      [2, 'ABC ERP v2'],
      [1, 'Customer ABC — ERP export'],
    ]);
    const stale = await operator
      .patch(`${API}/mapping-profiles/${profile.id}`)
      .send({ expectedRevision: 1, name: 'late' });
    expect(stale.status).toBe(409);
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE mapping_profile_revisions SET name = 'x' WHERE profile_id = '${profile.id}'`,
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('retries are idempotent: a repeated or superseded validation job never duplicates records', async () => {
    const validated = await validatedImport(operator, versionId, hangTagCsv(GOOD_ROWS));
    const deps = { prisma: t.prisma, storage: importStorage(t), settings: importSettings(t) };
    const job = {
      correlationId: null,
      requestedAt: new Date().toISOString(),
      organizationId: tenants.orgA.id,
      importId: validated.id,
      requestedByUserId: tenants.users.adminA.id,
      validationRun: 1,
    };
    // The run already completed: a redelivered job does nothing.
    expect(await processValidateJob(deps, job)).toMatchObject({ outcome: 'SKIPPED' });
    expect(await t.prisma.datasetRecord.count()).toBe(3);

    // Simulate a crashed attempt: status back to VALIDATING for a new run with a partial draft.
    const run = await t.prisma.$transaction(async (tx) => {
      await tx.dataImport.update({
        where: { id: validated.id },
        data: { status: 'VALIDATING', validationRun: 2 },
      });
      return 2;
    });
    const partial = await t.prisma.datasetVersion.findFirstOrThrow({
      where: { importId: validated.id },
    });
    const draft = await t.prisma.datasetVersion.create({
      data: {
        ...partial,
        id: undefined,
        validationRun: run,
        completedAt: null,
        recordsDigest: null,
        rowCount: 0,
        validCount: 0,
        warningCount: 0,
        errorCount: 0,
        validationSummary: {},
        mappingSnapshot: partial.mappingSnapshot ?? {},
        importConfiguration: partial.importConfiguration ?? {},
      },
    });
    await t.prisma.datasetRecord.create({
      data: {
        datasetVersionId: draft.id,
        sequence: 1,
        organizationId: tenants.orgA.id,
        rowNumber: 2,
        status: 'VALID',
        normalizedRecord: {},
        recordHash: 'a'.repeat(64),
        resolvedInputHash: 'b'.repeat(64),
        errorCount: 0,
        warningCount: 0,
      },
    });
    // Two deliveries of the same run (retry after the crash, plus a duplicate).
    expect(await processValidateJob(deps, { ...job, validationRun: run })).toMatchObject({
      outcome: 'COMPLETED',
      status: 'READY',
    });
    expect(await processValidateJob(deps, { ...job, validationRun: run })).toMatchObject({
      outcome: 'SKIPPED',
    });
    const versions = await t.prisma.datasetVersion.findMany({ where: { importId: validated.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ validationRun: 2, rowCount: 3 });
    expect(await t.prisma.datasetRecord.count()).toBe(3);
  });

  it('cancellation and cleanup remove drafts and abandoned uploads but never finalized data', async () => {
    const kept = await validatedImport(operator, versionId, hangTagCsv(GOOD_ROWS));
    await operator.post(`${API}/data-imports/${kept.id}/finalize`).send({
      expectedRevision: kept.revision,
      acknowledgeWarnings: false,
      dataset: { mode: 'NEW', name: 'Kept' },
    });
    const abandoned = await validatedImport(operator, versionId, hangTagCsv(GOOD_ROWS));
    const cancelled = await operator
      .post(`${API}/data-imports/${abandoned.id}/cancel`)
      .send({ expectedRevision: abandoned.revision });
    expect((cancelled.body as DataImportDto).status).toBe('CANCELLED');
    const pending = await t.prisma.dataSourceFile.create({
      data: {
        organizationId: tenants.orgA.id,
        storageKey: `organizations/${tenants.orgA.id}/data-sources/pending`,
        originalFilename: 'x.csv',
        format: 'CSV',
        sizeBytes: 1,
        checksumSha256: 'c'.repeat(64),
        createdById: tenants.users.adminA.id,
        createdAt: new Date(Date.now() - 3 * 3600_000),
      },
    });

    // The cancel request also queued a cleanup job; the outcome is the same whichever runs first.
    await cleanupDataImports({
      prisma: t.prisma,
      storage: importStorage(t),
      settings: importSettings(t),
    });
    expect(await t.prisma.datasetVersion.count({ where: { importId: abandoned.id } })).toBe(0);
    expect(
      await t.prisma.dataSourceFile.findUniqueOrThrow({ where: { id: pending.id } }),
    ).toMatchObject({ status: 'DELETED' });
    const abandonedSource = await t.prisma.dataImport.findUniqueOrThrow({
      where: { id: abandoned.id },
      include: { sourceFile: true },
    });
    expect(abandonedSource.sourceFile.status).toBe('DELETED');
    const keptSource = await t.prisma.dataImport.findUniqueOrThrow({
      where: { id: kept.id },
      include: { sourceFile: true },
    });
    expect(keptSource.sourceFile.status).toBe('STORED');
    expect(await t.prisma.datasetRecord.count()).toBe(3);
    await expect(
      t.prisma.dataSourceFile.update({
        where: { id: keptSource.sourceFile.id },
        data: { status: 'DELETED', deletedAt: new Date() },
      }),
    ).rejects.toThrow(/finalized dataset version/);
  });

  it('a failed storage write leaves no import and no stored upload behind', async () => {
    const storage = importStorage(t);
    const original = storage.putObject.bind(storage);
    storage.putObject = () => Promise.reject(new Error('storage down'));
    try {
      const response = await uploadCsv(operator, versionId, hangTagCsv(GOOD_ROWS));
      expect(response.status).toBe(500);
    } finally {
      storage.putObject = original;
    }
    expect(await t.prisma.dataImport.count()).toBe(0);
    expect(await t.prisma.dataSourceFile.findMany({ select: { status: true } })).toEqual([
      { status: 'DELETED' },
    ]);
  });
});
