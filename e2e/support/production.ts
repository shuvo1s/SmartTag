import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { DesignDocument } from '@smarttag/document-schema';
import { VARIABLE_DATA_FIELDS } from '@smarttag/document-utils/fixtures';
import type {
  DataImportDto,
  DatasetVersionDetailDto,
  ProductionJobDto,
  SequenceDto,
  TemplateVersionDetailDto,
} from '@smarttag/shared-types';
import { buildCsv } from '@smarttag/tabular-sources/testing';
import { apiAs, importTemplate } from './imports.ts';

/** Hang tag columns plus a quantity column, so a job can expand copies from the data. */
export const PRODUCTION_HEADERS = [
  'STYLE_NO',
  'PRODUCT NAME',
  'Color',
  'SIZE_CODE',
  'RETAIL',
  'EAN_CODE',
  'IMAGE',
  'QTY',
] as const;

export function productionRows(quantities: readonly (string | number)[]): string[][] {
  return quantities.map((quantity, index) => [
    `YT-${2045 + index}`,
    `Product ${index + 1}`,
    'Navy',
    'XL',
    '39.95',
    '9501234567891',
    '',
    String(quantity),
  ]);
}

/** The variable-data hang tag with an extra text field holding the number of tags to produce. */
function withQuantityField(document: DesignDocument): DesignDocument {
  return {
    ...document,
    dataSchema: {
      fields: [
        ...VARIABLE_DATA_FIELDS,
        {
          key: 'quantity',
          displayName: 'Quantity',
          // Text on purpose: production decides what is a usable number of tags.
          type: 'string',
          required: false,
          description: 'Number of tags to produce for this row',
          defaultValue: null,
          validation: { minLength: null, maxLength: null, pattern: null, allowedValues: null },
        },
      ],
    },
  };
}

export interface ProductionInputs {
  readonly templateId: string;
  readonly templateVersionId: string;
  readonly datasetVersionId: string;
  readonly datasetName: string;
}

/**
 * Everything a production job needs, built through the real API: an approved template version and
 * a finalized dataset version for it.
 */
export async function productionInputs(
  quantities: readonly (string | number)[] = [2, 3, 1],
  label = `FW26 ${Date.now()}`,
): Promise<ProductionInputs> {
  const admin = await apiAs('admin');
  try {
    const draft = await importTemplate(withQuantityField);

    const submitted = await admin.post(`/api/v1/template-versions/${draft.versionId}/transitions`, {
      data: { targetStatus: 'IN_REVIEW' },
    });
    expect(submitted.status(), await submitted.text()).toBe(200);
    const approved = await admin.post(`/api/v1/template-versions/${draft.versionId}/transitions`, {
      data: { targetStatus: 'APPROVED' },
    });
    expect(approved.status(), await approved.text()).toBe(200);
    const version = (await approved.json()) as TemplateVersionDetailDto;

    const datasetVersion = await finalizedDataset(admin, version.id, quantities, label);
    return {
      templateId: draft.template.id,
      templateVersionId: version.id,
      datasetVersionId: datasetVersion.id,
      datasetName: label,
    };
  } finally {
    await admin.dispose();
  }
}

/** Imports rows for a template version and finalizes them into a dataset version. */
export async function finalizedDataset(
  api: APIRequestContext,
  versionId: string,
  quantities: readonly (string | number)[],
  name: string,
): Promise<DatasetVersionDetailDto> {
  const buffer = Buffer.from(
    buildCsv([[...PRODUCTION_HEADERS], ...productionRows(quantities)]),
    'utf8',
  );
  const uploaded = await api.post(`/api/v1/template-versions/${versionId}/imports`, {
    multipart: { file: { name: 'tags.csv', mimeType: 'text/csv', buffer } },
  });
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  let dto = (await uploaded.json()) as DataImportDto;
  dto = await waitForImport(api, dto.id, (value) => value.status === 'MAPPING_REQUIRED');

  const column = (header: string) => {
    const found = dto.columns.find((candidate) => candidate.header === header);
    if (!found) throw new Error(`no column ${header}`);
    return { index: found.index, header: found.header };
  };
  const entry = (field: string, header: string) => ({
    field,
    column: column(header),
    number: null,
    dateFormat: null,
    boolean: null,
  });
  const mapped = await api.patch(`/api/v1/data-imports/${dto.id}/mapping`, {
    data: {
      expectedRevision: dto.revision,
      profile: null,
      mapping: {
        version: 1,
        entries: [
          entry('style', 'STYLE_NO'),
          entry('product_name', 'PRODUCT NAME'),
          entry('color', 'Color'),
          entry('size', 'SIZE_CODE'),
          entry('price', 'RETAIL'),
          entry('gtin', 'EAN_CODE'),
          entry('quantity', 'QTY'),
        ],
        parsing: {
          trimWhitespace: true,
          emptyValues: [],
          number: { decimalSeparator: '.', thousandsSeparator: 'NONE' },
          dateFormat: 'YYYY-MM-DD',
          boolean: { trueValues: ['true'], falseValues: ['false'] },
        },
      },
    },
  });
  expect(mapped.status(), await mapped.text()).toBe(200);
  dto = (await mapped.json()) as DataImportDto;

  const validated = await api.post(`/api/v1/data-imports/${dto.id}/validate`, {
    data: { expectedRevision: dto.revision },
  });
  expect(validated.status(), await validated.text()).toBe(200);
  dto = await waitForImport(api, dto.id, (value) =>
    ['READY', 'READY_WITH_WARNINGS', 'HAS_ERRORS', 'FAILED'].includes(value.status),
  );
  expect(dto.status, JSON.stringify(dto.failure)).not.toBe('HAS_ERRORS');

  const finalized = await api.post(`/api/v1/data-imports/${dto.id}/finalize`, {
    data: {
      expectedRevision: dto.revision,
      acknowledgeWarnings: true,
      dataset: { mode: 'NEW', name, description: '', customerId: null },
    },
  });
  expect(finalized.status(), await finalized.text()).toBe(200);
  return (await finalized.json()) as DatasetVersionDetailDto;
}

async function waitForImport(
  api: APIRequestContext,
  importId: string,
  until: (dto: DataImportDto) => boolean,
  timeoutMs = 60_000,
): Promise<DataImportDto> {
  const started = Date.now();
  for (;;) {
    const response = await api.get(`/api/v1/data-imports/${importId}`);
    expect(response.status()).toBe(200);
    const dto = (await response.json()) as DataImportDto;
    if (until(dto)) return dto;
    if (Date.now() - started > timeoutMs) throw new Error(`import ${importId} still ${dto.status}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export async function createSequence(
  api: APIRequestContext,
  code = `SEQ${Date.now().toString().slice(-6)}`,
): Promise<SequenceDto> {
  const response = await api.post('/api/v1/sequences', {
    data: {
      name: `Sequence ${code}`,
      code,
      description: '',
      prefix: 'YT-',
      suffix: '',
      padding: 8,
      startValue: 1_000_001,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as SequenceDto;
}

export async function getJob(api: APIRequestContext, jobId: string): Promise<ProductionJobDto> {
  const response = await api.get(`/api/v1/production-jobs/${jobId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as ProductionJobDto;
}

/** Waits until the job page shows one of the expected statuses. */
export async function expectJobStatus(
  page: Page,
  status: ProductionJobDto['status'],
  timeout = 60_000,
) {
  await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', status, { timeout });
}

/** The job id in the current URL. */
export function jobIdFrom(page: Page): string {
  const match = /\/production\/([0-9a-f-]{36})/.exec(page.url());
  if (!match) throw new Error(`no production job in ${page.url()}`);
  return match[1]!;
}

/**
 * Changes one configuration control and waits until the server stored it. Configuration is saved
 * per change and bumps the job revision, so acting before the response lands would use a revision
 * the server has already moved past (the UI refuses that with a conflict).
 */
export async function configure(
  page: Page,
  jobId: string,
  testId: string,
  value: string,
): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(`/production-jobs/${jobId}`) &&
        response.request().method() === 'PATCH',
    ),
    page.getByTestId(testId).selectOption(value),
  ]);
}
