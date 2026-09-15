import { describe, expect, it } from 'vitest';
import { PATTERN_LIMITS, compileSafePattern } from '../src';

function compile(source: string) {
  const result = compileSafePattern(source);
  if (!result.ok) throw new Error(`${source}: ${result.error.message}`);
  return result.pattern;
}

describe('safe patterns — matching', () => {
  it.each([
    ['[A-Z]{2}-\\d{4}', ['YT-2045', 'AB-0000'], ['yt-2045', 'YT-204', 'YT-20455', 'YT2045']],
    ['^\\d{13}$', ['4006381333931'], ['400638133393', '40063813339311', '400638133393a']],
    ['XS|S|M|L|XL|XXL', ['XS', 'XL', 'M'], ['XXXL', 'm', 'SM', '']],
    ['(?:ST|YT)-\\d+', ['ST-1', 'YT-2045'], ['ST-', 'AT-1']],
    ['[^\\s]+', ['Navy', 'no-spaces'], ['with space', '']],
    ['colou?r', ['color', 'colour'], ['colouur']],
    ['a{2,}', ['aa', 'aaaaa'], ['a']],
    ['[a-z_]{1,3}', ['a', 'ab_'], ['abcd', '']],
    ['\\w+@\\w+\\.com', ['me@site.com'], ['me@site.org']],
    ['.*', ['', 'anything'], ['line\nbreak']],
    ['[-a]', ['-', 'a'], ['b']],
    ['\\$\\d+\\.\\d{2}', ['$39.95'], ['39.95']],
    ['বাংলা.*', ['বাংলাদেশে তৈরি'], ['Bangla']],
    ['😀+', ['😀😀'], ['😀a']],
  ] as const)('%s', (source, matches, rejects) => {
    const pattern = compile(source);
    for (const value of matches) expect(pattern.test(value), value).toBe(true);
    for (const value of rejects) expect(pattern.test(value), value).toBe(false);
  });

  it('always matches the whole value', () => {
    expect(compile('\\d+').test('abc123')).toBe(false);
    expect(compile('\\d+').test('123')).toBe(true);
  });
});

describe('safe patterns — denial of service resistance', () => {
  it.each([
    '(a+)+$',
    '(a|aa)+$',
    '(a*)*b',
    '(.*a){20}',
    '(\\w+\\s?)+$',
    '^(([a-z])+.)+[A-Z]([a-z])+$',
  ])('%s runs in linear time on hostile input', (source) => {
    const pattern = compile(source);
    const hostile = `${'a'.repeat(5_000)}!`;
    const started = performance.now();
    expect(pattern.test(hostile)).toBe(false);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('refuses inputs longer than the limit', () => {
    expect(compile('.*').test('a'.repeat(PATTERN_LIMITS.maxInputLength + 1))).toBe(false);
  });
});

describe('safe patterns — rejected syntax', () => {
  it.each([
    ['', 'empty'],
    ['(a)\\1', 'Back-references'],
    ['(?=a)a', 'Look-around'],
    ['(?<name>a)', 'Look-around'],
    ['a+?', 'Lazy'],
    ['a{2', 'Invalid repetition'],
    ['a{3,2}', 'maximum is smaller'],
    ['a{101}', 'limited to 100'],
    ['(a{100}){100}', 'too complex'],
    ['[z-a]', 'Range out of order'],
    ['[]', 'Empty character class'],
    ['(abc', 'Missing ")"'],
    ['abc)', 'Unmatched ")"'],
    ['*a', 'Nothing to repeat'],
    ['a^b', 'only allowed at the start or end'],
    ['\\bword', 'Word boundaries'],
    ['\\p{L}', 'Unsupported escape'],
    ['abc\\', 'ends with'],
    ['x'.repeat(PATTERN_LIMITS.maxSourceLength + 1), 'limited to'],
  ])('%s', (source, message) => {
    const result = compileSafePattern(source);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain(message);
  });
});
