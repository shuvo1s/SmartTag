import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../config/env.schema';
import { PasswordHasher } from './password-hasher';
import { generateSessionToken, hashSessionToken, readSessionToken } from './session-token';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('produces salted Argon2id hashes that verify', async () => {
    const first = await hasher.hash('correct horse battery staple');
    const second = await hasher.hash('correct horse battery staple');
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second);
    expect(await hasher.verify(first, 'correct horse battery staple')).toBe(true);
    expect(await hasher.verify(first, 'Correct horse battery staple')).toBe(false);
  });

  it('treats malformed hashes as a failed verification', async () => {
    expect(await hasher.verify('not-a-hash', 'anything')).toBe(false);
    expect(await hasher.verifyDummy('anything')).toBe(false);
  });
});

describe('session tokens', () => {
  const config = loadAppConfig({ DATABASE_URL: 'postgresql://x@h/db' });

  it('are 256-bit random URL-safe strings', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateSessionToken));
    expect(tokens.size).toBe(100);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('are stored only as SHA-256 hashes', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).not.toContain(token);
  });

  it('are read only from the configured cookie with a strict format', () => {
    const token = generateSessionToken();
    const request = (cookies: Record<string, string>) => ({ cookies }) as never;
    expect(readSessionToken(request({ smarttag_session: token }), config)).toBe(token);
    expect(
      readSessionToken(request({ smarttag_session: `${token}; injected` }), config),
    ).toBeNull();
    expect(readSessionToken(request({ other: token }), config)).toBeNull();
  });
});
