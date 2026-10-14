#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import picomatch from 'picomatch';

import { loadConfig, type TiaConfig } from './config.js';
import { loadManifest, mergeFragments, normalizeRepoPath, saveManifest } from './manifest.js';
import { selectAffected, type AffectedResult } from './selector.js';

const execFileAsync = promisify(execFile);

const USAGE = `pw-tia — Test Impact Analysis for Playwright

Usage:
  pw-tia affected [--base <ref>] [--json] [--all]
  pw-tia collect

Commands:
  affected   Print the specs to run for the current diff (stdout = spec paths,
             explanations go to stderr).
  collect    Merge .tia/fragments into tia-manifest.json after a coverage run.
  doctor     Diagnose the setup: manifest health, uncovered specs, shared files.

Options:
  --base <ref>   Git ref to diff against (default: config baseRef).
  --json         Emit the full result as JSON.
  --all          Bypass selection and list every spec.
  --dry-run      Accepted for readability; 'affected' never runs anything.
`;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * git reports paths relative to the repo root; the manifest is relative to
 * rootDir. In monorepos (rootDir = packages/foo) we strip the prefix and keep
 * only files under the project — outside changes can't be covered anyway.
 */
async function gitChangedFiles(rootDir: string, base: string): Promise<string[]> {
  const { stdout: topLevel } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
    cwd: rootDir,
  });
  const gitRoot = topLevel.trim();
  const prefix = normalizeRepoPath(relative(gitRoot, rootDir));
  const diff = async (args: string[]) => (await execFileAsync('git', args, { cwd: gitRoot })).stdout;
  const files = new Set<string>();
  const outputs = await Promise.all([
    diff(['diff', '--name-only', `${base}...HEAD`]),
    diff(['diff', '--name-only']), // unstaged
    diff(['diff', '--cached', '--name-only']), // staged
  ]);
  for (const out of outputs) {
    for (const line of out.split('\n')) {
      const file = normalizeRepoPath(line.trim());
      if (!file) continue;
      if (prefix && file !== prefix && !file.startsWith(`${prefix}/`)) continue;
      files.add(prefix ? file.slice(prefix.length + 1) : file);
    }
  }
  return [...files].sort();
}

async function walkSpecs(rootDir: string, globs: string[]): Promise<string[]> {
  const matchers = globs.map((g) => picomatch(g));
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const rel = normalizeRepoPath(relative(rootDir, full));
        if (matchers.some((m) => m(rel))) found.push(rel);
      }
    }
  };
  await walk(rootDir);
  return found.sort();
}

function explain(result: AffectedResult, changedCount: number): string {
  if (result.runAll) {
    return `pw-tia: run all ${result.specs.length} spec(s) (${result.reason})`;
  }
  const byFile = new Map<string, string[]>();
  const other: string[] = [];
  for (const spec of result.specs) {
    if (spec.triggeredBy.length === 0) {
      other.push(`${spec.spec} (${spec.reason})`);
      continue;
    }
    for (const file of spec.triggeredBy) {
      byFile.set(file, [...(byFile.get(file) ?? []), spec.spec]);
    }
  }
  const lines = [`pw-tia: ${result.specs.length} affected spec(s) from ${changedCount} changed file(s)`];
  for (const [file, specs] of [...byFile].sort()) {
    lines.push(`  ${file} → ${specs.join(', ')}`);
  }
  for (const line of other.sort()) {
    lines.push(`  ${line}`);
  }
  for (const shared of result.shared ?? []) {
    lines.push(`  shared: ${shared.file} is covered by ${shared.specCount} spec(s) — wide selection expected`);
  }
  return lines.join('\n');
}

export async function run(argv: string[], cwd: string = process.cwd()): Promise<RunResult> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    return { code: 0, stdout: USAGE, stderr: '' };
  }

  const config = await loadConfig(cwd);

  if (command === 'doctor') {
    return doctor(cwd, config);
  }

  if (command === 'collect') {
    const manifestPath = join(cwd, config.manifestPath);
    const loaded = await loadManifest(manifestPath);
    // Prune only specs that no longer exist on disk — a specGlob that misses
    // files must not wipe their records.
    const existing = Object.keys(loaded.specs).filter((spec) => existsSync(join(cwd, spec)));
    const currentSpecs = [...new Set([...(await walkSpecs(cwd, config.specGlob)), ...existing])];
    const manifest = await mergeFragments(join(cwd, '.tia', 'fragments'), loaded, currentSpecs);
    await saveManifest(manifestPath, manifest);
    return { code: 0, stdout: '', stderr: `pw-tia: manifest written (${Object.keys(manifest.specs).length} spec(s))` };
  }

  if (command !== 'affected') {
    return { code: 1, stdout: '', stderr: `pw-tia: unknown command '${command}'\n${USAGE}` };
  }

  const flag = (name: string): string | undefined => {
    const idx = rest.indexOf(`--${name}`);
    if (idx !== -1) {
      const value = rest[idx + 1];
      return value?.startsWith('--') ? undefined : value;
    }
    const eq = rest.find((a) => a.startsWith(`--${name}=`));
    return eq?.split('=')[1];
  };
  const base = flag('base') ?? config.baseRef;
  const asJson = rest.includes('--json');
  const all = rest.includes('--all');

  const manifest = await loadManifest(join(cwd, config.manifestPath));
  const currentSpecs = await walkSpecs(cwd, config.specGlob);
  // Run-all must list manifest specs too — a specGlob that misses files
  // shouldn't make them invisible when we fall back to everything.
  const allSpecs = [...new Set([...currentSpecs, ...Object.keys(manifest.specs)])].sort();
  const runAllSpecs = (reason: string): AffectedResult => ({
    specs: allSpecs.map((spec) => ({ spec, triggeredBy: [], reason: 'run-all' })),
    runAll: true,
    reason,
  });
  if (all) {
    return emit(runAllSpecs('--all'), asJson, 0);
  }

  let changed: string[];
  try {
    changed = await gitChangedFiles(cwd, base);
  } catch (error) {
    return emit(runAllSpecs(`git error: ${error instanceof Error ? error.message : String(error)}`), asJson, 0);
  }
  return emit(selectAffected(manifest, changed, currentSpecs, config), asJson, changed.length);
}

async function doctor(cwd: string, config: TiaConfig): Promise<RunResult> {
  const lines: string[] = [];

  const configExists = existsSync(join(cwd, 'playwright-tia.config.json'));
  lines.push(configExists ? 'config: playwright-tia.config.json' : 'config: defaults (no playwright-tia.config.json)');

  const gitOk = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd })
    .then(() => true)
    .catch(() => false);
  lines.push(gitOk ? 'git: repository ok' : 'git: NOT a repository — affected will always run everything');

  const manifest = await loadManifest(join(cwd, config.manifestPath));
  const specCount = Object.keys(manifest.specs).length;
  lines.push(specCount > 0 ? `manifest: ${specCount} spec record(s)` : 'manifest: missing or empty — first run will execute everything and learn');

  const diskSpecs = await walkSpecs(cwd, config.specGlob);
  lines.push(`specs on disk: ${diskSpecs.length} (via specGlob)`);

  const missing = diskSpecs.filter((s) => !manifest.specs[s]);
  if (missing.length > 0) {
    lines.push(`no coverage yet: ${missing.length} spec(s) always run (new-spec)${list(missing)}`);
  }
  const orphans = Object.keys(manifest.specs).filter((s) => !existsSync(join(cwd, s)));
  if (orphans.length > 0) {
    lines.push(`stale records: ${orphans.length} spec(s) no longer exist — 'collect' prunes them${list(orphans)}`);
  }
  const empty = Object.entries(manifest.specs)
    .filter(([, r]) => r.sources.length === 0)
    .map(([s]) => s);
  if (empty.length > 0) {
    lines.push(`zero sources: ${empty.length} spec(s) always run (no-sources)${list(empty)}`);
  }
  const staleBefore = config.recordMaxAgeDays > 0
    ? Math.floor(Date.now() / 1000) - config.recordMaxAgeDays * 86400
    : 0;
  const stale = Object.entries(manifest.specs)
    .filter(([, r]) => staleBefore > 0 && r.updatedAt < staleBefore)
    .map(([s]) => s);
  if (stale.length > 0) {
    lines.push(`stale: ${stale.length} spec(s) not refreshed in ${config.recordMaxAgeDays}d+ always run (stale-record)${list(stale)}`);
  }
  const coverage = new Map<string, number>();
  for (const record of Object.values(manifest.specs)) {
    for (const src of record.sources) coverage.set(src, (coverage.get(src) ?? 0) + 1);
  }
  const shared = [...coverage.entries()]
    .filter(([, n]) => specCount > 0 && n / specCount >= config.sharedThreshold)
    .sort((a, b) => b[1] - a[1]);
  if (shared.length > 0) {
    lines.push(`shared files (>=${config.sharedThreshold}):${list(shared.map(([f, n]) => `${f} (${n} specs)`))}`);
  }
  return { code: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };

  function list(items: string[]): string {
    const shown = items.slice(0, 5);
    return `\n    ${shown.join('\n    ')}${items.length > shown.length ? `\n    … +${items.length - shown.length}` : ''}`;
  }
}

function emit(result: AffectedResult, asJson: boolean, changedCount: number): RunResult {
  if (asJson) {
    return { code: 0, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: explain(result, changedCount) };
  }
  return {
    code: 0,
    stdout: result.specs.length ? `${result.specs.map((s) => s.spec).join('\n')}\n` : '',
    stderr: explain(result, changedCount),
  };
}

// npm's .bin shim invokes the script through an unnormalized path
// ("node_modules/.bin/../pkg/dist/cli.js"), so argv[1] needs resolving
// and realpath before comparing.
const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  void run(process.argv.slice(2)).then(({ code, stdout, stderr }) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(`${stderr}\n`);
    process.exitCode = code;
  });
}
