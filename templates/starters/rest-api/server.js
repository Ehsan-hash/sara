// A small JSON REST API (no packages): GET/POST /items, GET/PATCH/DELETE /items/:id.
//   node server.js            (PORT=3000 by default, data in data.db)
import { createServer } from 'node:http';
import { openDb } from './db.js';

const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Body too large');
    chunks.push(c);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
}

function cleanName(v) {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, 'name must be a non-empty string');
  if (v.length > 200) throw new HttpError(400, 'name must be at most 200 characters');
  return v.trim();
}

export function createApp(db) {
  return createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'health' && parts.length === 1 && req.method === 'GET') return send(200, { ok: true });
      if (parts[0] !== 'items' || parts.length > 2) throw new HttpError(404, 'Not found');
      if (parts.length === 1) {
        if (req.method === 'GET') return send(200, db.list());
        if (req.method === 'POST') {
          const body = await readJson(req);
          return send(201, db.create(cleanName(body.name)));
        }
        throw new HttpError(405, 'Method not allowed');
      }
      const id = Number(parts[1]);
      if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'id must be a positive whole number');
      if (req.method === 'GET') {
        const item = db.get(id);
        if (!item) throw new HttpError(404, 'No such item');
        return send(200, item);
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const patch = {};
        if (body.name !== undefined) patch.name = cleanName(body.name);
        if (body.done !== undefined) {
          if (typeof body.done !== 'boolean') throw new HttpError(400, 'done must be true or false');
          patch.done = body.done;
        }
        const item = db.update(id, patch);
        if (!item) throw new HttpError(404, 'No such item');
        return send(200, item);
      }
      if (req.method === 'DELETE') {
        if (!db.remove(id)) throw new HttpError(404, 'No such item');
        return send(204);
      }
      throw new HttpError(405, 'Method not allowed');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      send(status, { error: status === 500 ? 'Something went wrong' : err.message });
    }
  });
}

if (process.argv[1]?.endsWith('server.js')) {
  const port = Number(process.env.PORT || 3000);
  const db = openDb();
  createApp(db).listen(port, () => console.log(`API on http://localhost:${port}/items`));
}
