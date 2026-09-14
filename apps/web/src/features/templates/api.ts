'use client';

import type {
  CreateTemplateRequest,
  CustomerDto,
  ListTemplatesQuery,
  PaginatedResponse,
  TemplateDto,
  TemplateVersionDetailDto,
  TemplateVersionStatus,
  TemplateVersionSummaryDto,
  UpdateTemplateRequest,
} from '@smarttag/shared-types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

export const templateKeys = {
  all: ['templates'] as const,
  list: (query: Partial<ListTemplatesQuery>) => ['templates', 'list', query] as const,
  detail: (id: string) => ['templates', 'detail', id] as const,
  versions: (id: string) => ['templates', 'versions', id] as const,
  version: (id: string) => ['template-versions', id] as const,
};

export function useTemplates(query: Partial<ListTemplatesQuery>) {
  return useQuery({
    queryKey: templateKeys.list(query),
    queryFn: ({ signal }) =>
      apiRequest<PaginatedResponse<TemplateDto>>('/templates', { query, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useTemplate(templateId: string) {
  return useQuery({
    queryKey: templateKeys.detail(templateId),
    queryFn: ({ signal }) => apiRequest<TemplateDto>(`/templates/${templateId}`, { signal }),
  });
}

export function useTemplateVersions(templateId: string) {
  return useQuery({
    queryKey: templateKeys.versions(templateId),
    queryFn: ({ signal }) =>
      apiRequest<TemplateVersionSummaryDto[]>(`/templates/${templateId}/versions`, { signal }),
  });
}

export function useTemplateVersion(versionId: string | null) {
  return useQuery({
    queryKey: templateKeys.version(versionId ?? 'none'),
    queryFn: ({ signal }) =>
      apiRequest<TemplateVersionDetailDto>(`/template-versions/${versionId}`, { signal }),
    enabled: versionId !== null,
  });
}

export function useCustomers() {
  return useQuery({
    queryKey: ['customers'],
    queryFn: ({ signal }) => apiRequest<CustomerDto[]>('/customers', { signal }),
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTemplateRequest) =>
      apiRequest<TemplateDto>('/templates', { json: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templateKeys.all }),
  });
}

export function useUpdateTemplate(templateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTemplateRequest) =>
      apiRequest<TemplateDto>(`/templates/${templateId}`, { method: 'PATCH', json: input }),
    onSuccess: (template) => {
      queryClient.setQueryData(templateKeys.detail(templateId), template);
      return queryClient.invalidateQueries({ queryKey: ['templates', 'list'] });
    },
  });
}

export function useCreateVersion(templateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { basedOnVersionId: string; changeSummary: string }) =>
      apiRequest<TemplateVersionDetailDto>(`/templates/${templateId}/versions`, { json: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templateKeys.all }),
  });
}

export function useTransitionVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      versionId,
      targetStatus,
    }: {
      versionId: string;
      targetStatus: TemplateVersionStatus;
    }) =>
      apiRequest<TemplateVersionDetailDto>(`/template-versions/${versionId}/transitions`, {
        json: { targetStatus },
      }),
    onSuccess: (version) => {
      queryClient.setQueryData(templateKeys.version(version.id), version);
      return queryClient.invalidateQueries({ queryKey: templateKeys.all });
    },
  });
}
