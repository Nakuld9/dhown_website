import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Bridge } from '../bridge';
import { authenticate } from './auth';
import { handleAdmin } from './routes/admin';
import { handleInternal } from './routes/internal';
import { logRequest, notFound, sendError, sendJson } from './http';
import { log } from '../logger';

/**
 * HTTP surface.
 *
 * Three areas, with different trust:
 *   /health          - unauthenticated liveness only, no BUSY detail
 *   /api/v1/mes/*    - MES only (X-Bridge-Key)
 *   /api/v1/admin/*  - dashboard (X-Admin-Key, role-gated)
 *   /dashboard       - static admin UI
 *
 * The customer portal is not in that list and must never be added to it.
 */

/**
 * Locate the dashboard assets.
 *
 * The compiled layout (dist/src/api) sits one level deeper than the source
 * layout (src/api), so a fixed number of '..' segments is wrong in one of
 * them. Walk up to the package root instead, and fail loudly rather than
 * silently serving 404s for every asset.
 */
function resolvePublicDir(): string {
  let dir = __dirname;
  for (let up = 0; up < 6; up += 1) {
    const candidate = path.join(dir, 'public');
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the dashboard assets directory (public/index.html).');
}

const PUBLIC_DIR = resolvePublicDir();

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveDashboard(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  if (!url.pathname.startsWith('/dashboard')) return false;

  const relative = url.pathname === '/dashboard' || url.pathname === '/dashboard/'
    ? 'index.html'
    : url.pathname.slice('/dashboard/'.length);

  // Resolve and confirm containment: a crafted path must not escape PUBLIC_DIR.
  const target = path.resolve(PUBLIC_DIR, relative);
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    notFound(res, 'Asset');
    return true;
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      notFound(res, 'Asset');
      return;
    }
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      // The dashboard ships no third-party assets and makes no external calls;
      // lock it down so a future edit cannot quietly introduce one.
      'content-security-policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
    });
    res.end(data);
  });
  return true;
}

export function createServer(bridge: Bridge): http.Server {
  return http.createServer((req, res) => {
    const startedAt = Date.now();
    res.on('finish', () => logRequest(req, res.statusCode, startedAt));

    void (async () => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

        // Liveness. Deliberately says nothing about BUSY: this endpoint is
        // unauthenticated and BUSY's state is not public information.
        if (url.pathname === '/health') {
          sendJson(res, 200, { ok: true, service: 'dhown-busy-bridge', time: new Date().toISOString() });
          return;
        }

        if (serveDashboard(req, res, url)) return;

        if (url.pathname.startsWith('/api/')) {
          const principal = authenticate(req, bridge.config);
          if (!principal) {
            res.setHeader('www-authenticate', 'Bridge realm="dhown-busy-bridge"');
            sendJson(res, 401, {
              ok: false,
              error: { code: 'AUTHENTICATION_ERROR', message: 'A valid X-Bridge-Key or X-Admin-Key header is required.' },
            });
            return;
          }

          if (url.pathname.startsWith('/api/v1/mes/')) {
            await handleInternal(req, res, url, bridge, principal);
            return;
          }
          if (url.pathname.startsWith('/api/v1/admin/')) {
            if (principal.kind !== 'admin') {
              // The MES key must not reach administrative actions.
              sendJson(res, 403, {
                ok: false,
                error: { code: 'FORBIDDEN', message: 'Administrative routes require an admin key.' },
              });
              return;
            }
            await handleAdmin(req, res, url, bridge, principal);
            return;
          }
          notFound(res);
          return;
        }

        notFound(res);
      } catch (err) {
        log.error('Unhandled request error', { url: req.url, message: String(err) });
        if (!res.headersSent) sendError(res, 500, err);
        else res.end();
      }
    })();
  });
}
