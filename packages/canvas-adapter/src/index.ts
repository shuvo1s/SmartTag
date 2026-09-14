/**
 * @smarttag/canvas-adapter
 *
 * The ONLY package that depends on Fabric.js. It mirrors the canonical DesignDocument (held by
 * the editor-core EditorStore) into an interactive Fabric canvas and turns finished gestures back
 * into editor commands. Fabric state is never persisted; saving always produces a canonical,
 * validated DesignDocument.
 */
export * from './artwork-object';
export * from './browser-services';
export * from './draw';
export * from './editor-canvas';
export * from './geometry';
export * from './overlays';
export * from './services';
