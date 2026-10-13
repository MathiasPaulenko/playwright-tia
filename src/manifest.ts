export interface SpecRecord {
  /** Repo-relative source files this spec executed, resolved from V8 coverage + sourcemaps. */
  sources: string[];
  /** Unix seconds of the last run that refreshed this record. */
  updatedAt: number;
}

export interface TiaManifest {
  version: 1;
  specs: Record<string, SpecRecord>;
}
