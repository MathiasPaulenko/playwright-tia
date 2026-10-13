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
  await rm(dir, { recursive: true, force: true });
});

const manifest: TiaManifest = {
  version: 1,
  specs: {
    'tests/cart.spec.ts': { sources: ['src/cart.ts'], updatedAt: 1 },
    'tests/profile.spec.ts': { sources: ['src/profile.ts'], updatedAt: 1 },
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
      specs: { 'tests/cart.spec.ts': { sources: ['src/cart.ts'], updatedAt: 1 } },
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
      `${JSON.stringify({ spec: 'tests/a.spec.ts', sources: ['src/a.ts'], updatedAt: 5 })}\n`,
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
      JSON.stringify({ version: 1, specs: { 'scripts/smoke.check.ts': { sources: ['src/s.ts'], updatedAt: 1 } } }),
    );
    const { code } = await run(['collect'], dir);
    expect(code).toBe(0);
    const written = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(dir, 'tia-manifest.json'), 'utf8'))) as TiaManifest;
    expect(written.specs['scripts/smoke.check.ts']).toBeDefined();
  });
});
