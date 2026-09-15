import type { ExpressionNode } from './ast';
import { formatDecimal, roundDecimal } from './decimal';
import { EXPRESSION_LIMITS } from './limits';
import {
  NULL_VALUE,
  issue,
  type ExpressionIssue,
  type ExpressionType,
  type ExpressionValue,
} from './types';
import {
  TEXT_CONVERTIBLE_TYPES,
  describeType,
  isEmptyValue,
  numericToDecimal,
  unifyTypes,
  valueToText,
} from './values';

/** Result of evaluating a sub-expression: its value and the missing data fields it depends on. */
export interface Evaluated {
  readonly value: ExpressionValue;
  /** Fields that had no value and were not handled by fallback()/isEmpty(). */
  readonly missing: readonly string[];
}

/** Type used during analysis; `unknown` suppresses follow-up errors after an earlier one. */
export type AnalysisType = ExpressionType | 'unknown';

export type TypeCheck = { readonly type: AnalysisType } | { readonly issue: ExpressionIssue };

export interface CallEvaluation {
  readonly node: ExpressionNode & { kind: 'Call' };
  /** Evaluates argument `index` on demand (if() and fallback() are lazy). */
  arg(index: number): Evaluated;
  fail(message: string, node?: ExpressionNode): never;
}

export interface FunctionDefinition {
  readonly name: string;
  readonly minArgs: number;
  readonly maxArgs: number;
  /** Human-readable signature for editors, e.g. `formatNumber(number, digits, [decimal], [group])`. */
  readonly signature: string;
  readonly description: string;
  readonly example: string;
  check(types: readonly AnalysisType[], args: readonly ExpressionNode[]): TypeCheck;
  evaluate(call: CallEvaluation): Evaluated;
}

const mergeMissing = (...lists: (readonly string[])[]): string[] => [...new Set(lists.flat())];

function mismatch(node: ExpressionNode, message: string): TypeCheck {
  return { issue: issue('TYPE_MISMATCH', message, node.start, node.end) };
}

function acceptsTypes(
  name: string,
  accepted: readonly ExpressionType[],
  label: string,
): (type: AnalysisType, node: ExpressionNode) => TypeCheck | null {
  return (type, node) =>
    type === 'unknown' || accepted.includes(type)
      ? null
      : mismatch(node, `${name}() expects ${label}, but this is ${describeType(type)}`);
}

function checkText(result: string, call: CallEvaluation): ExpressionValue {
  if (result.length > EXPRESSION_LIMITS.maxTextLength) {
    call.fail(`The result is longer than ${EXPRESSION_LIMITS.maxTextLength} characters`);
  }
  return { type: 'string', value: result };
}

function fractionDigitsArgument(call: CallEvaluation, index: number, fallback: number): number {
  if (call.node.args.length <= index) return fallback;
  const { value } = call.arg(index);
  const argNode = call.node.args[index];
  if (value.type !== 'number' && value.type !== 'decimal') {
    call.fail('The number of digits must be a whole number from 0 to 12', argNode);
  }
  const digits = Number(numericToDecimal(value));
  if (!Number.isInteger(digits) || digits < 0 || digits > EXPRESSION_LIMITS.maxFractionDigits) {
    call.fail('The number of digits must be a whole number from 0 to 12', argNode);
  }
  return digits;
}

function separatorArgument(call: CallEvaluation, index: number, fallback: string): string {
  if (call.node.args.length <= index) return fallback;
  const { value } = call.arg(index);
  const argNode = call.node.args[index];
  if (value.type !== 'string' || value.value.length > 3 || /\d/.test(value.value)) {
    call.fail('Separators must be text of at most 3 characters without digits', argNode);
  }
  return value.value;
}

/** Literal whole-number digits are checked before evaluation when possible. */
function checkDigitsLiteral(node: ExpressionNode | undefined): TypeCheck | null {
  if (node?.kind !== 'Literal') return null;
  const { value } = node;
  if (value.type !== 'decimal') {
    return mismatch(node, 'The number of digits must be a whole number from 0 to 12');
  }
  const digits = Number(value.value);
  return Number.isInteger(digits) && digits >= 0 && digits <= EXPRESSION_LIMITS.maxFractionDigits
    ? null
    : mismatch(node, 'The number of digits must be a whole number from 0 to 12');
}

function textTransform(
  name: string,
  description: string,
  example: string,
  transform: (text: string) => string,
): FunctionDefinition {
  const accept = acceptsTypes(name, ['string', 'url', 'date', 'null'], 'text');
  return {
    name,
    minArgs: 1,
    maxArgs: 1,
    signature: `${name}(text)`,
    description,
    example,
    check: (types, args) => accept(types[0]!, args[0]!) ?? { type: 'string' },
    evaluate(call) {
      const input = call.arg(0);
      const text = valueToText(input.value);
      return {
        value: text === null ? NULL_VALUE : checkText(transform(text), call),
        missing: input.missing,
      };
    },
  };
}

const concatAccepts = acceptsTypes(
  'concat',
  TEXT_CONVERTIBLE_TYPES,
  'text, numbers, dates or URLs',
);
const numericAccepts = (name: string) =>
  acceptsTypes(name, ['number', 'decimal', 'null'], 'a number');

const DEFINITIONS: readonly FunctionDefinition[] = [
  {
    name: 'concat',
    minArgs: 1,
    maxArgs: EXPRESSION_LIMITS.maxArguments,
    signature: 'concat(value, …)',
    description: 'Joins values into one text. Missing values count as empty text.',
    example: 'concat("SIZE: ", size)',
    check(types, args) {
      for (const [index, type] of types.entries()) {
        const problem = concatAccepts(type, args[index]!);
        if (problem) return problem;
      }
      return { type: 'string' };
    },
    evaluate(call) {
      let text = '';
      let missing: string[] = [];
      for (let index = 0; index < call.node.args.length; index += 1) {
        const part = call.arg(index);
        text += valueToText(part.value) ?? '';
        missing = mergeMissing(missing, part.missing);
        if (text.length > EXPRESSION_LIMITS.maxTextLength) break;
      }
      return { value: checkText(text, call), missing };
    },
  },
  textTransform('upper', 'Text in upper case (locale independent).', 'upper(color)', (text) =>
    text.toUpperCase(),
  ),
  textTransform('lower', 'Text in lower case (locale independent).', 'lower(color)', (text) =>
    text.toLowerCase(),
  ),
  textTransform(
    'trim',
    'Text without leading and trailing white space.',
    'trim(product_name)',
    (text) => text.trim(),
  ),
  {
    name: 'fallback',
    minArgs: 2,
    maxArgs: EXPRESSION_LIMITS.maxArguments,
    signature: 'fallback(value, alternative, …)',
    description: 'The first value that is not missing or empty.',
    example: 'fallback(short_name, product_name)',
    check(types, args) {
      let result: AnalysisType = 'null';
      for (const [index, type] of types.entries()) {
        if (type === 'unknown' || result === 'unknown') {
          result = 'unknown';
          continue;
        }
        const unified = unifyTypes(result, type);
        if (!unified) {
          return mismatch(
            args[index]!,
            `fallback() alternatives must have compatible types; this is ${describeType(type)}, earlier values are ${describeType(result)}`,
          );
        }
        result = unified;
      }
      return { type: result };
    },
    evaluate(call) {
      let missing: string[] = [];
      let last: ExpressionValue = NULL_VALUE;
      for (let index = 0; index < call.node.args.length; index += 1) {
        const candidate = call.arg(index);
        if (!isEmptyValue(candidate.value)) {
          return { value: candidate.value, missing: candidate.missing };
        }
        last = candidate.value;
        missing = mergeMissing(missing, candidate.missing);
      }
      return { value: last, missing };
    },
  },
  {
    name: 'round',
    minArgs: 1,
    maxArgs: 2,
    signature: 'round(number, [digits])',
    description: 'Rounds half away from zero to a number of fraction digits (default 0).',
    example: 'round(price, 2)',
    check(types, args) {
      const first = numericAccepts('round')(types[0]!, args[0]!);
      if (first) return first;
      if (types.length > 1) {
        const second = acceptsTypes(
          'round',
          ['number', 'decimal'],
          'a whole number of digits',
        )(types[1]!, args[1]!);
        if (second) return second;
        const literal = checkDigitsLiteral(args[1]);
        if (literal) return literal;
      }
      return { type: types[0] === 'null' ? 'null' : types[0]! };
    },
    evaluate(call) {
      const input = call.arg(0);
      const digits = fractionDigitsArgument(call, 1, 0);
      const { value } = input;
      if (value.type === 'null') return input;
      if (value.type !== 'number' && value.type !== 'decimal') {
        call.fail('round() expects a number', call.node.args[0]);
      }
      const rounded = roundDecimal(numericToDecimal(value), digits);
      return {
        value:
          value.type === 'number'
            ? { type: 'number', value: Number(rounded) }
            : { type: 'decimal', value: rounded },
        missing: input.missing,
      };
    },
  },
  {
    name: 'formatNumber',
    minArgs: 2,
    maxArgs: 4,
    signature: 'formatNumber(number, digits, [decimalSeparator], [groupSeparator])',
    description:
      'Rounds and writes a number with explicit separators (defaults "." and none). Never uses the browser locale.',
    example: 'formatNumber(price, 2, ",", ".")',
    check(types, args) {
      const first = numericAccepts('formatNumber')(types[0]!, args[0]!);
      if (first) return first;
      const digits = acceptsTypes(
        'formatNumber',
        ['number', 'decimal'],
        'a whole number of digits',
      )(types[1]!, args[1]!);
      if (digits) return digits;
      const literal = checkDigitsLiteral(args[1]);
      if (literal) return literal;
      for (let index = 2; index < types.length; index += 1) {
        const separator = acceptsTypes(
          'formatNumber',
          ['string'],
          'separator text',
        )(types[index]!, args[index]!);
        if (separator) return separator;
      }
      return { type: 'string' };
    },
    evaluate(call) {
      const input = call.arg(0);
      const digits = fractionDigitsArgument(call, 1, 0);
      const decimalSeparator = separatorArgument(call, 2, '.');
      const groupSeparator = separatorArgument(call, 3, '');
      const { value } = input;
      if (value.type === 'null') return { value: NULL_VALUE, missing: input.missing };
      if (value.type !== 'number' && value.type !== 'decimal') {
        call.fail('formatNumber() expects a number', call.node.args[0]);
      }
      const text = formatDecimal(numericToDecimal(value), {
        fractionDigits: digits,
        decimalSeparator,
        groupSeparator,
      });
      return { value: checkText(text, call), missing: input.missing };
    },
  },
  {
    name: 'if',
    minArgs: 3,
    maxArgs: 3,
    signature: 'if(condition, then, else)',
    description: 'Chooses between two values. A missing condition counts as false.',
    example: 'if(is_sustainable, "RECYCLED", "")',
    check(types, args) {
      const condition = types[0]!;
      if (condition !== 'unknown' && condition !== 'boolean' && condition !== 'null') {
        return mismatch(
          args[0]!,
          `if() needs a true/false condition, but this is ${describeType(condition)}`,
        );
      }
      const [, whenTrue, whenFalse] = types;
      if (whenTrue === 'unknown' || whenFalse === 'unknown') return { type: 'unknown' };
      const unified = unifyTypes(whenTrue!, whenFalse!);
      return unified
        ? { type: unified }
        : mismatch(
            args[2]!,
            `Both results of if() must have compatible types (${describeType(whenTrue!)} and ${describeType(whenFalse!)})`,
          );
    },
    evaluate(call) {
      const condition = call.arg(0);
      const chosen = call.arg(condition.value.type === 'boolean' && condition.value.value ? 1 : 2);
      return { value: chosen.value, missing: mergeMissing(condition.missing, chosen.missing) };
    },
  },
  {
    name: 'isEmpty',
    minArgs: 1,
    maxArgs: 1,
    signature: 'isEmpty(value)',
    description: 'true when the value is missing or empty text.',
    example: 'if(isEmpty(size), "", concat("SIZE: ", size))',
    check: () => ({ type: 'boolean' }),
    evaluate(call) {
      return { value: { type: 'boolean', value: isEmptyValue(call.arg(0).value) }, missing: [] };
    },
  },
];

/**
 * The complete, closed set of functions. Looked up in a null-prototype map, so names such as
 * "constructor", "__proto__" or "toString" can never resolve to anything.
 */
const REGISTRY: ReadonlyMap<string, FunctionDefinition> = new Map(
  DEFINITIONS.map((definition) => [definition.name, Object.freeze(definition)]),
);

export function findFunction(name: string): FunctionDefinition | undefined {
  return REGISTRY.get(name);
}

export interface FunctionInfo {
  readonly name: string;
  readonly signature: string;
  readonly description: string;
  readonly example: string;
}

/** Descriptions for editors (Insert function menus, help). */
export const EXPRESSION_FUNCTIONS: readonly FunctionInfo[] = DEFINITIONS.map(
  ({ name, signature, description, example }) => ({ name, signature, description, example }),
);
