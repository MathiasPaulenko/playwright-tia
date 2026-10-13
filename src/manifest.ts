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
    return parsed;
  } catch {
    return emptyManifest();
  }
}

export async function saveManifest(path: string, manifest: TiaManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/** Spec keys stay POSIX-style regardless of the platform Playwright ran on. */
export function normalizeSpecPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Re-runs replace (not union) sources: the record mirrors the latest run. */
export function mergeSpec(
  manifest: TiaManifest,
  specPath: string,
  sources: string[],
  now: number = Math.floor(Date.now() / 1000),
): TiaManifest {
  manifest.specs[normalizeSpecPath(specPath)] = {
    sources: [...new Set(sources)].sort(),
    updatedAt: now,
  };
  return manifest;
}

export function pruneManifest(manifest: TiaManifest, currentSpecs: string[]): void {
  const keep = new Set(currentSpecs.map(normalizeSpecPath));
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
  const line = `${JSON.stringify({ spec: normalizeSpecPath(specPath), sources: [...new Set(sources)].sort(), updatedAt: now })}\n`;
  await appendFile(join(fragmentsDir, `${workerId}.jsonl`), line, 'utf8');
}

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
      const { spec, sources, updatedAt } = JSON.parse(line) as SpecRecord & { spec: string };
      records.set(normalizeSpecPath(spec), { sources, updatedAt });
    }
  }
  return records;
}

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
