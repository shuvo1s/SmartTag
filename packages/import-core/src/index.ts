/**
 * @smarttag/import-core
 *
 * The tabular data import domain, shared by the API, the worker and the browser:
 *
 *   source (CSV/XLSX rows) ──mapping + parsing rules──▶ raw record
 *     ──Phase 3 data-core (validateDataRecord → resolveDocumentBindings → object checks)──▶
 *     normalized record + issues + hashes
 *
 * It contains no file parsers (@smarttag/tabular-sources), no I/O and no framework code, and it
 * never re-implements record validation: data-core stays the only variable-data validator.
 */
export * from './csv-template';
export * from './hashing';
export * from './issues';
export * from './lifecycle';
export * from './limits';
export * from './mapping';
export * from './normalize-cell';
export * from './parsing-rules';
export * from './profiles';
export * from './row-pipeline';
export * from './settings';
export * from './source';
export * from './suggestions';
