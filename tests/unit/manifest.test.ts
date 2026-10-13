import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyManifest, loadManifest, mergeSpec, pruneManifest, saveManifest } from '../../src/manifest.js';
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

  it('last write wins when a spec re-runs', async () => {
    const fragDir = join(dir, 'fragments');
    await appendSpecFragment(fragDir, 0, 'a.spec.ts', ['src/old.ts'], 1);
    await appendSpecFragment(fragDir, 0, 'a.spec.ts', ['src/new.ts'], 2);
    await expect(readFragments(fragDir)).resolves.toEqual(
      new Map([['a.spec.ts', { sources: ['src/new.ts'], updatedAt: 2 }]]),
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
