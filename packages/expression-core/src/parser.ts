import type { BinaryOperator, ExpressionNode } from './ast';
import { normalizeDecimal } from './decimal';
import { tokenize, type Token, type TokenKind } from './lexer';
import { EXPRESSION_LIMITS } from './limits';
import { issue, type ExpressionIssue } from './types';

export type ParseResult =
  | { readonly ok: true; readonly ast: ExpressionNode }
  | { readonly ok: false; readonly error: ExpressionIssue };

class ParseFailure extends Error {
  constructor(readonly issue: ExpressionIssue) {
    super(issue.message);
  }
}

const KEYWORDS = new Set(['true', 'false', 'null']);

/**
 * Grammar (lowest to highest precedence):
 *
 *   expression := or
 *   or         := and ( "||" and )*
 *   and        := equality ( "&&" equality )*
 *   equality   := comparison ( ( "==" | "!=" ) comparison )*
 *   comparison := unary ( ( "<" | "<=" | ">" | ">=" ) unary )*
 *   unary      := ( "!" | "-" ) unary | primary
 *   primary    := NUMBER | STRING | true | false | null
 *               | IDENTIFIER "(" [ expression ( "," expression )* ] ")"   function call
 *               | IDENTIFIER                                              data field
 *               | "(" expression ")"
 *
 * There is no assignment, member access, indexing, arithmetic, lambda or statement syntax, so
 * nothing in an expression can reach host objects or execute code.
 */
export function parseExpression(source: string): ParseResult {
  const lexed = tokenize(source);
  if (!lexed.ok) return lexed;
  const parser = new Parser(lexed.tokens);
  try {
    const ast = parser.parseRoot();
    return { ok: true, ast };
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, error: error.issue };
    throw error;
  }
}

class Parser {
  private index = 0;
  private depth = 0;
  private nodes = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parseRoot(): ExpressionNode {
    const first = this.peek();
    if (first.kind === 'EOF') {
      throw new ParseFailure(issue('EXPRESSION_PARSE_ERROR', 'The expression is empty', 0));
    }
    const node = this.expression();
    const next = this.peek();
    if (next.kind !== 'EOF') {
      throw this.unexpected(next, 'Expected the end of the expression');
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private advance(): Token {
    const token = this.tokens[this.index]!;
    if (token.kind !== 'EOF') this.index += 1;
    return token;
  }

  private match(...kinds: TokenKind[]): Token | null {
    return kinds.includes(this.peek().kind) ? this.advance() : null;
  }

  private count(start: number): void {
    this.nodes += 1;
    if (this.nodes > EXPRESSION_LIMITS.maxNodes) {
      throw new ParseFailure(
        issue(
          'EXPRESSION_LIMIT_EXCEEDED',
          `Expressions are limited to ${EXPRESSION_LIMITS.maxNodes} elements`,
          start,
        ),
      );
    }
  }

  private enter(start: number): void {
    this.depth += 1;
    if (this.depth > EXPRESSION_LIMITS.maxDepth) {
      throw new ParseFailure(
        issue(
          'EXPRESSION_LIMIT_EXCEEDED',
          `Expressions are limited to ${EXPRESSION_LIMITS.maxDepth} levels of nesting`,
          start,
        ),
      );
    }
  }

  private leave(): void {
    this.depth -= 1;
  }

  private unexpected(token: Token, expectation: string): ParseFailure {
    const found = token.kind === 'EOF' ? 'the end of the expression' : `"${describe(token)}"`;
    return new ParseFailure(
      issue('EXPRESSION_PARSE_ERROR', `${expectation}, found ${found}`, token.start, token.end),
    );
  }

  private expression(): ExpressionNode {
    return this.binary(0);
  }

  private static readonly LEVELS: readonly (readonly TokenKind[])[] = [
    ['OR'],
    ['AND'],
    ['EQ', 'NEQ'],
    ['LT', 'LTE', 'GT', 'GTE'],
  ];

  private binary(level: number): ExpressionNode {
    const kinds = Parser.LEVELS[level];
    if (!kinds) return this.unary();
    let left = this.binary(level + 1);
    let operator = this.match(...kinds);
    while (operator) {
      this.enter(operator.start);
      const right = this.binary(level + 1);
      this.leave();
      this.count(operator.start);
      left = {
        kind: 'Binary',
        operator: operator.text as BinaryOperator,
        left,
        right,
        start: left.start,
        end: right.end,
      };
      operator = this.match(...kinds);
    }
    return left;
  }

  private unary(): ExpressionNode {
    const operator = this.match('NOT', 'MINUS');
    if (!operator) return this.primary();
    this.enter(operator.start);
    const operand = this.unary();
    this.leave();
    this.count(operator.start);
    return {
      kind: 'Unary',
      operator: operator.kind === 'NOT' ? '!' : '-',
      operand,
      start: operator.start,
      end: operand.end,
    };
  }

  private primary(): ExpressionNode {
    const token = this.advance();
    switch (token.kind) {
      case 'NUMBER':
        this.count(token.start);
        return {
          kind: 'Literal',
          value: { type: 'decimal', value: normalizeDecimal(token.text)! },
          start: token.start,
          end: token.end,
        };
      case 'STRING':
        this.count(token.start);
        return {
          kind: 'Literal',
          value: { type: 'string', value: token.text },
          start: token.start,
          end: token.end,
        };
      case 'IDENTIFIER':
        return this.identifier(token);
      case 'LPAREN': {
        this.enter(token.start);
        const inner = this.expression();
        this.leave();
        const close = this.match('RPAREN');
        if (!close) throw this.unexpected(this.peek(), 'Expected ")"');
        return { ...inner, start: token.start, end: close.end };
      }
      default:
        throw this.unexpected(token, 'Expected a value, field or function call');
    }
  }

  private identifier(token: Token): ExpressionNode {
    this.count(token.start);
    if (KEYWORDS.has(token.text)) {
      const value =
        token.text === 'null'
          ? ({ type: 'null', value: null } as const)
          : ({ type: 'boolean', value: token.text === 'true' } as const);
      return { kind: 'Literal', value, start: token.start, end: token.end };
    }
    if (!this.match('LPAREN')) {
      return { kind: 'Field', key: token.text, start: token.start, end: token.end };
    }
    this.enter(token.start);
    const args: ExpressionNode[] = [];
    if (this.peek().kind !== 'RPAREN') {
      do {
        if (args.length >= EXPRESSION_LIMITS.maxArguments) {
          throw new ParseFailure(
            issue(
              'EXPRESSION_LIMIT_EXCEEDED',
              `Functions accept at most ${EXPRESSION_LIMITS.maxArguments} arguments`,
              this.peek().start,
            ),
          );
        }
        args.push(this.expression());
      } while (this.match('COMMA'));
    }
    this.leave();
    const close = this.match('RPAREN');
    if (!close) throw this.unexpected(this.peek(), 'Expected "," or ")"');
    return {
      kind: 'Call',
      name: token.text,
      nameEnd: token.end,
      args,
      start: token.start,
      end: close.end,
    };
  }
}

function describe(token: Token): string {
  return token.kind === 'STRING' ? `"${token.text}"` : token.text;
}
