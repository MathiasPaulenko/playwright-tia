import { createServer, type Server } from 'node:http';
import type { Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const appSrc = fileURLToPath(new URL('./app/src/main.ts', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.map': 'application/json',
};

export interface AppServer {
  url: string;
  close: () => Promise<void>;
}

/** Bundle the demo app with esbuild code-splitting + inline sourcemaps and serve it. */
export async function startApp(): Promise<AppServer> {
  const outDir = await mkdtemp(join(tmpdir(), 'tia-e2e-'));
  await build({
    entryPoints: [appSrc],
    bundle: true,
    format: 'esm',
    splitting: true,
    sourcemap: 'inline',
    outdir: outDir,
    logLevel: 'silent',
  });

  const server: Server = createServer((req, res) => {
    const pathname = req.url === '/' ? '/index.html' : (req.url ?? '/');
    const file = pathname === '/index.html'
      ? Promise.resolve('<!doctype html><script type="module" src="/main.js"></script>')
      : readFile(join(outDir, normalize(pathname)), 'utf8').catch(() => null);
    void file.then((content) => {
      if (content === null) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': MIME[extname(pathname)] ?? 'application/octet-stream' });
      res.end(content);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function loadFeature(page: Page, feature: 'A' | 'B'): Promise<string> {
  return page.evaluate((f) => globalThis.app[f === 'A' ? 'loadA' : 'loadB'](), feature);
}
