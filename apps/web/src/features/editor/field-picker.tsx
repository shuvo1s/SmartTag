'use client';

import {
  isFieldTypeCompatible,
  type BindablePropertyKind,
  type DataField,
} from '@smarttag/document-schema';
import { cn } from '@smarttag/ui';
import { ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FieldTypeBadge } from './data-ui';
import { panelInputClass } from './editor-inputs';

/**
 * Searchable data field chooser. Shows display name, key, type and whether the field is required,
 * and offers only fields whose type suits the property, so nonsensical bindings (true/false as an
 * image, an image as text) cannot be chosen.
 */
export function FieldPicker({
  fields,
  kind,
  value,
  onChange,
  disabled,
  testId,
}: {
  fields: readonly DataField[];
  /** When given, incompatible field types are not offered. */
  kind: BindablePropertyKind | null;
  value: string | null;
  onChange: (key: string) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const compatible = useMemo(
    () => fields.filter((field) => kind === null || isFieldTypeCompatible(kind, field.type)),
    [fields, kind],
  );
  const needle = query.trim().toLowerCase();
  const shown = compatible.filter(
    (field) =>
      needle === '' ||
      field.key.includes(needle) ||
      field.displayName.toLowerCase().includes(needle),
  );
  const selected = fields.find((field) => field.key === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div ref={root} className="relative" data-testid={testId}>
      <button
        type="button"
        data-testid={testId ? `${testId}-button` : undefined}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(panelInputClass, 'flex items-center gap-1.5 text-left')}
      >
        {selected ? (
          <>
            <span className="min-w-0 flex-1 truncate">{selected.displayName}</span>
            <code className="shrink-0 font-mono text-[10px] text-slate-500">{selected.key}</code>
          </>
        ) : (
          <span className="flex-1 text-slate-400">
            {value ? `Unknown field ${value}` : 'Choose a field…'}
          </span>
        )}
        <ChevronDown className="size-3.5 shrink-0 text-slate-400" aria-hidden />
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-8 z-40 rounded border border-slate-300 bg-white shadow-lg">
          <label htmlFor={searchId} className="relative block border-b border-slate-200 p-1.5">
            <span className="sr-only">Search fields</span>
            <Search
              className="pointer-events-none absolute left-3 top-3 size-3.5 text-slate-400"
              aria-hidden
            />
            <input
              id={searchId}
              autoFocus
              data-testid="field-picker-search"
              className={cn(panelInputClass, 'pl-6')}
              placeholder="Search name or key"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setOpen(false);
                if (event.key === 'Enter' && shown[0]) {
                  onChange(shown[0].key);
                  setOpen(false);
                }
              }}
            />
          </label>
          <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
            {shown.map((field) => (
              <li key={field.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={field.key === value}
                  data-testid={`field-option-${field.key}`}
                  onClick={() => {
                    onChange(field.key);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-brand-50',
                    field.key === value ? 'bg-brand-50' : '',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-900">
                      {field.displayName}
                      {field.required ? <span className="text-rose-600"> *</span> : null}
                    </span>
                    <code className="block truncate font-mono text-[10px] text-slate-500">
                      {field.key}
                    </code>
                  </span>
                  <FieldTypeBadge type={field.type} />
                </button>
              </li>
            ))}
            {shown.length === 0 ? (
              <li className="px-2 py-2 text-[11px] text-slate-500">
                {compatible.length === 0
                  ? 'No data field has a type this property can use.'
                  : 'No field matches.'}
              </li>
            ) : null}
          </ul>
          {compatible.length < fields.length ? (
            <p className="border-t border-slate-100 px-2 py-1 text-[10px] text-slate-400">
              {fields.length - compatible.length} field
              {fields.length - compatible.length === 1 ? '' : 's'} with incompatible types hidden
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
