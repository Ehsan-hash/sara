// Phase 29: saved places and place reminders ("remind me when I get to the store").
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { ReminderScheduler } from '../src/reminders.ts';
import { createSaraServer } from '../src/server.ts';
import { makeApp, ROOT, tempDir } from './helpers.ts';

function setup(t: { after: (fn: () => void) => void }) {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date('2026-10-25T20:00:00Z') };
  const app = makeApp(dir, clock);
  t.after(() => {
    app.store.close();
    cleanup();
  });
  app.settings.update({ timeZone: 'UTC' });
  return { app, clock };
}

test('places: saved and checked; the remind tool sets place reminders and lists them', async (t) => {
  const { app, clock } = setup(t);
  const pl = app.planner!;
  assert.throws(() => pl.savePlace({ name: 'Moon', lat: 120, lon: 0 }), /not on Earth/);
  assert.throws(() => pl.savePlace({ name: '', lat: 1, lon: 1 }), /name/);
  const store = pl.savePlace({ name: 'Grocery store', lat: 39.0997265, lon: -94.5785667, radius: 10 });
  assert.equal(store.radius, 75, 'at least 75 m (GPS is not that precise)');
  assert.equal(store.lat, 39.099727);
  assert.equal(pl.savePlace({ name: 'grocery STORE', lat: 39.1, lon: -94.5 }).id, store.id, 'same name moves the place');

  const conv = app.store.createConversation({ title: 'Chat' });
  const remind = app.tools.get('remind')!;
  const ctx = { conversationId: conv.id } as never;
  await assert.rejects(remind.run({ action: 'set', text: 'buy milk', place: 'Gym' }, ctx), /no saved place called "Gym"\. Saved places: Grocery store\./);
  assert.match(String(await remind.run({ action: 'set', text: 'buy milk', place: 'grocery store' }, ctx)), /when the owner arrives at Grocery store: "buy milk".*never the location itself/);
  await remind.run({ action: 'set', text: 'call mum', place: 'Grocery store', on: 'leave' }, ctx);
  assert.match(String(await remind.run({ action: 'list' }, ctx)), /when arriving at Grocery store: buy milk\n#\d+ when leaving Grocery store: call mum/);
  assert.match(String(await remind.run({ action: 'places' }, ctx)), /- Grocery store/);
  assert.match(pl.agenda(clock.now, 'UTC'), /reminder #\d+ "buy milk" when arriving at Grocery store/);
  assert.deepEqual(pl.watchedPlaces().map((p) => [p.name, p.events]), [['Grocery store', ['arrive', 'leave']]]);

  // The time scheduler never fires them.
  clock.now = new Date('2030-01-01T00:00:00Z');
  assert.equal(new ReminderScheduler(app, pl).tick(), 0);

  // Arriving delivers only the "arrive" one.
  const sched = new ReminderScheduler(app, pl);
  assert.equal(sched.atPlace(store.id, 'arrive'), 1);
  assert.equal(app.store.messages(conv.id).at(-1)!.content, 'Reminder (you’re at Grocery store): buy milk');
  assert.equal(sched.atPlace(store.id, 'arrive'), 0, 'once');
  assert.deepEqual(pl.watchedPlaces().map((p) => p.events), [['leave']]);
  // Deleting a place cancels its reminders.
  assert.ok(pl.deletePlace(store.id));
  assert.deepEqual(pl.watchedPlaces(), []);
  assert.match(String(await remind.run({ action: 'list' }, ctx)), /No upcoming reminders/);
});

test('places API: save, watch list for the phone, "arrived" event, planner reminders by place', async (t) => {
  const { app } = setup(t);
  const auth = new OwnerAuth(app.dataDir);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { authorization: `Bearer ${auth.newToken}`, 'content-type': 'application/json' };
  const j = async (m: string, p: string, body?: unknown) => {
    const r = await fetch(`${base}/api${p}`, { method: m, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: (await r.json()) as Record<string, unknown> };
  };
  assert.equal((await j('POST', '/places', { name: 'Work', lat: 'x', lon: 2 })).status, 400);
  const work = (await j('POST', '/places', { name: 'Work', lat: 51.5, lon: -0.12 })).data as { id: number };
  assert.deepEqual((await j('GET', '/places/watch')).data.places, [], 'nothing to watch without reminders');
  const conv = app.store.createConversation({ title: 'Chat' });
  assert.equal((await j('POST', '/reminders', { text: 'water the plants', placeId: 999, placeEvent: 'leave' })).status, 400);
  const rem = (await j('POST', '/reminders', { text: 'water the plants', placeId: work.id, placeEvent: 'leave', conversationId: conv.id })).data;
  assert.equal(rem.placeEvent, 'leave');
  const watch = (await j('GET', '/places/watch')).data.places as { id: number; lat: number; radius: number; events: string[] }[];
  assert.deepEqual(watch, [{ id: work.id, name: 'Work', lat: 51.5, lon: -0.12, radius: 150, events: ['leave'] }]);
  assert.deepEqual((await j('POST', `/places/${work.id}/event`, { event: 'arrive' })).data, { delivered: 0 });
  assert.deepEqual((await j('POST', `/places/${work.id}/event`, { event: 'leave' })).data, { delivered: 1 });
  assert.equal(app.store.messages(conv.id).at(-1)!.content, 'Reminder (you just left Work): water the plants');
  assert.equal((await j('POST', '/places/999/event', { event: 'leave' })).status, 404);
  const planner = (await j('GET', '/planner')).data;
  assert.equal((planner.places as unknown[]).length, 1);
  assert.equal((await j('DELETE', `/places/${work.id}`)).status, 200);
  assert.equal((await j('POST', '/places/lookup', { address: '' })).status, 400);
});
