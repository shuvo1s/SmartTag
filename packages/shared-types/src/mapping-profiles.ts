import type { MappingProfileDefinition, SourceFormat } from '@smarttag/import-core';
import { z } from 'zod';
import type { UserRefDto } from './templates';

export const MAPPING_PROFILE_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type MappingProfileStatus = (typeof MAPPING_PROFILE_STATUSES)[number];

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** A profile is created from an import's saved mapping and source columns. */
export const CreateMappingProfileRequestSchema = z.object({
  name: z.string().trim().min(1, { error: 'Enter a profile name' }).max(200),
  description: z.string().trim().max(2000).default(''),
  importId: z.uuid(),
});
export type CreateMappingProfileRequest = z.input<typeof CreateMappingProfileRequestSchema>;
export type CreateMappingProfileCommand = z.output<typeof CreateMappingProfileRequestSchema>;

/**
 * Renaming, archiving or replacing the definition (from an import) creates a new revision; earlier
 * revisions stay unchanged, and dataset versions keep their own mapping snapshots anyway.
 */
export const UpdateMappingProfileRequestSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    status: z.enum(MAPPING_PROFILE_STATUSES).optional(),
    importId: z.uuid().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.status !== undefined ||
      value.importId !== undefined,
    { error: 'Nothing to update' },
  );
export type UpdateMappingProfileRequest = z.infer<typeof UpdateMappingProfileRequestSchema>;

export const ListMappingProfilesQuerySchema = z.object({
  dataSchemaHash: HashSchema.optional(),
  status: z.enum(MAPPING_PROFILE_STATUSES).optional(),
});
export type ListMappingProfilesQuery = z.infer<typeof ListMappingProfilesQuerySchema>;

export interface MappingProfileRevisionDto {
  readonly revision: number;
  readonly name: string;
  readonly dataSchemaHash: string;
  readonly headerSignature: string;
  readonly createdBy: UserRefDto;
  readonly createdAt: string;
}

export interface MappingProfileDto {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: MappingProfileStatus;
  readonly currentRevision: number;
  readonly dataSchemaHash: string;
  readonly headerSignature: string;
  readonly sourceFormat: SourceFormat | null;
  readonly definition: MappingProfileDefinition;
  readonly createdBy: UserRefDto;
  readonly updatedBy: UserRefDto;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revisions: readonly MappingProfileRevisionDto[];
}
