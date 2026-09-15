import type { AssetAvailability } from '@smarttag/data-core';
import type { DbClient } from '@smarttag/database';
import type { ImportLimits } from '@smarttag/import-core';
import { ObjectNotFoundError, type ObjectStorage } from '@smarttag/object-storage';
import { PLACEABLE_IMAGE_MIME_TYPES } from '@smarttag/shared-types';
import { SourceReadError, type SourceInput } from '@smarttag/tabular-sources';
import type { Readable } from 'node:stream';

/** A pino-compatible logger (the worker passes its job logger). */
export interface ImportLogger {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
  error(details: object, message: string): void;
}

export const SILENT_LOGGER: ImportLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Reads an uploaded source from object storage; the stored size is the trusted size. */
export function sourceFromStorage(
  storage: ObjectStorage,
  key: string,
  sizeBytes: number,
  limits: ImportLimits,
): SourceInput {
  const open = async (): Promise<Readable> => {
    try {
      return (await storage.getObject(key)).body;
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        throw new SourceReadError(
          'MALFORMED_FILE',
          'The uploaded file is no longer available. Upload it again.',
        );
      }
      throw error;
    }
  };
  return {
    sizeBytes,
    openStream: open,
    async readAll() {
      if (sizeBytes > limits.maxFileBytes) {
        throw new SourceReadError(
          'FILE_LIMIT_EXCEEDED',
          'The file is larger than the upload limit.',
        );
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of (await open()) as AsyncIterable<Buffer>) {
        length += chunk.length;
        if (length > limits.maxFileBytes) {
          throw new SourceReadError(
            'FILE_LIMIT_EXCEEDED',
            'The file is larger than the upload limit.',
          );
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, length);
    },
  };
}

/**
 * Availability of image asset ids for ONE organization. Ids of other organizations are simply not
 * found, so a spreadsheet can never reference another tenant's asset.
 */
export async function lookupImageAvailability(
  db: DbClient,
  organizationId: string,
  ids: Iterable<string>,
): Promise<Map<string, AssetAvailability>> {
  const unique = [...new Set(ids)];
  const availability = new Map<string, AssetAvailability>(unique.map((id) => [id, 'UNAVAILABLE']));
  if (unique.length === 0) return availability;
  const assets = await db.asset.findMany({
    where: {
      organizationId,
      id: { in: unique },
      assetType: { not: 'FONT' },
      mimeType: { in: [...PLACEABLE_IMAGE_MIME_TYPES] },
    },
    select: { id: true },
  });
  for (const asset of assets) availability.set(asset.id, 'AVAILABLE');
  return availability;
}

/** Tracks the highest resident set size seen while a job runs. */
export class MemorySampler {
  private peak = process.memoryUsage().rss;

  sample(): void {
    this.peak = Math.max(this.peak, process.memoryUsage().rss);
  }

  get peakRssBytes(): number {
    this.sample();
    return this.peak;
  }
}

export function failureOf(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof SourceReadError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  return {
    code: 'PROCESSING_ERROR',
    message:
      'The import could not be processed because of an unexpected error. Try again; if it keeps failing, contact support.',
    retryable: true,
  };
}
