import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 4173);

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.map': 'application/json',
};

const page = (name) => `<!doctype html><html><body><script type="module" src="/pages/${name}.page.js"></script></body></html>`;

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const pageMatch = /^\/(\w+)\.html$/.exec(url.pathname);
  const content = pageMatch
    ? Promise.resolve(page(pageMatch[1]))
    : readFile(join('dist', normalize(url.pathname)), 'utf8').catch(() => null);
  void content.then((body) => {
    if (body === null) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(url.pathname)] ?? 'text/html' });
    res.end(body);
  });
}).listen(PORT, () => console.log(`demo-app on http://localhost:${PORT}`));
