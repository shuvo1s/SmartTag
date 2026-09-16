import { expect, test } from '@playwright/test';
import type { ProductionJobDto } from '@smarttag/shared-types';
import { apiAs } from '../support/imports.ts';
import { getJob, productionInputs } from '../support/production.ts';
import { storageStatePath } from '../support/users.ts';

test.use({ storageState: storageStatePath('productionManager') });

/**
 * Cross-browser smoke: the production module opens, a released job shows its tags, its hashes and
 * its manifest. The complete workflow runs in Chromium.
 */
test('open production, release a small job and read its tags and manifest', async ({ page }) => {
  test.setTimeout(180_000);
  const inputs = await productionInputs([1, 1], `Smoke ${Date.now()}`);
  const api = await apiAs('productionManager');

  const created = await api.post('/api/v1/production-jobs', {
    data: {
      name: 'Smoke job',
      templateVersionId: inputs.templateVersionId,
      datasetVersionId: inputs.datasetVersionId,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  let job = (await created.json()) as ProductionJobDto;
  const validated = await api.post(`/api/v1/production-jobs/${job.id}/validate`, {
    data: { expectedRevision: job.revision },
  });
  expect(validated.status()).toBe(200);
  for (let attempt = 0; attempt < 300; attempt += 1) {
    job = await getJob(api, job.id);
    if (!['QUEUED', 'EXPANDING', 'VALIDATING'].includes(job.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  expect(job.status).toBe('READY');

  await page.goto('/production');
  await expect(page.getByTestId('production-jobs-table')).toBeVisible();
  await page.getByRole('link', { name: job.jobNumber }).click();
  await expect(page).toHaveURL(new RegExp(`/production/${job.id}`));
  await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'READY');
  await expect(page.getByTestId('job-instances')).toHaveText('2');

  // Release and wait for the worker to finish the job.
  await page.getByTestId('release-job').click();
  await expect(page.getByTestId('job-status')).toHaveAttribute(
    'data-status',
    'READY_FOR_RENDERING',
    { timeout: 120_000 },
  );
  await expect(page.getByTestId('job-hash')).not.toBeEmpty();

  // One tag, with its production context.
  await page.getByTestId('instance-row-1').click();
  await expect(page.getByTestId('instance-detail')).toBeVisible();
  await expect(page.getByTestId('instance-hash')).not.toBeEmpty();

  await expect(page.getByTestId('manifest-verified')).toBeVisible({ timeout: 30_000 });
  await api.dispose();
});
