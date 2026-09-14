import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { AppRequest } from '../../common/http/request-context';
import { APP_CONFIG, type AppConfig } from '../../config/env.schema';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated requests (in addition to SameSite=Lax cookies):
 * state-changing requests from browsers must originate from an allowed origin.
 *
 * - `Origin` present → must be in API_ALLOWED_ORIGINS
 * - no `Origin` but `Sec-Fetch-Site` says cross-site/same-site → rejected
 * - neither header (non-browser clients such as integrations and tests) → allowed; such clients
 *   can only hold a session they obtained themselves
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.allowedOrigins = new Set(config.http.allowedOrigins);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }
    const origin = request.headers.origin;
    if (typeof origin === 'string') {
      if (!this.allowedOrigins.has(origin)) {
        throw AppError.forbidden('Cross-origin request rejected');
      }
      return true;
    }
    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite === 'cross-site' || fetchSite === 'same-site') {
      throw AppError.forbidden('Cross-origin request rejected');
    }
    return true;
  }
}
