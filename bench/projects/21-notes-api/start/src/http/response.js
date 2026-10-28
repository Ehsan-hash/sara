import { HttpError } from './errors.js';

export function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

export function sendEmpty(res, status = 204) {
  res.writeHead(status);
  res.end();
}

export function sendError(res, err) {
  if (err instanceof HttpError) return sendJson(res, err.status, { error: err.code, message: err.message });
  sendJson(res, 500, { error: 'internal', message: 'Something went wrong.' });
}
