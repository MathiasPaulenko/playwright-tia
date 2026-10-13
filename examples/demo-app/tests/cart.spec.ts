import { expect, test } from 'playwright-tia';

test('adds items to the cart', async ({ page }) => {
  await page.goto('/cart.html');
  const total = await page.evaluate(() => {
    const app = globalThis.app as { addItem(id: string): unknown[]; cartTotal(): number };
    app.addItem('sku-1');
    app.addItem('sku-2');
    return app.cartTotal();
  });
  expect(total).toBe(2);
});
