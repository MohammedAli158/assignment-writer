// server.mjs — Dependency-free static file server for the app.
// ES modules cannot load over file://, so run "node server.mjs" and open the
// printed URL. Serves the assignment folder so /app/* (this app) and
// /prototype/* (Ali's data + reference) are both reachable. No packages.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Serve one level up (the assignment folder) so both app/ and prototype/ work.
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let rel = urlPath.replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'app/index.html';
    else if (rel === 'app') rel = 'app/index.html';

    const full = path.resolve(ROOT, rel);
    // Keep every request inside ROOT (guard against ../ escapes).
    if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const data = await readFile(full);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    const code = err && err.code === 'ENOENT' ? 404 : 500;
    res.writeHead(code).end(code === 404 ? 'Not found' : String(err.message || err));
  }
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT}`);
  console.log(`Capture app:  http://localhost:${PORT}/app/index.html`);
  console.log(`Debug page:   http://localhost:${PORT}/app/debug.html`);
});
