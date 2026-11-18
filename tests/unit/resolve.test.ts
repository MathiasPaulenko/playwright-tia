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

  it('resolves an external .map file via fetchText', async () => {
    const result = await build({
      entryPoints: [join(appDir, 'src/main.ts')],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      write: false,
      sourcemap: 'external',
      outdir: 'dist',
      logLevel: 'silent',
    });
    const js = result.outputFiles.find((f) => f.path.endsWith('.js'))!;
    const map = result.outputFiles.find((f) => f.path.endsWith('.map'))!;
    // real builds append the map reference; esbuild's write:false output doesn't
    const source = `${js.text}\n//# sourceMappingURL=main.js.map\n`;
    const { sources, unresolved } = await resolveSources(
      [{ url: 'http://localhost:5173/dist/main.js', source, functions: covered(source) }],
      {
        rootDir: appDir,
        serveRoot: join(appDir, 'dist'),
        fetchText: async (url) => (url.endsWith('.map') ? map.text : undefined),
      },
    );
    expect(unresolved).toEqual([]);
    expect(sources).toContain('src/alpha.ts');
    expect(sources).toContain('src/main.ts');
  });

  it('marks a script unresolved when its external map cannot be fetched', async () => {
    const source = 'var x = 1;\n//# sourceMappingURL=missing.map';
    const { sources, unresolved } = await resolveSources(
      [{ url: 'http://localhost:5173/app.js', source, functions: covered(source) }],
      { rootDir: appDir, fetchText: async () => undefined },
    );
    expect(sources).toEqual([]);
    expect(unresolved).toEqual(['http://localhost:5173/app.js']);
  });

  it('unions sources across multiple coverage entries', async () => {
    const betaOnly = entry(bundle, 'beta() {');
    const alphaOnly = entry(bundle, 'alpha() {');
    const { sources } = await resolveSources([betaOnly, alphaOnly], { rootDir: appDir });
    expect(sources).toContain('src/alpha.ts');
    expect(sources).toContain('src/beta.ts');
  });

  it('does not crash on a script url that is not parseable', async () => {
    const source = 'var x = 1;\n//# sourceMappingURL=relative.map\n';
    const { sources, unresolved } = await resolveSources(
      [{ url: 'webpack-internal://app', source, functions: covered(source) }],
      { rootDir: appDir, fetchText: async () => undefined },
    );
    expect(sources).toEqual([]);
    expect(unresolved).toEqual(['webpack-internal://app']);
  });

  it('resolves sources carrying bundler query suffixes', async () => {
    // Hand-built map whose sources carry vite-style cache-busting queries.
    const map = {
      version: 3,
      sources: ['src/alpha.ts?v=123', 'src/beta.ts#frag'],
      names: [],
      mappings: 'AAAA;ACAA',
    };
    const source = 'var alpha = 1;\nvar beta = 2;\n//# sourceMappingURL=data:application/json;base64,' +
      Buffer.from(JSON.stringify(map)).toString('base64');
    const { sources, unresolved } = await resolveSources(
      [{ url: 'http://localhost:5173/app.js', source, functions: covered(source) }],
      { rootDir: appDir },
    );
    expect(unresolved).toEqual([]);
    expect(sources).toContain('src/alpha.ts');
    expect(sources).toContain('src/beta.ts');
  });

  it('never emits sources outside the project root', async () => {
    const map = {
      version: 3,
      sources: ['../outside.ts', 'src/alpha.ts'],
      names: [],
      mappings: 'AAAA;ACAA',
    };
    const source = 'var alpha = 1;\nvar beta = 2;\n//# sourceMappingURL=data:application/json;base64,' +
      Buffer.from(JSON.stringify(map)).toString('base64');
    const { sources } = await resolveSources(
      [{ url: 'http://localhost:5173/app.js', source, functions: covered(source) }],
      { rootDir: appDir },
    );
    expect(sources).toEqual(['src/alpha.ts']);
  });

  it('recovers repo paths from ..-relative sources via the suffix fallback', async () => {
    // CI layout: the bundle lives in a tmp dir on the same filesystem as the
    // repo, so esbuild emits sources relative to it — resolving them against
    // rootDir lands outside, and only the longest-existing suffix recovers
    // the real path.
    const map = {
      version: 3,
      sources: ['../../home/runner/work/playwright-tia/tests/fixtures/app/src/alpha.ts'],
      names: [],
      mappings: 'AAAA',
    };
    const source = 'var alpha = 1;\n//# sourceMappingURL=data:application/json;base64,' +
      Buffer.from(JSON.stringify(map)).toString('base64');
    const { sources } = await resolveSources(
      [{ url: 'http://localhost:5173/app.js', source, functions: covered(source) }],
      { rootDir: appDir },
    );
    expect(sources).toEqual(['src/alpha.ts']);
  });
});
