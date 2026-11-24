#!/usr/bin/env node
/**
 * SplitVault — local preview server for the static app.
 * The published build is GitHub Pages; this only exists so you can run it
 * on a phone or laptop without pushing. Zero dependencies.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT || 8795);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-src https://www.instagram.com https://*.instagram.com",
  "base-uri 'none'"
].join('; ');

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let file = decodeURIComponent(url.pathname);

  if (file === '/health' || file === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, port: PORT }));
  }
  if (file === '/') file = '/index.html';

  const full = path.resolve(ROOT, '.' + path.posix.normalize(file));
  if (!full.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('forbidden');
  }

  fs.readFile(full, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><p style="font:15px system-ui;padding:24px">Not here. <a href="/">Back to the keys.</a></p>');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': CSP,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(buf);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[splitvault] port ${PORT} busy — try PORT=8796 node server.mjs`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  const base = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  console.log(`[splitvault] ${base}`);
  console.log('  keys: 1857 → games, 1936 → instagram');
  console.log('  on a phone: run with HOST=0.0.0.0 and open your Mac\'s LAN IP');
});
