/**
 * Value types of the expression language. They mirror the data field types of the canonical
 * document (`string`, `number`, `decimal`, …) so a field keeps its type inside expressions.
 *
 * - `decimal` values are exact decimal strings ("39.90"); they never pass through binary floating
 *   point, so money compares, rounds and formats exactly.
 * - `date` values are ISO calendar dates ("2026-09-15").
 * - `image` values are asset ids.
 */
export const VALUE_TYPES = [
  'string',
  'number',
  'decimal',
  'boolean',
  'date',
  'url',
  'image',
] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

/** A static type: one value type, or `null` for the literal `null`. */
export type ExpressionType = ValueType | 'null';

export type ExpressionValue =
  | { readonly type: 'string' | 'decimal' | 'date' | 'url' | 'image'; readonly value: string }
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'null'; readonly value: null };

export const NULL_VALUE: ExpressionValue = Object.freeze({ type: 'null', value: null });

export const EXPRESSION_ISSUE_CODES = [
  'EXPRESSION_PARSE_ERROR',
  'EXPRESSION_LIMIT_EXCEEDED',
  'UNKNOWN_FIELD',
  'UNKNOWN_FUNCTION',
  'WRONG_ARGUMENT_COUNT',
  'TYPE_MISMATCH',
  'EXPRESSION_EVALUATION_ERROR',
] as const;
export type ExpressionIssueCode = (typeof EXPRESSION_ISSUE_CODES)[number];

export interface ExpressionIssue {
  readonly code: ExpressionIssueCode;
  readonly message: string;
  /** UTF-16 offsets into the expression source; `start === end` marks a position. */
  readonly start: number;
  readonly end: number;
}

export function issue(
  code: ExpressionIssueCode,
  message: string,
  start: number,
  end: number = start,
): ExpressionIssue {
  return { code, message, start, end };
}
