import { describe, expect, it } from 'vitest';
import { analyzeExpression, evaluateExpression, parseExpression, type ValueType } from '../src';

const FIELD_TYPES: Readonly<Record<string, ValueType>> = { size: 'string', price: 'decimal' };
const environment = {
  fieldType: (key: string) => (Object.hasOwn(FIELD_TYPES, key) ? FIELD_TYPES[key] : undefined),
};

/**
 * Adversarial inputs resembling attempts to reach JavaScript capabilities. None may parse into
 * something that executes; each must fail with a structured error before evaluation.
 */
const ATTEMPTS: readonly (readonly [string, string])[] = [
  ['process.env', 'EXPRESSION_PARSE_ERROR'],
  ['process.env.SECRET', 'EXPRESSION_PARSE_ERROR'],
  ['process', 'UNKNOWN_FIELD'],
  ['require("fs")', 'UNKNOWN_FUNCTION'],
  ['require("child_process").exec("rm -rf /")', 'EXPRESSION_PARSE_ERROR'],
  ['fetch("https://attacker.example")', 'UNKNOWN_FUNCTION'],
  ['eval("1")', 'UNKNOWN_FUNCTION'],
  ['Function("return process")()', 'EXPRESSION_PARSE_ERROR'],
  ['Function("return this")', 'UNKNOWN_FUNCTION'],
  ['constructor', 'UNKNOWN_FIELD'],
  ['constructor("alert(1)")', 'UNKNOWN_FUNCTION'],
  ['size.constructor', 'EXPRESSION_PARSE_ERROR'],
  ['__proto__', 'UNKNOWN_FIELD'],
  ['__proto__()', 'UNKNOWN_FUNCTION'],
  ['prototype', 'UNKNOWN_FIELD'],
  ['toString()', 'UNKNOWN_FUNCTION'],
  ['hasOwnProperty("size")', 'UNKNOWN_FUNCTION'],
  ['globalThis', 'UNKNOWN_FIELD'],
  ['window["alert"]', 'EXPRESSION_PARSE_ERROR'],
  ['concat`x`', 'EXPRESSION_PARSE_ERROR'],
  ['`${process.env}`', 'EXPRESSION_PARSE_ERROR'],
  ['size = "x"', 'EXPRESSION_PARSE_ERROR'],
  ['(() => 1)()', 'EXPRESSION_PARSE_ERROR'],
  ['import("fs")', 'UNKNOWN_FUNCTION'],
  ['new Date()', 'EXPRESSION_PARSE_ERROR'],
  ['size; process.exit()', 'EXPRESSION_PARSE_ERROR'],
  ['{{product_name}}', 'EXPRESSION_PARSE_ERROR'],
  ['"<script>alert(1)</script>"', 'OK_STRING'],
  ["concat('\\u0061')", 'EXPRESSION_PARSE_ERROR'],
];

describe('expression security', () => {
  it.each(ATTEMPTS)('%s is not executable', (source, expected) => {
    const analysis = analyzeExpression(source, environment);
    if (expected === 'OK_STRING') {
      // Markup is inert data: it evaluates to the same characters and nothing else.
      expect(analysis.ok).toBe(true);
      const result = evaluateExpression(analysis.ast!, { fieldValue: () => undefined });
      expect(result).toEqual({
        ok: true,
        value: { type: 'string', value: '<script>alert(1)</script>' },
        missingFields: [],
      });
      return;
    }
    expect(analysis.ok).toBe(false);
    expect(analysis.issues[0]?.code).toBe(expected);
  });

  it('never consults prototype members of the record during evaluation', () => {
    const parsed = parseExpression('concat(constructor, toString)');
    expect(parsed.ok).toBe(true);
    const record: Record<string, unknown> = {};
    const result = evaluateExpression(parsed.ok ? parsed.ast : (null as never), {
      fieldValue: (key) => (Object.hasOwn(record, key) ? (record[key] as never) : undefined),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'EXPRESSION_EVALUATION_ERROR' } });
  });

  it('rejects malformed field values instead of coercing them', () => {
    const parsed = parseExpression('concat(size)');
    const result = evaluateExpression(parsed.ok ? parsed.ast : (null as never), {
      fieldValue: () => ({ type: 'string', value: { toString: () => 'evil' } }) as never,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'EXPRESSION_EVALUATION_ERROR' } });
  });

  it('syntax trees are plain data', () => {
    const parsed = parseExpression('if(price > 10, upper(size), "x")');
    expect(parsed.ok).toBe(true);
    const json = JSON.stringify(parsed.ok ? parsed.ast : null);
    expect(JSON.parse(json)).toEqual(parsed.ok ? parsed.ast : null);
  });

  it('does not use eval or the Function constructor anywhere', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(__dirname, '..', 'src');
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source).not.toMatch(/\beval\s*\(/);
      expect(source).not.toMatch(/new\s+Function\s*\(/);
      expect(source).not.toMatch(/\bnew RegExp\s*\(/);
    }
  });
});
