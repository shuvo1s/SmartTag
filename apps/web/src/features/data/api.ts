'use client';

import type { MappingDefinition, SourceSettings } from '@smarttag/import-core';
import {
  isApiErrorBody,
  type CreateDatasetRequest,
  type CreateMappingProfileRequest,
  type DataImportDto,
  type DataImportSummaryDto,
  type DatasetDetailDto,
  type DatasetRecordDetailDto,
  type DatasetRecordPageDto,
  type DatasetSummaryDto,
  type DatasetVersionDetailDto,
  type FinalizeImportRequest,
  type ListDatasetRecordsQuery,
  type MappingProfileDto,
  type PaginatedResponse,
  type UpdateMappingProfileRequest,
} from '@smarttag/shared-types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE_PATH, ApiError, apiRequest } from '@/lib/api-client';

export const dataKeys = {
  all: ['data'] as const,
  imports: (query: object) => ['data', 'imports', query] as const,
  import: (id: string) => ['data', 'import', id] as const,
  importRows: (id: string, query: object) => ['data', 'import', id, 'rows', query] as const,
  importRow: (id: string, sequence: number, query: object) =>
    ['data', 'import', id, 'row', sequence, query] as const,
  datasets: (query: object) => ['data', 'datasets', query] as const,
  dataset: (id: string) => ['data', 'dataset', id] as const,
  version: (id: string) => ['data', 'version', id] as const,
  versionRecords: (id: string, query: object) => ['data', 'version', id, 'records', query] as const,
  versionRecord: (id: string, sequence: number, query: object) =>
    ['data', 'version', id, 'record', sequence, query] as const,
  profiles: (query: object) => ['data', 'profiles', query] as const,
  profile: (id: string) => ['data', 'profile', id] as const,
};

const PROCESSING = new Set(['UPLOADED', 'INSPECTING', 'VALIDATING']);

export function useDataImports(query: { page: number; pageSize: number; status?: string }) {
  return useQuery({
    queryKey: dataKeys.imports(query),
    queryFn: ({ signal }) =>
      apiRequest<PaginatedResponse<DataImportSummaryDto>>('/data-imports', { query, signal }),
    placeholderData: keepPreviousData,
  });
}

/** Polls while the worker is inspecting or validating (progress is stored by the worker). */
export function useDataImport(importId: string) {
  return useQuery({
    queryKey: dataKeys.import(importId),
    queryFn: ({ signal }) => apiRequest<DataImportDto>(`/data-imports/${importId}`, { signal }),
    refetchInterval: (query) =>
      query.state.data && PROCESSING.has(query.state.data.status) ? 1000 : false,
  });
}

async function uploadImport(versionId: string, file: File, targetDatasetId: string | null) {
  const form = new FormData();
  if (targetDatasetId) form.set('targetDatasetId', targetDatasetId);
  form.set('file', file);
  const response = await fetch(`${API_BASE_PATH}/template-versions/${versionId}/imports`, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiError(
        response.status,
        body.error.code,
        body.error.message,
        body.error.details,
        body.error.requestId,
      );
    }
    throw new ApiError(response.status, 'INTERNAL_ERROR', 'The upload failed', null, null);
  }
  return body as DataImportDto;
}

export function useUploadImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      versionId,
      file,
      targetDatasetId,
    }: {
      versionId: string;
      file: File;
      targetDatasetId: string | null;
    }) => uploadImport(versionId, file, targetDatasetId),
    onSuccess: (dto) => {
      queryClient.setQueryData(dataKeys.import(dto.id), dto);
      return queryClient.invalidateQueries({ queryKey: ['data', 'imports'] });
    },
  });
}

/** A state-changing import action; the response replaces the cached import. */
function useImportAction<TInput>(
  importId: string,
  request: (input: TInput) => Promise<DataImportDto>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (dto) => {
      queryClient.setQueryData(dataKeys.import(importId), dto);
      return queryClient.invalidateQueries({ queryKey: ['data', 'import', importId, 'rows'] });
    },
  });
}

export function useUpdateSourceSettings(importId: string) {
  return useImportAction(
    importId,
    (input: { expectedRevision: number; settings: SourceSettings }) =>
      apiRequest<DataImportDto>(`/data-imports/${importId}/source-settings`, {
        method: 'PATCH',
        json: input,
      }),
  );
}

export function useUpdateMapping(importId: string) {
  return useImportAction(
    importId,
    (input: {
      expectedRevision: number;
      mapping: MappingDefinition;
      profile: { id: string; revision: number } | null;
    }) =>
      apiRequest<DataImportDto>(`/data-imports/${importId}/mapping`, {
        method: 'PATCH',
        json: input,
      }),
  );
}

export function useImportCommand(importId: string, command: 'validate' | 'retry' | 'cancel') {
  return useImportAction(importId, (input: { expectedRevision: number }) =>
    apiRequest<DataImportDto>(`/data-imports/${importId}/${command}`, { json: input }),
  );
}

export function useFinalizeImport(importId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FinalizeImportRequest) =>
      apiRequest<DatasetVersionDetailDto>(`/data-imports/${importId}/finalize`, { json: input }),
    onSuccess: (version) => {
      queryClient.setQueryData(dataKeys.version(version.id), version);
      return queryClient.invalidateQueries({ queryKey: dataKeys.all });
    },
  });
}

export type RecordQuery = Pick<
  ListDatasetRecordsQuery,
  'page' | 'pageSize' | 'status' | 'search' | 'duplicates'
>;

function recordsPath(scope: RecordScope): string {
  return scope.kind === 'import'
    ? `/data-imports/${scope.id}/rows`
    : `/dataset-versions/${scope.id}/records`;
}

export type RecordScope = { readonly kind: 'import' | 'version'; readonly id: string };

export function useRecords(scope: RecordScope, query: RecordQuery, enabled = true) {
  return useQuery({
    queryKey:
      scope.kind === 'import'
        ? dataKeys.importRows(scope.id, query)
        : dataKeys.versionRecords(scope.id, query),
    queryFn: ({ signal }) =>
      apiRequest<DatasetRecordPageDto>(recordsPath(scope), {
        query: {
          page: query.page,
          pageSize: query.pageSize,
          status: query.status,
          search: query.search,
          duplicates: query.duplicates,
        },
        signal,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useRecord(
  scope: RecordScope,
  sequence: number | null,
  query: Omit<RecordQuery, 'page' | 'pageSize'>,
) {
  return useQuery({
    queryKey:
      scope.kind === 'import'
        ? dataKeys.importRow(scope.id, sequence ?? 0, query)
        : dataKeys.versionRecord(scope.id, sequence ?? 0, query),
    queryFn: ({ signal }) =>
      apiRequest<DatasetRecordDetailDto>(`${recordsPath(scope)}/${sequence}`, {
        query: { status: query.status, search: query.search, duplicates: query.duplicates },
        signal,
      }),
    enabled: sequence !== null,
    placeholderData: keepPreviousData,
  });
}

export function useDatasets(query: { page: number; pageSize: number; search?: string }) {
  return useQuery({
    queryKey: dataKeys.datasets(query),
    queryFn: ({ signal }) =>
      apiRequest<PaginatedResponse<DatasetSummaryDto>>('/datasets', { query, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useDataset(datasetId: string) {
  return useQuery({
    queryKey: dataKeys.dataset(datasetId),
    queryFn: ({ signal }) => apiRequest<DatasetDetailDto>(`/datasets/${datasetId}`, { signal }),
  });
}

export function useCreateDataset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDatasetRequest) =>
      apiRequest<DatasetDetailDto>('/datasets', { json: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['data', 'datasets'] }),
  });
}

export function useDatasetVersion(versionId: string) {
  return useQuery({
    queryKey: dataKeys.version(versionId),
    queryFn: ({ signal }) =>
      apiRequest<DatasetVersionDetailDto>(`/dataset-versions/${versionId}`, { signal }),
  });
}

export function useMappingProfiles(query: { dataSchemaHash?: string } = {}) {
  return useQuery({
    queryKey: dataKeys.profiles(query),
    queryFn: ({ signal }) =>
      apiRequest<MappingProfileDto[]>('/mapping-profiles', { query, signal }),
  });
}

export function useMappingProfile(profileId: string) {
  return useQuery({
    queryKey: dataKeys.profile(profileId),
    queryFn: ({ signal }) =>
      apiRequest<MappingProfileDto>(`/mapping-profiles/${profileId}`, { signal }),
  });
}

export function useCreateMappingProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMappingProfileRequest) =>
      apiRequest<MappingProfileDto>('/mapping-profiles', { json: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dataKeys.all }),
  });
}

export function useUpdateMappingProfile(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMappingProfileRequest) =>
      apiRequest<MappingProfileDto>(`/mapping-profiles/${profileId}`, {
        method: 'PATCH',
        json: input,
      }),
    onSuccess: (profile) => {
      queryClient.setQueryData(dataKeys.profile(profileId), profile);
      return queryClient.invalidateQueries({ queryKey: ['data', 'profiles'] });
    },
  });
}
