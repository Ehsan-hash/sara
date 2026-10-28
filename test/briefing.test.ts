// Phase 8: morning briefing (time window, weather facts, fallback, delivery).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BriefingWorker, defaultUnits, geocode, plainBriefing } from '../src/briefing.ts';
import { makeApp, tempDir } from './helpers.ts';

const fakeFetch = async (url: string) => {
  if (url.includes('geocoding')) return new Response(JSON.stringify({ results: [{ name: 'Kansas City', latitude: 39.1, longitude: -94.6, admin1: 'Kansas', country_code: 'US' }, { name: 'Kansas City', latitude: 39.09, longitude: -94.58, admin1: 'Missouri', country_code: 'US' }] }));
  if (url.includes('forecast')) {
    assert.match(url, /temperature_unit=fahrenheit/);
    return new Response(JSON.stringify({ current: { temperature_2m: 51.4, weather_code: 2 }, daily: { temperature_2m_max: [68.2], temperature_2m_min: [47.9], precipitation_probability_max: [20], weather_code: [61] } }));
  }
  return new Response('{}', { status: 404 });
};

test('geocode picks the state the owner named; units follow the time zone', async () => {
  const p = await geocode('Kansas City, MO', fakeFetch as never);
  assert.equal(p.name, 'Kansas City, Missouri, US');
  assert.equal(defaultUnits('America/Chicago'), 'F');
  assert.equal(defaultUnits('Europe/Berlin'), 'C');
  assert.equal(defaultUnits('America/Sao_Paulo'), 'C');
});

test('briefing goes out once, at the chosen time, with weather and the list', async (t) => {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date('2026-10-26T12:00:00Z') }; // 07:00 in Chicago
  const app = makeApp(dir, clock);
  t.after(() => {
    app.store.close();
    cleanup();
  });
  app.settings.update({
    providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }],
    defaultProviderId: 'p',
    defaultModel: 'm',
    ownerName: 'Alex',
    timeZone: 'America/Chicago',
    briefing: { enabled: true, time: '07:30', place: { name: 'Kansas City, Missouri, US', lat: 39.09, lon: -94.58 } },
  });
  app.planner!.addTask({ title: 'Call the plumber', dueAt: '2026-10-26T20:00:00Z' });
  const conv = app.store.createConversation({});
  app.store.addMessage(conv.id, 'user', 'hi');
  const w = new BriefingWorker(app, fakeFetch as never);
  assert.equal(await w.tick(), undefined, 'not yet 07:30');
  clock.now = new Date('2026-10-26T12:31:00Z');
  app.script.push([{ type: 'text', text: 'Morning, Alex! Light rain later, high 68°. Don\u2019t forget to call the plumber today.' }]);
  const sent = await w.tick();
  assert.match(sent!, /plumber/);
  const req = app.requests.at(-1)!;
  assert.match(JSON.stringify(req.messages), /Kansas City: light rain, now 51°F, high 68°, low 48°, 20% chance of rain/);
  assert.match(JSON.stringify(req.messages), /Call the plumber/);
  const last = app.store.messages(conv.id).at(-1)!;
  assert.deepEqual(last.meta?.briefing, { day: '2026-10-26' });
  assert.equal(await w.tick(), undefined, 'only once a day');

  // Model unavailable → plain facts; a briefing missed by hours is skipped.
  clock.now = new Date('2026-10-27T12:35:00Z');
  app.script.push([{ type: 'text', text: '' }]);
  const plain = await w.tick();
  assert.match(plain!, /^Good morning! It's Tuesday, October 27\./);
  clock.now = new Date('2026-10-28T20:00:00Z');
  assert.equal(await w.tick(), undefined, '7 hours late: skipped');
});

test('plain briefing reads well', () => {
  const t = plainBriefing({ date: 'Monday, October 26', weather: 'KC: clear', agenda: '- task #3 "Pay rent": due today Mon 5:00 PM\n- 2 other open tasks (use the todo tool to list them)' });
  assert.equal(t, `Good morning! It's Monday, October 26.\nWeather: KC: clear.\nOn your list:\n- "Pay rent": due today Mon 5:00 PM\n- 2 other open tasks`);
});
