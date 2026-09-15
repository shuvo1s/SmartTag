import { Injectable } from '@nestjs/common';
import type { Prisma } from '@smarttag/database';
import { parseDesignDocument } from '@smarttag/document-schema';
import {
  MappingDefinitionSchema,
  MappingProfileDefinitionSchema,
  computeHeaderSignature,
  createProfileDefinition,
  validateMapping,
  type MappingProfileDefinition,
  type SourceColumn,
} from '@smarttag/import-core';
import type {
  CreateMappingProfileCommand,
  ListMappingProfilesQuery,
  MappingProfileDto,
  UpdateMappingProfileRequest,
} from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { userRef } from './data.mappers';

const profileSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  currentRevision: true,
  dataSchemaHash: true,
  headerSignature: true,
  sourceFormat: true,
  definition: true,
  createdAt: true,
  updatedAt: true,
  createdBy: userRef,
  updatedBy: userRef,
  revisions: {
    orderBy: { revision: 'desc' },
    select: {
      revision: true,
      name: true,
      dataSchemaHash: true,
      headerSignature: true,
      createdAt: true,
      createdBy: userRef,
    },
  },
} as const satisfies Prisma.MappingProfileSelect;

type ProfileRow = Prisma.MappingProfileGetPayload<{ select: typeof profileSelect }>;

function toDto(row: ProfileRow): MappingProfileDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    currentRevision: row.currentRevision,
    dataSchemaHash: row.dataSchemaHash,
    headerSignature: row.headerSignature,
    sourceFormat: row.sourceFormat,
    definition: row.definition as unknown as MappingProfileDefinition,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revisions: row.revisions.map((revision) => ({
      ...revision,
      createdAt: revision.createdAt.toISOString(),
    })),
  };
}

/**
 * Reusable mappings. A profile is always built from an import's saved, complete mapping, so it
 * only ever contains mappings that validated against a real file and template. Every change adds
 * an immutable revision; dataset versions keep their own mapping snapshot regardless.
 */
@Injectable()
export class MappingProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: ActorContext, query: ListMappingProfilesQuery): Promise<MappingProfileDto[]> {
    const rows = await this.prisma.mappingProfile.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(query.dataSchemaHash ? { dataSchemaHash: query.dataSchemaHash } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 200,
      select: profileSelect,
    });
    return rows.map(toDto);
  }

  async get(actor: ActorContext, profileId: string): Promise<MappingProfileDto> {
    const row = await this.prisma.mappingProfile.findFirst({
      where: { id: profileId, organizationId: actor.organizationId },
      select: profileSelect,
    });
    if (!row) throw AppError.notFound('Mapping profile');
    return toDto(row);
  }

  /** The definition, schema hash and header signature of an import's saved mapping. */
  private async definitionFromImport(actor: ActorContext, importId: string) {
    const row = await this.prisma.dataImport.findFirst({
      where: { id: importId, organizationId: actor.organizationId },
      select: {
        dataSchemaHash: true,
        columns: true,
        mapping: true,
        sourceFile: { select: { format: true } },
        templateVersion: { select: { documentJson: true } },
      },
    });
    if (!row) throw AppError.notFound('Data import');
    if (row.mapping === null)
      throw new AppError('MAPPING_INCOMPLETE', 'The import has no saved mapping.');
    const parsed = parseDesignDocument(row.templateVersion.documentJson);
    if (!parsed.valid) throw AppError.invalidDocument(parsed.errors);
    const columns = row.columns as unknown as SourceColumn[];
    const mapping = MappingDefinitionSchema.parse(row.mapping);
    if (!validateMapping(parsed.document.dataSchema, columns, mapping).complete) {
      throw new AppError(
        'MAPPING_INCOMPLETE',
        'Only a complete mapping can be saved as a profile.',
      );
    }
    const definition = createProfileDefinition(
      parsed.document.dataSchema,
      columns,
      mapping,
      row.sourceFile.format,
    );
    return {
      definition,
      dataSchemaHash: row.dataSchemaHash,
      headerSignature: await computeHeaderSignature(columns),
      sourceFormat: row.sourceFile.format,
    };
  }

  async create(
    actor: ActorContext,
    input: CreateMappingProfileCommand,
  ): Promise<MappingProfileDto> {
    const source = await this.definitionFromImport(actor, input.importId);
    const profileId = await this.prisma.$transaction(async (tx) => {
      const clash = await tx.mappingProfile.findFirst({
        where: { organizationId: actor.organizationId, name: input.name },
        select: { id: true },
      });
      if (clash) throw AppError.conflict(`A mapping profile named "${input.name}" already exists`);
      const profile = await tx.mappingProfile.create({
        data: {
          organizationId: actor.organizationId,
          name: input.name,
          description: input.description,
          dataSchemaHash: source.dataSchemaHash,
          headerSignature: source.headerSignature,
          sourceFormat: source.sourceFormat,
          definition: source.definition,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        select: { id: true },
      });
      await tx.mappingProfileRevision.create({
        data: {
          profileId: profile.id,
          revision: 1,
          organizationId: actor.organizationId,
          name: input.name,
          definition: source.definition,
          dataSchemaHash: source.dataSchemaHash,
          headerSignature: source.headerSignature,
          createdById: actor.userId,
        },
      });
      // The import now traces its mapping to this profile revision.
      await tx.dataImport.updateMany({
        where: {
          id: input.importId,
          organizationId: actor.organizationId,
          status: { notIn: ['FINALIZED', 'CANCELLED'] },
        },
        data: {
          mappingProfileId: profile.id,
          mappingProfileRevision: 1,
          revision: { increment: 1 },
        },
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'MAPPING_PROFILE_CREATED',
        resourceType: 'MAPPING_PROFILE',
        resourceId: profile.id,
        metadata: {
          revision: 1,
          dataSchemaHash: source.dataSchemaHash,
          headerSignature: source.headerSignature,
          entries: source.definition.mapping.entries.length,
          importId: input.importId,
        },
      });
      return profile.id;
    });
    return this.get(actor, profileId);
  }

  async update(
    actor: ActorContext,
    profileId: string,
    input: UpdateMappingProfileRequest,
  ): Promise<MappingProfileDto> {
    const current = await this.prisma.mappingProfile.findFirst({
      where: { id: profileId, organizationId: actor.organizationId },
      select: {
        id: true,
        name: true,
        currentRevision: true,
        definition: true,
        dataSchemaHash: true,
        headerSignature: true,
      },
    });
    if (!current) throw AppError.notFound('Mapping profile');
    if (current.currentRevision !== input.expectedRevision) {
      throw new AppError(
        'VERSION_CONFLICT',
        'The mapping profile was changed by someone else. Reload it and try again.',
        {
          currentRevision: current.currentRevision,
        },
      );
    }
    const source = input.importId ? await this.definitionFromImport(actor, input.importId) : null;
    const definition =
      source?.definition ?? MappingProfileDefinitionSchema.parse(current.definition);
    const name = input.name ?? current.name;
    const revision = current.currentRevision + 1;
    await this.prisma.$transaction(async (tx) => {
      if (input.name && input.name !== current.name) {
        const clash = await tx.mappingProfile.findFirst({
          where: { organizationId: actor.organizationId, name: input.name, id: { not: profileId } },
          select: { id: true },
        });
        if (clash)
          throw AppError.conflict(`A mapping profile named "${input.name}" already exists`);
      }
      const updated = await tx.mappingProfile.updateMany({
        where: {
          id: profileId,
          organizationId: actor.organizationId,
          currentRevision: input.expectedRevision,
        },
        data: {
          name,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status ? { status: input.status } : {}),
          currentRevision: revision,
          definition: definition,
          dataSchemaHash: source?.dataSchemaHash ?? current.dataSchemaHash,
          headerSignature: source?.headerSignature ?? current.headerSignature,
          ...(source ? { sourceFormat: source.sourceFormat } : {}),
          updatedById: actor.userId,
        },
      });
      if (updated.count === 0) {
        throw new AppError(
          'VERSION_CONFLICT',
          'The mapping profile was changed by someone else. Reload it and try again.',
        );
      }
      await tx.mappingProfileRevision.create({
        data: {
          profileId,
          revision,
          organizationId: actor.organizationId,
          name,
          definition: definition,
          dataSchemaHash: source?.dataSchemaHash ?? current.dataSchemaHash,
          headerSignature: source?.headerSignature ?? current.headerSignature,
          createdById: actor.userId,
        },
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'MAPPING_PROFILE_UPDATED',
        resourceType: 'MAPPING_PROFILE',
        resourceId: profileId,
        metadata: {
          revision,
          renamed: input.name !== undefined && input.name !== current.name,
          status: input.status ?? null,
          definitionReplaced: source !== null,
          importId: input.importId ?? null,
        },
      });
    });
    return this.get(actor, profileId);
  }
}
