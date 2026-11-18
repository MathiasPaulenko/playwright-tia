import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultConfig, loadConfig } from '../../src/config.js';

describe('defaultConfig', () => {
  it('points at the root manifest and stays conservative', () => {
    expect(defaultConfig.manifestPath).toBe('tia-manifest.json');
    expect(defaultConfig.forceRun.length).toBeGreaterThan(0);
    expect(defaultConfig.sharedThreshold).toBeGreaterThan(0);
    expect(defaultConfig.sharedThreshold).toBeLessThanOrEqual(1);
  });
});

describe('loadConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tia-config-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', async () => {
    expect(await loadConfig(dir)).toEqual(defaultConfig);
  });

  it('merges a partial config over defaults', async () => {
    await writeFile(
      join(dir, 'playwright-tia.config.json'),
      JSON.stringify({ baseRef: 'main', coverage: { enabled: true, serveRoot: 'dist' } }),
    );
    const config = await loadConfig(dir);
    expect(config.baseRef).toBe('main');
    expect(config.coverage.enabled).toBe(true);
    expect(config.coverage.serveRoot).toBe('dist');
    // untouched fields keep defaults
    expect(config.forceRun).toEqual(defaultConfig.forceRun);
    expect(config.coverage.filter).toEqual(defaultConfig.coverage.filter);
  });

  it('falls back to defaults on invalid json', async () => {
    await writeFile(join(dir, 'playwright-tia.config.json'), '{oops');
    expect(await loadConfig(dir)).toEqual(defaultConfig);
  });

  it('falls back to defaults when the file is not an object', async () => {
    await writeFile(join(dir, 'playwright-tia.config.json'), '"just a string"');
    expect(await loadConfig(dir)).toEqual(defaultConfig);
  });

  it('keeps defaults for fields with wrong types instead of crashing', async () => {
    await writeFile(
      join(dir, 'playwright-tia.config.json'),
      JSON.stringify({
        specGlob: 'e2e/**/*.spec.ts', // string instead of array
        forceRun: 42,
        sharedThreshold: '0.5',
        recordMaxAgeDays: -3,
        manifestPath: '../outside.json',
        baseRef: 7,
        coverage: { enabled: 'yes', filter: 'src/**', serveRoot: '/abs' },
      }),
    );
    expect(await loadConfig(dir)).toEqual(defaultConfig);
  });

  it('rejects out-of-range sharedThreshold', async () => {
    await writeFile(join(dir, 'playwright-tia.config.json'), JSON.stringify({ sharedThreshold: 0 }));
    expect((await loadConfig(dir)).sharedThreshold).toBe(defaultConfig.sharedThreshold);
    await writeFile(join(dir, 'playwright-tia.config.json'), JSON.stringify({ sharedThreshold: 1.5 }));
    expect((await loadConfig(dir)).sharedThreshold).toBe(defaultConfig.sharedThreshold);
  });

  it('accepts valid partial fields and clamps recordMaxAgeDays', async () => {
    await writeFile(
      join(dir, 'playwright-tia.config.json'),
      JSON.stringify({ specGlob: ['e2e/**'], recordMaxAgeDays: 7.9, sharedThreshold: 0.5 }),
    );
    const config = await loadConfig(dir);
    expect(config.specGlob).toEqual(['e2e/**']);
    expect(config.recordMaxAgeDays).toBe(7);
    expect(config.sharedThreshold).toBe(0.5);
  });
});
