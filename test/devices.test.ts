// Phase 10: signed-in devices (sign out one / others), owner token rotation, upgrade keeps old sign-ins.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { deviceLabel, OwnerAuth } from '../src/auth.ts';
import { tempDir } from './helpers.ts';

test('devices: each sign-in is listed; signing one out ends only that session', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const auth = new OwnerAuth(dir);
  const phone = auth.createSession(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'));
  const pc = auth.createSession(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36'));
  assert.deepEqual(auth.devices().map((d) => d.label).sort(), ['Chrome on Windows', 'Safari on iPhone']);
  assert.ok(auth.verifySession(phone.value) && auth.verifySession(pc.value));
  auth.signOut(phone.id);
  assert.equal(auth.verifySession(phone.value), false, 'signed-out cookie no longer works');
  assert.equal(auth.verifySession(pc.value), true);
  const tablet = auth.createSession('Safari on iPad');
  assert.equal(auth.signOut('others', pc.id), 1);
  assert.equal(auth.verifySession(tablet.value), false);
  assert.equal(auth.verifySession(pc.value), true);
});

test('devices: upgrading keeps earlier sign-ins working until the owner signs devices out', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const first = new OwnerAuth(dir);
  const token = first.newToken!;
  const old = first.createSession();
  // Simulate the file from before devices existed.
  const f = join(dir, 'owner.json');
  const o = JSON.parse(readFileSync(f, 'utf8'));
  delete o.sessions;
  writeFileSync(f, JSON.stringify(o));
  const auth = new OwnerAuth(dir);
  assert.equal(auth.verifySession(old.value), true, 'old cookie still signs in');
  assert.equal(auth.devices()[0].label, 'Earlier sign-in');

  assert.throws(() => auth.rotateToken('wrong'), /not the current owner token/);
  const next = auth.rotateToken(token);
  assert.ok(auth.verifyToken(next) && !auth.verifyToken(token));
  assert.equal(auth.verifySession(old.value), false, 'new token signs everyone out');
});
