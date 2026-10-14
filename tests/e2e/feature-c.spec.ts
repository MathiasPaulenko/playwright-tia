import { expect, test } from '../../src/index.js';
import { startApp, type AppServer } from './support.js';

let app: AppServer;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

test('runs feature C inside a cross-origin iframe', async ({ page }) => {
  await page.goto(app.url);
  await page.evaluate((src) => globalThis.app.mountFrame(src), app.frameUrl);
  const button = page.frameLocator('iframe').locator('#go');
  await button.waitFor();
  // give the collector a beat to attach to the iframe's own CDP target
  await page.waitForTimeout(300);
  await button.click();
  const frame = page.frames().find((f) => f.url().includes('frame.html'))!;
  await expect.poll(() => frame.title()).toBe('featureC');
});
