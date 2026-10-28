// Pre-1.0 hardening (M4): live calls go through a cloud voice service, so a private conversation
// (sent only to hardware the owner controls) refuses them with a plain reason, and nothing reaches
// the voice service.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { createSaraServer } from '../src/server.ts';
import { makeApp, ROOT, tempDir } from './helpers.ts';

test('live call: refused for a private conversation, with a clear message; the voice service is never contacted', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  app.settings.update({ ownerName: 'Pat', disclosureAcceptedAt: '2026-10-24T19:00:00Z', voice: { xai: { voiceId: 'ara', language: 'en' } } as never });
  app.vault.set('voice:xai', 'xai-test-key');
  const auth = new OwnerAuth(app.dataDir);
  let connected = 0;
  const server = createSaraServer({
    app,
    auth,
    webDir: join(ROOT, 'web'),
    liveConnect: () => {
      connected++;
      throw new Error('must not connect');
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    app.store.close();
    cleanup();
  });
  const port = (server.address() as AddressInfo).port;
  const H = { authorization: `Bearer ${auth.newToken}` };
  const conv = app.store.createConversation({ title: 'Private one', private: true });
  app.store.addMessage(conv.id, 'user', 'something private');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live/${conv.id}`, { headers: H } as unknown as string[]);
  const events: Record<string, unknown>[] = [];
  ws.onmessage = (m) => typeof m.data === 'string' && events.push(JSON.parse(m.data));
  await new Promise<void>((r) => {
    ws.onclose = () => r();
    ws.onerror = () => r();
  });
  const ended = events.find((e) => e.type === 'ended');
  assert.ok(ended, JSON.stringify(events));
  assert.match(String(ended.reason), /private conversations/);
  assert.equal(ended.private, true);
  assert.equal(connected, 0, 'nothing went to the voice service');
});
