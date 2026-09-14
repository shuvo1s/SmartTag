'use client';

import type { LoginRequest, Permission, SessionDto } from '@smarttag/shared-types';
import { Spinner } from '@smarttag/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import { ApiError, apiRequest } from '@/lib/api-client';

export const SESSION_QUERY_KEY = ['session'] as const;

export function useSessionQuery() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: ({ signal }) => apiRequest<SessionDto>('/auth/session', { signal }),
    staleTime: 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginRequest) => apiRequest<SessionDto>('/auth/login', { json: input }),
    onSuccess: (session) => queryClient.setQueryData(SESSION_QUERY_KEY, session),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => apiRequest<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      router.replace('/login');
      queryClient.clear();
    },
  });
}

export function useSwitchOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (organizationId: string) =>
      apiRequest<SessionDto>('/auth/session/organization', {
        method: 'PUT',
        json: { organizationId },
      }),
    onSuccess: (session) => {
      // All cached data belongs to the previous tenant.
      queryClient.clear();
      queryClient.setQueryData(SESSION_QUERY_KEY, session);
    },
  });
}

const SessionContext = createContext<SessionDto | null>(null);

/** Renders children only for an authenticated session. Authorization itself is enforced by the API. */
export function SessionGate({ children }: { children: ReactNode }) {
  const { data, error, isPending } = useSessionQuery();
  if (isPending || (error instanceof ApiError && error.code === 'UNAUTHENTICATED')) {
    return (
      <div className="flex min-h-screen items-center justify-center text-brand-700">
        <Spinner label="Loading your session" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-sm text-red-800">
        Unable to load your session. Please refresh the page.
      </div>
    );
  }
  return <SessionContext.Provider value={data}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionDto {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error('useSession must be used inside <SessionGate>');
  }
  return session;
}

/**
 * UI affordance only (hide/disable controls). Every action is authorized again by the API.
 */
export function useCan(permission: Permission): boolean {
  return useSession().permissions.includes(permission);
}
