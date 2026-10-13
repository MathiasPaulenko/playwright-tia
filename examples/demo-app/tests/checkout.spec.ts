import { expect, test } from 'playwright-tia';

test('checks out a non-empty cart', async ({ page }) => {
  await page.goto('/checkout.html');
  const receipt = await page.evaluate(() => {
    const app = globalThis.app as { addItem(id: string): unknown; checkout(): string };
    app.addItem('sku-1');
    return app.checkout();
  });
  expect(receipt).toBe('checked-out:1');
});
