/**
 * @smarttag/object-storage
 *
 * Vendor-neutral object storage used by the API and the worker: the ObjectStorage contract, the
 * local filesystem (development/test) and S3-compatible drivers, and the platform's key layout.
 * Database records store only opaque keys.
 */
export * from './environment';
export * from './factory';
export * from './local-filesystem.storage';
export * from './object-storage';
export * from './s3.storage';
