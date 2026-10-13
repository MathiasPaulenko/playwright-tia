export interface AffectedSpec {
  /** Spec path as Playwright reports it (repo-relative). */
  spec: string;
  /** Changed files that triggered this spec. */
  triggeredBy: string[];
}

export interface AffectedResult {
  specs: AffectedSpec[];
  /** True when selection degraded to run-everything (forceRun match, missing manifest). */
  runAll: boolean;
  /** Why runAll fired, when it did. */
  reason?: string;
}
