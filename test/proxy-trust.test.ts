// Pre-1.0 hardening (L7): X-Forwarded-For only counts when it really came through the proxy.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { clientIp, proxyTrust } from '../src/server.ts';
import { tempDir } from './helpers.ts';

const req = (headers: Record<string, string>) => ({ socket: { remoteAddress: '127.0.0.1' }, headers }) as unknown as IncomingMessage;

test('proxy trust: a per-install secret header from Caddy; tailscale never; hand-made proxies as before', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  assert.equal(proxyTrust({}, dir), false);
  assert.equal(proxyTrust({ SARA_TRUST_PROXY: '1' }, dir), true, 'an Apache/nginx proxy set up by hand keeps working');
  assert.deepEqual(proxyTrust({ SARA_TRUST_PROXY: '1', SARA_ACCESS: 'tailscale' }, dir), { secret: '' });
  assert.deepEqual(proxyTrust({ SARA_TRUST_PROXY: '1', SARA_MAC_TS_SERVE: '1' }, dir), { secret: '' });
  assert.deepEqual(proxyTrust({ SARA_TRUST_PROXY: '1', SARA_PROXY_SECRET: 's3cret' }, dir), { secret: 's3cret' });
  writeFileSync(join(dir, 'proxy-secret'), 'abc123\n');
  const caddy = proxyTrust({ SARA_TRUST_PROXY: '1', SARA_ACCESS: 'domain' }, dir);
  assert.deepEqual(caddy, { secret: 'abc123' });

  // With the secret: only requests that carry it get their X-Forwarded-For used.
  assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4', 'x-sara-proxy': 'abc123' }), caddy), '1.2.3.4');
  assert.equal(clientIp(req({ 'x-forwarded-for': '9.9.9.9' }), caddy), '127.0.0.1', 'a local program without the secret');
  assert.equal(clientIp(req({ 'x-forwarded-for': '9.9.9.9', 'x-sara-proxy': 'abc124' }), caddy), '127.0.0.1');
  // Tailscale: counted by connection.
  assert.equal(clientIp(req({ 'x-forwarded-for': '9.9.9.9' }), { secret: '' }), '127.0.0.1');
  // Plain true: as before.
  assert.equal(clientIp(req({ 'x-forwarded-for': '9.9.9.9' }), true), '9.9.9.9');
});
