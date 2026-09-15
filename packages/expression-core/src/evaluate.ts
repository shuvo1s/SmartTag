import type { ExpressionNode } from './ast';
import { compareDecimals, negateDecimal } from './decimal';
import { findFunction, type CallEvaluation, type Evaluated } from './functions';
import { issue, type ExpressionIssue, type ExpressionValue } from './types';
import { isNumericType, isTextualType, numericToDecimal } from './values';

/** Supplies field values during evaluation. */
export interface EvaluationContext {
  /**
   * The value of a data field: a typed value, `NULL_VALUE` when the record has no value (and no
   * default), or undefined when the field does not exist.
   */
  fieldValue(key: string): ExpressionValue | undefined;
}

export type EvaluationResult =
  | {
      readonly ok: true;
      readonly value: ExpressionValue;
      /**
       * Fields without a value that the result depends on. fallback() and isEmpty() handle
       * missing values explicitly, so fields they guard are not listed.
       */
      readonly missingFields: readonly string[];
    }
  | { readonly ok: false; readonly error: ExpressionIssue };

class EvaluationFailure extends Error {
  constructor(readonly issue: ExpressionIssue) {
    super(issue.message);
  }
}

/**
 * Evaluates a parsed (and analyzed) expression. Pure and deterministic: the only inputs are the
 * syntax tree and field values; there is no access to globals, time, randomness, the network or
 * the host. Errors are returned, never thrown.
 */
export function evaluateExpression(
  ast: ExpressionNode,
  context: EvaluationContext,
): EvaluationResult {
  try {
    const result = evaluateNode(ast, context);
    return { ok: true, value: result.value, missingFields: result.missing };
  } catch (error) {
    if (error instanceof EvaluationFailure) return { ok: false, error: error.issue };
    return {
      ok: false,
      error: issue(
        'EXPRESSION_EVALUATION_ERROR',
        error instanceof RangeError ? error.message : 'The expression could not be evaluated',
        ast.start,
        ast.end,
      ),
    };
  }
}

const none: readonly string[] = [];

function merge(a: readonly string[], b: readonly string[]): readonly string[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  return [...new Set([...a, ...b])];
}

function fail(node: ExpressionNode, message: string): never {
  throw new EvaluationFailure(issue('EXPRESSION_EVALUATION_ERROR', message, node.start, node.end));
}

function evaluateNode(node: ExpressionNode, context: EvaluationContext): Evaluated {
  switch (node.kind) {
    case 'Literal':
      return { value: node.value, missing: none };

    case 'Field': {
      const value = context.fieldValue(node.key);
      if (value === undefined) fail(node, `There is no data field "${node.key}"`);
      assertWellFormed(value, node);
      return { value, missing: value.type === 'null' ? [node.key] : none };
    }

    case 'Call': {
      const definition = findFunction(node.name);
      if (!definition) fail(node, `There is no function "${node.name}"`);
      if (node.args.length < definition.minArgs || node.args.length > definition.maxArgs) {
        fail(node, `${node.name}() received the wrong number of arguments`);
      }
      const cache = new Map<number, Evaluated>();
      const call: CallEvaluation = {
        node,
        arg(index) {
          const cached = cache.get(index);
          if (cached) return cached;
          const argument = node.args[index];
          if (!argument) fail(node, `${node.name}() is missing argument ${index + 1}`);
          const evaluated = evaluateNode(argument, context);
          cache.set(index, evaluated);
          return evaluated;
        },
        fail(message, at = node) {
          return fail(at, message);
        },
      };
      return definition.evaluate(call);
    }

    case 'Unary': {
      const operand = evaluateNode(node.operand, context);
      const { value } = operand;
      if (node.operator === '!') {
        if (value.type !== 'boolean' && value.type !== 'null') fail(node, '"!" needs true/false');
        return {
          value: { type: 'boolean', value: !(value.type === 'boolean' && value.value) },
          missing: operand.missing,
        };
      }
      if (value.type === 'null') return operand;
      if (value.type === 'number') {
        return { value: { type: 'number', value: -value.value || 0 }, missing: operand.missing };
      }
      if (value.type === 'decimal') {
        return {
          value: { type: 'decimal', value: negateDecimal(value.value) },
          missing: operand.missing,
        };
      }
      return fail(node, '"-" needs a number');
    }

    case 'Binary': {
      if (node.operator === '&&' || node.operator === '||') {
        const left = evaluateNode(node.left, context);
        const leftTrue = truthy(left.value, node.left);
        if (node.operator === '&&' ? !leftTrue : leftTrue) {
          return { value: { type: 'boolean', value: leftTrue }, missing: left.missing };
        }
        const right = evaluateNode(node.right, context);
        return {
          value: { type: 'boolean', value: truthy(right.value, node.right) },
          missing: merge(left.missing, right.missing),
        };
      }
      const left = evaluateNode(node.left, context);
      const right = evaluateNode(node.right, context);
      const missing = merge(left.missing, right.missing);
      const result =
        node.operator === '==' || node.operator === '!='
          ? equals(left.value, right.value) === (node.operator === '==')
          : order(node, left.value, right.value);
      return { value: { type: 'boolean', value: result }, missing };
    }
  }
}

function truthy(value: ExpressionValue, node: ExpressionNode): boolean {
  if (value.type === 'null') return false;
  if (value.type !== 'boolean') fail(node, 'Expected true/false');
  return value.value;
}

function equals(a: ExpressionValue, b: ExpressionValue): boolean {
  if (a.type === 'null' || b.type === 'null') return a.type === b.type;
  if (isNumericType(a.type) && isNumericType(b.type)) {
    return compareDecimals(numericToDecimal(a), numericToDecimal(b)) === 0;
  }
  if (isTextualType(a.type) && isTextualType(b.type)) return a.value === b.value;
  return a.type === b.type && a.value === b.value;
}

function order(
  node: ExpressionNode & { kind: 'Binary' },
  a: ExpressionValue,
  b: ExpressionValue,
): boolean {
  if (a.type === 'null' || b.type === 'null') return false;
  let comparison: number;
  if (isNumericType(a.type) && isNumericType(b.type)) {
    comparison = compareDecimals(numericToDecimal(a), numericToDecimal(b));
  } else if (typeof a.value === 'string' && typeof b.value === 'string') {
    // Ordinal (code unit) order: identical on every platform, independent of locale.
    comparison = a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  } else {
    return fail(node, 'These values cannot be ordered');
  }
  switch (node.operator) {
    case '<':
      return comparison < 0;
    case '<=':
      return comparison <= 0;
    case '>':
      return comparison > 0;
    case '>=':
      return comparison >= 0;
    default:
      return fail(node, `Unexpected operator ${node.operator}`);
  }
}

/** Field values come from validated records, but the evaluator never trusts shapes blindly. */
function assertWellFormed(
  value: ExpressionValue,
  node: ExpressionNode,
): asserts value is ExpressionValue {
  const ok =
    value.type === 'null'
      ? value.value === null
      : value.type === 'number'
        ? typeof value.value === 'number' && Number.isFinite(value.value)
        : value.type === 'boolean'
          ? typeof value.value === 'boolean'
          : typeof value.value === 'string';
  if (!ok) fail(node, `The value of "${(node as { key?: string }).key ?? ''}" is malformed`);
}
