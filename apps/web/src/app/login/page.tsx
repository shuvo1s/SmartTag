import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginPanel } from '@/features/auth/login-panel';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-lg bg-brand-700 text-lg font-bold text-white">ST</div>
          <h1 className="text-xl font-semibold text-slate-900">SmartTag Platform</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your organization</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
          <Suspense>
            <LoginPanel />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
