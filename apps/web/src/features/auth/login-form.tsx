'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoginRequestSchema, type LoginRequest } from '@smarttag/shared-types';
import { Alert, Button, Field, Input } from '@smarttag/ui';
import { useForm } from 'react-hook-form';
import { describeError } from '@/lib/api-client';

export interface LoginFormProps {
  onSubmit: (values: LoginRequest) => Promise<unknown>;
  error?: unknown;
}

export function LoginForm({ onSubmit, error }: LoginFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({ resolver: zodResolver(LoginRequestSchema), defaultValues: { email: '', password: '' } });

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => void handleSubmit((values) => onSubmit(values).catch(() => undefined))(event)}
    >
      {error ? <Alert tone="danger">{describeError(error)}</Alert> : null}
      <Field label="Email" error={errors.email?.message} required>
        <Input type="email" autoComplete="username" {...register('email')} />
      </Field>
      <Field label="Password" error={errors.password?.message} required>
        <Input type="password" autoComplete="current-password" {...register('password')} />
      </Field>
      <Button type="submit" className="w-full" loading={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}
