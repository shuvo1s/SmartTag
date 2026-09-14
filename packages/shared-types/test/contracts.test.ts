import { describe, expect, it } from 'vitest';
import {
  CreateTemplateRequestSchema,
  LoginRequestSchema,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  TEMPLATE_VERSION_STATUSES,
  UpdateTemplateRequestSchema,
  availableTransitions,
  findTransition,
  isApiErrorBody,
  isVersionContentEditable,
  permissionsForRoles,
  type CreateTemplateRequest,
} from '../src';

const validTemplate: CreateTemplateRequest = {
  name: 'Basic hang tag',
  code: 'ht-50x90-basic',
  documentType: 'HANG_TAG',
  dimensions: { unit: 'mm', width: 50, height: 90, bleed: 3, safeMargin: 3 },
  pageLayout: 'FRONT_AND_BACK',
};

function fieldErrors(input: unknown): Record<string, string> {
  const result = CreateTemplateRequestSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
  );
}

describe('RBAC policy', () => {
  it('only grants known permissions', () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it('unions permissions across roles without duplicates', () => {
    const permissions = permissionsForRoles(['DESIGNER', 'QA', 'DESIGNER']);
    expect(new Set(permissions).size).toBe(permissions.length);
    expect(permissions).toContain('template:create');
    expect(permissions).toContain('template-version:review');
    expect(permissions).not.toContain('template-version:approve');
  });

  it('keeps viewers read-only and separates design from approval', () => {
    expect(
      permissionsForRoles(['VIEWER']).every((permission) => permission.endsWith(':read')),
    ).toBe(true);
    expect(permissionsForRoles(['DESIGNER'])).not.toContain('template-version:approve');
    expect(permissionsForRoles(['APPROVER'])).toContain('template-version:approve');
    expect(permissionsForRoles(['APPROVER'])).not.toContain('template-version:edit-draft');
    expect(permissionsForRoles(['ORG_ADMIN'])).toEqual([...PERMISSIONS]);
  });
});

describe('template version lifecycle', () => {
  it('allows the forward workflow', () => {
    expect(findTransition('DRAFT', 'IN_REVIEW')?.permission).toBe('template-version:submit');
    expect(findTransition('IN_REVIEW', 'APPROVED')?.permission).toBe('template-version:approve');
    expect(findTransition('APPROVED', 'RETIRED')?.permission).toBe('template-version:retire');
  });

  it('never allows approved or retired versions to become editable again', () => {
    for (const to of TEMPLATE_VERSION_STATUSES) {
      if (to !== 'RETIRED') expect(findTransition('APPROVED', to)).toBeUndefined();
      expect(findTransition('RETIRED', to)).toBeUndefined();
    }
    expect(findTransition('DRAFT', 'APPROVED')).toBeUndefined();
  });

  it('filters available transitions by permission', () => {
    expect(availableTransitions('IN_REVIEW', permissionsForRoles(['QA'])).map((t) => t.to)).toEqual(
      ['DRAFT'],
    );
    expect(
      availableTransitions('IN_REVIEW', permissionsForRoles(['APPROVER'])).map((t) => t.to),
    ).toEqual(['DRAFT', 'APPROVED']);
    expect(availableTransitions('DRAFT', permissionsForRoles(['VIEWER']))).toEqual([]);
  });

  it('only drafts are content-editable', () => {
    expect(TEMPLATE_VERSION_STATUSES.filter(isVersionContentEditable)).toEqual(['DRAFT']);
  });
});

describe('CreateTemplateRequestSchema', () => {
  it('accepts a valid request, normalises the code and applies defaults', () => {
    const parsed = CreateTemplateRequestSchema.parse(validTemplate);
    expect(parsed.code).toBe('HT-50X90-BASIC');
    expect(parsed).toMatchObject({ description: '', customerId: null, brandId: null });
  });

  it('reports required fields with readable messages', () => {
    const errors = fieldErrors({
      ...validTemplate,
      name: ' ',
      dimensions: { unit: 'mm', width: Number.NaN, height: undefined, bleed: 3, safeMargin: 3 },
    });
    expect(errors).toMatchObject({
      name: 'Name is required',
      'dimensions.width': 'Width is required',
      'dimensions.height': 'Height is required',
    });
  });

  it.each([
    [{ bleed: -1 }, 'dimensions.bleed', 'Bleed cannot be negative'],
    [{ bleed: 30 }, 'dimensions.bleed', 'Bleed cannot exceed 25.4 mm (1 in)'],
    [{ width: 4 }, 'dimensions.width', 'Width must be at least 5 mm'],
    [{ width: 6000 }, 'dimensions.width', 'Width cannot exceed 200 in'],
    [{ safeMargin: 25 }, 'dimensions.safeMargin', 'Safe margin leaves no usable area'],
  ])('rejects invalid dimensions %p', (patch, path, message) => {
    expect(
      fieldErrors({ ...validTemplate, dimensions: { ...validTemplate.dimensions, ...patch } })[
        path
      ],
    ).toBe(message);
  });

  it('checks physical limits in the chosen unit', () => {
    expect(
      fieldErrors({
        ...validTemplate,
        dimensions: { unit: 'in', width: 0.1, height: 3, bleed: 0, safeMargin: 0 },
      }),
    ).toHaveProperty(['dimensions.width']);
    expect(
      fieldErrors({
        ...validTemplate,
        dimensions: { unit: 'in', width: 2, height: 3.5, bleed: 0.125, safeMargin: 0.125 },
      }),
    ).toEqual({});
  });

  it('requires a customer when a brand is selected', () => {
    expect(
      fieldErrors({ ...validTemplate, brandId: '0192f0a0-5b1e-7c3d-8e4f-1a2b3c4d5e6f' }),
    ).toEqual({
      customerId: 'Select the customer that owns the brand',
    });
  });

  it('rejects invalid codes and unknown document types', () => {
    expect(fieldErrors({ ...validTemplate, code: 'bad code!' })).toHaveProperty('code');
    expect(fieldErrors({ ...validTemplate, documentType: 'MUG' })).toHaveProperty('documentType');
  });
});

describe('other contracts', () => {
  it('normalises login emails', () => {
    expect(
      LoginRequestSchema.parse({ email: '  Admin@SmartTag.Local ', password: 'x' }).email,
    ).toBe('admin@smarttag.local');
  });

  it('rejects empty or unknown template updates', () => {
    expect(UpdateTemplateRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateTemplateRequestSchema.safeParse({ code: 'NEW' }).success).toBe(false);
    expect(UpdateTemplateRequestSchema.safeParse({ status: 'ARCHIVED' }).success).toBe(true);
  });

  it('recognises API error envelopes', () => {
    expect(
      isApiErrorBody({
        error: { code: 'NOT_FOUND', message: 'x', details: null, requestId: null },
      }),
    ).toBe(true);
    expect(isApiErrorBody({ message: 'x' })).toBe(false);
  });
});
