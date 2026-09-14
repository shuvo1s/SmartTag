import { Injectable } from '@nestjs/common';
import type { LoginRequest, SessionDto } from '@smarttag/shared-types';
import { permissionsForRoles } from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordHasher } from './password-hasher';
import { SessionService, type RequestMeta } from './session.service';

const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async login(
    input: LoginRequest,
    meta: RequestMeta,
  ): Promise<{ token: string; session: SessionDto }> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        status: true,
        passwordCredential: { select: { passwordHash: true } },
        memberships: {
          where: { status: 'ACTIVE', organization: { status: 'ACTIVE' }, roles: { some: {} } },
          orderBy: { createdAt: 'asc' },
          select: { organizationId: true },
          take: 1,
        },
      },
    });

    const credentialValid = user?.passwordCredential
      ? await this.passwords.verify(user.passwordCredential.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);

    if (!user || !credentialValid || user.status !== 'ACTIVE') {
      await this.audit.record(this.prisma, {
        action: 'USER_LOGIN_FAILED',
        resourceType: 'USER',
        resourceId: user?.id ?? null,
        organizationId: null,
        actorUserId: user?.id ?? null,
        ...meta,
        metadata: {
          reason: !user
            ? 'UNKNOWN_ACCOUNT'
            : credentialValid
              ? 'ACCOUNT_DISABLED'
              : 'INVALID_PASSWORD',
        },
      });
      throw AppError.unauthenticated(INVALID_CREDENTIALS);
    }

    const organizationId = user.memberships[0]?.organizationId;
    if (!organizationId) {
      throw AppError.forbidden('Your account does not have access to any organization');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const session = await this.sessions.create(tx, user.id, organizationId, meta);
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await this.audit.record(tx, {
        action: 'USER_LOGIN',
        resourceType: 'SESSION',
        resourceId: session.sessionId,
        organizationId,
        actorUserId: user.id,
        ...meta,
      });
      return session;
    });

    return {
      token: created.token,
      session: await this.buildSession(user.id, organizationId, created.expiresAt),
    };
  }

  async logout(actor: ActorContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.sessions.revoke(tx, actor.sessionId);
      await this.audit.recordForActor(tx, actor, {
        action: 'USER_LOGOUT',
        resourceType: 'SESSION',
        resourceId: actor.sessionId,
      });
    });
  }

  async getSession(actor: ActorContext): Promise<SessionDto> {
    return this.buildSession(
      actor.userId,
      actor.organizationId,
      await this.sessions.expiresAt(actor.sessionId),
    );
  }

  async switchOrganization(actor: ActorContext, organizationId: string): Promise<SessionDto> {
    await this.prisma.$transaction(async (tx) => {
      const roles = await this.sessions.activeRoles(actor.userId, organizationId, tx);
      if (!roles) {
        // Same response whether the organization does not exist or the user is not a member.
        throw AppError.notFound('Organization');
      }
      await this.sessions.switchOrganization(tx, actor.sessionId, organizationId);
      await this.audit.record(tx, {
        action: 'SESSION_ORGANIZATION_SWITCHED',
        resourceType: 'SESSION',
        resourceId: actor.sessionId,
        organizationId,
        actorUserId: actor.userId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        metadata: { fromOrganizationId: actor.organizationId },
      });
    });
    return this.buildSession(
      actor.userId,
      organizationId,
      await this.sessions.expiresAt(actor.sessionId),
    );
  }

  private async buildSession(
    userId: string,
    activeOrganizationId: string,
    expiresAt: Date,
  ): Promise<SessionDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        memberships: {
          where: { status: 'ACTIVE', organization: { status: 'ACTIVE' } },
          orderBy: { organization: { name: 'asc' } },
          select: {
            organization: { select: { id: true, name: true, slug: true } },
            roles: { select: { role: true }, orderBy: { role: 'asc' } },
          },
        },
      },
    });

    const memberships = user.memberships
      .map((membership) => ({
        organization: membership.organization,
        roles: membership.roles.map((r) => r.role),
      }))
      .filter((membership) => membership.roles.length > 0);
    const active = memberships.find(
      (membership) => membership.organization.id === activeOrganizationId,
    );
    if (!active) {
      throw AppError.unauthenticated('Your session has expired. Please sign in again.');
    }

    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      activeOrganization: active.organization,
      roles: active.roles,
      permissions: permissionsForRoles(active.roles),
      memberships,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
