import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './env.schema';

/** Makes the validated, immutable AppConfig injectable everywhere via the APP_CONFIG token. */
@Global()
@Module({})
export class AppConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: Object.freeze(config) }],
      exports: [APP_CONFIG],
    };
  }
}
