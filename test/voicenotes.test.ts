// Phase 11: voice notes on Telegram: she listens (transcribed) and answers with a voice note.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TELEGRAM_VAULT, TelegramBridge } from '../src/bridges/telegram.ts';
import { Speech } from '../src/speech.ts';
import { listen, makeApp, tempDir, text } from './helpers.ts';

const TOKEN = '123456789:test';
const OWNER = 1001;

class FakeSpeech extends Speech {
  heard: number[] = [];
  spoken: string[] = [];
  canHearNotes() {
    return true;
  }
  canSendNotes() {
    return true;
  }
  async transcribe(audio: Buffer) {
    this.heard.push(audio.length);
    return 'what should I cook tonight';
  }
  async speak(t: string) {
    this.spoken.push(t);
    return { data: Buffer.from('ID3 fake mp3'), type: 'audio/mpeg' };
  }
}

test('telegram voice notes: transcribed into the chat, answered with a voice note (and text for code)', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex', telegram: { enabled: true, allowOthers: false, mirror: false, ownerChatId: OWNER } });
  app.vault.set(TELEGRAM_VAULT, TOKEN);
  const speech = new FakeSpeech(app);
  app.speech = speech;
  const calls: { method: string; type: string; size: number }[] = [];
  const { server, url } = await listen(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    if (req.url === `/file/bot${TOKEN}/voice/file_7.oga`) return void res.writeHead(200, { 'content-type': 'audio/ogg' }).end(Buffer.alloc(3000));
    const method = (req.url ?? '').split('/').pop()!;
    calls.push({ method, type: String(req.headers['content-type'] ?? ''), size: raw.length });
    const result = method === 'getMe' ? { id: 999, is_bot: true, username: 'sara_test_bot' } : method === 'getUpdates' ? await new Promise((r) => setTimeout(() => r([]), 50)) : method === 'getFile' ? { file_path: 'voice/file_7.oga' } : true;
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result }));
  });
  const bridge = new TelegramBridge(app, { apiBase: url });
  await bridge.restart();
  t.after(() => {
    bridge.stop();
    server.close();
    app.store.close();
    cleanup();
  });

  app.script.push(text('Pasta with whatever veg you have. Want a recipe?'));
  await bridge.handle({ update_id: 1, message: { message_id: 1, chat: { id: OWNER, type: 'private' }, from: { id: OWNER, first_name: 'Alex' }, voice: { file_id: 'abc', duration: 2, file_size: 3000 } } });
  assert.deepEqual(speech.heard, [3000], 'downloaded and transcribed');
  const conv = app.store.findChannelConversation('telegram', String(OWNER))!;
  assert.ok(app.store.messages(conv.id).some((m) => m.role === 'user' && m.content === '🎤 what should I cook tonight'));
  assert.deepEqual(speech.spoken, ['Pasta with whatever veg you have. Want a recipe?']);
  const voice = calls.find((c) => c.method === 'sendVoice');
  assert.ok(voice && voice.type.startsWith('multipart/form-data') && voice.size > 0, 'sent as a voice note');

  // Code in the reply: sent as text, not read out.
  app.script.push(text('Here:\n```\nboil water\n```'));
  await bridge.handle({ update_id: 2, message: { message_id: 2, chat: { id: OWNER, type: 'private' }, from: { id: OWNER, first_name: 'Alex' }, voice: { file_id: 'abc', file_size: 3000 } } });
  assert.equal(speech.spoken.length, 1);

  // Typed message: answered in text (default: voice only when you send voice).
  app.script.push(text('Sure thing.'));
  const before = calls.filter((c) => c.method === 'sendVoice').length;
  await bridge.handle({ update_id: 3, message: { message_id: 3, chat: { id: OWNER, type: 'private' }, from: { id: OWNER, first_name: 'Alex' }, text: 'thanks' } });
  assert.equal(calls.filter((c) => c.method === 'sendVoice').length, before);

  // "Always" answers typed messages with voice too.
  app.settings.update({ voice: { ...app.settings.get().voice, noteReplies: 'always' } as never });
  app.script.push(text('Anytime.'));
  await bridge.handle({ update_id: 4, message: { message_id: 4, chat: { id: OWNER, type: 'private' }, from: { id: OWNER, first_name: 'Alex' }, text: 'you rock' } });
  assert.equal(speech.spoken.at(-1), 'Anytime.');
});
