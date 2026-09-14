'use client';

import dynamic from 'next/dynamic';
import { Spinner } from '@smarttag/ui';

/** Fabric.js and the canvas only run in the browser. */
const EditorRoot = dynamic(() => import('./editor-root'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-brand-700">
      <Spinner label="Loading the designer" />
    </div>
  ),
});

export function EditorEntry({ templateId, versionId }: { templateId: string; versionId: string }) {
  return <EditorRoot templateId={templateId} versionId={versionId} />;
}
