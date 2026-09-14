'use client';

import type { ReactNode } from 'react';
import { SessionGate } from '@/features/auth/session';

/** Full-screen designer: authenticated, without the application shell. */
export default function EditorLayout({ children }: { children: ReactNode }) {
  return <SessionGate>{children}</SessionGate>;
}
