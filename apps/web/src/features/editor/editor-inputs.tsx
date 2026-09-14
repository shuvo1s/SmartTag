'use client';

import type { Color, MeasurementUnit } from '@smarttag/document-schema';
import { DISPLAY_PRECISION, fromPoints, roundTo, toPoints } from '@smarttag/document-utils';
import { cn } from '@smarttag/ui';
import { useId, useState, type ReactNode } from 'react';

/** Panel section with a small uppercase heading (dense, creative-tool styling). */
export function PanelSection({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="border-b border-slate-200 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h3>
        {actions}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

const inputClass =
  'h-7 w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 text-xs text-slate-900 tabular-nums focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 disabled:bg-slate-100 disabled:text-slate-500';

function format(value: number, decimals: number): string {
  return Number(roundTo(value, decimals).toFixed(decimals)).toString();
}

interface NumericInputProps {
  readonly label: string;
  readonly value: number;
  readonly onCommit: (value: number) => void;
  readonly disabled?: boolean;
  readonly suffix?: string;
  readonly decimals?: number;
  readonly step?: number;
  readonly min?: number;
  readonly max?: number;
  readonly testId?: string;
  readonly compact?: boolean;
}

/**
 * Number field that commits on Enter or blur (one undo step), reverts on Escape and steps with the
 * arrow keys. Invalid text is never committed.
 */
export function NumberField({
  label,
  value,
  onCommit,
  disabled,
  suffix,
  decimals = 2,
  step = 1,
  min,
  max,
  testId,
  compact,
}: NumericInputProps) {
  const id = useId();
  const [text, setText] = useState(format(value, decimals));
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(format(value, decimals));
  // Follow external changes (undo, canvas drags) unless the user is typing.
  if (!focused && shown !== format(value, decimals)) {
    setShown(format(value, decimals));
    setText(format(value, decimals));
  }

  const commit = (raw: string) => {
    const parsed = Number(raw.replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(parsed)) {
      setText(format(value, decimals));
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    if (format(clamped, decimals) !== format(value, decimals)) {
      onCommit(clamped);
    }
    setText(format(clamped, decimals));
  };

  return (
    <label htmlFor={id} className={cn('flex items-center gap-1.5', compact ? '' : 'min-w-0')}>
      <span className="w-12 shrink-0 text-[11px] text-slate-500">{label}</span>
      <span className="relative flex min-w-0 flex-1 items-center">
        <input
          id={id}
          data-testid={testId}
          aria-label={label}
          className={cn(inputClass, suffix ? 'pr-7' : '')}
          inputMode="decimal"
          value={text}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onChange={(event) => setText(event.target.value)}
          onBlur={(event) => {
            setFocused(false);
            commit(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit((event.target as HTMLInputElement).value);
              (event.target as HTMLInputElement).blur();
            } else if (event.key === 'Escape') {
              setText(format(value, decimals));
              (event.target as HTMLInputElement).blur();
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              const delta = (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1);
              const current = Number(text.replace(',', '.'));
              commit(String((Number.isFinite(current) ? current : value) + delta));
            }
          }}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-1.5 text-[10px] text-slate-400">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/** Physical length: shown in the document's display unit, committed as canonical points. */
export function LengthField({
  label,
  valuePt,
  unit,
  onCommitPt,
  ...rest
}: Omit<NumericInputProps, 'value' | 'onCommit' | 'suffix' | 'decimals' | 'step'> & {
  readonly valuePt: number;
  readonly unit: MeasurementUnit;
  readonly onCommitPt: (valuePt: number) => void;
}) {
  const decimals = DISPLAY_PRECISION[unit];
  return (
    <NumberField
      {...rest}
      label={label}
      value={fromPoints(valuePt, unit)}
      decimals={decimals}
      step={unit === 'in' ? 0.01 : unit === 'pt' ? 1 : unit === 'cm' ? 0.01 : 0.1}
      suffix={unit}
      onCommit={(value) => onCommitPt(toPoints(value, unit))}
    />
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center gap-1.5">
      <span className="w-12 shrink-0 text-[11px] text-slate-500">{label}</span>
      <select
        id={id}
        data-testid={testId}
        className={inputClass}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ToggleField({
  label,
  checked,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-700">
      <input
        type="checkbox"
        data-testid={testId}
        className="size-3.5 accent-brand-700"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

const HEX = /^#?([0-9a-f]{6})$/i;

/**
 * RGB colour editing. CMYK and spot colours are shown read-only (their production handling
 * arrives with colour-managed output) and can be replaced explicitly with an RGB colour.
 */
export function ColorField({
  label,
  color,
  onChange,
  disabled,
  allowNone,
  testId,
}: {
  label: string;
  color: Color | null;
  onChange: (color: Color | null) => void;
  disabled?: boolean;
  allowNone?: boolean;
  testId?: string;
}) {
  const id = useId();
  const rgbHex = color?.space === 'RGB' ? color.hex : null;
  const [text, setText] = useState(rgbHex ?? '');
  const [shownHex, setShownHex] = useState(rgbHex);
  if (shownHex !== rgbHex) {
    setShownHex(rgbHex);
    setText(rgbHex ?? '');
  }
  const commit = (value: string) => {
    const match = HEX.exec(value.trim());
    if (match?.[1]) {
      const hex = `#${match[1].toUpperCase()}`;
      if (hex !== rgbHex) onChange({ space: 'RGB', hex });
    } else {
      setText(rgbHex ?? '');
    }
  };
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="w-12 shrink-0 text-[11px] text-slate-500">
        {label}
      </label>
      {color && color.space !== 'RGB' ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-slate-600">
          <span className="truncate">
            {color.space === 'CMYK'
              ? `CMYK ${color.c}/${color.m}/${color.y}/${color.k}`
              : `Spot ${color.name} ${color.tint}%`}
          </span>
          {!disabled ? (
            <button
              type="button"
              className="text-brand-700 hover:underline"
              onClick={() => onChange({ space: 'RGB', hex: '#000000' })}
            >
              Use RGB
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <input
            type="color"
            aria-label={`${label} colour picker`}
            className="h-7 w-8 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5 disabled:cursor-not-allowed"
            value={rgbHex ?? '#FFFFFF'}
            disabled={disabled}
            onChange={(event) => commit(event.target.value)}
          />
          <input
            id={id}
            data-testid={testId}
            className={inputClass}
            value={text}
            placeholder={allowNone ? 'None' : '#RRGGBB'}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit((event.target as HTMLInputElement).value);
            }}
          />
          {allowNone && color ? (
            <button
              type="button"
              className="shrink-0 text-[11px] text-slate-500 hover:text-slate-800"
              disabled={disabled}
              onClick={() => onChange(null)}
            >
              None
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export const panelInputClass = inputClass;
