import { MAX_DATA_FIELDS, MAX_STRING_VALUE_LENGTH } from '@smarttag/document-schema';
import { EXPRESSION_LIMITS, PATTERN_LIMITS } from '@smarttag/expression-core';

/**
 * Limits for one data record (test data in the designer, the validation API and, later, every
 * imported row). Variable data is untrusted input; nothing about it may be unbounded.
 */
export const DATA_LIMITS = {
  /** Keys in one record (schema fields plus unknown keys). */
  maxRecordKeys: MAX_DATA_FIELDS * 2,
  /** Characters of one text value. */
  maxStringValueLength: MAX_STRING_VALUE_LENGTH,
  /** Characters of one URL value. */
  maxUrlLength: 2_048,
  /** Serialized size of one record accepted by the validation API (UTF-8 bytes). */
  maxRecordBytes: 256 * 1024,
  /** Fields in one data schema. */
  maxFields: MAX_DATA_FIELDS,
  /** Characters of expression source. */
  maxExpressionLength: EXPRESSION_LIMITS.maxSourceLength,
  /** Characters of a validation pattern. */
  maxPatternLength: PATTERN_LIMITS.maxSourceLength,
} as const;
