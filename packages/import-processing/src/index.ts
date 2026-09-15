/**
 * @smarttag/import-processing
 *
 * Background processing of data imports, shared by the worker (BullMQ job handlers) and the API
 * integration tests:
 *
 *   processInspectJob   read the stored upload once: sheets, preview, counts, detected settings
 *   processValidateJob  stream rows through the import-core row pipeline (Phase 3 engine) into a
 *                       DRAFT dataset version, in batches, with progress
 *   cleanupDataImports  remove half-finished uploads, fail stalled jobs, cancel abandoned imports
 */
export * from './cleanup';
export * from './config';
export {
  asObject,
  markFailed,
  processInspectJob,
  type ImportProcessingDeps,
  type JobOutcome,
} from './inspect';
export * from './summary';
export * from './support';
export { processValidateJob } from './validate';
