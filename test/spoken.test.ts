// One spoken-text cleaner (src/spoken.ts) for the app's voice, Alexa and Home Assistant speakers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { speechText as speakerText } from '../src/alexa.ts';
import { FOR_APP, FOR_SPEAKER, spokenText } from '../src/spoken.ts';
import { speechText as appText } from '../src/voice.ts';

test('spoken: underscores inside names become spaces; underscore emphasis is still removed', () => {
  assert.equal(spokenText('use my_var_name now'), 'use my var name now');
  assert.equal(spokenText('use my_var_name now', FOR_SPEAKER), 'use my var name now');
  assert.equal(spokenText('set `MAX_SIZE` to 3'), 'set MAX SIZE to 3');
  assert.equal(spokenText('this is _really_ good and __very__ bold'), 'this is really good and very bold');
  assert.equal(spokenText('**bold**, *it*, ~~gone~~ and *a*'), 'bold, it, gone and a');
});

test('spoken: links and code are worded by where she is heard', () => {
  const text = 'See https://www.example.com/a?b=1 and [the docs](https://x.y/z).\n```js\nlet a = 1;\n```';
  assert.equal(spokenText(text, FOR_APP), 'See a link and the docs. (I put the code in the chat.)');
  assert.equal(spokenText(text, FOR_SPEAKER), 'See example.com and the docs. (I left out some code: it is in the Sara app.)');
  assert.equal(spokenText('Code:\n```\nnever closed', FOR_APP), 'Code: (I put the code in the chat.)');
  assert.equal(spokenText('x', { links: 'host' }), 'x', 'other options default to the app voice');
});

test('spoken: emoji, flags, joiners and control characters go; a long text is cut at a sentence', () => {
  assert.equal(spokenText('Hi 👋🏽 there ❤️ 🇺🇸 👩‍💻!\u0007'), 'Hi there !');
  const long = spokenText('This is a sentence. '.repeat(100), { ...FOR_SPEAKER, max: 200 });
  assert.ok(long.length <= 200 + ' The rest is in the Sara app.'.length);
  assert.ok(long.endsWith('sentence. The rest is in the Sara app.'));
  assert.equal(spokenText('word '.repeat(100)).length, 499, 'the app voice is not cut here (speech.ts limits it)');
});

test('spoken: the voice.ts and alexa.ts wrappers are the shared cleaner', () => {
  const s = '# Hi\n- **one** my_var https://a.example/x';
  assert.equal(appText(s), spokenText(s, FOR_APP));
  assert.equal(speakerText(s), spokenText(s, FOR_SPEAKER));
  assert.equal(speakerText(s), 'Hi one my var a.example');
});
