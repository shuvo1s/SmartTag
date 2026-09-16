'use client';

import {
  type ConfigureProductionJobRequest,
  type CreateProductionJobRequest,
  type CreateSequenceRequest,
  type ListProductionInstancesQuery,
  type PaginatedResponse,
  type ProductionInstanceDetailDto,
  type ProductionInstancePageDto,
  type ProductionJobDto,
  type ProductionJobSummaryDto,
  type ProductionSampleDto,
  type SequenceDto,
  type UpdateSequenceRequest,
} from '@smarttag/shared-types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE_PATH, apiRequest } from '@/lib/api-client';

export const productionKeys = {
  jobs: (query: object) => ['production', 'jobs', query] as const,
  job: (id: string) => ['production', 'job', id] as const,
  instances: (id: string, query: object) => ['production', 'job', id, 'instances', query] as const,
  instance: (id: string, sequence: number) =>
    ['production', 'job', id, 'instance', sequence] as const,
  samples: (id: string) => ['production', 'job', id, 'samples'] as const,
  manifest: (id: string) => ['production', 'job', id, 'manifest'] as const,
  sequences: (query: object) => ['production', 'sequences', query] as const,
};

/** Statuses in which the worker is still doing something, so the page keeps polling. */
const WORKING = new Set(['QUEUED', 'EXPANDING', 'VALIDATING', 'RELEASED']);

export function useProductionJobs(query: {
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
  customerId?: string;
  templateId?: string;
}) {
  return useQuery({
    queryKey: productionKeys.jobs(query),
    queryFn: ({ signal }) =>
      apiRequest<PaginatedResponse<ProductionJobSummaryDto>>('/production-jobs', { query, signal }),
    placeholderData: keepPreviousData,
  });
}

/** Polls while the worker expands, validates or finishes a release. */
export function useProductionJob(jobId: string) {
  return useQuery({
    queryKey: productionKeys.job(jobId),
    queryFn: ({ signal }) => apiRequest<ProductionJobDto>(`/production-jobs/${jobId}`, { signal }),
    refetchInterval: (query) =>
      query.state.data && WORKING.has(query.state.data.status) ? 1000 : false,
  });
}

export function useProductionInstances(jobId: string, query: ListProductionInstancesQuery) {
  return useQuery({
    queryKey: productionKeys.instances(jobId, query),
    queryFn: ({ signal }) =>
      apiRequest<ProductionInstancePageDto>(`/production-jobs/${jobId}/instances`, {
        query,
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useProductionInstance(jobId: string, sequence: number | null) {
  return useQuery({
    enabled: sequence !== null,
    queryKey: productionKeys.instance(jobId, sequence ?? 0),
    queryFn: ({ signal }) =>
      apiRequest<ProductionInstanceDetailDto>(
        `/production-jobs/${jobId}/instances/${sequence ?? 0}`,
        { signal },
      ),
  });
}

export function useProductionSamples(jobId: string, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: productionKeys.samples(jobId),
    queryFn: ({ signal }) =>
      apiRequest<ProductionSampleDto[]>(`/production-jobs/${jobId}/samples`, { signal }),
  });
}

export interface ManifestResponse {
  readonly manifest: Record<string, unknown>;
  readonly checksumSha256: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly verified: {
    readonly valid: boolean;
    readonly issues: { code: string; message: string }[];
  };
}

export function useProductionManifest(jobId: string, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: productionKeys.manifest(jobId),
    queryFn: ({ signal }) =>
      apiRequest<ManifestResponse>(`/production-jobs/${jobId}/manifest`, { signal }),
  });
}

export function manifestDownloadUrl(jobId: string): string {
  return `${API_BASE_PATH}/production-jobs/${jobId}/manifest/download`;
}

export function useSequences(query: { status?: 'ACTIVE' | 'ARCHIVED' } = {}) {
  return useQuery({
    queryKey: productionKeys.sequences(query),
    queryFn: ({ signal }) => apiRequest<SequenceDto[]>('/sequences', { query, signal }),
  });
}

export function useCreateSequence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSequenceRequest) =>
      apiRequest<SequenceDto>('/sequences', { method: 'POST', json: body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['production', 'sequences'] }),
  });
}

export function useUpdateSequence(sequenceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSequenceRequest) =>
      apiRequest<SequenceDto>(`/sequences/${sequenceId}`, { method: 'PATCH', json: body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['production', 'sequences'] }),
  });
}

export function useCreateProductionJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProductionJobRequest) =>
      apiRequest<ProductionJobDto>('/production-jobs', { method: 'POST', json: body }),
    onSuccess: (dto) => {
      queryClient.setQueryData(productionKeys.job(dto.id), dto);
      return queryClient.invalidateQueries({ queryKey: ['production', 'jobs'] });
    },
  });
}

/** A state-changing job action; the response replaces the cached job. */
function useJobAction<TInput>(
  jobId: string,
  request: (input: TInput) => Promise<ProductionJobDto>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (dto) => {
      queryClient.setQueryData(productionKeys.job(jobId), dto);
      return queryClient.invalidateQueries({ queryKey: ['production', 'job', jobId, 'instances'] });
    },
  });
}

export function useConfigureJob(jobId: string) {
  return useJobAction(jobId, (body: ConfigureProductionJobRequest) =>
    apiRequest<ProductionJobDto>(`/production-jobs/${jobId}`, { method: 'PATCH', json: body }),
  );
}

export function useValidateJob(jobId: string) {
  return useJobAction(jobId, (body: { expectedRevision: number }) =>
    apiRequest<ProductionJobDto>(`/production-jobs/${jobId}/validate`, {
      method: 'POST',
      json: body,
    }),
  );
}

export function useReleaseJob(jobId: string) {
  return useJobAction(jobId, (body: { expectedRevision: number; acknowledgeWarnings: boolean }) =>
    apiRequest<ProductionJobDto>(`/production-jobs/${jobId}/release`, {
      method: 'POST',
      json: body,
    }),
  );
}

export function useCancelJob(jobId: string) {
  return useJobAction(jobId, (body: { expectedRevision: number }) =>
    apiRequest<ProductionJobDto>(`/production-jobs/${jobId}/cancel`, {
      method: 'POST',
      json: body,
    }),
  );
}

export function useRetryJob(jobId: string) {
  return useJobAction(jobId, (body: { expectedRevision: number }) =>
    apiRequest<ProductionJobDto>(`/production-jobs/${jobId}/retry`, { method: 'POST', json: body }),
  );
}
