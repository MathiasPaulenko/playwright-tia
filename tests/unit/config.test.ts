import { describe, expect, it } from 'vitest';

import { defaultConfig } from '../../src/config.js';

describe('defaultConfig', () => {
  it('points at the root manifest and stays conservative', () => {
    expect(defaultConfig.manifestPath).toBe('tia-manifest.json');
    expect(defaultConfig.forceRun.length).toBeGreaterThan(0);
    expect(defaultConfig.sharedThreshold).toBeGreaterThan(0);
    expect(defaultConfig.sharedThreshold).toBeLessThanOrEqual(1);
  });
});
