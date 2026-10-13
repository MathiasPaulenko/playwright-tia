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
  };
  /**
   * Files covered by more than this fraction of specs are treated as "shared"
   * (app shell, router, providers): reported separately instead of silently
   * inflating the affected list.
   */
  sharedThreshold: number;
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
};
