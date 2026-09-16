/**
 * @smarttag/production-processing
 *
 * Background processing of production jobs, shared by the worker (BullMQ job handlers) and the API
 * integration tests:
 *
 *   processExpandJob   expand a finalized dataset version into ordered production instances and
 *                      validate every one of them through the Phase 3 engine
 *   processReleaseJob  finish a released job: serial numbers, instance hashes, the ordered digest,
 *                      the job hash and the stored manifest
 *
 * Neither job ever allocates serial numbers: the range is reserved in the release transaction, so
 * previews and re-expansions can never burn numbers.
 */
export * from './config';
export { markFailed, processExpandJob } from './expand';
export { processReleaseJob } from './release';
export * from './summary';
export * from './support';
