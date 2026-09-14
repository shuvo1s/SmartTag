import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext, AppRequest } from '../../common/http/request-context';

export const IS_PUBLIC_KEY = 'smarttag:public';
export const ALLOW_AUTHENTICATED_KEY = 'smarttag:allowAuthenticated';
export const REQUIRED_PERMISSIONS_KEY = 'smarttag:requiredPermissions';

/** No authentication required (login, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Any authenticated user may call this endpoint (e.g. reading their own session). */
export const AllowAuthenticated = () => SetMetadata(ALLOW_AUTHENTICATED_KEY, true);

/**
 * Requires ALL listed permissions in the actor's active organization.
 * Endpoints without Public/AllowAuthenticated/RequirePermissions are denied by default.
 */
export const RequirePermissions = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/** Injects the authenticated ActorContext. */
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): ActorContext => {
  const request = context.switchToHttp().getRequest<AppRequest>();
  if (!request.actor) {
    throw AppError.unauthenticated();
  }
  return request.actor;
});

export function assertPermission(actor: ActorContext, permission: Permission): void {
  if (!actor.permissions.has(permission)) {
    throw AppError.forbidden();
  }
}
