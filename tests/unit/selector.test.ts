import { describe, expect, it } from 'vitest';

import { defaultConfig } from '../../src/config.js';
import { emptyManifest, mergeSpec } from '../../src/manifest.js';
import { selectAffected } from '../../src/selector.js';

const config = { ...defaultConfig, specGlob: ['**/*.spec.ts'] };

function manifest() {
  let m = emptyManifest();
  m = mergeSpec(m, 'tests/checkout.spec.ts', ['src/cart/CartService.ts', 'src/pages/checkout.tsx'], 1);
  m = mergeSpec(m, 'tests/cart.spec.ts', ['src/cart/CartService.ts'], 1);
  m = mergeSpec(m, 'tests/profile.spec.ts', ['src/user/Profile.ts'], 1);
  m = mergeSpec(m, 'tests/empty.spec.ts', [], 1);
  return m;
}

describe('selectAffected', () => {
  it('runs the specs whose sources changed', () => {
    const result = selectAffected(manifest(), ['src/cart/CartService.ts'], [], config);
    expect(result.runAll).toBe(false);
    const triggered = result.specs.filter((s) => s.reason === 'changed-source');
    expect(triggered.map((s) => s.spec).sort()).toEqual(['tests/cart.spec.ts', 'tests/checkout.spec.ts']);
    expect(triggered.find((s) => s.spec === 'tests/cart.spec.ts')!.triggeredBy).toEqual([
      'src/cart/CartService.ts',
    ]);
  });

  it('runs everything on an empty manifest', () => {
    const result = selectAffected(emptyManifest(), ['src/x.ts'], [], config);
    expect(result.runAll).toBe(true);
    expect(result.reason).toBe('no-manifest');
  });

  it('runs everything when a forceRun glob matches', () => {
    const result = selectAffected(manifest(), ['playwright.config.ts'], [], config);
    expect(result.runAll).toBe(true);
    expect(result.reason).toContain('forceRun');
  });

  it('runs new specs not present in the manifest', () => {
    const result = selectAffected(manifest(), [], ['tests/new.spec.ts'], config);
    const added = result.specs.filter((s) => s.reason === 'new-spec');
    expect(added).toEqual([{ spec: 'tests/new.spec.ts', triggeredBy: [], reason: 'new-spec' }]);
  });

  it('runs specs with empty sources conservatively', () => {
    const result = selectAffected(manifest(), ['src/cart/CartService.ts'], [], config);
    const empty = result.specs.find((s) => s.spec === 'tests/empty.spec.ts');
    expect(empty?.reason).toBe('no-sources');
  });

  it('runs a changed spec file directly', () => {
    const result = selectAffected(manifest(), ['tests/checkout.spec.ts'], [], config);
    const spec = result.specs.find((s) => s.spec === 'tests/checkout.spec.ts');
    expect(spec?.reason).toBe('spec-changed');
  });

  it('treats a spec file absent from the manifest as new', () => {
    const result = selectAffected(manifest(), ['tests/brand-new.spec.ts'], [], config);
    expect(result.specs.some((s) => s.spec === 'tests/brand-new.spec.ts' && s.reason === 'new-spec')).toBe(
      true,
    );
  });

  it('ignores changed files covered by nothing', () => {
    const result = selectAffected(manifest(), ['README.md', 'docs/guide.md'], [], config);
    expect(result.specs.map((s) => s.spec)).toEqual(['tests/empty.spec.ts']);
    expect(result.runAll).toBe(false);
  });

  it('flags shared files covered by most specs as shared-file', () => {
    let m = emptyManifest();
    m = mergeSpec(m, 'a.spec.ts', ['src/shared.ts', 'src/a.ts'], 1);
    m = mergeSpec(m, 'b.spec.ts', ['src/shared.ts', 'src/b.ts'], 1);
    m = mergeSpec(m, 'c.spec.ts', ['src/shared.ts'], 1);
    const result = selectAffected(m, ['src/shared.ts'], [], { ...config, sharedThreshold: 0.8 });
    expect(result.shared).toEqual([{ file: 'src/shared.ts', specCount: 3 }]);
    const reasons = new Set(result.specs.map((s) => s.reason));
    expect(reasons).toEqual(new Set(['shared-file']));
  });

  it('does not flag files below the shared threshold', () => {
    const result = selectAffected(manifest(), ['src/cart/CartService.ts'], [], config);
    expect(result.shared ?? []).toEqual([]);
    expect(result.specs.every((s) => s.reason !== 'shared-file')).toBe(true);
  });
});
