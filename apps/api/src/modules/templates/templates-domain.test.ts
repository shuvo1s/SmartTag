import { parseDesignDocument } from '@smarttag/document-schema';
import {
  SAMPLE_BRAND_LOGO_ASSET_ID,
  createSampleHangTagDocument,
} from '@smarttag/document-utils/fixtures';
import { computeDocumentHash, hashCanonicalJson } from '@smarttag/document-utils';
import { permissionsForRoles, type Role } from '@smarttag/shared-types';
import { describe, expect, it, vi } from 'vitest';
import type { AppError } from '../../common/errors/app-error';
import type { DbClient } from '../../database/prisma.service';
import { prepareDocumentForStorage } from './document-storage';
import { TemplateDocumentService } from './template-document.service';
import { planStatusTransition } from './version-status-policy';

const TEMPLATE_ID = '0192f0a0-5b1e-7c3d-8e4f-1a2b3c4d5e6f';
const now = new Date('2026-09-14T10:00:00Z');
const actor = (...roles: Role[]) => ({
  userId: 'user-1',
  permissions: new Set(permissionsForRoles(roles)),
});

describe('planStatusTransition', () => {
  it('records who submitted, approved and retired', () => {
    expect(planStatusTransition('DRAFT', 'IN_REVIEW', actor('DESIGNER'), now).changes).toEqual({
      status: 'IN_REVIEW',
      submittedAt: now,
      submittedById: 'user-1',
    });
    expect(planStatusTransition('IN_REVIEW', 'APPROVED', actor('APPROVER'), now).changes).toEqual({
      status: 'APPROVED',
      approvedAt: now,
      approvedById: 'user-1',
    });
    expect(
      planStatusTransition('APPROVED', 'RETIRED', actor('TEMPLATE_ADMIN'), now).changes,
    ).toMatchObject({
      status: 'RETIRED',
      retiredById: 'user-1',
    });
  });

  it('clears the submission when a review returns the version to draft', () => {
    expect(planStatusTransition('IN_REVIEW', 'DRAFT', actor('QA'), now).changes).toEqual({
      status: 'DRAFT',
      submittedAt: null,
      submittedById: null,
    });
  });

  it('rejects transitions outside the lifecycle before checking permissions', () => {
    for (const [from, to] of [
      ['APPROVED', 'DRAFT'],
      ['APPROVED', 'IN_REVIEW'],
      ['RETIRED', 'DRAFT'],
      ['DRAFT', 'APPROVED'],
      ['DRAFT', 'DRAFT'],
    ] as const) {
      expect(() => planStatusTransition(from, to, actor('ORG_ADMIN'), now)).toThrow(
        expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }),
      );
    }
  });

  it('enforces the permission of the specific transition', () => {
    expect(() =>
      planStatusTransition('IN_REVIEW', 'APPROVED', actor('DESIGNER', 'QA'), now),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => planStatusTransition('DRAFT', 'IN_REVIEW', actor('VIEWER'), now)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });
});

describe('prepareDocumentForStorage', () => {
  it('stores a verifiable hash and a render-free summary', async () => {
    const document = createSampleHangTagDocument({ documentId: TEMPLATE_ID });
    const prepared = await prepareDocumentForStorage(document);
    expect(prepared.schemaVersion).toBe(1);
    expect(prepared.documentHash).toBe(await computeDocumentHash(document));
    // What is stored re-hashes to the recorded hash.
    expect(await hashCanonicalJson(prepared.documentJson)).toBe(prepared.documentHash);
    expect(parseDesignDocument(prepared.documentJson).valid).toBe(true);
    expect(prepared.summaryJson).toMatchObject({
      pageCount: 2,
      documentType: 'HANG_TAG',
      assetIds: [SAMPLE_BRAND_LOGO_ASSET_ID],
    });
  });
});

describe('TemplateDocumentService', () => {
  const service = new TemplateDocumentService();
  const template = { id: TEMPLATE_ID, organizationId: 'org-a', documentType: 'HANG_TAG' as const };
  const dbWithAssets = (ids: string[]) => {
    const findMany = vi.fn().mockResolvedValue(ids.map((id) => ({ id })));
    return { db: { asset: { findMany } } as unknown as DbClient, findMany };
  };

  async function rejection(promise: Promise<unknown>): Promise<AppError> {
    try {
      await promise;
    } catch (error) {
      return error as AppError;
    }
    throw new Error('expected rejection');
  }

  it('accepts a valid document whose assets exist in the organization', async () => {
    const { db, findMany } = dbWithAssets([SAMPLE_BRAND_LOGO_ASSET_ID]);
    const document = await service.validateForTemplate(
      db,
      template,
      createSampleHangTagDocument({ documentId: TEMPLATE_ID }),
    );
    expect(document.documentId).toBe(TEMPLATE_ID);
    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a', id: { in: [SAMPLE_BRAND_LOGO_ASSET_ID] } },
      select: { id: true },
    });
  });

  it('rejects structurally invalid documents with issue details', async () => {
    const { db } = dbWithAssets([]);
    const error = await rejection(
      service.validateForTemplate(db, template, { schemaVersion: 1, pages: [] }),
    );
    expect(error.code).toBe('INVALID_DOCUMENT');
    expect(error.details?.documentIssues?.length).toBeGreaterThan(0);
  });

  it('rejects unsupported schema versions', async () => {
    const { db } = dbWithAssets([]);
    const error = await rejection(
      service.validateForTemplate(db, template, {
        ...createSampleHangTagDocument(),
        schemaVersion: 7,
      }),
    );
    expect(error.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  it('rejects documents that belong to a different template or type', async () => {
    const { db } = dbWithAssets([SAMPLE_BRAND_LOGO_ASSET_ID]);
    const foreign = createSampleHangTagDocument({
      documentId: '0192f0a0-5b1e-7c3d-8e4f-000000000000',
    });
    foreign.metadata.documentType = 'CARE_LABEL';
    const error = await rejection(service.validateForTemplate(db, template, foreign));
    expect(error.details?.documentIssues?.map((issue) => issue.code)).toEqual([
      'DOCUMENT_ID_MISMATCH',
      'DOCUMENT_TYPE_MISMATCH',
    ]);
  });

  it('rejects references to assets outside the organization, pointing at the offending object', async () => {
    const { db } = dbWithAssets([]);
    const error = await rejection(
      service.validateForTemplate(
        db,
        template,
        createSampleHangTagDocument({ documentId: TEMPLATE_ID }),
      ),
    );
    expect(error.code).toBe('INVALID_DOCUMENT');
    expect(error.details?.documentIssues).toEqual([
      expect.objectContaining({
        code: 'UNKNOWN_ASSET_REFERENCE',
        path: ['pages', 0, 'objects', 1, 'assetId'],
      }),
    ]);
  });
});
