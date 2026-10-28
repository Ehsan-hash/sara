// Phase 10: simple choices → a full character sheet (instant draft; model-written backstory with fallback).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quickCharacter, writeCharacter } from '../src/character.ts';
import { makeApp, tempDir, text } from './helpers.ts';

const choices = { name: 'Max', pronouns: 'he' as const, age: 34, relationship: 'friend', vibe: 'witty', talk: 'brief', interests: 'climbing, jazz, sourdough', extra: 'Grew up in Denver.' };

test('character: quick draft from choices uses name, pronouns and choices', () => {
  const p = quickCharacter(choices, 'Alex');
  assert.equal(p.name, 'Max');
  assert.equal(p.pronouns, 'he');
  assert.equal(p.summary, "He is Alex's close friend and right hand: easy to talk to, honest, and always in Alex's corner.");
  assert.deepEqual(p.background, ['Into climbing, jazz, sourdough.', 'Grew up in Denver.']);
  assert.ok(p.personality.some((x) => /dry wit/.test(x)));
  assert.ok(p.personality.includes('Has his own opinions, moods and preferences, and they stay consistent.'));
  assert.ok(p.speech.some((x) => /short and to the point/i.test(x)));
  assert.throws(() => quickCharacter({ ...choices, age: 16 }), /adult/);
});

test('character: model-written backstory, falling back to the quick draft', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex' });
  app.script.push(text('Sure! {"summary": "Max is a climber and jazz nerd who has been Alex\'s friend for years.", "background": ["Grew up in Denver.", "Works at a climbing gym."], "personality": ["Dry wit.", "Stubborn about bread."], "speech": ["Short, dry replies."]}'));
  const r = await writeCharacter(app, choices);
  assert.equal(r.written, true);
  assert.match(r.persona.summary, /climber and jazz nerd/);
  assert.deepEqual(r.persona.background, ['Grew up in Denver.', 'Works at a climbing gym.']);
  assert.ok(r.persona.speech.at(-1)!.includes('As an AI'), 'common rules kept');
  app.script.push(text('not json at all'));
  const fb = await writeCharacter(app, choices);
  assert.equal(fb.written, false);
  assert.equal(fb.persona.name, 'Max');
});
