import { createSampleHangTagDocument } from '@smarttag/document-utils/fixtures';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareDocumentForStorage } from '../../src/modules/templates/document-storage';
import { createTestApp, resetDatabase, seedTenants, type TestApp } from './helpers';

/**
 * Invariants enforced by PostgreSQL itself (CHECK constraints, composite foreign keys, triggers),
 * independent of application code.
 */
describe('database invariants', () => {
  let t: TestApp;
  let tenants: Awaited<ReturnType<typeof seedTenants>>;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    tenants = await seedTenants(t.prisma);
  });

  async function createTemplateWithVersion(status: 'DRAFT' | 'APPROVED' = 'DRAFT') {
    const template = await t.prisma.template.create({
      data: {
        organizationId: tenants.orgA.id,
        code: `HT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        name: 'Invariant test',
        documentType: 'HANG_TAG',
        latestVersionNumber: 1,
        createdById: tenants.users.designerA.id,
        updatedById: tenants.users.designerA.id,
      },
    });
    const prepared = await prepareDocumentForStorage(
      createSampleHangTagDocument({ documentId: template.id }),
    );
    const version = await t.prisma.templateVersion.create({
      data: {
        organizationId: tenants.orgA.id,
        templateId: template.id,
        versionNumber: 1,
        ...prepared,
        createdById: tenants.users.designerA.id,
      },
    });
    if (status === 'APPROVED') {
      await t.prisma.templateVersion.update({
        where: { id: version.id },
        data: {
          status: 'IN_REVIEW',
          submittedAt: new Date(),
          submittedById: tenants.users.designerA.id,
        },
      });
      await t.prisma.templateVersion.update({
        where: { id: version.id },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedById: tenants.users.approverA.id,
        },
      });
    }
    return { template, version };
  }

  it('blocks content changes to non-draft versions', async () => {
    const { version } = await createTemplateWithVersion('APPROVED');
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE template_versions SET document_json = jsonb_set(document_json, '{metadata,name}', '"tampered"') WHERE id = $1::uuid`,
        version.id,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE template_versions SET document_hash = repeat('0', 64) WHERE id = $1::uuid`,
        version.id,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      t.prisma.$executeRawUnsafe(`DELETE FROM template_versions WHERE id = $1::uuid`, version.id),
    ).rejects.toThrow(/cannot be deleted/);
  });

  it('enforces the status state machine and preserves approval records', async () => {
    const { version } = await createTemplateWithVersion('APPROVED');
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE template_versions SET status = 'DRAFT' WHERE id = $1::uuid`,
        version.id,
      ),
    ).rejects.toThrow(/invalid template version status transition/);
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE template_versions SET approved_by_id = $1::uuid WHERE id = $2::uuid`,
        tenants.users.adminA.id,
        version.id,
      ),
    ).rejects.toThrow(/approval record/);

    const { version: draft } = await createTemplateWithVersion('DRAFT');
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE template_versions SET status = 'APPROVED', approved_at = now(), approved_by_id = $1::uuid WHERE id = $2::uuid`,
        tenants.users.approverA.id,
        draft.id,
      ),
    ).rejects.toThrow(/invalid template version status transition/);
  });

  it('allows draft content changes and never allows version identity changes', async () => {
    const { version } = await createTemplateWithVersion('DRAFT');
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE template_versions SET change_summary = 'ok' WHERE id = $1::uuid`,
        version.id,
      ),
    ).resolves.toBe(1);
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE template_versions SET version_number = 5 WHERE id = $1::uuid`,
        version.id,
      ),
    ).rejects.toThrow(/identity/);
  });

  it('enforces CHECK constraints', async () => {
    const { template, version } = await createTemplateWithVersion('DRAFT');
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE template_versions SET document_hash = 'NOT-HEX' WHERE id = $1::uuid`,
        version.id,
      ),
    ).rejects.toThrow(/document_hash_chk/);
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE template_versions SET schema_version = 2 WHERE id = $1::uuid`,
        version.id,
      ),
    ).rejects.toThrow(/document_json_chk/);
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE templates SET code = 'lower case' WHERE id = $1::uuid`,
        template.id,
      ),
    ).rejects.toThrow(/code_format_chk/);
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE users SET email = 'UPPER@TEST.LOCAL' WHERE id = $1::uuid`,
        tenants.users.viewerA.id,
      ),
    ).rejects.toThrow(/email_normalized_chk/);
    await expect(
      t.prisma.$executeRawUnsafe(
        `INSERT INTO template_versions (id, organization_id, template_id, version_number, schema_version, document_json, document_hash, summary_json, created_by_id, updated_at) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 1, 1, '{"schemaVersion":1}', repeat('a', 64), '{}', $3::uuid, now())`,
        tenants.orgA.id,
        template.id,
        tenants.users.designerA.id,
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it('keeps the current version pointer within the same template', async () => {
    const first = await createTemplateWithVersion('DRAFT');
    const second = await createTemplateWithVersion('DRAFT');
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE templates SET current_version_id = $1::uuid WHERE id = $2::uuid`,
        second.version.id,
        first.template.id,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it('makes the audit trail append-only', async () => {
    await t.prisma.auditEvent.create({
      data: { action: 'USER_LOGIN', resourceType: 'SESSION', organizationId: tenants.orgA.id },
    });
    await expect(
      t.prisma.$executeRawUnsafe(`UPDATE audit_events SET action = 'X'`),
    ).rejects.toThrow(/append-only/);
    await expect(t.prisma.$executeRawUnsafe(`DELETE FROM audit_events`)).rejects.toThrow(
      /append-only/,
    );
  });
});
