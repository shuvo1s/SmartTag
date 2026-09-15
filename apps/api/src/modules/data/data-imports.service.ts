import { Inject, Injectable, Logger } from '@nestjs/common';
import { computeDataSchemaHash } from '@smarttag/data-core';
import { Prisma } from '@smarttag/database';
import { parseDesignDocument, type DesignDocument } from '@smarttag/document-schema';
import {
  DATASET_HASH_SCHEME,
  MappingDefinitionSchema,
  MappingProfileDefinitionSchema,
  SourceSettingsSchema,
  buildSourceColumns,
  canEditImport,
  canFinalizeImport,
  checkSourceSettings,
  computeDatasetHash,
  countDataRows,
  defaultSourceSettings,
  evaluateMappingProfile,
  isImportTerminal,
  retainMappableEntries,
  suggestMappings,
  validateMapping,
  type DataImportStatus,
  type MappingDefinition,
  type SourceColumn,
  type SourceInspection,
  type SourceSettings,
} from '@smarttag/import-core';
import { dataSourceStorageKey, type ObjectStorage } from '@smarttag/object-storage';
import type {
  DataImportDto,
  DataImportSummaryDto,
  FinalizeImportCommand,
  ImportFailureDto,
  ImportRevisionRequest,
  ListDataImportsQuery,
  PaginatedResponse,
  ProfileEvaluationDto,
  UpdateImportMappingRequest,
  UpdateImportSourceSettingsRequest,
} from '@smarttag/shared-types';
import {
  SourceReadError,
  checkWorkbookContainer,
  detectSourceFormat,
} from '@smarttag/tabular-sources';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { APP_CONFIG, type AppConfig } from '../../config/env.schema';
import { PrismaService } from '../../database/prisma.service';
import { sanitizeFilename } from '../assets/asset-content-inspector';
import { OBJECT_STORAGE } from '../assets/storage/storage.module';
import { AuditService } from '../audit/audit.service';
import {
  asMapping,
  asSummary,
  importLimitsDto,
  sourceFileSelect,
  templateVersionRefSelect,
  toSourceFileDto,
  toTemplateVersionRef,
} from './data.mappers';
import { DatasetsService } from './datasets.service';
import { ImportQueueService } from './import-queue.service';

export interface UploadedSourceFile {
  readonly originalname: string;
  readonly mimetype: string;
  readonly buffer: Buffer;
  readonly size: number;
}

const importDetailInclude = {
  sourceFile: { select: sourceFileSelect },
  templateVersion: { select: { ...templateVersionRefSelect, documentJson: true } },
  targetDataset: { select: { id: true, name: true } },
  mappingProfile: { select: { id: true, name: true } },
  createdBy: { select: { id: true, displayName: true } },
} as const satisfies Prisma.DataImportInclude;

type ImportDetailRow = Prisma.DataImportGetPayload<{ include: typeof importDetailInclude }>;

const PROCESSING_STAGE: Partial<Record<DataImportStatus, 'INSPECTION' | 'VALIDATION'>> = {
  UPLOADED: 'INSPECTION',
  INSPECTING: 'INSPECTION',
  VALIDATING: 'VALIDATION',
};

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * Data imports: upload, source settings, mapping, validation requests, retry, cancellation and
 * finalization into an immutable dataset version. All reading and row validation happens in the
 * worker (@smarttag/import-processing); this service only changes state, guarded by the import's
 * revision and status, and records audit events with aggregates only (never row data).
 */
@Injectable()
export class DataImportsService {
  private readonly logger = new Logger(DataImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: ImportQueueService,
    private readonly datasets: DatasetsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------------------------------------
  // Upload
  // ------------------------------------------------------------------------------------------

  async create(
    actor: ActorContext,
    templateVersionId: string,
    file: UploadedSourceFile | undefined,
    targetDatasetId: string | undefined,
  ): Promise<DataImportDto> {
    if (!file || file.size === 0) {
      throw AppError.validation('A non-empty file is required', [
        { path: 'file', message: 'Choose a CSV or XLSX file to upload' },
      ]);
    }
    const { limits } = this.config.imports;
    if (file.size > limits.maxFileBytes) {
      throw new AppError(
        'IMPORT_FILE_TOO_LARGE',
        'The file is larger than the upload limit for data imports.',
      );
    }
    const filename = sanitizeFilename(file.originalname);
    const detection = detectSourceFormat(filename, file.buffer.subarray(0, 16));
    if (!detection.ok) throw new AppError('UNSUPPORTED_IMPORT_FORMAT', detection.message);

    const version = await this.prisma.templateVersion.findFirst({
      where: { id: templateVersionId, organizationId: actor.organizationId },
      select: { id: true, status: true, documentHash: true, documentJson: true },
    });
    if (!version) throw AppError.notFound('Template version');
    if (version.status === 'RETIRED') {
      throw AppError.conflict('Retired template versions cannot receive new data');
    }
    const document = this.parseDocument(version.documentJson);
    if (document.dataSchema.fields.length === 0) {
      throw AppError.validation('This template version has no data fields to import into');
    }
    if (targetDatasetId) {
      const dataset = await this.prisma.dataset.findFirst({
        where: { id: targetDatasetId, organizationId: actor.organizationId },
        select: { id: true },
      });
      if (!dataset) throw AppError.notFound('Dataset');
    }
    if (detection.format === 'XLSX') {
      try {
        await checkWorkbookContainer(file.buffer, limits);
      } catch (error) {
        throw this.uploadError(error);
      }
    }
    this.queue.assertAvailable();

    const dataSchemaHash = await computeDataSchemaHash(document.dataSchema);
    const checksumSha256 = sha256(file.buffer);
    const sourceFileId = randomUUID();
    const storageKey = dataSourceStorageKey(actor.organizationId, sourceFileId);

    // 1. Record the upload before any bytes are written, so a crash leaves a PENDING row that
    //    the cleanup job removes together with any partial object.
    await this.prisma.dataSourceFile.create({
      data: {
        id: sourceFileId,
        organizationId: actor.organizationId,
        storageKey,
        originalFilename: filename,
        format: detection.format,
        declaredMimeType: file.mimetype.slice(0, 127) || null,
        sizeBytes: file.size,
        checksumSha256,
        createdById: actor.userId,
      },
    });
    // 2. Store the original bytes unchanged.
    try {
      await this.storage.putObject(storageKey, file.buffer, {
        contentType: detection.format === 'CSV' ? 'text/csv' : XLSX_MIME,
        checksumSha256,
      });
    } catch (error) {
      await this.discardUpload(sourceFileId, storageKey);
      throw error;
    }
    // 3. Mark it stored and create the import atomically; undo storage on failure.
    let importId: string;
    try {
      importId = await this.prisma.$transaction(async (tx) => {
        await tx.dataSourceFile.update({
          where: { id: sourceFileId },
          data: { status: 'STORED', storedAt: new Date() },
        });
        const created = await tx.dataImport.create({
          data: {
            organizationId: actor.organizationId,
            templateVersionId: version.id,
            templateVersionHash: version.documentHash,
            dataSchemaHash,
            targetDatasetId: targetDatasetId ?? null,
            sourceFileId,
            sourceSettings: defaultSourceSettings(detection.format),
            inspectionRun: 1,
            createdById: actor.userId,
          },
          select: { id: true },
        });
        await this.audit.recordForActor(tx, actor, {
          action: 'DATA_IMPORT_CREATED',
          resourceType: 'DATA_IMPORT',
          resourceId: created.id,
          metadata: {
            templateVersionId: version.id,
            templateVersionHash: version.documentHash,
            dataSchemaHash,
            format: detection.format,
            sizeBytes: file.size,
            sourceChecksumSha256: checksumSha256,
            targetDatasetId: targetDatasetId ?? null,
          },
        });
        return created.id;
      });
    } catch (error) {
      await this.discardUpload(sourceFileId, storageKey);
      throw error;
    }

    await this.enqueueOrFail(actor, importId, 'INSPECTION', () =>
      this.queue.enqueueInspection(actor, importId, 1),
    );
    return this.get(actor, importId);
  }

  private uploadError(error: unknown): AppError {
    if (!(error instanceof SourceReadError)) throw error;
    switch (error.code) {
      case 'UNSUPPORTED_IMPORT_FORMAT':
      case 'MACROS_NOT_SUPPORTED':
        return new AppError('UNSUPPORTED_IMPORT_FORMAT', error.message);
      case 'WORKBOOK_LIMIT_EXCEEDED':
      case 'FILE_LIMIT_EXCEEDED':
        return new AppError('WORKBOOK_LIMIT_EXCEEDED', error.message);
      case 'MALFORMED_FILE':
      case 'NO_SHEETS':
      case 'ENCODING_INVALID':
      case 'ENCRYPTED_FILE':
        return new AppError('IMPORT_FILE_MALFORMED', error.message);
    }
  }

  private async discardUpload(sourceFileId: string, storageKey: string): Promise<void> {
    try {
      await this.storage.deleteObject(storageKey);
      await this.prisma.dataSourceFile.updateMany({
        where: { id: sourceFileId, status: 'PENDING' },
        data: { status: 'DELETED', deletedAt: new Date() },
      });
    } catch (cleanupError) {
      // The scheduled cleanup removes PENDING uploads that could not be discarded here.
      this.logger.warn({ err: cleanupError, sourceFileId }, 'Could not discard a failed upload');
    }
  }

  /** Queues a job; when the queue is unreachable the import becomes FAILED (retryable) at once. */
  private async enqueueOrFail(
    actor: ActorContext,
    importId: string,
    stage: 'INSPECTION' | 'VALIDATION',
    enqueue: () => Promise<void>,
  ): Promise<void> {
    try {
      await enqueue();
    } catch (error) {
      this.logger.error({ err: error, importId }, 'Could not queue an import job');
      await this.prisma.dataImport.updateMany({
        where: {
          id: importId,
          organizationId: actor.organizationId,
          status: stage === 'INSPECTION' ? { in: ['UPLOADED', 'INSPECTING'] } : 'VALIDATING',
        },
        data: {
          status: 'FAILED',
          failure: {
            code: 'PROCESSING_UNAVAILABLE',
            message:
              'Background processing is temporarily unavailable. Retry the import in a moment.',
            stage,
            retryable: true,
          },
        },
      });
    }
  }

  // ------------------------------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------------------------------

  async list(
    actor: ActorContext,
    query: ListDataImportsQuery,
  ): Promise<PaginatedResponse<DataImportSummaryDto>> {
    const where: Prisma.DataImportWhereInput = {
      organizationId: actor.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.templateVersionId ? { templateVersionId: query.templateVersionId } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.dataImport.count({ where }),
      this.prisma.dataImport.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          sourceFile: { select: { originalFilename: true, format: true, sizeBytes: true } },
          templateVersion: { select: templateVersionRefSelect },
          createdBy: { select: { id: true, displayName: true } },
          datasetVersions: {
            where: { OR: [{ status: 'FINALIZED' }, { completedAt: { not: null } }] },
            orderBy: { validationRun: 'desc' },
            take: 1,
            select: {
              id: true,
              status: true,
              validationRun: true,
              rowCount: true,
              validCount: true,
              warningCount: true,
              errorCount: true,
              versionNumber: true,
              datasetId: true,
              dataset: { select: { name: true } },
            },
          },
        },
      }),
    ]);
    return {
      items: rows.map((row): DataImportSummaryDto => {
        const latest = row.datasetVersions[0];
        const current = latest && latest.validationRun === row.validationRun ? latest : undefined;
        return {
          id: row.id,
          status: row.status,
          templateVersion: toTemplateVersionRef(row.templateVersion),
          source: {
            filename: row.sourceFile.originalFilename,
            format: row.sourceFile.format,
            sizeBytes: row.sourceFile.sizeBytes,
          },
          rowCount: current?.rowCount ?? null,
          validCount: current?.validCount ?? null,
          warningCount: current?.warningCount ?? null,
          errorCount: current?.errorCount ?? null,
          datasetVersion:
            current?.status === 'FINALIZED' && current.dataset
              ? {
                  id: current.id,
                  datasetId: current.datasetId!,
                  datasetName: current.dataset.name,
                  versionNumber: current.versionNumber!,
                }
              : null,
          createdBy: row.createdBy,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async get(actor: ActorContext, importId: string): Promise<DataImportDto> {
    const row = await this.requireImport(actor, importId);
    return this.toDto(actor, row);
  }

  private async requireImport(actor: ActorContext, importId: string): Promise<ImportDetailRow> {
    const row = await this.prisma.dataImport.findFirst({
      where: { id: importId, organizationId: actor.organizationId },
      include: importDetailInclude,
    });
    if (!row) throw AppError.notFound('Data import');
    return row;
  }

  private parseDocument(json: Prisma.JsonValue): DesignDocument {
    const parsed = parseDesignDocument(json);
    if (!parsed.valid)
      throw AppError.invalidDocument(parsed.errors, 'The stored design document is invalid');
    return parsed.document;
  }

  private async toDto(actor: ActorContext, row: ImportDetailRow): Promise<DataImportDto> {
    const document = this.parseDocument(row.templateVersion.documentJson);
    const settings = SourceSettingsSchema.parse(row.sourceSettings);
    const inspection = row.inspection as unknown as SourceInspection | null;
    const columns = row.columns as unknown as SourceColumn[];
    const mapping = row.mapping === null ? null : MappingDefinitionSchema.parse(row.mapping);
    const editable = canEditImport(row.status);

    let profileEvaluations: ProfileEvaluationDto[] = [];
    if (columns.length > 0 && editable) {
      const profiles = await this.prisma.mappingProfile.findMany({
        where: { organizationId: actor.organizationId, status: 'ACTIVE' },
        orderBy: [{ updatedAt: 'desc' }],
        take: 50,
        select: {
          id: true,
          name: true,
          currentRevision: true,
          dataSchemaHash: true,
          definition: true,
        },
      });
      const order = { COMPATIBLE: 0, REQUIRES_REVIEW: 1, INCOMPATIBLE: 2 } as const;
      profileEvaluations = profiles
        .flatMap((profile) => {
          const definition = MappingProfileDefinitionSchema.safeParse(profile.definition);
          if (!definition.success) return [];
          const evaluation = evaluateMappingProfile(
            { definition: definition.data, dataSchemaHash: profile.dataSchemaHash },
            { dataSchemaHash: row.dataSchemaHash, schema: document.dataSchema, columns },
          );
          return [
            {
              profileId: profile.id,
              name: profile.name,
              revision: profile.currentRevision,
              compatibility: evaluation.compatibility,
              schemaMatches: evaluation.schemaMatches,
              layoutMatches: evaluation.layoutMatches,
              resolvedEntries: evaluation.resolvedEntries,
              totalEntries: evaluation.totalEntries,
              notes: evaluation.notes,
              mapping: evaluation.mapping,
            },
          ];
        })
        .sort((a, b) => order[a.compatibility] - order[b.compatibility]);
    }

    const validated = ['READY', 'READY_WITH_WARNINGS', 'HAS_ERRORS', 'FINALIZED'].includes(
      row.status,
    );
    const version = validated
      ? await this.prisma.datasetVersion.findFirst({
          where: { importId: row.id, validationRun: row.validationRun, completedAt: { not: null } },
          select: {
            id: true,
            status: true,
            datasetId: true,
            versionNumber: true,
            rowCount: true,
            validCount: true,
            warningCount: true,
            errorCount: true,
            blankRowCount: true,
            duplicateRowCount: true,
            validationSummary: true,
            completedAt: true,
            dataset: { select: { name: true } },
          },
        })
      : null;

    return {
      id: row.id,
      status: row.status,
      revision: row.revision,
      templateVersion: {
        ...toTemplateVersionRef(row.templateVersion),
        documentHash: row.templateVersionHash,
        dataSchemaHash: row.dataSchemaHash,
        changedSinceImport: row.templateVersion.documentHash !== row.templateVersionHash,
      },
      targetDataset: row.targetDataset,
      source: toSourceFileDto(row.sourceFile),
      sourceSettings: settings,
      sourceProblems: inspection ? checkSourceSettings(settings, inspection) : [],
      inspection,
      columns,
      dataRowCount: inspection ? countDataRows(settings, inspection) : null,
      mapping,
      mappingValidation: mapping ? validateMapping(document.dataSchema, columns, mapping) : null,
      suggestions:
        columns.length > 0
          ? suggestMappings(document.dataSchema.fields, columns)
          : { suggestions: [], ambiguous: [] },
      mappingProfile:
        row.mappingProfile && row.mappingProfileRevision !== null
          ? {
              id: row.mappingProfile.id,
              name: row.mappingProfile.name,
              revision: row.mappingProfileRevision,
            }
          : null,
      profileEvaluations,
      progress: {
        stage: PROCESSING_STAGE[row.status] ?? null,
        processedRows: row.progressProcessedRows,
        totalRows: row.progressTotalRows,
        updatedAt: row.progressUpdatedAt?.toISOString() ?? null,
      },
      validation: version?.completedAt
        ? {
            run: row.validationRun,
            datasetVersionId: version.id,
            rowCount: version.rowCount,
            validCount: version.validCount,
            warningCount: version.warningCount,
            errorCount: version.errorCount,
            blankRowCount: version.blankRowCount,
            duplicateRowCount: version.duplicateRowCount,
            summary: asSummary(version.validationSummary),
            completedAt: version.completedAt.toISOString(),
          }
        : null,
      failure: row.failure as unknown as ImportFailureDto | null,
      finalizedVersion:
        version?.status === 'FINALIZED' && version.dataset
          ? {
              id: version.id,
              datasetId: version.datasetId!,
              datasetName: version.dataset.name,
              versionNumber: version.versionNumber!,
            }
          : null,
      limits: importLimitsDto(this.config),
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // ------------------------------------------------------------------------------------------
  // Changes
  // ------------------------------------------------------------------------------------------

  private assertRevision(row: { revision: number }, expectedRevision: number): void {
    if (row.revision !== expectedRevision) {
      throw new AppError(
        'VERSION_CONFLICT',
        'The import was changed by someone else or by background processing. Reload it and try again.',
        { currentRevision: row.revision },
      );
    }
  }

  private assertNotTerminal(status: DataImportStatus): void {
    if (status === 'FINALIZED') {
      throw new AppError(
        'DATASET_IMMUTABLE',
        'This import was finalized; its dataset version is immutable.',
      );
    }
    if (isImportTerminal(status))
      throw new AppError('IMPORT_NOT_READY', 'This import was cancelled.');
  }

  /** Applies a guarded update: it only takes effect if status and revision are still as read. */
  private async guardedUpdate(
    tx: Prisma.TransactionClient,
    row: { id: string; revision: number; status: DataImportStatus },
    data: Prisma.DataImportUncheckedUpdateManyInput,
  ): Promise<void> {
    const updated = await tx.dataImport.updateMany({
      where: { id: row.id, revision: row.revision, status: row.status },
      data: { ...data, revision: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new AppError(
        'VERSION_CONFLICT',
        'The import changed while this request was processed. Reload it and try again.',
      );
    }
  }

  async updateSourceSettings(
    actor: ActorContext,
    importId: string,
    input: UpdateImportSourceSettingsRequest,
  ): Promise<DataImportDto> {
    const row = await this.requireImport(actor, importId);
    this.assertNotTerminal(row.status);
    this.assertRevision(row, input.expectedRevision);
    const failure = row.failure as unknown as ImportFailureDto | null;
    const failedInspection = row.status === 'FAILED' && failure?.stage === 'INSPECTION';
    if (!canEditImport(row.status) && !failedInspection) {
      throw new AppError(
        'IMPORT_NOT_READY',
        'Source settings cannot be changed while the import is being processed.',
      );
    }
    const current = SourceSettingsSchema.parse(row.sourceSettings);
    const next: SourceSettings = input.settings;
    if (next.format !== current.format) {
      throw new AppError('INVALID_SOURCE_SETTINGS', `This import is a ${current.format} file.`);
    }
    const inspection = row.inspection as unknown as SourceInspection | null;
    const needsInspection =
      failedInspection ||
      !inspection ||
      (next.format === 'CSV' &&
        current.format === 'CSV' &&
        (next.encoding !== current.encoding || next.delimiter !== current.delimiter));

    if (needsInspection) {
      const run = row.inspectionRun + 1;
      await this.prisma.$transaction(async (tx) => {
        await this.guardedUpdate(tx, row, {
          status: 'INSPECTING',
          sourceSettings: next,
          inspectionRun: run,
          failure: DB_NULL,
          progressProcessedRows: 0,
          progressTotalRows: null,
          progressUpdatedAt: new Date(),
        });
        await this.auditSettings(tx, actor, row.id, next, true);
      });
      await this.enqueueOrFail(actor, row.id, 'INSPECTION', () =>
        this.queue.enqueueInspection(actor, row.id, run),
      );
      return this.get(actor, row.id);
    }

    const problems = checkSourceSettings(next, inspection);
    if (problems.length > 0) {
      throw new AppError(
        'INVALID_SOURCE_SETTINGS',
        problems.map((problem) => problem.message).join('; '),
        {
          problems,
        },
      );
    }
    const document = this.parseDocument(row.templateVersion.documentJson);
    const columns = buildSourceColumns(next, inspection);
    const mapping =
      row.mapping === null ? null : retainMappableEntries(asMapping(row.mapping), columns).mapping;
    const complete =
      mapping !== null && validateMapping(document.dataSchema, columns, mapping).complete;
    await this.prisma.$transaction(async (tx) => {
      await this.guardedUpdate(tx, row, {
        status: complete ? 'READY_TO_VALIDATE' : 'MAPPING_REQUIRED',
        sourceSettings: next,
        columns: columns as unknown as Prisma.InputJsonValue,
        ...(mapping ? { mapping: mapping } : {}),
      });
      await this.auditSettings(tx, actor, row.id, next, false);
    });
    return this.get(actor, row.id);
  }

  private auditSettings(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    importId: string,
    settings: SourceSettings,
    reinspect: boolean,
  ) {
    return this.audit.recordForActor(tx, actor, {
      action: 'DATA_IMPORT_SOURCE_SETTINGS_UPDATED',
      resourceType: 'DATA_IMPORT',
      resourceId: importId,
      metadata: { ...(settings as unknown as Prisma.InputJsonObject), reinspect },
    });
  }

  async updateMapping(
    actor: ActorContext,
    importId: string,
    input: UpdateImportMappingRequest,
  ): Promise<DataImportDto> {
    const row = await this.requireImport(actor, importId);
    this.assertNotTerminal(row.status);
    this.assertRevision(row, input.expectedRevision);
    if (!canEditImport(row.status)) {
      throw new AppError(
        'IMPORT_NOT_READY',
        'The mapping cannot be changed while the import is being processed.',
      );
    }
    const inspection = row.inspection as unknown as SourceInspection | null;
    if (!inspection)
      throw new AppError('IMPORT_NOT_READY', 'The source has not been inspected yet.');
    if (input.profile) {
      const revision = await this.prisma.mappingProfileRevision.findFirst({
        where: {
          profileId: input.profile.id,
          revision: input.profile.revision,
          organizationId: actor.organizationId,
        },
        select: { revision: true },
      });
      if (!revision) throw AppError.notFound('Mapping profile');
    }
    const document = this.parseDocument(row.templateVersion.documentJson);
    const columns = row.columns as unknown as SourceColumn[];
    const mapping: MappingDefinition = input.mapping;
    const validation = validateMapping(document.dataSchema, columns, mapping);
    const blocking = validation.issues.filter((issue) =>
      [
        'UNKNOWN_TARGET_FIELD',
        'SOURCE_COLUMN_NOT_FOUND',
        'TARGET_FIELD_ALREADY_MAPPED',
        'PARSING_OPTION_NOT_APPLICABLE',
      ].includes(issue.code),
    );
    if (blocking.length > 0) {
      throw new AppError(
        blocking.some((issue) => issue.code === 'TARGET_FIELD_ALREADY_MAPPED')
          ? 'TARGET_FIELD_ALREADY_MAPPED'
          : 'VALIDATION_ERROR',
        blocking.map((issue) => issue.message).join('; '),
        { mappingIssues: blocking },
      );
    }
    const complete =
      validation.complete &&
      checkSourceSettings(SourceSettingsSchema.parse(row.sourceSettings), inspection).length === 0;
    await this.prisma.$transaction(async (tx) => {
      await this.guardedUpdate(tx, row, {
        status: complete ? 'READY_TO_VALIDATE' : 'MAPPING_REQUIRED',
        mapping: mapping,
        mappingProfileId: input.profile?.id ?? null,
        mappingProfileRevision: input.profile?.revision ?? null,
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'DATA_IMPORT_MAPPING_UPDATED',
        resourceType: 'DATA_IMPORT',
        resourceId: row.id,
        metadata: {
          mappedFields: validation.mappedFields.length,
          unmappedRequiredFields: validation.unmappedRequiredFields.length,
          complete: validation.complete,
          mappingProfileId: input.profile?.id ?? null,
          mappingProfileRevision: input.profile?.revision ?? null,
        },
      });
    });
    return this.get(actor, row.id);
  }

  async validate(
    actor: ActorContext,
    importId: string,
    input: ImportRevisionRequest,
  ): Promise<DataImportDto> {
    const row = await this.requireImport(actor, importId);
    this.assertNotTerminal(row.status);
    this.assertRevision(row, input.expectedRevision);
    if (row.templateVersion.documentHash !== row.templateVersionHash) {
      throw new AppError(
        'TEMPLATE_VERSION_CHANGED',
        'The template version was edited after this import started. Start a new import.',
      );
    }
    if (!['READY_TO_VALIDATE', 'READY', 'READY_WITH_WARNINGS', 'HAS_ERRORS'].includes(row.status)) {
      throw row.status === 'MAPPING_REQUIRED'
        ? new AppError(
            'MAPPING_INCOMPLETE',
            'Complete the mapping before validating: every required field needs a column or a default.',
          )
        : new AppError(
            'IMPORT_NOT_READY',
            `The import cannot be validated while it is ${row.status}.`,
          );
    }
    this.queue.assertAvailable();
    const run = row.validationRun + 1;
    await this.prisma.$transaction(async (tx) => {
      await this.guardedUpdate(tx, row, {
        status: 'VALIDATING',
        validationRun: run,
        progressProcessedRows: 0,
        progressTotalRows: null,
        progressUpdatedAt: new Date(),
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'DATA_IMPORT_VALIDATION_REQUESTED',
        resourceType: 'DATA_IMPORT',
        resourceId: row.id,
        metadata: { validationRun: run },
      });
    });
    await this.enqueueOrFail(actor, row.id, 'VALIDATION', () =>
      this.queue.enqueueValidation(actor, row.id, run),
    );
    return this.get(actor, row.id);
  }

  async retry(
    actor: ActorContext,
    importId: string,
    input: ImportRevisionRequest,
  ): Promise<DataImportDto> {
    const row = await this.requireImport(actor, importId);
    this.assertNotTerminal(row.status);
    this.assertRevision(row, input.expectedRevision);
    const failure = row.failure as unknown as ImportFailureDto | null;
    if (row.status !== 'FAILED' || !failure) {
      throw new AppError('IMPORT_NOT_READY', 'Only failed imports can be retried.');
    }
    this.queue.assertAvailable();
    if (failure.stage === 'INSPECTION') {
      const run = row.inspectionRun + 1;
      await this.prisma.$transaction((tx) =>
        this.guardedUpdate(tx, row, {
          status: 'INSPECTING',
          inspectionRun: run,
          failure: DB_NULL,
          progressUpdatedAt: new Date(),
        }),
      );
      await this.enqueueOrFail(actor, row.id, 'INSPECTION', () =>
        this.queue.enqueueInspection(actor, row.id, run),
      );
    } else {
      if (row.templateVersion.documentHash !== row.templateVersionHash) {
        throw new AppError(
          'TEMPLATE_VERSION_CHANGED',
          'The template version was edited after this import started. Start a new import.',
        );
      }
      const run = row.validationRun + 1;
      await this.prisma.$transaction((tx) =>
        this.guardedUpdate(tx, row, {
          status: 'VALIDATING',
          validationRun: run,
          failure: DB_NULL,
          progressProcessedRows: 0,
          progressTotalRows: null,
          progressUpdatedAt: new Date(),
        }),
      );
      await this.enqueueOrFail(actor, row.id, 'VALIDATION', () =>
        this.queue.enqueueValidation(actor, row.id, run),
      );
    }
    return this.get(actor, row.id);
  }

  async cancel(
    actor: ActorContext,
    importId: string,
    input: ImportRevisionRequest,
  ): Promise<DataImportDto> {
    const row = await this.requireImport(actor, importId);
    this.assertNotTerminal(row.status);
    this.assertRevision(row, input.expectedRevision);
    await this.prisma.$transaction(async (tx) => {
      await this.guardedUpdate(tx, row, {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        failure: DB_NULL,
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'DATA_IMPORT_CANCELLED',
        resourceType: 'DATA_IMPORT',
        resourceId: row.id,
        metadata: { previousStatus: row.status, reason: 'USER' },
      });
    });
    await this.queue.requestCleanup(actor);
    return this.get(actor, row.id);
  }

  /**
   * Creates an immutable dataset version from the validated draft. Serialized by a row lock on the
   * import (no double finalization) and on the dataset (version numbers), and refused unless the
   * validation run is complete, has no error rows and any warnings were acknowledged. The database
   * enforces the same rules (dataset_versions_status_chk).
   */
  async finalize(actor: ActorContext, importId: string, input: FinalizeImportCommand) {
    const versionId = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM data_imports WHERE id = ${importId}::uuid AND organization_id = ${actor.organizationId}::uuid FOR UPDATE`;
        const row = await tx.dataImport.findFirst({
          where: { id: importId, organizationId: actor.organizationId },
          include: { templateVersion: { select: { documentHash: true } } },
        });
        if (!row) throw AppError.notFound('Data import');
        if (row.status === 'FINALIZED') {
          throw new AppError(
            'DATASET_IMMUTABLE',
            'This import was already finalized; its dataset version is immutable.',
          );
        }
        this.assertRevision(row, input.expectedRevision);
        if (row.status === 'HAS_ERRORS') {
          throw new AppError(
            'DATASET_HAS_ERRORS',
            'The data has rows with errors. Correct the source file or mapping and validate again; rows are never dropped silently.',
          );
        }
        if (!canFinalizeImport(row.status)) {
          throw new AppError(
            'IMPORT_NOT_READY',
            `The import cannot be finalized while it is ${row.status}.`,
          );
        }
        if (row.templateVersion.documentHash !== row.templateVersionHash) {
          throw new AppError(
            'TEMPLATE_VERSION_CHANGED',
            'The template version was edited after this import was validated. Start a new import.',
          );
        }
        const draft = await tx.datasetVersion.findFirst({
          where: {
            importId: row.id,
            validationRun: row.validationRun,
            status: 'DRAFT',
            completedAt: { not: null },
          },
        });
        if (!draft)
          throw new AppError(
            'IMPORT_NOT_READY',
            'No complete validation result exists for this import.',
          );
        if (draft.errorCount > 0) {
          throw new AppError(
            'DATASET_HAS_ERRORS',
            'The data has rows with errors and cannot be finalized.',
          );
        }
        if (draft.warningCount > 0 && !input.acknowledgeWarnings) {
          throw new AppError(
            'WARNINGS_NOT_ACKNOWLEDGED',
            `This dataset contains ${draft.warningCount} rows with warnings. Confirm that you reviewed them to finalize.`,
            { warningCount: draft.warningCount },
          );
        }

        const dataset =
          input.dataset.mode === 'NEW'
            ? await this.datasets.createInTransaction(tx, actor, input.dataset)
            : await tx.dataset.findFirst({
                where: { id: input.dataset.datasetId, organizationId: actor.organizationId },
                select: { id: true, name: true },
              });
        if (!dataset) throw AppError.notFound('Dataset');
        const { latestVersionNumber } = await tx.dataset.update({
          where: { id: dataset.id },
          data: { latestVersionNumber: { increment: 1 }, updatedById: actor.userId },
          select: { latestVersionNumber: true },
        });
        const configuration = draft.importConfiguration as { normalizationVersion?: unknown };
        const datasetHash = await computeDatasetHash({
          templateVersionHash: draft.templateVersionHash,
          dataSchemaHash: draft.dataSchemaHash,
          mapping: asMapping(draft.mappingSnapshot),
          normalizationVersion: String(configuration.normalizationVersion),
          recordCount: draft.rowCount,
          recordsDigest: draft.recordsDigest!,
        });
        const now = new Date();
        await tx.datasetVersion.update({
          where: { id: draft.id },
          data: {
            status: 'FINALIZED',
            datasetId: dataset.id,
            versionNumber: latestVersionNumber,
            datasetHash,
            finalizedAt: now,
            finalizedById: actor.userId,
            warningsAcknowledgedAt: draft.warningCount > 0 ? now : null,
            mappingProfileId: row.mappingProfileId,
            mappingProfileRevision: row.mappingProfileRevision,
          },
        });
        await tx.dataImport.update({
          where: { id: row.id },
          data: { status: 'FINALIZED', finalizedAt: now, revision: { increment: 1 } },
        });
        await this.audit.recordForActor(tx, actor, {
          action: 'DATASET_VERSION_FINALIZED',
          resourceType: 'DATASET_VERSION',
          resourceId: draft.id,
          metadata: {
            datasetId: dataset.id,
            versionNumber: latestVersionNumber,
            importId: row.id,
            templateVersionId: draft.templateVersionId,
            templateVersionHash: draft.templateVersionHash,
            dataSchemaHash: draft.dataSchemaHash,
            sourceChecksumSha256: draft.sourceChecksumSha256,
            rowCount: draft.rowCount,
            validCount: draft.validCount,
            warningCount: draft.warningCount,
            errorCount: draft.errorCount,
            duplicateRowCount: draft.duplicateRowCount,
            datasetHash,
            datasetHashScheme: DATASET_HASH_SCHEME,
            mappingProfileId: row.mappingProfileId,
            mappingProfileRevision: row.mappingProfileRevision,
          },
        });
        return draft.id;
      },
      { timeout: 60_000 },
    );
    return this.datasets.getVersion(actor, versionId);
  }
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Clears a nullable JSON column (SQL NULL). */
const DB_NULL = Prisma.DbNull;
