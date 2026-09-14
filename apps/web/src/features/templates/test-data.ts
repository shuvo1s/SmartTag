import { mmToPt } from '@smarttag/document-utils';
import type {
  CustomerDto,
  DocumentSummaryDto,
  TemplateDto,
  TemplateVersionSummaryDto,
} from '@smarttag/shared-types';

export const summary: DocumentSummaryDto = {
  documentType: 'HANG_TAG',
  widthPt: mmToPt(50),
  heightPt: mmToPt(90),
  orientation: 'PORTRAIT',
  displayUnit: 'mm',
  bleedPt: { top: mmToPt(3), right: mmToPt(3), bottom: mmToPt(3), left: mmToPt(3) },
  safeAreaPt: { top: mmToPt(3), right: mmToPt(3), bottom: mmToPt(3), left: mmToPt(3) },
  pageCount: 2,
  pageSides: ['FRONT', 'BACK'],
  objectCount: 17,
  dataFieldCount: 10,
  boundFieldKeys: ['product_name', 'size', 'price', 'gtin'],
  assetIds: [],
};

export const user = { id: 'u-1', displayName: 'Demo Designer' };

export function templateDto(overrides: Partial<TemplateDto> = {}): TemplateDto {
  return {
    id: '0192f0a0-5b1e-7c3d-8e4f-1a2b3c4d5e6f',
    code: 'HT-DEMO-50X90',
    name: 'Demo Active hang tag',
    description: '',
    documentType: 'HANG_TAG',
    status: 'ACTIVE',
    customer: { id: 'c-1', code: 'DEMO-APPAREL', name: 'Demo Apparel Co.' },
    brand: { id: 'b-1', code: 'DEMO-ACTIVE', name: 'Demo Active' },
    latestVersionNumber: 2,
    currentVersion: {
      id: 'v-2',
      versionNumber: 2,
      status: 'DRAFT',
      documentHash: 'a'.repeat(64),
      summary,
    },
    createdBy: user,
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-12T08:00:00.000Z',
    ...overrides,
  };
}

export function versionDto(
  overrides: Partial<TemplateVersionSummaryDto> = {},
): TemplateVersionSummaryDto {
  return {
    id: 'v-1',
    templateId: '0192f0a0-5b1e-7c3d-8e4f-1a2b3c4d5e6f',
    versionNumber: 1,
    status: 'DRAFT',
    schemaVersion: 1,
    documentHash: '0123456789abcdef'.repeat(4),
    revision: 1,
    changeSummary: 'Initial artwork',
    basedOnVersionId: null,
    summary,
    createdBy: user,
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-10T08:00:00.000Z',
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    retiredAt: null,
    ...overrides,
  };
}

export const customers: CustomerDto[] = [
  {
    id: '0192f0a0-5b1e-7c3d-8e4f-00000000c001',
    code: 'DEMO-APPAREL',
    name: 'Demo Apparel Co.',
    status: 'ACTIVE',
    brands: [
      {
        id: '0192f0a0-5b1e-7c3d-8e4f-00000000b001',
        customerId: '0192f0a0-5b1e-7c3d-8e4f-00000000c001',
        code: 'DEMO-ACTIVE',
        name: 'Demo Active',
        status: 'ACTIVE',
      },
    ],
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-10T08:00:00.000Z',
  },
  {
    id: '0192f0a0-5b1e-7c3d-8e4f-00000000c002',
    code: 'NO-BRANDS',
    name: 'Brandless Ltd.',
    status: 'ACTIVE',
    brands: [],
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-10T08:00:00.000Z',
  },
];
