import { compareDecimals, compileSafePattern } from '@smarttag/expression-core';
import { ISO_DATE_PATTERN, isReservedFieldKey, type DataField } from './data-schema';

/**
 * Rules shared by canonical validation (field definitions and defaults), editors (field dialogs)
 * and data-record validation (values). Keeping them in one place guarantees that a default value
 * accepted by the designer is accepted for a record, and vice versa.
 */

/** A normalized field value: decimal/date/url/image as strings, numbers, booleans. */
export type NormalizedFieldValue = string | number | boolean;

export const FIELD_RULE_CODES = [
  'VALUE_TOO_SHORT',
  'VALUE_TOO_LONG',
  'PATTERN_MISMATCH',
  'VALUE_BELOW_MINIMUM',
  'VALUE_ABOVE_MAXIMUM',
  'VALUE_NOT_ALLOWED',
] as const;
export type FieldRuleCode = (typeof FIELD_RULE_CODES)[number];

export interface FieldRuleViolation {
  readonly code: FieldRuleCode;
  readonly rule: 'minLength' | 'maxLength' | 'pattern' | 'min' | 'max' | 'allowedValues';
  readonly message: string;
}

/** Length as users count it for rules: Unicode code points (platform independent). */
export function valueLength(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

export function isRealCalendarDate(isoDate: string): boolean {
  if (!ISO_DATE_PATTERN.test(isoDate)) return false;
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const quote = (value: string | number) => (typeof value === 'string' ? `"${value}"` : `${value}`);

/**
 * Checks a value that already has the field's type against the field's validation rules.
 * Type and format problems are reported by the caller before rules are checked.
 */
export function checkFieldRules(
  field: DataField,
  value: NormalizedFieldValue,
): FieldRuleViolation[] {
  const violations: FieldRuleViolation[] = [];
  switch (field.type) {
    case 'string': {
      if (typeof value !== 'string') break;
      const { minLength, maxLength, pattern, allowedValues } = field.validation;
      const length = valueLength(value);
      if (minLength !== null && length < minLength) {
        violations.push({
          code: 'VALUE_TOO_SHORT',
          rule: 'minLength',
          message: `${field.displayName} must be at least ${minLength} characters`,
        });
      }
      if (maxLength !== null && length > maxLength) {
        violations.push({
          code: 'VALUE_TOO_LONG',
          rule: 'maxLength',
          message: `${field.displayName} must be at most ${maxLength} characters`,
        });
      }
      if (pattern !== null) {
        const compiled = compileSafePattern(pattern);
        if (compiled.ok && !compiled.pattern.test(value)) {
          violations.push({
            code: 'PATTERN_MISMATCH',
            rule: 'pattern',
            message: `${field.displayName} does not match the required format`,
          });
        }
      }
      if (allowedValues !== null && !allowedValues.includes(value)) {
        violations.push({
          code: 'VALUE_NOT_ALLOWED',
          rule: 'allowedValues',
          message: `${field.displayName} must be one of ${allowedValues.map(quote).join(', ')}`,
        });
      }
      break;
    }
    case 'number': {
      if (typeof value !== 'number') break;
      const { min, max, allowedValues } = field.validation;
      if (min !== null && value < min) {
        violations.push({
          code: 'VALUE_BELOW_MINIMUM',
          rule: 'min',
          message: `${field.displayName} must be at least ${min}`,
        });
      }
      if (max !== null && value > max) {
        violations.push({
          code: 'VALUE_ABOVE_MAXIMUM',
          rule: 'max',
          message: `${field.displayName} must be at most ${max}`,
        });
      }
      if (allowedValues !== null && !allowedValues.includes(value)) {
        violations.push({
          code: 'VALUE_NOT_ALLOWED',
          rule: 'allowedValues',
          message: `${field.displayName} must be one of ${allowedValues.join(', ')}`,
        });
      }
      break;
    }
    case 'decimal': {
      if (typeof value !== 'string') break;
      const { min, max, allowedValues } = field.validation;
      if (min !== null && compareDecimals(value, min) < 0) {
        violations.push({
          code: 'VALUE_BELOW_MINIMUM',
          rule: 'min',
          message: `${field.displayName} must be at least ${min}`,
        });
      }
      if (max !== null && compareDecimals(value, max) > 0) {
        violations.push({
          code: 'VALUE_ABOVE_MAXIMUM',
          rule: 'max',
          message: `${field.displayName} must be at most ${max}`,
        });
      }
      if (
        allowedValues !== null &&
        !allowedValues.some((allowed) => compareDecimals(allowed, value) === 0)
      ) {
        violations.push({
          code: 'VALUE_NOT_ALLOWED',
          rule: 'allowedValues',
          message: `${field.displayName} must be one of ${allowedValues.join(', ')}`,
        });
      }
      break;
    }
    case 'boolean':
    case 'date':
    case 'url':
    case 'image':
      break;
  }
  return violations;
}

export type FieldDefinitionIssueCode =
  'INVALID_FIELD_KEY' | 'INVALID_FIELD_RULE' | 'INVALID_FIELD_DEFAULT';

export interface FieldDefinitionIssue {
  readonly code: FieldDefinitionIssueCode;
  /** Path relative to the field, e.g. ["validation", "pattern"]. */
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/**
 * Semantic checks of one structurally valid field definition: reserved keys, consistent rules,
 * safe patterns and a default value that satisfies the field's own rules.
 */
export function checkFieldDefinition(field: DataField): FieldDefinitionIssue[] {
  const issues: FieldDefinitionIssue[] = [];
  if (isReservedFieldKey(field.key)) {
    issues.push({
      code: 'INVALID_FIELD_KEY',
      path: ['key'],
      message: field.key.startsWith('__')
        ? `Field keys starting with "__" are reserved for system fields`
        : `"${field.key}" cannot be used as a field key`,
    });
  }

  const rule = (path: string, message: string) =>
    issues.push({ code: 'INVALID_FIELD_RULE', path: ['validation', path], message });

  switch (field.type) {
    case 'string': {
      const { minLength, maxLength, pattern, allowedValues } = field.validation;
      if (minLength !== null && maxLength !== null && minLength > maxLength) {
        rule('minLength', 'The minimum length is greater than the maximum length');
      }
      if (pattern !== null) {
        const compiled = compileSafePattern(pattern);
        if (!compiled.ok) {
          rule('pattern', `Invalid pattern: ${compiled.error.message}`);
        }
      }
      if (allowedValues !== null) {
        if (new Set(allowedValues).size !== allowedValues.length) {
          rule('allowedValues', 'Allowed values must be unique');
        }
        for (const allowed of allowedValues) {
          const [violation] = checkFieldRules(
            { ...field, validation: { ...field.validation, allowedValues: null } },
            allowed,
          );
          if (violation) {
            rule(
              'allowedValues',
              `Allowed value "${allowed}" does not satisfy the other rules: ${violation.message}`,
            );
            break;
          }
        }
      }
      break;
    }
    case 'number':
    case 'decimal': {
      const { min, max, allowedValues } = field.validation;
      const greater =
        field.type === 'number'
          ? min !== null && max !== null && (min as number) > (max as number)
          : min !== null && max !== null && compareDecimals(min as string, max as string) > 0;
      if (greater) {
        rule('min', 'The minimum is greater than the maximum');
      }
      if (allowedValues !== null) {
        const distinct =
          field.type === 'number'
            ? new Set<string | number>(allowedValues).size === allowedValues.length
            : (allowedValues as string[]).every(
                (value, index, all) =>
                  all.findIndex((other) => compareDecimals(other, value) === 0) === index,
              );
        if (!distinct) rule('allowedValues', 'Allowed values must be unique');
        const outside = (allowedValues as (string | number)[]).find(
          (allowed) =>
            checkFieldRules(
              { ...field, validation: { ...field.validation, allowedValues: null } } as DataField,
              allowed,
            ).length > 0,
        );
        if (outside !== undefined) {
          rule('allowedValues', `Allowed value ${outside} is outside the minimum/maximum`);
        }
      }
      break;
    }
    case 'boolean':
    case 'date':
    case 'url':
    case 'image':
      break;
  }

  if (field.defaultValue !== null) {
    if (field.type === 'date' && !isRealCalendarDate(field.defaultValue)) {
      issues.push({
        code: 'INVALID_FIELD_DEFAULT',
        path: ['defaultValue'],
        message: `${field.defaultValue} is not a real calendar date`,
      });
    }
    const [violation] = checkFieldRules(field, field.defaultValue);
    if (violation) {
      issues.push({
        code: 'INVALID_FIELD_DEFAULT',
        path: ['defaultValue'],
        message: `The default value does not satisfy the field's rules: ${violation.message}`,
      });
    }
  }
  return issues;
}
