// Phase 29: Home Assistant (read on its own, changes ask first, read back what happened).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanHomeUrl, createHomeTools, describeState, HOME_VAULT, serviceFor, type HaState } from '../src/tools/home.ts';
import { makeApp, tempDir } from './helpers.ts';

const STATES: HaState[] = [
  { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen', brightness: 204 } },
  { entity_id: 'light.porch', state: 'off', attributes: { friendly_name: 'Porch light' } },
  { entity_id: 'lock.front_door', state: 'locked', attributes: { friendly_name: 'Front door' } },
  { entity_id: 'climate.hall', state: 'heat', attributes: { friendly_name: 'Hall thermostat', current_temperature: 19.5, temperature: 21 } },
  { entity_id: 'sensor.outside_temp', state: '12.4', attributes: { friendly_name: 'Outside temperature', unit_of_measurement: '°C' } },
  { entity_id: 'cover.garage', state: 'closed', attributes: { friendly_name: 'Garage door', current_position: 0 } },
];

test('helpers: address, descriptions, which service an action means', () => {
  assert.equal(cleanHomeUrl(' https://ha.example.com:8123/ '), 'https://ha.example.com:8123');
  assert.throws(() => cleanHomeUrl('homeassistant.local'), /full address/);
  assert.throws(() => cleanHomeUrl('ftp://x'), /http/);
  assert.equal(describeState(STATES[0]), 'light.kitchen · Kitchen · on (brightness 80%)');
  assert.equal(describeState(STATES[3]), 'climate.hall · Hall thermostat · heat (now 19.5°, set to 21°)');
  assert.equal(describeState(STATES[4]), 'sensor.outside_temp · Outside temperature · 12.4 °C');
  assert.deepEqual(serviceFor('cover.garage', 'open'), { domain: 'cover', service: 'open_cover' });
  assert.deepEqual(serviceFor('scene.movie', 'run'), { domain: 'scene', service: 'turn_on' });
  assert.deepEqual(serviceFor('light.kitchen', 'set_brightness'), { domain: 'light', service: 'turn_on' });
  assert.throws(() => serviceFor('lock.front_door', 'turn_on'), /doesn't apply/);
  assert.throws(() => serviceFor('sensor.outside_temp', 'toggle'), /doesn't apply/);
});

test('tools: off until connected; status reads; control asks first, calls the service, reads back', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-25T20:00:00Z') });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  const calls: { url: string; method: string; body?: unknown; auth: string | null }[] = [];
  const state = new Map(STATES.map((s) => [s.entity_id, structuredClone(s)]));
  const fake = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.get('authorization') });
    const path = new URL(url).pathname;
    if (headers.get('authorization') !== 'Bearer good-token-1234567890') return new Response('', { status: 401 });
    if (path === '/api/states') return Response.json([...state.values()]);
    const one = /^\/api\/states\/(.+)$/.exec(path);
    if (one) return state.has(one[1]) ? Response.json(state.get(one[1])) : new Response('Entity not found', { status: 404 });
    const svc = /^\/api\/services\/(\w+)\/(\w+)$/.exec(path);
    if (svc) {
      const b = JSON.parse(String(init!.body)) as { entity_id: string; brightness_pct?: number };
      const s = state.get(b.entity_id)!;
      if (svc[2] === 'open_cover') s.state = 'open';
      if (svc[2] === 'turn_on') {
        s.state = 'on';
        if (b.brightness_pct) s.attributes = { ...s.attributes, brightness: Math.round((b.brightness_pct / 100) * 255) };
      }
      return Response.json([s]);
    }
    return new Response('', { status: 404 });
  };
  const [status, control] = createHomeTools(app, fake);
  const ctx = { signal: new AbortController().signal } as never;
  assert.equal(status.isAvailable!(), false, 'hidden until connected');
  assert.equal(control.defaultPermission, 'ask', 'changes ask the owner');
  assert.equal(status.defaultPermission, 'auto');

  app.settings.update({ home: { url: 'https://ha.example.com' } });
  app.vault.set(HOME_VAULT, 'good-token-1234567890');
  assert.equal(status.isAvailable!(), true);
  const overview = await status.run({}, ctx);
  assert.match(overview, /6 matches/);
  assert.match(overview, /information only/);
  assert.ok(overview.indexOf('light.kitchen') < overview.indexOf('sensor.outside_temp'), 'lights before sensors');
  assert.match(await status.run({ search: 'garage' }, ctx), /1 match:\n- cover\.garage · Garage door · closed \(0% open\)/);
  assert.match(await status.run({ domain: 'light', search: 'porch' }, ctx), /light\.porch/);
  await assert.rejects(status.run({ entity_id: 'light.attic' }, ctx), /no light\.attic/);
  await assert.rejects(status.run({ entity_id: '../etc' }, ctx), /looks like light\.kitchen/);

  const out = await control.run({ entity_id: 'light.porch', action: 'set_brightness', brightness: 40 }, ctx);
  assert.match(out, /Done: light\.turn_on for light\.porch\. Now: light\.porch · Porch light · on \(brightness 40%\)/);
  const svc = calls.find((c) => c.url.endsWith('/api/services/light/turn_on'))!;
  assert.deepEqual(svc.body, { entity_id: 'light.porch', brightness_pct: 40 });
  assert.equal(svc.method, 'POST');
  assert.match(await control.run({ entity_id: 'cover.garage', action: 'open' }, ctx), /Now: cover\.garage · Garage door · open/);
  await assert.rejects(control.run({ entity_id: 'lock.front_door', action: 'toggle' }, ctx), /doesn't apply/);
  assert.match(control.summarize({ entity_id: 'light.porch', action: 'set_brightness', brightness: 40 }), /^Home: set brightness light\.porch to 40%$/);

  app.vault.set(HOME_VAULT, 'stale-token-1234567890');
  await assert.rejects(status.run({}, ctx), /refused the access token/);
});
