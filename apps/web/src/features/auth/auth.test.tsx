import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { LoginForm } from './login-form';
import { safeNextPath } from './login-panel';

describe('LoginForm', () => {
  it('validates input before calling the API', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<LoginForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/Email/), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits normalised credentials', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<LoginForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/Email/), '  Designer@SmartTag.local ');
    await userEvent.type(screen.getByLabelText(/Password/), 'secret-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ email: 'designer@smarttag.local', password: 'secret-password' }));
  });

  it('shows the server error', () => {
    render(<LoginForm onSubmit={vi.fn()} error={new ApiError(401, 'UNAUTHENTICATED', 'Invalid email or password', null, null)} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});

describe('safeNextPath', () => {
  it.each([
    ['/templates/123', '/templates/123'],
    ['/developer/playground?versionId=abc', '/developer/playground?versionId=abc'],
    [null, '/dashboard'],
    ['https://evil.example', '/dashboard'],
    ['//evil.example', '/dashboard'],
    ['/\\evil.example', '/dashboard'],
  ])('%p → %p', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
