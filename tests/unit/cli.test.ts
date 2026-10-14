import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../../src/cli.js';
import type { TiaManifest } from '../../src/manifest.js';

const git = promisify(execFile);

let dir: string;

async function gitRun(...args: string[]): Promise<void> {
  await git('git', args, { cwd: dir });
}

async function commitFile(path: string, content: string, message = 'commit'): Promise<void> {
  const full = join(dir, path);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content);
  await gitRun('add', path);
  await gitRun('commit', '-qm', message);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tia-cli-'));
  await gitRun('init', '-q');
  await gitRun('config', 'user.email', 't@t.t');
  await gitRun('config', 'user.name', 't');
});

afterEach(async () => {
  // Windows may hold fs handles briefly after git exits — retry removal.
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const manifest: TiaManifest = {
  version: 1,
  specs: {
    'tests/cart.spec.ts': { sources: ['src/cart.ts'], updatedAt: Math.floor(Date.now() / 1000) },
    'tests/profile.spec.ts': { sources: ['src/profile.ts'], updatedAt: Math.floor(Date.now() / 1000) },
  },
};

describe('pw-tia affected', () => {
  it('prints only the specs whose sources changed', async () => {
    await commitFile('tia-manifest.json', JSON.stringify(manifest));
    await commitFile('src/cart.ts', 'export const x = 1');
    await commitFile('tests/cart.spec.ts', '// test');
    await commitFile('tests/profile.spec.ts', '// test');
    await commitFile('src/cart.ts', 'export const x = 2', 'change cart');

    const { stdout, code } = await run(['affected', '--base', 'HEAD~1'], dir);
    expect(code).toBe(0);
    expect(stdout.trim().split('\n').sort()).toEqual(['tests/cart.spec.ts']);
  });

  it('prints run-all and explains when no manifest exists', async () => {
    await commitFile('tests/only.spec.ts', '// test');
    const { stdout, stderr, code } = await run(['affected', '--base', 'HEAD'], dir);
    expect(code).toBe(0);
    expect(stdout).toContain('tests/only.spec.ts');
    expect(stderr).toContain('no-manifest');
  });

  it('emits json with reasons', async () => {
    await commitFile('tia-manifest.json', JSON.stringify(manifest));
    await commitFile('src/cart.ts', 'x');
    await commitFile('src/cart.ts', 'y', 'change');
    const { stdout } = await run(['affected', '--base', 'HEAD~1', '--json'], dir);
    const result = JSON.parse(stdout) as { specs: { spec: string; triggeredBy: string[] }[] };
    expect(result.specs).toEqual([
      { spec: 'tests/cart.spec.ts', triggeredBy: ['src/cart.ts'], reason: 'changed-source' },
    ]);
  });

  it('resolves paths relative to a project in a monorepo subdir', async () => {
    const sub = join(dir, 'packages', 'app');
    await mkdir(sub, { recursive: true });
    const subManifest: TiaManifest = {
      version: 1,
      specs: { 'tests/cart.spec.ts': { sources: ['src/cart.ts'], updatedAt: Math.floor(Date.now() / 1000) } },
    };
    await writeFile(join(sub, 'tia-manifest.json'), JSON.stringify(subManifest));
    await mkdir(join(sub, 'src'), { recursive: true });
    await writeFile(join(sub, 'src', 'cart.ts'), 'x');
    await writeFile(join(dir, 'other.ts'), 'x');
    await gitRun('add', '-A');
    await gitRun('commit', '-qm', 'base');
    await writeFile(join(sub, 'src', 'cart.ts'), 'y');
    await gitRun('commit', '-qam', 'touch cart');

    const { stdout, code } = await run(['affected', '--base', 'HEAD~1'], sub);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('tests/cart.spec.ts');
  });

  it('detects unstaged worktree changes', async () => {
    await commitFile('tia-manifest.json', JSON.stringify(manifest));
    await commitFile('src/cart.ts', 'x');
    await writeFile(join(dir, 'src', 'cart.ts'), 'y'); // modified, not committed
    const { stdout } = await run(['affected', '--base', 'HEAD'], dir);
    expect(stdout).toContain('tests/cart.spec.ts');
  });

  it('runs everything when the base ref does not exist', async () => {
    await commitFile('tia-manifest.json', JSON.stringify(manifest));
    await commitFile('src/cart.ts', 'x');
    const { stdout, stderr, code } = await run(['affected', '--base', 'no-such-ref'], dir);
    expect(code).toBe(0);
    expect(stderr).toContain('git error');
    expect(stdout).toContain('tests/cart.spec.ts');
    expect(stdout).toContain('tests/profile.spec.ts');
  });

  it('lists every spec with --all', async () => {
    await commitFile('tia-manifest.json', JSON.stringify(manifest));
    await commitFile('src/cart.ts', 'x');
    const { stdout, stderr } = await run(['affected', '--all'], dir);
    expect(stderr).toContain('run all');
    expect(stdout).toContain('tests/cart.spec.ts');
    expect(stdout).toContain('tests/profile.spec.ts');
  });

  it('accepts --base=<ref> syntax', async () => {
    await commitFile('tia-manifest.json', JSON.stringify(manifest));
    await commitFile('src/cart.ts', 'x');
    await commitFile('src/cart.ts', 'y', 'change');
    const { stdout } = await run(['affected', '--base=HEAD~1'], dir);
    expect(stdout.trim()).toBe('tests/cart.spec.ts');
  });
});

describe('pw-tia affected --files', () => {
  it('selects from an explicit file list instead of the git diff', async () => {
    await commitFile('tia-manifest.json', JSON.stringify(manifest));
    await commitFile('tests/cart.spec.ts', '');
    await commitFile('tests/profile.spec.ts', '');
    // clean tree — git diff is empty, --files drives the selection
    const { stdout, code } = await run(['affected', '--files', 'src/cart.ts'], dir);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('tests/cart.spec.ts');
  });

  it('accepts comma- and newline-separated lists', async () => {
    await commitFile('tia-manifest.json', JSON.stringify(manifest));
    const { stdout } = await run(['affected', '--files', 'src/cart.ts,src/profile.ts'], dir);
    expect(stdout.trim().split('\n').sort()).toEqual(['tests/cart.spec.ts', 'tests/profile.spec.ts']);
  });

  it('reads the list from stdin with --files -', async () => {
    await commitFile('tia-manifest.json', JSON.stringify(manifest));
    const { stdout } = await run(['affected', '--files', '-'], dir, 'src/profile.ts\n');
    expect(stdout.trim()).toBe('tests/profile.spec.ts');
  });

  it('works without a git repository', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'tia-nogit-'));
    try {
      await writeFile(join(plain, 'tia-manifest.json'), JSON.stringify(manifest));
      await mkdir(join(plain, 'src'), { recursive: true });
      await writeFile(join(plain, 'src', 'cart.ts'), 'x');
      const { stdout, code } = await run(['affected', '--files', 'src/cart.ts'], plain);
      expect(code).toBe(0);
      expect(stdout.trim()).toBe('tests/cart.spec.ts');
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe('pw-tia run', () => {
  it('--dry-run prints the playwright command with the selected specs', async () => {
    await commitFile('tia-manifest.json', JSON.stringify(manifest));
    await commitFile('tests/cart.spec.ts', '');
    const { stdout, stderr, code } = await run(['run', '--files', 'src/cart.ts', '--dry-run'], dir);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('playwright test tests/cart.spec.ts');
    expect(stderr).toContain('1 affected spec(s)');
  });

  it('runs the whole suite (no spec args) when selection degrades to run-all', async () => {
    const { stdout } = await run(['run', '--all', '--dry-run'], dir);
    expect(stdout.trim()).toBe('playwright test');
  });

  it('exits 0 with an explanation when nothing is affected', async () => {
    await commitFile('tia-manifest.json', JSON.stringify(manifest));
    const { stdout, stderr, code } = await run(['run', '--files', 'README.md'], dir);
    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain('nothing affected');
  });

  it('forwards args after -- to playwright', async () => {
    await commitFile('tia-manifest.json', JSON.stringify(manifest));
    const { stdout } = await run(['run', '--files', 'src/cart.ts', '--dry-run', '--', '--grep', 'smoke'], dir);
    expect(stdout.trim()).toBe('playwright test tests/cart.spec.ts --grep smoke');
  });
});

describe('pw-tia doctor', () => {
  it('reports a healthy setup', async () => {
    await commitFile('tia-manifest.json', JSON.stringify(manifest));
    await commitFile('tests/cart.spec.ts', '');
    await commitFile('tests/profile.spec.ts', '');
    const { code, stdout } = await run(['doctor'], dir);
    expect(code).toBe(0);
    expect(stdout).toContain('manifest: 2 spec record(s)');
    expect(stdout).toContain('specs on disk: 2');
    expect(stdout).toContain('git: repository ok');
  });

  it('warns when the manifest is missing and specs have no coverage', async () => {
    await commitFile('tests/cart.spec.ts', '');
    await commitFile('tests/profile.spec.ts', '');
    const { stdout } = await run(['doctor'], dir);
    expect(stdout).toContain('manifest: missing or empty');
    expect(stdout).toContain('no coverage yet: 2 spec(s)');
  });
});

describe('pw-tia doctor --json', () => {
  it('emits a machine-readable report', async () => {
    await commitFile('tia-manifest.json', JSON.stringify(manifest));
    await commitFile('tests/cart.spec.ts', '');
    await commitFile('tests/profile.spec.ts', '');
    await commitFile('tests/new.spec.ts', '');
    const { stdout, code } = await run(['doctor', '--json'], dir);
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as {
      git: boolean;
      manifest: { records: number };
      specsOnDisk: number;
      uncovered: string[];
      orphaned: string[];
      shared: { file: string; specCount: number }[];
    };
    expect(report.git).toBe(true);
    expect(report.manifest.records).toBe(2);
    expect(report.specsOnDisk).toBe(3);
    expect(report.uncovered).toEqual(['tests/new.spec.ts']);
    expect(report.orphaned).toEqual([]);
    expect(report.shared).toEqual([]);
  });
});

describe('pw-tia init', () => {
  it('writes a config file, gitignores .tia and reports next steps', async () => {
    await commitFile('tests/a.spec.ts', "import { test } from 'playwright-tia';");
    const { code, stdout } = await run(['init'], dir);
    expect(code).toBe(0);
    expect(stdout).toContain('playwright-tia.config.json');
    const config = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(dir, 'playwright-tia.config.json'), 'utf8'))) as { specGlob: string[] };
    expect(config.specGlob.length).toBeGreaterThan(0);
    const gitignore = await import('node:fs/promises').then((fs) => fs.readFile(join(dir, '.gitignore'), 'utf8'));
    expect(gitignore).toContain('.tia/');
    expect(stdout).toContain('1 spec(s) already collect coverage');
  });

  it('warns about specs still importing @playwright/test', async () => {
    await commitFile('tests/a.spec.ts', "import { test } from '@playwright/test';");
    const { stdout } = await run(['init'], dir);
    expect(stdout).toContain('1 spec(s) still import @playwright/test');
    expect(stdout).toContain("from 'playwright-tia'");
  });

  it('is idempotent — never overwrites an existing config', async () => {
    await commitFile('playwright-tia.config.json', '{ "sharedThreshold": 0.5 }');
    const { code, stdout } = await run(['init'], dir);
    expect(code).toBe(0);
    expect(stdout).toContain('already exists');
    const raw = await import('node:fs/promises').then((fs) => fs.readFile(join(dir, 'playwright-tia.config.json'), 'utf8'));
    expect(raw).toContain('0.5');
  });
});

describe('pw-tia usage', () => {
  it('prints usage on --help and unknown commands fail', async () => {
    const help = await run(['--help'], dir);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('pw-tia');

    const bad = await run(['bogus'], dir);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('unknown command');
  });
});

describe('pw-tia collect', () => {
  it('merges fragments into the manifest file', async () => {
    await commitFile('tests/a.spec.ts', '// test');
    await mkdir(join(dir, '.tia', 'fragments'), { recursive: true });
    await writeFile(
      join(dir, '.tia', 'fragments', '0.jsonl'),
      `${JSON.stringify({ spec: 'tests/a.spec.ts', sources: ['src/a.ts'], updatedAt: Math.floor(Date.now() / 1000) })}\n`,
    );
    const { stderr, code } = await run(['collect'], dir);
    expect(code).toBe(0);
    expect(stderr).toContain('1');
    const written = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(dir, 'tia-manifest.json'), 'utf8'))) as TiaManifest;
    expect(written.specs['tests/a.spec.ts']!.sources).toEqual(['src/a.ts']);
  });

  it('keeps records for spec files that exist on disk even when specGlob misses them', async () => {
    // exists on disk but does not match **/*.spec.* or **/*.test.*
    await commitFile('scripts/smoke.check.ts', '// spec with odd suffix');
    await writeFile(
      join(dir, 'tia-manifest.json'),
      JSON.stringify({ version: 1, specs: { 'scripts/smoke.check.ts': { sources: ['src/s.ts'], updatedAt: Math.floor(Date.now() / 1000) } } }),
    );
    const { code } = await run(['collect'], dir);
    expect(code).toBe(0);
    const written = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(dir, 'tia-manifest.json'), 'utf8'))) as TiaManifest;
    expect(written.specs['scripts/smoke.check.ts']).toBeDefined();
  });
});
