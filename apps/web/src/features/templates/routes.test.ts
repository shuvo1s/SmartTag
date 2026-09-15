import { permissionsForRoles } from '@smarttag/shared-types';
import { describe, expect, it } from 'vitest';
import { designerPath, pathAfterTemplateCreated } from './routes';
import { templateDto } from './test-data';

describe('pathAfterTemplateCreated', () => {
  const created = templateDto();
  const draftId = created.currentVersion!.id;

  it('opens the new draft in the designer for roles that may edit drafts', () => {
    for (const role of ['DESIGNER', 'TEMPLATE_ADMIN', 'ORG_ADMIN'] as const) {
      expect(pathAfterTemplateCreated(created, permissionsForRoles([role]))).toBe(
        designerPath(created.id, draftId),
      );
    }
    expect(designerPath(created.id, draftId)).toBe(
      `/templates/${created.id}/versions/${draftId}/edit`,
    );
  });

  it('falls back to the template page when the user cannot edit the draft', () => {
    expect(pathAfterTemplateCreated(created, permissionsForRoles(['VIEWER']))).toBe(
      `/templates/${created.id}`,
    );
    expect(
      pathAfterTemplateCreated(
        { ...created, currentVersion: { ...created.currentVersion!, status: 'IN_REVIEW' } },
        permissionsForRoles(['DESIGNER']),
      ),
    ).toBe(`/templates/${created.id}`);
    expect(
      pathAfterTemplateCreated(
        { ...created, currentVersion: null },
        permissionsForRoles(['DESIGNER']),
      ),
    ).toBe(`/templates/${created.id}`);
  });
});
