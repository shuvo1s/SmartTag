import type { DataField } from '@smarttag/document-schema';
import type { SourceColumn } from './settings';

/**
 * Deterministic auto-mapping suggestions (no AI, no fuzzy scoring). A header matches a field when,
 * in this order of preference:
 *
 *   1. EXACT_KEY             "product_name" = key product_name
 *   2. CASE_INSENSITIVE_KEY  "PRODUCT_NAME"
 *   3. NORMALIZED_KEY        "Product Name", "product-name"   (lower case, non-alphanumerics → "_")
 *   4. EXACT_LABEL           "Product Name" = display name "Product Name"
 *   5. NORMALIZED_LABEL      "PRODUCT  NAME"
 *
 * Only EXACT_KEY and EXACT_LABEL are exact; every other suggestion needs the user's confirmation.
 * Nothing is suggested when it would be ambiguous: duplicate headers, two columns matching one
 * field equally well, or one column matching two fields equally well.
 */
export const SUGGESTION_MATCHES = [
  'EXACT_KEY',
  'CASE_INSENSITIVE_KEY',
  'NORMALIZED_KEY',
  'EXACT_LABEL',
  'NORMALIZED_LABEL',
] as const;
export type SuggestionMatch = (typeof SUGGESTION_MATCHES)[number];

export interface MappingSuggestion {
  readonly field: string;
  readonly column: { readonly index: number; readonly header: string };
  readonly match: SuggestionMatch;
  /** Exact key or display-name match; other matches need confirmation. */
  readonly exact: boolean;
}

export interface AmbiguousSuggestion {
  readonly field: string | null;
  readonly columnIndex: number | null;
  readonly reason: string;
}

export interface SuggestionResult {
  readonly suggestions: readonly MappingSuggestion[];
  readonly ambiguous: readonly AmbiguousSuggestion[];
}

/** Lower case; every run of characters other than a–z and 0–9 becomes one "_"; no edge "_". */
export function normalizeIdentifier(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function matchRank(header: string, field: DataField): number {
  if (header === field.key) return 0;
  if (header.toLowerCase() === field.key) return 1;
  const normalized = normalizeIdentifier(header);
  if (normalized !== '' && normalized === field.key) return 2;
  if (header === field.displayName.trim()) return 3;
  if (normalized !== '' && normalized === normalizeIdentifier(field.displayName)) return 4;
  return -1;
}

export function suggestMappings(
  fields: readonly DataField[],
  columns: readonly SourceColumn[],
): SuggestionResult {
  const ambiguous: AmbiguousSuggestion[] = [];
  const candidates: { field: DataField; column: SourceColumn; rank: number }[] = [];

  for (const column of columns) {
    if (!column.header) continue;
    const matches = fields
      .map((field) => ({ field, rank: matchRank(column.header, field) }))
      .filter((match) => match.rank >= 0);
    if (matches.length === 0) continue;
    if (column.duplicate) {
      ambiguous.push({
        field: null,
        columnIndex: column.index,
        reason: `"${column.header}" appears in more than one column; map it manually`,
      });
      continue;
    }
    const best = Math.min(...matches.map((match) => match.rank));
    const bestFields = matches.filter((match) => match.rank === best);
    if (bestFields.length > 1) {
      ambiguous.push({
        field: null,
        columnIndex: column.index,
        reason: `"${column.header}" matches ${bestFields.map((match) => match.field.key).join(' and ')} equally well`,
      });
      continue;
    }
    candidates.push({ field: bestFields[0]!.field, column, rank: best });
  }

  const suggestions: MappingSuggestion[] = [];
  const byField = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const list = byField.get(candidate.field.key) ?? [];
    list.push(candidate);
    byField.set(candidate.field.key, list);
  }
  for (const field of fields) {
    const list = byField.get(field.key);
    if (!list) continue;
    const best = Math.min(...list.map((candidate) => candidate.rank));
    const winners = list.filter((candidate) => candidate.rank === best);
    if (winners.length > 1) {
      ambiguous.push({
        field: field.key,
        columnIndex: null,
        reason: `${winners.map((winner) => `"${winner.column.header}" (${winner.column.letter})`).join(' and ')} both match ${field.key}`,
      });
      continue;
    }
    const winner = winners[0]!;
    const match = SUGGESTION_MATCHES[winner.rank]!;
    suggestions.push({
      field: field.key,
      column: { index: winner.column.index, header: winner.column.header },
      match,
      exact: match === 'EXACT_KEY' || match === 'EXACT_LABEL',
    });
  }
  return { suggestions, ambiguous };
}
