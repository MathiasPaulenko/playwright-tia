import { join, relative } from 'node:path';
import { test as base, type CDPSession, type Page, type TestInfo } from '@playwright/test';

import { loadConfig, type TiaConfig } from './config.js';
import { appendSpecFragment, normalizeRepoPath } from './manifest.js';
import { resolveSources, type CoverageEntry } from './resolve.js';

let cachedConfig: TiaConfig | undefined;
async function tiaConfig(rootDir: string): Promise<TiaConfig> {
  return (cachedConfig ??= await loadConfig(rootDir));
}

/** Collection: PW_TIA_COLLECT wins, then CI, then config.coverage.enabled. */
export function collectEnabled(
  env: { PW_TIA_COLLECT?: string; CI?: string },
  configEnabled: boolean,
): boolean {
  const flag = env.PW_TIA_COLLECT;
  if (flag === '0' || flag === 'false') return false;
  if (flag === '1' || flag === 'true' || env.CI) return true;
  return configEnabled;
}

async function shouldCollect(rootDir: string): Promise<boolean> {
  return collectEnabled(process.env, (await tiaConfig(rootDir)).coverage.enabled);
}

async function startCoverage(page: Page, sessions: Set<CDPSession>): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Debugger.enable');
  await session.send('Profiler.enable');
  await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  sessions.add(session);
}

async function record(sessions: Set<CDPSession>, testInfo: TestInfo, rootDir: string): Promise<void> {
  const entries: CoverageEntry[] = [];
  for (const session of sessions) {
    try {
      const { result } = await session.send('Profiler.takePreciseCoverage');
      await session.send('Profiler.stopPreciseCoverage');
      entries.push(
        ...(await Promise.all(
          result.map(async (script) => ({
            url: script.url,
            functions: script.functions,
            source: await session
              .send('Debugger.getScriptSource', { scriptId: script.scriptId })
              .then((s) => s.scriptSource)
              .catch(() => undefined),
          })),
        )),
      );
    } catch {
      // Page closed mid-test or session died — its coverage is lost, not fatal.
    }
  }
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
  const specPath = normalizeRepoPath(relative(rootDir, testInfo.file));
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
      const sessions = new Set<CDPSession>();
      // Specs may open extra pages/popups mid-test — cover them too.
      const onPage = (p: Page): void => {
        void startCoverage(p, sessions).catch(() => {});
      };
      try {
        await startCoverage(page, sessions);
        page.context().on('page', onPage);
      } catch (error) {
        // Coverage must never break a test run — degrade to no recording.
        console.warn(`pw-tia: coverage unavailable (${error instanceof Error ? error.message : error})`);
        for (const s of sessions) await s.detach().catch(() => {});
        await use();
        return;
      }
      try {
        await use();
      } finally {
        page.context().off('page', onPage);
        try {
          // A spec that failed mid-run produced partial coverage; recording it
          // would under-select later. Only completed runs update the manifest.
          if (testInfo.status === 'passed') {
            await record(sessions, testInfo, rootDir);
          }
        } catch (error) {
          console.warn(`pw-tia: coverage failed for ${testInfo.file} (${error instanceof Error ? error.message : error})`);
        }
        for (const s of sessions) await s.detach().catch(() => {});
      }
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
