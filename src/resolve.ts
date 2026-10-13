import type { Profiler } from 'node:inspector';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eachMapping, TraceMap } from '@jridgewell/trace-mapping';
import picomatch from 'picomatch';

export interface CoverageEntry {
  url: string;
  source?: string;
  functions: Profiler.FunctionCoverage[];
}

export interface ResolveOptions {
  /** Repo root — resolved sources come out relative to it. */
  rootDir: string;
  /**
   * FS dir the URL root maps to when scripts are served over http(s)
   * (e.g. `dist` for `vite preview`). Defaults to rootDir.
   */
  serveRoot?: string;
  /** Extra exclusion globs on resolved repo-relative paths, e.g. `!**\/generated/**`. */
  filter?: string[];
  /** Text loader for script sources and external .map files. Injectable. */
  fetchText?: (url: string) => Promise<string | undefined>;
}

export interface ResolveResult {
  /** Repo-relative source files containing at least one executed range. */
  sources: string[];
  /** Script urls whose sources could not be resolved — their specs stay conservative. */
  unresolved: string[];
}

const MAP_REF_RE = /\/\/#\s*sourceMappingURL=(\S+)\s*$/m;
const WIN_ABS = /^[a-zA-Z]:[\\/]/;

async function defaultFetchText(url: string): Promise<string | undefined> {
  try {
    if (url.startsWith('file://')) return await readFile(fileURLToPath(url), 'utf8');
    if (/^https?:\/\//.test(url)) {
      const res = await fetch(url);
      return res.ok ? await res.text() : undefined;
    }
    return await readFile(url, 'utf8');
  } catch {
    return undefined;
  }
}

/** FS path the script's relative sourcemap sources resolve against. */
function virtualScriptPath(url: string, serveRoot: string): string {
  if (url.startsWith('file://')) return fileURLToPath(url);
  if (/^https?:\/\//.test(url)) {
    return join(serveRoot, decodeURIComponent(new URL(url).pathname));
  }
  return url;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** Merge every executed V8 range into sorted, non-overlapping byte intervals. */
function coveredIntervals(functions: Profiler.FunctionCoverage[]): [number, number][] {
  const intervals: [number, number][] = [];
  for (const fn of functions) {
    for (const range of fn.ranges) {
      if (range.count > 0) intervals.push([range.startOffset, range.endOffset]);
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of intervals) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

function inIntervals(intervals: [number, number][], offset: number): boolean {
  let lo = 0;
  let hi = intervals.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e] = intervals[mid]!;
    if (offset < s) hi = mid - 1;
    else if (offset >= e) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * `sources` entries are bundler-dependent (relative to the map file, to the
 * build cwd, webpack://, url-absolute…). Normalizing to "the longest suffix
 * that exists under rootDir" is the only resolution that doesn't care.
 */
function toRepoRelative(sourcePath: string, virtualDir: string, rootDir: string): string | undefined {
  let p = sourcePath;
  if (p.startsWith('file://')) p = fileURLToPath(p);
  else if (/^https?:\/\//.test(p)) p = decodeURIComponent(new URL(p).pathname);
  p = p.replace(/^[a-z-]+:\/\//i, ''); // webpack://, vite://, turbopack://…

  let candidate: string;
  if (isAbsolute(p) || WIN_ABS.test(p)) {
    const rel = relative(rootDir, p);
    if (!rel.startsWith('..')) candidate = rel;
    else if (!WIN_ABS.test(p)) candidate = p.replace(/^\/+/, ''); // posix-abs = server path
    else candidate = '';
  } else {
    const rel = relative(rootDir, resolve(virtualDir, p));
    candidate = rel.startsWith('..') ? p.replace(/^[/\\]+/, '') : rel;
  }

  candidate = candidate.split(/[\\/]/).join('/');
  if (!candidate) return undefined;
  if (existsSync(join(rootDir, candidate))) return candidate;

  const segments = candidate.split('/');
  for (let i = 1; i < segments.length; i++) {
    const tail = segments.slice(i).join('/');
    if (existsSync(join(rootDir, tail))) return tail;
  }
  return undefined;
}

export async function resolveSources(entries: CoverageEntry[], options: ResolveOptions): Promise<ResolveResult> {
  const { rootDir } = options;
  const serveRoot = options.serveRoot ?? rootDir;
  const fetchText = options.fetchText ?? defaultFetchText;
  const exclusions = (options.filter ?? [])
    .filter((g) => g.startsWith('!'))
    .map((g) => picomatch(g.slice(1)));

  const sources = new Set<string>();
  const unresolved: string[] = [];

  for (const entry of entries) {
    if (!entry.url || entry.url.startsWith('node:')) continue;

    const source = entry.source ?? (await fetchText(entry.url));
    if (source === undefined) {
      unresolved.push(entry.url);
      continue;
    }

    const mapRef = MAP_REF_RE.exec(source)?.[1];
    let rawMap: string | undefined;
    if (mapRef?.startsWith('data:')) {
      rawMap = Buffer.from(mapRef.slice(mapRef.indexOf(',') + 1), 'base64').toString('utf8');
    } else if (mapRef) {
      rawMap = await fetchText(new URL(mapRef, entry.url).href);
    }
    if (!rawMap) {
      // A script with no sourcemap resolves only to the bundle itself —
      // useless for source selection, so it counts as unresolved.
      unresolved.push(entry.url);
      continue;
    }

    try {
      const map = new TraceMap(JSON.parse(rawMap));
      const virtualDir = dirname(virtualScriptPath(entry.url, serveRoot));
      const starts = lineStarts(source);
      const intervals = coveredIntervals(entry.functions);
      eachMapping(map, (mapping) => {
        if (!mapping.source) return;
        const offset = starts[mapping.generatedLine - 1]! + mapping.generatedColumn;
        if (!inIntervals(intervals, offset)) return;
        const rel = toRepoRelative(mapping.source, virtualDir, rootDir);
        if (!rel || rel.includes('node_modules/')) return;
        if (exclusions.some((isMatch) => isMatch(rel))) return;
        sources.add(rel);
      });
    } catch {
      unresolved.push(entry.url);
    }
  }

  return { sources: [...sources].sort(), unresolved };
}
