import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { emptyManifest, mergeFragments } from '../../src/manifest.js';

const execFileAsync = promisify(execFile);
const rootDir = fileURLToPath(new URL('../..', import.meta.url));
const fragmentsDir = join(rootDir, '.tia', 'fragments');

describe('collector e2e', () => {
  it('attributes each spec only the sources its coverage executed', { timeout: 180_000 }, async () => {
    await rm(fragmentsDir, { recursive: true, force: true });
    await execFileAsync(process.execPath, [join(rootDir, 'node_modules/playwright/cli.js'), 'test'], {
      cwd: rootDir,
      env: { ...process.env, PW_TIA_COLLECT: '1' },
    });

    const manifest = await mergeFragments(fragmentsDir, emptyManifest());
    const specA = manifest.specs['tests/e2e/feature-a.spec.ts'];
    const specB = manifest.specs['tests/e2e/feature-b.spec.ts'];
    expect(specA).toBeDefined();
    expect(specB).toBeDefined();

    expect(specA!.sources).toContain('tests/e2e/app/src/featureA.ts');
    expect(specA!.sources).not.toContain('tests/e2e/app/src/featureB.ts');
    expect(specB!.sources).toContain('tests/e2e/app/src/featureB.ts');
    expect(specB!.sources).not.toContain('tests/e2e/app/src/featureA.ts');

    expect(specA!.sources).toContain('tests/e2e/app/src/main.ts');
    expect(specB!.sources).toContain('tests/e2e/app/src/main.ts');
  });
});
