import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyManifest, loadManifest, mergeSpec, pruneManifest, saveManifest } from '../../src/manifest.js';

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
});

describe('saveManifest + loadManifest', () => {
  it('roundtrips', async () => {
    const path = join(dir, 'tia-manifest.json');
    const manifest = mergeSpec(emptyManifest(), 'tests/checkout.spec.ts', ['src/cart.ts'], 42);
    await saveManifest(path, manifest);
    expect(await loadManifest(path)).toEqual(manifest);
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
