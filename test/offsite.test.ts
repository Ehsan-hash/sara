// Phase 8: off-server backups (encryption, AWS SigV4, folder and S3 destinations).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { decryptBackup, encryptBackup, isEncrypted, signV4, uploadOffsite } from '../src/offsite.ts';
import { tempDir } from './helpers.ts';

test('encrypt/decrypt round trip; wrong passphrase fails clearly', () => {
  const plain = Buffer.from('tar.gz bytes '.repeat(100));
  const enc = encryptBackup(plain, 'correct horse battery');
  assert.ok(isEncrypted(enc));
  assert.ok(!enc.includes(Buffer.from('tar.gz bytes')), 'nothing readable');
  assert.deepEqual(decryptBackup(enc, 'correct horse battery'), plain);
  assert.throws(() => decryptBackup(enc, 'wrong passphrase!'), /Wrong passphrase/);
  assert.throws(() => encryptBackup(plain, 'short'), /at least 10/);
});

test('SigV4 matches the AWS documentation example (GET object with Range)', () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
  const h = signV4({
    method: 'GET',
    url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    headers: { range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(
    h.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
  );
});

test('folder destination keeps the newest N encrypted copies', async (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const out = join(dir, 'drive');
  mkdirSync(out);
  for (let i = 1; i <= 4; i++) {
    const f = join(dir, `sara-2026-10-2${i}-03-00-00-auto.tar.gz`);
    writeFileSync(f, `backup ${i}`);
    await uploadOffsite(f, { kind: 'folder', path: out, keep: 2 }, { passphrase: 'a long passphrase' });
  }
  assert.deepEqual(readdirSync(out).sort(), ['sara-2026-10-23-03-00-00-auto.tar.gz.enc', 'sara-2026-10-24-03-00-00-auto.tar.gz.enc']);
  assert.equal(decryptBackup(readFileSync(join(out, 'sara-2026-10-24-03-00-00-auto.tar.gz.enc')), 'a long passphrase').toString(), 'backup 4');
  await assert.rejects(uploadOffsite(join(dir, 'x'), { kind: 'folder', path: join(dir, 'nope') }, { passphrase: 'a long passphrase' }), /doesn't exist/);
});

test('S3 destination: signed PUT, list, prune', async (t) => {
  const objects = new Map<string, Buffer>();
  const seen: string[] = [];
  const server = createServer((req, res) => {
    assert.match(String(req.headers.authorization), /^AWS4-HMAC-SHA256 Credential=KEYID\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    const u = new URL(req.url!, 'http://x');
    seen.push(`${req.method} ${u.pathname}`);
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'PUT') objects.set(u.pathname.replace('/bkt/', ''), Buffer.concat(chunks));
      if (req.method === 'DELETE') objects.delete(decodeURIComponent(u.pathname.replace('/bkt/', '')));
      if (req.method === 'GET') {
        res.setHeader('content-type', 'application/xml');
        return void res.end(`<ListBucketResult>${[...objects.keys()].map((k) => `<Contents><Key>${k}</Key><LastModified>2026-10-24T00:00:00Z</LastModified></Contents>`).join('')}</ListBucketResult>`);
      }
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const cfg = { kind: 's3' as const, endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bucket: 'bkt', region: 'auto', accessKeyId: 'KEYID', keep: 2, prefix: 'sara/' };
  for (let i = 1; i <= 3; i++) {
    const f = join(dir, `sara-2026-10-2${i}-03-00-00-auto.tar.gz`);
    writeFileSync(f, `b${i}`);
    await uploadOffsite(f, cfg, { passphrase: 'a long passphrase', s3Secret: 'SECRET' });
  }
  assert.deepEqual([...objects.keys()].sort(), ['sara/sara-2026-10-22-03-00-00-auto.tar.gz.enc', 'sara/sara-2026-10-23-03-00-00-auto.tar.gz.enc']);
  assert.ok(seen.includes('DELETE /bkt/sara/sara-2026-10-21-03-00-00-auto.tar.gz.enc'));
  await assert.rejects(uploadOffsite(join(dir, 'x'), cfg, { passphrase: 'a long passphrase' }), /secret/);
});
