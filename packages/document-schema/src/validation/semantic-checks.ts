import { isFieldTypeCompatible, type BindablePropertyKind, type PropertyBinding } from '../bindings';
import type { DataField } from '../data-schema';
import type { DesignDocument, Page } from '../document';
import {
  GEOMETRY_EPSILON_PT,
  getBleedBox,
  getRotatedBounds,
  getTrimBox,
  rectContainsPoint,
  rectContainsRect,
  rectsIntersect,
  type Rect,
} from '../geometry';
import { OBJECT_BINDABLE_PROPERTIES, type ArtworkObject } from '../objects';
import type { DocumentIssuePath, IssueCollector } from './issues';

/**
 * Semantic rules that a structurally valid document must also satisfy.
 * Structural shape is enforced by Zod; everything relational or geometric lives here.
 */
export function runSemanticChecks(document: DesignDocument, issues: IssueCollector): void {
  checkDimensions(document, issues);
  checkUniqueElementIds(document, issues);
  const fieldsByKey = checkDataSchema(document, issues);
  const bleedBox = getBleedBox(document.dimensions);

  document.pages.forEach((page, pageIndex) => {
    checkPage(page, ['pages', pageIndex], fieldsByKey, bleedBox, issues);
  });
}

function checkDimensions(document: DesignDocument, issues: IssueCollector): void {
  const { width, height, orientation, safeArea, margins, dieline } = document.dimensions;
  const path = ['dimensions'] as const;

  if (width > height && orientation !== 'LANDSCAPE') {
    issues.error('INVALID_GEOMETRY', [...path, 'orientation'], 'Width exceeds height; orientation must be LANDSCAPE');
  }
  if (height > width && orientation !== 'PORTRAIT') {
    issues.error('INVALID_GEOMETRY', [...path, 'orientation'], 'Height exceeds width; orientation must be PORTRAIT');
  }

  for (const [name, insets] of [
    ['safeArea', safeArea],
    ['margins', margins],
  ] as const) {
    if (insets.left + insets.right >= width || insets.top + insets.bottom >= height) {
      issues.error('INVALID_GEOMETRY', [...path, name], `${name} insets leave no usable area inside the trim box`);
    }
  }

  const trimBox = getTrimBox(document.dimensions);
  if (dieline.trimShape.cornerRadius > Math.min(width, height) / 2 + GEOMETRY_EPSILON_PT) {
    issues.error(
      'INVALID_GEOMETRY',
      [...path, 'dieline', 'trimShape', 'cornerRadius'],
      'Corner radius cannot exceed half of the shortest trim edge',
    );
  }

  dieline.features.forEach((feature, index) => {
    const featurePath = [...path, 'dieline', 'features', index];
    switch (feature.type) {
      case 'PUNCH_HOLE': {
        const r = feature.diameter / 2;
        const holeBox: Rect = { x: feature.center.x - r, y: feature.center.y - r, width: r * 2, height: r * 2 };
        if (!rectContainsRect(trimBox, holeBox)) {
          issues.error('INVALID_GEOMETRY', featurePath, 'Punch hole must lie entirely inside the trim box');
        }
        break;
      }
      case 'SLOT_HOLE':
        if (!rectContainsPoint(trimBox, feature.center)) {
          issues.error('INVALID_GEOMETRY', featurePath, 'Slot hole centre must lie inside the trim box');
        }
        break;
      case 'FOLD_LINE':
      case 'PERFORATION':
        if (!rectContainsPoint(trimBox, feature.start) || !rectContainsPoint(trimBox, feature.end)) {
          issues.error('INVALID_GEOMETRY', featurePath, 'Line features must start and end inside the trim box');
        }
        break;
      default:
        assertNever(feature);
    }
  });
}

function checkUniqueElementIds(document: DesignDocument, issues: IssueCollector): void {
  const seen = new Map<string, DocumentIssuePath>();
  const register = (id: string, path: DocumentIssuePath) => {
    const first = seen.get(id);
    if (first) {
      issues.error('DUPLICATE_ID', [...path, 'id'], `Element id "${id}" is not unique within the document`);
    } else {
      seen.set(id, path);
    }
  };

  document.dimensions.dieline.features.forEach((feature, i) =>
    register(feature.id, ['dimensions', 'dieline', 'features', i]),
  );
  document.pages.forEach((page, p) => {
    register(page.id, ['pages', p]);
    page.groups.forEach((group, g) => register(group.id, ['pages', p, 'groups', g]));
    page.objects.forEach((object, o) => register(object.id, ['pages', p, 'objects', o]));
  });
}

function checkDataSchema(document: DesignDocument, issues: IssueCollector): Map<string, DataField> {
  const fieldsByKey = new Map<string, DataField>();
  document.dataSchema.fields.forEach((field, index) => {
    if (fieldsByKey.has(field.key)) {
      issues.error(
        'DUPLICATE_FIELD_KEY',
        ['dataSchema', 'fields', index, 'key'],
        `Data field key "${field.key}" is defined more than once`,
      );
      return;
    }
    fieldsByKey.set(field.key, field);
  });
  return fieldsByKey;
}

function checkPage(
  page: Page,
  pagePath: DocumentIssuePath,
  fieldsByKey: ReadonlyMap<string, DataField>,
  bleedBox: Rect,
  issues: IssueCollector,
): void {
  const groupIds = new Set(page.groups.map((group) => group.id));
  const zIndexes = new Set<number>();

  page.objects.forEach((object, index) => {
    const objectPath = [...pagePath, 'objects', index];

    if (zIndexes.has(object.zIndex)) {
      issues.error('DUPLICATE_Z_INDEX', [...objectPath, 'zIndex'], `zIndex ${object.zIndex} is used by more than one object on page "${page.id}"`);
    }
    zIndexes.add(object.zIndex);

    if (object.groupId !== null && !groupIds.has(object.groupId)) {
      issues.error('UNKNOWN_GROUP_REFERENCE', [...objectPath, 'groupId'], `Group "${object.groupId}" does not exist on page "${page.id}"`);
    }

    checkBindings(object, objectPath, fieldsByKey, issues);
    checkObjectProperties(object, objectPath, issues);

    if (!rectsIntersect(getRotatedBounds(object), bleedBox)) {
      issues.warning('OBJECT_OUTSIDE_BLEED', objectPath, `Object "${object.id}" lies completely outside the bleed box and will not print`);
    }
  });
}

function checkBindings(
  object: ArtworkObject,
  objectPath: DocumentIssuePath,
  fieldsByKey: ReadonlyMap<string, DataField>,
  issues: IssueCollector,
): void {
  const properties: Readonly<Record<string, BindablePropertyKind>> = OBJECT_BINDABLE_PROPERTIES[object.type];
  const bindings = object.bindings as Readonly<Record<string, PropertyBinding>>;

  for (const [property, kind] of Object.entries(properties)) {
    const binding = bindings[property];
    if (binding?.mode !== 'FIELD') {
      continue;
    }
    const bindingPath = [...objectPath, 'bindings', property, 'field'];
    const field = fieldsByKey.get(binding.field);
    if (!field) {
      issues.error('UNKNOWN_BINDING_FIELD', bindingPath, `Property "${property}" is bound to unknown data field "${binding.field}"`);
    } else if (!isFieldTypeCompatible(kind, field.type)) {
      issues.error(
        'INCOMPATIBLE_BINDING',
        bindingPath,
        `Data field "${field.key}" of type "${field.type}" cannot be bound to "${property}" of a ${object.type} object`,
      );
    }
  }
}

function checkObjectProperties(object: ArtworkObject, path: DocumentIssuePath, issues: IssueCollector): void {
  switch (object.type) {
    case 'text':
      if (object.overflow.mode === 'SHRINK_TO_FIT' && object.overflow.minFontSize > object.fontSize) {
        issues.error('INVALID_PROPERTY', [...path, 'overflow', 'minFontSize'], 'Minimum font size cannot exceed the font size');
      }
      break;
    case 'image':
      if (object.crop && (object.crop.x + object.crop.width > 1 + 1e-9 || object.crop.y + object.crop.height > 1 + 1e-9)) {
        issues.error('INVALID_GEOMETRY', [...path, 'crop'], 'Crop rectangle must lie within the source image');
      }
      if (object.assetId === null && object.bindings.assetId.mode === 'STATIC') {
        issues.warning('IMAGE_SOURCE_MISSING', [...path, 'assetId'], `Image "${object.id}" has no asset and no data binding`);
      }
      break;
    case 'rectangle':
      if (object.cornerRadius > Math.min(object.width, object.height) / 2 + GEOMETRY_EPSILON_PT) {
        issues.error('INVALID_GEOMETRY', [...path, 'cornerRadius'], 'Corner radius cannot exceed half of the shortest side');
      }
      break;
    case 'barcode':
      if (object.barHeight > object.height + GEOMETRY_EPSILON_PT) {
        issues.error('INVALID_GEOMETRY', [...path, 'barHeight'], 'Bar height cannot exceed the object height');
      }
      break;
    case 'qrCode':
      if (Math.abs(object.width - object.height) > GEOMETRY_EPSILON_PT) {
        issues.warning('NON_SQUARE_QR_CODE', path, 'QR codes are square symbols; the frame should be square');
      }
      break;
    case 'ellipse':
    case 'line':
      break;
    default:
      assertNever(object);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
