import {
  getRotatedBounds,
  type ArtworkObject,
  type DesignDocument,
  type Page,
  type Rect,
} from '@smarttag/document-schema';

export class EditorCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditorCommandError';
  }
}

export function findPage(document: DesignDocument, pageId: string): Page {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    throw new EditorCommandError(`Page "${pageId}" does not exist`);
  }
  return page;
}

export function findObject(page: Page, objectId: string): ArtworkObject | undefined {
  return page.objects.find((object) => object.id === objectId);
}

/**
 * Replaces one page immutably. Unchanged pages and objects keep their identity (structural
 * sharing), which keeps history snapshots cheap and lets renderers skip untouched objects.
 */
export function withPage(
  document: DesignDocument,
  pageId: string,
  update: (page: Page) => Page,
): DesignDocument {
  let changed = false;
  const pages = document.pages.map((page) => {
    if (page.id !== pageId) return page;
    const next = update(page);
    changed = next !== page;
    return next;
  });
  return changed ? { ...document, pages } : document;
}

/** Applies `update` to the given objects of a page; returns the same document when nothing changed. */
export function withObjects(
  document: DesignDocument,
  pageId: string,
  ids: Iterable<string>,
  update: (object: ArtworkObject) => ArtworkObject,
): DesignDocument {
  const targets = new Set(ids);
  return withPage(document, pageId, (page) => {
    let changed = false;
    const objects = page.objects.map((object) => {
      if (!targets.has(object.id)) return object;
      const next = update(object);
      if (next !== object) changed = true;
      return next;
    });
    return changed ? { ...page, objects } : page;
  });
}

/** Group lock/visibility make member objects locked/hidden too. */
export function isEffectivelyLocked(page: Page, object: ArtworkObject): boolean {
  if (object.locked) return true;
  if (object.groupId === null) return false;
  return page.groups.find((group) => group.id === object.groupId)?.locked ?? false;
}

export function isEffectivelyVisible(page: Page, object: ArtworkObject): boolean {
  if (!object.visible) return false;
  if (object.groupId === null) return true;
  return page.groups.find((group) => group.id === object.groupId)?.visible ?? true;
}

/** Axis-aligned bounds of several objects (rotation included). */
export function unionBounds(objects: readonly ArtworkObject[]): Rect | null {
  if (objects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const object of objects) {
    const bounds = getRotatedBounds(object);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Objects of a page in paint order (zIndex, then array order) — bottom first. */
export function paintOrder(page: Page): ArtworkObject[] {
  return page.objects
    .map((object, index) => ({ object, index }))
    .sort((a, b) => a.object.zIndex - b.object.zIndex || a.index - b.index)
    .map(({ object }) => object);
}

export function allElementIds(document: DesignDocument): Set<string> {
  const ids = new Set<string>();
  for (const feature of document.dimensions.dieline.features) ids.add(feature.id);
  for (const page of document.pages) {
    ids.add(page.id);
    for (const group of page.groups) ids.add(group.id);
    for (const object of page.objects) ids.add(object.id);
  }
  return ids;
}
