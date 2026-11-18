import { isAbsolute } from 'node:path';
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** A repo-relative path that stays inside the project. */
function isSafeRelPath(value: string): boolean {
  return value.length > 0 && !isAbsolute(value) && !value.startsWith('..');
}

/**
 * Field-by-field validation: a JSON-valid config with wrong types (e.g.
 * `specGlob: "e2e/**"`) must fall back to that field's default instead of
 * crashing the CLI later. Unknown fields are ignored.
 */
function sanitizeConfig(raw: unknown): TiaConfig {
  const config: TiaConfig = { ...defaultConfig, coverage: { ...defaultConfig.coverage } };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return config;
  const input = raw as Partial<TiaConfig>;
  if (typeof input.manifestPath === 'string' && isSafeRelPath(input.manifestPath)) {
    config.manifestPath = input.manifestPath;
  }
  if (typeof input.baseRef === 'string' && input.baseRef) config.baseRef = input.baseRef;
  if (isStringArray(input.forceRun)) config.forceRun = input.forceRun;
  if (isStringArray(input.specGlob)) config.specGlob = input.specGlob;
  if (
    typeof input.sharedThreshold === 'number' &&
    Number.isFinite(input.sharedThreshold) &&
    input.sharedThreshold > 0 &&
    input.sharedThreshold <= 1
  ) {
    config.sharedThreshold = input.sharedThreshold;
  }
  if (
    typeof input.recordMaxAgeDays === 'number' &&
    Number.isFinite(input.recordMaxAgeDays) &&
    input.recordMaxAgeDays >= 0
  ) {
    config.recordMaxAgeDays = Math.floor(input.recordMaxAgeDays);
  }
  const coverage = input.coverage;
  if (typeof coverage === 'object' && coverage !== null && !Array.isArray(coverage)) {
    if (typeof coverage.enabled === 'boolean') config.coverage.enabled = coverage.enabled;
    if (isStringArray(coverage.filter)) config.coverage.filter = coverage.filter;
    if (typeof coverage.serveRoot === 'string' && isSafeRelPath(coverage.serveRoot)) {
      config.coverage.serveRoot = coverage.serveRoot;
    }
  }
  return config;
}

/** Reads playwright-tia.config.json merged over defaults; missing/invalid file → defaults. */
export async function loadConfig(rootDir: string): Promise<TiaConfig> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(join(rootDir, 'playwright-tia.config.json'), 'utf8'),
    );
    return sanitizeConfig(raw);
  } catch {
    return defaultConfig;
  }
}
