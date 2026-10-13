import picomatch from 'picomatch';

import type { TiaConfig } from './config.js';
import { normalizeSpecPath, type TiaManifest } from './manifest.js';

export type AffectedReason = 'changed-source' | 'spec-changed' | 'new-spec' | 'no-sources' | 'shared-file' | 'run-all';

export interface AffectedSpec {
  /** Spec path as Playwright reports it (repo-relative). */
  spec: string;
  /** Changed files that triggered this spec. */
  triggeredBy: string[];
  reason: AffectedReason;
}

export interface AffectedResult {
  specs: AffectedSpec[];
  /** True when selection degraded to run-everything (forceRun match, missing manifest). */
  runAll: boolean;
  /** Why runAll fired, when it did. */
  reason?: string;
  /** Changed files covered by >= sharedThreshold of specs — they explain wide selections. */
  shared?: { file: string; specCount: number }[];
}

/**
 * Pure selection: manifest × changed files × current specs → specs to run.
 * Never under-selects — anything unknown (missing manifest, unmapped spec,
 * forceRun hit, git failure upstream) degrades to run-all or includes the
 * spec conservatively.
 */
export function selectAffected(
  manifest: TiaManifest,
  changedFiles: string[],
  currentSpecs: string[],
  config: TiaConfig,
): AffectedResult {
  const manifestSpecs = Object.keys(manifest.specs);
  const allSpecs = new Set([...manifestSpecs, ...currentSpecs.map(normalizeSpecPath)]);
  const toSpecList = (reason: AffectedReason): AffectedSpec[] =>
    [...allSpecs].sort().map((spec) => ({ spec, triggeredBy: [], reason }));

  if (manifestSpecs.length === 0) {
    return { specs: toSpecList('new-spec'), runAll: true, reason: 'no-manifest' };
  }

  const forceMatchers = config.forceRun.map((g) => picomatch(g));
  const forced = changedFiles.find((f) => forceMatchers.some((match) => match(normalizeSpecPath(f))));
  if (forced) {
    return { specs: toSpecList('run-all'), runAll: true, reason: `forceRun: ${forced}` };
  }

  // Files covered by >= sharedThreshold of specs are "shared" — changing them
  // legitimately selects most of the suite, so we say so explicitly.
  const coverage = new Map<string, number>();
  for (const record of Object.values(manifest.specs)) {
    for (const source of record.sources) {
      coverage.set(source, (coverage.get(source) ?? 0) + 1);
    }
  }
  const specTotal = manifestSpecs.length;
  const sharedFiles = new Set(
    [...coverage]
      .filter(([, count]) => count / specTotal >= config.sharedThreshold)
      .map(([file]) => file),
  );

  const changed = new Set(changedFiles.map(normalizeSpecPath));
  const specMatchers = config.specGlob.map((g) => picomatch(g));
  const isSpecPath = (p: string) => specMatchers.some((m) => m(p));

  const specs: AffectedSpec[] = [];
  for (const spec of allSpecs) {
    const record = manifest.specs[spec];
    if (!record) {
      specs.push({ spec, triggeredBy: [], reason: 'new-spec' });
      continue;
    }
    if (changed.has(spec)) {
      specs.push({ spec, triggeredBy: [spec], reason: 'spec-changed' });
      continue;
    }
    if (record.sources.length === 0) {
      specs.push({ spec, triggeredBy: [], reason: 'no-sources' });
      continue;
    }
    const triggeredBy = record.sources.filter((s) => changed.has(s));
    if (triggeredBy.length === 0) continue;
    const allShared = triggeredBy.every((s) => sharedFiles.has(s));
    specs.push({ spec, triggeredBy, reason: allShared ? 'shared-file' : 'changed-source' });
  }

  // Changed files that look like specs but have no manifest record are new.
  for (const file of changed) {
    if (isSpecPath(file) && !allSpecs.has(file)) {
      specs.push({ spec: file, triggeredBy: [file], reason: 'new-spec' });
    }
  }

  const shared = [...changed]
    .filter((f) => sharedFiles.has(f))
    .map((f) => ({ file: f, specCount: coverage.get(f)! }))
    .sort((a, b) => a.file.localeCompare(b.file));

  specs.sort((a, b) => a.spec.localeCompare(b.spec));
  return { specs, runAll: false, shared };
}
