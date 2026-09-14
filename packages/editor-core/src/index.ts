/**
 * @smarttag/editor-core
 *
 * The framework-free model of the design editor. It operates exclusively on the canonical
 * DesignDocument and knows nothing about Fabric.js, React or the DOM, so every editing rule is
 * unit-testable and reusable by any canvas adapter.
 */
export * from './commands';
export * from './document-access';
export * from './editor-store';
export * from './history';
export * from './object-factory';
export * from './placement';
export * from './save-controller';
export * from './snapping';
export * from './viewport';
