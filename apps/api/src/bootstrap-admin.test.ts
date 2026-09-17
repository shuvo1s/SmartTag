import { describe, expect, it } from 'vitest';
import {
  BootstrapAdminError,
  deriveOrganizationSlug,
  normalizeBootstrapAdminInput,
  readBootstrapAdminEnvironment,
} from './bootstrap-admin';

describe('production admin bootstrap configuration', () => {
  it('derives a deterministic organization slug and normalizes the administrator email', () => {
    const input = normalizeBootstrapAdminInput({
      organizationName: '  Yunusco T&A (BD) Limited  ',
      adminEmail: '  ADMIN@EXAMPLE.COM ',
      adminPassword: 'A-Strong-Test-Password-1',
    });

    expect(input.organizationName).toBe('Yunusco T&A (BD) Limited');
    expect(input.organizationSlug).toBe('yunusco-t-and-a-bd-limited');
    expect(input.adminEmail).toBe('admin@example.com');
    expect(input.displayName).toBe('admin@example.com');
  });

  it('reads only the four bootstrap runtime values and accepts PostgreSQL URLs', () => {
    const config = readBootstrapAdminEnvironment({
      DATABASE_URL: 'postgresql://smarttag:secret@postgres:5432/smarttagdb',
      BOOTSTRAP_ORGANIZATION_NAME: 'Yunusco T&A (BD) Limited',
      BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
      BOOTSTRAP_ADMIN_PASSWORD: 'A-Strong-Test-Password-1',
      NODE_ENV: 'production',
    });

    expect(config.databaseUrl).toBe('postgresql://smarttag:secret@postgres:5432/smarttagdb');
    expect(config.input.organizationSlug).toBe('yunusco-t-and-a-bd-limited');
  });

  it('rejects missing or short passwords without including the password value in the error', () => {
    const supplied = 'short';
    expect(() =>
      normalizeBootstrapAdminInput({
        organizationName: 'Yunusco',
        adminEmail: 'admin@example.com',
        adminPassword: supplied,
      }),
    ).toThrow(BootstrapAdminError);

    try {
      normalizeBootstrapAdminInput({
        organizationName: 'Yunusco',
        adminEmail: 'admin@example.com',
        adminPassword: supplied,
      });
    } catch (error) {
      expect(String(error)).not.toContain(supplied);
    }
  });

  it('rejects non-PostgreSQL database URLs', () => {
    expect(() =>
      readBootstrapAdminEnvironment({
        DATABASE_URL: 'https://example.com/database',
        BOOTSTRAP_ORGANIZATION_NAME: 'Yunusco',
        BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
        BOOTSTRAP_ADMIN_PASSWORD: 'A-Strong-Test-Password-1',
      }),
    ).toThrow(/postgresql:\/\/ or postgres:\/\//);
  });

  it('rejects organization names that cannot produce a safe slug', () => {
    expect(() => deriveOrganizationSlug('---')).toThrow(BootstrapAdminError);
  });
});
