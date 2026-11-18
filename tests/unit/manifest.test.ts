import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyManifest, isSafeSpecKey, loadManifest, mergeSpec, pruneManifest, saveManifest } from '../../src/manifest.js';
import { appendSpecFragment, mergeFragments, readFragments } from '../../src/manifest.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tia-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadManifest', () => {
  it('returns an empty manifest when the file does not exist', async () => {
    expect(await loadManifest(join(dir, 'nope.json'))).toEqual({ version: 1, specs: {} });
  });

  it('returns an empty manifest on corrupt json', async () => {
    const path = join(dir, 'tia-manifest.json');
    await writeFile(path, '{not json');
    expect(await loadManifest(path)).toEqual({ version: 1, specs: {} });
  });

  it('returns an empty manifest on an unknown version', async () => {
    const path = join(dir, 'tia-manifest.json');
    await writeFile(path, JSON.stringify({ version: 99, specs: { 'a.spec.ts': { sources: [], updatedAt: 1 } } }));
    expect(await loadManifest(path)).toEqual({ version: 1, specs: {} });
  });

  it('drops malformed spec records instead of crashing', async () => {
    const path = join(dir, 'tia-manifest.json');
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        specs: {
          'ok.spec.ts': { sources: ['src/a.ts'], updatedAt: 1 },
          'bad.spec.ts': { sources: 'oops', updatedAt: 1 },
          'null.spec.ts': null,
        },
      }),
    );
    const manifest = await loadManifest(path);
    expect(Object.keys(manifest.specs)).toEqual(['ok.spec.ts']);
  });

  it('drops spec keys that escape the repo', async () => {
    const path = join(dir, 'tia-manifest.json');
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        specs: {
          'ok.spec.ts': { sources: ['src/a.ts'], updatedAt: 1 },
          '../evil.spec.ts': { sources: ['src/a.ts'], updatedAt: 1 },
          '__proto__': { sources: ['src/a.ts'], updatedAt: 1 },
        },
      }),
    );
    const manifest = await loadManifest(path);
    expect(Object.keys(manifest.specs)).toEqual(['ok.spec.ts']);
  });
});

describe('saveManifest + loadManifest', () => {
  it('roundtrips', async () => {
    const path = join(dir, 'tia-manifest.json');
    const manifest = mergeSpec(emptyManifest(), 'tests/checkout.spec.ts', ['src/cart.ts'], 42);
    await saveManifest(path, manifest);
    expect(await loadManifest(path)).toEqual(manifest);
  });

  it('writes spec keys sorted for stable diffs', async () => {
    const path = join(dir, 'tia-manifest.json');
    let manifest = mergeSpec(emptyManifest(), 'z.spec.ts', [], 1);
    manifest = mergeSpec(manifest, 'a.spec.ts', [], 1);
    await saveManifest(path, manifest);
    const written = JSON.parse(await readFile(path, 'utf8')) as { specs: Record<string, unknown> };
    expect(Object.keys(written.specs)).toEqual(['a.spec.ts', 'z.spec.ts']);
  });

  it('leaves no temp file behind after writing', async () => {
    const path = join(dir, 'tia-manifest.json');
    await saveManifest(path, emptyManifest());
    const files = await import('node:fs/promises').then((fs) => fs.readdir(dir));
    expect(files.filter((f) => f.includes('.tmp'))).toEqual([]);
    expect(await loadManifest(path)).toEqual({ version: 1, specs: {} });
  });
});

describe('mergeSpec', () => {
  it('normalizes windows separators, sorts and dedupes sources', () => {
    const manifest = mergeSpec(emptyManifest(), 'tests\\checkout.spec.ts', ['src/z.ts', 'src/a.ts', 'src/a.ts'], 100);
    expect(manifest.specs['tests/checkout.spec.ts']).toEqual({
      sources: ['src/a.ts', 'src/z.ts'],
      updatedAt: 100,
    });
  });

  it('replaces sources on re-run instead of unioning', () => {
    let manifest = mergeSpec(emptyManifest(), 'a.spec.ts', ['src/old.ts'], 1);
    manifest = mergeSpec(manifest, 'a.spec.ts', ['src/new.ts'], 2);
    expect(manifest.specs['a.spec.ts']!.sources).toEqual(['src/new.ts']);
    expect(manifest.specs['a.spec.ts']!.updatedAt).toBe(2);
  });

  it('rejects keys that would escape the repo or pollute the prototype', () => {
    let manifest = mergeSpec(emptyManifest(), '__proto__', ['src/x.ts'], 1);
    manifest = mergeSpec(manifest, '../outside.spec.ts', ['src/x.ts'], 1);
    manifest = mergeSpec(manifest, 'C:/abs.spec.ts', ['src/x.ts'], 1);
    manifest = mergeSpec(manifest, '/abs.spec.ts', ['src/x.ts'], 1);
    expect(Object.keys(manifest.specs)).toEqual([]);
    expect(Object.getPrototypeOf(manifest.specs)).toBe(Object.prototype);
  });
});

describe('isSafeSpecKey', () => {
  it('accepts normal repo-relative paths', () => {
    expect(isSafeSpecKey('tests/a.spec.ts')).toBe(true);
    expect(isSafeSpecKey('e2e/sub/dir b/x.test.ts')).toBe(true);
  });

  it('rejects traversal, absolute and prototype keys', () => {
    expect(isSafeSpecKey('')).toBe(false);
    expect(isSafeSpecKey('__proto__')).toBe(false);
    expect(isSafeSpecKey('../x.spec.ts')).toBe(false);
    expect(isSafeSpecKey('a/../../x.spec.ts')).toBe(false);
    expect(isSafeSpecKey('/x.spec.ts')).toBe(false);
    expect(isSafeSpecKey('C:/x.spec.ts')).toBe(false);
  });
});

describe('pruneManifest', () => {
  it('drops specs not present in the current run', () => {
    let manifest = mergeSpec(emptyManifest(), 'keep.spec.ts', ['src/a.ts'], 1);
    manifest = mergeSpec(manifest, 'gone.spec.ts', ['src/b.ts'], 1);
    pruneManifest(manifest, ['keep.spec.ts']);
    expect(Object.keys(manifest.specs)).toEqual(['keep.spec.ts']);
  });
});

describe('emptyManifest', () => {
  it('returns version 1 with no specs', () => {
    expect(emptyManifest()).toEqual({ version: 1, specs: {} });
  });
});

describe('appendSpecFragment + readFragments', () => {
  it('appends jsonl entries per spec and reads them back', async () => {
    const fragDir = join(dir, 'fragments');
    await appendSpecFragment(fragDir, 0, 'tests/a.spec.ts', ['src/a.ts'], 10);
    await appendSpecFragment(fragDir, 0, 'tests/b.spec.ts', ['src/b.ts'], 11);
    await appendSpecFragment(fragDir, 1, 'tests/c.spec.ts', ['src/c.ts'], 12);

    const records = await readFragments(fragDir);
    expect(records.get('tests/a.spec.ts')).toEqual({ sources: ['src/a.ts'], updatedAt: 10 });
    expect(records.get('tests/b.spec.ts')).toEqual({ sources: ['src/b.ts'], updatedAt: 11 });
    expect(records.get('tests/c.spec.ts')).toEqual({ sources: ['src/c.ts'], updatedAt: 12 });
  });

  it('unions sources when a spec records more than once (retries, projects)', async () => {
    const fragDir = join(dir, 'fragments');
    await appendSpecFragment(fragDir, 0, 'a.spec.ts', ['src/old.ts'], 1);
    await appendSpecFragment(fragDir, 1, 'a.spec.ts', ['src/new.ts'], 2);
    await expect(readFragments(fragDir)).resolves.toEqual(
      new Map([['a.spec.ts', { sources: ['src/new.ts', 'src/old.ts'], updatedAt: 2 }]]),
    );
  });

  it('returns an empty map when the directory does not exist', async () => {
    expect(await readFragments(join(dir, 'nope'))).toEqual(new Map());
  });

  it('skips torn lines instead of failing the whole read', async () => {
    const fragDir = join(dir, 'fragments');
    await appendSpecFragment(fragDir, 0, 'a.spec.ts', ['src/a.ts'], 1);
    await writeFile(
      join(fragDir, '1.jsonl'),
      `${JSON.stringify({ spec: 'b.spec.ts', sources: ['src/b.ts'], updatedAt: 2 })}\n{corrupt-line\n`,
      'utf8',
    );
    const records = await readFragments(fragDir);
    expect(records.get('a.spec.ts')).toBeDefined();
    expect(records.get('b.spec.ts')).toBeDefined();
    expect(records.size).toBe(2);
  });

  it('ignores directories that end in .jsonl', async () => {
    const fragDir = join(dir, 'fragments');
    await appendSpecFragment(fragDir, 0, 'a.spec.ts', ['src/a.ts'], 1);
    await mkdir(join(fragDir, 'weird.jsonl'), { recursive: true });
    const records = await readFragments(fragDir);
    expect(records.size).toBe(1);
  });

  it('drops fragment lines with unsafe spec keys', async () => {
    const fragDir = join(dir, 'fragments');
    await mkdir(fragDir, { recursive: true });
    await writeFile(
      join(fragDir, '0.jsonl'),
      [
        JSON.stringify({ spec: '../evil.spec.ts', sources: ['src/x.ts'], updatedAt: 1 }),
        JSON.stringify({ spec: '__proto__', sources: ['src/x.ts'], updatedAt: 1 }),
        JSON.stringify({ spec: 'ok.spec.ts', sources: ['src/ok.ts'], updatedAt: 1 }),
        '',
      ].join('\n'),
      'utf8',
    );
    const records = await readFragments(fragDir);
    expect([...records.keys()]).toEqual(['ok.spec.ts']);
  });

  it('treats a non-numeric updatedAt as stale instead of NaN', async () => {
    const fragDir = join(dir, 'fragments');
    await mkdir(fragDir, { recursive: true });
    await writeFile(
      join(fragDir, '0.jsonl'),
      `${JSON.stringify({ spec: 'a.spec.ts', sources: ['src/a.ts'], updatedAt: 'whenever' })}\n`,
      'utf8',
    );
    const records = await readFragments(fragDir);
    expect(records.get('a.spec.ts')!.updatedAt).toBe(0);
  });
});

describe('mergeFragments', () => {
  it('merges fragments into a manifest and prunes deleted specs', async () => {
    const fragDir = join(dir, 'fragments');
    await appendSpecFragment(fragDir, 0, 'a.spec.ts', ['src/a.ts'], 1);

    const stale = mergeSpec(emptyManifest(), 'deleted.spec.ts', ['src/x.ts'], 1);
    const merged = await mergeFragments(fragDir, stale, ['a.spec.ts']);
    expect(Object.keys(merged.specs)).toEqual(['a.spec.ts']);
    expect(Object.keys(merged.specs)).toEqual(['a.spec.ts']);
    expect(merged.specs['a.spec.ts']!.sources).toEqual(['src/a.ts']);
  });
});
