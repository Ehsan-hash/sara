import { HttpError } from './errors.js';

/** Reads a JSON body (empty body → undefined). */
export async function readJson(req, limitBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError(413, 'too_large', 'Body too large.');
    chunks.push(chunk);
  }
  if (!size) return undefined;
  const type = String(req.headers['content-type'] ?? '');
  if (!/^application\/json\b/i.test(type)) throw new HttpError(415, 'unsupported_type', 'Send JSON.');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Body is not valid JSON.');
  }
}

export function parseUrl(req) {
  const url = new URL(req.url ?? '/', 'http://local');
  return { path: url.pathname.replace(/\/+$/, '') || '/', query: Object.fromEntries(url.searchParams) };
}

export function clientAddress(req) {
  return req.socket?.remoteAddress ?? 'unknown';
}
