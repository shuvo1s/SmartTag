'use client';

import {
  PREVIEW_ENABLED_SYMBOLOGIES,
  SYMBOLOGY_SPECS,
  validateBarcodeValue,
  validateQrValue,
} from '@smarttag/barcode-core';
import {
  BARCODE_SYMBOLOGIES,
  OBJECT_BINDABLE_PROPERTIES,
  QR_ERROR_CORRECTION_LEVELS,
  type ArtworkObject,
  type DesignDocument,
  type PropertyBinding,
} from '@smarttag/document-schema';
import { solidStroke } from '@smarttag/document-utils';
import {
  isEffectivelyLocked,
  placementWarning,
  rateImageResolution,
  setObjectsLocked,
  updateObject,
} from '@smarttag/editor-core';
import { cn } from '@smarttag/ui';
import { AlertTriangle, Database, Eye, Lock, Sigma, Unlock } from 'lucide-react';
import { useMemo } from 'react';
import {
  ColorField,
  LengthField,
  NumberField,
  PanelSection,
  SelectField,
  ToggleField,
  panelInputClass,
} from './editor-inputs';
import { PropertyBindingControl } from './binding-controls';
import { useEditorSession } from './editor-session';

type ObjectOf<T extends ArtworkObject['type']> = Extract<ArtworkObject, { type: T }>;

export function ObjectProperties({
  object,
  document,
  pageId,
  readOnly,
  renderVersion,
}: {
  object: ArtworkObject;
  document: DesignDocument;
  pageId: string;
  readOnly: boolean;
  renderVersion: number;
}) {
  const session = useEditorSession();
  const page = document.pages.find((candidate) => candidate.id === pageId)!;
  const locked = isEffectivelyLocked(page, object);
  const unit = document.dimensions.displayUnit;
  const disabled = readOnly;
  const geometryDisabled = readOnly || locked;

  const patch = (label: string, values: Record<string, unknown>, coalesceKey?: string) =>
    session.apply(label, (doc, pid) => updateObject(doc, pid, object.id, values), { coalesceKey });

  const warning = placementWarning(object, document.dimensions);

  return (
    <div data-testid="object-properties" data-object-id={object.id}>
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-900">
            {object.name || object.id}
          </p>
          <p className="text-[11px] capitalize text-slate-500">{typeLabel(object.type)}</p>
        </div>
        <button
          type="button"
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
          aria-label={object.locked ? 'Unlock object' : 'Lock object'}
          title={object.locked ? 'Unlock' : 'Lock'}
          disabled={readOnly}
          onClick={() =>
            session.apply(object.locked ? 'Unlock' : 'Lock', (doc, pid) =>
              setObjectsLocked(doc, pid, [object.id], !object.locked),
            )
          }
        >
          {object.locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
        </button>
      </div>

      {locked ? (
        <p className="flex items-center gap-1.5 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
          <Lock className="size-3" /> Locked — unlock to move or resize.
        </p>
      ) : null}
      {warning ? (
        <p
          data-testid="placement-warning"
          className={cn(
            'flex items-center gap-1.5 border-b px-3 py-1.5 text-[11px]',
            warning.severity === 'warning'
              ? 'border-orange-200 bg-orange-50 text-orange-900'
              : 'border-slate-200 bg-slate-50 text-slate-600',
          )}
        >
          <AlertTriangle className="size-3 shrink-0" /> {warning.message}
        </p>
      ) : null}

      <BindingIndicators object={object} document={document} />

      <PanelSection title="Position & size">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <LengthField
            label="X"
            testId="prop-x"
            valuePt={object.x}
            unit={unit}
            disabled={geometryDisabled}
            onCommitPt={(x) => patch('Set X', { x })}
          />
          <LengthField
            label="Y"
            testId="prop-y"
            valuePt={object.y}
            unit={unit}
            disabled={geometryDisabled}
            onCommitPt={(y) => patch('Set Y', { y })}
          />
          <LengthField
            label="W"
            testId="prop-width"
            valuePt={object.width}
            unit={unit}
            disabled={geometryDisabled}
            min={0}
            onCommitPt={(width) => patch('Set width', { width })}
          />
          {object.type === 'line' ? (
            <span />
          ) : (
            <LengthField
              label="H"
              testId="prop-height"
              valuePt={object.height}
              unit={unit}
              disabled={geometryDisabled}
              min={0}
              onCommitPt={(height) => patch('Set height', { height })}
            />
          )}
          <NumberField
            label="Rotate"
            testId="prop-rotation"
            value={object.rotation}
            suffix="°"
            decimals={2}
            disabled={geometryDisabled}
            onCommit={(rotation) => patch('Rotate', { rotation: ((rotation % 360) + 360) % 360 })}
          />
          <NumberField
            label="Opacity"
            testId="prop-opacity"
            value={object.opacity * 100}
            suffix="%"
            decimals={0}
            min={0}
            max={100}
            disabled={disabled}
            onCommit={(opacity) => patch('Set opacity', { opacity: opacity / 100 })}
          />
        </div>
      </PanelSection>

      {object.type === 'text' ? (
        <TextSection
          object={object}
          document={document}
          pageId={pageId}
          disabled={disabled}
          unit={unit}
          patch={patch}
          renderVersion={renderVersion}
        />
      ) : null}
      {object.type === 'image' ? (
        <ImageSection
          object={object}
          document={document}
          pageId={pageId}
          disabled={disabled}
          patch={patch}
        />
      ) : null}
      {object.type === 'rectangle' || object.type === 'ellipse' ? (
        <ShapeSection object={object} disabled={disabled} unit={unit} patch={patch} />
      ) : null}
      {object.type === 'line' ? (
        <LineSection object={object} disabled={disabled} patch={patch} />
      ) : null}
      {object.type === 'barcode' ? (
        <BarcodeSection
          object={object}
          document={document}
          pageId={pageId}
          disabled={disabled}
          unit={unit}
          patch={patch}
        />
      ) : null}
      {object.type === 'qrCode' ? (
        <QrSection
          object={object}
          document={document}
          pageId={pageId}
          disabled={disabled}
          patch={patch}
        />
      ) : null}
      <PanelSection title="Visibility">
        <PropertyBindingControl
          object={object}
          pageId={pageId}
          property="visible"
          document={document}
          disabled={disabled}
          staticLabel="Visible in the template"
        >
          <ToggleField
            label="Visible"
            testId="prop-visible"
            checked={object.visible}
            disabled={disabled}
            onChange={(visible) => patch(visible ? 'Show' : 'Hide', { visible })}
          />
        </PropertyBindingControl>
      </PanelSection>
    </div>
  );
}

type Patch = (label: string, values: Record<string, unknown>, coalesceKey?: string) => boolean;

function typeLabel(type: ArtworkObject['type']): string {
  return type === 'qrCode' ? 'QR code' : type;
}

/** Summary of the object's data-driven properties (editor-only, never printed). */
function BindingIndicators({
  object,
  document,
}: {
  object: ArtworkObject;
  document: DesignDocument;
}) {
  const bindings = object.bindings as Readonly<Record<string, PropertyBinding>>;
  const bound = Object.keys(OBJECT_BINDABLE_PROPERTIES[object.type]).flatMap((property) => {
    const binding = bindings[property];
    return binding && binding.mode !== 'STATIC' ? [{ property, binding }] : [];
  });
  if (bound.length === 0) return null;
  return (
    <div
      data-testid="binding-indicators"
      className="border-b border-slate-200 bg-amber-50/60 px-3 py-2"
    >
      {bound.map(({ property, binding }) => {
        const label =
          property === 'assetId' ? 'Image' : property === 'visible' ? 'Visibility' : property;
        if (binding.mode === 'EXPRESSION') {
          return (
            <p key={property} className="flex items-center gap-1.5 text-[11px] text-amber-900">
              <Sigma className="size-3 shrink-0" />
              <span className="capitalize">{label}</span>
              <span className="text-amber-700">↳</span>
              <code
                className="truncate rounded bg-white px-1 font-mono text-[10px]"
                title={binding.expression}
              >
                {binding.expression}
              </code>
            </p>
          );
        }
        const definition = document.dataSchema.fields.find(
          (candidate) => candidate.key === binding.field,
        );
        return (
          <p key={property} className="flex items-center gap-1.5 text-[11px] text-amber-900">
            {property === 'visible' ? (
              <Eye className="size-3 shrink-0" />
            ) : (
              <Database className="size-3 shrink-0" />
            )}
            <span className="capitalize">{label}</span>
            <span className="text-amber-700">↳</span>
            <code className="rounded bg-white px-1 font-mono text-[10px]">{binding.field}</code>
            {definition ? (
              <span className="truncate text-amber-700">{definition.displayName}</span>
            ) : null}
          </p>
        );
      })}
      <p className="mt-1 text-[10px] text-amber-700">
        Driven by data. Template values show the stored sample; Data preview shows test data.
      </p>
    </div>
  );
}

function TextSection({
  object,
  document,
  pageId,
  disabled,
  unit,
  patch,
  renderVersion,
}: {
  object: ObjectOf<'text'>;
  document: DesignDocument;
  pageId: string;
  disabled: boolean;
  unit: DesignDocument['dimensions']['displayUnit'];
  patch: Patch;
  renderVersion: number;
}) {
  const session = useEditorSession();
  const faces = session.fontFaces;
  const status = session.resources.fonts.status(object.fontAssetId);
  const layout = useMemo(
    () => session.resources.services.textLayout.layout({ ...object }),
    // renderVersion changes when fonts finish loading
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [object, renderVersion, session],
  );
  const families = [...new Set(faces.map((face) => face.familyName))].sort();
  const familyFaces = faces
    .filter((face) => face.familyName === object.fontFamily)
    .sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style));

  const chooseFace = (assetId: string) => {
    const face = faces.find((candidate) => candidate.assetId === assetId);
    if (!face) return;
    void session.resources.fonts.load(face.assetId);
    patch('Change font', {
      fontAssetId: face.assetId,
      fontFamily: face.familyName,
      fontWeight: face.weight,
      fontStyle: face.style,
    });
  };

  return (
    <PanelSection title="Text">
      <PropertyBindingControl
        object={object}
        pageId={pageId}
        property="content"
        document={document}
        disabled={disabled}
        staticLabel="Sample text"
      >
        <label className="block">
          <span className="sr-only">Text content</span>
          <textarea
            data-testid="prop-text-content"
            aria-label="Text content"
            className={cn(panelInputClass, 'h-16 resize-y py-1 font-sans')}
            value={object.content}
            dir="auto"
            lang={object.language ?? undefined}
            disabled={disabled}
            onChange={(event) =>
              patch('Edit text', { content: event.target.value }, `text:${object.id}:content`)
            }
            onBlur={() => session.store.sealHistory()}
          />
        </label>
      </PropertyBindingControl>

      <SelectField
        label="Font"
        testId="prop-font-family"
        value={object.fontAssetId ? object.fontFamily : ''}
        disabled={disabled}
        options={[
          ...(object.fontAssetId
            ? []
            : [{ value: '', label: `${object.fontFamily} (not controlled)` }]),
          ...families.map((family) => ({ value: family, label: family })),
        ]}
        onChange={(family) => {
          const candidates = faces.filter((face) => face.familyName === family);
          const match =
            candidates.find(
              (face) => face.weight === object.fontWeight && face.style === object.fontStyle,
            ) ??
            candidates.find((face) => face.weight === 400 && face.style === 'NORMAL') ??
            candidates[0];
          if (match) chooseFace(match.assetId);
        }}
      />
      <SelectField
        label="Style"
        testId="prop-font-face"
        value={object.fontAssetId ?? ''}
        disabled={disabled || familyFaces.length === 0}
        options={[
          ...(object.fontAssetId ? [] : [{ value: '', label: '—' }]),
          ...familyFaces.map((face) => ({
            value: face.assetId,
            label: `${face.subfamilyName} · ${face.weight}${face.style === 'ITALIC' ? ' italic' : ''}`,
          })),
        ]}
        onChange={chooseFace}
      />
      {status !== 'LOADED' ? (
        <p
          data-testid="font-status"
          className={cn(
            'flex items-start gap-1.5 rounded px-2 py-1 text-[11px]',
            status === 'LOADING' ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-800',
          )}
        >
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {status === 'UNASSIGNED'
            ? 'No controlled font is assigned. Choose a font from the registry; the browser default shown here is not the production font.'
            : status === 'LOADING'
              ? 'Loading the exact font file…'
              : 'The font file is not available. The text cannot be shown with its production font.'}
        </p>
      ) : null}
      {layout.missingGlyphs.length > 0 ? (
        <p
          data-testid="missing-glyphs"
          className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-800"
        >
          This font has no glyphs for: {layout.missingGlyphs.join(' ')}
        </p>
      ) : null}
      {layout.overflow ? (
        <p
          data-testid="text-overflow"
          className="flex items-center gap-1.5 rounded bg-red-50 px-2 py-1 text-[11px] text-red-800"
        >
          <AlertTriangle className="size-3" /> Text does not fit its frame
          {object.overflow.mode === 'SHRINK_TO_FIT' ? ' even at the minimum size' : ''}.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <NumberField
          label="Size"
          testId="prop-font-size"
          value={object.fontSize}
          suffix="pt"
          decimals={2}
          min={0.5}
          max={2000}
          disabled={disabled}
          onCommit={(fontSize) => patch('Font size', { fontSize })}
        />
        <NumberField
          label="Line"
          testId="prop-line-height"
          value={object.lineHeight}
          suffix="×"
          decimals={2}
          step={0.05}
          min={0.1}
          max={10}
          disabled={disabled}
          onCommit={(lineHeight) => patch('Line height', { lineHeight })}
        />
        <NumberField
          label="Spacing"
          testId="prop-letter-spacing"
          value={object.letterSpacing}
          suffix="pt"
          decimals={2}
          step={0.05}
          min={-100}
          max={100}
          disabled={disabled}
          onCommit={(letterSpacing) => patch('Letter spacing', { letterSpacing })}
        />
        <SelectField
          label="Align"
          testId="prop-text-align"
          value={object.textAlign}
          disabled={disabled}
          options={[
            { value: 'START', label: 'Start' },
            { value: 'CENTER', label: 'Center' },
            { value: 'END', label: 'End' },
            { value: 'JUSTIFY', label: 'Justify (start)' },
          ]}
          onChange={(textAlign) => patch('Align text', { textAlign })}
        />
        <SelectField
          label="Vertical"
          value={object.verticalAlign}
          disabled={disabled}
          options={[
            { value: 'TOP', label: 'Top' },
            { value: 'MIDDLE', label: 'Middle' },
            { value: 'BOTTOM', label: 'Bottom' },
          ]}
          onChange={(verticalAlign) => patch('Vertical align', { verticalAlign })}
        />
        <SelectField
          label="Wrap"
          testId="prop-wrap"
          value={object.wrap}
          disabled={disabled}
          options={[
            { value: 'WORD', label: 'Words' },
            { value: 'NONE', label: 'Line breaks only' },
          ]}
          onChange={(wrap) => patch('Wrapping', { wrap })}
        />
        <SelectField
          label="Direction"
          value={object.direction}
          disabled={disabled}
          options={[
            { value: 'AUTO', label: 'Auto' },
            { value: 'LTR', label: 'LTR' },
            { value: 'RTL', label: 'RTL' },
          ]}
          onChange={(direction) => patch('Text direction', { direction })}
        />
        <SelectField
          label="Overflow"
          testId="prop-overflow"
          value={object.overflow.mode}
          disabled={disabled}
          options={[
            { value: 'VISIBLE', label: 'Visible' },
            { value: 'CLIP', label: 'Clip' },
            { value: 'SHRINK_TO_FIT', label: 'Shrink to fit' },
          ]}
          onChange={(mode) =>
            patch('Overflow', {
              overflow:
                mode === 'SHRINK_TO_FIT'
                  ? { mode, minFontSize: Math.min(6, object.fontSize) }
                  : { mode },
            })
          }
        />
      </div>
      {object.overflow.mode === 'SHRINK_TO_FIT' ? (
        <NumberField
          label="Min size"
          value={object.overflow.minFontSize}
          suffix="pt"
          decimals={2}
          min={0.5}
          max={object.fontSize}
          disabled={disabled}
          onCommit={(minFontSize) =>
            patch('Minimum size', { overflow: { mode: 'SHRINK_TO_FIT', minFontSize } })
          }
        />
      ) : null}
      <ColorField
        label="Colour"
        testId="prop-text-color"
        color={object.textColor}
        disabled={disabled}
        onChange={(textColor) => textColor && patch('Text colour', { textColor })}
      />
      <label className="flex items-center gap-1.5">
        <span className="w-12 shrink-0 text-[11px] text-slate-500">Language</span>
        <input
          className={panelInputClass}
          aria-label="Language"
          placeholder="e.g. en, bn, ar"
          defaultValue={object.language ?? ''}
          disabled={disabled}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if ((value || null) !== object.language) patch('Language', { language: value || null });
          }}
        />
      </label>
      <p className="text-[10px] leading-snug text-slate-400">
        Unit: {unit}. Text is measured with the exact font file; final shaping and line breaking are
        verified by the production renderer.
      </p>
    </PanelSection>
  );
}

function ImageSection({
  object,
  document,
  pageId,
  disabled,
  patch,
}: {
  object: ObjectOf<'image'>;
  document: DesignDocument;
  pageId: string;
  disabled: boolean;
  patch: Patch;
}) {
  const session = useEditorSession();
  const asset = object.assetId ? session.assets.get(object.assetId) : undefined;
  const resolution = asset ? rateImageResolution(object, asset) : null;
  return (
    <PanelSection title="Image">
      <PropertyBindingControl
        object={object}
        pageId={pageId}
        property="assetId"
        document={document}
        disabled={disabled}
        staticLabel="Sample image"
      >
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
          <span className="truncate" title={asset?.filename}>
            {asset ? asset.filename : object.assetId ? 'Asset' : 'No image'}
          </span>
          <button
            type="button"
            className="shrink-0 text-brand-700 hover:underline disabled:text-slate-400"
            disabled={disabled}
            onClick={() => session.setUi({ assetPicker: { purpose: 'replace' } })}
          >
            Replace…
          </button>
        </div>
      </PropertyBindingControl>
      <SelectField
        label="Fit"
        testId="prop-fit"
        value={object.fitMode}
        disabled={disabled}
        options={[
          { value: 'CONTAIN', label: 'Fit (contain)' },
          { value: 'COVER', label: 'Fill (cover)' },
          { value: 'STRETCH', label: 'Stretch' },
        ]}
        onChange={(fitMode) => patch('Image fit', { fitMode })}
      />
      <ToggleField
        label="Keep aspect ratio when resizing"
        checked={object.preserveAspectRatio}
        disabled={disabled}
        onChange={(preserveAspectRatio) => patch('Aspect ratio', { preserveAspectRatio })}
      />
      {object.crop ? (
        <p className="text-[11px] text-slate-500">
          Crop: {Math.round(object.crop.width * 100)}% × {Math.round(object.crop.height * 100)}% of
          the source (preserved; crop editing arrives later).
        </p>
      ) : null}
      <div data-testid="effective-ppi" className="rounded bg-slate-50 px-2 py-1.5 text-[11px]">
        {asset?.mimeType === 'image/svg+xml' ? (
          <span className="text-slate-600">Vector artwork — resolution independent</span>
        ) : resolution ? (
          <span
            className={cn(
              'font-medium',
              resolution.rating === 'GOOD'
                ? 'text-green-700'
                : resolution.rating === 'WARNING'
                  ? 'text-amber-700'
                  : 'text-red-700',
            )}
          >
            Effective resolution: {Math.round(resolution.effectivePpi)} PPI · {resolution.rating}
          </span>
        ) : (
          <span className="text-slate-500">Effective resolution unavailable</span>
        )}
        <p className="mt-0.5 text-[10px] text-slate-400">
          Provisional: ≥ 300 good, 150–299 warning, &lt; 150 low.
        </p>
      </div>
    </PanelSection>
  );
}

function StrokeFields({
  stroke,
  disabled,
  onChange,
  required,
}: {
  stroke: ObjectOf<'rectangle'>['stroke'];
  disabled: boolean;
  onChange: (stroke: ObjectOf<'rectangle'>['stroke']) => void;
  required?: boolean;
}) {
  return (
    <>
      <ColorField
        label="Stroke"
        testId="prop-stroke"
        color={stroke?.color ?? null}
        allowNone={!required}
        disabled={disabled}
        onChange={(color) =>
          onChange(
            color
              ? { ...(stroke ?? solidStroke({ space: 'RGB', hex: '#000000' }, 0.5)), color }
              : null,
          )
        }
      />
      {stroke ? (
        <NumberField
          label="Width"
          testId="prop-stroke-width"
          value={stroke.width}
          suffix="pt"
          decimals={2}
          step={0.25}
          min={0.01}
          disabled={disabled}
          onCommit={(width) => onChange({ ...stroke, width })}
        />
      ) : null}
    </>
  );
}

function ShapeSection({
  object,
  disabled,
  unit,
  patch,
}: {
  object: ObjectOf<'rectangle'> | ObjectOf<'ellipse'>;
  disabled: boolean;
  unit: DesignDocument['dimensions']['displayUnit'];
  patch: Patch;
}) {
  return (
    <PanelSection title="Appearance">
      <ColorField
        label="Fill"
        testId="prop-fill"
        color={object.fill}
        allowNone
        disabled={disabled}
        onChange={(fill) => patch('Fill', { fill })}
      />
      <StrokeFields
        stroke={object.stroke}
        disabled={disabled}
        onChange={(stroke) => patch('Stroke', { stroke })}
      />
      {object.type === 'rectangle' ? (
        <LengthField
          label="Radius"
          testId="prop-corner-radius"
          valuePt={object.cornerRadius}
          unit={unit}
          min={0}
          disabled={disabled}
          onCommitPt={(cornerRadius) => patch('Corner radius', { cornerRadius })}
        />
      ) : null}
    </PanelSection>
  );
}

function LineSection({
  object,
  disabled,
  patch,
}: {
  object: ObjectOf<'line'>;
  disabled: boolean;
  patch: Patch;
}) {
  return (
    <PanelSection title="Stroke">
      <StrokeFields
        stroke={object.stroke}
        required
        disabled={disabled}
        onChange={(stroke) => stroke && patch('Stroke', { stroke })}
      />
      <SelectField
        label="Caps"
        value={object.stroke.lineCap}
        disabled={disabled}
        options={[
          { value: 'BUTT', label: 'Butt' },
          { value: 'ROUND', label: 'Round' },
          { value: 'SQUARE', label: 'Square' },
        ]}
        onChange={(lineCap) => patch('Line caps', { stroke: { ...object.stroke, lineCap } })}
      />
    </PanelSection>
  );
}

function BarcodeSection({
  object,
  document,
  pageId,
  disabled,
  unit,
  patch,
}: {
  object: ObjectOf<'barcode'>;
  document: DesignDocument;
  pageId: string;
  disabled: boolean;
  unit: DesignDocument['dimensions']['displayUnit'];
  patch: Patch;
}) {
  const validation = validateBarcodeValue(object.symbology, object.value);
  const enabled = PREVIEW_ENABLED_SYMBOLOGIES.includes(object.symbology);
  return (
    <PanelSection title="Barcode">
      <SelectField
        label="Type"
        testId="prop-symbology"
        value={object.symbology}
        disabled={disabled}
        options={BARCODE_SYMBOLOGIES.map((symbology) => ({
          value: symbology,
          label: `${SYMBOLOGY_SPECS[symbology].displayName}${PREVIEW_ENABLED_SYMBOLOGIES.includes(symbology) ? '' : ' (preview later)'}`,
        }))}
        onChange={(symbology) => patch('Symbology', { symbology })}
      />
      <PropertyBindingControl
        object={object}
        pageId={pageId}
        property="value"
        document={document}
        disabled={disabled}
        staticLabel="Sample value"
      >
        <label className="flex items-center gap-1.5">
          <span className="w-12 shrink-0 text-[11px] text-slate-500">Value</span>
          <input
            data-testid="prop-barcode-value"
            aria-label="Barcode value"
            className={cn(panelInputClass, 'font-mono')}
            value={object.value}
            disabled={disabled}
            onChange={(event) =>
              patch('Barcode value', { value: event.target.value }, `barcode:${object.id}:value`)
            }
          />
        </label>
        {!validation.valid ? (
          <p
            data-testid="barcode-validation"
            className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-800"
          >
            {validation.issues[0]?.message}
          </p>
        ) : !enabled ? (
          <p className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
            Valid, but the {SYMBOLOGY_SPECS[object.symbology].displayName} preview is not enabled
            yet.
          </p>
        ) : null}
      </PropertyBindingControl>
      <ToggleField
        label="Show human-readable text"
        checked={object.showHumanReadableText}
        disabled={disabled}
        onChange={(showHumanReadableText) =>
          patch('Human-readable text', { showHumanReadableText })
        }
      />
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <LengthField
          label="Bars"
          testId="prop-bar-height"
          valuePt={object.barHeight}
          unit={unit}
          min={0}
          disabled={disabled}
          onCommitPt={(barHeight) => patch('Bar height', { barHeight })}
        />
        <NumberField
          label="Quiet"
          testId="prop-quiet-zone"
          value={object.quietZone}
          suffix="X"
          decimals={1}
          min={0}
          max={50}
          disabled={disabled}
          onCommit={(quietZone) => patch('Quiet zone', { quietZone })}
        />
      </div>
      <ColorField
        label="Bars"
        color={object.foregroundColor}
        disabled={disabled}
        onChange={(foregroundColor) => foregroundColor && patch('Bar colour', { foregroundColor })}
      />
      <ColorField
        label="Back"
        color={object.backgroundColor}
        allowNone
        disabled={disabled}
        onChange={(backgroundColor) => patch('Background', { backgroundColor })}
      />
    </PanelSection>
  );
}

function QrSection({
  object,
  document,
  pageId,
  disabled,
  patch,
}: {
  object: ObjectOf<'qrCode'>;
  document: DesignDocument;
  pageId: string;
  disabled: boolean;
  patch: Patch;
}) {
  const validation = validateQrValue(object.value, object.errorCorrection);
  return (
    <PanelSection title="QR code">
      <PropertyBindingControl
        object={object}
        pageId={pageId}
        property="value"
        document={document}
        disabled={disabled}
        staticLabel="Sample value"
      >
        <label className="block">
          <span className="sr-only">QR value</span>
          <textarea
            data-testid="prop-qr-value"
            aria-label="QR value"
            className={cn(panelInputClass, 'h-14 resize-y py-1 font-mono')}
            value={object.value}
            disabled={disabled}
            onChange={(event) =>
              patch('QR value', { value: event.target.value }, `qr:${object.id}:value`)
            }
          />
        </label>
        {!validation.valid ? (
          <p className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-800">
            {validation.issues[0]?.message}
          </p>
        ) : null}
      </PropertyBindingControl>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <SelectField
          label="ECC"
          testId="prop-qr-ecc"
          value={object.errorCorrection}
          disabled={disabled}
          options={QR_ERROR_CORRECTION_LEVELS.map((level) => ({ value: level, label: level }))}
          onChange={(errorCorrection) => patch('Error correction', { errorCorrection })}
        />
        <NumberField
          label="Quiet"
          value={object.quietZone}
          suffix="mod"
          decimals={0}
          min={0}
          max={20}
          disabled={disabled}
          onCommit={(quietZone) => patch('Quiet zone', { quietZone: Math.round(quietZone) })}
        />
      </div>
      <ColorField
        label="Modules"
        color={object.foregroundColor}
        disabled={disabled}
        onChange={(foregroundColor) => foregroundColor && patch('QR colour', { foregroundColor })}
      />
      <ColorField
        label="Back"
        color={object.backgroundColor}
        allowNone
        disabled={disabled}
        onChange={(backgroundColor) => patch('Background', { backgroundColor })}
      />
    </PanelSection>
  );
}
