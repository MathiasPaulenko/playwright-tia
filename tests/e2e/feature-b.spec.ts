import { expect, test } from '../../src/index.js';
import { loadFeature, startApp, type AppServer } from './support.js';

let app: AppServer;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

test('loads feature B', async ({ page }) => {
  await page.goto(app.url);
  expect(await loadFeature(page, 'B')).toBe('featureB:core');
});
