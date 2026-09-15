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
  UploadedFile,
  UseInterceptors,
  type PipeTransform,
} from '@nestjs/common';
import { parseDesignDocument } from '@smarttag/document-schema';
import { buildCsvTemplate } from '@smarttag/import-core';
import {
  CreateDataImportFieldsSchema,
  CreateDatasetRequestSchema,
  CreateMappingProfileRequestSchema,
  FinalizeImportRequestSchema,
  ImportRevisionRequestSchema,
  ListDataImportsQuerySchema,
  ListDatasetRecordsQuerySchema,
  ListDatasetsQuerySchema,
  ListMappingProfilesQuerySchema,
  UpdateImportMappingRequestSchema,
  UpdateImportSourceSettingsRequestSchema,
  UpdateMappingProfileRequestSchema,
  type CreateDataImportFields,
  type CreateDatasetCommand,
  type CreateMappingProfileCommand,
  type DataImportDto,
  type DataImportSummaryDto,
  type DatasetDetailDto,
  type DatasetRecordDetailDto,
  type DatasetRecordPageDto,
  type DatasetSummaryDto,
  type DatasetVersionDetailDto,
  type FinalizeImportCommand,
  type ImportRevisionRequest,
  type ListDataImportsQuery,
  type ListDatasetRecordsQuery,
  type ListDatasetsQuery,
  type ListMappingProfilesQuery,
  type MappingProfileDto,
  type PaginatedResponse,
  type UpdateImportMappingRequest,
  type UpdateImportSourceSettingsRequest,
  type UpdateMappingProfileRequest,
} from '@smarttag/shared-types';
import type { Response } from 'express';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { UuidParamPipe, ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PrismaService } from '../../database/prisma.service';
import { CurrentActor, RequirePermissions } from '../authorization/authorization.decorators';
import { attachmentDisposition } from './data.mappers';
import { DataImportsService, type UploadedSourceFile } from './data-imports.service';
import { DatasetsService } from './datasets.service';
import { ImportUploadInterceptor } from './import-upload.interceptor';
import { MappingProfilesService } from './mapping-profiles.service';

/** A record sequence path parameter; anything but a positive integer is "not found". */
@Injectable()
class SequenceParamPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^[1-9]\d{0,8}$/.test(value)) throw AppError.notFound('Record');
    return Number(value);
  }
}

const SOURCE_CONTENT_TYPES = {
  CSV: 'text/csv; charset=binary',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

function sendSource(
  response: Response,
  source: Awaited<ReturnType<DatasetsService['openSource']>>,
): StreamableFile {
  // Downloads are attachments that can never render or execute in the application's origin.
  response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Checksum-Sha256', source.checksumSha256);
  return new StreamableFile(source.object.body, {
    type: SOURCE_CONTENT_TYPES[source.format],
    length: source.object.contentLength ?? undefined,
    disposition: attachmentDisposition(source.filename),
  });
}

@Controller()
export class DataImportsController {
  constructor(
    private readonly imports: DataImportsService,
    private readonly datasets: DatasetsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Uploads a CSV/XLSX file for one exact template version; inspection runs in the background. */
  @RequirePermissions('dataset:create')
  @Post('template-versions/:versionId/imports')
  @UseInterceptors(ImportUploadInterceptor)
  create(
    @CurrentActor() actor: ActorContext,
    @Param('versionId', new UuidParamPipe('Template version')) versionId: string,
    @Body(new ZodValidationPipe(CreateDataImportFieldsSchema)) body: CreateDataImportFields,
    @UploadedFile() file: UploadedSourceFile | undefined,
  ): Promise<DataImportDto> {
    return this.imports.create(actor, versionId, file, body.targetDatasetId);
  }

  /** A CSV file whose header row lists the version's data field keys. */
  @RequirePermissions('template:read')
  @Get('template-versions/:versionId/data-template.csv')
  async csvTemplate(
    @CurrentActor() actor: ActorContext,
    @Param('versionId', new UuidParamPipe('Template version')) versionId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const version = await this.prisma.templateVersion.findFirst({
      where: { id: versionId, organizationId: actor.organizationId },
      select: { documentJson: true, versionNumber: true, template: { select: { code: true } } },
    });
    if (!version) throw AppError.notFound('Template version');
    const parsed = parseDesignDocument(version.documentJson);
    if (!parsed.valid) throw AppError.invalidDocument(parsed.errors);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      attachmentDisposition(`${version.template.code}-v${version.versionNumber}-data-template.csv`),
    );
    return buildCsvTemplate(parsed.document.dataSchema);
  }

  @RequirePermissions('dataset:read')
  @Get('data-imports')
  list(
    @CurrentActor() actor: ActorContext,
    @Query(new ZodValidationPipe(ListDataImportsQuerySchema)) query: ListDataImportsQuery,
  ): Promise<PaginatedResponse<DataImportSummaryDto>> {
    return this.imports.list(actor, query);
  }

  @RequirePermissions('dataset:read')
  @Get('data-imports/:importId')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('importId', new UuidParamPipe('Data import')) importId: string,
  ): Promise<DataImportDto> {
    return this.imports.get(actor, importId);
  }

  @RequirePermissions('dataset:create')
  @Patch('data-imports/:importId/source-settings')
  updateSourceSettings(
    @CurrentActor() actor: ActorContext,
    @Param('importId', new UuidParamPipe('Data import')) importId: string,
    @Body(new ZodValidationPipe(UpdateImportSourceSettingsRequestSchema))
    body: UpdateImportSourceSettingsRequest,
  ): Promise<DataImportDto> {
    return this.imports.updateSourceSettings(actor, importId, body);
  }

  @RequirePermissions('dataset:create')
  @Patch('data-imports/:importId/mapping')
  updateMapping(
    @CurrentActor() actor: ActorContext,
    @Param('importId', new UuidParamPipe('Data import')) importId: string,
    @Body(new ZodValidationPipe(UpdateImportMappingRequestSchema)) body: UpdateImportMappingRequest,
  ): Promise<DataImportDto> {
    return this.imports.updateMapping(actor, importId, body);
  }

  @RequirePermissions('dataset:create')
  @Post('data-imports/:importId/validate')
  @HttpCode(200)
  validate(
    @CurrentActor() actor: ActorContext,
    @Param('importId', new UuidParamPipe('Data import')) importId: string,
    @Body(new ZodValidationPipe(ImportRevisionRequestSchema)) body: ImportRevisionRequest,
  ): Promise<DataImportDto> {
    return this.imports.validate(actor, importId, body);
  }

  @RequirePermissions('dataset:create')
  @Post('data-imports/:importId/retry')
  @HttpCode(200)
  retry(
    @CurrentActor() actor: ActorContext,
    @Param('importId', new UuidParamPipe('Data import')) importId: string,
    @Body(new ZodValidationPipe(ImportRevisionRequestSchema)) body: ImportRevisionRequest,
  ): Promise<DataImportDto> {
    return this.imports.retry(actor, importId, body);
  }

  @RequirePermissions('dataset:create')
  @Post('data-imports/:importId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentActor() actor: ActorContext,
    @Param('importId', new UuidParamPipe('Data import')) importId: string,
    @Body(new ZodValidationPipe(ImportRevisionRequestSchema)) body: ImportRevisionRequest,
  ): Promise<DataImportDto> {
    return this.imports.cancel(actor, importId, body);
  }

  @RequirePermissions('dataset:finalize')
  @Post('data-imports/:importId/finalize')
  @HttpCode(200)
  finalize(
    @CurrentActor() actor: ActorContext,
    @Param('importId', new UuidParamPipe('Data import')) importId: string,
    @Body(new ZodValidationPipe(FinalizeImportRequestSchema)) body: FinalizeImportCommand,
  ): Promise<DatasetVersionDetailDto> {
    return this.imports.finalize(actor, importId, body);
  }

  @RequirePermissions('dataset:read')
  @Get('data-imports/:importId/rows')
  async rows(
    @CurrentActor() actor: ActorContext,
    @Param('importId', new UuidParamPipe('Data import')) importId: string,
    @Query(new ZodValidationPipe(ListDatasetRecordsQuerySchema)) query: ListDatasetRecordsQuery,
  ): Promise<DatasetRecordPageDto> {
    return this.datasets.listRecords(
      await this.datasets.versionIdForImport(actor, importId),
      query,
    );
  }

  @RequirePermissions('dataset:read')
  @Get('data-imports/:importId/rows/:sequence')
  async row(
    @CurrentActor() actor: ActorContext,
    @Param('importId', new UuidParamPipe('Data import')) importId: string,
    @Param('sequence', SequenceParamPipe) sequence: number,
    @Query(new ZodValidationPipe(ListDatasetRecordsQuerySchema)) query: ListDatasetRecordsQuery,
  ): Promise<DatasetRecordDetailDto> {
    return this.datasets.getRecord(
      await this.datasets.versionIdForImport(actor, importId),
      sequence,
      query,
    );
  }

  @RequirePermissions('dataset:read-source')
  @Get('data-imports/:importId/source')
  async source(
    @CurrentActor() actor: ActorContext,
    @Param('importId', new UuidParamPipe('Data import')) importId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return sendSource(response, await this.datasets.openSource(actor, { importId }));
  }
}

@Controller()
export class DatasetsController {
  constructor(private readonly datasets: DatasetsService) {}

  @RequirePermissions('dataset:read')
  @Get('datasets')
  list(
    @CurrentActor() actor: ActorContext,
    @Query(new ZodValidationPipe(ListDatasetsQuerySchema)) query: ListDatasetsQuery,
  ): Promise<PaginatedResponse<DatasetSummaryDto>> {
    return this.datasets.list(actor, query);
  }

  @RequirePermissions('dataset:create')
  @Post('datasets')
  create(
    @CurrentActor() actor: ActorContext,
    @Body(new ZodValidationPipe(CreateDatasetRequestSchema)) body: CreateDatasetCommand,
  ): Promise<DatasetDetailDto> {
    return this.datasets.create(actor, body);
  }

  @RequirePermissions('dataset:read')
  @Get('datasets/:datasetId')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('datasetId', new UuidParamPipe('Dataset')) datasetId: string,
  ): Promise<DatasetDetailDto> {
    return this.datasets.get(actor, datasetId);
  }

  @RequirePermissions('dataset:read')
  @Get('dataset-versions/:versionId')
  version(
    @CurrentActor() actor: ActorContext,
    @Param('versionId', new UuidParamPipe('Dataset version')) versionId: string,
  ): Promise<DatasetVersionDetailDto> {
    return this.datasets.getVersion(actor, versionId);
  }

  @RequirePermissions('dataset:read')
  @Get('dataset-versions/:versionId/records')
  async records(
    @CurrentActor() actor: ActorContext,
    @Param('versionId', new UuidParamPipe('Dataset version')) versionId: string,
    @Query(new ZodValidationPipe(ListDatasetRecordsQuerySchema)) query: ListDatasetRecordsQuery,
  ): Promise<DatasetRecordPageDto> {
    return this.datasets.listRecords(
      await this.datasets.finalizedVersionId(actor, versionId),
      query,
    );
  }

  @RequirePermissions('dataset:read')
  @Get('dataset-versions/:versionId/records/:sequence')
  async record(
    @CurrentActor() actor: ActorContext,
    @Param('versionId', new UuidParamPipe('Dataset version')) versionId: string,
    @Param('sequence', SequenceParamPipe) sequence: number,
    @Query(new ZodValidationPipe(ListDatasetRecordsQuerySchema)) query: ListDatasetRecordsQuery,
  ): Promise<DatasetRecordDetailDto> {
    return this.datasets.getRecord(
      await this.datasets.finalizedVersionId(actor, versionId),
      sequence,
      query,
    );
  }

  @RequirePermissions('dataset:read-source')
  @Get('dataset-versions/:versionId/source')
  async source(
    @CurrentActor() actor: ActorContext,
    @Param('versionId', new UuidParamPipe('Dataset version')) versionId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return sendSource(response, await this.datasets.openSource(actor, { versionId }));
  }
}

@Controller('mapping-profiles')
export class MappingProfilesController {
  constructor(private readonly profiles: MappingProfilesService) {}

  @RequirePermissions('mapping-profile:read')
  @Get()
  list(
    @CurrentActor() actor: ActorContext,
    @Query(new ZodValidationPipe(ListMappingProfilesQuerySchema)) query: ListMappingProfilesQuery,
  ): Promise<MappingProfileDto[]> {
    return this.profiles.list(actor, query);
  }

  @RequirePermissions('mapping-profile:manage')
  @Post()
  create(
    @CurrentActor() actor: ActorContext,
    @Body(new ZodValidationPipe(CreateMappingProfileRequestSchema))
    body: CreateMappingProfileCommand,
  ): Promise<MappingProfileDto> {
    return this.profiles.create(actor, body);
  }

  @RequirePermissions('mapping-profile:read')
  @Get(':profileId')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('profileId', new UuidParamPipe('Mapping profile')) profileId: string,
  ): Promise<MappingProfileDto> {
    return this.profiles.get(actor, profileId);
  }

  @RequirePermissions('mapping-profile:manage')
  @Patch(':profileId')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('profileId', new UuidParamPipe('Mapping profile')) profileId: string,
    @Body(new ZodValidationPipe(UpdateMappingProfileRequestSchema))
    body: UpdateMappingProfileRequest,
  ): Promise<MappingProfileDto> {
    return this.profiles.update(actor, profileId, body);
  }
}
