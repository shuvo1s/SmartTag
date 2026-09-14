import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthenticationGuard } from './authentication.guard';
import { PasswordHasher } from './password-hasher';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, PasswordHasher, AuthenticationGuard],
  exports: [SessionService, PasswordHasher, AuthenticationGuard],
})
export class AuthModule {}
