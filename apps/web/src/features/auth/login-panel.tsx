'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { LoginForm } from './login-form';
import { useLogin } from './session';

/** Only allow same-site relative redirects after login (prevents open redirects). */
export function safeNextPath(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : '/dashboard';
}

export function LoginPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useLogin();

  return (
    <LoginForm
      error={login.error}
      onSubmit={async (values) => {
        await login.mutateAsync(values);
        router.replace(safeNextPath(searchParams.get('next')));
      }}
    />
  );
}
