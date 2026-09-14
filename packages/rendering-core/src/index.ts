/**
 * @smarttag/rendering-core
 *
 * Canonical document → renderer-agnostic scene → output format. No React, no DOM, no canvas
 * library. The same scene feeds the browser preview today and server-side renderers later.
 */
export * from './build-page-scene';
export * from './color';
export * from './scene';
export * from './svg/render-scene-to-svg';
export { escapeXml, isSafeImageUrl } from './svg/xml';
export * from './text-layout';

/**
 * Version of the scene/serialization logic. Recorded with rendered outputs so that
 * TemplateVersion + Dataset + RendererVersion identifies a reproducible result.
 */
export const RENDERING_CORE_VERSION = '0.1.0';
