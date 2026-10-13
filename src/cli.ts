#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import picomatch from 'picomatch';

import { defaultConfig, type TiaConfig } from './config.js';
import { loadManifest, mergeFragments, normalizeSpecPath, saveManifest } from './manifest.js';
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

Options:
  --base <ref>   Git ref to diff against (default: config baseRef).
  --json         Emit the full result as JSON.
  --all          Bypass selection and list every spec.
`;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function loadConfig(rootDir: string): Promise<TiaConfig> {
  try {
    const raw = JSON.parse(await readFile(join(rootDir, 'playwright-tia.config.json'), 'utf8')) as Partial<TiaConfig>;
    return { ...defaultConfig, ...raw, coverage: { ...defaultConfig.coverage, ...raw.coverage } };
  } catch {
    return defaultConfig;
  }
}

async function gitChangedFiles(rootDir: string, base: string): Promise<string[]> {
  const diff = async (args: string[]) => (await execFileAsync('git', args, { cwd: rootDir })).stdout;
  const files = new Set<string>();
  const outputs = [
    await diff(['diff', '--name-only', `${base}...HEAD`]),
    await diff(['diff', '--name-only']), // unstaged
    await diff(['diff', '--cached', '--name-only']), // staged
  ];
  for (const out of outputs) {
    for (const line of out.split('\n')) {
      const file = line.trim();
      if (file) files.add(normalizeSpecPath(file));
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
        const rel = normalizeSpecPath(relative(rootDir, full));
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

  if (command === 'collect') {
    const manifestPath = join(cwd, config.manifestPath);
    const currentSpecs = await walkSpecs(cwd, config.specGlob);
    const manifest = await mergeFragments(join(cwd, '.tia', 'fragments'), await loadManifest(manifestPath), currentSpecs);
    await saveManifest(manifestPath, manifest);
    return { code: 0, stdout: '', stderr: `pw-tia: manifest written (${Object.keys(manifest.specs).length} spec(s))` };
  }

  if (command !== 'affected') {
    return { code: 1, stdout: '', stderr: `pw-tia: unknown command '${command}'\n${USAGE}` };
  }

  const flag = (name: string): string | undefined => {
    const idx = rest.indexOf(`--${name}`);
    if (idx !== -1) return rest[idx + 1];
    const eq = rest.find((a) => a.startsWith(`--${name}=`));
    return eq?.split('=')[1];
  };
  const base = flag('base') ?? config.baseRef;
  const asJson = rest.includes('--json');
  const all = rest.includes('--all');

  const runAllSpecs = (reason: string): AffectedResult => ({
    specs: currentSpecs.map((spec) => ({ spec, triggeredBy: [], reason: 'run-all' })),
    runAll: true,
    reason,
  });
  const currentSpecs = await walkSpecs(cwd, config.specGlob);
  if (all) {
    return emit(runAllSpecs('--all'), asJson, 0);
  }

  let changed: string[];
  try {
    changed = await gitChangedFiles(cwd, base);
  } catch (error) {
    return emit(runAllSpecs(`git error: ${error instanceof Error ? error.message : String(error)}`), asJson, 0);
  }
  const manifest = await loadManifest(join(cwd, config.manifestPath));
  return emit(selectAffected(manifest, changed, currentSpecs, config), asJson, changed.length);

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
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  void run(process.argv.slice(2)).then(({ code, stdout, stderr }) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(`${stderr}\n`);
    process.exitCode = code;
  });
}
