'use client';

import { SaveConflictError, SaveForbiddenError, type SaveAdapter } from '@smarttag/editor-core';
import {
  type AssetDto,
  type AssetType,
  type PaginatedResponse,
  type TemplateVersionDetailDto,
} from '@smarttag/shared-types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest } from '@/lib/api-client';
import { templateKeys } from '../templates/api';

export const assetKeys = {
  placeable: (search: string, assetType: AssetType | '') =>
    ['assets', 'placeable', search, assetType] as const,
  all: ['assets'] as const,
};

/** Organization image assets that can be placed in artwork (filtered on the server). */
export function usePlaceableAssets(search: string, assetType: AssetType | '') {
  return useQuery({
    queryKey: assetKeys.placeable(search, assetType),
    queryFn: ({ signal }) =>
      apiRequest<PaginatedResponse<AssetDto>>('/assets', {
        query: {
          usage: 'PLACEABLE_IMAGE',
          search: search || undefined,
          assetType: assetType || undefined,
          pageSize: 60,
        },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useAssetsById(ids: readonly string[]) {
  return useQuery({
    queryKey: ['assets', 'by-id', [...ids].sort()],
    queryFn: async ({ signal }) =>
      Promise.all(
        ids.map((id) => apiRequest<AssetDto>(`/assets/${id}`, { signal }).catch(() => null)),
      ),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  });
}

export function useUploadAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, assetType }: { file: File; assetType: AssetType }) => {
      const form = new FormData();
      form.set('assetType', assetType);
      form.set('file', file);
      const response = await fetch('/api/v1/assets', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
        throw new ApiError(
          response.status,
          (error?.code as ApiError['code']) ?? 'INTERNAL_ERROR',
          error?.message ?? 'Upload failed',
          null,
          null,
        );
      }
      return body as AssetDto;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assetKeys.all }),
  });
}

/**
 * Persists the canonical document with optimistic concurrency. Maps API errors to the save
 * controller's error types so conflicts and immutability are handled explicitly.
 */
export function createVersionSaveAdapter(
  versionId: string,
  onSaved: (version: TemplateVersionDetailDto) => void,
): SaveAdapter {
  return {
    async save(document, expectedRevision) {
      try {
        const version = await apiRequest<TemplateVersionDetailDto>(
          `/template-versions/${versionId}`,
          {
            method: 'PATCH',
            json: { document, expectedRevision },
          },
        );
        onSaved(version);
        return { revision: version.revision, documentHash: version.documentHash };
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === 'VERSION_CONFLICT') {
            throw new SaveConflictError();
          }
          if (error.code === 'VERSION_IMMUTABLE' || error.code === 'FORBIDDEN') {
            throw new SaveForbiddenError(error.message);
          }
          if (error.code === 'INVALID_DOCUMENT') {
            const issue = error.details?.documentIssues?.[0];
            throw new Error(issue ? `${error.message}: ${issue.message}` : error.message);
          }
          throw new Error(error.message);
        }
        throw error;
      }
    },
  };
}

export function useInvalidateVersion() {
  const queryClient = useQueryClient();
  return (version: TemplateVersionDetailDto) => {
    queryClient.setQueryData(templateKeys.version(version.id), version);
    void queryClient.invalidateQueries({ queryKey: templateKeys.versions(version.templateId) });
    // The template page shows the current version's summary (object count, hash).
    void queryClient.invalidateQueries({ queryKey: templateKeys.detail(version.templateId) });
  };
}
