'use client';

import { CURRENT_SCHEMA_VERSION, parseDesignDocument } from '@smarttag/document-schema';
import { collectAssetReferencesByKind } from '@smarttag/document-utils';
import type { TemplateVersionDetailDto } from '@smarttag/shared-types';
import { cn } from '@smarttag/ui';
import { Eye, Info, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { apiRequest, describeError } from '@/lib/api-client';
import { templatePath } from '../templates/routes';
import { AssetPickerDialog } from './asset-picker';
import { CanvasView } from './canvas-view';
import { FieldDialog } from './field-dialog';
import { useAssetsById } from './editor-api';
import {
  ConflictDialog,
  LeftPanel,
  LeftToolbar,
  NoticeBar,
  ShortcutsDialog,
  StatusBar,
  TopBar,
} from './editor-chrome';
import {
  useEditorSession,
  useEditorState,
  useEditorUi,
  usePreviewState,
  useResourceVersion,
} from './editor-session';
import { handleEditorKeyDown, handleEditorKeyUp } from './editor-shortcuts';
import { CompareOverlay, PreviewView } from './preview-views';
import { useImageAvailability } from './test-data-panel';
import { PropertiesPanel } from './properties-panel';

/** Re-render counter for font/image loading and known-asset metadata. */
function useRenderVersion(): number {
  const session = useEditorSession();
  const document = useEditorState((state) => state.document);
  const referencedImages = collectAssetReferencesByKind(document).imageAssetIds;
  const missing = referencedImages.filter((id) => !session.assets.has(id));
  const assets = useAssetsById(missing);

  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);

  useEffect(() => {
    if (assets.data) session.registerAssets(assets.data);
  }, [assets.data, session]);

  useEffect(() => {
    void session.resources.fonts.loadAll(collectAssetReferencesByKind(document).fontAssetIds);
  }, [document, session]);
  return useResourceVersion();
}

export function EditorShell({ templateId }: { templateId: string }) {
  const session = useEditorSession();
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const mode = useEditorUi((ui) => ui.mode);
  const readOnly = useEditorState((state) => state.readOnly);
  const preview = usePreviewState();
  const previewMode = preview.mode;
  const renderVersion = useRenderVersion();
  const fields = useEditorState((state) => state.document.dataSchema.fields);
  // Images named by the test record are loaded (and foreign ids detected) whichever panel is open.
  useImageAvailability(fields, preview.record);

  // Protect against leaving with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (session.save.isDirty() || session.save.getState().status === 'SAVING') {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [session]);

  useEffect(() => {
    root.current?.focus();
  }, []);

  const navigateBack = () => {
    if (
      session.save.isDirty() &&
      !window.confirm('You have unsaved changes. Leave the editor and discard them?')
    ) {
      return;
    }
    // The template page holds the version list with Edit in designer and Submit for review.
    router.push(templatePath(templateId));
  };

  const reloadLatest = async () => {
    try {
      const version = await apiRequest<TemplateVersionDetailDto>(
        `/template-versions/${session.versionId}`,
      );
      const parsed = parseDesignDocument(version.document);
      if (!parsed.valid) {
        session.notify('danger', 'The latest version could not be loaded.');
        return;
      }
      session.store.replaceDocument(parsed.document, {
        readOnly: version.status !== 'DRAFT' || session.store.getState().readOnly,
      });
      session.save.reset(parsed.document, version.revision, version.documentHash);
      session.setVersionStatus(version.status);
      session.notify('info', 'Reloaded the latest version.');
    } catch (error) {
      session.notify('danger', describeError(error));
    }
  };

  return (
    <div
      ref={root}
      tabIndex={-1}
      data-testid="editor-root"
      className="relative flex h-screen flex-col overflow-hidden bg-slate-100 outline-none"
      onKeyDown={(event) => handleEditorKeyDown(session, event)}
      onKeyUp={(event) => handleEditorKeyUp(session, event)}
      onPointerDownCapture={(event) => {
        if (!(
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement
        )) {
          root.current?.focus({ preventScroll: true });
        }
      }}
    >
      <TopBar onNavigateBack={navigateBack} />
      {readOnly ? (
        <div
          data-testid="read-only-banner"
          className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900"
        >
          <Lock className="size-3.5" /> {session.readOnlyReason ?? 'This version cannot be edited.'}
        </div>
      ) : session.originalSchemaVersion < CURRENT_SCHEMA_VERSION ? (
        <div
          data-testid="schema-upgrade-banner"
          className="flex items-center gap-2 border-b border-sky-200 bg-sky-50 px-4 py-1.5 text-xs text-sky-900"
        >
          <Info className="size-3.5" /> This draft was stored with schema version{' '}
          {session.originalSchemaVersion}. Saving upgrades it to schema version{' '}
          {CURRENT_SCHEMA_VERSION}
          {session.originalSchemaVersion < 2 ? '; assign controlled fonts to its text' : ''}.
        </div>
      ) : null}
      {previewMode === 'DATA' ? (
        <div
          data-testid="data-preview-banner"
          className="flex items-center gap-2 border-b border-sky-300 bg-sky-100 px-4 py-1 text-xs text-sky-950"
        >
          <Eye className="size-3.5" />
          <span className="font-semibold">Data preview</span>
          <span>
            Artwork shows the test record. The template is not changed and test data is not saved.
          </span>
          <button
            type="button"
            className="ml-auto rounded px-2 py-0.5 text-[11px] font-medium hover:bg-sky-200"
            onClick={() => session.setUi({ leftPanel: 'data', dataTab: 'test' })}
          >
            Edit test data
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <LeftToolbar />
        <LeftPanel />
        <main className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col')} aria-label="Artboard">
          <CanvasView hidden={mode === 'preview'} />
          {mode === 'preview' ? <PreviewView renderVersion={renderVersion} /> : null}
          {mode === 'compare' ? <CompareOverlay renderVersion={renderVersion} /> : null}
          <NoticeBar />
        </main>
        <PropertiesPanel renderVersion={renderVersion} />
      </div>
      <StatusBar renderVersion={renderVersion} />
      <AssetPickerDialog />
      <ShortcutsDialog />
      <ConflictDialog onReload={() => void reloadLatest()} />
      <FieldDialog />
    </div>
  );
}
