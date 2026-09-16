import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@smarttag/database';
import { MAX_SEQUENCE_VALUE } from '@smarttag/production-core';
import type {
  CreateSequenceCommand,
  ListSequencesQuery,
  SequenceDto,
  UpdateSequenceRequest,
} from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { APP_CONFIG, type AppConfig } from '../../config/env.schema';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { sequenceSelect, toSequenceDto } from './production.mappers';

/**
 * Serial number sequences. Everything about them is server-side: the browser never computes a
 * serial number, and numbers only ever move forward (docs/sequences.md).
 */
@Injectable()
export class SequencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(actor: ActorContext, query: ListSequencesQuery): Promise<SequenceDto[]> {
    const rows = await this.prisma.sequence.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      select: sequenceSelect,
    });
    const reserved = await this.reservedCounts(rows.map((row) => row.id));
    return rows.map((row) => toSequenceDto(row, reserved.get(row.id) ?? 0));
  }

  async get(actor: ActorContext, sequenceId: string): Promise<SequenceDto> {
    const row = await this.prisma.sequence.findFirst({
      where: { id: sequenceId, organizationId: actor.organizationId },
      select: sequenceSelect,
    });
    if (!row) throw AppError.notFound('Sequence');
    const reserved = await this.reservedCounts([row.id]);
    return toSequenceDto(row, reserved.get(row.id) ?? 0);
  }

  async create(actor: ActorContext, input: CreateSequenceCommand): Promise<SequenceDto> {
    const created = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.sequence.create({
          data: {
            organizationId: actor.organizationId,
            name: input.name,
            code: input.code,
            description: input.description,
            prefix: input.prefix,
            suffix: input.suffix,
            padding: input.padding,
            nextValue: BigInt(input.startValue),
            createdById: actor.userId,
            updatedById: actor.userId,
          },
          select: sequenceSelect,
        });
        await this.audit.recordForActor(tx, actor, {
          action: 'SEQUENCE_CREATED',
          resourceType: 'SEQUENCE',
          resourceId: row.id,
          metadata: { code: row.code, prefix: row.prefix, padding: row.padding },
        });
        return row;
      })
      .catch((error: unknown) => {
        throw conflictOf(error);
      });
    return toSequenceDto(created, 0);
  }

  async update(
    actor: ActorContext,
    sequenceId: string,
    input: UpdateSequenceRequest,
  ): Promise<SequenceDto> {
    const updated = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.sequence.findFirst({
          where: { id: sequenceId, organizationId: actor.organizationId },
          select: { id: true, revision: true, code: true },
        });
        if (!row) throw AppError.notFound('Sequence');
        if (row.revision !== input.expectedRevision) {
          throw new AppError(
            'CONFLICT',
            'This sequence was changed by someone else. Reload and try again.',
          );
        }
        const result = await tx.sequence.updateMany({
          where: {
            id: row.id,
            organizationId: actor.organizationId,
            revision: input.expectedRevision,
          },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
            ...(input.suffix === undefined ? {} : { suffix: input.suffix }),
            ...(input.padding === undefined ? {} : { padding: input.padding }),
            ...(input.status === undefined ? {} : { status: input.status }),
            revision: { increment: 1 },
            updatedById: actor.userId,
          },
        });
        if (result.count === 0) {
          throw new AppError('CONFLICT', 'This sequence was changed by someone else.');
        }
        await this.audit.recordForActor(tx, actor, {
          action: 'SEQUENCE_UPDATED',
          resourceType: 'SEQUENCE',
          resourceId: row.id,
          metadata: {
            code: row.code,
            changed: Object.keys(input).filter((key) => key !== 'expectedRevision'),
          },
        });
        return tx.sequence.findFirstOrThrow({ where: { id: row.id }, select: sequenceSelect });
      })
      .catch((error: unknown) => {
        throw conflictOf(error);
      });
    const reserved = await this.reservedCounts([updated.id]);
    return toSequenceDto(updated, reserved.get(updated.id) ?? 0);
  }

  /** How many numbers each sequence has already committed to production jobs. */
  private async reservedCounts(ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.sequenceReservation.groupBy({
      by: ['sequenceId'],
      where: { sequenceId: { in: [...ids] } },
      _sum: { valueCount: true },
    });
    return new Map(rows.map((row) => [row.sequenceId, row._sum.valueCount ?? 0]));
  }

  /**
   * Reserves the next range of a sequence for one production job, inside the caller's release
   * transaction. The sequence row is locked first, so two jobs released at the same moment are
   * serialized and can never receive overlapping numbers.
   */
  async reserveRange(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    sequenceId: string,
    productionJobId: string,
    count: number,
  ): Promise<{ startValue: number; endValue: number; code: string }> {
    await tx.$queryRaw`SELECT id FROM sequences WHERE id = ${sequenceId}::uuid AND organization_id = ${actor.organizationId}::uuid FOR UPDATE`;
    const sequence = await tx.sequence.findFirst({
      where: { id: sequenceId, organizationId: actor.organizationId },
      select: { id: true, code: true, status: true, nextValue: true },
    });
    if (!sequence) throw AppError.notFound('Sequence');
    if (sequence.status !== 'ACTIVE') {
      throw new AppError('SEQUENCE_INACTIVE', `Sequence ${sequence.code} is archived.`);
    }
    const startValue = Number(sequence.nextValue);
    const endValue = startValue + count - 1;
    if (endValue > MAX_SEQUENCE_VALUE) {
      throw new AppError(
        'SEQUENCE_EXHAUSTED',
        `Sequence ${sequence.code} does not have ${count.toLocaleString('en-US')} numbers left.`,
      );
    }
    // The reservation exists once per job (unique), so a repeated release cannot take a second range.
    await tx.sequenceReservation.create({
      data: {
        organizationId: actor.organizationId,
        sequenceId: sequence.id,
        productionJobId,
        startValue: BigInt(startValue),
        endValue: BigInt(endValue),
        valueCount: count,
        reservedById: actor.userId,
      },
    });
    await tx.sequence.update({
      where: { id: sequence.id },
      data: { nextValue: BigInt(endValue + 1), updatedById: actor.userId },
    });
    await this.audit.recordForActor(tx, actor, {
      action: 'SEQUENCE_RANGE_RESERVED',
      resourceType: 'SEQUENCE',
      resourceId: sequence.id,
      metadata: { productionJobId, code: sequence.code, startValue, endValue, count },
    });
    return { startValue, endValue, code: sequence.code };
  }

  /** Preview limit, from configuration. */
  get previewCount(): number {
    return this.config.production.limits.serialPreviewCount;
  }
}

function conflictOf(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    Array.isArray(error.meta?.target)
  ) {
    const target = (error.meta.target as string[]).join(', ');
    return new AppError('CONFLICT', `A sequence with the same ${target} already exists.`);
  }
  return error;
}
