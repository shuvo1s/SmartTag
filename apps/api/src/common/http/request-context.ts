import type { Permission, Role } from '@smarttag/shared-types';
import type { Request } from 'express';

/**
 * The authenticated principal for one request, resolved server-side from the session.
 * Every tenant-scoped service method receives this and scopes queries by `organizationId`.
 */
export interface ActorContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly roles: readonly Role[];
  readonly permissions: ReadonlySet<Permission>;
  readonly requestId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface AppRequest extends Request {
  /** Correlation id assigned by pino-http (from a valid X-Request-Id header or generated). */
  id: string;
  actor?: ActorContext;
}

export function requestMetadata(request: AppRequest): Pick<ActorContext, 'requestId' | 'ipAddress' | 'userAgent'> {
  const userAgent = request.headers['user-agent'];
  return {
    requestId: typeof request.id === 'string' ? request.id : null,
    ipAddress: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
  };
}
