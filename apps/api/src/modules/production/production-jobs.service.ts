import { Inject, Injectable } from '@nestjs/common';
import { computeDataSchemaHash } from '@smarttag/data-core';
import { Prisma } from '@smarttag/database';
import { parseDesignDocument, type DesignDocument } from '@smarttag/document-schema';
import {
  DEFAULT_PRODUCTION_CONFIGURATION,
  ProductionConfigurationSchema,
  canTransition,
  checkQuantityField,
  computeRecordSelectionHash,
  documentSystemFields,
  formatJobNumber,
  isProcessing,
  isReleased,
  jobNumberDayFor,
  type ProductionConfiguration,
} from '@smarttag/production-core';
import type {
  ConfigureProductionJobRequest,
  CreateProductionJobCommand,
  ListProductionJobsQuery,
  PaginatedResponse,
  ProductionJobDto,
  ProductionJobSummaryDto,
  ReleaseProductionJobCommand,
} from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { APP_CONFIG, type AppConfig } from '../../config/env.schema';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProductionQueueService } from './production-queue.service';
import {
  jobSummarySelect,
  toJobEventDto,
  toJobSummary,
  toReservationDto,
  toSerialPreview,
  toValidationSummary,
} from './production.mappers';
import { SequencesService } from './sequences.service';

const jobDetailInclude = {
  customer: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
  template: { select: { id: true, code: true, name: true } },
  templateVersion: {
    select: {
      id: true,
      templateId: true,
      versionNumber: true,
      status: true,
      documentHash: true,
      documentJson: true,
      schemaVersion: true,
      template: { select: { code: true, name: true } },
    },
  },
  dataset: { select: { id: true, name: true } },
  datasetVersion: {
    select: {
      id: true,
      versionNumber: true,
      datasetHash: true,
      rowCount: true,
      warningCount: true,
      status: true,
    },
  },
  sequence: {
    select: { id: true, code: true, prefix: true, suffix: true, padding: true, nextValue: true },
  },
  reservation: {
    include: { sequence: true, reservedBy: { select: { id: true, displayName: true } } },
  },
  createdBy: { select: { id: true, displayName: true } },
  releasedBy: { select: { id: true, displayName: true } },
  warningsAcknowledgedBy: { select: { id: true, displayName: true } },
  artifacts: true,
  events: {
    include: { createdBy: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  },
} as const satisfies Prisma.ProductionJobInclude;

type JobDetailRow = Prisma.ProductionJobGetPayload<{ include: typeof jobDetailInclude }>;

/**
 * Production jobs: an approved template version plus a finalized dataset version, expanded into an
 * exact, ordered, hashed set of tags (docs/production-jobs.md).
 *
 * The service owns the decisions that must never be made in the browser: which inputs are allowed,
 * what a job may do in its current state, when serial numbers are committed, and what makes a job
 * immutable.
 */
@Injectable()
export class ProductionJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: ProductionQueueService,
    private readonly sequences: SequencesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(
    actor: ActorContext,
    query: ListProductionJobsQuery,
  ): Promise<PaginatedResponse<ProductionJobSummaryDto>> {
    const statuses = query.status
      ?.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const where: Prisma.ProductionJobWhereInput = {
      organizationId: actor.organizationId,
      ...(statuses && statuses.length > 0
        ? { status: { in: statuses as Prisma.ProductionJobWhereInput['status'] as never } }
        : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.templateId ? { templateId: query.templateId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { jobNumber: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: new Date(`${query.createdFrom}T00:00:00.000Z`) } : {}),
              ...(query.createdTo ? { lt: nextDay(query.createdTo) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.productionJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: jobSummarySelect,
      }),
      this.prisma.productionJob.count({ where }),
    ]);
    return {
      items: items.map(toJobSummary),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async get(actor: ActorContext, jobId: string): Promise<ProductionJobDto> {
    return this.toDto(actor, await this.load(actor, jobId));
  }

  /**
   * Creates a DRAFT job for one exact template version and one exact dataset version. Everything
   * that identifies production — the versions, their hashes, the schema they share — is captured
   * now and can never change afterwards.
   */
  async create(actor: ActorContext, input: CreateProductionJobCommand): Promise<ProductionJobDto> {
    const version = await this.prisma.templateVersion.findFirst({
      where: { id: input.templateVersionId, organizationId: actor.organizationId },
      select: {
        id: true,
        templateId: true,
        status: true,
        documentHash: true,
        documentJson: true,
        schemaVersion: true,
        template: { select: { id: true, customerId: true, brandId: true } },
      },
    });
    if (!version) throw AppError.notFound('Template version');

    const production = input.productionMode === 'PRODUCTION';
    if (production && version.status !== 'APPROVED') {
      throw new AppError(
        'TEMPLATE_NOT_APPROVED',
        `Production runs on approved artwork only; this version is ${version.status}. Approve it, or create a non-production job to try the workflow.`,
      );
    }
    if (!production && version.status === 'RETIRED') {
      throw new AppError('TEMPLATE_NOT_APPROVED', 'This template version is retired.');
    }

    const document = this.documentOf(version.documentJson);
    const dataSchemaHash = await computeDataSchemaHash(document.dataSchema);

    const datasetVersion = await this.prisma.datasetVersion.findFirst({
      where: { id: input.datasetVersionId, organizationId: actor.organizationId },
      select: {
        id: true,
        status: true,
        datasetId: true,
        datasetHash: true,
        dataSchemaHash: true,
        rowCount: true,
        dataset: { select: { id: true, customerId: true } },
      },
    });
    if (!datasetVersion) throw AppError.notFound('Dataset version');
    const { datasetId, datasetHash } = datasetVersion;
    if (datasetVersion.status !== 'FINALIZED' || !datasetId || !datasetHash) {
      throw new AppError(
        'DATASET_NOT_FINALIZED',
        'Production uses finalized dataset versions only. Finalize the import first.',
      );
    }
    if (datasetVersion.dataSchemaHash !== dataSchemaHash) {
      throw new AppError(
        'TEMPLATE_DATASET_SCHEMA_MISMATCH',
        'This dataset was validated against a different data schema than this template version defines. Import the data again for this template version.',
        {
          datasetDataSchemaHash: datasetVersion.dataSchemaHash,
          templateDataSchemaHash: dataSchemaHash,
        },
      );
    }
    if (datasetVersion.rowCount < 1) {
      throw new AppError('DATASET_NOT_FINALIZED', 'This dataset version has no records.');
    }

    const customerId = await this.resolveCustomer(actor, input, version, datasetVersion);
    if (input.brandId) await this.assertBrand(actor, input.brandId, customerId);

    const job = await this.prisma.$transaction(async (tx) => {
      const jobNumber = await this.nextJobNumber(tx, actor.organizationId);
      const created = await tx.productionJob.create({
        data: {
          organizationId: actor.organizationId,
          jobNumber,
          name: input.name,
          description: input.description,
          customerId,
          brandId: input.brandId,
          templateId: version.templateId,
          templateVersionId: version.id,
          templateVersionHash: version.documentHash,
          templateSchemaVersion: version.schemaVersion,
          dataSchemaHash,
          datasetId,
          datasetVersionId: datasetVersion.id,
          datasetHash,
          productionMode: input.productionMode,
          configuration: DEFAULT_PRODUCTION_CONFIGURATION,
          createdById: actor.userId,
        },
        select: { id: true, jobNumber: true },
      });
      await tx.productionJobEvent.create({
        data: {
          organizationId: actor.organizationId,
          productionJobId: created.id,
          type: 'CREATED',
          message: `Created for template version ${version.id} and dataset version ${datasetVersion.id}`,
          createdById: actor.userId,
        },
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'PRODUCTION_JOB_CREATED',
        resourceType: 'PRODUCTION_JOB',
        resourceId: created.id,
        metadata: {
          jobNumber: created.jobNumber,
          templateVersionId: version.id,
          templateVersionHash: version.documentHash,
          datasetVersionId: datasetVersion.id,
          datasetHash,
          productionMode: input.productionMode,
        },
      });
      return created;
    });

    return this.get(actor, job.id);
  }

  /**
   * Changes the configuration of a job that is not released. Any change that would produce
   * different tags also throws the expanded instances away, so a job's counts always belong to its
   * current configuration.
   */
  async configure(
    actor: ActorContext,
    jobId: string,
    input: ConfigureProductionJobRequest,
  ): Promise<ProductionJobDto> {
    const row = await this.load(actor, jobId);
    this.assertMutable(row, input.expectedRevision);
    const document = this.documentOf(row.templateVersion.documentJson);
    const current = this.configurationOf(row.configuration);

    const next: ProductionConfiguration = {
      ...current,
      ...(input.quantity ? { quantity: input.quantity } : {}),
      ...(input.serial ? { serial: input.serial } : {}),
      ...(input.recordSelection ? { recordSelection: input.recordSelection } : {}),
      ...(input.warningPolicy ? { warningPolicy: input.warningPolicy } : {}),
    };

    if (next.quantity.mode === 'FIELD') {
      const check = checkQuantityField(document.dataSchema, next.quantity.field);
      if (!check.ok) throw new AppError('INVALID_QUANTITY_FIELD', check.message);
    }
    if (next.recordSelection.mode === 'SEQUENCES') {
      const limit = this.config.production.limits.maxSelectedRecords;
      if (next.recordSelection.sequences.length > limit) {
        throw new AppError(
          'INVALID_PRODUCTION_CONFIGURATION',
          `At most ${limit.toLocaleString('en-US')} records can be selected explicitly.`,
        );
      }
      const known = await this.prisma.datasetRecord.count({
        where: {
          datasetVersionId: row.datasetVersionId,
          sequence: { in: next.recordSelection.sequences },
        },
      });
      if (known !== new Set(next.recordSelection.sequences).size) {
        throw new AppError(
          'INVALID_PRODUCTION_CONFIGURATION',
          'The selection names records that are not in this dataset version.',
        );
      }
    }
    if (next.serial.enabled) {
      const sequence = await this.prisma.sequence.findFirst({
        where: { id: next.serial.sequenceId, organizationId: actor.organizationId },
        select: { id: true, status: true, code: true },
      });
      if (!sequence) throw AppError.notFound('Sequence');
      if (sequence.status !== 'ACTIVE') {
        throw new AppError('SEQUENCE_INACTIVE', `Sequence ${sequence.code} is archived.`);
      }
    }
    if (input.brandId !== undefined && input.brandId !== null) {
      await this.assertBrand(actor, input.brandId, input.customerId ?? row.customerId);
    }

    const parsed = ProductionConfigurationSchema.parse(next);
    const changed = JSON.stringify(parsed) !== JSON.stringify(current);
    const selectionHash =
      parsed.recordSelection.mode === 'SEQUENCES'
        ? await computeRecordSelectionHash(parsed.recordSelection.sequences)
        : null;

    const updated = await this.prisma.productionJob.updateMany({
      where: { id: row.id, organizationId: actor.organizationId, revision: input.expectedRevision },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.customerId === undefined ? {} : { customerId: input.customerId }),
        ...(input.brandId === undefined ? {} : { brandId: input.brandId }),
        configuration: parsed,
        recordSelectionHash: selectionHash,
        sequenceId: parsed.serial.enabled ? parsed.serial.sequenceId : null,
        revision: { increment: 1 },
        ...(changed
          ? {
              // The expanded tags belonged to the old configuration; they are not the job's result
              // any more. Nothing is silently kept.
              status: 'DRAFT',
              instanceCount: 0,
              validCount: 0,
              warningCount: 0,
              errorCount: 0,
              sourceWarningCount: 0,
              recordCount: 0,
              validationSummary: {},
              expandedAt: null,
              failure: Prisma.DbNull,
            }
          : {}),
      },
    });
    if (updated.count === 0) throw this.staleRevision();
    if (changed) {
      await this.prisma.productionInstance.deleteMany({ where: { productionJobId: row.id } });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productionJobEvent.create({
        data: {
          organizationId: actor.organizationId,
          productionJobId: row.id,
          type: 'CONFIGURED',
          message: changed
            ? 'Configuration changed; expansion is required again'
            : 'Details updated',
          metadata: { quantity: parsed.quantity.mode, serial: parsed.serial.enabled } as never,
          createdById: actor.userId,
        },
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'PRODUCTION_JOB_CONFIGURED',
        resourceType: 'PRODUCTION_JOB',
        resourceId: row.id,
        metadata: {
          jobNumber: row.jobNumber,
          quantityMode: parsed.quantity.mode,
          serials: parsed.serial.enabled,
          recordSelection: parsed.recordSelection.mode,
          instancesDiscarded: changed,
        },
      });
    });
    return this.get(actor, row.id);
  }

  /** Queues expansion and validation of the job in the worker. */
  async validate(
    actor: ActorContext,
    jobId: string,
    expectedRevision: number,
  ): Promise<ProductionJobDto> {
    this.queue.assertAvailable();
    const row = await this.load(actor, jobId);
    this.assertMutable(row, expectedRevision);
    const configuration = this.configurationOf(row.configuration);
    if (configuration.serial.enabled && !row.sequenceId) {
      throw new AppError(
        'INVALID_PRODUCTION_CONFIGURATION',
        'The job uses serial numbers but no sequence is configured.',
      );
    }

    const updated = await this.prisma.productionJob.updateMany({
      where: { id: row.id, organizationId: actor.organizationId, revision: expectedRevision },
      data: {
        status: 'QUEUED',
        expansionRun: { increment: 1 },
        revision: { increment: 1 },
        progressPhase: 'QUEUED',
        progressProcessed: 0,
        progressTotal: null,
        progressUpdatedAt: new Date(),
        failure: Prisma.DbNull,
      },
    });
    if (updated.count === 0) throw this.staleRevision();
    const queued = await this.prisma.productionJob.findFirstOrThrow({
      where: { id: row.id },
      select: { expansionRun: true },
    });
    await this.audit.recordForActor(this.prisma, actor, {
      action: 'PRODUCTION_JOB_VALIDATION_REQUESTED',
      resourceType: 'PRODUCTION_JOB',
      resourceId: row.id,
      metadata: { jobNumber: row.jobNumber, expansionRun: queued.expansionRun },
    });
    await this.queue.enqueueExpansion(actor, row.id, queued.expansionRun);
    return this.get(actor, row.id);
  }

  /**
   * Releases a job: the inputs are checked once more, the serial range is committed, and the job
   * becomes immutable. Everything that must happen together happens in one transaction; the tags
   * themselves are finished by the release job in the worker.
   */
  async release(
    actor: ActorContext,
    jobId: string,
    input: ReleaseProductionJobCommand,
  ): Promise<ProductionJobDto> {
    this.queue.assertAvailable();
    const releaseRun = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${jobId}::uuid AND organization_id = ${actor.organizationId}::uuid FOR UPDATE`;
      const row = await tx.productionJob.findFirst({
        where: { id: jobId, organizationId: actor.organizationId },
        include: {
          templateVersion: { select: { status: true, documentHash: true } },
          datasetVersion: { select: { status: true, datasetHash: true } },
        },
      });
      if (!row) throw AppError.notFound('Production job');
      if (isReleased(row.status)) {
        throw new AppError(
          'PRODUCTION_JOB_IMMUTABLE',
          'This job was already released; released production never changes.',
        );
      }
      if (row.revision !== input.expectedRevision) throw this.staleRevision();
      if (row.status === 'HAS_ERRORS' || row.errorCount > 0) {
        throw new AppError(
          'PRODUCTION_JOB_HAS_ERRORS',
          `${row.errorCount.toLocaleString('en-US')} tags have errors. Fix the data or the template and validate again; tags are never dropped to make a job releasable.`,
          { errorCount: row.errorCount },
        );
      }
      if (!canTransition(row.status, 'RELEASED')) {
        throw new AppError(
          'PRODUCTION_JOB_NOT_READY',
          `A job cannot be released while it is ${row.status}.`,
        );
      }
      if (row.instanceCount < 1) {
        throw new AppError('PRODUCTION_JOB_NOT_READY', 'This job has no tags to produce.');
      }
      const configuration = this.configurationOf(row.configuration);
      if (
        row.warningCount > 0 &&
        configuration.warningPolicy === 'ACKNOWLEDGE' &&
        !input.acknowledgeWarnings
      ) {
        throw new AppError(
          'PRODUCTION_WARNINGS_NOT_ACKNOWLEDGED',
          `This job contains ${row.warningCount.toLocaleString('en-US')} tags with warnings and no blocking errors. Confirm that you reviewed them to release.`,
          { warningCount: row.warningCount },
        );
      }
      if (row.templateVersion.documentHash !== row.templateVersionHash) {
        throw new AppError(
          'PRODUCTION_JOB_IMMUTABLE',
          'The template version changed after this job was validated. Create a new job for the current artwork.',
        );
      }
      if (row.productionMode === 'PRODUCTION' && row.templateVersion.status !== 'APPROVED') {
        throw new AppError(
          'TEMPLATE_NOT_APPROVED',
          `The template version is ${row.templateVersion.status}; production runs on approved artwork only.`,
        );
      }
      if (
        row.datasetVersion.status !== 'FINALIZED' ||
        row.datasetVersion.datasetHash !== row.datasetHash
      ) {
        throw new AppError(
          'DATASET_NOT_FINALIZED',
          'The dataset version changed after this job was validated.',
        );
      }

      // The serial range is committed here and never given back: a gap is always safer than a
      // number printed twice.
      if (configuration.serial.enabled) {
        await this.sequences.reserveRange(
          tx,
          actor,
          configuration.serial.sequenceId,
          row.id,
          row.instanceCount,
        );
      }

      const updated = await tx.productionJob.updateMany({
        where: { id: row.id, revision: input.expectedRevision },
        data: {
          status: 'RELEASED',
          releasedById: actor.userId,
          releasedAt: new Date(),
          releaseRun: { increment: 1 },
          revision: { increment: 1 },
          progressPhase: 'RELEASING',
          progressProcessed: 0,
          progressTotal: row.instanceCount,
          progressUpdatedAt: new Date(),
          failure: Prisma.DbNull,
          ...(row.warningCount > 0 && input.acknowledgeWarnings
            ? { warningsAcknowledgedAt: new Date(), warningsAcknowledgedById: actor.userId }
            : {}),
        },
      });
      if (updated.count === 0) throw this.staleRevision();

      await tx.productionJobEvent.create({
        data: {
          organizationId: actor.organizationId,
          productionJobId: row.id,
          type: 'RELEASED',
          message: `${row.instanceCount.toLocaleString('en-US')} tags released for production`,
          metadata: { instances: row.instanceCount, warnings: row.warningCount } as never,
          createdById: actor.userId,
        },
      });
      if (row.warningCount > 0 && input.acknowledgeWarnings) {
        await this.audit.recordForActor(tx, actor, {
          action: 'PRODUCTION_JOB_WARNINGS_ACKNOWLEDGED',
          resourceType: 'PRODUCTION_JOB',
          resourceId: row.id,
          metadata: { jobNumber: row.jobNumber, warningCount: row.warningCount },
        });
      }
      await this.audit.recordForActor(tx, actor, {
        action: 'PRODUCTION_JOB_RELEASED',
        resourceType: 'PRODUCTION_JOB',
        resourceId: row.id,
        metadata: {
          jobNumber: row.jobNumber,
          instances: row.instanceCount,
          templateVersionHash: row.templateVersionHash,
          datasetHash: row.datasetHash,
          serials: configuration.serial.enabled,
        },
      });
      return row.releaseRun + 1;
    });

    await this.queue.enqueueRelease(actor, jobId, releaseRun);
    return this.get(actor, jobId);
  }

  /** Re-queues the work of a job that failed, without changing anything about its inputs. */
  async retry(
    actor: ActorContext,
    jobId: string,
    expectedRevision: number,
  ): Promise<ProductionJobDto> {
    this.queue.assertAvailable();
    const row = await this.load(actor, jobId);
    if (row.revision !== expectedRevision) throw this.staleRevision();
    if (row.status === 'RELEASED') {
      // The release work (serials, hashes, manifest) is idempotent; the reserved range is reused.
      await this.queue.enqueueRelease(actor, row.id, row.releaseRun);
      return this.get(actor, row.id);
    }
    if (row.status !== 'FAILED') {
      throw new AppError(
        'PRODUCTION_JOB_NOT_READY',
        `A job that is ${row.status} cannot be retried.`,
      );
    }
    if (row.releasedAt) {
      const updated = await this.prisma.productionJob.updateMany({
        where: { id: row.id, revision: expectedRevision, status: 'FAILED' },
        data: { status: 'RELEASED', revision: { increment: 1 }, failure: Prisma.DbNull },
      });
      if (updated.count === 0) throw this.staleRevision();
      await this.queue.enqueueRelease(actor, row.id, row.releaseRun);
      return this.get(actor, row.id);
    }
    return this.validate(actor, jobId, expectedRevision);
  }

  /** Cancels a job that has not been released; its tags are removed. */
  async cancel(
    actor: ActorContext,
    jobId: string,
    expectedRevision: number,
  ): Promise<ProductionJobDto> {
    const row = await this.load(actor, jobId);
    if (isReleased(row.status)) {
      throw new AppError(
        'PRODUCTION_JOB_IMMUTABLE',
        'A released job cannot be cancelled; its serial numbers are committed.',
      );
    }
    if (row.status === 'CANCELLED') return this.toDto(actor, row);
    if (row.revision !== expectedRevision) throw this.staleRevision();

    const updated = await this.prisma.productionJob.updateMany({
      where: { id: row.id, organizationId: actor.organizationId, revision: expectedRevision },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: actor.userId,
        revision: { increment: 1 },
        progressPhase: null,
        progressUpdatedAt: new Date(),
      },
    });
    if (updated.count === 0) throw this.staleRevision();
    await this.prisma.productionInstance.deleteMany({ where: { productionJobId: row.id } });
    await this.prisma.$transaction(async (tx) => {
      await tx.productionJobEvent.create({
        data: {
          organizationId: actor.organizationId,
          productionJobId: row.id,
          type: 'CANCELLED',
          message: 'Cancelled',
          createdById: actor.userId,
        },
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'PRODUCTION_JOB_CANCELLED',
        resourceType: 'PRODUCTION_JOB',
        resourceId: row.id,
        metadata: { jobNumber: row.jobNumber, status: row.status },
      });
    });
    return this.get(actor, row.id);
  }

  // ---------------------------------------------------------------------------------------------

  async load(actor: ActorContext, jobId: string): Promise<JobDetailRow> {
    const row = await this.prisma.productionJob.findFirst({
      where: { id: jobId, organizationId: actor.organizationId },
      include: jobDetailInclude,
    });
    if (!row) throw AppError.notFound('Production job');
    return row;
  }

  private toDto(actor: ActorContext, row: JobDetailRow): ProductionJobDto {
    const configuration = this.configurationOf(row.configuration);
    const document = this.documentOf(row.templateVersion.documentJson);
    const summary = toJobSummary({
      ...row,
      templateVersion: row.templateVersion,
      datasetVersion: { versionNumber: row.datasetVersion.versionNumber },
    } as never);
    const manifest = row.artifacts.find((artifact) => artifact.kind === 'MANIFEST');
    const mutable =
      !isReleased(row.status) && !isProcessing(row.status) && row.status !== 'CANCELLED';

    return {
      ...summary,
      description: row.description,
      brand: row.brand ? { id: row.brand.id, name: row.brand.name } : null,
      revision: row.revision,
      template: { id: row.template.id, code: row.template.code, name: row.template.name },
      templateVersionHash: row.templateVersionHash,
      templateSchemaVersion: row.templateSchemaVersion,
      dataSchemaHash: row.dataSchemaHash,
      datasetVersion: {
        id: row.datasetVersion.id,
        versionNumber: row.datasetVersion.versionNumber ?? 0,
        datasetHash: row.datasetVersion.datasetHash ?? '',
        rowCount: row.datasetVersion.rowCount,
        warningCount: row.datasetVersion.warningCount,
      },
      configuration,
      recordSelectionHash: row.recordSelectionHash,
      quantityFields: quantityFieldChoices(document.dataSchema.fields),
      systemFields: documentSystemFields(document),
      serialPreview:
        row.sequence && row.instanceCount > 0 && !row.reservation
          ? toSerialPreview(row.sequence, row.instanceCount, this.sequences.previewCount)
          : null,
      reservation: row.reservation ? toReservationDto(row.reservation) : null,
      instancesDigest: row.instancesDigest,
      productionJobHash: row.productionJobHash,
      versions: (row.versions ?? {}) as Record<string, string>,
      validation: toValidationSummary(row.validationSummary),
      progress: {
        phase: row.progressPhase,
        processed: row.progressProcessed,
        total: row.progressTotal,
        updatedAt: row.progressUpdatedAt?.toISOString() ?? null,
      },
      failure: row.failure ? (row.failure as unknown as { code: string; message: string }) : null,
      manifest: manifest
        ? {
            checksumSha256: manifest.checksumSha256,
            sizeBytes: manifest.sizeBytes,
            createdAt: manifest.createdAt.toISOString(),
            downloadPath: `/production-jobs/${row.id}/manifest/download`,
          }
        : null,
      warningsAcknowledgedAt: row.warningsAcknowledgedAt?.toISOString() ?? null,
      warningsAcknowledgedBy: row.warningsAcknowledgedBy ?? null,
      expandedAt: row.expandedAt?.toISOString() ?? null,
      readyForRenderingAt: row.readyForRenderingAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      events: row.events.map(toJobEventDto),
      actions: {
        configure: mutable && actor.permissions.has('production-job:configure'),
        validate: mutable && actor.permissions.has('production-job:validate'),
        release:
          canTransition(row.status, 'RELEASED') &&
          row.errorCount === 0 &&
          row.instanceCount > 0 &&
          actor.permissions.has('production-job:release'),
        cancel:
          !isReleased(row.status) &&
          row.status !== 'CANCELLED' &&
          actor.permissions.has('production-job:cancel'),
      },
    };
  }

  private assertMutable(row: JobDetailRow, expectedRevision: number): void {
    if (isReleased(row.status)) {
      throw new AppError(
        'PRODUCTION_JOB_IMMUTABLE',
        'This job is released; its inputs, configuration and tags are final.',
      );
    }
    if (row.status === 'CANCELLED') {
      throw new AppError('PRODUCTION_JOB_IMMUTABLE', 'This job was cancelled.');
    }
    if (isProcessing(row.status)) {
      throw new AppError(
        'PRODUCTION_JOB_NOT_READY',
        `The job is ${row.status}; wait for it to finish.`,
      );
    }
    if (row.revision !== expectedRevision) throw this.staleRevision();
  }

  private staleRevision(): AppError {
    return new AppError(
      'CONFLICT',
      'This production job was changed by someone else. Reload and try again.',
    );
  }

  private configurationOf(value: unknown): ProductionConfiguration {
    const parsed = ProductionConfigurationSchema.safeParse(value);
    if (!parsed.success) {
      throw new AppError(
        'INVALID_PRODUCTION_CONFIGURATION',
        'The production configuration of this job is not valid.',
      );
    }
    return parsed.data;
  }

  private documentOf(documentJson: unknown): DesignDocument {
    const parsed = parseDesignDocument(documentJson);
    if (!parsed.valid) throw AppError.invalidDocument(parsed.errors);
    return parsed.document;
  }

  /** The customer a job belongs to; a template and a dataset of different customers never mix. */
  private async resolveCustomer(
    actor: ActorContext,
    input: CreateProductionJobCommand,
    version: { template: { customerId: string | null } },
    datasetVersion: { dataset: { customerId: string | null } | null },
  ): Promise<string | null> {
    const templateCustomer = version.template.customerId;
    const datasetCustomer = datasetVersion.dataset?.customerId ?? null;
    if (templateCustomer && datasetCustomer && templateCustomer !== datasetCustomer) {
      throw new AppError(
        'CUSTOMER_MISMATCH',
        'The template and the dataset belong to different customers.',
      );
    }
    const inherited = templateCustomer ?? datasetCustomer;
    const chosen = input.customerId ?? inherited;
    if (!chosen) return null;
    if (inherited && chosen !== inherited) {
      throw new AppError(
        'CUSTOMER_MISMATCH',
        'The chosen customer is not the customer of this template and dataset.',
      );
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: chosen, organizationId: actor.organizationId },
      select: { id: true },
    });
    if (!customer) throw AppError.notFound('Customer');
    return customer.id;
  }

  private async assertBrand(
    actor: ActorContext,
    brandId: string,
    customerId: string | null,
  ): Promise<void> {
    const brand = await this.prisma.brand.findFirst({
      where: { id: brandId, organizationId: actor.organizationId },
      select: { id: true, customerId: true },
    });
    if (!brand) throw AppError.notFound('Brand');
    if (customerId && brand.customerId !== customerId) {
      throw new AppError('CUSTOMER_MISMATCH', 'The brand belongs to a different customer.');
    }
  }

  /** Allocates the next human-readable job number for the organization and the current day. */
  private async nextJobNumber(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<string> {
    const day = jobNumberDayFor(new Date());
    const counter = await tx.$queryRaw<{ next_value: number }[]>`
      INSERT INTO production_job_counters (organization_id, day, next_value, updated_at)
      VALUES (${organizationId}::uuid, ${day}, 2, now())
      ON CONFLICT (organization_id, day)
      DO UPDATE SET next_value = production_job_counters.next_value + 1, updated_at = now()
      RETURNING next_value`;
    const next = counter[0]?.next_value ?? 2;
    return formatJobNumber(day, next - 1);
  }
}

/**
 * Fields that could hold a number of tags, most likely first: a field that is named like a
 * quantity, then whole-number fields, then the rest. The value still decides per record.
 */
function quantityFieldChoices(
  fields: readonly { key: string; displayName: string; type: string }[],
): { key: string; displayName: string }[] {
  const rank = (field: { key: string; type: string }) => {
    if (/quantity|qty|pieces|pcs/i.test(field.key)) return 0;
    return field.type === 'number' ? 1 : field.type === 'decimal' ? 2 : 3;
  };
  return fields
    .filter((field) => ['number', 'decimal', 'string'].includes(field.type))
    .map((field) => ({ field, rank: rank(field) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ field }) => ({ key: field.key, displayName: field.displayName }));
}

function nextDay(date: string): Date {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value;
}
