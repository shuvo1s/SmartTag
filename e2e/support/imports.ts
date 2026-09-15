import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import type { DesignDocument } from '@smarttag/document-schema';
import type { DataImportDto, TemplateDto } from '@smarttag/shared-types';
import { buildCsv } from '@smarttag/tabular-sources/testing';
import { E2E_WEB_URL } from '../environment.mjs';
import { createVariableDataDraft } from './data.ts';
import type { Draft } from './editor.ts';
import { storageStatePath, type SeedUser } from './users.ts';

export const ORIGIN = { origin: E2E_WEB_URL };

/** An API client signed in as a seed user (sessions prepared by auth.setup.ts). */
export function apiAs(user: SeedUser): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: E2E_WEB_URL,
    storageState: storageStatePath(user),
  });
}

/** A fresh variable-data template draft created by the organization admin. */
export async function importTemplate(
  customize?: (document: DesignDocument) => DesignDocument,
): Promise<Draft> {
  const admin = await apiAs('admin');
  try {
    return await createVariableDataDraft(admin, customize);
  } finally {
    await admin.dispose();
  }
}

export const HEADERS = [
  'STYLE_NO',
  'PRODUCT NAME',
  'Color',
  'SIZE_CODE',
  'RETAIL',
  'EAN_CODE',
  'IMAGE',
] as const;

export function csv(
  rows: readonly (readonly string[])[],
  headers: readonly string[] = HEADERS,
): { name: string; mimeType: string; buffer: Buffer } {
  return {
    name: 'tags.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(buildCsv([headers, ...rows]), 'utf8'),
  };
}

/** Upload step: the template version comes from the entry point, the file from the test. */
export async function startImport(
  page: Page,
  draft: Draft,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<string> {
  await page.goto(`/data-imports/new?versionId=${draft.versionId}`);
  await expect(page.getByTestId('import-version')).toHaveValue(draft.versionId);
  await page.getByTestId('import-file').setInputFiles(file);
  await page.getByTestId('start-import').click();
  await expect(page).toHaveURL(/\/data-imports\/[0-9a-f-]{36}/);
  const importId = /\/data-imports\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  return importId;
}

export async function expectStatus(page: Page, status: DataImportDto['status'], timeout = 60_000) {
  await expect(page.getByTestId('import-status')).toHaveAttribute('data-status', status, {
    timeout,
  });
}

/** Maps source columns (by letter) to template fields (by key) and saves the mapping. */
export async function mapColumns(page: Page, assignments: Readonly<Record<string, string>>) {
  for (const [letter, field] of Object.entries(assignments)) {
    await page.getByTestId(`mapping-select-${letter}`).selectOption(field);
  }
}

export const STANDARD_MAPPING = {
  A: 'style',
  B: 'product_name',
  C: 'color',
  D: 'size',
  E: 'price',
  F: 'gtin',
} as const;

export async function openSeededVdpVersion(api: APIRequestContext): Promise<Draft> {
  const response = await api.get('/api/v1/templates?search=HT-VDP-50X90&pageSize=5');
  expect(response.status()).toBe(200);
  const template = ((await response.json()) as { items: TemplateDto[] }).items.find(
    (item) => item.code === 'HT-VDP-50X90',
  )!;
  return { template, versionId: template.currentVersion!.id };
}

export async function getImport(api: APIRequestContext, importId: string): Promise<DataImportDto> {
  const response = await api.get(`/api/v1/data-imports/${importId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as DataImportDto;
}
