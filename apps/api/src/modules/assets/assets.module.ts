import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { APP_CONFIG, type AppConfig } from '../../config/env.schema';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { FontsController } from './fonts.controller';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      // In-memory parsing with limits enforced while streaming; oversized uploads are rejected
      // with 413 before the whole body is buffered.
      useFactory: (config: AppConfig) => ({
        limits: { fileSize: config.assets.maxUploadBytes, files: 1, fields: 10, fieldSize: 1024 },
      }),
    }),
  ],
  controllers: [AssetsController, FontsController],
  providers: [AssetsService],
})
export class AssetsModule {}
