// Phase 43: when she answers in servers and groups, and the IDs the owner types in.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanDiscordIds, cleanTelegramIds, everyoneCalled, nameCalled } from '../src/bridges/rules.ts';

test('nameCalled: her name as a word, any case, not inside other words or @handles', () => {
  for (const t of ['Sara, are you there?', 'hey sara', 'ok SARA.', 'thanks Sara!', '¿Sara?']) assert.ok(nameCalled(t, 'Sara'), t);
  for (const t of ['Sarasota is nice', 'Isara', 'see @Sara_bot', 'nothing here']) assert.ok(!nameCalled(t, 'Sara'), t);
  assert.ok(nameCalled('Is Mary Jane around?', 'Mary Jane'));
  assert.ok(!nameCalled('anything', ''));
  assert.doesNotThrow(() => nameCalled('call (Dr.) now', '(Dr.)'), 'special characters in a name are escaped');
});

test('everyoneCalled: @all, @everyone, @here', () => {
  for (const t of ['@all lunch?', 'hey @everyone', '@here now']) assert.ok(everyoneCalled(t), t);
  for (const t of ['all of you', 'me@all.com', 'everyone']) assert.ok(!everyoneCalled(t), t);
});

test('IDs: kept when they look right, de-duplicated, from text or lists', () => {
  assert.deepEqual(cleanDiscordIds('123456789012345678, 123456789012345678\n987654321098765432 abc 12'), ['123456789012345678', '987654321098765432']);
  assert.deepEqual(cleanDiscordIds(['123456789012345678', 5]), ['123456789012345678']);
  assert.deepEqual(cleanTelegramIds('123456789, -1001234567890; x, 12'), [123456789, -1001234567890]);
  assert.deepEqual(cleanTelegramIds(''), []);
});
