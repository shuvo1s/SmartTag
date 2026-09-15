import { tokenize } from './lexer';
import type { ExpressionIssue } from './types';

export type RenameResult =
  | { readonly ok: true; readonly source: string; readonly replacements: number }
  | { readonly ok: false; readonly error: ExpressionIssue };

const KEYWORDS = new Set(['true', 'false', 'null']);

/**
 * Renames references to a data field inside expression source, preserving everything else
 * (spacing, quotes, other names). Works on tokens, so text inside string literals and function
 * names are never touched. Fails when the source cannot be tokenized, so a rename never guesses.
 */
export function renameFieldReferences(source: string, from: string, to: string): RenameResult {
  const lexed = tokenize(source);
  if (!lexed.ok) return lexed;
  const { tokens } = lexed;
  let result = '';
  let cursor = 0;
  let replacements = 0;
  tokens.forEach((token, index) => {
    const next = tokens[index + 1];
    const isFieldReference =
      token.kind === 'IDENTIFIER' &&
      token.text === from &&
      !KEYWORDS.has(token.text) &&
      next?.kind !== 'LPAREN';
    if (isFieldReference) {
      result += source.slice(cursor, token.start) + to;
      cursor = token.end;
      replacements += 1;
    }
  });
  result += source.slice(cursor);
  return { ok: true, source: result, replacements };
}
