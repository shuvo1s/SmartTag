import { validateBarcodeValue, validateQrValue } from '@smarttag/barcode-core';
import type { ArtworkObject, DesignDocument, Page, TextObject } from '@smarttag/document-schema';
import type { DataIssue, DataIssueTarget } from './issues';
import type { DocumentResolution } from './resolve';

/** Availability of an image asset for the current organization, as known to the caller. */
export type AssetAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';

export interface ObjectCheckOptions {
  /**
   * Resolves whether an image asset exists in the organization and can be placed. Browsers answer
   * from tenant-scoped asset requests, the API from the database. Without it, availability is
   * not checked.
   */
  readonly assetAvailability?: (assetId: string) => AssetAvailability;
}

/** What layout checks need from a text layout engine (rendering-core's TextLayoutEngine fits). */
export interface TextLayoutProbe {
  layout(object: TextObject): {
    readonly overflow: boolean;
    readonly fontSize: number;
    readonly missingGlyphs: readonly string[];
  };
}

function isVisible(page: Page, object: ArtworkObject): boolean {
  if (!object.visible) return false;
  if (object.groupId === null) return true;
  return page.groups.find((group) => group.id === object.groupId)?.visible ?? true;
}

function targetOf(page: Page, object: ArtworkObject, property: string | null): DataIssueTarget {
  return {
    pageId: page.id,
    pageName: page.name,
    objectId: object.id,
    objectName: object.name,
    objectType: object.type,
    property,
  };
}

/** Bound, printed objects of the resolved document together with the properties that failed. */
function* boundVisibleObjects(resolution: DocumentResolution) {
  const bound = new Map<string, Set<string>>();
  const failedProperties = new Set<string>();
  for (const property of resolution.properties) {
    const key = property.target.objectId;
    if (!bound.has(key)) bound.set(key, new Set());
    bound.get(key)!.add(property.target.property);
    // A value that production still has to supply (a serial number) is incomplete here: checking
    // it would report a problem with a value nobody has produced yet.
    if (property.failed || property.pendingSystemFields.length > 0) {
      failedProperties.add(`${key}:${property.target.property}`);
    }
  }
  const document: DesignDocument = resolution.document;
  for (const page of document.pages) {
    for (const object of page.objects) {
      const properties = bound.get(object.id);
      if (!properties || !isVisible(page, object)) continue;
      yield {
        page,
        object,
        properties,
        failed: (property: string) => failedProperties.has(`${object.id}:${property}`),
      };
    }
  }
}

/**
 * OBJECT layer: object-specific validation of resolved values. Only printed (visible) objects
 * with data-bound values are checked, and properties whose resolution already failed are not
 * reported twice.
 */
export function checkResolvedObjects(
  resolution: DocumentResolution,
  options: ObjectCheckOptions = {},
): DataIssue[] {
  const issues: DataIssue[] = [];
  const push = (
    code: DataIssue['code'],
    severity: DataIssue['severity'],
    target: DataIssueTarget,
    message: string,
  ) => issues.push({ layer: 'OBJECT', code, severity, message, field: null, target });

  for (const { page, object, properties, failed } of boundVisibleObjects(resolution)) {
    const label = object.name || object.id;
    switch (object.type) {
      case 'barcode': {
        if (!properties.has('value') || failed('value')) break;
        const result = validateBarcodeValue(object.symbology, object.value);
        if (!result.valid) {
          push(
            'BARCODE_VALUE_INVALID',
            'ERROR',
            targetOf(page, object, 'value'),
            `${label}: ${result.issues[0]?.message ?? 'invalid barcode value'} ("${object.value}")`,
          );
        }
        break;
      }
      case 'qrCode': {
        if (!properties.has('value') || failed('value')) break;
        const result = validateQrValue(object.value, object.errorCorrection);
        if (!result.valid) {
          push(
            'QR_VALUE_INVALID',
            'ERROR',
            targetOf(page, object, 'value'),
            `${label}: ${result.issues[0]?.message ?? 'invalid QR code value'}`,
          );
        }
        break;
      }
      case 'image': {
        if (!properties.has('assetId') || failed('assetId')) break;
        if (object.assetId === null) {
          push(
            'IMAGE_SOURCE_MISSING',
            'WARNING',
            targetOf(page, object, 'assetId'),
            `${label}: no image for this record`,
          );
        } else if (options.assetAvailability?.(object.assetId) === 'UNAVAILABLE') {
          push(
            'IMAGE_ASSET_UNAVAILABLE',
            'ERROR',
            targetOf(page, object, 'assetId'),
            `${label}: image asset ${object.assetId} is not available in this organization`,
          );
        }
        break;
      }
      case 'text':
      case 'rectangle':
      case 'ellipse':
      case 'line':
        break;
    }
  }
  return issues;
}

/**
 * LAYOUT layer: display warnings on resolved text. Real data is often longer than the sample, so
 * every printed data-bound text is laid out with the production font metrics; text that does not
 * fit (even after shrink-to-fit) is reported, never silently truncated.
 */
export function checkResolvedLayout(
  resolution: DocumentResolution,
  textLayout: TextLayoutProbe,
): DataIssue[] {
  const issues: DataIssue[] = [];
  for (const { page, object, properties, failed } of boundVisibleObjects(resolution)) {
    if (object.type !== 'text' || !properties.has('content') || failed('content')) continue;
    const layout = textLayout.layout(object);
    const label = object.name || object.id;
    const target = targetOf(page, object, 'content');
    if (layout.overflow) {
      issues.push({
        layer: 'LAYOUT',
        code: 'TEXT_OVERFLOW',
        severity: 'WARNING',
        field: null,
        target,
        message:
          object.overflow.mode === 'SHRINK_TO_FIT'
            ? `${label}: the text does not fit its frame even at the minimum size of ${object.overflow.minFontSize} pt`
            : `${label}: the text does not fit its frame${object.overflow.mode === 'CLIP' ? ' and is clipped' : ''}`,
      });
    }
    if (layout.missingGlyphs.length > 0) {
      issues.push({
        layer: 'LAYOUT',
        code: 'MISSING_GLYPHS',
        severity: 'WARNING',
        field: null,
        target,
        message: `${label}: the font has no glyphs for ${layout.missingGlyphs.join(' ')}`,
      });
    }
  }
  return issues;
}
