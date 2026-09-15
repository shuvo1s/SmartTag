import type { ExpressionValue } from './types';

interface NodeBase {
  /** UTF-16 offsets into the source. */
  readonly start: number;
  readonly end: number;
}

export interface LiteralNode extends NodeBase {
  readonly kind: 'Literal';
  readonly value: ExpressionValue;
}

/** A reference to a data field by its stable key. */
export interface FieldNode extends NodeBase {
  readonly kind: 'Field';
  readonly key: string;
}

export interface CallNode extends NodeBase {
  readonly kind: 'Call';
  readonly name: string;
  readonly nameEnd: number;
  readonly args: readonly ExpressionNode[];
}

export type UnaryOperator = '!' | '-';

export interface UnaryNode extends NodeBase {
  readonly kind: 'Unary';
  readonly operator: UnaryOperator;
  readonly operand: ExpressionNode;
}

export type BinaryOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';

export interface BinaryNode extends NodeBase {
  readonly kind: 'Binary';
  readonly operator: BinaryOperator;
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
}

/**
 * Syntax tree of an expression. It is plain data: there are no function objects, prototypes or
 * host references in it, so a tree can be cached, logged or shipped to a worker safely.
 */
export type ExpressionNode = LiteralNode | FieldNode | CallNode | UnaryNode | BinaryNode;

/** Visits every node depth-first (parents before children). */
export function walkExpression(node: ExpressionNode, visit: (node: ExpressionNode) => void): void {
  visit(node);
  switch (node.kind) {
    case 'Call':
      for (const arg of node.args) walkExpression(arg, visit);
      break;
    case 'Unary':
      walkExpression(node.operand, visit);
      break;
    case 'Binary':
      walkExpression(node.left, visit);
      walkExpression(node.right, visit);
      break;
    case 'Literal':
    case 'Field':
      break;
  }
}

/** Distinct field keys referenced by an expression, in first-use order. */
export function expressionDependencies(node: ExpressionNode): string[] {
  const keys: string[] = [];
  walkExpression(node, (current) => {
    if (current.kind === 'Field' && !keys.includes(current.key)) keys.push(current.key);
  });
  return keys;
}
