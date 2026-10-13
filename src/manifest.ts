import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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

/** A v1 manifest with no records — also the safe fallback for any load failure. */
export function emptyManifest(): TiaManifest {
  return { version: 1, specs: {} };
}

/**
 * Missing, corrupt or unknown-version manifests all degrade to empty — the
 * selector treats an empty manifest as "run everything", which is the safe
 * default and how the first run learns.
 */
export async function loadManifest(path: string): Promise<TiaManifest> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as TiaManifest;
    if (parsed.version !== 1 || typeof parsed.specs !== 'object' || parsed.specs === null) {
      return emptyManifest();
    }
    for (const [spec, record] of Object.entries(parsed.specs)) {
      if (!record || !Array.isArray(record.sources)) {
        delete parsed.specs[spec];
        continue;
      }
      record.sources = record.sources.filter((s): s is string => typeof s === 'string');
    }
    return parsed;
  } catch {
    return emptyManifest();
  }
}

/** Writes the manifest with sorted spec keys so committed diffs stay minimal. */
export async function saveManifest(path: string, manifest: TiaManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const sorted: TiaManifest = {
    version: 1,
    specs: Object.fromEntries(Object.entries(manifest.specs).sort(([a], [b]) => a.localeCompare(b))),
  };
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

/** Repo paths stay POSIX-style regardless of the platform Playwright ran on. */
export function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Re-runs replace (not union) sources: the record mirrors the latest run. */
export function mergeSpec(
  manifest: TiaManifest,
  specPath: string,
  sources: string[],
  now: number = Math.floor(Date.now() / 1000),
): TiaManifest {
  manifest.specs[normalizeRepoPath(specPath)] = {
    sources: [...new Set(sources)].sort(),
    updatedAt: now,
  };
  return manifest;
}

/** Drops records for specs no longer in `currentSpecs` (deleted or renamed). */
export function pruneManifest(manifest: TiaManifest, currentSpecs: string[]): void {
  const keep = new Set(currentSpecs.map(normalizeRepoPath));
  for (const key of Object.keys(manifest.specs)) {
    if (!keep.has(key)) delete manifest.specs[key];
  }
}

/**
 * Parallel Playwright workers can't share one manifest file — each appends a
 * JSONL line per spec to `<fragmentsDir>/<parallelIndex>.jsonl` instead.
 * `mergeFragments` consolidates them after the run.
 */
export async function appendSpecFragment(
  fragmentsDir: string,
  workerId: number | string,
  specPath: string,
  sources: string[],
  now: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  await mkdir(fragmentsDir, { recursive: true });
  const line = `${JSON.stringify({ spec: normalizeRepoPath(specPath), sources: [...new Set(sources)].sort(), updatedAt: now })}\n`;
  await appendFile(join(fragmentsDir, `${workerId}.jsonl`), line, 'utf8');
}

/**
 * Reads all `*.jsonl` fragments. A spec may appear several times (retries,
 * multiple Playwright projects sharing a worker) — sources union, never
 * overwrite, so each project's coverage survives. Missing dir → empty map.
 */
export async function readFragments(fragmentsDir: string): Promise<Map<string, SpecRecord>> {
  const records = new Map<string, SpecRecord>();
  let files: string[];
  try {
    files = (await readdir(fragmentsDir)).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return records;
  }
  for (const file of files) {
    const text = await readFile(join(fragmentsDir, file), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const { spec, sources, updatedAt } = JSON.parse(line) as SpecRecord & { spec: string };
        if (typeof spec !== 'string' || !Array.isArray(sources)) continue;
        const key = normalizeRepoPath(spec);
        const prev = records.get(key);
        records.set(key, {
          sources: [...new Set([...(prev?.sources ?? []), ...sources])].sort(),
          updatedAt: Math.max(prev?.updatedAt ?? 0, updatedAt),
        });
      } catch {
        // A torn write (killed worker) must not break the whole merge.
      }
    }
  }
  return records;
}

/** Merges fragment records into `manifest`, then prunes to `currentSpecs` when given. */
export async function mergeFragments(
  fragmentsDir: string,
  manifest: TiaManifest,
  currentSpecs?: string[],
): Promise<TiaManifest> {
  for (const [spec, record] of await readFragments(fragmentsDir)) {
    manifest.specs[spec] = record;
  }
  if (currentSpecs) pruneManifest(manifest, currentSpecs);
  return manifest;
}
