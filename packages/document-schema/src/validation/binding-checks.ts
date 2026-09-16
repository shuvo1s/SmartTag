import {
  analyzeExpression,
  describeType,
  type ExpressionAnalysis,
  type ExpressionIssue,
} from '@smarttag/expression-core';
import {
  BINDABLE_PROPERTY_KIND_LABELS,
  isExpressionTypeCompatible,
  isFieldTypeCompatible,
  type BindablePropertyKind,
  type PropertyBinding,
} from '../bindings';
import type { DataField } from '../data-schema';
import { PRODUCTION_SYSTEM_FIELDS } from '../system-fields';
import type { DocumentIssueCode } from './issues';

export interface BindingCheckIssue {
  readonly code: DocumentIssueCode;
  /** Path relative to the binding, e.g. ["field"] or ["expression"]. */
  readonly path: readonly string[];
  readonly message: string;
  /** Character range inside the expression, for EXPRESSION bindings. */
  readonly range: { readonly start: number; readonly end: number } | null;
}

/** Field lookup used by binding checks (a Map built from `dataSchema.fields`). */
export type FieldLookup = ReadonlyMap<string, DataField>;

/**
 * The fields a binding may use: the schema's own fields plus the production system fields, whose
 * values come from the production context rather than from the data record (see system-fields.ts).
 * A schema field can never use a reserved "__" key, so the two sets never collide.
 */
export function fieldLookup(fields: readonly DataField[]): FieldLookup {
  const lookup = new Map(PRODUCTION_SYSTEM_FIELDS.map((field) => [field.key, field]));
  for (const field of fields) lookup.set(field.key, field);
  return lookup;
}

/** Analyzes an expression against the fields of a data schema. */
export function analyzeBindingExpression(
  expression: string,
  fields: FieldLookup,
): ExpressionAnalysis {
  return analyzeExpression(expression, { fieldType: (key) => fields.get(key)?.type });
}

function expressionIssue(issue: ExpressionIssue): BindingCheckIssue {
  return {
    code: issue.code === 'EXPRESSION_EVALUATION_ERROR' ? 'EXPRESSION_PARSE_ERROR' : issue.code,
    path: ['expression'],
    message: issue.message,
    range: { start: issue.start, end: issue.end },
  };
}

/**
 * Checks one binding of one property against the data schema: the field exists and has a
 * compatible type, or the expression parses, type-checks and produces a compatible type.
 * Used by canonical validation and by editor commands, so both report identical problems.
 */
export function checkPropertyBinding(
  property: string,
  kind: BindablePropertyKind,
  binding: PropertyBinding,
  fields: FieldLookup,
): BindingCheckIssue[] {
  switch (binding.mode) {
    case 'STATIC':
      return [];
    case 'FIELD': {
      const field = fields.get(binding.field);
      if (!field) {
        return [
          {
            code: 'UNKNOWN_BINDING_FIELD',
            path: ['field'],
            message: `Property "${property}" is bound to unknown data field "${binding.field}"`,
            range: null,
          },
        ];
      }
      if (!isFieldTypeCompatible(kind, field.type)) {
        return [
          {
            code: 'INCOMPATIBLE_BINDING',
            path: ['field'],
            message: `Data field "${field.key}" (${describeType(field.type)}) cannot be used for "${property}", which needs ${BINDABLE_PROPERTY_KIND_LABELS[kind]}`,
            range: null,
          },
        ];
      }
      return [];
    }
    case 'EXPRESSION': {
      const analysis = analyzeBindingExpression(binding.expression, fields);
      if (!analysis.ok) return analysis.issues.map(expressionIssue);
      if (!isExpressionTypeCompatible(kind, analysis.resultType)) {
        return [
          {
            code: 'INCOMPATIBLE_BINDING',
            path: ['expression'],
            message: `The expression produces ${describeType(analysis.resultType)}, but "${property}" needs ${BINDABLE_PROPERTY_KIND_LABELS[kind]}`,
            range: { start: 0, end: binding.expression.length },
          },
        ];
      }
      return [];
    }
  }
}
