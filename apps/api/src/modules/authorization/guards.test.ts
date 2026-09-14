import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { permissionsForRoles, type Role } from '@smarttag/shared-types';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../../common/http/request-context';
import { loadAppConfig } from '../../config/env.schema';
import { AllowAuthenticated, Public, RequirePermissions } from './authorization.decorators';
import { OriginGuard } from './origin.guard';
import { PermissionsGuard } from './permissions.guard';

class ExampleController {
  @Public()
  open(): void {}

  @AllowAuthenticated()
  anyUser(): void {}

  @RequirePermissions('template:create', 'template:read')
  create(): void {}

  undecorated(): void {}
}

function actorWith(roles: Role[]): ActorContext {
  return {
    userId: 'u',
    sessionId: 's',
    organizationId: 'o',
    roles,
    permissions: new Set(permissionsForRoles(roles)),
    requestId: null,
    ipAddress: null,
    userAgent: null,
  };
}

function contextFor(
  handler: keyof ExampleController,
  request: Record<string, unknown>,
): ExecutionContext {
  return {
    getHandler: () => ExampleController.prototype[handler],
    getClass: () => ExampleController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('allows public handlers without an actor', () => {
    expect(guard.canActivate(contextFor('open', {}))).toBe(true);
  });

  it('requires authentication for everything else', () => {
    expect(() => guard.canActivate(contextFor('anyUser', {}))).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }),
    );
  });

  it('allows any authenticated user where declared', () => {
    expect(guard.canActivate(contextFor('anyUser', { actor: actorWith(['VIEWER']) }))).toBe(true);
  });

  it('requires every listed permission', () => {
    expect(guard.canActivate(contextFor('create', { actor: actorWith(['DESIGNER']) }))).toBe(true);
    expect(() => guard.canActivate(contextFor('create', { actor: actorWith(['VIEWER']) }))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('denies handlers without any authorization policy (secure by default)', () => {
    expect(() =>
      guard.canActivate(contextFor('undecorated', { actor: actorWith(['ORG_ADMIN']) })),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});

describe('OriginGuard', () => {
  const guard = new OriginGuard(
    loadAppConfig({
      DATABASE_URL: 'postgresql://x@h/db',
      API_ALLOWED_ORIGINS: 'http://localhost:3000',
    }),
  );
  const run = (method: string, headers: Record<string, string>) =>
    guard.canActivate(contextFor('create', { method, headers }));

  it('ignores safe methods', () => {
    expect(run('GET', { origin: 'https://evil.example' })).toBe(true);
  });

  it('accepts state-changing requests from allowed origins and non-browser clients', () => {
    expect(run('POST', { origin: 'http://localhost:3000' })).toBe(true);
    expect(run('PATCH', {})).toBe(true);
    expect(run('POST', { 'sec-fetch-site': 'same-origin' })).toBe(true);
  });

  it('rejects cross-origin state-changing requests', () => {
    expect(() => run('POST', { origin: 'https://evil.example' })).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(() => run('DELETE', { 'sec-fetch-site': 'cross-site' })).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(() => run('POST', { origin: 'null' })).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });
});
