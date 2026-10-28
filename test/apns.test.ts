// Phase 17: iPhone notifications through APNs, against a fake Apple server (HTTP/2, cleartext).
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createServer, type Http2Server } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ApnsSender, validateApnsKey } from '../src/apns.ts';
import { Vault } from '../src/vault.ts';
import { tempDir } from './helpers.ts';

const { dir, cleanup } = tempDir();
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const p8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const seen: { path: string; headers: Record<string, string>; body: string }[] = [];
let apple: Http2Server;
let origin = '';
before(async () => {
  apple = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ path: String(req.headers[':path']), headers: req.headers as Record<string, string>, body });
      const token = String(req.headers[':path']).split('/').pop()!;
      if (token.startsWith('dead')) {
        res.writeHead(410, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ reason: 'Unregistered' }));
      }
      res.writeHead(200);
      res.end();
    });
  });
  await new Promise<void>((r) => apple.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(apple.address() as AddressInfo).port}`;
});
after(() => {
  apple.close();
  cleanup();
});

test('apns: key is checked; pushes are signed ES256 with the team and key IDs; dead devices are removed', async () => {
  assert.throws(() => validateApnsKey({ keyId: 'short', teamId: 'ABCDE12345', p8 }), /Key ID/);
  assert.throws(() => validateApnsKey({ keyId: 'ABCDE12345', teamId: 'ABCDE12345', p8: 'nope' }), /\.p8/);
  const db = new DatabaseSync(':memory:');
  const sender = new ApnsSender(db, new Vault(dir), { origin: () => origin });
  assert.deepEqual(await sender.sendAll({ title: 't', body: 'b', url: '/' }), { sent: 0, failed: 0, removed: 0 }, 'no key yet: nothing');
  sender.setKey({ keyId: 'kid1234567', teamId: 'team123456', bundleId: 'com.backstagecoding.sara', p8 });
  assert.equal(sender.key()!.keyId, 'KID1234567');
  assert.throws(() => sender.register('not-a-token', false, 'x'), /device token/);
  sender.register('a'.repeat(64), true, "Alex's iPhone");
  sender.register('dead' + 'b'.repeat(60), false, 'Old iPhone');
  const r = await sender.sendAll({ title: 'Sara', body: 'Hi there', url: '/#c=abc', tag: 'c42' });
  assert.deepEqual(r, { sent: 1, failed: 0, removed: 1 });
  assert.deepEqual(sender.devices().map((d) => d.label), ["Alex's iPhone"]);
  assert.equal(sender.devices()[0].sandbox, true);
  const ok = seen.find((s) => s.path === `/3/device/${'a'.repeat(64)}`)!;
  assert.equal(ok.headers['apns-topic'], 'com.backstagecoding.sara');
  assert.equal(ok.headers['apns-push-type'], 'alert');
  assert.equal(ok.headers['apns-collapse-id'], 'c42');
  const payload = JSON.parse(ok.body);
  assert.deepEqual(payload.aps.alert, { title: 'Sara', body: 'Hi there' });
  assert.equal(payload.url, '/#c=abc');
  assert.equal(payload.aps.category, 'SARA_REPLY');
  assert.equal(payload.conversationId, 'abc');
  const [h, c, s] = ok.headers.authorization.replace('bearer ', '').split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'ES256', kid: 'KID1234567' });
  assert.equal(JSON.parse(Buffer.from(c, 'base64url').toString()).iss, 'TEAM123456');
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  sender.close();
});

test('apns: iPhones registered by a device that is later signed out are removed', () => {
  const db = new DatabaseSync(':memory:');
  const sender = new ApnsSender(db, new Vault(dir), { origin: () => origin });
  sender.register('c'.repeat(64), false, 'Kept (no session)');
  sender.register('d'.repeat(64), false, 'Signed in', 'sess-1');
  sender.register('e'.repeat(64), false, 'Signed out', 'sess-2');
  assert.equal(sender.prune(new Set(['sess-1'])), 1);
  assert.deepEqual(sender.devices().map((d) => d.label).sort(), ['Kept (no session)', 'Signed in']);
});
