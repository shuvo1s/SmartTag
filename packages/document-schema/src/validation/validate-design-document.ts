import type { z } from 'zod';
import { DesignDocumentSchema, type DesignDocument } from '../document';
import { BINDING_MODES } from '../bindings';
import { OBJECT_BINDABLE_PROPERTIES, isArtworkObjectType } from '../objects';
import { CURRENT_SCHEMA_VERSION, MINIMUM_SUPPORTED_SCHEMA_VERSION } from '../version';
import {
  IssueCollector,
  formatIssuePath,
  type DocumentIssuePath,
  type DocumentValidationIssue,
} from './issues';
import { runSemanticChecks } from './semantic-checks';

export type DocumentValidationResult =
  | {
      readonly valid: true;
      readonly document: DesignDocument;
      readonly errors: readonly [];
      readonly warnings: readonly DocumentValidationIssue[];
    }
  | {
      readonly valid: false;
      readonly document: null;
      readonly errors: readonly DocumentValidationIssue[];
      readonly warnings: readonly DocumentValidationIssue[];
    };

/**
 * Validates an untrusted value (typically parsed JSON from the database, an API request or a file)
 * against the CURRENT canonical schema.
 *
 * Nothing may reach a renderer, a VDP job or persistence without passing this function.
 * Older documents must first be upgraded with `migrateDesignDocument` (or use `parseDesignDocument`).
 *
 * Stages:
 *   1. envelope      — is it an object with a supported schemaVersion?
 *   2. object types  — unknown artwork types, binding modes and non-bindable properties are
 *                      reported precisely instead of as union noise
 *   3. structure     — strict Zod schema (no unknown keys, correct types and ranges)
 *   4. semantics     — ids, references, bindings, geometry
 */
export function validateDesignDocument(input: unknown): DocumentValidationResult {
  const issues = new IssueCollector();

  if (!isPlainObject(input)) {
    issues.error('INVALID_STRUCTURE', [], 'Design document must be a JSON object');
    return invalid(issues);
  }

  const { schemaVersion } = input;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    issues.error(
      'INVALID_STRUCTURE',
      ['schemaVersion'],
      'schemaVersion must be a positive integer',
    );
    return invalid(issues);
  }
  if (schemaVersion > CURRENT_SCHEMA_VERSION || schemaVersion < MINIMUM_SUPPORTED_SCHEMA_VERSION) {
    issues.error(
      'UNSUPPORTED_SCHEMA_VERSION',
      ['schemaVersion'],
      `Schema version ${schemaVersion} is not supported (supported: ${MINIMUM_SUPPORTED_SCHEMA_VERSION}–${CURRENT_SCHEMA_VERSION})`,
    );
    return invalid(issues);
  }
  if (schemaVersion < CURRENT_SCHEMA_VERSION) {
    issues.error(
      'SCHEMA_MIGRATION_REQUIRED',
      ['schemaVersion'],
      `Schema version ${schemaVersion} must be migrated to ${CURRENT_SCHEMA_VERSION} before validation`,
    );
    return invalid(issues);
  }

  const reportedPaths = [
    ...reportUnsupportedObjectTypes(input, issues),
    ...reportInvalidBindings(input, issues),
  ];
  const alreadyReported = (path: DocumentIssuePath) =>
    reportedPaths.some((prefix) => startsWith(path, prefix));

  const parsed = DesignDocumentSchema.safeParse(input);
  if (!parsed.success) {
    for (const zodIssue of parsed.error.issues) {
      const path = normalizePath(zodIssue.path);
      if (
        alreadyReported(path) ||
        (zodIssue.code === 'unrecognized_keys' &&
          zodIssue.keys.every((key) => alreadyReported([...path, key])))
      ) {
        continue; // already reported precisely (unsupported object type, binding mode or property)
      }
      issues.error('INVALID_STRUCTURE', path, describeZodIssue(zodIssue, path));
    }
    return invalid(issues);
  }
  if (issues.errors.length > 0) {
    return invalid(issues);
  }

  runSemanticChecks(parsed.data, issues);
  if (issues.errors.length > 0) {
    return invalid(issues);
  }
  return { valid: true, document: parsed.data, errors: [], warnings: issues.warnings };
}

export class DesignDocumentValidationError extends Error {
  constructor(readonly errors: readonly DocumentValidationIssue[]) {
    super(
      `Invalid design document: ${errors
        .slice(0, 5)
        .map(
          (issue) =>
            `${issue.code} at ${formatIssuePath(issue.path) || '<root>'}: ${issue.message}`,
        )
        .join('; ')}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ''}`,
    );
    this.name = 'DesignDocumentValidationError';
  }
}

/** Throwing variant for trusted code paths (fixtures, tests, internal builders). */
export function assertValidDesignDocument(input: unknown): DesignDocument {
  const result = validateDesignDocument(input);
  if (!result.valid) {
    throw new DesignDocumentValidationError(result.errors);
  }
  return result.document;
}

function reportUnsupportedObjectTypes(
  input: Record<string, unknown>,
  issues: IssueCollector,
): DocumentIssuePath[] {
  const paths: DocumentIssuePath[] = [];
  if (!Array.isArray(input.pages)) {
    return paths;
  }
  input.pages.forEach((page: unknown, pageIndex) => {
    if (!isPlainObject(page) || !Array.isArray(page.objects)) {
      return;
    }
    page.objects.forEach((object: unknown, objectIndex) => {
      if (!isPlainObject(object) || typeof object.type !== 'string') {
        return;
      }
      if (!isArtworkObjectType(object.type)) {
        const path = ['pages', pageIndex, 'objects', objectIndex];
        paths.push(path);
        issues.error(
          'UNSUPPORTED_OBJECT_TYPE',
          [...path, 'type'],
          `Artwork object type "${object.type}" is not supported`,
        );
      }
    });
  });
  return paths;
}

/**
 * Bindings on properties that cannot be bound, and binding modes this schema version does not
 * know, get precise issues (and their Zod noise is suppressed).
 */
function reportInvalidBindings(
  input: Record<string, unknown>,
  issues: IssueCollector,
): DocumentIssuePath[] {
  const paths: DocumentIssuePath[] = [];
  if (!Array.isArray(input.pages)) return paths;
  input.pages.forEach((page: unknown, pageIndex) => {
    if (!isPlainObject(page) || !Array.isArray(page.objects)) return;
    page.objects.forEach((object: unknown, objectIndex) => {
      if (
        !isPlainObject(object) ||
        !isArtworkObjectType(object.type) ||
        !isPlainObject(object.bindings)
      ) {
        return;
      }
      const bindable: Readonly<Record<string, unknown>> = OBJECT_BINDABLE_PROPERTIES[object.type];
      for (const [property, binding] of Object.entries(object.bindings)) {
        const path = ['pages', pageIndex, 'objects', objectIndex, 'bindings', property];
        if (!Object.hasOwn(bindable, property)) {
          paths.push(path);
          issues.error(
            'INVALID_PROPERTY_BINDING',
            path,
            `Property "${property}" of a ${object.type} object cannot be bound to data`,
          );
        } else if (
          isPlainObject(binding) &&
          typeof binding.mode === 'string' &&
          !(BINDING_MODES as readonly string[]).includes(binding.mode)
        ) {
          paths.push(path);
          issues.error(
            'UNKNOWN_BINDING_MODE',
            [...path, 'mode'],
            `Binding mode "${binding.mode}" is not supported (supported: ${BINDING_MODES.join(', ')})`,
          );
        }
      }
    });
  });
  return paths;
}

function describeZodIssue(issue: z.core.$ZodIssue, path: DocumentIssuePath): string {
  const location = formatIssuePath(path) || '<root>';
  if (issue.code === 'unrecognized_keys') {
    return `Unknown propert${issue.keys.length === 1 ? 'y' : 'ies'} ${issue.keys.map((key) => `"${key}"`).join(', ')} at ${location}`;
  }
  return `${issue.message} at ${location}`;
}

function normalizePath(path: readonly PropertyKey[]): (string | number)[] {
  return path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment));
}

function startsWith(path: DocumentIssuePath, prefix: DocumentIssuePath): boolean {
  return prefix.length <= path.length && prefix.every((segment, i) => path[i] === segment);
}

function invalid(issues: IssueCollector): DocumentValidationResult {
  return { valid: false, document: null, errors: issues.errors, warnings: issues.warnings };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
