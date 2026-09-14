import { Injectable } from '@nestjs/common';
import type { AuditAction, AuditResourceType } from '@smarttag/shared-types';
import type { ActorContext } from '../../common/http/request-context';
import type { DbClient } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

export interface AuditEventInput {
  readonly action: AuditAction;
  readonly resourceType: AuditResourceType;
  readonly resourceId: string | null;
  readonly organizationId: string | null;
  readonly actorUserId: string | null;
  readonly requestId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  /** Small, non-sensitive context. Never passwords, tokens or full document payloads. */
  readonly metadata?: Prisma.InputJsonObject;
}

/**
 * Append-only audit trail. Callers pass their transaction client so that the audit record is
 * committed atomically with the change it describes.
 */
@Injectable()
export class AuditService {
  async record(db: DbClient, event: AuditEventInput): Promise<void> {
    await db.auditEvent.create({
      data: {
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        organizationId: event.organizationId,
        actorUserId: event.actorUserId,
        requestId: event.requestId,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        metadata: event.metadata ?? {},
      },
    });
  }

  /** Records an event performed by the authenticated actor within their active organization. */
  async recordForActor(
    db: DbClient,
    actor: ActorContext,
    event: Pick<AuditEventInput, 'action' | 'resourceType' | 'resourceId' | 'metadata'>,
  ): Promise<void> {
    await this.record(db, {
      ...event,
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }
}
