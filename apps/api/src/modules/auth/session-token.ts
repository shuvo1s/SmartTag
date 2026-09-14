import type { CookieOptions, Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from '../../config/env.schema';

/** 256-bit random, URL-safe opaque token (43 base64url characters). */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this hash is persisted, so a database leak does not expose usable session tokens. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function readSessionToken(request: Request, config: AppConfig): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[config.auth.cookieName];
  return typeof value === 'string' && TOKEN_PATTERN.test(value) ? value : null;
}

function cookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.auth.cookieSecure,
    sameSite: 'lax',
    path: '/',
  };
}

export function setSessionCookie(response: Response, config: AppConfig, token: string): void {
  response.cookie(config.auth.cookieName, token, {
    ...cookieOptions(config),
    maxAge: config.auth.sessionTtlMs,
  });
}

export function clearSessionCookie(response: Response, config: AppConfig): void {
  response.clearCookie(config.auth.cookieName, cookieOptions(config));
}
