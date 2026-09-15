import type { DataField, DataFieldType, DataSchema } from '@smarttag/document-schema';
import { canonicalizeJson, sha256Hex } from '@smarttag/document-utils';
import { z } from 'zod';
import {
  MappingDefinitionSchema,
  canonicalMapping,
  validateMapping,
  type MappingDefinition,
  type MappingEntry,
} from './mapping';
import type { SourceColumn } from './settings';
import { SOURCE_FORMATS, type SourceFormat } from './source';

export const PROFILE_DEFINITION_VERSION = 1 as const;

/**
 * What a mapping profile stores: the mapping and parsing rules, the source layout it was built
 * from (header text and order) and the type of every mapped field, so a later import can tell
 * whether the profile still fits its columns and its template's data schema.
 */
export const MappingProfileDefinitionSchema = z.strictObject({
  version: z.literal(PROFILE_DEFINITION_VERSION),
  sourceFormat: z.enum(SOURCE_FORMATS).nullable(),
  columns: z
    .array(z.strictObject({ index: z.number().int().min(0), header: z.string().max(1_000) }))
    .max(16_384),
  fieldTypes: z.record(z.string().max(64), z.string().max(16)),
  mapping: MappingDefinitionSchema,
});
export type MappingProfileDefinition = z.infer<typeof MappingProfileDefinitionSchema>;

export function createProfileDefinition(
  schema: DataSchema,
  columns: readonly SourceColumn[],
  mapping: MappingDefinition,
  sourceFormat: SourceFormat | null,
): MappingProfileDefinition {
  const types = new Map(schema.fields.map((field) => [field.key, field.type]));
  const canonical = canonicalMapping(mapping);
  return {
    version: PROFILE_DEFINITION_VERSION,
    sourceFormat,
    columns: columns.map((column) => ({ index: column.index, header: column.header })),
    fieldTypes: Object.fromEntries(
      canonical.entries.flatMap((entry) => {
        const type = types.get(entry.field);
        return type ? [[entry.field, type]] : [];
      }),
    ),
    mapping: canonical,
  };
}

export const HEADER_SIGNATURE_SCHEME = 'smarttag-source-headers-v1' as const;

/**
 * SHA-256 of the ordered header texts (trimmed; unnamed columns as ""). Equal signatures mean the
 * same columns in the same order; profiles match on headers, so a changed order does not by
 * itself make a profile unusable.
 */
export async function computeHeaderSignature(
  columns: readonly Pick<SourceColumn, 'header'>[],
): Promise<string> {
  return sha256Hex(
    canonicalizeJson({
      scheme: HEADER_SIGNATURE_SCHEME,
      headers: columns.map((column) => column.header),
    }),
  );
}

export const PROFILE_COMPATIBILITY = ['COMPATIBLE', 'REQUIRES_REVIEW', 'INCOMPATIBLE'] as const;
export type ProfileCompatibility = (typeof PROFILE_COMPATIBILITY)[number];

export const PROFILE_NOTE_CODES = [
  'SCHEMA_CHANGED',
  'COLUMN_NOT_FOUND',
  'COLUMN_AMBIGUOUS',
  'COLUMN_MOVED',
  'FIELD_NOT_IN_SCHEMA',
  'FIELD_TYPE_CHANGED',
  'REQUIRED_FIELD_UNMAPPED',
] as const;
export type ProfileNoteCode = (typeof PROFILE_NOTE_CODES)[number];

export interface ProfileNote {
  readonly code: ProfileNoteCode;
  /** COLUMN_MOVED is informational; every other note means the profile needs review. */
  readonly blocking: boolean;
  readonly message: string;
  readonly field: string | null;
}

export interface ProfileEvaluation {
  readonly compatibility: ProfileCompatibility;
  readonly schemaMatches: boolean;
  /** The source has exactly the profile's headers in the same order. */
  readonly layoutMatches: boolean;
  /** The profile's mapping resolved against the import's columns (unresolvable entries dropped). */
  readonly mapping: MappingDefinition;
  readonly resolvedEntries: number;
  readonly totalEntries: number;
  readonly notes: readonly ProfileNote[];
}

/**
 * Decides whether a profile can be applied to an import:
 *
 *   COMPATIBLE       same data schema hash, every column found unambiguously, no required field
 *                    left unmapped — the profile can be suggested ("Apply mapping profile").
 *   REQUIRES_REVIEW  the schema changed, or some columns are missing or ambiguous — the resolvable
 *                    part can be applied, then the user reviews and saves the mapping.
 *   INCOMPATIBLE     nothing of the profile applies.
 *
 * Columns are found by header text, so reordered columns still match. A header that occurs more
 * than once only matches when the duplicates sit at the same positions as in the profile;
 * otherwise it is ambiguous and never mapped silently.
 */
export function evaluateMappingProfile(
  profile: { readonly definition: MappingProfileDefinition; readonly dataSchemaHash: string },
  target: {
    readonly dataSchemaHash: string;
    readonly schema: DataSchema;
    readonly columns: readonly SourceColumn[];
  },
): ProfileEvaluation {
  const notes: ProfileNote[] = [];
  const schemaMatches = profile.dataSchemaHash === target.dataSchemaHash;
  if (!schemaMatches) {
    notes.push({
      code: 'SCHEMA_CHANGED',
      blocking: true,
      message: "The template's data schema differs from the one this profile was created for",
      field: null,
    });
  }
  const fields = new Map<string, DataField>(
    target.schema.fields.map((field) => [field.key, field]),
  );
  const profileColumns = profile.definition.columns;
  const layoutMatches =
    profileColumns.length === target.columns.length &&
    profileColumns.every((column, index) => target.columns[index]?.header === column.header);

  const resolved: MappingEntry[] = [];
  const entries = profile.definition.mapping.entries;
  for (const entry of entries) {
    const field = fields.get(entry.field);
    if (!field) {
      notes.push({
        code: 'FIELD_NOT_IN_SCHEMA',
        blocking: true,
        message: `"${entry.field}" is no longer a field of the template`,
        field: entry.field,
      });
      continue;
    }
    const expectedType = profile.definition.fieldTypes[entry.field] as DataFieldType | undefined;
    if (expectedType && expectedType !== field.type) {
      notes.push({
        code: 'FIELD_TYPE_CHANGED',
        blocking: true,
        message: `${field.displayName} was ${expectedType} and is now ${field.type}`,
        field: entry.field,
      });
      continue;
    }
    const column = locateColumn(entry, profileColumns, target.columns);
    if (column.kind === 'NOT_FOUND') {
      notes.push({
        code: 'COLUMN_NOT_FOUND',
        blocking: true,
        message: entry.column.header
          ? `Column "${entry.column.header}" for ${field.displayName} is not in this file`
          : `The unnamed column for ${field.displayName} cannot be identified in this file`,
        field: entry.field,
      });
      continue;
    }
    if (column.kind === 'AMBIGUOUS') {
      notes.push({
        code: 'COLUMN_AMBIGUOUS',
        blocking: true,
        message: `"${entry.column.header}" appears in several columns at other positions; choose the column for ${field.displayName}`,
        field: entry.field,
      });
      continue;
    }
    if (column.column.index !== entry.column.index) {
      notes.push({
        code: 'COLUMN_MOVED',
        blocking: false,
        message: `"${entry.column.header}" moved to column ${column.column.letter}`,
        field: entry.field,
      });
    }
    resolved.push({
      ...entry,
      column: { index: column.column.index, header: column.column.header },
    });
  }

  const mapping: MappingDefinition = { ...profile.definition.mapping, entries: resolved };
  const validation = validateMapping(target.schema, target.columns, mapping);
  for (const key of validation.unmappedRequiredFields) {
    notes.push({
      code: 'REQUIRED_FIELD_UNMAPPED',
      blocking: true,
      message: `Required field "${key}" is not mapped by this profile`,
      field: key,
    });
  }
  const blocking = notes.some((note) => note.blocking);
  const compatibility: ProfileCompatibility =
    resolved.length === 0 ? 'INCOMPATIBLE' : blocking ? 'REQUIRES_REVIEW' : 'COMPATIBLE';
  return {
    compatibility,
    schemaMatches,
    layoutMatches,
    mapping,
    resolvedEntries: resolved.length,
    totalEntries: entries.length,
    notes,
  };
}

type LocatedColumn =
  | { readonly kind: 'FOUND'; readonly column: SourceColumn }
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'AMBIGUOUS' };

function locateColumn(
  entry: MappingEntry,
  profileColumns: readonly { index: number; header: string }[],
  columns: readonly SourceColumn[],
): LocatedColumn {
  const header = entry.column.header;
  if (header === '') {
    // Unnamed columns have no identity beyond their position: only an identical layout matches.
    const column = columns[entry.column.index];
    const sameLayout =
      profileColumns.length === columns.length &&
      profileColumns.every(
        (profileColumn, index) => columns[index]?.header === profileColumn.header,
      );
    return column && column.header === '' && sameLayout
      ? { kind: 'FOUND', column }
      : { kind: 'NOT_FOUND' };
  }
  const candidates = columns.filter((column) => column.header === header);
  if (candidates.length === 0) return { kind: 'NOT_FOUND' };
  const profileOccurrences = profileColumns.filter((column) => column.header === header).length;
  if (candidates.length === 1 && profileOccurrences <= 1)
    return { kind: 'FOUND', column: candidates[0]! };
  const samePosition = candidates.find((column) => column.index === entry.column.index);
  const positionsMatch =
    candidates.length === profileOccurrences &&
    profileColumns
      .filter((column) => column.header === header)
      .every((column) => candidates.some((candidate) => candidate.index === column.index));
  return samePosition && positionsMatch
    ? { kind: 'FOUND', column: samePosition }
    : { kind: 'AMBIGUOUS' };
}
