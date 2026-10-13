import { expect, test } from 'playwright-tia';

test('greets the user on their profile', async ({ page }) => {
  await page.goto('/profile.html');
  const message = await page.evaluate(() => {
    const app = globalThis.app as { greeting(name: string): string };
    return app.greeting('mati');
  });
  expect(message).toBe('welcome back, mati');
});
