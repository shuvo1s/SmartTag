import { EXPRESSION_LIMITS } from './limits';
import { issue, type ExpressionIssue } from './types';

export type TokenKind =
  | 'NUMBER'
  | 'STRING'
  | 'IDENTIFIER'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'NOT'
  | 'MINUS'
  | 'AND'
  | 'OR'
  | 'EQ'
  | 'NEQ'
  | 'LT'
  | 'LTE'
  | 'GT'
  | 'GTE'
  | 'EOF';

export interface Token {
  readonly kind: TokenKind;
  /** Source text for NUMBER/IDENTIFIER/operators; the decoded value for STRING. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export type LexResult =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | { readonly ok: false; readonly error: ExpressionIssue };

const OPERATORS: readonly (readonly [string, TokenKind])[] = [
  ['&&', 'AND'],
  ['||', 'OR'],
  ['==', 'EQ'],
  ['!=', 'NEQ'],
  ['<=', 'LTE'],
  ['>=', 'GTE'],
  ['<', 'LT'],
  ['>', 'GT'],
  ['!', 'NOT'],
  ['-', 'MINUS'],
  ['(', 'LPAREN'],
  [')', 'RPAREN'],
  [',', 'COMMA'],
];

/** Explanations for characters people commonly try from JavaScript or spreadsheets. */
const UNSUPPORTED_CHARACTERS: Readonly<Record<string, string>> = {
  '.': 'Property access is not supported; reference data fields by key',
  '+': 'Arithmetic is not supported; use concat() to join text',
  '*': 'Arithmetic is not supported',
  '/': 'Arithmetic is not supported',
  '%': 'Arithmetic is not supported',
  '=': 'Use == to compare values',
  '&': 'Use && for "and"',
  '|': 'Use || for "or"',
  '`': 'Template literals are not supported; use concat()',
  '[': 'Indexing is not supported',
  ']': 'Indexing is not supported',
  '{': 'Objects and blocks are not supported',
  '}': 'Objects and blocks are not supported',
  ';': 'Statements are not supported; an expression is a single value',
  $: 'Placeholders are not supported; reference data fields by key',
  '?': 'Use if(condition, then, else)',
  ':': 'Use if(condition, then, else)',
};

const ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\',
  '"': '"',
  "'": "'",
  n: '\n',
  t: '\t',
};

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

/** Splits expression source into tokens. Never throws; the first problem is returned. */
export function tokenize(source: string): LexResult {
  if (source.length > EXPRESSION_LIMITS.maxSourceLength) {
    return {
      ok: false,
      error: issue(
        'EXPRESSION_LIMIT_EXCEEDED',
        `Expressions are limited to ${EXPRESSION_LIMITS.maxSourceLength} characters`,
        EXPRESSION_LIMITS.maxSourceLength,
        source.length,
      ),
    };
  }
  const tokens: Token[] = [];
  let index = 0;
  const fail = (message: string, start: number, end = start + 1): LexResult => ({
    ok: false,
    error: issue('EXPRESSION_PARSE_ERROR', message, start, Math.min(end, source.length)),
  });

  while (index < source.length) {
    const char = source[index]!;
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1;
      continue;
    }

    if (isDigit(char)) {
      const start = index;
      while (isDigit(source[index])) index += 1;
      if (source[index] === '.') {
        if (!isDigit(source[index + 1])) {
          return fail('A decimal point must be followed by digits', index);
        }
        index += 1;
        while (isDigit(source[index])) index += 1;
      }
      if (isIdentifierStart(source[index])) {
        return fail('Numbers must be plain decimals such as 39.95', start, index + 1);
      }
      const text = source.slice(start, index);
      const [integer = '', fraction = ''] = text.split('.');
      if (integer.length > 20 || fraction.length > 12) {
        return fail('Numbers are limited to 20 integer and 12 fraction digits', start, index);
      }
      tokens.push({ kind: 'NUMBER', text, start, end: index });
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      while (isIdentifierPart(source[index])) index += 1;
      const text = source.slice(start, index);
      if (text.length > EXPRESSION_LIMITS.maxIdentifierLength) {
        return {
          ok: false,
          error: issue(
            'EXPRESSION_LIMIT_EXCEEDED',
            `Names are limited to ${EXPRESSION_LIMITS.maxIdentifierLength} characters`,
            start,
            index,
          ),
        };
      }
      tokens.push({ kind: 'IDENTIFIER', text, start, end: index });
      continue;
    }

    if (char === '"' || char === "'") {
      const start = index;
      const quote = char;
      index += 1;
      let value = '';
      let closed = false;
      while (index < source.length) {
        const current = source[index]!;
        if (current === quote) {
          closed = true;
          index += 1;
          break;
        }
        if (current === '\n' || current === '\r') {
          return fail('Strings cannot span lines; use "\\n" for a line break', index);
        }
        if (current === '\\') {
          const escaped = source[index + 1];
          const decoded = escaped === undefined ? undefined : ESCAPES[escaped];
          if (decoded === undefined) {
            return fail('Unsupported escape; use \\\\, \\", \\\', \\n or \\t', index, index + 2);
          }
          value += decoded;
          index += 2;
          continue;
        }
        value += current;
        index += 1;
      }
      if (!closed) {
        return fail('Unterminated string', start, source.length);
      }
      if (value.length > EXPRESSION_LIMITS.maxStringLiteralLength) {
        return {
          ok: false,
          error: issue(
            'EXPRESSION_LIMIT_EXCEEDED',
            `Text literals are limited to ${EXPRESSION_LIMITS.maxStringLiteralLength} characters`,
            start,
            index,
          ),
        };
      }
      tokens.push({ kind: 'STRING', text: value, start, end: index });
      continue;
    }

    const operator = OPERATORS.find(([text]) => source.startsWith(text, index));
    if (operator) {
      const [text, kind] = operator;
      tokens.push({ kind, text, start: index, end: index + text.length });
      index += text.length;
      continue;
    }

    const explanation = UNSUPPORTED_CHARACTERS[char];
    return fail(
      explanation
        ? `Unexpected "${char}": ${explanation}`
        : `Unexpected character "${describeCharacter(source, index)}"`,
      index,
      index + (source.codePointAt(index)! > 0xffff ? 2 : 1),
    );
  }
  tokens.push({ kind: 'EOF', text: '', start: source.length, end: source.length });
  return { ok: true, tokens };
}

function describeCharacter(source: string, index: number): string {
  const codePoint = source.codePointAt(index)!;
  if (codePoint < 0x20 || codePoint === 0x7f) {
    return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return String.fromCodePoint(codePoint);
}
