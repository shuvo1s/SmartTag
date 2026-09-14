import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../common/errors/app-error';
import { requestMetadata, type AppRequest } from '../../common/http/request-context';
import { APP_CONFIG, type AppConfig } from '../../config/env.schema';
import { IS_PUBLIC_KEY } from '../authorization/authorization.decorators';
import { readSessionToken } from './session-token';
import { SessionService } from './session.service';

/** Resolves the session cookie into an ActorContext for every non-public endpoint. */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AppRequest>();
    const token = readSessionToken(request, this.config);
    if (!token) {
      throw AppError.unauthenticated();
    }
    const actor = await this.sessions.resolve(token, requestMetadata(request));
    if (!actor) {
      throw AppError.unauthenticated('Your session has expired. Please sign in again.');
    }
    request.actor = actor;
    return true;
  }
}
