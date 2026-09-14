'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from './api-client';

/**
 * A lost session (expiry, revocation, suspended membership) triggers a full page load of the
 * login screen rather than client-side navigation: this deliberately discards every in-memory
 * cache so no data from the previous session or tenant survives. It runs outside React, where
 * the Next.js router is not available.
 */
function redirectToLogin(error: unknown): void {
  if (error instanceof ApiError && error.code === 'UNAUTHENTICATED' && typeof window !== 'undefined') {
    const next = `${window.location.pathname}${window.location.search}`;
    if (!window.location.pathname.startsWith('/login')) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional hard reload, see above
      window.location.assign(`/login?next=${encodeURIComponent(next)}`);
    }
  }
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: redirectToLogin }),
    mutationCache: new MutationCache({ onError: redirectToLogin }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status < 500) && failureCount < 2,
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
