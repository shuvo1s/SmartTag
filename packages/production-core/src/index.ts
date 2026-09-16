/**
 * @smarttag/production-core
 *
 * The production domain: how an approved template version and a finalized dataset version become
 * an exact, ordered, hashed set of tags.
 *
 *   configuration   what the job does (quantity, serials, record selection, mode)
 *   quantity        how many tags one record produces, checked value by value
 *   expansion       records → ordered production instances (deterministic, streamable)
 *   context         what one instance knows about itself (serial, position) as system fields
 *   instance        resolving one instance through the Phase 3 engine
 *   serials         deterministic formatting, ranges and previews
 *   hashing         instance hash, instances digest, job hash
 *   manifest        the machine-readable record of a released job, and its verification
 *   lifecycle       the job states and the transitions that are allowed
 *
 * Isomorphic: no database, no I/O, no framework. The API and the worker both use it, so the
 * browser can predict exactly what the server will produce.
 */
export * from './configuration';
export * from './context';
export * from './expansion';
export * from './hashing';
export * from './instance-pipeline';
export * from './issues';
export * from './job-number';
export * from './lifecycle';
export * from './limits';
export * from './manifest';
export * from './quantity';
export * from './serials';
