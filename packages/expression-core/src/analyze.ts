import { expressionDependencies, type ExpressionNode } from './ast';
import { findFunction, type AnalysisType } from './functions';
import { parseExpression } from './parser';
import { issue, type ExpressionIssue, type ExpressionType, type ValueType } from './types';
import { areComparable, areOrderable, describeType, isNumericType } from './values';

/** What analysis needs to know about the data fields an expression may reference. */
export interface ExpressionEnvironment {
  /** The declared type of a data field, or undefined when no such field exists. */
  fieldType(key: string): ValueType | undefined;
}

export type ExpressionAnalysis =
  | {
      readonly ok: true;
      readonly ast: ExpressionNode;
      /** Static result type; `null` only for the literal null. */
      readonly resultType: ExpressionType;
      /** Field keys the expression reads, in first-use order. */
      readonly dependencies: readonly string[];
      readonly issues: readonly [];
    }
  | {
      readonly ok: false;
      /** Present when the expression parsed but failed checks. */
      readonly ast: ExpressionNode | null;
      readonly resultType: null;
      readonly dependencies: readonly string[];
      readonly issues: readonly ExpressionIssue[];
    };

/**
 * Parses and checks an expression against the fields of a data schema: syntax, limits, unknown
 * fields, unknown functions, argument counts and types. Nothing is evaluated.
 */
export function analyzeExpression(
  source: string,
  environment: ExpressionEnvironment,
): ExpressionAnalysis {
  const parsed = parseExpression(source);
  if (!parsed.ok) {
    return { ok: false, ast: null, resultType: null, dependencies: [], issues: [parsed.error] };
  }
  return analyzeParsedExpression(parsed.ast, environment);
}

export function analyzeParsedExpression(
  ast: ExpressionNode,
  environment: ExpressionEnvironment,
): ExpressionAnalysis {
  const issues: ExpressionIssue[] = [];
  const resultType = typeOf(ast, environment, issues);
  const dependencies = expressionDependencies(ast);
  if (issues.length > 0 || resultType === 'unknown') {
    return { ok: false, ast, resultType: null, dependencies, issues };
  }
  return { ok: true, ast, resultType, dependencies, issues: [] };
}

function typeOf(
  node: ExpressionNode,
  environment: ExpressionEnvironment,
  issues: ExpressionIssue[],
): AnalysisType {
  switch (node.kind) {
    case 'Literal':
      return node.value.type;

    case 'Field': {
      const type = lookupFieldType(environment, node.key);
      if (type === undefined) {
        issues.push(
          issue('UNKNOWN_FIELD', `There is no data field "${node.key}"`, node.start, node.end),
        );
        return 'unknown';
      }
      return type;
    }

    case 'Call': {
      const definition = findFunction(node.name);
      const argTypes = node.args.map((arg) => typeOf(arg, environment, issues));
      if (!definition) {
        issues.push(
          issue(
            'UNKNOWN_FUNCTION',
            `There is no function "${node.name}"`,
            node.start,
            node.nameEnd,
          ),
        );
        return 'unknown';
      }
      if (node.args.length < definition.minArgs || node.args.length > definition.maxArgs) {
        const expected =
          definition.minArgs === definition.maxArgs
            ? `${definition.minArgs}`
            : definition.maxArgs >= 32
              ? `at least ${definition.minArgs}`
              : `${definition.minArgs} to ${definition.maxArgs}`;
        issues.push(
          issue(
            'WRONG_ARGUMENT_COUNT',
            `${node.name}() takes ${expected} argument${expected === '1' ? '' : 's'}, but ${node.args.length} ${node.args.length === 1 ? 'was' : 'were'} given`,
            node.start,
            node.end,
          ),
        );
        return 'unknown';
      }
      const checked = definition.check(argTypes, node.args);
      if ('issue' in checked) {
        issues.push(checked.issue);
        return 'unknown';
      }
      return checked.type;
    }

    case 'Unary': {
      const operand = typeOf(node.operand, environment, issues);
      if (operand === 'unknown') return 'unknown';
      if (node.operator === '!') {
        if (operand !== 'boolean' && operand !== 'null') {
          issues.push(
            mismatch(node.operand, `"!" needs true/false, but this is ${describeType(operand)}`),
          );
          return 'unknown';
        }
        return 'boolean';
      }
      if (!isNumericType(operand) && operand !== 'null') {
        issues.push(
          mismatch(node.operand, `"-" needs a number, but this is ${describeType(operand)}`),
        );
        return 'unknown';
      }
      return operand;
    }

    case 'Binary': {
      const left = typeOf(node.left, environment, issues);
      const right = typeOf(node.right, environment, issues);
      if (left === 'unknown' || right === 'unknown') return 'unknown';
      switch (node.operator) {
        case '&&':
        case '||':
          for (const [side, type] of [
            [node.left, left],
            [node.right, right],
          ] as const) {
            if (type !== 'boolean' && type !== 'null') {
              issues.push(
                mismatch(
                  side,
                  `"${node.operator}" needs true/false, but this is ${describeType(type)}`,
                ),
              );
              return 'unknown';
            }
          }
          return 'boolean';
        case '==':
        case '!=':
          if (!areComparable(left, right)) {
            issues.push(
              mismatch(node, `Cannot compare ${describeType(left)} with ${describeType(right)}`),
            );
            return 'unknown';
          }
          return 'boolean';
        case '<':
        case '<=':
        case '>':
        case '>=':
          if (!areOrderable(left, right)) {
            issues.push(
              mismatch(node, `Cannot order ${describeType(left)} and ${describeType(right)}`),
            );
            return 'unknown';
          }
          return 'boolean';
      }
    }
  }
}

function lookupFieldType(environment: ExpressionEnvironment, key: string): ValueType | undefined {
  try {
    return environment.fieldType(key);
  } catch {
    return undefined;
  }
}

function mismatch(node: ExpressionNode, message: string): ExpressionIssue {
  return issue('TYPE_MISMATCH', message, node.start, node.end);
}
