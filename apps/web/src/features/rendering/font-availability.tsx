'use client';

import type { FontLoadStatus, FontProvider } from '@smarttag/canvas-adapter';
import type { DesignDocument } from '@smarttag/document-schema';
import { Alert } from '@smarttag/ui';

export type SubstituteReason = Exclude<FontLoadStatus, 'LOADED' | 'LOADING'> | 'NOT_LOADED';

export interface SubstituteFont {
  readonly fontFamily: string;
  readonly fontWeight: number;
  readonly reason: SubstituteReason;
  readonly objectIds: readonly string[];
}

export interface FontAvailability {
  /** Text objects whose exact font file is still loading. */
  readonly loading: number;
  /** Fonts shown with a browser substitute, grouped by requested face and reason. */
  readonly substitutes: readonly SubstituteFont[];
}

const REASONS: Readonly<Record<SubstituteReason, string>> = {
  UNASSIGNED: 'no controlled font file is assigned',
  UNKNOWN: 'the font file is not in this organization’s font registry',
  FAILED: 'the font file could not be loaded',
  NOT_LOADED: 'controlled fonts are not loaded in this view',
};

/**
 * Which text in a document is NOT drawn with its exact controlled font file. `fonts === null` means
 * the view has no font registry at all (e.g. the developer playground), so every text is a
 * substitute. Never used to hide the problem — only to report it.
 */
export function summarizeFontAvailability(
  document: DesignDocument,
  fonts: FontProvider | null,
): FontAvailability {
  let loading = 0;
  const groups = new Map<string, { font: Omit<SubstituteFont, 'objectIds'>; ids: string[] }>();
  for (const page of document.pages) {
    for (const object of page.objects) {
      if (object.type !== 'text' || object.content.length === 0) continue;
      const status: FontLoadStatus | 'NOT_LOADED' = fonts
        ? fonts.status(object.fontAssetId)
        : 'NOT_LOADED';
      if (status === 'LOADED') continue;
      if (status === 'LOADING') {
        loading += 1;
        continue;
      }
      const key = `${status}|${object.fontFamily}|${object.fontWeight}`;
      const group = groups.get(key) ?? {
        font: { fontFamily: object.fontFamily, fontWeight: object.fontWeight, reason: status },
        ids: [],
      };
      group.ids.push(object.id);
      groups.set(key, group);
    }
  }
  return {
    loading,
    substitutes: [...groups.values()].map(({ font, ids }) => ({ ...font, objectIds: ids })),
  };
}

/** Visible warning listing text that is displayed with substitute fonts. Renders nothing when exact. */
export function FontAvailabilityNotice({
  availability,
  compact = false,
}: {
  availability: FontAvailability;
  compact?: boolean;
}) {
  const { loading, substitutes } = availability;
  if (substitutes.length === 0) {
    if (loading === 0) return null;
    return compact ? (
      <span className="text-slate-300" data-testid="font-availability-loading">
        Loading exact fonts…
      </span>
    ) : (
      <p className="text-xs text-slate-500" data-testid="font-availability-loading">
        Loading exact fonts…
      </p>
    );
  }
  const lines = substitutes.map((font) => {
    const count = font.objectIds.length;
    return `${font.fontFamily} ${font.fontWeight} — ${REASONS[font.reason]} (${count} text object${count === 1 ? '' : 's'})`;
  });
  const title = 'Some text is shown with a substitute font, not the production font';
  if (compact) {
    return (
      <span
        role="status"
        data-testid="font-availability-notice"
        title={lines.join('\n')}
        className="rounded bg-amber-400 px-1.5 py-0.5 font-semibold text-amber-950"
      >
        Substitute fonts: {substitutes.reduce((sum, font) => sum + font.objectIds.length, 0)} text
      </span>
    );
  }
  return (
    <div data-testid="font-availability-notice">
      <Alert tone="warning" title={title}>
        <ul className="list-disc pl-5 text-xs">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-1 text-xs">
          Line breaks and text fit in this view may differ from print until the exact font is
          available.
        </p>
      </Alert>
    </div>
  );
}
