import {
  GEOMETRY_EPSILON_PT,
  getBleedBox,
  getRotatedBounds,
  getSafeBox,
  getTrimBox,
  rectContainsRect,
  rectsIntersect,
  type ArtworkObject,
  type DocumentDimensions,
} from '@smarttag/document-schema';

/**
 * Where an object sits relative to the production boxes (rotated bounds):
 * - INSIDE_SAFE: fully inside the safe area
 * - INSIDE_TRIM: inside the finished piece but crossing the safe margin
 * - INSIDE_BLEED: extends past the trim edge into the bleed (intentional for backgrounds)
 * - BEYOND_BLEED: partly outside the bleed box (that part is never printed)
 * - OUTSIDE_BLEED: completely outside the bleed box (not printed at all)
 */
export type Placement =
  'INSIDE_SAFE' | 'INSIDE_TRIM' | 'INSIDE_BLEED' | 'BEYOND_BLEED' | 'OUTSIDE_BLEED';

export function classifyPlacement(
  object: ArtworkObject,
  dimensions: DocumentDimensions,
): Placement {
  const bounds = getRotatedBounds(object);
  const bleed = getBleedBox(dimensions);
  if (!rectsIntersect(bounds, bleed)) return 'OUTSIDE_BLEED';
  if (!rectContainsRect(bleed, bounds, GEOMETRY_EPSILON_PT)) return 'BEYOND_BLEED';
  if (!rectContainsRect(getTrimBox(dimensions), bounds, GEOMETRY_EPSILON_PT)) return 'INSIDE_BLEED';
  if (!rectContainsRect(getSafeBox(dimensions), bounds, GEOMETRY_EPSILON_PT)) return 'INSIDE_TRIM';
  return 'INSIDE_SAFE';
}

/** Content that must stay readable/scannable after cutting. */
function isCriticalContent(object: ArtworkObject): boolean {
  return object.type === 'text' || object.type === 'barcode' || object.type === 'qrCode';
}

export interface PlacementWarning {
  readonly placement: Placement;
  readonly severity: 'warning' | 'info';
  readonly message: string;
}

/**
 * Provisional editor guidance (full preflight arrives later). Backgrounds bleeding off the edge are
 * expected; critical content crossing the safe margin or trim is not.
 */
export function placementWarning(
  object: ArtworkObject,
  dimensions: DocumentDimensions,
): PlacementWarning | null {
  const placement = classifyPlacement(object, dimensions);
  switch (placement) {
    case 'INSIDE_SAFE':
      return null;
    case 'INSIDE_TRIM':
      return isCriticalContent(object)
        ? {
            placement,
            severity: 'warning',
            message: 'Crosses the safe area; it may be cut or look crowded',
          }
        : null;
    case 'INSIDE_BLEED':
      return isCriticalContent(object)
        ? {
            placement,
            severity: 'warning',
            message: 'Extends past the trim edge and will be cut off',
          }
        : { placement, severity: 'info', message: 'Extends into the bleed' };
    case 'BEYOND_BLEED':
      return {
        placement,
        severity: 'warning',
        message: 'Partly outside the bleed area; that part will not print',
      };
    case 'OUTSIDE_BLEED':
      return {
        placement,
        severity: 'warning',
        message: 'Completely outside the bleed area; it will not print',
      };
  }
}
