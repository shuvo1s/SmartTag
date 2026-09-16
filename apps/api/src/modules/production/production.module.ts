import { Module } from '@nestjs/common';
import { StorageModule } from '../assets/storage/storage.module';
import { ProductionInstancesService } from './production-instances.service';
import { ProductionJobsService } from './production-jobs.service';
import { ProductionQueueService } from './production-queue.service';
import { ProductionJobsController, SequencesController } from './production.controllers';
import { SequencesService } from './sequences.service';

/** Production jobs, production instances, serial sequences and manifests (Phase 5). */
@Module({
  imports: [StorageModule],
  controllers: [ProductionJobsController, SequencesController],
  providers: [
    ProductionJobsService,
    ProductionInstancesService,
    ProductionQueueService,
    SequencesService,
  ],
})
export class ProductionModule {}
