// Atomic writes (fs-util.ts) and a damaged owner.json: the sign-in must never reset silently.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { writeFileAtomic } from '../src/fs-util.ts';
import { StartupError } from '../src/settings.ts';
import { tempDir } from './helpers.ts';

test('writeFileAtomic: replaces the file whole, leaves no temp file, keeps owner-only mode', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const f = join(dir, 'x.json');
  writeFileAtomic(f, '{"a":1}\n');
  writeFileAtomic(f, '{"a":2}\n');
  writeFileAtomic(join(dir, 'b.bin'), Buffer.from([1, 2, 3]));
  assert.equal(readFileSync(f, 'utf8'), '{"a":2}\n');
  assert.deepEqual([...readFileSync(join(dir, 'b.bin'))], [1, 2, 3]);
  assert.deepEqual(readdirSync(dir).sort(), ['b.bin', 'x.json']);
  if (process.platform !== 'win32') assert.equal(statSync(f).mode & 0o777, 0o600);
});

test('writeFileAtomic: a failed write leaves the old file and no temp file', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const f = join(dir, 'keep.json');
  writeFileAtomic(f, 'old');
  assert.throws(() => writeFileAtomic(join(dir, 'missing-folder', 'y.json'), 'new'));
  assert.equal(readFileSync(f, 'utf8'), 'old');
  assert.deepEqual(readdirSync(dir), ['keep.json']);
});

test('owner.json: every save keeps a good copy in owner.json.bak', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const auth = new OwnerAuth(dir);
  auth.createSession('Browser');
  assert.equal(readFileSync(join(dir, 'owner.json.bak'), 'utf8'), readFileSync(join(dir, 'owner.json'), 'utf8'));
});

test('owner.json cut short: she starts from the last good copy, with the same token and sign-ins', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const first = new OwnerAuth(dir);
  const token = first.newToken!;
  const s = first.createSession('Browser');
  const whole = readFileSync(join(dir, 'owner.json'), 'utf8');
  writeFileSync(join(dir, 'owner.json'), whole.slice(0, 40)); // a crash mid-write
  const again = new OwnerAuth(dir);
  assert.equal(again.newToken, undefined, 'no new token: the sign-in was not reset');
  assert.equal(again.setupPending, first.setupPending, 'browser setup does not reopen');
  assert.equal(again.verifyToken(token), true);
  assert.equal(again.verifySession(s.value), true);
  assert.equal(readFileSync(join(dir, 'owner.json'), 'utf8'), whole, 'owner.json is put back');
});

test('owner.json damaged with no good copy: refuses to start and names the file; --reset-token can recover', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const first = new OwnerAuth(dir);
  first.markSignedIn();
  writeFileSync(join(dir, 'owner.json'), '{"tokenHash":');
  writeFileSync(join(dir, 'owner.json.bak'), '');
  assert.throws(() => new OwnerAuth(dir), (err: Error) => err instanceof StartupError && err.message.includes(join(dir, 'owner.json')) && /damaged/.test(err.message));
  assert.equal(readFileSync(join(dir, 'owner.json'), 'utf8'), '{"tokenHash":', 'nothing was overwritten');
  // The server-side token reset replaces the sign-in anyway: it may start over, but not as a new server.
  const reset = new OwnerAuth(dir, undefined, { resetIfDamaged: true });
  assert.ok(reset.newToken && reset.verifyToken(reset.newToken));
  assert.equal(reset.setupPending, false, 'no browser setup opens for whoever comes first');
  assert.ok(existsSync(join(dir, 'owner.json.bak')));
});

test('owner.json missing a field counts as damaged (no silent reset)', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  new OwnerAuth(dir);
  writeFileSync(join(dir, 'owner.json'), '{}');
  const again = new OwnerAuth(dir);
  assert.equal(again.newToken, undefined);
  assert.ok(JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')).tokenHash);
});
