import { join, relative } from 'node:path';
import { test as base } from '@playwright/test';

import { appendSpecFragment, normalizeSpecPath } from './manifest.js';
import { resolveSources, type CoverageEntry } from './resolve.js';

// Collection is opt-in locally (PW_TIA_COLLECT=1) and on by default in CI,
// where the ~5-15% coverage overhead pays for the selection it enables.
function collectEnabled(): boolean {
  const flag = process.env.PW_TIA_COLLECT;
  if (flag === '0' || flag === 'false') return false;
  return flag === '1' || flag === 'true' || !!process.env.CI;
}

export const test = base.extend<{ tia: void }>({
  tia: [
    async ({ page, browserName }, use, testInfo) => {
      if (!collectEnabled() || browserName !== 'chromium') {
        await use();
        return;
      }
      const session = await page.context().newCDPSession(page);
      await session.send('Debugger.enable');
      await session.send('Profiler.enable');
      await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
      try {
        await use();
      } finally {
        const { result } = await session.send('Profiler.takePreciseCoverage');
        await session.send('Profiler.stopPreciseCoverage');
        const entries: CoverageEntry[] = await Promise.all(
          result.map(async (script) => ({
            url: script.url,
            functions: script.functions,
            source: await session
              .send('Debugger.getScriptSource', { scriptId: script.scriptId })
              .then((s) => s.scriptSource)
              .catch(() => undefined),
          })),
        );
        await session.detach();
        const rootDir = process.env.PW_TIA_ROOT ?? process.cwd();
        const { sources } = await resolveSources(entries, { rootDir });
        const specPath = normalizeSpecPath(relative(rootDir, testInfo.file));
        await appendSpecFragment(join(rootDir, '.tia', 'fragments'), testInfo.parallelIndex, specPath, sources);
      }
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
