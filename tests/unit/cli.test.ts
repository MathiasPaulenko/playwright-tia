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
});
