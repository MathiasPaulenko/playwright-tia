import type { Profiler } from 'node:inspector';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';

import { resolveSources, type CoverageEntry } from '../../src/resolve.js';

const appDir = fileURLToPath(new URL('../fixtures/app', import.meta.url));

let bundle: string;
beforeAll(async () => {
  const result = await build({
    entryPoints: [join(appDir, 'src/main.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    sourcemap: 'inline',
    logLevel: 'silent',
  });
  bundle = result.outputFiles[0]!.text;
});

function covered(source: string, coveredMarker?: string): Profiler.FunctionCoverage[] {
  if (!coveredMarker) {
    return [{ functionName: 'main', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] }];
  }
  const idx = source.indexOf(coveredMarker);
  if (idx === -1) throw new Error(`marker ${coveredMarker} not in bundle`);
  const lineStart = source.lastIndexOf('\n', idx) + 1;
  let lineEnd = source.indexOf('\n', idx);
  if (lineEnd === -1) lineEnd = source.length;
  return [
    {
      functionName: 'main',
      isBlockCoverage: true,
      ranges: [
        { startOffset: 0, endOffset: lineStart, count: 0 },
        { startOffset: lineStart, endOffset: lineEnd, count: 1 },
        { startOffset: lineEnd, endOffset: source.length, count: 0 },
      ],
    },
  ];
}

function entry(source: string, coveredMarker?: string): CoverageEntry {
  return {
    url: 'http://localhost:5173/assets/app.js',
    source,
    functions: covered(source, coveredMarker),
  };
}

describe('resolveSources', () => {
  it('maps a fully covered bundle back to its original sources', async () => {
    const { sources, unresolved } = await resolveSources([entry(bundle)], { rootDir: appDir });
    expect(unresolved).toEqual([]);
    expect(sources).toContain('src/alpha.ts');
    expect(sources).toContain('src/beta.ts');
    expect(sources).toContain('src/main.ts');
  });

  it('excludes node_modules sources', async () => {
    const { sources } = await resolveSources([entry(bundle)], { rootDir: appDir });
    expect(sources.some((s) => s.includes('node_modules'))).toBe(false);
  });

  it('attributes only sources inside executed ranges', async () => {
    const { sources } = await resolveSources([entry(bundle, 'beta() {')], { rootDir: appDir });
    expect(sources).toContain('src/beta.ts');
    expect(sources).not.toContain('src/alpha.ts');
  });

  it('applies exclusion globs on top of node_modules', async () => {
    const { sources } = await resolveSources([entry(bundle)], { rootDir: appDir, filter: ['!**/beta.ts'] });
    expect(sources).not.toContain('src/beta.ts');
    expect(sources).toContain('src/alpha.ts');
  });

  it('skips entries without a resolvable sourcemap', async () => {
    const noMap: CoverageEntry = {
      url: 'http://localhost:5173/assets/plain.js',
      source: 'var x = 1;',
      functions: covered('var x = 1;'),
    };
    const { sources, unresolved } = await resolveSources([noMap], { rootDir: appDir });
    expect(sources).toEqual([]);
    expect(unresolved).toEqual(['http://localhost:5173/assets/plain.js']);
  });

  it('skips anonymous eval scripts', async () => {
    const evalEntry: CoverageEntry = {
      url: '',
      functions: [],
    };
    const { sources } = await resolveSources([evalEntry], { rootDir: appDir });
    expect(sources).toEqual([]);
  });
});
