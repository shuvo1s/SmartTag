import { PATTERN_LIMITS } from './limits';

/**
 * Safe text patterns for validation rules.
 *
 * User-authored regular expressions are a denial-of-service risk: JavaScript's backtracking engine
 * can take exponential time on patterns such as `(a+)+$`, and it cannot be interrupted. Patterns
 * are therefore compiled by this module into a Thompson automaton and matched by simulating all
 * states at once, which takes time proportional to (input length × automaton size) for EVERY
 * pattern. Features that require backtracking (back-references, look-around) are rejected.
 *
 * Supported syntax (a subset of JavaScript regular expressions):
 *   literals, `.`, `[abc]`, `[^a-z]`, `\d \D \w \W \s \S`, escaped metacharacters, `\n \r \t`,
 *   groups `( )` and `(?: )`, alternation `|`, quantifiers `* + ? {n} {n,} {n,m}` (n, m ≤ 100)
 *
 * A pattern always matches the WHOLE value; a leading `^` and trailing `$` are accepted and
 * redundant. Matching is case-sensitive and works on Unicode code points. `\d`, `\w` and `\s` are
 * ASCII classes, identical on every platform.
 */

type CodePointTest = (codePoint: number) => boolean;

type PatternNode =
  | { readonly kind: 'char'; readonly test: CodePointTest }
  | { readonly kind: 'sequence'; readonly items: readonly PatternNode[] }
  | { readonly kind: 'alternation'; readonly options: readonly PatternNode[] }
  | {
      readonly kind: 'repeat';
      readonly node: PatternNode;
      readonly min: number;
      readonly max: number | null;
    };

export interface PatternError {
  readonly message: string;
  /** Code-point index into the pattern source. */
  readonly position: number;
}

export interface SafePattern {
  readonly source: string;
  /** Whether the whole input matches. Inputs longer than the limit never match. */
  test(input: string): boolean;
}

export type PatternCompileResult =
  | { readonly ok: true; readonly pattern: SafePattern }
  | { readonly ok: false; readonly error: PatternError };

class PatternSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

const cache = new Map<string, PatternCompileResult>();
const CACHE_LIMIT = 256;

export function compileSafePattern(source: string): PatternCompileResult {
  const cached = cache.get(source);
  if (cached) return cached;
  const result = compileUncached(source);
  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value!);
  }
  cache.set(source, result);
  return result;
}

function compileUncached(source: string): PatternCompileResult {
  if (typeof source !== 'string' || source.length === 0) {
    return { ok: false, error: { message: 'The pattern is empty', position: 0 } };
  }
  if (source.length > PATTERN_LIMITS.maxSourceLength) {
    return {
      ok: false,
      error: {
        message: `Patterns are limited to ${PATTERN_LIMITS.maxSourceLength} characters`,
        position: PATTERN_LIMITS.maxSourceLength,
      },
    };
  }
  try {
    const chars = Array.from(source);
    let begin = 0;
    let end = chars.length;
    if (chars[0] === '^') begin = 1;
    if (end > begin && chars[end - 1] === '$' && !isEscaped(chars, end - 1)) end -= 1;
    const parser = new PatternParser(chars, begin, end);
    const tree = parser.parse();
    const automaton = compileAutomaton(tree);
    return {
      ok: true,
      pattern: Object.freeze({ source, test: (input: string) => runAutomaton(automaton, input) }),
    };
  } catch (error) {
    if (error instanceof PatternSyntaxError) {
      return { ok: false, error: { message: error.message, position: error.position } };
    }
    throw error;
  }
}

function isEscaped(chars: readonly string[], index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && chars[i] === '\\'; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

const DIGIT: CodePointTest = (c) => c >= 48 && c <= 57;
const WORD: CodePointTest = (c) =>
  DIGIT(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const SPACE: CodePointTest = (c) => c === 32 || (c >= 9 && c <= 13);
const not =
  (test: CodePointTest): CodePointTest =>
  (c) =>
    !test(c);
const ANY_EXCEPT_LINE_BREAK: CodePointTest = (c) => c !== 10 && c !== 13;

const CLASS_ESCAPES: Readonly<Record<string, CodePointTest>> = {
  d: DIGIT,
  D: not(DIGIT),
  w: WORD,
  W: not(WORD),
  s: SPACE,
  S: not(SPACE),
};
const CONTROL_ESCAPES: Readonly<Record<string, number>> = { n: 10, r: 13, t: 9 };
const ESCAPABLE = new Set(Array.from('\\^$.|?*+()[]{}/-'));

class PatternParser {
  private index: number;

  constructor(
    private readonly chars: readonly string[],
    begin: number,
    private readonly end: number,
  ) {
    this.index = begin;
  }

  parse(): PatternNode {
    const node = this.alternation(0);
    if (this.index < this.end) {
      throw new PatternSyntaxError('Unmatched ")"', this.index);
    }
    return node;
  }

  private peek(): string | undefined {
    return this.index < this.end ? this.chars[this.index] : undefined;
  }

  private alternation(depth: number): PatternNode {
    if (depth > 32) throw new PatternSyntaxError('Groups are nested too deeply', this.index);
    const options = [this.sequence(depth)];
    while (this.peek() === '|') {
      this.index += 1;
      options.push(this.sequence(depth));
    }
    return options.length === 1 ? options[0]! : { kind: 'alternation', options };
  }

  private sequence(depth: number): PatternNode {
    const items: PatternNode[] = [];
    for (
      let char = this.peek();
      char !== undefined && char !== '|' && char !== ')';
      char = this.peek()
    ) {
      items.push(this.quantified(this.atom(depth)));
    }
    return { kind: 'sequence', items };
  }

  private atom(depth: number): PatternNode {
    const position = this.index;
    const char = this.chars[this.index]!;
    this.index += 1;
    switch (char) {
      case '(': {
        if (this.peek() === '?') {
          if (this.chars[this.index + 1] !== ':') {
            throw new PatternSyntaxError(
              'Look-around and named groups are not supported',
              position,
            );
          }
          this.index += 2;
        }
        const inner = this.alternation(depth + 1);
        if (this.peek() !== ')') throw new PatternSyntaxError('Missing ")"', position);
        this.index += 1;
        return inner;
      }
      case '[':
        return this.characterClass(position);
      case '.':
        return { kind: 'char', test: ANY_EXCEPT_LINE_BREAK };
      case '\\':
        return { kind: 'char', test: this.escape(position, false) };
      case '^':
      case '$':
        throw new PatternSyntaxError(
          `"${char}" is only allowed at the start or end; patterns always match the whole value`,
          position,
        );
      case '*':
      case '+':
      case '?':
      case '{':
        throw new PatternSyntaxError(`Nothing to repeat before "${char}"`, position);
      case ']':
      case '}':
        throw new PatternSyntaxError(`Unescaped "${char}"`, position);
      default: {
        const codePoint = char.codePointAt(0)!;
        return { kind: 'char', test: (c) => c === codePoint };
      }
    }
  }

  private quantified(node: PatternNode): PatternNode {
    const position = this.index;
    const char = this.peek();
    let min: number;
    let max: number | null;
    switch (char) {
      case '*':
        [min, max] = [0, null];
        this.index += 1;
        break;
      case '+':
        [min, max] = [1, null];
        this.index += 1;
        break;
      case '?':
        [min, max] = [0, 1];
        this.index += 1;
        break;
      case '{':
        [min, max] = this.counted(position);
        break;
      default:
        return node;
    }
    const following = this.peek();
    if (following === '?' || following === '+' || following === '*' || following === '{') {
      throw new PatternSyntaxError(
        'Lazy, possessive and stacked quantifiers are not supported',
        this.index,
      );
    }
    return { kind: 'repeat', node, min, max };
  }

  private counted(position: number): [number, number | null] {
    this.index += 1;
    const readNumber = (): number | null => {
      let digits = '';
      while (this.peek() !== undefined && /\d/.test(this.peek()!)) {
        digits += this.peek();
        this.index += 1;
      }
      return digits.length === 0 ? null : Number(digits);
    };
    const min = readNumber();
    if (min === null)
      throw new PatternSyntaxError('Invalid repetition; use {n}, {n,} or {n,m}', position);
    let max: number | null = min;
    if (this.peek() === ',') {
      this.index += 1;
      max = readNumber();
    }
    if (this.peek() !== '}') {
      throw new PatternSyntaxError('Invalid repetition; use {n}, {n,} or {n,m}', position);
    }
    this.index += 1;
    const limit = PATTERN_LIMITS.maxRepeat;
    if (min > limit || (max !== null && max > limit)) {
      throw new PatternSyntaxError(`Repetition counts are limited to ${limit}`, position);
    }
    if (max !== null && max < min) {
      throw new PatternSyntaxError('The repetition maximum is smaller than the minimum', position);
    }
    return [min, max];
  }

  private escape(position: number, inClass: boolean): CodePointTest {
    const char = this.peek();
    if (char === undefined) throw new PatternSyntaxError('The pattern ends with "\\"', position);
    this.index += 1;
    const classTest = CLASS_ESCAPES[char];
    if (classTest) return classTest;
    const control = CONTROL_ESCAPES[char];
    if (control !== undefined) return (c) => c === control;
    if (ESCAPABLE.has(char)) {
      const codePoint = char.codePointAt(0)!;
      return (c) => c === codePoint;
    }
    if (/\d/.test(char)) {
      throw new PatternSyntaxError('Back-references are not supported', position);
    }
    if (!inClass && (char === 'b' || char === 'B')) {
      throw new PatternSyntaxError('Word boundaries are not supported', position);
    }
    throw new PatternSyntaxError(`Unsupported escape "\\${char}"`, position);
  }

  private characterClass(position: number): PatternNode {
    let negated = false;
    if (this.peek() === '^') {
      negated = true;
      this.index += 1;
    }
    const tests: CodePointTest[] = [];
    if (this.peek() === ']') throw new PatternSyntaxError('Empty character class', position);
    while (this.peek() !== ']') {
      if (this.peek() === undefined) throw new PatternSyntaxError('Missing "]"', position);
      const itemPosition = this.index;
      const single = this.classAtom();
      if (this.peek() === '-' && this.chars[this.index + 1] !== ']' && this.index + 1 < this.end) {
        this.index += 1;
        const upper = this.classAtom();
        if (single.codePoint === null || upper.codePoint === null) {
          throw new PatternSyntaxError('Ranges must be between single characters', itemPosition);
        }
        const [low, high] = [single.codePoint, upper.codePoint];
        if (low > high) throw new PatternSyntaxError('Range out of order', itemPosition);
        tests.push((c) => c >= low && c <= high);
      } else {
        tests.push(single.test);
      }
    }
    this.index += 1;
    const matchesAny: CodePointTest = (c) => tests.some((test) => test(c));
    return { kind: 'char', test: negated ? not(matchesAny) : matchesAny };
  }

  private classAtom(): { test: CodePointTest; codePoint: number | null } {
    const position = this.index;
    const char = this.chars[this.index]!;
    this.index += 1;
    if (char === '\\') {
      const next = this.peek();
      const test = this.escape(position, true);
      const codePoint =
        next !== undefined && !(next in CLASS_ESCAPES)
          ? (CONTROL_ESCAPES[next] ?? next.codePointAt(0)!)
          : null;
      return { test, codePoint };
    }
    if (char === '[') throw new PatternSyntaxError('Nested classes are not supported', position);
    const codePoint = char.codePointAt(0)!;
    return { test: (c) => c === codePoint, codePoint };
  }
}

// ---------------------------------------------------------------------------------------------
// Automaton
// ---------------------------------------------------------------------------------------------

const CHAR = 0;
const SPLIT = 1;
const MATCH = 2;

interface AutomatonState {
  kind: typeof CHAR | typeof SPLIT | typeof MATCH;
  test: CodePointTest | null;
  out: number;
  alt: number;
}

interface Automaton {
  readonly states: readonly AutomatonState[];
  readonly start: number;
}

function compileAutomaton(tree: PatternNode): Automaton {
  const states: AutomatonState[] = [];
  const allocate = (state: AutomatonState): number => {
    if (states.length >= PATTERN_LIMITS.maxStates) {
      throw new PatternSyntaxError(
        'The pattern is too complex; reduce repetition counts or alternatives',
        0,
      );
    }
    states.push(state);
    return states.length - 1;
  };

  const compile = (node: PatternNode, next: number): number => {
    switch (node.kind) {
      case 'char':
        return allocate({ kind: CHAR, test: node.test, out: next, alt: -1 });
      case 'sequence': {
        let start = next;
        for (let index = node.items.length - 1; index >= 0; index -= 1) {
          start = compile(node.items[index]!, start);
        }
        return start;
      }
      case 'alternation': {
        const starts = node.options.map((option) => compile(option, next));
        let start = starts[starts.length - 1]!;
        for (let index = starts.length - 2; index >= 0; index -= 1) {
          start = allocate({ kind: SPLIT, test: null, out: starts[index]!, alt: start });
        }
        return start;
      }
      case 'repeat': {
        let tail = next;
        if (node.max === null) {
          const loop = allocate({ kind: SPLIT, test: null, out: -1, alt: next });
          states[loop]!.out = compile(node.node, loop);
          tail = loop;
        } else {
          for (let copy = node.min; copy < node.max; copy += 1) {
            const optional = allocate({ kind: SPLIT, test: null, out: -1, alt: next });
            states[optional]!.out = compile(node.node, tail);
            tail = optional;
          }
        }
        for (let copy = 0; copy < node.min; copy += 1) {
          tail = compile(node.node, tail);
        }
        return tail;
      }
    }
  };

  const match = allocate({ kind: MATCH, test: null, out: -1, alt: -1 });
  const start = compile(tree, match);
  return { states, start };
}

function runAutomaton({ states, start }: Automaton, input: string): boolean {
  if (typeof input !== 'string' || input.length > PATTERN_LIMITS.maxInputLength) return false;
  const marks = new Int32Array(states.length);
  let generation = 1;
  const stack: number[] = [];

  const addClosure = (list: number[], index: number) => {
    stack.push(index);
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current < 0 || marks[current] === generation) continue;
      marks[current] = generation;
      const state = states[current]!;
      if (state.kind === SPLIT) {
        stack.push(state.alt, state.out);
      } else {
        list.push(current);
      }
    }
  };

  let active: number[] = [];
  addClosure(active, start);
  for (const char of input) {
    const codePoint = char.codePointAt(0)!;
    generation += 1;
    const next: number[] = [];
    for (const index of active) {
      const state = states[index]!;
      if (state.kind === CHAR && state.test!(codePoint)) addClosure(next, state.out);
    }
    if (next.length === 0) return false;
    active = next;
  }
  return active.some((index) => states[index]!.kind === MATCH);
}
