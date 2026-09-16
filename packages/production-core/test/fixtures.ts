import type { NormalizedDataRecord } from '@smarttag/data-core';
import { SYSTEM_FIELD_KEYS, type DesignDocument } from '@smarttag/document-schema';
import { createVariableDataHangTagDocument } from '@smarttag/document-utils/fixtures';
import type { ProductionContext } from '../src';

export const TEMPLATE_HASH = 'a'.repeat(64);
export const RECORD_HASH = 'b'.repeat(64);
export const DATASET_HASH = 'c'.repeat(64);
export const SCHEMA_HASH = 'd'.repeat(64);

export const RECORD: NormalizedDataRecord = {
  style: 'YT-2045',
  product_name: 'Premium Cotton Shirt',
  color: 'Navy',
  size: 'XL',
  price: '39.95',
  currency: 'USD',
  gtin: '9501234567891',
  country_of_origin: 'Bangladesh',
  product_url: 'https://example.com/products/YT-2045',
  is_sustainable: true,
  product_image: null,
};

export function vdpDocument(): DesignDocument {
  return createVariableDataHangTagDocument();
}

/** The hang tag with its SKU text bound to the serial number instead of the style field. */
export function documentWithSerialText(): DesignDocument {
  const document = vdpDocument();
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      objects: page.objects.map((object) =>
        object.id === 'vd-sku' && object.type === 'text'
          ? {
              ...object,
              bindings: {
                ...object.bindings,
                content: { mode: 'FIELD' as const, field: SYSTEM_FIELD_KEYS.SERIAL },
              },
            }
          : object,
      ),
    })),
  };
}

export function context(overrides: Partial<ProductionContext> = {}): ProductionContext {
  return {
    serial: 'YT-00001257',
    instanceIndex: 1,
    copyIndex: 1,
    sourceRow: 2,
    jobNumber: 'PJ-20260916-000123',
    ...overrides,
  };
}
