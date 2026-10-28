// Phase 10: custom look (draft → full set of expressions + animation frames, swapped in atomically).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { LOOK_PATHS, LookBuilder } from '../src/look.ts';
import { tempDir } from './helpers.ts';

const png = (tag: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(tag)]);

test('look: draft, build the full set, serve it; failures leave the current look alone', async (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const calls: { path: string; prompt: string; ref?: string }[] = [];
  let failOn = '';
  const fake = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { prompt: string; image?: { url: string }; aspect_ratio: string };
    assert.equal(body.aspect_ratio, '1:1', 'square so frames line up');
    const path = new URL(url).pathname;
    calls.push({ path, prompt: body.prompt, ref: body.image?.url.slice(0, 40) });
    if (failOn && body.prompt.includes(failOn)) return new Response(JSON.stringify({ error: 'limit reached' }), { status: 429 });
    const tag = path.endsWith('generations') ? 'base' : body.prompt.includes('closed mid-blink') ? 'blink' : body.prompt.includes('mid-word') ? 'talk' : 'face';
    return new Response(JSON.stringify({ data: [{ b64_json: png(tag).toString('base64') }] }));
  };
  const look = new LookBuilder({ dataDir: dir, key: async () => 'tok', fetch: fake as never });

  await assert.rejects(look.draft('a 16 years old girl', 'photo'), /adult/);
  await look.draft('a man in his 30s with short dark curly hair and a beard', 'photo');
  assert.equal(look.status.state, 'draft-ready');
  assert.match(calls[0].prompt, /man in his 30s.*An adult\..*realistic photograph/s);
  assert.equal(calls[0].path, '/v1/images/generations');

  await look.build(look.draftBytes()!);
  assert.equal(look.status.state, 'done');
  assert.equal(look.status.step, 35);
  assert.equal(calls.filter((c) => c.path === '/v1/images/edits').length, 35, '5 expressions + 6 × (blink + 4 mouth shapes)');
  assert.ok(calls.some((c) => c.prompt.includes('barely open')), 'half-open mouth (Phase 27)');
  assert.ok(calls.some((c) => c.prompt.includes('"oo"')) && calls.some((c) => c.prompt.includes('"ee"')));
  for (const rel of LOOK_PATHS) assert.ok(existsSync(join(dir, 'look', rel)), rel);
  assert.equal(readFileSync(look.fileFor('sara-portrait.jpg')!).subarray(4).toString(), 'base');
  assert.equal(readFileSync(look.fileFor('sara/frames/happy-talk.jpg')!).subarray(4).toString(), 'talk');
  assert.equal(look.fileFor('sara/avatar-happy.jpg'), join(dir, 'look', 'sara', 'portrait-happy.jpg'), 'small mood avatars map to the portraits');
  assert.equal(look.fileFor('index.html'), undefined, 'only art paths');
  // A look made before the "oo"/"ee" mouths: missing, never the built-in face's mouth.
  rmSync(join(dir, 'look', 'sara', 'frames', 'happy-oo.jpg'));
  assert.equal(look.missing('sara/frames/happy-oo.jpg'), true);
  assert.equal(look.missing('sara/frames/happy-talk.jpg'), false);
  assert.equal(look.missing('index.html'), false);
  assert.deepEqual(look.missingFrames(), ['sara/frames/happy-oo.jpg']);
  const before = calls.length;
  await look.complete();
  assert.equal(calls.length, before + 1, 'only the missing picture is made');
  assert.ok(calls.at(-1)!.prompt.includes('"oo"'));
  assert.deepEqual(look.missingFrames(), []);
  assert.equal(look.draftBytes(), undefined, 'draft cleared');

  // A failed rebuild keeps the working look.
  failOn = 'sleepy';
  await assert.rejects(look.build(png('other')), /429.*limit reached/);
  assert.equal(look.status.state, 'failed');
  assert.equal(readFileSync(look.fileFor('sara-portrait.jpg')!).subarray(4).toString(), 'base', 'old look intact');
  assert.ok(!existsSync(join(dir, 'look-new')), 'scratch removed');

  look.reset();
  assert.equal(look.custom, false);
  assert.equal(look.fileFor('sara-portrait.jpg'), undefined);
});

test('look: no key gives a plain instruction', async (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const look = new LookBuilder({ dataDir: dir, key: async () => undefined });
  await assert.rejects(look.draft('a woman in her 40s', 'illustrated'), /Sign in to Grok/);
});
