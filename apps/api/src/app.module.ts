import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { GlobalExceptionFilter } from './common/errors/global-exception.filter';
import { LoggingModule } from './common/logging/logging.module';
import { AppConfigModule } from './config/config.module';
import { APP_CONFIG, type AppConfig } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { StorageModule } from './modules/assets/storage/storage.module';
import { AssetsModule } from './modules/assets/assets.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthenticationGuard } from './modules/auth/authentication.guard';
import { OriginGuard } from './modules/authorization/origin.guard';
import { PermissionsGuard } from './modules/authorization/permissions.guard';
import { CustomersModule } from './modules/customers/customers.module';
import { DataModule } from './modules/data/data.module';
import { HealthController } from './modules/health/health.controller';
import { TemplatesModule } from './modules/templates/templates.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        LoggingModule,
        DatabaseModule,
        AuditModule,
        StorageModule,
        ThrottlerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (appConfig: AppConfig) => [
            { name: 'login', ttl: 60_000, limit: appConfig.auth.loginRateLimitPerMinute },
          ],
        }),
        AuthModule,
        CustomersModule,
        TemplatesModule,
        AssetsModule,
        DataModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        // Global guards run in this order: CSRF origin check → authentication → authorization.
        { provide: APP_GUARD, useClass: OriginGuard },
        { provide: APP_GUARD, useExisting: AuthenticationGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    };
  }
}
