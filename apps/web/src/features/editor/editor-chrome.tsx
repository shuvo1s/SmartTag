'use client';

import { validateDesignDocument } from '@smarttag/document-schema';
import { fromPoints, roundTo } from '@smarttag/document-utils';
import { findPage, type ToolType } from '@smarttag/editor-core';
import { cn } from '@smarttag/ui';
import {
  AlertTriangle,
  ArrowLeft,
  Barcode,
  Check,
  Circle,
  Columns2,
  Eye,
  Images,
  Image as ImageIcon,
  Keyboard,
  Layers,
  Loader2,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  QrCode,
  Redo2,
  Save,
  Square,
  Stamp,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { VersionStatusBadge } from '../templates/status-badges';
import { AssetBrowser, insertImage } from './asset-picker';
import { useEditorSession, useEditorState, useEditorUi, useSaveState } from './editor-session';
import { SHORTCUTS, addTool } from './editor-shortcuts';
import { LayersPanel } from './layers-panel';

function ToolbarButton({
  label,
  onClick,
  disabled,
  active,
  children,
  testId,
  shortcut,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
  testId?: string;
  shortcut?: string;
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={title}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center rounded text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-35',
        active ? 'bg-brand-50 text-brand-800' : '',
      )}
    >
      {children}
    </button>
  );
}

const SAVE_LABELS = {
  SAVED: 'Saved',
  UNSAVED: 'Unsaved changes',
  SAVING: 'Saving…',
  FAILED: 'Save failed',
  CONFLICT: 'Changed elsewhere',
  INVALID: 'Fix errors to save',
  READ_ONLY: 'Read-only',
} as const;

export function TopBar({ onNavigateBack }: { onNavigateBack: () => void }) {
  const session = useEditorSession();
  const save = useSaveState();
  const document = useEditorState((state) => state.document);
  const pageId = useEditorState((state) => state.activePageId);
  const canUndo = useEditorState((state) => state.canUndo);
  const canRedo = useEditorState((state) => state.canRedo);
  const undoLabel = useEditorState((state) => state.undoLabel);
  const redoLabel = useEditorState((state) => state.redoLabel);
  const readOnly = useEditorState((state) => state.readOnly);
  const mode = useEditorUi((ui) => ui.mode);
  const zoom = useEditorUi((ui) => ui.viewport.zoom);

  const statusTone =
    save.status === 'SAVED'
      ? 'text-green-700'
      : save.status === 'SAVING' || save.status === 'UNSAVED' || save.status === 'READ_ONLY'
        ? 'text-slate-600'
        : 'text-red-700';

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2">
      <button
        type="button"
        onClick={onNavigateBack}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
        aria-label="Back to template"
      >
        <ArrowLeft className="size-4" />
      </button>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900" title={session.template.name}>
          {session.template.name}
        </p>
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
          {session.template.code}
          <VersionStatusBadge status={session.versionStatus} />
        </p>
      </div>
      <span
        role="status"
        aria-live="polite"
        data-testid="save-status"
        data-status={save.status}
        className={cn('ml-2 flex items-center gap-1 text-xs', statusTone)}
        title={save.errorMessage ?? undefined}
      >
        {save.status === 'SAVING' ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : save.status === 'SAVED' ? (
          <Check className="size-3.5" />
        ) : save.status === 'FAILED' || save.status === 'CONFLICT' || save.status === 'INVALID' ? (
          <AlertTriangle className="size-3.5" />
        ) : null}
        {SAVE_LABELS[save.status]}
      </span>

      <div className="mx-2 h-6 w-px bg-slate-200" />
      <ToolbarButton
        label={undoLabel ? `Undo ${undoLabel}` : 'Undo'}
        testId="undo"
        shortcut="Ctrl/⌘ Z"
        disabled={readOnly || !canUndo}
        onClick={() => session.store.undo()}
      >
        <Undo2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label={redoLabel ? `Redo ${redoLabel}` : 'Redo'}
        testId="redo"
        shortcut="Ctrl/⌘ Shift Z"
        disabled={readOnly || !canRedo}
        onClick={() => session.store.redo()}
      >
        <Redo2 className="size-4" />
      </ToolbarButton>

      <div className="mx-auto flex items-center gap-1" role="tablist" aria-label="Pages">
        {document.pages.map((page) => (
          <button
            key={page.id}
            type="button"
            role="tab"
            aria-selected={page.id === pageId}
            data-testid={`page-tab-${page.id}`}
            onClick={() => session.store.setActivePage(page.id)}
            className={cn(
              'rounded px-3 py-1 text-xs font-medium',
              page.id === pageId ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            {page.name}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-0.5">
        <ToolbarButton
          label="Zoom out"
          testId="zoom-out"
          shortcut="Ctrl/⌘ −"
          disabled={mode === 'preview'}
          onClick={() => session.canvas?.zoomStep(-1)}
        >
          <Minus className="size-4" />
        </ToolbarButton>
        <button
          type="button"
          data-testid="zoom-100"
          title="Zoom to 100 % (Ctrl/⌘ 1)"
          className="w-14 rounded py-1 text-center text-xs tabular-nums text-slate-700 hover:bg-slate-100"
          onClick={() => session.canvas?.zoomTo(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolbarButton
          label="Zoom in"
          testId="zoom-in"
          shortcut="Ctrl/⌘ +"
          disabled={mode === 'preview'}
          onClick={() => session.canvas?.zoomStep(1)}
        >
          <Plus className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Fit page"
          testId="zoom-fit"
          shortcut="Ctrl/⌘ 0"
          onClick={() => session.canvas?.fit('FIT_PAGE')}
        >
          <Maximize className="size-4" />
        </ToolbarButton>
        <button
          type="button"
          className="rounded px-1.5 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          onClick={() => session.canvas?.fit('FIT_WIDTH')}
        >
          Fit width
        </button>
      </div>

      <div className="mx-2 h-6 w-px bg-slate-200" />
      <ToolbarButton
        label="Preview from canonical renderer"
        testId="toggle-preview"
        active={mode === 'preview'}
        onClick={() => session.setUi({ mode: mode === 'preview' ? 'edit' : 'preview' })}
      >
        <Eye className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Compare canvas with canonical renderer"
        testId="toggle-compare"
        active={mode === 'compare'}
        onClick={() => session.setUi({ mode: mode === 'compare' ? 'edit' : 'compare' })}
      >
        <Columns2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Keyboard shortcuts"
        testId="shortcuts-button"
        onClick={() => session.setUi({ shortcutsOpen: true })}
      >
        <Keyboard className="size-4" />
      </ToolbarButton>
      <button
        type="button"
        data-testid="save-button"
        disabled={readOnly || save.status === 'SAVING' || save.status === 'CONFLICT'}
        onClick={() => void session.save.saveNow()}
        className="ml-1 flex h-8 items-center gap-1.5 rounded bg-brand-700 px-3 text-xs font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        <Save className="size-3.5" /> Save
      </button>
    </header>
  );
}

const TOOLS: readonly {
  tool: ToolType | 'select';
  label: string;
  Icon: typeof Type;
  shortcut?: string;
}[] = [
  { tool: 'select', label: 'Select', Icon: MousePointer2, shortcut: 'Esc' },
  { tool: 'text', label: 'Text', Icon: Type, shortcut: 'T' },
  { tool: 'image', label: 'Image', Icon: ImageIcon },
  { tool: 'logo', label: 'Logo', Icon: Stamp },
  { tool: 'rectangle', label: 'Rectangle', Icon: Square, shortcut: 'R' },
  { tool: 'ellipse', label: 'Ellipse', Icon: Circle, shortcut: 'E' },
  { tool: 'line', label: 'Line', Icon: Minus, shortcut: 'L' },
  { tool: 'barcode', label: 'Barcode', Icon: Barcode, shortcut: 'B' },
  { tool: 'qrCode', label: 'QR code', Icon: QrCode, shortcut: 'Q' },
];

export function LeftToolbar() {
  const session = useEditorSession();
  const readOnly = useEditorState((state) => state.readOnly);
  const panel = useEditorUi((ui) => ui.leftPanel);
  return (
    <nav
      aria-label="Tools"
      className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-slate-200 bg-white py-2"
    >
      {TOOLS.map(({ tool, label, Icon, shortcut }) => (
        <ToolbarButton
          key={tool}
          label={tool === 'select' ? label : `Add ${label.toLowerCase()}`}
          shortcut={shortcut}
          testId={`tool-${tool}`}
          active={tool === 'select'}
          disabled={tool !== 'select' && readOnly}
          onClick={() =>
            tool === 'select' ? session.store.setSelection([]) : addTool(session, tool)
          }
        >
          <Icon className="size-4" />
        </ToolbarButton>
      ))}
      <div className="my-1 h-px w-6 bg-slate-200" />
      <ToolbarButton
        label="Layers"
        testId="panel-layers"
        active={panel === 'layers'}
        onClick={() => session.setUi({ leftPanel: 'layers' })}
      >
        <Layers className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Assets"
        testId="panel-assets"
        active={panel === 'assets'}
        onClick={() => session.setUi({ leftPanel: 'assets' })}
      >
        <Images className="size-4" />
      </ToolbarButton>
    </nav>
  );
}

export function LeftPanel() {
  const session = useEditorSession();
  const panel = useEditorUi((ui) => ui.leftPanel);
  const readOnly = useEditorState((state) => state.readOnly);
  return (
    <aside
      aria-label={panel === 'layers' ? 'Layers' : 'Assets'}
      className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white"
    >
      <div className="flex border-b border-slate-200 text-xs">
        {(['layers', 'assets'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => session.setUi({ leftPanel: value })}
            className={cn(
              'flex-1 py-2 font-medium capitalize',
              panel === value
                ? 'border-b-2 border-brand-700 text-slate-900'
                : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {value}
          </button>
        ))}
      </div>
      {panel === 'layers' ? (
        <LayersPanel />
      ) : (
        <AssetBrowser
          compact
          onChoose={(asset) =>
            readOnly
              ? undefined
              : insertImage(session, asset, asset.assetType === 'LOGO' ? 'logo' : 'image')
          }
        />
      )}
    </aside>
  );
}

export function StatusBar({ renderVersion }: { renderVersion: number }) {
  const session = useEditorSession();
  const document = useEditorState((state) => state.document);
  const pageId = useEditorState((state) => state.activePageId);
  const selection = useEditorState((state) => state.selection);
  const readOnly = useEditorState((state) => state.readOnly);
  const pointer = useEditorUi((ui) => ui.pointer);
  const zoom = useEditorUi((ui) => ui.viewport.zoom);
  const save = useSaveState();
  const unit = document.dimensions.displayUnit;
  const page = findPage(document, pageId);
  const validation = useMemo(() => validateDesignDocument(document), [document]);
  const renderIssues = useMemo(() => {
    void renderVersion;
    return page.objects.filter((object) =>
      (session.canvas?.getFabricObject(object.id)?.lastIssues ?? []).some(
        (issue) => issue !== 'FONT_LOADING',
      ),
    ).length;
  }, [page, renderVersion, session]);

  return (
    <footer
      className="flex h-7 shrink-0 items-center gap-4 border-t border-slate-200 bg-white px-3 text-[11px] text-slate-600"
      data-testid="status-bar"
    >
      <span className="tabular-nums" data-testid="pointer-position">
        {pointer
          ? `X ${roundTo(fromPoints(pointer.x, unit), 2).toFixed(2)} · Y ${roundTo(fromPoints(pointer.y, unit), 2).toFixed(2)} ${unit}`
          : `— ${unit}`}
      </span>
      <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
      <span>
        {page.objects.length} objects · {selection.length} selected
      </span>
      {validation.errors.length > 0 ? (
        <span className="text-red-700" data-testid="validation-errors">
          {validation.errors.length} error{validation.errors.length === 1 ? '' : 's'}:{' '}
          {validation.errors[0]?.message}
        </span>
      ) : null}
      {validation.warnings.length + renderIssues > 0 ? (
        <span
          className="text-amber-700"
          data-testid="issue-count"
          title={validation.warnings.map((warning) => warning.message).join('\n')}
        >
          {validation.warnings.length} warning{validation.warnings.length === 1 ? '' : 's'} ·{' '}
          {renderIssues} object{renderIssues === 1 ? '' : 's'} with display issues
        </span>
      ) : null}
      <span className="ml-auto">
        {readOnly
          ? 'View only'
          : save.lastSavedAt
            ? `Last saved ${new Date(save.lastSavedAt).toLocaleTimeString()}`
            : 'Autosave on'}{' '}
        · canonical unit pt
      </span>
    </footer>
  );
}

export function ShortcutsDialog() {
  const session = useEditorSession();
  const open = useEditorUi((ui) => ui.shortcutsOpen);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      aria-label="Keyboard shortcuts"
      onClose={() => session.setUi({ shortcutsOpen: false })}
      className="m-auto w-[520px] max-w-[95vw] rounded-lg border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
        <button
          type="button"
          aria-label="Close"
          className="rounded p-1 hover:bg-slate-100"
          onClick={() => session.setUi({ shortcutsOpen: false })}
        >
          <X className="size-4" />
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 px-4 py-3 text-xs">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.keys} className="contents">
            <dt>
              <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px]">
                {shortcut.keys}
              </kbd>
            </dt>
            <dd className="text-slate-700">{shortcut.action}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  );
}

export function NoticeBar() {
  const session = useEditorSession();
  const notice = useEditorUi((ui) => ui.notice);
  useEffect(() => {
    if (!notice || notice.tone === 'danger') return;
    const timer = setTimeout(() => session.setUi({ notice: null }), 4000);
    return () => clearTimeout(timer);
  }, [notice, session]);
  if (!notice) return null;
  return (
    <div
      role={notice.tone === 'danger' ? 'alert' : 'status'}
      data-testid="editor-notice"
      className={cn(
        'absolute bottom-3 left-1/2 z-30 flex max-w-lg -translate-x-1/2 items-center gap-2 rounded px-3 py-2 text-xs shadow-lg',
        notice.tone === 'danger'
          ? 'bg-red-700 text-white'
          : notice.tone === 'warning'
            ? 'bg-amber-500 text-slate-900'
            : 'bg-slate-900 text-white',
      )}
    >
      {notice.message}
      <button type="button" aria-label="Dismiss" onClick={() => session.setUi({ notice: null })}>
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function ConflictDialog({ onReload }: { onReload: () => void }) {
  const save = useSaveState();
  const dialog = useRef<HTMLDialogElement>(null);
  const open = save.status === 'CONFLICT';
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      data-testid="conflict-dialog"
      aria-label="Save conflict"
      className="m-auto w-[460px] max-w-[95vw] rounded-lg border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <AlertTriangle className="size-4 text-amber-600" /> This draft was changed in another
          session
        </h2>
        <p className="text-sm text-slate-600">
          Reload the latest version before saving your changes. Your unsaved edits in this window
          will be discarded; nothing was overwritten on the server.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
            onClick={() => dialog.current?.close()}
          >
            Keep viewing
          </button>
          <button
            type="button"
            data-testid="conflict-reload"
            className="rounded bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800"
            onClick={onReload}
          >
            Reload latest version
          </button>
        </div>
      </div>
    </dialog>
  );
}
