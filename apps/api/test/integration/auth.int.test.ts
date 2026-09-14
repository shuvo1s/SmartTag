import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashSessionToken } from '../../src/modules/auth/session-token';
import {
  API,
  TEST_PASSWORD,
  createTestApp,
  createUser,
  loginAs,
  resetDatabase,
  seedTenants,
  type TestApp,
} from './helpers';

describe('authentication & sessions (HTTP)', () => {
  let t: TestApp;
  let tenants: Awaited<ReturnType<typeof seedTenants>>;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    tenants = await seedTenants(t.prisma);
  });

  it('logs in, sets a hardened session cookie and returns the session', async () => {
    const response = await request(t.app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: ' Designer.A@test.local ', password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^smarttag_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(response.body).toMatchObject({
      user: { email: 'designer.a@test.local' },
      activeOrganization: { id: tenants.orgA.id, slug: 'org-a' },
      roles: ['DESIGNER'],
    });
    expect(response.body.permissions).toContain('template:create');
    expect(response.body.permissions).not.toContain('template-version:approve');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    // Only the SHA-256 of the token is persisted.
    const token = /smarttag_session=([^;]+)/.exec(cookie)![1]!;
    const sessions = await t.prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toBe(hashSessionToken(token));

    const audit = await t.prisma.auditEvent.findFirstOrThrow({ where: { action: 'USER_LOGIN' } });
    expect(audit).toMatchObject({
      actorUserId: tenants.users.designerA.id,
      organizationId: tenants.orgA.id,
      resourceType: 'SESSION',
    });
    expect(JSON.stringify(audit)).not.toContain(TEST_PASSWORD);
  });

  it.each([
    ['wrong password', 'designer.a@test.local', 'not-the-password'],
    ['unknown account', 'nobody@test.local', TEST_PASSWORD],
  ])(
    'rejects %s with a generic message and records the failure',
    async (_label, email, password) => {
      const response = await t.http.post(`${API}/auth/login`).send({ email, password });
      expect(response.status).toBe(401);
      expect(response.body.error).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Invalid email or password',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(await t.prisma.auditEvent.count({ where: { action: 'USER_LOGIN_FAILED' } })).toBe(1);
    },
  );

  it('rejects disabled users and users without organization access', async () => {
    await createUser(
      t.prisma,
      'disabled@test.local',
      [{ organizationId: tenants.orgA.id, roles: ['DESIGNER'] }],
      { status: 'DISABLED' },
    );
    await createUser(t.prisma, 'orphan@test.local', []);
    expect(
      (
        await t.http
          .post(`${API}/auth/login`)
          .send({ email: 'disabled@test.local', password: TEST_PASSWORD })
      ).status,
    ).toBe(401);
    const orphan = await t.http
      .post(`${API}/auth/login`)
      .send({ email: 'orphan@test.local', password: TEST_PASSWORD });
    expect(orphan.status).toBe(403);
    expect(orphan.body.error.code).toBe('FORBIDDEN');
  });

  it('validates the login payload', async () => {
    const response = await t.http
      .post(`${API}/auth/login`)
      .send({ email: 'not-an-email', password: '' });
    expect(response.status).toBe(400);
    expect(response.body.error.details.fieldErrors.map((e: { path: string }) => e.path)).toEqual([
      'email',
      'password',
    ]);
  });

  it('requires a session for protected endpoints', async () => {
    const response = await t.http.get(`${API}/auth/session`);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(
      (
        await t.http
          .get(`${API}/templates`)
          .set('Cookie', 'smarttag_session=forged-token-value-that-is-exactly-43-chars')
      ).status,
    ).toBe(401);
  });

  it('logout revokes the session server-side', async () => {
    const agent = await loginAs(t, 'designer.a@test.local');
    expect((await agent.get(`${API}/auth/session`)).status).toBe(200);
    expect((await agent.post(`${API}/auth/logout`)).status).toBe(204);
    expect((await agent.get(`${API}/auth/session`)).status).toBe(401);
    const session = await t.prisma.session.findFirstOrThrow();
    expect(session.revokedAt).not.toBeNull();
  });

  it('rejects expired and idle sessions', async () => {
    const agent = await loginAs(t, 'designer.a@test.local');
    await t.prisma.session.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 5000) },
    });
    expect((await agent.get(`${API}/auth/session`)).status).toBe(401);

    const idle = await loginAs(t, 'viewer.a@test.local');
    await t.prisma.session.updateMany({
      where: { user: { email: 'viewer.a@test.local' } },
      data: { lastSeenAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
    });
    expect((await idle.get(`${API}/auth/session`)).status).toBe(401);
  });

  it('immediately loses access when the membership is suspended', async () => {
    const agent = await loginAs(t, 'designer.a@test.local');
    await t.prisma.membership.updateMany({
      where: { userId: tenants.users.designerA.id },
      data: { status: 'SUSPENDED' },
    });
    expect((await agent.get(`${API}/templates`)).status).toBe(401);
  });

  it('switches the active organization only to organizations the user belongs to', async () => {
    const agent = await loginAs(t, 'multi@test.local');
    const initial = await agent.get(`${API}/auth/session`);
    expect(initial.body.memberships).toHaveLength(2);

    const switched = await agent
      .put(`${API}/auth/session/organization`)
      .send({ organizationId: tenants.orgB.id });
    expect(switched.status).toBe(200);
    expect(switched.body).toMatchObject({
      activeOrganization: { id: tenants.orgB.id },
      roles: ['DESIGNER'],
    });

    const designer = await loginAs(t, 'designer.a@test.local');
    const denied = await designer
      .put(`${API}/auth/session/organization`)
      .send({ organizationId: tenants.orgB.id });
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects cross-origin state-changing requests (CSRF)', async () => {
    const agent = await loginAs(t, 'designer.a@test.local');
    const response = await agent.post(`${API}/auth/logout`).set('Origin', 'https://evil.example');
    expect(response.status).toBe(403);
    expect((await agent.get(`${API}/auth/session`)).status).toBe(200);
    expect(
      (await agent.post(`${API}/auth/logout`).set('Origin', 'http://localhost:3000')).status,
    ).toBe(204);
  });

  it('rate-limits login attempts', async () => {
    const limited = await createTestApp({ AUTH_LOGIN_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const attempt = () =>
        request(limited.app.getHttpServer())
          .post(`${API}/auth/login`)
          .send({ email: 'x@test.local', password: 'wrong' });
      for (let i = 0; i < 3; i += 1) {
        expect((await attempt()).status).toBe(401);
      }
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });

  it('propagates a well-formed incoming request id', async () => {
    const response = await t.http
      .get(`${API}/templates`)
      .set('X-Request-Id', 'erp-sync-2026-09-14-0001');
    expect(response.headers['x-request-id']).toBe('erp-sync-2026-09-14-0001');
    expect(response.body.error.requestId).toBe('erp-sync-2026-09-14-0001');
  });

  it('reports health publicly', async () => {
    const response = await t.http.get(`${API}/health`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'up' });
  });
});
