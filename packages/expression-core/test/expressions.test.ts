import { describe, expect, it } from 'vitest';
import {
  EXPRESSION_FUNCTIONS,
  EXPRESSION_LIMITS,
  NULL_VALUE,
  analyzeExpression,
  evaluateExpression,
  expressionDependencies,
  parseExpression,
  renameFieldReferences,
  type ExpressionValue,
  type ValueType,
} from '../src';

const FIELD_TYPES: Readonly<Record<string, ValueType>> = {
  product_name: 'string',
  style: 'string',
  color: 'string',
  size: 'string',
  price: 'decimal',
  quantity: 'number',
  currency: 'string',
  is_sustainable: 'boolean',
  country: 'string',
  product_url: 'url',
  product_image: 'image',
  brand_logo: 'image',
  launch_date: 'date',
  nickname: 'string',
};

const environment = { fieldType: (key: string) => FIELD_TYPES[key] };

const RECORD: Readonly<Record<string, ExpressionValue>> = {
  product_name: { type: 'string', value: 'Premium Cotton Shirt' },
  style: { type: 'string', value: 'YT2045' },
  color: { type: 'string', value: 'Navy' },
  size: { type: 'string', value: 'XL' },
  price: { type: 'decimal', value: '39.95' },
  quantity: { type: 'number', value: 12 },
  currency: { type: 'string', value: 'USD' },
  is_sustainable: { type: 'boolean', value: true },
  country: { type: 'string', value: 'CA' },
  product_url: { type: 'url', value: 'https://example.com/products/YT-2045' },
  product_image: NULL_VALUE,
  brand_logo: { type: 'image', value: '0192f0a0-5b1e-7c3d-9a4f-6b7c8d9e0f10' },
  launch_date: { type: 'date', value: '2026-09-15' },
  nickname: NULL_VALUE,
};

function run(source: string, record: Readonly<Record<string, ExpressionValue>> = RECORD) {
  const analysis = analyzeExpression(source, environment);
  if (!analysis.ok) {
    throw new Error(`analysis failed: ${analysis.issues.map((i) => i.message).join('; ')}`);
  }
  const result = evaluateExpression(analysis.ast, {
    fieldValue: (key) => (Object.hasOwn(record, key) ? record[key] : undefined),
  });
  if (!result.ok) throw new Error(`evaluation failed: ${result.error.message}`);
  return { ...result, type: analysis.resultType };
}

const text = (source: string) => {
  const { value } = run(source);
  return value.value;
};

function issuesOf(source: string) {
  const analysis = analyzeExpression(source, environment);
  return analysis.issues.map((issue) => issue.code);
}

describe('the specification examples', () => {
  it('concat("SIZE: ", size) → SIZE: XL', () => {
    expect(run('concat("SIZE: ", size)')).toMatchObject({
      value: { type: 'string', value: 'SIZE: XL' },
      type: 'string',
      missingFields: [],
    });
  });

  it('concat(style, "-", color, "-", size) → YT2045-NAVY-XL with upper()', () => {
    expect(text('upper(concat(style, "-", color, "-", size))')).toBe('YT2045-NAVY-XL');
    expect(text("concat(style, '-', color, '-', size)")).toBe('YT2045-Navy-XL');
  });

  it('if(is_sustainable, "RECYCLED", "")', () => {
    expect(text('if(is_sustainable, "RECYCLED", "")')).toBe('RECYCLED');
    expect(
      run('if(is_sustainable, "RECYCLED", "")', {
        ...RECORD,
        is_sustainable: { type: 'boolean', value: false },
      }).value.value,
    ).toBe('');
  });

  it('USD 39.95 with explicit number formatting', () => {
    expect(text('concat(currency, " ", formatNumber(price, 2))')).toBe('USD 39.95');
    expect(text('formatNumber(1234.5, 2, ",", ".")')).toBe('1.234,50');
  });

  it('visibility conditions', () => {
    expect(run('is_sustainable == true')).toMatchObject({
      value: { value: true },
      type: 'boolean',
    });
    expect(text('country == "CA"')).toBe(true);
    expect(text('country != "CA" || price > 20')).toBe(true);
    expect(text('!(price >= 40) && launch_date >= "2026-01-01" == false')).toBe(false);
  });
});

describe('functions', () => {
  it('upper, lower and trim are locale independent', () => {
    expect(text('upper("straße")')).toBe('STRASSE');
    expect(text('lower("ÀB")')).toBe('àb');
    expect(text('trim("  XL \t")')).toBe('XL');
  });

  it('fallback returns the first non-empty value and handles missing fields', () => {
    expect(run('fallback(nickname, product_name)')).toMatchObject({
      value: { value: 'Premium Cotton Shirt' },
      missingFields: [],
    });
    expect(run('fallback(nickname, "  ", product_name)').value.value).toBe('Premium Cotton Shirt');
    expect(run('fallback(product_image, brand_logo)')).toMatchObject({
      type: 'image',
      value: { type: 'image' },
    });
    expect(run('fallback(nickname, nickname)')).toMatchObject({
      value: NULL_VALUE,
      missingFields: ['nickname'],
    });
  });

  it('round keeps the numeric type and rounds half away from zero', () => {
    expect(run('round(price, 1)')).toMatchObject({ value: { type: 'decimal', value: '40.0' } });
    expect(run('round(quantity)')).toMatchObject({ value: { type: 'number', value: 12 } });
    expect(run('round(1.005, 2)').value).toEqual({ type: 'decimal', value: '1.01' });
    expect(run('round(-2.5)').value).toEqual({ type: 'decimal', value: '-3' });
  });

  it('isEmpty guards optional fields', () => {
    expect(run('if(isEmpty(nickname), "", concat("AKA ", nickname))')).toMatchObject({
      value: { value: '' },
      missingFields: [],
    });
  });

  it('numbers compare exactly across number and decimal types', () => {
    expect(text('price == 39.950')).toBe(true);
    expect(text('quantity > 11.99')).toBe(true);
    expect(text('-price < 0')).toBe(true);
  });

  it('documents every function with a signature and an example that type-checks', () => {
    for (const fn of EXPRESSION_FUNCTIONS) {
      expect(fn.signature).toMatch(new RegExp(`^${fn.name}\\(`));
      expect(
        analyzeExpression(fn.example, {
          fieldType: (key) => FIELD_TYPES[key] ?? (key === 'short_name' ? 'string' : undefined),
        }).ok,
      ).toBe(true);
    }
  });
});

describe('missing data tracking', () => {
  it('reports missing fields a result depends on', () => {
    expect(run('concat("AKA ", nickname)')).toMatchObject({
      value: { value: 'AKA ' },
      missingFields: ['nickname'],
    });
    expect(run('upper(nickname)')).toMatchObject({
      value: NULL_VALUE,
      missingFields: ['nickname'],
    });
  });

  it('does not report fields on the branch that was not taken', () => {
    expect(run('if(is_sustainable, "RECYCLED", nickname)').missingFields).toEqual([]);
    expect(run('is_sustainable || nickname == "x"').missingFields).toEqual([]);
  });
});

describe('structured errors', () => {
  it('parse errors carry a position', () => {
    const result = parseExpression('concat("SIZE: ", size');
    expect(result).toMatchObject({ ok: false, error: { code: 'EXPRESSION_PARSE_ERROR' } });
    expect(parseExpression('')).toMatchObject({
      ok: false,
      error: { code: 'EXPRESSION_PARSE_ERROR' },
    });
    expect(parseExpression('"unterminated')).toMatchObject({
      ok: false,
      error: { code: 'EXPRESSION_PARSE_ERROR', message: 'Unterminated string' },
    });
    expect(parseExpression('size size')).toMatchObject({ ok: false, error: { start: 5 } });
  });

  it('unknown fields and functions', () => {
    expect(issuesOf('concat(sizes)')).toEqual(['UNKNOWN_FIELD']);
    expect(issuesOf('uppercase(size)')).toEqual(['UNKNOWN_FUNCTION']);
    const analysis = analyzeExpression('concat(nope, missing_too)', environment);
    expect(analysis.issues).toHaveLength(2);
    expect(analysis.issues[0]).toMatchObject({ start: 7, end: 11 });
  });

  it('wrong argument counts', () => {
    expect(issuesOf('upper(size, color)')).toEqual(['WRONG_ARGUMENT_COUNT']);
    expect(issuesOf('if(is_sustainable, "A")')).toEqual(['WRONG_ARGUMENT_COUNT']);
    expect(issuesOf('fallback(size)')).toEqual(['WRONG_ARGUMENT_COUNT']);
  });

  it('type mismatches', () => {
    expect(issuesOf('upper(price)')).toEqual(['TYPE_MISMATCH']);
    expect(issuesOf('if(size, "a", "b")')).toEqual(['TYPE_MISMATCH']);
    expect(issuesOf('if(is_sustainable, "a", 1)')).toEqual(['TYPE_MISMATCH']);
    expect(issuesOf('size == 3')).toEqual(['TYPE_MISMATCH']);
    expect(issuesOf('is_sustainable && size')).toEqual(['TYPE_MISMATCH']);
    expect(issuesOf('concat(product_image)')).toEqual(['TYPE_MISMATCH']);
    expect(issuesOf('concat(is_sustainable)')).toEqual(['TYPE_MISMATCH']);
    expect(issuesOf('round(price, 13)')).toEqual(['TYPE_MISMATCH']);
    expect(issuesOf('round(price, 1.5)')).toEqual(['TYPE_MISMATCH']);
    expect(issuesOf('-size')).toEqual(['TYPE_MISMATCH']);
    expect(issuesOf('fallback(size, price)')).toEqual(['TYPE_MISMATCH']);
  });

  it('evaluation errors are returned, not thrown', () => {
    const analysis = analyzeExpression('formatNumber(price, 2, "123")', environment);
    expect(analysis.ok).toBe(true);
    const result = evaluateExpression(analysis.ast!, { fieldValue: (key) => RECORD[key] });
    expect(result).toMatchObject({ ok: false, error: { code: 'EXPRESSION_EVALUATION_ERROR' } });

    const digits = analyzeExpression('round(price, quantity)', environment);
    expect(
      evaluateExpression(digits.ast!, {
        fieldValue: (key) => (key === 'quantity' ? { type: 'number', value: 99 } : RECORD[key]),
      }),
    ).toMatchObject({ ok: false, error: { code: 'EXPRESSION_EVALUATION_ERROR' } });
  });

  it('bounds produced text', () => {
    const analysis = analyzeExpression('concat(product_name, product_name)', environment);
    expect(analysis.ok).toBe(true);
    const long: ExpressionValue = {
      type: 'string',
      value: 'x'.repeat(EXPRESSION_LIMITS.maxTextLength / 2 + 1),
    };
    expect(evaluateExpression(analysis.ast!, { fieldValue: () => long })).toMatchObject({
      ok: false,
      error: { code: 'EXPRESSION_EVALUATION_ERROR' },
    });
  });
});

describe('limits', () => {
  it('source length', () => {
    const source = `"${'a'.repeat(EXPRESSION_LIMITS.maxSourceLength)}"`;
    expect(parseExpression(source)).toMatchObject({
      ok: false,
      error: { code: 'EXPRESSION_LIMIT_EXCEEDED' },
    });
  });

  it('nesting depth', () => {
    const source = `${'upper('.repeat(40)}size${')'.repeat(40)}`;
    expect(parseExpression(source)).toMatchObject({
      ok: false,
      error: { code: 'EXPRESSION_LIMIT_EXCEEDED' },
    });
    expect(parseExpression(`${'!'.repeat(100)}true`)).toMatchObject({
      ok: false,
      error: { code: 'EXPRESSION_LIMIT_EXCEEDED' },
    });
  });

  it('node count and arguments', () => {
    const many = Array.from({ length: 30 }, () => 'a').join(',');
    const source = Array.from({ length: 20 }, () => `concat(${many})`).join('==');
    expect(source.length).toBeLessThan(EXPRESSION_LIMITS.maxSourceLength);
    expect(parseExpression(source)).toMatchObject({
      ok: false,
      error: { code: 'EXPRESSION_LIMIT_EXCEEDED' },
    });
    expect(
      parseExpression(`concat(${Array.from({ length: 33 }, () => '"a"').join(',')})`),
    ).toMatchObject({
      ok: false,
      error: { code: 'EXPRESSION_LIMIT_EXCEEDED' },
    });
  });
});

describe('dependencies and renaming', () => {
  it('lists referenced fields once, in order', () => {
    const parsed = parseExpression('concat(style, "-", color, "-", size, style)');
    expect(parsed.ok && expressionDependencies(parsed.ast)).toEqual(['style', 'color', 'size']);
  });

  it('renames references without touching strings or function names', () => {
    expect(
      renameFieldReferences('concat("size: ", size, upper( size ))', 'size', 'item_size'),
    ).toEqual({
      ok: true,
      source: 'concat("size: ", item_size, upper( item_size ))',
      replacements: 2,
    });
    expect(renameFieldReferences('upper(upper)', 'upper', 'x')).toMatchObject({
      source: 'upper(x)',
      replacements: 1,
    });
    expect(renameFieldReferences('concat("a', 'a', 'b')).toMatchObject({ ok: false });
  });
});
