'use client';

import { ASSET_TYPES, type AssetDto, type AssetType } from '@smarttag/shared-types';
import { addObjects, createToolObject, updateObject } from '@smarttag/editor-core';
import { cn } from '@smarttag/ui';
import { Search, Upload, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { describeError } from '@/lib/api-client';
import { assetContentUrl } from '../rendering/rendering-services';
import { usePlaceableAssets, useUploadAsset } from './editor-api';
import { panelInputClass } from './editor-inputs';
import { useEditorSession, useEditorState, useEditorUi } from './editor-session';

const IMAGE_ASSET_TYPES = ASSET_TYPES.filter((type) => type !== 'FONT');

function formatBytes(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AssetBrowser({
  onChoose,
  initialType = '',
  compact = false,
}: {
  onChoose: (asset: AssetDto) => void;
  initialType?: AssetType | '';
  compact?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [assetType, setAssetType] = useState<AssetType | ''>(initialType);
  const assets = usePlaceableAssets(debounced, assetType);
  const upload = useUploadAsset();
  const canUpload = useEditorState((state) => !state.readOnly);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchId = useId();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="asset-browser">
      <div className="space-y-1.5 border-b border-slate-200 p-2">
        <label htmlFor={searchId} className="relative block">
          <span className="sr-only">Search assets</span>
          <Search
            className="pointer-events-none absolute left-1.5 top-1.5 size-4 text-slate-400"
            aria-hidden
          />
          <input
            id={searchId}
            data-testid="asset-search"
            className={cn(panelInputClass, 'pl-7')}
            placeholder="Search by file name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="flex gap-1.5">
          <select
            aria-label="Asset type"
            data-testid="asset-type-filter"
            className={panelInputClass}
            value={assetType}
            onChange={(event) => setAssetType(event.target.value as AssetType | '')}
          >
            <option value="">All image types</option>
            {IMAGE_ASSET_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
          {canUpload ? (
            <>
              <button
                type="button"
                className="flex h-7 shrink-0 items-center gap-1 rounded border border-slate-300 px-2 text-xs text-slate-700 hover:bg-slate-100"
                onClick={() => fileInput.current?.click()}
                disabled={upload.isPending}
              >
                <Upload className="size-3.5" /> Upload
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="hidden"
                data-testid="asset-upload-input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file)
                    upload.mutate({
                      file,
                      assetType: assetType || (file.type === 'image/svg+xml' ? 'SVG' : 'IMAGE'),
                    });
                }}
              />
            </>
          ) : null}
        </div>
        {upload.error ? (
          <p role="alert" className="text-[11px] text-red-700">
            {describeError(upload.error)}
          </p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {assets.error ? (
          <p className="text-xs text-red-700">{describeError(assets.error)}</p>
        ) : null}
        {assets.data?.items.length === 0 ? (
          <p className="text-xs text-slate-500">No PNG, JPEG or SVG assets match.</p>
        ) : null}
        <ul className={cn('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-3')}>
          {assets.data?.items.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                data-testid={`asset-item-${asset.id}`}
                onClick={() => onChoose(asset)}
                className="group flex w-full flex-col overflow-hidden rounded border border-slate-200 bg-white text-left hover:border-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600"
                title={`Insert ${asset.filename}`}
              >
                <span className="flex h-20 items-center justify-center bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:12px_12px]">
                  {/* Thumbnails come from the tenant-scoped, sandboxed content endpoint. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={assetContentUrl(asset.id)}
                    alt=""
                    loading="lazy"
                    className="max-h-full max-w-full object-contain p-1"
                  />
                </span>
                <span className="truncate px-1.5 pt-1 text-[11px] font-medium text-slate-800">
                  {asset.filename}
                </span>
                <span className="truncate px-1.5 pb-1 text-[10px] text-slate-500">
                  {asset.assetType.replace(/_/g, ' ').toLowerCase()} ·{' '}
                  {asset.mimeType === 'image/svg+xml'
                    ? 'SVG'
                    : asset.widthPx && asset.heightPx
                      ? `${asset.widthPx}×${asset.heightPx}px`
                      : asset.mimeType}{' '}
                  · {formatBytes(asset.sizeBytes)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Insert (image / logo) or replace dialog. */
export function AssetPickerDialog() {
  const session = useEditorSession();
  const picker = useEditorUi((ui) => ui.assetPicker);
  const selection = useEditorState((state) => state.selection);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (picker && !dialog.current?.open) dialog.current?.showModal();
    if (!picker && dialog.current?.open) dialog.current.close();
  }, [picker]);

  const close = () => session.setUi({ assetPicker: null });

  const choose = (asset: AssetDto) => {
    session.assets.set(asset.id, asset);
    if (picker?.purpose === 'replace' && selection.length === 1) {
      session.apply('Replace image', (doc, pageId) =>
        updateObject(doc, pageId, selection[0]!, { assetId: asset.id }),
      );
    } else {
      insertImage(session, asset, picker?.purpose === 'logo' ? 'logo' : 'image');
    }
    close();
  };

  return (
    <dialog
      ref={dialog}
      aria-label="Choose an image asset"
      data-testid="asset-picker"
      onClose={close}
      onCancel={close}
      className="m-auto h-[70vh] w-[640px] max-w-[95vw] rounded-lg border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      {picker ? (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-900">
              {picker.purpose === 'replace'
                ? 'Replace image'
                : picker.purpose === 'logo'
                  ? 'Insert logo'
                  : 'Insert image'}
            </h2>
            <button
              type="button"
              aria-label="Close"
              className="rounded p-1 hover:bg-slate-100"
              onClick={close}
            >
              <X className="size-4" />
            </button>
          </div>
          <AssetBrowser onChoose={choose} initialType={picker.purpose === 'logo' ? 'LOGO' : ''} />
        </div>
      ) : null}
    </dialog>
  );
}

export function insertImage(
  session: ReturnType<typeof useEditorSession>,
  asset: AssetDto,
  tool: 'image' | 'logo',
): void {
  session.assets.set(asset.id, asset);
  const object = createToolObject(tool, session.store.getState().document, { asset });
  session.apply(tool === 'logo' ? 'Insert logo' : 'Insert image', (doc, pageId) => ({
    document: addObjects(doc, pageId, [object]),
    selection: [object.id],
  }));
}
