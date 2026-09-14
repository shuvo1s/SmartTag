import type { DocumentMigration, JsonObject } from './migrator';

/**
 * Schema v1 → v2 (Phase 2 — controlled fonts).
 *
 * Every text object gains:
 * - `fontAssetId: null` — v1 identified fonts only by family name, so no exact font file is known.
 *   A migration cannot pick one (font assets belong to an organization); editors and preflight
 *   report TEXT_FONT_NOT_CONTROLLED until a controlled font is assigned.
 * - `wrap: "NONE"` — v1 laid out explicit line breaks only; NONE preserves that meaning exactly.
 *
 * Nothing else changes. The migrator hands this function a deep copy, so input is never mutated.
 */
export const migrateV1ToV2: DocumentMigration = {
  fromVersion: 1,
  toVersion: 2,
  description: 'v1→v2: text objects gain fontAssetId (null) and wrap (NONE)',
  migrate(document: JsonObject): JsonObject {
    const pages: unknown[] = Array.isArray(document.pages) ? document.pages : [];
    return {
      ...document,
      schemaVersion: 2,
      pages: pages.map((page) => {
        if (!isObject(page) || !Array.isArray(page.objects)) {
          return page;
        }
        const objects: unknown[] = page.objects;
        return {
          ...page,
          objects: objects.map((object) =>
            isObject(object) && object.type === 'text' ? addTextKeys(object) : object,
          ),
        };
      }),
    };
  },
};

function addTextKeys(object: JsonObject): JsonObject {
  // Rebuild the object so the new keys sit next to related properties. Key order does not affect
  // the canonical hash (RFC 8785 sorts keys) but keeps stored JSON readable.
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(object)) {
    if (key === 'fontFamily' && !('fontAssetId' in object)) {
      result.fontAssetId = null;
    }
    if (key === 'overflow' && !('wrap' in object)) {
      result.wrap = 'NONE';
    }
    result[key] = value;
  }
  if (!('fontAssetId' in result)) result.fontAssetId = null;
  if (!('wrap' in result)) result.wrap = 'NONE';
  return result;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
