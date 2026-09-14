'use client';

import type { ReactNode } from 'react';
import { SessionGate } from '@/features/auth/session';
import { AppShell } from '@/features/shell/app-shell';

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate>
      <AppShell>{children}</AppShell>
    </SessionGate>
  );
}
