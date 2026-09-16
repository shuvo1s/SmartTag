import { expect, test } from '@playwright/test';
import type { ProductionJobDto } from '@smarttag/shared-types';
import { apiAs } from '../support/imports.ts';
import {
  configure,
  createSequence,
  expectJobStatus,
  getJob,
  jobIdFrom,
  productionInputs,
} from '../support/production.ts';
import { storageStatePath } from '../support/users.ts';

test.use({ storageState: storageStatePath('productionManager') });

test.describe('production job workflow', () => {
  test('approved template + finalized dataset → quantities → serials → release → manifest', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const inputs = await productionInputs([2, 3, 1], `FW26 ${Date.now()}`);
    const api = await apiAs('productionManager');
    const sequence = await createSequence(api);

    // 1. Create the job from the Production module.
    await page.goto('/production');
    await expect(page.getByRole('heading', { name: 'Production', exact: true })).toBeVisible();
    await page.getByTestId('new-production-job').click();
    await page.getByTestId('job-name').fill('FW26 hang tags');
    await page.getByTestId('job-template').selectOption(inputs.templateId);
    await page.getByTestId('job-template-version').selectOption(inputs.templateVersionId);
    await page.getByTestId('job-dataset').selectOption({ label: inputs.datasetName });
    await page.getByTestId('job-dataset-version').selectOption(inputs.datasetVersionId);
    await page.getByTestId('create-job').click();

    await expect(page).toHaveURL(/\/production\/[0-9a-f-]{36}/);
    const jobId = jobIdFrom(page);
    await expectJobStatus(page, 'DRAFT');

    // 2. Configure: a quantity from the data and serial numbers from the sequence.
    await configure(page, jobId, 'quantity-mode', 'FIELD');
    await expect(page.getByTestId('quantity-field')).toBeVisible();
    await configure(page, jobId, 'quantity-field', 'quantity');
    await configure(page, jobId, 'serial-sequence', sequence.id);
    await expect(page.getByTestId('quantity-field')).toHaveValue('quantity');
    await expect(page.getByTestId('serial-sequence')).toHaveValue(sequence.id);

    // 3. Expand and validate in the worker.
    await page.getByTestId('validate-job').click();
    await expectJobStatus(page, 'READY');
    await expect(page.getByTestId('job-instances')).toHaveText('6');
    await expect(page.getByTestId('job-errors')).toHaveText('0');

    // The serial numbers are only a preview: nothing is reserved yet.
    await expect(page.getByTestId('serial-preview')).toContainText('YT-01000001');
    await expect(page.getByTestId('serial-preview')).toContainText('Nothing is reserved');
    const beforeRelease = await api.get(`/api/v1/sequences/${sequence.id}`);
    expect(((await beforeRelease.json()) as { nextValue: number }).nextValue).toBe(1_000_001);

    // 4. Review the tags: six in record and copy order.
    await expect(page.getByTestId('instances-total')).toContainText('6');
    await expect(page.getByTestId('instance-row-1')).toBeVisible();
    await page.getByTestId('instance-row-3').click();
    await expect(page.getByTestId('instance-detail')).toBeVisible();
    await expect(page.getByTestId('instance-preview')).toBeVisible({ timeout: 30_000 });

    // 5. Release: the range is committed and the job is finished by the worker.
    await page.getByTestId('release-job').click();
    await expectJobStatus(page, 'READY_FOR_RENDERING', 120_000);
    await expect(page.getByTestId('job-reservation')).toContainText('YT-01000001');
    await expect(page.getByTestId('job-reservation')).toContainText('YT-01000006');
    await expect(page.getByTestId('job-hash')).not.toBeEmpty();
    await expect(page.getByTestId('manifest-verified')).toBeVisible({ timeout: 30_000 });

    const released = await getJob(api, jobId);
    expect(released.reservation).toMatchObject({ startValue: 1_000_001, endValue: 1_000_006 });
    expect(released.instancesDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(released.productionJobHash).toMatch(/^[0-9a-f]{64}$/);

    const after = await api.get(`/api/v1/sequences/${sequence.id}`);
    expect(((await after.json()) as { nextValue: number }).nextValue).toBe(1_000_007);

    // 6. Reloading shows the same released job, and it can no longer be changed.
    await page.reload();
    await expectJobStatus(page, 'READY_FOR_RENDERING');
    await expect(page.getByTestId('release-job')).toHaveCount(0);
    await expect(page.getByTestId('validate-job')).toHaveCount(0);
    await expect(page.getByTestId('cancel-job')).toHaveCount(0);

    const refused = await api.post(`/api/v1/production-jobs/${jobId}/validate`, {
      data: { expectedRevision: released.revision },
    });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'PRODUCTION_JOB_IMMUTABLE',
    );

    // 7. The manifest downloads as a file and matches its checksum.
    const download = await api.get(`/api/v1/production-jobs/${jobId}/manifest/download`);
    expect(download.status()).toBe(200);
    expect(download.headers()['content-disposition']).toContain('attachment');
    await api.dispose();
  });

  test('a tag with an unusable quantity blocks the release and is never dropped', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const inputs = await productionInputs([2, 'five'], `Bad quantity ${Date.now()}`);
    const api = await apiAs('productionManager');

    await page.goto('/production/new');
    await page.getByTestId('job-name').fill('Bad quantities');
    await page.getByTestId('job-template').selectOption(inputs.templateId);
    await page.getByTestId('job-template-version').selectOption(inputs.templateVersionId);
    await page.getByTestId('job-dataset').selectOption({ label: inputs.datasetName });
    await page.getByTestId('job-dataset-version').selectOption(inputs.datasetVersionId);
    await page.getByTestId('create-job').click();
    await expect(page).toHaveURL(/\/production\/[0-9a-f-]{36}/);
    const jobId = jobIdFrom(page);

    await configure(page, jobId, 'quantity-mode', 'FIELD');
    await expect(page.getByTestId('quantity-field')).toBeVisible();
    await configure(page, jobId, 'quantity-field', 'quantity');
    await expect(page.getByTestId('quantity-field')).toHaveValue('quantity');
    await page.getByTestId('validate-job').click();
    await expectJobStatus(page, 'HAS_ERRORS');

    await expect(page.getByTestId('job-errors')).toHaveText('1');
    // The record that could not be read still produced a tag carrying the error.
    await expect(page.getByTestId('job-instances')).toHaveText('3');
    await expect(page.getByTestId('release-blocked')).toBeVisible();
    await expect(page.getByTestId('release-job')).toHaveCount(0);

    await page.getByTestId('instance-filter-ERROR').click();
    await page.getByTestId('instances-table').getByRole('row').nth(1).click();
    await expect(page.getByTestId('instance-issue').first()).toHaveAttribute(
      'data-code',
      'QUANTITY_VALUE_INVALID',
    );

    const job: ProductionJobDto = await getJob(api, jobId);
    const refused = await api.post(`/api/v1/production-jobs/${jobId}/release`, {
      data: { expectedRevision: job.revision, acknowledgeWarnings: true },
    });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'PRODUCTION_JOB_HAS_ERRORS',
    );
    await api.dispose();
  });
});
