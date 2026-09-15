import type { ImportLimits } from '@smarttag/import-core';
import { Transform, type Readable } from 'node:stream';
import { fromBufferPromise, type Entry, type ZipFile } from 'yauzl';
import { SourceReadError } from '../errors';

const LARGE_ENTRY_BYTES = 1024 * 1024;

/**
 * A workbook's ZIP container, opened with every decompression limit checked BEFORE anything is
 * inflated:
 *
 * - number of entries, total declared uncompressed size, and the uncompressed/compressed ratio of
 *   large entries (ZIP bombs), from the central directory;
 * - the actual inflated bytes of every entry are counted while streaming and may not exceed the
 *   declared size (yauzl validates it as well) or the part's own limit;
 * - encrypted entries and unsupported compression methods are refused; entry names are only ever
 *   used as lookup keys, never as file system paths.
 */
export class WorkbookZip {
  private constructor(
    private readonly zip: ZipFile,
    private readonly entries: ReadonlyMap<string, Entry>,
  ) {}

  static async open(buffer: Buffer, limits: ImportLimits): Promise<WorkbookZip> {
    let zip: ZipFile;
    try {
      zip = await fromBufferPromise(buffer, {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: false,
      });
    } catch {
      throw new SourceReadError(
        'MALFORMED_FILE',
        'The XLSX file is damaged or is not a valid workbook.',
      );
    }
    if (zip.entryCount > limits.xlsxMaxEntries) {
      zip.close();
      throw new SourceReadError(
        'WORKBOOK_LIMIT_EXCEEDED',
        `The workbook container has ${zip.entryCount} parts; at most ${limits.xlsxMaxEntries} are allowed.`,
      );
    }
    const entries = new Map<string, Entry>();
    let declared = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        zip.on('error', reject);
        zip.on('end', resolve);
        zip.on('entry', (entry: Entry) => {
          try {
            declared += entry.uncompressedSize;
            if (declared > limits.xlsxMaxUncompressedBytes) {
              throw new SourceReadError(
                'WORKBOOK_LIMIT_EXCEEDED',
                `The workbook expands to more than ${formatBytes(limits.xlsxMaxUncompressedBytes)} when uncompressed.`,
              );
            }
            const ratio = entry.uncompressedSize / Math.max(1, entry.compressedSize);
            if (
              entry.uncompressedSize > LARGE_ENTRY_BYTES &&
              ratio > limits.xlsxMaxCompressionRatio
            ) {
              throw new SourceReadError(
                'WORKBOOK_LIMIT_EXCEEDED',
                `The workbook contains a part compressed ${Math.round(ratio)}:1, which exceeds the allowed ratio of ${limits.xlsxMaxCompressionRatio}:1.`,
              );
            }
            if (!entry.fileName.endsWith('/')) {
              entries.set(normalizePartName(entry.fileName), entry);
            }
            zip.readEntry();
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
        zip.readEntry();
      });
    } catch (error) {
      zip.close();
      if (error instanceof SourceReadError) throw error;
      throw new SourceReadError(
        'MALFORMED_FILE',
        'The XLSX file is damaged or is not a valid workbook.',
      );
    }
    return new WorkbookZip(zip, entries);
  }

  has(name: string): boolean {
    return this.entries.has(normalizePartName(name));
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  /** Streams one part's inflated bytes, failing once more than `maxBytes` were produced. */
  async openPart(name: string, maxBytes: number): Promise<Readable | null> {
    const entry = this.entries.get(normalizePartName(name));
    if (!entry) return null;
    if (entry.isEncrypted()) {
      throw new SourceReadError(
        'ENCRYPTED_FILE',
        'The workbook is encrypted. Remove the password and upload it again.',
      );
    }
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      throw new SourceReadError(
        'MALFORMED_FILE',
        'The workbook uses an unsupported compression method.',
      );
    }
    if (entry.uncompressedSize > maxBytes) {
      throw new SourceReadError(
        'WORKBOOK_LIMIT_EXCEEDED',
        `The workbook part "${name}" is larger than ${formatBytes(maxBytes)} when uncompressed.`,
      );
    }
    let stream: Readable;
    try {
      stream = await this.zip.openReadStreamPromise(entry);
    } catch {
      throw new SourceReadError(
        'MALFORMED_FILE',
        'The XLSX file is damaged or is not a valid workbook.',
      );
    }
    let produced = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        produced += chunk.length;
        if (produced > maxBytes) {
          callback(
            new SourceReadError(
              'WORKBOOK_LIMIT_EXCEEDED',
              `The workbook part "${name}" expands beyond ${formatBytes(maxBytes)}.`,
            ),
          );
          return;
        }
        callback(null, chunk);
      },
    });
    stream.on('error', (error) =>
      counter.destroy(
        error instanceof SourceReadError
          ? error
          : new SourceReadError(
              'MALFORMED_FILE',
              'The XLSX file is damaged or is not a valid workbook.',
            ),
      ),
    );
    counter.on('close', () => stream.destroy());
    return stream.pipe(counter);
  }

  close(): void {
    this.zip.close();
  }
}

/** Part names are case-insensitive in OOXML packages; leading slashes and backslashes are normalized. */
export function normalizePartName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
