/**
 * Resource limits. Expressions and patterns are authored by users and evaluated against untrusted
 * data in browsers, API requests and (later) batch workers, so every dimension is bounded. The
 * language has no loops, recursion or user functions, so evaluation time is linear in the size of
 * the syntax tree; these limits bound that size and the size of produced text.
 */
export const EXPRESSION_LIMITS = {
  /** Characters of expression source. */
  maxSourceLength: 2_000,
  /** Syntax-tree nodes (literals, fields, calls, operators). */
  maxNodes: 500,
  /** Nesting depth of calls, parentheses and operators. */
  maxDepth: 32,
  /** Arguments of one function call. */
  maxArguments: 32,
  /** Characters of an identifier (field keys are at most 64). */
  maxIdentifierLength: 64,
  /** Characters of a string literal. */
  maxStringLiteralLength: 1_000,
  /** Characters of any text value produced during evaluation. */
  maxTextLength: 10_000,
  /** Fraction digits accepted by round() and formatNumber(). */
  maxFractionDigits: 12,
} as const;

export const PATTERN_LIMITS = {
  /** Characters of pattern source. */
  maxSourceLength: 200,
  /** Upper bound of a counted repetition such as {2,5}. */
  maxRepeat: 100,
  /** Automaton states after expanding counted repetitions. */
  maxStates: 2_000,
  /** Characters of text a pattern is matched against. */
  maxInputLength: 10_000,
} as const;
