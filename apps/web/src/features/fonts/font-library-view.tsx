'use client';

import type { FontEmbeddingPermission, FontFaceDto } from '@smarttag/shared-types';
import { Alert, Badge, Button, cn } from '@smarttag/ui';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileType2, Search, Upload, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { assetContentUrl, fontKeys, useFontRegistryQuery } from '../rendering/rendering-services';
import {
  faceLabel,
  filterFontFaces,
  formatBytes,
  groupFontFaces,
} from './font-library-model';

const SUPPORTED_EXTENSIONS = /\.(ttf|otf|woff|woff2)$/i;
const UPLOAD_CONCURRENCY = 4;
const FAMILY_PAGE_SIZE = 50;

type UploadOutcome =
  | { readonly file: string; readonly status: 'UPLOADED' | 'DUPLICATE'; readonly message: string }
  | { readonly file: string; readonly status: 'REJECTED'; readonly message: string };

interface UploadProgress {
  readonly total: number;
  readonly completed: number;
  readonly uploaded: number;
  readonly duplicates: number;
  readonly rejected: number;
  readonly outcomes: readonly UploadOutcome[];
}

function emptyProgress(total: number): UploadProgress {
  return { total, completed: 0, uploaded: 0, duplicates: 0, rejected: 0, outcomes: [] };
}

async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function uploadFont(file: File): Promise<void> {
  const form = new FormData();
  form.set('assetType', 'FONT');
  form.set('file', file);
  const response = await fetch('/api/v1/assets', {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  throw new Error(body?.error?.message ?? `Upload failed with HTTP ${response.status}`);
}

function permissionLabel(permission: FontEmbeddingPermission): string {
  switch (permission) {
    case 'INSTALLABLE':
      return 'Installable';
    case 'EDITABLE':
      return 'Editable';
    case 'PREVIEW_AND_PRINT':
      return 'Preview & print';
    case 'RESTRICTED':
      return 'Restricted';
  }
}

function permissionClass(permission: FontEmbeddingPermission): string {
  return permission === 'RESTRICTED'
    ? 'border-red-200 bg-red-50 text-red-800'
    : permission === 'PREVIEW_AND_PRINT'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800';
}

function ExactFontPreview({ face, text }: { face: FontFaceDto; text: string }) {
  const [state, setState] = useState<'LOADING' | 'READY' | 'FAILED'>('LOADING');
  const family = `st-library-preview-${face.assetId}`;

  useEffect(() => {
    let active = true;
    const font = new FontFace(family, `url("${assetContentUrl(face.assetId)}")`, {
      weight: String(face.weight),
      style: face.style === 'ITALIC' ? 'italic' : 'normal',
    });
    setState('LOADING');
    void font
      .load()
      .then((loaded) => {
        if (!active) return;
        document.fonts.add(loaded);
        setState('READY');
      })
      .catch(() => active && setState('FAILED'));
    return () => {
      active = false;
      try {
        document.fonts.delete(font);
      } catch {
        // Older browsers may not support deleting a face; the unique family prevents collisions.
      }
    };
  }, [face.assetId, face.style, face.weight, family]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>{face.fullName}</span>
        <span>·</span>
        <span>{face.format}</span>
        <span>·</span>
        <span>{formatBytes(face.sizeBytes)}</span>
        <span>·</span>
        <span>{state === 'READY' ? 'Exact file loaded' : state === 'LOADING' ? 'Loading…' : 'Preview failed'}</span>
      </div>
      <p
        className="min-h-16 break-words text-3xl leading-relaxed text-slate-900"
        style={state === 'READY' ? { fontFamily: family, fontWeight: face.weight } : undefined}
        dir="auto"
      >
        {text || 'SmartTag 123 — Aa Bb বাংলা العربية'}
      </p>
    </div>
  );
}

export function FontLibraryView() {
  const registry = useFontRegistryQuery();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [permission, setPermission] = useState<FontEmbeddingPermission | 'ALL'>('ALL');
  const [sample, setSample] = useState('SmartTag 123 — Aa Bb বাংলা العربية');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '');
    folderInput.current?.setAttribute('directory', '');
  }, []);

  const faces = registry.data ?? [];
  const filtered = useMemo(
    () => filterFontFaces(faces, search, permission),
    [faces, permission, search],
  );
  const families = useMemo(() => groupFontFaces(filtered), [filtered]);
  const totalPages = Math.max(1, Math.ceil(families.length / FAMILY_PAGE_SIZE));
  const visibleFamilies = families.slice((page - 1) * FAMILY_PAGE_SIZE, page * FAMILY_PAGE_SIZE);
  const selected = faces.find((face) => face.assetId === selectedAssetId) ?? null;
  const restricted = faces.filter((face) => face.embeddingPermission === 'RESTRICTED').length;
  const installedFamilies = new Set(faces.map((face) => face.familyName)).size;

  useEffect(() => setPage(1), [search, permission]);

  const addOutcome = (outcome: UploadOutcome) => {
    setProgress((current) => {
      if (!current) return current;
      return {
        ...current,
        completed: current.completed + 1,
        uploaded: current.uploaded + (outcome.status === 'UPLOADED' ? 1 : 0),
        duplicates: current.duplicates + (outcome.status === 'DUPLICATE' ? 1 : 0),
        rejected: current.rejected + (outcome.status === 'REJECTED' ? 1 : 0),
        outcomes: [...current.outcomes, outcome],
      };
    });
  };

  const processFiles = async (incoming: FileList | readonly File[]) => {
    const files = Array.from(incoming).filter((file) => file.size > 0);
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setProgress(emptyProgress(files.length));
    const knownChecksums = new Set(faces.map((face) => face.checksumSha256.toLowerCase()));
    let cursor = 0;

    const worker = async () => {
      while (true) {
        const index = cursor++;
        const file = files[index];
        if (!file) return;
        if (!SUPPORTED_EXTENSIONS.test(file.name)) {
          addOutcome({
            file: file.name,
            status: 'REJECTED',
            message: 'Supported formats are TTF, OTF, WOFF and WOFF2.',
          });
          continue;
        }
        try {
          const checksum = await fileSha256(file);
          if (knownChecksums.has(checksum)) {
            addOutcome({ file: file.name, status: 'DUPLICATE', message: 'Exact font file already exists.' });
            continue;
          }
          await uploadFont(file);
          knownChecksums.add(checksum);
          addOutcome({ file: file.name, status: 'UPLOADED', message: 'Registered successfully.' });
        } catch (error) {
          addOutcome({
            file: file.name,
            status: 'REJECTED',
            message: error instanceof Error ? error.message : 'Upload failed.',
          });
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, () => worker()));
      await queryClient.invalidateQueries({ queryKey: fontKeys() });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
      if (folderInput.current) folderInput.current.value = '';
    }
  };

  if (registry.error) {
    return (
      <Alert tone="danger" title="Font library could not be loaded">
        {registry.error instanceof Error ? registry.error.message : 'Please try again.'}
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Font library</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Controlled production fonts for this organization. SmartTag stores the exact font file,
            reads its OpenType metadata on the server and only downloads a font when artwork uses it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
            className="hidden"
            onChange={(event) => event.target.files && void processFiles(event.target.files)}
          />
          <input
            ref={folderInput}
            type="file"
            multiple
            accept=".ttf,.otf,.woff,.woff2"
            className="hidden"
            onChange={(event) => event.target.files && void processFiles(event.target.files)}
          />
          <Button variant="secondary" disabled={uploading} onClick={() => folderInput.current?.click()}>
            Choose folder
          </Button>
          <Button disabled={uploading} onClick={() => fileInput.current?.click()}>
            <Upload className="mr-2 size-4" /> {uploading ? 'Uploading…' : 'Upload fonts'}
          </Button>
        </div>
      </div>

      <div
        className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-5 text-center"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void processFiles(event.dataTransfer.files);
        }}
      >
        <FileType2 className="mx-auto mb-2 size-7 text-slate-400" />
        <p className="text-sm font-medium text-slate-800">Drop TTF, OTF, WOFF or WOFF2 files here</p>
        <p className="mt-1 text-xs text-slate-500">
          For large libraries, select a folder. Uploads run four at a time so thousands of files do not
          overload the API. Variable fonts and TTC/OTC collections are rejected; upload static faces.
        </p>
      </div>

      {progress ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-900">
              Upload progress: {progress.completed} / {progress.total}
            </p>
            <div className="flex gap-2 text-xs">
              <span className="text-emerald-700">{progress.uploaded} uploaded</span>
              <span className="text-slate-600">{progress.duplicates} duplicates</span>
              <span className="text-red-700">{progress.rejected} rejected</span>
            </div>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100">
            <div
              className="h-full bg-brand-600 transition-all"
              style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }}
            />
          </div>
          {progress.outcomes.some((item) => item.status === 'REJECTED') ? (
            <div className="mt-3 max-h-40 overflow-auto rounded bg-red-50 p-2 text-xs text-red-800">
              {progress.outcomes
                .filter((item) => item.status === 'REJECTED')
                .slice(-50)
                .map((item) => (
                  <p key={`${item.file}-${item.message}`} className="flex gap-1 py-0.5">
                    <XCircle className="mt-0.5 size-3 shrink-0" />
                    <span className="font-medium">{item.file}:</span> {item.message}
                  </p>
                ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Families</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{installedFamilies}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Font faces</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{faces.length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Restricted embedding</p>
          <p className={cn('mt-1 text-2xl font-semibold', restricted ? 'text-red-700' : 'text-slate-950')}>
            {restricted}
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
        <label className="relative block">
          <span className="sr-only">Search fonts</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search family, style, PostScript name or file…"
            className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </label>
        <select
          value={permission}
          onChange={(event) => setPermission(event.target.value as FontEmbeddingPermission | 'ALL')}
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
          aria-label="Embedding permission filter"
        >
          <option value="ALL">All embedding rights</option>
          <option value="INSTALLABLE">Installable</option>
          <option value="EDITABLE">Editable</option>
          <option value="PREVIEW_AND_PRINT">Preview & print</option>
          <option value="RESTRICTED">Restricted</option>
        </select>
      </div>

      {selected ? (
        <div className="space-y-2">
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Preview text
            <input
              value={sample}
              onChange={(event) => setSample(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm normal-case tracking-normal text-slate-900"
            />
          </label>
          <ExactFontPreview face={selected} text={sample} />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-medium text-slate-900">
            {families.length} {families.length === 1 ? 'family' : 'families'} matching
          </p>
          <p className="text-xs text-slate-500">Page {page} of {totalPages}</p>
        </div>
        {registry.isPending ? (
          <p className="p-6 text-sm text-slate-500">Loading font registry…</p>
        ) : visibleFamilies.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No fonts match this filter.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleFamilies.map((group) => (
              <div key={group.familyName} className="grid gap-3 p-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                <div>
                  <p className="font-medium text-slate-950">{group.familyName}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {group.faces.length} {group.faces.length === 1 ? 'face' : 'faces'} · {group.formats.join(', ')}
                  </p>
                  {group.restrictedCount > 0 ? (
                    <p className="mt-1 text-xs font-medium text-red-700">
                      {group.restrictedCount} restricted face{group.restrictedCount === 1 ? '' : 's'}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.faces.map((face) => (
                    <button
                      key={face.assetId}
                      type="button"
                      onClick={() => setSelectedAssetId(face.assetId)}
                      className={cn(
                        'rounded-md border px-3 py-2 text-left text-xs transition',
                        selectedAssetId === face.assetId
                          ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                      )}
                    >
                      <span className="block font-medium text-slate-900">{faceLabel(face)}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <span>{face.format}</span>
                        <span>·</span>
                        <span>{face.glyphCount.toLocaleString()} glyphs</span>
                        <Badge className={permissionClass(face.embeddingPermission)}>
                          {permissionLabel(face.embeddingPermission)}
                        </Badge>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
        <p className="flex items-start gap-1.5">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
          Designer documents reference the exact font asset ID, not a font installed on the operator's PC.
          Font files are loaded on demand when artwork uses them.
        </p>
        <p className="mt-2">
          ZIP archives are intentionally not expanded by the web tier in this release. For a 1,000+ font
          library, use <strong>Choose folder</strong>; the browser streams individual files through the same
          server validation and audit path as normal uploads.
        </p>
      </div>
    </div>
  );
}
