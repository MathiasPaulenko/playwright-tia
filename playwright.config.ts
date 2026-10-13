import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  reporter: [['list']],
  fullyParallel: true,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
