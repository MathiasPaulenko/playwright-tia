import { createServer, type Server } from 'node:http';
import type { Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
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
  /** Cross-origin URL of the iframe page (second port = separate origin = OOPIF). */
  frameUrl: string;
  close: () => Promise<void>;
}

const FRAME_HTML = `<!doctype html><button id="go">go</button>
<script type="module">
  document.getElementById('go').addEventListener('click', async () => {
    const m = await import('./frameEntry.js');
    document.title = m.run();
  });
</script>`;

const serve = (handler: (pathname: string) => Promise<string | null>): Promise<Server> =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      const pathname = req.url === '/' ? '/index.html' : (req.url ?? '/');
      void handler(pathname).then((content) => {
        if (content === null) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'content-type': MIME[extname(pathname)] ?? 'application/octet-stream' });
        res.end(content);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

/** Bundle the demo app with esbuild code-splitting + inline sourcemaps and serve it. */
export async function startApp(): Promise<AppServer> {
  const outDir = await mkdtemp(join(tmpdir(), 'tia-e2e-'));
  await build({
    entryPoints: [appSrc, fileURLToPath(new URL('./app/src/frameEntry.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    splitting: true,
    sourcemap: 'inline',
    outdir: outDir,
    logLevel: 'silent',
  });

  const server = await serve((pathname) =>
    pathname === '/index.html'
      ? Promise.resolve('<!doctype html><script type="module" src="/main.js"></script>')
      : readFile(join(outDir, normalize(pathname)), 'utf8').catch(() => null),
  );
  const frameServer = await serve((pathname) =>
    pathname === '/index.html' || pathname === '/frame.html'
      ? Promise.resolve(FRAME_HTML)
      : readFile(join(outDir, normalize(pathname)), 'utf8').catch(() => null),
  );

  const port = (s: Server): number => (s.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port(server)}`,
    frameUrl: `http://127.0.0.1:${port(frameServer)}/frame.html`,
    close: () =>
      Promise.all([
        new Promise<void>((resolve) => server.close(() => resolve())),
        new Promise<void>((resolve) => frameServer.close(() => resolve())),
      ]).then(() => {}),
  };
}

export function loadFeature(page: Page, feature: 'A' | 'B'): Promise<string> {
  return page.evaluate((f) => globalThis.app[f === 'A' ? 'loadA' : 'loadB'](), feature);
}
