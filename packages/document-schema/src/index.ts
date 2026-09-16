/**
 * @smarttag/document-schema
 *
 * The canonical, versioned DesignDocument format. This package is the single source of truth for
 * what a SmartTag design IS. It must remain independent of any UI framework, canvas library
 * (Fabric.js, Konva, …), renderer, database or runtime platform.
 */
export * from './bindings';
export * from './data-field-rules';
export * from './data-schema';
export * from './dimensions';
export * from './document';
export * from './document-type';
export * from './geometry';
export * from './migrations';
export * from './objects';
export * from './primitives';
export * from './system-fields';
export * from './validation/binding-checks';
export * from './validation/issues';
export {
  DesignDocumentValidationError,
  assertValidDesignDocument,
  validateDesignDocument,
  type DocumentValidationResult,
} from './validation/validate-design-document';
export * from './version';
