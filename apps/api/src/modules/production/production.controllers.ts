import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  type PipeTransform,
} from '@nestjs/common';
import {
  ConfigureProductionJobRequestSchema,
  CreateProductionJobRequestSchema,
  CreateSequenceRequestSchema,
  ListProductionInstancesQuerySchema,
  ListProductionJobsQuerySchema,
  ListSequencesQuerySchema,
  ProductionJobRevisionRequestSchema,
  ReleaseProductionJobRequestSchema,
  UpdateSequenceRequestSchema,
  type ConfigureProductionJobRequest,
  type CreateProductionJobCommand,
  type CreateSequenceCommand,
  type ListProductionInstancesQuery,
  type ListProductionJobsQuery,
  type ListSequencesQuery,
  type PaginatedResponse,
  type ProductionInstanceDetailDto,
  type ProductionInstancePageDto,
  type ProductionJobDto,
  type ProductionJobRevisionRequest,
  type ProductionJobSummaryDto,
  type ProductionSampleDto,
  type ReleaseProductionJobCommand,
  type SequenceDto,
  type UpdateSequenceRequest,
} from '@smarttag/shared-types';
import type { Response } from 'express';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { UuidParamPipe, ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor, RequirePermissions } from '../authorization/authorization.decorators';
import { attachmentDisposition } from '../data/data.mappers';
import { ProductionInstancesService } from './production-instances.service';
import { ProductionJobsService } from './production-jobs.service';
import { SequencesService } from './sequences.service';

/** An instance sequence path parameter; anything but a positive integer is "not found". */
@Injectable()
class InstanceSequencePipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^[1-9]\d{0,9}$/.test(value)) throw AppError.notFound('Production instance');
    return Number(value);
  }
}

@Controller()
export class ProductionJobsController {
  constructor(
    private readonly jobs: ProductionJobsService,
    private readonly instances: ProductionInstancesService,
  ) {}

  @RequirePermissions('production-job:read')
  @Get('production-jobs')
  list(
    @CurrentActor() actor: ActorContext,
    @Query(new ZodValidationPipe(ListProductionJobsQuerySchema)) query: ListProductionJobsQuery,
  ): Promise<PaginatedResponse<ProductionJobSummaryDto>> {
    return this.jobs.list(actor, query);
  }

  @RequirePermissions('production-job:create')
  @Post('production-jobs')
  create(
    @CurrentActor() actor: ActorContext,
    @Body(new ZodValidationPipe(CreateProductionJobRequestSchema)) body: CreateProductionJobCommand,
  ): Promise<ProductionJobDto> {
    return this.jobs.create(actor, body);
  }

  @RequirePermissions('production-job:read')
  @Get('production-jobs/:jobId')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('jobId', new UuidParamPipe('Production job')) jobId: string,
  ): Promise<ProductionJobDto> {
    return this.jobs.get(actor, jobId);
  }

  @RequirePermissions('production-job:configure')
  @Patch('production-jobs/:jobId')
  configure(
    @CurrentActor() actor: ActorContext,
    @Param('jobId', new UuidParamPipe('Production job')) jobId: string,
    @Body(new ZodValidationPipe(ConfigureProductionJobRequestSchema))
    body: ConfigureProductionJobRequest,
  ): Promise<ProductionJobDto> {
    return this.jobs.configure(actor, jobId, body);
  }

  @RequirePermissions('production-job:validate')
  @Post('production-jobs/:jobId/validate')
  @HttpCode(200)
  validate(
    @CurrentActor() actor: ActorContext,
    @Param('jobId', new UuidParamPipe('Production job')) jobId: string,
    @Body(new ZodValidationPipe(ProductionJobRevisionRequestSchema))
    body: ProductionJobRevisionRequest,
  ): Promise<ProductionJobDto> {
    return this.jobs.validate(actor, jobId, body.expectedRevision);
  }

  @RequirePermissions('production-job:release')
  @Post('production-jobs/:jobId/release')
  @HttpCode(200)
  release(
    @CurrentActor() actor: ActorContext,
    @Param('jobId', new UuidParamPipe('Production job')) jobId: string,
    @Body(new ZodValidationPipe(ReleaseProductionJobRequestSchema))
    body: ReleaseProductionJobCommand,
  ): Promise<ProductionJobDto> {
    return this.jobs.release(actor, jobId, body);
  }

  @RequirePermissions('production-job:validate')
  @Post('production-jobs/:jobId/retry')
  @HttpCode(200)
  retry(
    @CurrentActor() actor: ActorContext,
    @Param('jobId', new UuidParamPipe('Production job')) jobId: string,
    @Body(new ZodValidationPipe(ProductionJobRevisionRequestSchema))
    body: ProductionJobRevisionRequest,
  ): Promise<ProductionJobDto> {
    return this.jobs.retry(actor, jobId, body.expectedRevision);
  }

  @RequirePermissions('production-job:cancel')
  @Post('production-jobs/:jobId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentActor() actor: ActorContext,
    @Param('jobId', new UuidParamPipe('Production job')) jobId: string,
    @Body(new ZodValidationPipe(ProductionJobRevisionRequestSchema))
    body: ProductionJobRevisionRequest,
  ): Promise<ProductionJobDto> {
    return this.jobs.cancel(actor, jobId, body.expectedRevision);
  }

  @RequirePermissions('production-job:read')
  @Get('production-jobs/:jobId/instances')
  listInstances(
    @CurrentActor() actor: ActorContext,
    @Param('jobId', new UuidParamPipe('Production job')) jobId: string,
    @Query(new ZodValidationPipe(ListProductionInstancesQuerySchema))
    query: ListProductionInstancesQuery,
  ): Promise<ProductionInstancePageDto> {
    return this.instances.list(actor, jobId, query);
  }

  @RequirePermissions('production-job:read')
  @Get('production-jobs/:jobId/samples')
  samples(
    @CurrentActor() actor: ActorContext,
    @Param('jobId', new UuidParamPipe('Production job')) jobId: string,
  ): Promise<ProductionSampleDto[]> {
    return this.instances.samples(actor, jobId);
  }

  @RequirePermissions('production-job:read')
  @Get('production-jobs/:jobId/instances/:sequence')
  getInstance(
    @CurrentActor() actor: ActorContext,
    @Param('jobId', new UuidParamPipe('Production job')) jobId: string,
    @Param('sequence', InstanceSequencePipe) sequence: number,
  ): Promise<ProductionInstanceDetailDto> {
    return this.instances.get(actor, jobId, sequence);
  }

  /** The manifest as JSON, together with the result of verifying the stored file. */
  @RequirePermissions('production-job:read')
  @Get('production-jobs/:jobId/manifest')
  async manifest(
    @CurrentActor() actor: ActorContext,
    @Param('jobId', new UuidParamPipe('Production job')) jobId: string,
  ) {
    const result = await this.instances.manifest(actor, jobId);
    return {
      manifest: result.manifest,
      checksumSha256: result.artifact.checksumSha256,
      sizeBytes: result.artifact.sizeBytes,
      createdAt: result.artifact.createdAt.toISOString(),
      verified: result.verified,
    };
  }

  /** The manifest file itself: an attachment, never a storage URL. */
  @RequirePermissions('production-job:read')
  @Get('production-jobs/:jobId/manifest/download')
  async downloadManifest(
    @CurrentActor() actor: ActorContext,
    @Param('jobId', new UuidParamPipe('Production job')) jobId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const result = await this.instances.manifest(actor, jobId);
    await this.instances.recordManifestDownload(
      actor,
      { id: result.job.id, jobNumber: result.job.jobNumber },
      result.artifact.checksumSha256,
    );
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Checksum-Sha256', result.artifact.checksumSha256);
    return new StreamableFile(Buffer.from(result.stored, 'utf8'), {
      type: 'application/json; charset=utf-8',
      disposition: attachmentDisposition(`${result.job.jobNumber}-manifest.json`),
    });
  }
}

@Controller()
export class SequencesController {
  constructor(private readonly sequences: SequencesService) {}

  @RequirePermissions('sequence:read')
  @Get('sequences')
  list(
    @CurrentActor() actor: ActorContext,
    @Query(new ZodValidationPipe(ListSequencesQuerySchema)) query: ListSequencesQuery,
  ): Promise<SequenceDto[]> {
    return this.sequences.list(actor, query);
  }

  @RequirePermissions('sequence:manage')
  @Post('sequences')
  create(
    @CurrentActor() actor: ActorContext,
    @Body(new ZodValidationPipe(CreateSequenceRequestSchema)) body: CreateSequenceCommand,
  ): Promise<SequenceDto> {
    return this.sequences.create(actor, body);
  }

  @RequirePermissions('sequence:read')
  @Get('sequences/:sequenceId')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('sequenceId', new UuidParamPipe('Sequence')) sequenceId: string,
  ): Promise<SequenceDto> {
    return this.sequences.get(actor, sequenceId);
  }

  @RequirePermissions('sequence:manage')
  @Patch('sequences/:sequenceId')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('sequenceId', new UuidParamPipe('Sequence')) sequenceId: string,
    @Body(new ZodValidationPipe(UpdateSequenceRequestSchema)) body: UpdateSequenceRequest,
  ): Promise<SequenceDto> {
    return this.sequences.update(actor, sequenceId, body);
  }
}
