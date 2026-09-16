import { expect, test } from '@playwright/test';
import type { ProductionJobDto } from '@smarttag/shared-types';
import { apiAs } from '../support/imports.ts';
import { createSequence, getJob, productionInputs } from '../support/production.ts';
import { storageStatePath } from '../support/users.ts';

/** A prepared job of the demo organization, expanded and ready to release. */
async function readyJob(label: string) {
  const inputs = await productionInputs([1, 1], label);
  const api = await apiAs('productionManager');
  const created = await api.post('/api/v1/production-jobs', {
    data: {
      name: 'Permissions',
      templateVersionId: inputs.templateVersionId,
      datasetVersionId: inputs.datasetVersionId,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  let job = (await created.json()) as ProductionJobDto;
  const validated = await api.post(`/api/v1/production-jobs/${job.id}/validate`, {
    data: { expectedRevision: job.revision },
  });
  expect(validated.status(), await validated.text()).toBe(200);
  for (let attempt = 0; attempt < 300; attempt += 1) {
    job = await getJob(api, job.id);
    if (!['QUEUED', 'EXPANDING', 'VALIDATING'].includes(job.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  expect(job.status).toBe('READY');
  await api.dispose();
  return job;
}

test.describe('production permissions', () => {
  test('a data operator prepares jobs but cannot release production', async () => {
    const job = await readyJob(`Operator ${Date.now()}`);
    const operator = await apiAs('dataOperator');
    try {
      const detail = await getJob(operator, job.id);
      expect(detail.actions.validate).toBe(true);
      expect(detail.actions.release).toBe(false);

      const release = await operator.post(`/api/v1/production-jobs/${job.id}/release`, {
        data: { expectedRevision: detail.revision, acknowledgeWarnings: true },
      });
      expect(release.status()).toBe(403);
    } finally {
      await operator.dispose();
    }
  });

  test('a viewer reads the production module but changes nothing', async () => {
    const job = await readyJob(`Viewer ${Date.now()}`);
    const viewer = await apiAs('viewer');
    try {
      const detail = await getJob(viewer, job.id);
      expect(detail.actions).toMatchObject({ configure: false, validate: false, release: false });

      const create = await viewer.post('/api/v1/production-jobs', {
        data: {
          name: 'No',
          templateVersionId: detail.templateVersion.id,
          datasetVersionId: detail.datasetVersion.id,
        },
      });
      expect(create.status()).toBe(403);
      const sequence = await viewer.post('/api/v1/sequences', {
        data: { name: 'No', code: 'NOPE' },
      });
      expect(sequence.status()).toBe(403);
    } finally {
      await viewer.dispose();
    }
  });

  test('another organization cannot see or change the job, its tags or its manifest', async () => {
    const job = await readyJob(`Tenant ${Date.now()}`);
    const manager = await apiAs('productionManager');
    const sequence = await createSequence(manager, `TEN${Date.now().toString().slice(-6)}`);
    await manager.dispose();

    const other = await apiAs('acmeAdmin');
    try {
      for (const path of [
        `/api/v1/production-jobs/${job.id}`,
        `/api/v1/production-jobs/${job.id}/instances`,
        `/api/v1/production-jobs/${job.id}/instances/1`,
        `/api/v1/production-jobs/${job.id}/samples`,
        `/api/v1/production-jobs/${job.id}/manifest`,
        `/api/v1/sequences/${sequence.id}`,
      ]) {
        const response = await other.get(path);
        expect(response.status(), path).toBe(404);
      }
      const cancel = await other.post(`/api/v1/production-jobs/${job.id}/cancel`, {
        data: { expectedRevision: job.revision },
      });
      expect(cancel.status()).toBe(404);

      const list = await other.get('/api/v1/production-jobs');
      expect(list.status()).toBe(200);
      const items = ((await list.json()) as { items: { id: string }[] }).items;
      expect(items.some((item) => item.id === job.id)).toBe(false);
    } finally {
      await other.dispose();
    }
  });

  test('an approver has no production rights beyond reading', async () => {
    const job = await readyJob(`Approver ${Date.now()}`);
    const approver = await apiAs('approver');
    try {
      const detail = await getJob(approver, job.id);
      expect(detail.actions.release).toBe(false);
      const validate = await approver.post(`/api/v1/production-jobs/${job.id}/validate`, {
        data: { expectedRevision: detail.revision },
      });
      expect(validate.status()).toBe(403);
    } finally {
      await approver.dispose();
    }
  });
});

test.describe('production module visibility', () => {
  test.use({ storageState: storageStatePath('viewer') });

  test('a viewer sees the production list without the create action', async ({ page }) => {
    await page.goto('/production');
    await expect(page.getByRole('heading', { name: 'Production', exact: true })).toBeVisible();
    await expect(page.getByTestId('new-production-job')).toHaveCount(0);
  });
});
