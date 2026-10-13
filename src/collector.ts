import { join, relative } from 'node:path';
import { test as base, type CDPSession, type TestInfo } from '@playwright/test';

import { loadConfig, type TiaConfig } from './config.js';
import { appendSpecFragment, normalizeSpecPath } from './manifest.js';
import { resolveSources, type CoverageEntry } from './resolve.js';

// Config is constant per worker — load once.
let cachedConfig: TiaConfig | undefined;
async function tiaConfig(rootDir: string): Promise<TiaConfig> {
  return (cachedConfig ??= await loadConfig(rootDir));
}

// Collection: PW_TIA_COLLECT wins, then CI, then config.coverage.enabled.
async function shouldCollect(rootDir: string): Promise<boolean> {
  const flag = process.env.PW_TIA_COLLECT;
  if (flag === '0' || flag === 'false') return false;
  if (flag === '1' || flag === 'true' || !!process.env.CI) return true;
  return (await tiaConfig(rootDir)).coverage.enabled;
}

async function record(session: CDPSession, testInfo: TestInfo, rootDir: string): Promise<void> {
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
  const config = await tiaConfig(rootDir);
  const { sources, unresolved } = await resolveSources(entries, {
    rootDir,
    serveRoot: config.coverage.serveRoot ? join(rootDir, config.coverage.serveRoot) : undefined,
    filter: config.coverage.filter,
  });
  if (unresolved.length > 0) {
    console.warn(
      `pw-tia: no usable sourcemap for ${unresolved.length} script(s) ` +
        `(${unresolved.slice(0, 3).join(', ')}${unresolved.length > 3 ? ', …' : ''}) — this spec keeps conservative sources`,
    );
  }
  const specPath = normalizeSpecPath(relative(rootDir, testInfo.file));
  await appendSpecFragment(join(rootDir, '.tia', 'fragments'), testInfo.parallelIndex, specPath, sources);
}

/**
 * Drop-in replacement for `@playwright/test`'s `test`. Its auto `tia` fixture
 * wraps every spec with CDP V8 coverage and appends the executed sources to
 * `.tia/fragments` — active only when collection is enabled (see
 * `shouldCollect`), and never fails a test.
 */
export const test = base.extend<{ tia: void }>({
  tia: [
    async ({ page, browserName }, use, testInfo) => {
      const rootDir = process.env.PW_TIA_ROOT ?? process.cwd();
      if (browserName !== 'chromium' || !(await shouldCollect(rootDir))) {
        await use();
        return;
      }
      const session = await page.context().newCDPSession(page);
      try {
        await session.send('Debugger.enable');
        await session.send('Profiler.enable');
        await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
      } catch (error) {
        // Coverage must never break a test run — degrade to no recording.
        console.warn(`pw-tia: coverage unavailable (${error instanceof Error ? error.message : error})`);
        await session.detach().catch(() => {});
        await use();
        return;
      }
      try {
        await use();
      } finally {
        try {
          // A spec that failed mid-run produced partial coverage; recording it
          // would under-select later. Only completed runs update the manifest.
          if (testInfo.status === 'passed') {
            await record(session, testInfo, rootDir);
          } else {
            await session.send('Profiler.stopPreciseCoverage').catch(() => {});
          }
        } catch (error) {
          console.warn(`pw-tia: coverage failed for ${testInfo.file} (${error instanceof Error ? error.message : error})`);
        }
        await session.detach().catch(() => {});
      }
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
