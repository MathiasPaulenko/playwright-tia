import { expect, test } from 'playwright-tia';

test('reorders the cart contents', async ({ page }) => {
  await page.goto('/orders.html');
  const summary = await page.evaluate(() => {
    const app = globalThis.app as { addItem(id: string): unknown; reorder(): string };
    app.addItem('sku-9');
    return app.reorder();
  });
  expect(summary).toBe('reorder:1');
});
