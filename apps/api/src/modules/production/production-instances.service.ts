import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@smarttag/database';
import {
  manifestJobHashPayload,
  serializeManifest,
  verifyProductionManifest,
  type ProductionManifest,
} from '@smarttag/production-core';
import { sha256Hex } from '@smarttag/document-utils';
import type {
  ListProductionInstancesQuery,
  ProductionInstanceDetailDto,
  ProductionInstancePageDto,
  ProductionSampleDto,
} from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import type { ObjectStorage } from '@smarttag/object-storage';
import { OBJECT_STORAGE } from '../assets/storage/storage.module';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { instanceSelect, issuesOf, toInstanceDto } from './production.mappers';

/** Reading the tags of a production job, and the manifest that describes them. */
@Injectable()
export class ProductionInstancesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
  ) {}

  /**
   * A page of tags in production order. Large jobs are paged by sequence (keyset paging), so the
   * last page of a million-tag job costs the same as the first.
   */
  async list(
    actor: ActorContext,
    jobId: string,
    query: ListProductionInstancesQuery,
  ): Promise<ProductionInstancePageDto> {
    const job = await this.jobOf(actor, jobId);
    const where: Prisma.ProductionInstanceWhereInput = {
      productionJobId: job.id,
      organizationId: actor.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.afterSequence ? { sequence: { gt: query.afterSequence } } : {}),
      ...(query.search ? searchFilter(query.search) : {}),
    };
    // Counting a filtered set means scanning it; an unfiltered job already knows its size, and a
    // million-tag job should not pay for a COUNT on every page.
    const filtered = Boolean(query.status ?? query.search);
    const [items, total] = await Promise.all([
      this.prisma.productionInstance.findMany({
        where,
        orderBy: { sequence: 'asc' },
        // Keyset paging when a cursor is given; page numbers stay available for small jobs.
        ...(query.afterSequence ? {} : { skip: (query.page - 1) * query.pageSize }),
        take: query.pageSize,
        select: instanceSelect,
      }),
      filtered
        ? this.prisma.productionInstance.count({
            where: { ...where, sequence: undefined },
          })
        : Promise.resolve(job.instanceCount),
    ]);
    const last = items.at(-1);
    return {
      items: items.map(toInstanceDto),
      total,
      page: query.page,
      pageSize: query.pageSize,
      nextCursor: items.length === query.pageSize && last ? last.sequence : null,
    };
  }

  /** One tag with its issues, the record it prints and its production context. */
  async get(
    actor: ActorContext,
    jobId: string,
    sequence: number,
  ): Promise<ProductionInstanceDetailDto> {
    const job = await this.jobOf(actor, jobId);
    const instance = await this.prisma.productionInstance.findFirst({
      where: { productionJobId: job.id, organizationId: actor.organizationId, sequence },
      select: { ...instanceSelect, issues: true },
    });
    if (!instance) throw AppError.notFound('Production instance');
    const record = await this.prisma.datasetRecord.findFirst({
      where: {
        datasetVersionId: job.datasetVersionId,
        sequence: instance.datasetRecordSequence,
      },
      select: { normalizedRecord: true, recordHash: true, issues: true },
    });
    const [previous, next] = await Promise.all([
      this.prisma.productionInstance.findFirst({
        where: { productionJobId: job.id, sequence: { lt: sequence } },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      }),
      this.prisma.productionInstance.findFirst({
        where: { productionJobId: job.id, sequence: { gt: sequence } },
        orderBy: { sequence: 'asc' },
        select: { sequence: true },
      }),
    ]);
    return {
      ...toInstanceDto(instance),
      issues: issuesOf(instance.issues),
      record: (record?.normalizedRecord ?? {}) as Record<string, unknown>,
      recordIssues: issuesOf(record?.issues),
      recordHash: record?.recordHash ?? '',
      context: {
        serial: instance.serialValue,
        instanceIndex: instance.sequence,
        copyIndex: instance.copyIndex,
        sourceRow: instance.sourceRowNumber,
        jobNumber: job.jobNumber,
      },
      previousSequence: previous?.sequence ?? null,
      nextSequence: next?.sequence ?? null,
    };
  }

  /**
   * A handful of tags worth looking at before releasing: the first, the last, the first copy of a
   * few records, and tags with warnings. This is a sample, never a complete layout preflight.
   */
  async samples(actor: ActorContext, jobId: string): Promise<ProductionSampleDto[]> {
    const job = await this.jobOf(actor, jobId);
    const samples: ProductionSampleDto[] = [];
    const add = (label: string, reason: string, sequence: number | undefined) => {
      if (sequence === undefined) return;
      if (samples.some((sample) => sample.sequence === sequence)) return;
      samples.push({ label, reason, sequence });
    };

    const [first, last, warning, secondRecord] = await Promise.all([
      this.prisma.productionInstance.findFirst({
        where: { productionJobId: job.id },
        orderBy: { sequence: 'asc' },
        select: { sequence: true },
      }),
      this.prisma.productionInstance.findFirst({
        where: { productionJobId: job.id },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      }),
      this.prisma.productionInstance.findFirst({
        where: { productionJobId: job.id, status: 'WARNING' },
        orderBy: { sequence: 'asc' },
        select: { sequence: true },
      }),
      this.prisma.productionInstance.findFirst({
        where: { productionJobId: job.id, copyIndex: 1, datasetRecordSequence: { gt: 1 } },
        orderBy: { sequence: 'asc' },
        select: { sequence: true },
      }),
    ]);
    add('First tag', 'The first tag of the job', first?.sequence);
    add('Second record', 'The first tag of another data record', secondRecord?.sequence);
    add('With warnings', 'A tag that carries warnings', warning?.sequence);
    add('Last tag', 'The last tag of the job (the highest serial number)', last?.sequence);
    return samples;
  }

  /** The stored manifest of a released job, verified against what the job records. */
  async manifest(actor: ActorContext, jobId: string) {
    const job = await this.prisma.productionJob.findFirst({
      where: { id: jobId, organizationId: actor.organizationId },
      include: {
        artifacts: { where: { kind: 'MANIFEST' } },
        reservation: { include: { sequence: { select: { code: true } } } },
      },
    });
    if (!job) throw AppError.notFound('Production job');
    const artifact = job.artifacts[0];
    if (!artifact) {
      throw new AppError(
        'PRODUCTION_MANIFEST_NOT_READY',
        'This job has no manifest yet. It is written when the release finishes.',
      );
    }
    const object = await this.storage.getObject(artifact.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of object.body as AsyncIterable<Buffer>) chunks.push(chunk);
    const stored = Buffer.concat(chunks).toString('utf8');
    const manifest = JSON.parse(stored) as ProductionManifest;
    const actualChecksum = await sha256Hex(stored);
    const issues = verifyProductionManifest(manifest, stored, {
      checksumSha256: artifact.checksumSha256,
      actualChecksumSha256: actualChecksum,
      productionJobHash: job.productionJobHash ?? '',
      instanceCount: job.instanceCount,
      instancesDigest: job.instancesDigest ?? '',
      serialReservation: job.reservation
        ? {
            sequenceCode: job.reservation.sequence.code,
            startValue: Number(job.reservation.startValue),
            endValue: Number(job.reservation.endValue),
          }
        : null,
    });
    // The job hash in the manifest must be the hash of the inputs the manifest itself lists.
    const recomputed = await sha256Hex(manifestJobHashPayload(manifest));
    const verified =
      issues.length === 0 && recomputed === manifest.productionJobHash
        ? { valid: true as const, issues: [] }
        : {
            valid: false as const,
            issues:
              recomputed === manifest.productionJobHash
                ? issues
                : [
                    ...issues,
                    {
                      code: 'JOB_HASH_MISMATCH' as const,
                      message: 'The job hash in the manifest is not the hash of its own inputs.',
                    },
                  ],
          };
    return { artifact, manifest, stored, verified, checksum: actualChecksum, job };
  }

  /** Records that someone downloaded a manifest (the file itself is served by the controller). */
  async recordManifestDownload(
    actor: ActorContext,
    job: { id: string; jobNumber: string },
    checksum: string,
  ): Promise<void> {
    await this.audit.recordForActor(this.prisma, actor, {
      action: 'PRODUCTION_MANIFEST_DOWNLOADED',
      resourceType: 'PRODUCTION_ARTIFACT',
      resourceId: job.id,
      metadata: { jobNumber: job.jobNumber, checksumSha256: checksum },
    });
  }

  private async jobOf(actor: ActorContext, jobId: string) {
    const job = await this.prisma.productionJob.findFirst({
      where: { id: jobId, organizationId: actor.organizationId },
      select: { id: true, jobNumber: true, datasetVersionId: true, instanceCount: true },
    });
    if (!job) throw AppError.notFound('Production job');
    return job;
  }
}

/**
 * Searching tags: a serial number (or the beginning of one), a source row or a dataset record.
 * The serial part is a prefix match, so it uses the serial index instead of reading every tag of
 * the job — the difference between a moment and ten seconds on a million-tag job.
 */
function searchFilter(search: string): Prisma.ProductionInstanceWhereInput {
  const asNumber = Number(search);
  const numeric = Number.isInteger(asNumber) && asNumber > 0;
  return {
    OR: [
      { serialValue: { startsWith: search } },
      ...(numeric
        ? [
            { sourceRowNumber: asNumber },
            { datasetRecordSequence: asNumber },
            { sequence: asNumber },
          ]
        : []),
    ],
  };
}

export { serializeManifest };
