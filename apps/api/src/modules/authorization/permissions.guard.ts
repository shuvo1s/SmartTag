import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { AppRequest } from '../../common/http/request-context';
import { ALLOW_AUTHENTICATED_KEY, IS_PUBLIC_KEY, REQUIRED_PERMISSIONS_KEY } from './authorization.decorators';

/**
 * Server-side RBAC. Runs after AuthenticationGuard. Secure by default: a handler that declares no
 * authorization policy is rejected, so forgetting a decorator can never expose an endpoint.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const actor = context.switchToHttp().getRequest<AppRequest>().actor;
    if (!actor) {
      throw AppError.unauthenticated();
    }

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS_KEY, targets);
    if (!required) {
      if (this.reflector.getAllAndOverride<boolean>(ALLOW_AUTHENTICATED_KEY, targets)) {
        return true;
      }
      throw AppError.forbidden('This endpoint has no authorization policy');
    }

    if (required.some((permission) => !actor.permissions.has(permission))) {
      throw AppError.forbidden();
    }
    return true;
  }
}
