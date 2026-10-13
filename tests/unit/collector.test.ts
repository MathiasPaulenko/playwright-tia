import { describe, expect, it } from 'vitest';

import { collectEnabled } from '../../src/collector.js';

describe('collectEnabled', () => {
  it('is off by default locally', () => {
    expect(collectEnabled({}, false)).toBe(false);
  });

  it('is on in CI', () => {
    expect(collectEnabled({ CI: 'true' }, false)).toBe(true);
  });

  it('honours PW_TIA_COLLECT=1', () => {
    expect(collectEnabled({ PW_TIA_COLLECT: '1' }, false)).toBe(true);
    expect(collectEnabled({ PW_TIA_COLLECT: 'true' }, false)).toBe(true);
  });

  it('PW_TIA_COLLECT=0 beats CI', () => {
    expect(collectEnabled({ PW_TIA_COLLECT: '0', CI: 'true' }, false)).toBe(false);
    expect(collectEnabled({ PW_TIA_COLLECT: 'false', CI: 'true' }, false)).toBe(false);
  });

  it('falls back to config.coverage.enabled', () => {
    expect(collectEnabled({}, true)).toBe(true);
    expect(collectEnabled({ CI: undefined }, true)).toBe(true);
  });
});
