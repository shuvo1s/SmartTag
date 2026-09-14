'use client';

import { parseDesignDocument } from '@smarttag/document-schema';
import type { FontFaceDto, TemplateDto, TemplateVersionDetailDto } from '@smarttag/shared-types';
import { Alert, Spinner, buttonStyles } from '@smarttag/ui';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { describeError } from '@/lib/api-client';
import { useSession } from '../auth/session';
import { DocumentIssues } from '../document-preview/document-preview';
import { useFontRegistryQuery } from '../rendering/rendering-services';
import { useTemplate, useTemplateVersion } from '../templates/api';
import { useInvalidateVersion } from './editor-api';
import { EditorSession, EditorSessionProvider } from './editor-session';
import { EditorShell } from './editor-shell';

const MIN_EDITOR_WIDTH = 1024;

function useWideEnough(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${MIN_EDITOR_WIDTH}px)`);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

/** Loads template, version and font registry, then opens an editing session. */
export default function EditorRoot({
  templateId,
  versionId,
}: {
  templateId: string;
  versionId: string;
}) {
  const template = useTemplate(templateId);
  const version = useTemplateVersion(versionId);
  const fonts = useFontRegistryQuery();
  const wide = useWideEnough();
  const backHref = `/templates/${templateId}/versions/${versionId}`;

  const error = template.error ?? version.error ?? fonts.error;
  if (error) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <Alert tone="danger" title="The editor could not be opened">
          {describeError(error)}
        </Alert>
      </div>
    );
  }
  if (wide === false) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-8 text-center" data-testid="editor-small-screen">
        <h1 className="text-lg font-semibold text-slate-900">The designer needs a larger screen</h1>
        <p className="text-sm text-slate-600">
          Professional artwork editing requires at least {MIN_EDITOR_WIDTH} px of width. You can
          still review this version and its preview.
        </p>
        <Link href={backHref} className={buttonStyles({ variant: 'secondary' })}>
          Open version preview
        </Link>
      </div>
    );
  }
  if (!template.data || !version.data || !fonts.data || wide === null) {
    return (
      <div className="flex h-screen items-center justify-center text-brand-700">
        <Spinner label="Opening the designer" />
      </div>
    );
  }
  if (version.data.templateId !== templateId) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <Alert tone="danger">This version does not belong to the template.</Alert>
      </div>
    );
  }
  return (
    <LoadedEditor
      key={version.data.id}
      template={template.data}
      version={version.data}
      fonts={fonts.data}
    />
  );
}

function LoadedEditor({
  template,
  version,
  fonts,
}: {
  template: TemplateDto;
  version: TemplateVersionDetailDto;
  fonts: FontFaceDto[];
}) {
  const auth = useSession();
  const onSaved = useInvalidateVersion();
  const parsed = useMemo(() => parseDesignDocument(version.document), [version.document]);
  const canEdit = auth.permissions.includes('template-version:edit-draft');
  const readOnlyReason =
    version.status !== 'DRAFT'
      ? `Version ${version.versionNumber} is ${version.status.toLowerCase().replace('_', ' ')} and cannot be edited. Create a new version to make changes.`
      : !canEdit
        ? 'You have view-only access to this draft.'
        : null;

  // One session per mounted editor (the parent keys this component by version id). Later cache
  // updates after saves must not recreate it; start/stop happen in the shell's effect.
  const [session] = useState<EditorSession | null>(() =>
    parsed.valid
      ? new EditorSession({
          template,
          version,
          document: parsed.document,
          originalSchemaVersion: parsed.originalSchemaVersion ?? 2,
          readOnly: readOnlyReason !== null,
          readOnlyReason,
          fonts,
          onSaved,
        })
      : null,
  );

  if (!parsed.valid) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <DocumentIssues
          title="This version cannot be opened because its document is invalid"
          issues={parsed.errors}
        />
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center text-brand-700">
        <Spinner label="Opening the designer" />
      </div>
    );
  }
  return (
    <EditorSessionProvider session={session}>
      <EditorShell templateId={template.id} />
    </EditorSessionProvider>
  );
}
