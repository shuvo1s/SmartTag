import type { DataSchema } from '@smarttag/document-schema';

/**
 * A CSV file with one header row naming every data field by its key (schema order), UTF-8 with a
 * byte order mark so spreadsheet applications detect the encoding. Keys contain only a–z, 0–9 and
 * "_", so no header needs quoting and none can be read as a formula.
 */
export function buildCsvTemplate(schema: DataSchema): string {
  return `\uFEFF${schema.fields.map((field) => field.key).join(',')}\r\n`;
}
