import type { Prisma } from '@smarttag/database';
import {
  DEFAULT_SERIAL_FORMAT,
  LAYOUT_NOTE,
  formatSerial,
  previewSerials,
  type InstanceIssue,
  type ProductionConfiguration,
} from '@smarttag/production-core';
import type {
  ProductionInstanceDto,
  ProductionJobEventDto,
  ProductionJobSummaryDto,
  ProductionValidationSummaryDto,
  SequenceDto,
  SequenceReservationDto,
  SerialPreviewDto,
} from '@smarttag/shared-types';
import { toTemplateVersionRef, templateVersionRefSelect, userRef } from '../data/data.mappers';

export const jobSummarySelect = {
  id: true,
  jobNumber: true,
  name: true,
  description: true,
  status: true,
  productionMode: true,
  recordCount: true,
  instanceCount: true,
  validCount: true,
  warningCount: true,
  errorCount: true,
  sourceWarningCount: true,
  createdAt: true,
  releasedAt: true,
  customer: { select: { id: true, code: true, name: true } },
  createdBy: userRef,
  releasedBy: userRef,
  templateVersion: { select: templateVersionRefSelect },
  dataset: { select: { id: true, name: true } },
  datasetVersion: { select: { versionNumber: true } },
} as const satisfies Prisma.ProductionJobSelect;

type JobSummaryRow = Prisma.ProductionJobGetPayload<{ select: typeof jobSummarySelect }>;

export function toJobSummary(row: JobSummaryRow): ProductionJobSummaryDto {
  return {
    id: row.id,
    jobNumber: row.jobNumber,
    name: row.name,
    status: row.status,
    productionMode: row.productionMode,
    customer: row.customer
      ? { id: row.customer.id, code: row.customer.code, name: row.customer.name }
      : null,
    templateVersion: toTemplateVersionRef(row.templateVersion),
    dataset: {
      id: row.dataset.id,
      name: row.dataset.name,
      versionNumber: row.datasetVersion.versionNumber ?? 0,
    },
    counts: {
      recordCount: row.recordCount,
      instanceCount: row.instanceCount,
      validCount: row.validCount,
      warningCount: row.warningCount,
      errorCount: row.errorCount,
      sourceWarningCount: row.sourceWarningCount,
    },
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    releasedAt: row.releasedAt?.toISOString() ?? null,
    releasedBy: row.releasedBy ?? null,
  };
}

export const sequenceSelect = {
  id: true,
  name: true,
  code: true,
  description: true,
  prefix: true,
  suffix: true,
  padding: true,
  nextValue: true,
  resetPolicy: true,
  status: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  createdBy: userRef,
  _count: { select: { reservations: true } },
} as const satisfies Prisma.SequenceSelect;

type SequenceRow = Prisma.SequenceGetPayload<{ select: typeof sequenceSelect }>;

export function toSequenceDto(row: SequenceRow, reservedCount: number): SequenceDto {
  const format = { prefix: row.prefix, suffix: row.suffix, padding: row.padding };
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    prefix: row.prefix,
    suffix: row.suffix,
    padding: row.padding,
    nextValue: Number(row.nextValue),
    nextSerial: formatSerial(Number(row.nextValue), format),
    resetPolicy: row.resetPolicy,
    status: row.status,
    revision: row.revision,
    reservationCount: row._count.reservations,
    reservedCount,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

type ReservationRow = Prisma.SequenceReservationGetPayload<{
  include: { sequence: true; reservedBy: { select: { id: true; displayName: true } } };
}>;

export function toReservationDto(row: ReservationRow): SequenceReservationDto {
  const format = {
    prefix: row.sequence.prefix,
    suffix: row.sequence.suffix,
    padding: row.sequence.padding,
  };
  return {
    sequenceId: row.sequenceId,
    sequenceCode: row.sequence.code,
    sequenceName: row.sequence.name,
    startValue: Number(row.startValue),
    endValue: Number(row.endValue),
    count: row.valueCount,
    firstSerial: formatSerial(Number(row.startValue), format),
    lastSerial: formatSerial(Number(row.endValue), format),
    reservedAt: row.reservedAt.toISOString(),
    reservedBy: row.reservedBy,
  };
}

/** What the serial numbers would be if the job were released now. Nothing is reserved. */
export function toSerialPreview(
  sequence: {
    id: string;
    code: string;
    prefix: string;
    suffix: string;
    padding: number;
    nextValue: bigint;
  },
  instanceCount: number,
  sampleCount: number,
): SerialPreviewDto | null {
  if (instanceCount < 1) return null;
  const format = { prefix: sequence.prefix, suffix: sequence.suffix, padding: sequence.padding };
  const preview = previewSerials(Number(sequence.nextValue), instanceCount, format, sampleCount);
  return {
    sequenceId: sequence.id,
    sequenceCode: sequence.code,
    startValue: preview.range.startValue,
    endValue: preview.range.endValue,
    first: preview.first,
    last: preview.last,
    samples: preview.samples,
    provisional: true,
  };
}

export const instanceSelect = {
  sequence: true,
  datasetRecordSequence: true,
  sourceRowNumber: true,
  copyIndex: true,
  copies: true,
  serialValue: true,
  status: true,
  errorCount: true,
  warningCount: true,
  sourceWarningCount: true,
  resolvedInputHash: true,
  instanceHash: true,
} as const satisfies Prisma.ProductionInstanceSelect;

type InstanceRow = Prisma.ProductionInstanceGetPayload<{ select: typeof instanceSelect }>;

export function toInstanceDto(row: InstanceRow): ProductionInstanceDto {
  return {
    sequence: row.sequence,
    datasetRecordSequence: row.datasetRecordSequence,
    sourceRowNumber: row.sourceRowNumber,
    copyIndex: row.copyIndex,
    copies: row.copies,
    serial: row.serialValue,
    status: row.status,
    errorCount: row.errorCount,
    warningCount: row.warningCount,
    sourceWarningCount: row.sourceWarningCount,
    resolvedInputHash: row.resolvedInputHash,
    instanceHash: row.instanceHash,
  };
}

type EventRow = Prisma.ProductionJobEventGetPayload<{
  include: { createdBy: { select: { id: true; displayName: true } } };
}>;

export function toJobEventDto(row: EventRow): ProductionJobEventDto {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy ?? null,
  };
}

export function toValidationSummary(value: unknown): ProductionValidationSummaryDto | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const summary = value as Partial<ProductionValidationSummaryDto>;
  if (!Array.isArray(summary.issueCounts)) return null;
  return { issueCounts: summary.issueCounts, layoutChecked: false, layoutNote: LAYOUT_NOTE };
}

export function issuesOf(value: unknown): readonly InstanceIssue[] {
  return Array.isArray(value) ? (value as InstanceIssue[]) : [];
}

export const DEFAULT_FORMAT = DEFAULT_SERIAL_FORMAT;

export type { ProductionConfiguration };
