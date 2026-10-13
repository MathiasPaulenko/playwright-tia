import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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
