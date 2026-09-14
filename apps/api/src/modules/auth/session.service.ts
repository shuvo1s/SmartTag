import { Inject, Injectable } from '@nestjs/common';
import { permissionsForRoles, type Role } from '@smarttag/shared-types';
import type { ActorContext } from '../../common/http/request-context';
import { APP_CONFIG, type AppConfig } from '../../config/env.schema';
import { PrismaService, type DbClient } from '../../database/prisma.service';
import { generateSessionToken, hashSessionToken } from './session-token';

/** Avoid a database write on every request; last-seen precision of one minute is sufficient. */
const TOUCH_INTERVAL_MS = 60_000;

export interface NewSession {
  readonly token: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
}

export interface RequestMeta {
  readonly requestId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(db: DbClient, userId: string, organizationId: string, meta: RequestMeta): Promise<NewSession> {
    const token = generateSessionToken();
    const now = new Date();
    const session = await db.session.create({
      data: {
        tokenHash: hashSessionToken(token),
        userId,
        activeOrganizationId: organizationId,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + this.config.auth.sessionTtlMs),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      select: { id: true, expiresAt: true },
    });
    return { token, sessionId: session.id, expiresAt: session.expiresAt };
  }

  /**
   * Resolves a presented token to an actor. Returns null for unknown, revoked, expired or idle
   * sessions, disabled users, and users who lost membership of the session's organization.
   */
  async resolve(token: string, meta: RequestMeta): Promise<ActorContext | null> {
    const now = Date.now();
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: {
        id: true,
        userId: true,
        activeOrganizationId: true,
        expiresAt: true,
        lastSeenAt: true,
        revokedAt: true,
        user: { select: { status: true } },
      },
    });
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= now ||
      session.lastSeenAt.getTime() + this.config.auth.idleTimeoutMs <= now ||
      session.user.status !== 'ACTIVE'
    ) {
      return null;
    }

    const roles = await this.activeRoles(session.userId, session.activeOrganizationId);
    if (!roles) {
      return null;
    }

    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
    }

    return {
      userId: session.userId,
      sessionId: session.id,
      organizationId: session.activeOrganizationId,
      roles,
      permissions: new Set(permissionsForRoles(roles)),
      ...meta,
    };
  }

  /** Roles of an ACTIVE membership in an ACTIVE organization, or null when there is none. */
  async activeRoles(userId: string, organizationId: string, db: DbClient = this.prisma): Promise<Role[] | null> {
    const membership = await db.membership.findFirst({
      where: { userId, organizationId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
      select: { roles: { select: { role: true }, orderBy: { role: 'asc' } } },
    });
    if (!membership || membership.roles.length === 0) {
      return null;
    }
    return membership.roles.map((entry) => entry.role);
  }

  async revoke(db: DbClient, sessionId: string): Promise<void> {
    await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async switchOrganization(db: DbClient, sessionId: string, organizationId: string): Promise<void> {
    await db.session.update({ where: { id: sessionId }, data: { activeOrganizationId: organizationId } });
  }

  async expiresAt(sessionId: string): Promise<Date> {
    const session = await this.prisma.session.findUniqueOrThrow({ where: { id: sessionId }, select: { expiresAt: true } });
    return session.expiresAt;
  }
}
