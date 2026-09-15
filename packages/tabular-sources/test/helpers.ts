import {
  DEFAULT_IMPORT_LIMITS,
  type ImportLimits,
  type SourceRow,
  type SourceSettings,
} from '@smarttag/import-core';
import { parserFor, sourceFromBuffer } from '../src';

export const limits = (overrides: Partial<ImportLimits> = {}): ImportLimits => ({
  ...DEFAULT_IMPORT_LIMITS,
  ...overrides,
});

export const csvSettings = (overrides: Partial<Extract<SourceSettings, { format: 'CSV' }>> = {}) =>
  ({ format: 'CSV', encoding: 'UTF-8', delimiter: null, headerRow: 1, ...overrides }) as const;

export const xlsxSettings = (sheetName: string | null = null) =>
  ({ format: 'XLSX', sheetName, headerRow: 1 }) as const;

export async function readAllRows(
  buffer: Buffer,
  settings: SourceSettings,
  importLimits: ImportLimits = limits(),
): Promise<SourceRow[]> {
  const rows: SourceRow[] = [];
  for await (const row of parserFor(settings.format).rows(
    sourceFromBuffer(buffer),
    settings,
    importLimits,
  )) {
    rows.push(row);
  }
  return rows;
}

export function texts(row: SourceRow | undefined): string[] {
  return (row?.cells ?? []).map((cell) =>
    cell.kind === 'TEXT' ? cell.text : cell.kind === 'EMPTY' ? '' : `<${cell.kind}>`,
  );
}

/**
 * Rewrites the declared uncompressed size of a ZIP entry in both its local header and its central
 * directory record, producing an archive that lies about how large the entry inflates.
 */
export function patchDeclaredSize(zip: Buffer, entryName: string, declaredSize: number): Buffer {
  const patched = Buffer.from(zip);
  const name = Buffer.from(entryName, 'utf8');
  for (let offset = 0; offset < patched.length - 46; offset += 1) {
    const signature = patched.readUInt32LE(offset);
    if (signature === 0x04034b50) {
      const nameLength = patched.readUInt16LE(offset + 26);
      if (
        nameLength === name.length &&
        patched.subarray(offset + 30, offset + 30 + nameLength).equals(name)
      ) {
        patched.writeUInt32LE(declaredSize, offset + 22);
      }
    } else if (signature === 0x02014b50) {
      const nameLength = patched.readUInt16LE(offset + 28);
      if (
        nameLength === name.length &&
        patched.subarray(offset + 46, offset + 46 + nameLength).equals(name)
      ) {
        patched.writeUInt32LE(declaredSize, offset + 24);
      }
    }
  }
  return patched;
}
