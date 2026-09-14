import {
  ArtworkObjectSchema,
  MAX_LENGTH_PT,
  getRotatedBounds,
  getTrimBox,
  validateDesignDocument,
  type ArtworkObject,
  type DesignDocument,
  type DocumentDimensions,
  type DocumentValidationIssue,
  type Insets,
  type Page,
  type Rect,
} from '@smarttag/document-schema';
import {
  createElementId,
  lengthsEqual,
  normalizeLength,
  normalizeRotation,
  rotationsEqual,
} from '@smarttag/document-utils';
import {
  EditorCommandError,
  allElementIds,
  findPage,
  isEffectivelyLocked,
  paintOrder,
  unionBounds,
  withObjects,
  withPage,
} from './document-access';

/**
 * Editing commands: pure functions from one canonical document to the next.
 *
 * Rules shared by every command:
 * - values an operation changes are normalized to canonical precision; untouched values keep
 *   their exact stored representation (no drift on open/save)
 * - locked objects (or objects in locked groups) are never moved, resized, rotated or deleted
 * - the result is always a structurally valid document, otherwise the command throws
 */

export interface FrameChange {
  readonly id: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
}

/** Smallest frame size an editing operation may produce (≈ 0.035 mm). */
export const MIN_FRAME_SIZE_PT = 0.1;

const GEOMETRY_KEYS = new Set(['x', 'y', 'width', 'height', 'rotation']);

function clampCoordinate(value: number): number {
  return Math.min(MAX_LENGTH_PT, Math.max(-MAX_LENGTH_PT, value));
}

function nextLength(current: number, requested: number | undefined, minimum: number): number {
  if (requested === undefined || lengthsEqual(current, requested)) return current;
  return normalizeLength(Math.min(MAX_LENGTH_PT, Math.max(minimum, requested)));
}

function nextCoordinate(current: number, requested: number | undefined): number {
  if (requested === undefined || lengthsEqual(current, requested)) return current;
  return normalizeLength(clampCoordinate(requested));
}

/** Keeps dependent properties valid after a frame change. */
function applyFrameConstraints(before: ArtworkObject, after: ArtworkObject): ArtworkObject {
  switch (after.type) {
    case 'rectangle': {
      const maxRadius = Math.min(after.width, after.height) / 2;
      return after.cornerRadius > maxRadius
        ? { ...after, cornerRadius: Math.floor(maxRadius * 10_000) / 10_000 }
        : after;
    }
    case 'barcode': {
      if (before.type !== 'barcode' || lengthsEqual(before.height, after.height)) return after;
      // Bars keep their share of the frame so human-readable text keeps its room.
      const scaled = normalizeLength((before.barHeight * after.height) / before.height);
      return { ...after, barHeight: Math.min(Math.max(scaled, MIN_FRAME_SIZE_PT), after.height) };
    }
    case 'text':
    case 'image':
    case 'ellipse':
    case 'line':
    case 'qrCode':
      return after;
  }
}

export function setObjectFrames(
  document: DesignDocument,
  pageId: string,
  changes: readonly FrameChange[],
): DesignDocument {
  const page = findPage(document, pageId);
  const byId = new Map(changes.map((change) => [change.id, change]));
  return withObjects(document, pageId, byId.keys(), (object) => {
    const change = byId.get(object.id)!;
    if (isEffectivelyLocked(page, object)) return object;
    const minHeight = object.type === 'line' ? 0 : MIN_FRAME_SIZE_PT;
    const next = {
      ...object,
      x: nextCoordinate(object.x, change.x),
      y: nextCoordinate(object.y, change.y),
      width: nextLength(object.width, change.width, MIN_FRAME_SIZE_PT),
      height: nextLength(object.height, change.height, minHeight),
      rotation:
        change.rotation === undefined || rotationsEqual(object.rotation, change.rotation)
          ? object.rotation
          : normalizeRotation(change.rotation),
    };
    const unchanged =
      next.x === object.x &&
      next.y === object.y &&
      next.width === object.width &&
      next.height === object.height &&
      next.rotation === object.rotation;
    return unchanged ? object : applyFrameConstraints(object, next);
  });
}

export function moveObjects(
  document: DesignDocument,
  pageId: string,
  ids: readonly string[],
  dx: number,
  dy: number,
): DesignDocument {
  const page = findPage(document, pageId);
  const targets = new Set(ids);
  return setObjectFrames(
    document,
    pageId,
    page.objects
      .filter((object) => targets.has(object.id))
      .map((object) => ({ id: object.id, x: object.x + dx, y: object.y + dy })),
  );
}

/** Property edits from the properties panel. Geometry of locked objects cannot be changed. */
export function updateObject(
  document: DesignDocument,
  pageId: string,
  objectId: string,
  patch: Readonly<Record<string, unknown>>,
): DesignDocument {
  const page = findPage(document, pageId);
  const object = page.objects.find((candidate) => candidate.id === objectId);
  if (!object) {
    throw new EditorCommandError(`Object "${objectId}" does not exist on this page`);
  }
  if ('id' in patch || 'type' in patch) {
    throw new EditorCommandError('Object id and type cannot be changed');
  }
  const locked = isEffectivelyLocked(page, object);
  if (locked && Object.keys(patch).some((key) => GEOMETRY_KEYS.has(key))) {
    throw new EditorCommandError('Unlock the object before changing its position or size');
  }

  const geometry: Partial<FrameChange> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (GEOMETRY_KEYS.has(key) && typeof value === 'number') {
      (geometry as Record<string, number>)[key] = value;
    } else {
      rest[key] = value;
    }
  }

  let working: DesignDocument = document;
  if (Object.keys(geometry).length > 0) {
    working = setObjectFrames(working, pageId, [{ id: objectId, ...geometry }]);
  }
  if (Object.keys(rest).length === 0) return working;

  return withObjects(working, pageId, [objectId], (current) => {
    const merged = constrainProperties({ ...current, ...rest });
    const parsed = ArtworkObjectSchema.safeParse(merged);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new EditorCommandError(
        `Invalid value for ${issue?.path.join('.') || 'object'}: ${issue?.message ?? 'invalid'}`,
      );
    }
    return merged;
  });
}

function constrainProperties(object: ArtworkObject): ArtworkObject {
  switch (object.type) {
    case 'text':
      if (
        object.overflow.mode === 'SHRINK_TO_FIT' &&
        object.overflow.minFontSize > object.fontSize
      ) {
        return { ...object, overflow: { mode: 'SHRINK_TO_FIT', minFontSize: object.fontSize } };
      }
      return object;
    case 'rectangle':
      return applyFrameConstraints(object, object);
    case 'barcode':
      return object.barHeight > object.height ? { ...object, barHeight: object.height } : object;
    case 'image':
    case 'ellipse':
    case 'line':
    case 'qrCode':
      return object;
  }
}

function topZIndex(page: Page): number {
  return page.objects.reduce((max, object) => Math.max(max, object.zIndex), -1);
}

/** Adds objects on top of the page. Ids must be unique in the document. */
export function addObjects(
  document: DesignDocument,
  pageId: string,
  objects: readonly ArtworkObject[],
): DesignDocument {
  const existing = allElementIds(document);
  return withPage(document, pageId, (page) => {
    let zIndex = topZIndex(page);
    const added = objects.map((object) => {
      if (existing.has(object.id)) {
        throw new EditorCommandError(`Element id "${object.id}" already exists`);
      }
      existing.add(object.id);
      zIndex += 1;
      return { ...object, zIndex };
    });
    return { ...page, objects: [...page.objects, ...added] };
  });
}

export interface DeleteResult {
  readonly document: DesignDocument;
  readonly deletedIds: readonly string[];
  readonly skippedLockedIds: readonly string[];
}

export function deleteObjects(
  document: DesignDocument,
  pageId: string,
  ids: readonly string[],
): DeleteResult {
  const page = findPage(document, pageId);
  const targets = new Set(ids);
  const deletedIds: string[] = [];
  const skippedLockedIds: string[] = [];
  const objects = page.objects.filter((object) => {
    if (!targets.has(object.id)) return true;
    if (isEffectivelyLocked(page, object)) {
      skippedLockedIds.push(object.id);
      return true;
    }
    deletedIds.push(object.id);
    return false;
  });
  if (deletedIds.length === 0) {
    return { document, deletedIds, skippedLockedIds };
  }
  return {
    document: withPage(document, pageId, (current) => ({ ...current, objects })),
    deletedIds,
    skippedLockedIds,
  };
}

const ID_PREFIX: Readonly<Record<ArtworkObject['type'], string>> = {
  text: 'txt',
  image: 'img',
  rectangle: 'rect',
  ellipse: 'ell',
  line: 'line',
  barcode: 'bc',
  qrCode: 'qr',
};

export function newObjectId(type: ArtworkObject['type']): string {
  return createElementId(ID_PREFIX[type]);
}

/**
 * Deep-copies objects with NEW stable ids, offset by (dx, dy). Copies are unlocked so they can be
 * positioned; bindings, names and appearance are preserved. Groups are not copied (group ids are
 * page-scoped), so copies are ungrouped.
 */
export function cloneObjects(
  objects: readonly ArtworkObject[],
  dx: number,
  dy: number,
): ArtworkObject[] {
  return objects.map((object) => {
    const copy = JSON.parse(JSON.stringify(object)) as ArtworkObject;
    return {
      ...copy,
      id: newObjectId(object.type),
      x: normalizeLength(clampCoordinate(object.x + dx)),
      y: normalizeLength(clampCoordinate(object.y + dy)),
      locked: false,
      groupId: null,
    };
  });
}

export interface InsertResult {
  readonly document: DesignDocument;
  readonly insertedIds: readonly string[];
}

/** Duplicate (Ctrl/Cmd+D): copies in paint order, above everything, slightly offset. */
export function duplicateObjects(
  document: DesignDocument,
  pageId: string,
  ids: readonly string[],
  offset: number,
): InsertResult {
  const page = findPage(document, pageId);
  const targets = new Set(ids);
  const sources = paintOrder(page).filter((object) => targets.has(object.id));
  const copies = cloneObjects(sources, offset, offset);
  return {
    document: addObjects(document, pageId, copies),
    insertedIds: copies.map((copy) => copy.id),
  };
}

/** Paste from the editor clipboard onto any page (cross-page ready). */
export function pasteObjects(
  document: DesignDocument,
  pageId: string,
  clipboard: readonly ArtworkObject[],
  offset: number,
): InsertResult {
  const copies = cloneObjects(
    [...clipboard].sort((a, b) => a.zIndex - b.zIndex),
    offset,
    offset,
  );
  return {
    document: addObjects(document, pageId, copies),
    insertedIds: copies.map((copy) => copy.id),
  };
}

export type ReorderOperation = 'FORWARD' | 'BACKWARD' | 'FRONT' | 'BACK';

/**
 * Layer order is canonical `zIndex`. After any reorder the page is renumbered densely (0…n-1)
 * and the objects array is sorted into paint order, so there is exactly one ordering state.
 */
export function reorderObjects(
  document: DesignDocument,
  pageId: string,
  ids: readonly string[],
  operation: ReorderOperation,
): DesignDocument {
  const page = findPage(document, pageId);
  const targets = new Set(ids);
  const order = paintOrder(page);
  let next: ArtworkObject[];
  switch (operation) {
    case 'FRONT':
      next = [
        ...order.filter((object) => !targets.has(object.id)),
        ...order.filter((object) => targets.has(object.id)),
      ];
      break;
    case 'BACK':
      next = [
        ...order.filter((object) => targets.has(object.id)),
        ...order.filter((object) => !targets.has(object.id)),
      ];
      break;
    case 'FORWARD':
      next = [...order];
      for (let index = next.length - 2; index >= 0; index -= 1) {
        if (targets.has(next[index]!.id) && !targets.has(next[index + 1]!.id)) {
          [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
        }
      }
      break;
    case 'BACKWARD':
      next = [...order];
      for (let index = 1; index < next.length; index += 1) {
        if (targets.has(next[index]!.id) && !targets.has(next[index - 1]!.id)) {
          [next[index], next[index - 1]] = [next[index - 1]!, next[index]!];
        }
      }
      break;
  }
  return applyPaintOrder(document, page, next);
}

/** Moves one object to a paint-order position (0 = bottom), e.g. from a layers drag. */
export function moveObjectToLayerIndex(
  document: DesignDocument,
  pageId: string,
  objectId: string,
  targetIndex: number,
): DesignDocument {
  const page = findPage(document, pageId);
  const order = paintOrder(page);
  const from = order.findIndex((object) => object.id === objectId);
  if (from < 0) {
    throw new EditorCommandError(`Object "${objectId}" does not exist on this page`);
  }
  const [moved] = order.splice(from, 1);
  order.splice(Math.max(0, Math.min(order.length, targetIndex)), 0, moved!);
  return applyPaintOrder(document, page, order);
}

function applyPaintOrder(
  document: DesignDocument,
  page: Page,
  order: readonly ArtworkObject[],
): DesignDocument {
  const current = paintOrder(page);
  const unchangedOrder = order.every((object, index) => object === current[index]);
  const alreadyDense = current.every((object, index) => object.zIndex === index);
  const arraySorted = page.objects.every((object, index) => object === current[index]);
  if (unchangedOrder && alreadyDense && arraySorted) {
    return document;
  }
  const objects = order.map((object, index) =>
    object.zIndex === index ? object : { ...object, zIndex: index },
  );
  return withPage(document, page.id, (target) => ({ ...target, objects }));
}

export type AlignMode = 'LEFT' | 'HCENTER' | 'RIGHT' | 'TOP' | 'VCENTER' | 'BOTTOM';

/**
 * Aligns the rotated bounding boxes of the objects. Several objects align to their combined
 * bounds; a single object aligns to the trim box. Locked objects stay where they are (and still
 * define the reference bounds).
 */
export function alignObjects(
  document: DesignDocument,
  pageId: string,
  ids: readonly string[],
  mode: AlignMode,
): DesignDocument {
  const page = findPage(document, pageId);
  const targets = new Set(ids);
  const objects = page.objects.filter((object) => targets.has(object.id));
  if (objects.length === 0) return document;
  const reference: Rect =
    objects.length === 1 ? getTrimBox(document.dimensions) : unionBounds(objects)!;

  const changes: FrameChange[] = objects.map((object) => {
    const bounds = getRotatedBounds(object);
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'LEFT':
        dx = reference.x - bounds.x;
        break;
      case 'HCENTER':
        dx = reference.x + reference.width / 2 - (bounds.x + bounds.width / 2);
        break;
      case 'RIGHT':
        dx = reference.x + reference.width - (bounds.x + bounds.width);
        break;
      case 'TOP':
        dy = reference.y - bounds.y;
        break;
      case 'VCENTER':
        dy = reference.y + reference.height / 2 - (bounds.y + bounds.height / 2);
        break;
      case 'BOTTOM':
        dy = reference.y + reference.height - (bounds.y + bounds.height);
        break;
    }
    return { id: object.id, x: object.x + dx, y: object.y + dy };
  });
  return setObjectFrames(document, pageId, changes);
}

/**
 * Distributes three or more objects so the gaps between their rotated bounding boxes are equal.
 * The outermost objects stay in place.
 */
export function distributeObjects(
  document: DesignDocument,
  pageId: string,
  ids: readonly string[],
  axis: 'HORIZONTAL' | 'VERTICAL',
): DesignDocument {
  const page = findPage(document, pageId);
  const targets = new Set(ids);
  const items = page.objects
    .filter((object) => targets.has(object.id))
    .map((object) => ({ object, bounds: getRotatedBounds(object) }));
  if (items.length < 3) return document;

  const horizontal = axis === 'HORIZONTAL';
  const start = (r: Rect) => (horizontal ? r.x : r.y);
  const size = (r: Rect) => (horizontal ? r.width : r.height);
  items.sort((a, b) => start(a.bounds) - start(b.bounds));

  const first = items[0]!.bounds;
  const last = items[items.length - 1]!.bounds;
  const span = start(last) + size(last) - start(first);
  const occupied = items.reduce((total, item) => total + size(item.bounds), 0);
  const gap = (span - occupied) / (items.length - 1);

  let cursor = start(first);
  const changes: FrameChange[] = items.map(({ object, bounds }) => {
    const delta = cursor - start(bounds);
    cursor += size(bounds) + gap;
    return horizontal
      ? { id: object.id, x: object.x + delta }
      : { id: object.id, y: object.y + delta };
  });
  return setObjectFrames(document, pageId, changes);
}

export function setObjectsVisible(
  document: DesignDocument,
  pageId: string,
  ids: readonly string[],
  visible: boolean,
): DesignDocument {
  return withObjects(document, pageId, ids, (object) =>
    object.visible === visible ? object : { ...object, visible },
  );
}

export function setObjectsLocked(
  document: DesignDocument,
  pageId: string,
  ids: readonly string[],
  locked: boolean,
): DesignDocument {
  return withObjects(document, pageId, ids, (object) =>
    object.locked === locked ? object : { ...object, locked },
  );
}

export function renameObject(
  document: DesignDocument,
  pageId: string,
  objectId: string,
  name: string,
): DesignDocument {
  const trimmed = name.trim().slice(0, 100);
  return withObjects(document, pageId, [objectId], (object) =>
    object.name === trimmed ? object : { ...object, name: trimmed },
  );
}

export class DocumentSettingsError extends EditorCommandError {
  constructor(readonly issues: readonly DocumentValidationIssue[]) {
    super(issues[0]?.message ?? 'Invalid document settings');
    this.name = 'DocumentSettingsError';
  }
}

export interface DimensionsPatch {
  readonly width?: number;
  readonly height?: number;
  readonly displayUnit?: DocumentDimensions['displayUnit'];
  readonly bleed?: Insets;
  readonly safeArea?: Insets;
  readonly margins?: Insets;
}

/**
 * Page settings. Artwork is deliberately NOT scaled when the size changes. Orientation follows
 * width/height. The candidate document must validate (e.g. punch holes must stay inside trim).
 */
export function updateDimensions(document: DesignDocument, patch: DimensionsPatch): DesignDocument {
  const current = document.dimensions;
  const normalizeInsets = (insets: Insets | undefined, fallback: Insets): Insets =>
    insets
      ? {
          top: nextLength(fallback.top, insets.top, 0),
          right: nextLength(fallback.right, insets.right, 0),
          bottom: nextLength(fallback.bottom, insets.bottom, 0),
          left: nextLength(fallback.left, insets.left, 0),
        }
      : fallback;
  const width = nextLength(current.width, patch.width, MIN_FRAME_SIZE_PT);
  const height = nextLength(current.height, patch.height, MIN_FRAME_SIZE_PT);
  const orientation =
    width > height ? 'LANDSCAPE' : height > width ? 'PORTRAIT' : current.orientation;
  const dimensions: DocumentDimensions = {
    ...current,
    width,
    height,
    orientation,
    displayUnit: patch.displayUnit ?? current.displayUnit,
    bleed: normalizeInsets(patch.bleed, current.bleed),
    safeArea: normalizeInsets(patch.safeArea, current.safeArea),
    margins: normalizeInsets(patch.margins, current.margins),
  };
  const candidate: DesignDocument = { ...document, dimensions };
  const result = validateDesignDocument(candidate);
  const settingsErrors = result.errors.filter((issue) => issue.path[0] === 'dimensions');
  if (settingsErrors.length > 0) {
    throw new DocumentSettingsError(settingsErrors);
  }
  return candidate;
}

export function setPageBackground(
  document: DesignDocument,
  pageId: string,
  background: Page['background'],
): DesignDocument {
  return withPage(document, pageId, (page) =>
    JSON.stringify(page.background) === JSON.stringify(background) ? page : { ...page, background },
  );
}
