import { expect, test as setup } from '@playwright/test';
import { E2E_PASSWORD, E2E_WEB_URL } from '../environment.mjs';
import { USERS, storageStatePath, type SeedUser } from '../support/users.ts';

for (const user of Object.keys(USERS) as SeedUser[]) {
  setup(`sign in ${user}`, async ({ request }) => {
    const response = await request.post('/api/v1/auth/login', {
      data: { email: USERS[user], password: E2E_PASSWORD },
      headers: { origin: E2E_WEB_URL },
    });
    expect(response.status()).toBe(200);
    await request.storageState({ path: storageStatePath(user) });
  });
}
