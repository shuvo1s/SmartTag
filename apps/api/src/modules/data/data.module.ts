import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { APP_CONFIG, type AppConfig } from '../../config/env.schema';
import {
  DataImportsController,
  DatasetsController,
  MappingProfilesController,
} from './data.controllers';
import { DataImportsService } from './data-imports.service';
import { DatasetsService } from './datasets.service';
import { ImportQueueService } from './import-queue.service';
import { MappingProfilesService } from './mapping-profiles.service';

/** Data imports, datasets and mapping profiles (Phase 4). */
@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      // In-memory parsing with the size limit enforced while streaming (one file, few fields).
      useFactory: (config: AppConfig) => ({
        limits: {
          fileSize: config.imports.limits.maxFileBytes,
          files: 1,
          fields: 5,
          fieldSize: 1024,
        },
      }),
    }),
  ],
  controllers: [DataImportsController, DatasetsController, MappingProfilesController],
  providers: [DataImportsService, DatasetsService, MappingProfilesService, ImportQueueService],
})
export class DataModule {}
