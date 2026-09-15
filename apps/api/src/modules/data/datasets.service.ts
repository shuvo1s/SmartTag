import { Inject, Injectable } from '@nestjs/common';
import { DATA_SCHEMA_HASH_METHOD, RESOLVED_INPUT_HASH_METHOD } from '@smarttag/data-core';
import type { Prisma } from '@smarttag/database';
import {
  DATASET_HASH_SCHEME,
  RECORD_HASH_SCHEME,
  RECORDS_DIGEST_SCHEME,
} from '@smarttag/import-core';
import {
  ObjectNotFoundError,
  type ObjectStorage,
  type StoredObject,
} from '@smarttag/object-storage';
import type {
  CreateDatasetCommand,
  DatasetDetailDto,
  DatasetImportConfiguration,
  DatasetRecordDetailDto,
  DatasetRecordPageDto,
  DatasetSummaryDto,
  DatasetVersionDetailDto,
  ListDatasetRecordsQuery,
  ListDatasetsQuery,
  PaginatedResponse,
} from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { PrismaService } from '../../database/prisma.service';
import { OBJECT_STORAGE } from '../assets/storage/storage.module';
import { AuditService } from '../audit/audit.service';
import {
  asMapping,
  asSummary,
  datasetVersionSummarySelect,
  recordSelect,
  sourceFileSelect,
  templateVersionRefSelect,
  toDatasetVersionSummary,
  toRecordDto,
  toSourceFileDto,
  toTemplateVersionRef,
  userRef,
} from './data.mappers';

const datasetSelect = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  createdBy: userRef,
  customer: { select: { id: true, code: true, name: true } },
  _count: { select: { versions: { where: { status: 'FINALIZED' } } } },
  versions: {
    where: { status: 'FINALIZED' },
    orderBy: { versionNumber: 'desc' },
    take: 1,
    select: datasetVersionSummarySelect,
  },
} as const satisfies Prisma.DatasetSelect;

type DatasetRow = Prisma.DatasetGetPayload<{ select: typeof datasetSelect }>;

function toDatasetSummary(row: DatasetRow): DatasetSummaryDto {
  const latest = row.versions[0];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    customer: row.customer,
    versionCount: row._count.versions,
    latestVersion: latest ? toDatasetVersionSummary(latest) : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Datasets, finalized dataset versions and their records (read-only after finalization). */
@Injectable()
export class DatasetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async list(
    actor: ActorContext,
    query: ListDatasetsQuery,
  ): Promise<PaginatedResponse<DatasetSummaryDto>> {
    const where: Prisma.DatasetWhereInput = {
      organizationId: actor.organizationId,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.dataset.count({ where }),
      this.prisma.dataset.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: datasetSelect,
      }),
    ]);
    return {
      items: rows.map(toDatasetSummary),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async create(actor: ActorContext, input: CreateDatasetCommand): Promise<DatasetDetailDto> {
    const created = await this.prisma.$transaction((tx) =>
      this.createInTransaction(tx, actor, input),
    );
    return this.get(actor, created.id);
  }

  /** Creates a dataset inside the caller's transaction (also used when finalizing an import). */
  async createInTransaction(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    input: CreateDatasetCommand,
  ): Promise<{ id: string; name: string }> {
    const existing = await tx.dataset.findFirst({
      where: { organizationId: actor.organizationId, name: input.name },
      select: { id: true },
    });
    if (existing) throw AppError.conflict(`A dataset named "${input.name}" already exists`);
    if (input.customerId) {
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, organizationId: actor.organizationId },
        select: { id: true },
      });
      if (!customer) throw AppError.notFound('Customer');
    }
    const dataset = await tx.dataset.create({
      data: {
        organizationId: actor.organizationId,
        name: input.name,
        description: input.description,
        customerId: input.customerId,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
      select: { id: true, name: true },
    });
    await this.audit.recordForActor(tx, actor, {
      action: 'DATASET_CREATED',
      resourceType: 'DATASET',
      resourceId: dataset.id,
      metadata: { customerId: input.customerId },
    });
    return dataset;
  }

  async get(actor: ActorContext, datasetId: string): Promise<DatasetDetailDto> {
    const row = await this.prisma.dataset.findFirst({
      where: { id: datasetId, organizationId: actor.organizationId },
      select: datasetSelect,
    });
    if (!row) throw AppError.notFound('Dataset');
    const versions = await this.prisma.datasetVersion.findMany({
      where: { datasetId, organizationId: actor.organizationId, status: 'FINALIZED' },
      orderBy: { versionNumber: 'desc' },
      select: datasetVersionSummarySelect,
    });
    return { ...toDatasetSummary(row), versions: versions.map(toDatasetVersionSummary) };
  }

  async getVersion(actor: ActorContext, versionId: string): Promise<DatasetVersionDetailDto> {
    const row = await this.prisma.datasetVersion.findFirst({
      where: { id: versionId, organizationId: actor.organizationId, status: 'FINALIZED' },
      select: {
        ...datasetVersionSummarySelect,
        importId: true,
        dataSchemaHash: true,
        sourceChecksumSha256: true,
        mappingSnapshot: true,
        importConfiguration: true,
        mappingProfileId: true,
        mappingProfileRevision: true,
        blankRowCount: true,
        recordsDigest: true,
        validationSummary: true,
        warningsAcknowledgedAt: true,
        createdAt: true,
        createdBy: userRef,
        dataset: { select: { id: true, name: true } },
        templateVersion: { select: templateVersionRefSelect },
        sourceFile: { select: sourceFileSelect },
        templateVersionHash: true,
      },
    });
    if (!row) throw AppError.notFound('Dataset version');
    const profile = row.mappingProfileId
      ? await this.prisma.mappingProfile.findFirst({
          where: { id: row.mappingProfileId, organizationId: actor.organizationId },
          select: { id: true, name: true },
        })
      : null;
    return {
      ...toDatasetVersionSummary({
        ...row,
        sourceFile: {
          originalFilename: row.sourceFile.originalFilename,
          format: row.sourceFile.format,
        },
      }),
      status: 'FINALIZED',
      dataset: row.dataset!,
      importId: row.importId,
      templateVersion: {
        ...toTemplateVersionRef(row.templateVersion),
        documentHash: row.templateVersionHash,
      },
      dataSchemaHash: row.dataSchemaHash,
      sourceFile: toSourceFileDto(row.sourceFile),
      sourceChecksumSha256: row.sourceChecksumSha256,
      mappingSnapshot: asMapping(row.mappingSnapshot),
      importConfiguration: row.importConfiguration as unknown as DatasetImportConfiguration,
      mappingProfile:
        profile && row.mappingProfileRevision !== null
          ? { id: profile.id, name: profile.name, revision: row.mappingProfileRevision }
          : null,
      blankRowCount: row.blankRowCount,
      recordsDigest: row.recordsDigest!,
      validationSummary: asSummary(row.validationSummary),
      warningsAcknowledgedAt: row.warningsAcknowledgedAt?.toISOString() ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      hashMethods: {
        recordHash: `SHA-256/RFC8785-JCS/${RECORD_HASH_SCHEME}`,
        recordsDigest: `SHA-256/${RECORDS_DIGEST_SCHEME}`,
        datasetHash: `SHA-256/RFC8785-JCS/${DATASET_HASH_SCHEME}`,
        resolvedInputHash: RESOLVED_INPUT_HASH_METHOD,
        dataSchemaHash: DATA_SCHEMA_HASH_METHOD,
      },
    };
  }

  /** The completed dataset version (draft of the current run, or finalized) of an import. */
  async versionIdForImport(actor: ActorContext, importId: string): Promise<string> {
    const found = await this.prisma.dataImport.findFirst({
      where: { id: importId, organizationId: actor.organizationId },
      select: { validationRun: true, status: true },
    });
    if (!found) throw AppError.notFound('Data import');
    if (!['READY', 'READY_WITH_WARNINGS', 'HAS_ERRORS', 'FINALIZED'].includes(found.status)) {
      throw new AppError('IMPORT_NOT_READY', 'The import has no validation results yet.');
    }
    const version = await this.prisma.datasetVersion.findFirst({
      where: { importId, validationRun: found.validationRun, completedAt: { not: null } },
      select: { id: true },
    });
    if (!version)
      throw new AppError('IMPORT_NOT_READY', 'The import has no validation results yet.');
    return version.id;
  }

  async finalizedVersionId(actor: ActorContext, versionId: string): Promise<string> {
    const version = await this.prisma.datasetVersion.findFirst({
      where: { id: versionId, organizationId: actor.organizationId, status: 'FINALIZED' },
      select: { id: true },
    });
    if (!version) throw AppError.notFound('Dataset version');
    return version.id;
  }

  private recordWhere(
    versionId: string,
    query: ListDatasetRecordsQuery,
  ): Prisma.DatasetRecordWhereInput {
    const search = query.search?.trim();
    const rowNumber = search && /^\d{1,7}$/.test(search) ? Number(search) : null;
    return {
      datasetVersionId: versionId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.duplicates === 'true' ? { duplicateOfSequence: { not: null } } : {}),
      ...(search
        ? {
            OR: [
              ...(rowNumber !== null ? [{ rowNumber }] : []),
              { searchText: { contains: search.toLowerCase() } },
            ],
          }
        : {}),
    };
  }

  private async rowNumbersFor(versionId: string, sequences: readonly (number | null)[]) {
    const wanted = [
      ...new Set(sequences.filter((sequence): sequence is number => sequence !== null)),
    ];
    if (wanted.length === 0) return new Map<number, number>();
    const rows = await this.prisma.datasetRecord.findMany({
      where: { datasetVersionId: versionId, sequence: { in: wanted } },
      select: { sequence: true, rowNumber: true },
    });
    return new Map(rows.map((row) => [row.sequence, row.rowNumber]));
  }

  /** One page of records (never all of them): server pagination with filters and search. */
  async listRecords(
    versionId: string,
    query: ListDatasetRecordsQuery,
  ): Promise<DatasetRecordPageDto> {
    const where = this.recordWhere(versionId, query);
    const [total, rows, version] = await this.prisma.$transaction([
      this.prisma.datasetRecord.count({ where }),
      this.prisma.datasetRecord.findMany({
        where,
        orderBy: { sequence: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: recordSelect,
      }),
      this.prisma.datasetVersion.findUniqueOrThrow({
        where: { id: versionId },
        select: {
          rowCount: true,
          validCount: true,
          warningCount: true,
          errorCount: true,
          duplicateRowCount: true,
        },
      }),
    ]);
    const rowNumbers = await this.rowNumbersFor(
      versionId,
      rows.map((row) => row.duplicateOfSequence),
    );
    return {
      items: rows.map((row) => toRecordDto(row, rowNumbers)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      counts: {
        all: version.rowCount,
        valid: version.validCount,
        warning: version.warningCount,
        error: version.errorCount,
        duplicates: version.duplicateRowCount,
      },
    };
  }

  async getRecord(
    versionId: string,
    sequence: number,
    query: ListDatasetRecordsQuery,
  ): Promise<DatasetRecordDetailDto> {
    const row = await this.prisma.datasetRecord.findUnique({
      where: { datasetVersionId_sequence: { datasetVersionId: versionId, sequence } },
      select: recordSelect,
    });
    if (!row) throw AppError.notFound('Record');
    const where = this.recordWhere(versionId, query);
    const [previous, next] = await Promise.all([
      this.prisma.datasetRecord.findFirst({
        where: { ...where, sequence: { lt: sequence } },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      }),
      this.prisma.datasetRecord.findFirst({
        where: { ...where, sequence: { gt: sequence } },
        orderBy: { sequence: 'asc' },
        select: { sequence: true },
      }),
    ]);
    const rowNumbers = await this.rowNumbersFor(versionId, [row.duplicateOfSequence]);
    return {
      record: toRecordDto(row, rowNumbers),
      previousSequence: previous?.sequence ?? null,
      nextSequence: next?.sequence ?? null,
    };
  }

  /** Opens the original uploaded file of an import, recording the access. */
  async openSource(
    actor: ActorContext,
    where: { importId: string } | { versionId: string },
  ): Promise<{
    filename: string;
    format: 'CSV' | 'XLSX';
    checksumSha256: string;
    object: StoredObject;
  }> {
    const file =
      'importId' in where
        ? (
            await this.prisma.dataImport.findFirst({
              where: { id: where.importId, organizationId: actor.organizationId },
              select: { sourceFile: true },
            })
          )?.sourceFile
        : (
            await this.prisma.datasetVersion.findFirst({
              where: {
                id: where.versionId,
                organizationId: actor.organizationId,
                status: 'FINALIZED',
              },
              select: { sourceFile: true },
            })
          )?.sourceFile;
    if (!file) throw AppError.notFound('importId' in where ? 'Data import' : 'Dataset version');
    if (file.status !== 'STORED') throw AppError.notFound('Source file');
    let object: StoredObject;
    try {
      object = await this.storage.getObject(file.storageKey);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) throw AppError.notFound('Source file');
      throw error;
    }
    await this.audit.recordForActor(this.prisma, actor, {
      action: 'DATA_SOURCE_DOWNLOADED',
      resourceType: 'DATA_SOURCE_FILE',
      resourceId: file.id,
      metadata: { checksumSha256: file.checksumSha256, sizeBytes: file.sizeBytes, ...where },
    });
    return {
      filename: file.originalFilename,
      format: file.format,
      checksumSha256: file.checksumSha256,
      object,
    };
  }
}
