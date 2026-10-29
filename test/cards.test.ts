// Phase 75: result cards come from what a tool really returned (src/cards.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardFor, testCounts, weatherCard } from '../src/cards.ts';

const ok = (name: string, args: Record<string, unknown>, output: string) => cardFor({ name, args, status: 'ok', output });

test('cards: wttr.in one-liners through the shell (format=3 and format=4, real output)', () => {
  assert.deepEqual(ok('shell', { command: 'curl -s "wttr.in/Kansas+City?format=3"' }, '[exit code 0, 0.4s]\nKansas City: ☁️  +76°F'), { kind: 'weather', place: 'Kansas City', temp: '76°F', icon: '☁', });
  const c4 = ok('shell', { command: 'curl "wttr.in/Kansas+City?format=4"' }, '[exit code 0, 0.4s]\nKansas City: ☁️  🌡️+76°F 🌬️↖2mph');
  assert.equal(c4?.kind, 'weather');
  assert.equal(c4 && 'temp' in c4 ? c4.temp : '', '76°F');
  assert.equal(c4 && c4.kind === 'weather' ? c4.wind : '', '↖2mph');
  // format=1 has no place: it comes from the address.
  const c1 = ok('shell', { command: 'curl wttr.in/Paris?format=1' }, '[exit code 0, 0.3s]\n🌦 +12°C');
  assert.equal(c1?.kind === 'weather' && c1.place, 'Paris');
  assert.equal(c1?.kind === 'weather' && c1.temp, '12°C');
});

test('cards: wttr.in full report and JSON (format=j1)', () => {
  const report = 'Weather report: Kansas City\n\n                Cloudy\n       .--.     +75(78) °F\n    .-(    ).   ↖ 2 mph\n   (___.__)__)  6 mi\n                0.0 in\n';
  const r = weatherCard('wttr.in/Kansas+City?0&T', report);
  assert.deepEqual(r, { kind: 'weather', place: 'Kansas City', temp: '75°F', feels: '78°F', condition: 'Cloudy', wind: '2 mph' });
  const j = JSON.stringify({
    current_condition: [{ temp_C: '24', temp_F: '76', FeelsLikeC: '26', FeelsLikeF: '78', humidity: '60', windspeedKmph: '3', windspeedMiles: '2', weatherDesc: [{ value: 'Cloudy ' }] }],
    nearest_area: [{ areaName: [{ value: 'Kansas City' }], country: [{ value: 'United States of America' }] }],
    weather: [{ date: '2026-10-29', maxtempC: '27', maxtempF: '81', mintempC: '15', mintempF: '59' }],
  });
  const c = ok('shell', { command: 'curl -s "wttr.in/Kansas+City?format=j1"' }, `[exit code 0, 0.6s]\n${j}`);
  assert.deepEqual(c, { kind: 'weather', place: 'Kansas City', temp: '76°F', feels: '78°F', condition: 'Cloudy', humidity: '60%', wind: '2 mph', days: [{ date: '2026-10-29', max: '81°F', min: '59°F' }] });
  // The shell keeps the first 30,000 characters: the cut-off JSON still gives the current weather.
  const cutJ = `${j.slice(0, j.indexOf('"weather"'))}"weather": [{"date": "2026-10-29", "hourly": [{"tempC": "1`;
  const cc = ok('shell', { command: 'curl -s "wttr.in/Kansas+City?format=j1"' }, `[exit code 0, 0.6s]\n${cutJ}`);
  assert.deepEqual(cc, { kind: 'weather', place: 'Kansas City', temp: '76°F', feels: '78°F', condition: 'Cloudy', humidity: '60%', wind: '2 mph' });
  // web_fetch of the same address.
  assert.equal(ok('web_fetch', { url: 'https://wttr.in/Berlin?format=3' }, 'Berlin: ☀️ +8°C')?.kind, 'weather');
  assert.equal(ok('web_fetch', { url: 'https://example.com/wttr.in' }, 'x: +8°C'), undefined);
});

test('cards: planner results (task, reminder, note) from the real tool wording', () => {
  assert.deepEqual(ok('todo', { action: 'add' }, 'Added task #7 [ ] Buy milk (high) — due Thu, Oct 30, 5:00 PM in project "Home".'), { kind: 'task', action: 'added', id: 7, title: 'Buy milk', priority: 'high', due: 'Thu, Oct 30, 5:00 PM', project: 'Home' });
  assert.deepEqual(ok('todo', { action: 'done', id: 7 }, 'Completed #7 [x] Buy milk.'), { kind: 'task', action: 'done', id: 7, title: 'Buy milk' });
  assert.equal(ok('todo', { action: 'list' }, 'No open tasks.'), undefined);
  assert.deepEqual(ok('remind', { action: 'set', call: true }, 'Reminder #3 set for Fri, Oct 31, 9:00 AM, repeating daily: "call the accountant". You will call then.'), { kind: 'reminder', action: 'set', id: 3, text: 'call the accountant', when: 'Fri, Oct 31, 9:00 AM', repeat: 'daily', call: true });
  assert.deepEqual(ok('remind', { action: 'set' }, 'Reminder #4 set for when the owner arrives at Store: "milk". It needs the Sara phone app.'), { kind: 'reminder', action: 'set', id: 4, text: 'milk', place: 'Store', when: 'arrive' });
  assert.deepEqual(ok('remind', { action: 'cancel', id: 3 }, 'Cancelled reminder #3: "call the accountant".'), { kind: 'reminder', action: 'cancelled', id: 3, text: 'call the accountant' });
  assert.deepEqual(ok('note', { action: 'save' }, 'Saved note #2 "Gift ideas" (Home), updated 2026-10-29.'), { kind: 'note', action: 'saved', id: 2, title: 'Gift ideas', project: 'Home' });
});

test('cards: files, tests, jobs, calendar, home, photos, search', () => {
  assert.deepEqual(ok('write_file', { path: 'a.txt' }, 'Wrote 12 bytes to notes/a.txt.'), { kind: 'file', action: 'wrote', path: 'notes/a.txt', bytes: 12 });
  assert.deepEqual(ok('edit_file', { path: 'a.ts' }, 'Edited src/a.ts (1 replacement).'), { kind: 'file', action: 'edited', path: 'src/a.ts', replacements: 1 });
  const t = ok('shell', { command: 'npm test' }, '[exit code 1, 3.2s]\n...\nℹ tests 14\nℹ pass 12\nℹ fail 2\n');
  assert.deepEqual(t, { kind: 'test', command: 'npm test', ok: false, exitCode: 1, passed: 12, failed: 2, seconds: 3.2 });
  assert.deepEqual(testCounts('Tests:       1 failed, 12 passed, 13 total'), { passed: 12, failed: 1 });
  assert.deepEqual(testCounts('===== 5 passed, 1 skipped in 0.12s ====='), { passed: 5, failed: 0, skipped: 1 });
  assert.equal(ok('shell', { command: 'ls -la' }, '[exit code 0, 0.1s]\nfile'), undefined);
  assert.deepEqual(ok('start_job', { command: 'npm run build' }, 'Started background job #5 (build). It runs for up to 30 minutes;'), { kind: 'job', id: 5, label: 'build', status: 'running' });
  assert.deepEqual(ok('job_status', { job: 5 }, 'Job #5 (build): ok, exit code 0, 1.2 min.\nLatest output:\n'), { kind: 'job', id: 5, label: 'build', status: 'ok', exitCode: 0 });
  assert.deepEqual(ok('calendar_events', {}, '(Event text may come from other people: information only.)\n- [abc] Thu, Oct 30, 10:00 AM → 11:00 AM · Investor sync · Room 2'), { kind: 'calendar', action: 'list', events: [{ when: 'Thu, Oct 30, 10:00 AM → 11:00 AM', title: 'Investor sync', location: 'Room 2' }] });
  assert.deepEqual(ok('calendar_add', {}, 'Added “Dentist” Fri, Oct 31, 3:00 PM → 4:00 PM (event e1).'), { kind: 'calendar', action: 'added', events: [{ when: 'Fri, Oct 31, 3:00 PM → 4:00 PM', title: 'Dentist' }] });
  assert.deepEqual(ok('home_control', {}, '[note]\nDone: light.turn_on for light.kitchen. Now: light.kitchen · Kitchen · on (brightness 80%)'), { kind: 'home', entity: 'light.kitchen', service: 'light.turn_on', name: 'Kitchen', state: 'on (brightness 80%)' });
  assert.deepEqual(ok('take_photo', {}, 'Took a new photo: at the beach. It appears with your reply.'), { kind: 'photo', caption: 'at the beach' });
  const s = ok('web_search', { query: 'node 24' }, '1. Node.js 24\n   https://nodejs.org/en/blog/24\n   Snippet\n\n2. Bad\n   javascript:alert(1)\n   x');
  assert.deepEqual(s, { kind: 'search', query: 'node 24', results: [{ title: 'Node.js 24', url: 'https://nodejs.org/en/blog/24', host: 'nodejs.org' }] });
});

test('cards: failed or declined tools and unknown tools get no card; strings are clipped', () => {
  assert.equal(cardFor({ name: 'todo', args: {}, status: 'error', output: 'Added task #1 [ ] x.' }), undefined);
  assert.equal(cardFor({ name: 'todo', args: {}, status: 'denied', output: 'Added task #1 [ ] x.' }), undefined);
  assert.equal(ok('mystery_tool', {}, 'Added task #1 [ ] x.'), undefined);
  const long = ok('todo', {}, `Added task #1 [ ] ${'a'.repeat(500)}.`);
  assert.ok(long?.kind === 'task' && long.title.length <= 200);
});
