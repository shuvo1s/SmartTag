/**
 * @smarttag/data-core
 *
 * The variable-data domain shared by the designer, the API, CSV/Excel imports and (later) VDP
 * workers and ERP/PLM/MES integrations:
 *
 *   data record ──validateDataRecord──▶ normalized record ──resolveDocumentBindings──▶ resolved
 *   artwork ──checkResolvedObjects / checkResolvedLayout──▶ structured issues
 *
 * It works on the canonical DesignDocument only; it knows nothing about Fabric.js, React, HTTP or
 * databases.
 */
export * from './asset-references';
export * from './hash';
export * from './issues';
export * from './limits';
export * from './normalize-value';
export * from './preview';
export * from './resolve';
export * from './resolved-checks';
export * from './sample-record';
export * from './schema-hash';
export * from './usages';
export * from './validate-record';
