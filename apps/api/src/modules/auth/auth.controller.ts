import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  LoginRequestSchema,
  SwitchOrganizationRequestSchema,
  type LoginRequest,
  type SessionDto,
  type SwitchOrganizationRequest,
} from '@smarttag/shared-types';
import type { Response } from 'express';
import { requestMetadata, type ActorContext, type AppRequest } from '../../common/http/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../../config/env.schema';
import { AllowAuthenticated, CurrentActor, Public } from '../authorization/authorization.decorators';
import { AuthService } from './auth.service';
import { clearSessionCookie, setSessionCookie } from './session-token';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest,
    @Req() request: AppRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionDto> {
    const { token, session } = await this.auth.login(body, requestMetadata(request));
    setSessionCookie(response, this.config, token);
    return session;
  }

  @AllowAuthenticated()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentActor() actor: ActorContext, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(actor);
    clearSessionCookie(response, this.config);
  }

  @AllowAuthenticated()
  @Get('session')
  session(@CurrentActor() actor: ActorContext): Promise<SessionDto> {
    return this.auth.getSession(actor);
  }

  @AllowAuthenticated()
  @Put('session/organization')
  switchOrganization(
    @CurrentActor() actor: ActorContext,
    @Body(new ZodValidationPipe(SwitchOrganizationRequestSchema)) body: SwitchOrganizationRequest,
  ): Promise<SessionDto> {
    return this.auth.switchOrganization(actor, body.organizationId);
  }
}
