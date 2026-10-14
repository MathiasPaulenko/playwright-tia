import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface TiaConfig {
  /** Repo-relative path of the manifest file. */
  manifestPath: string;
  /** Git ref used as diff base when --base is not passed. */
  baseRef: string;
  /** Changed paths matching any of these globs force a full run. */
  forceRun: string[];
  coverage: {
    /** Collect per-spec coverage during runs. Default off unless CI or --collect-coverage. */
    enabled: boolean;
    /** Globs to exclude resolved sources (vendor noise, node_modules). */
    filter: string[];
    /**
     * FS dir the dev server's URL root maps to (e.g. `dist` for a static
     * preview build). Defaults to the project root.
     */
    serveRoot?: string;
  };
  /**
   * Files covered by more than this fraction of specs are treated as "shared"
   * (app shell, router, providers): reported separately instead of silently
   * inflating the affected list.
   */
  sharedThreshold: number;
  /** Glob(s) identifying spec files, used for the new-spec/spec-changed rules. */
  specGlob: string[];
  /**
   * Manifest records older than this many days go stale: their spec always
   * runs until refreshed (the recorded sources may no longer match the code).
   * 0 disables staleness.
   */
  recordMaxAgeDays: number;
}

export const defaultConfig: TiaConfig = {
  manifestPath: 'tia-manifest.json',
  baseRef: 'origin/main',
  forceRun: [
    'playwright.config.*',
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    '.github/**',
  ],
  coverage: {
    enabled: false,
    filter: ['!**/node_modules/**'],
  },
  sharedThreshold: 0.8,
  specGlob: ['**/*.spec.*', '**/*.test.*'],
  recordMaxAgeDays: 30,
};

/** Reads playwright-tia.config.json merged over defaults; missing/invalid file → defaults. */
export async function loadConfig(rootDir: string): Promise<TiaConfig> {
  try {
    const raw = JSON.parse(
      await readFile(join(rootDir, 'playwright-tia.config.json'), 'utf8'),
    ) as Partial<TiaConfig>;
    return { ...defaultConfig, ...raw, coverage: { ...defaultConfig.coverage, ...raw.coverage } };
  } catch {
    return defaultConfig;
  }
}
