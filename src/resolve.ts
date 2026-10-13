/** Minimal shape of the CDP Profiler.ScriptCoverage entries we consume. */
export interface ScriptCoverage {
  url: string;
  source?: string;
}

export interface ResolveSourcesOptions {
  /** Globs to exclude resolved sources, e.g. `!**\/node_modules/**`. */
  filter?: string[];
  /** Directory containing the build output that generated the sourcemaps. */
  sourceRoot?: string;
}
