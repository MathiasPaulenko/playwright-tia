import { build } from 'esbuild';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const pages = (await readdir('src/pages')).filter((f) => f.endsWith('.ts')).map((f) => join('src/pages', f));

await build({
  entryPoints: pages,
  bundle: true,
  format: 'esm',
  splitting: true,
  sourcemap: 'inline',
  outdir: 'dist/pages',
  logLevel: 'info',
});
