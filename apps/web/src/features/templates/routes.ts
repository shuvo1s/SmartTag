import { canEditVersionContent, type Permission, type TemplateDto } from '@smarttag/shared-types';

/** Application paths for templates, versions and the designer (one place to build them). */

export function templatePath(templateId: string): string {
  return `/templates/${templateId}`;
}

export function versionPath(templateId: string, versionId: string): string {
  return `/templates/${templateId}/versions/${versionId}`;
}

export function designerPath(templateId: string, versionId: string): string {
  return `/templates/${templateId}/versions/${versionId}/edit`;
}

/**
 * Where to go after creating a template: straight into the designer for its new draft when the
 * user may edit drafts, otherwise to the template page.
 */
export function pathAfterTemplateCreated(
  template: Pick<TemplateDto, 'id' | 'currentVersion'>,
  permissions: readonly Permission[],
): string {
  const draft = template.currentVersion;
  return draft && canEditVersionContent(draft.status, permissions)
    ? designerPath(template.id, draft.id)
    : templatePath(template.id);
}
