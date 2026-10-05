import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './src/store.js';
import { createSimaProvider } from './src/sima.js';
import { createApi, housekeeping } from './src/api.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const SRC_DIR = path.join(ROOT, 'src');

const PORT = Number(process.env.PORT) || 3100;
const DEMO = process.env.DEMO === '1';
const FIN_SECRET = process.env.FIN_SECRET || (DEMO ? 'demo-fin-secret' : null);
const SESSION_DAYS = 30;
const MAX_BODY = 10_000;

if (!FIN_SECRET) throw new Error('Set FIN_SECRET (a long random string) or run with DEMO=1.');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const store = new Store(process.env.DB_FILE || path.join(ROOT, 'data', 'db.json'));
const db = store.db;
const sima = createSimaProvider(process.env);
const handle = createApi({
  db,
  sima,
  demo: DEMO,
  // Only a keyed hash of the FIN is stored, never the FIN itself.
  hashFin: (fin) => crypto.createHmac('sha256', FIN_SECRET).update(fin).digest('hex'),
});

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) return { error: [413, 'Sorğu çox böyükdür.'] };
  }
  try {
    return { body: raw ? JSON.parse(raw) : {} };
  } catch {
    return { error: [400, 'JSON səhvdir.'] };
  }
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k));
}

function sessionUserId(req) {
  const session = db.sessions[cookies(req).sid];
  return session && session.expiresAt > Date.now() ? session.userId : null;
}

function openSession(userId) {
  const sid = crypto.randomBytes(32).toString('hex');
  db.sessions[sid] = { userId, expiresAt: Date.now() + SESSION_DAYS * 86_400_000 };
  return `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}${DEMO ? '' : '; Secure'}`;
}

async function serveStatic(req, res, pathname) {
  // /src/* serves the shared modules that the browser-only build also uses.
  const [dir, rel] = pathname.startsWith('/src/')
    ? [SRC_DIR, pathname.slice(5)]
    : [PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')];
  const file = path.normalize(path.join(dir, decodeURIComponent(rel)));
  if (!file.startsWith(dir + path.sep)) return res.writeHead(403).end();
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
      return serveStatic(req, res, pathname);
    }
    let body = {};
    if (req.method === 'POST') {
      // Requiring JSON also blocks cross-site form posts (they can't set this header).
      if (!(req.headers['content-type'] || '').startsWith('application/json')) {
        return sendJson(res, 415, { error: 'JSON gözlənilir.' });
      }
      const parsed = await readBody(req);
      if (parsed.error) return sendJson(res, parsed.error[0], { error: parsed.error[1] });
      body = parsed.body;
    }
    const out = await handle({ method: req.method, path: pathname, body, userId: sessionUserId(req) });
    const headers = {};
    if (out.login) headers['Set-Cookie'] = openSession(out.login);
    if (out.logout) {
      delete db.sessions[cookies(req).sid];
      headers['Set-Cookie'] = 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
    }
    if (req.method !== 'GET') store.save();
    return sendJson(res, out.status, out.body, headers);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: 'Daxili xəta' });
  }
});

// Penalties for overdue payments, expired sessions and SİMA requests.
setInterval(() => {
  const now = Date.now();
  let changed = housekeeping(db, sima, now);
  for (const [sid, s] of Object.entries(db.sessions)) {
    if (s.expiresAt < now) {
      delete db.sessions[sid];
      changed = true;
    }
  }
  if (changed) store.save();
}, 60_000).unref();

server.listen(PORT, () => {
  console.log(`Lotereya running on http://localhost:${PORT}${DEMO ? ' (DEMO: simulated SİMA, bots)' : ''}`);
});
