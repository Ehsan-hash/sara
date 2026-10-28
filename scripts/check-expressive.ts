// Phase 37 check on real Grok voice: tagged speech is accepted, the tags are performed (not read
// out as words), and a live call's transcript comes back clean after stripTags.
//   XAI_KEY=… node scripts/check-expressive.ts [out dir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPRESSIVE_SAMPLE, stripTags } from '../src/expressive.ts';
import { xaiTranscribe } from '../src/speech.ts';
import { tagged } from '../src/speech.ts';
import { xaiSpeak } from '../src/voice.ts';

const key = process.env.XAI_KEY;
if (!key) throw new Error('XAI_KEY needed');
const out = process.argv[2] ?? 'expressive-check';
mkdirSync(out, { recursive: true });
const cfg = { voiceId: 'eve', language: 'en' };
let ok = true;

// 1. Read-aloud and voice notes: the same speak path (tags added from cues in her text).
for (const level of ['off', 'subtle', 'lively'] as const) {
  const text = level === 'off' ? tagged(EXPRESSIVE_SAMPLE, 'off', {}, 'natural') : tagged(EXPRESSIVE_SAMPLE, level, {}, 'natural');
  const audio = await xaiSpeak(cfg, key, text, 1);
  writeFileSync(join(out, `sample-${level}.mp3`), audio.data);
  const heard = await xaiTranscribe(key, audio.data);
  const spokenTags = /\b(laugh|chuckle|sigh|whisper|bracket|pause)\b/i.test(heard.replace(/sighs?/gi, (m) => (level === 'off' ? m : m)));
  console.log(`${level.padEnd(6)} sent: ${text}\n       heard: ${heard}\n       ${audio.data.length} bytes${level !== 'off' && spokenTags ? '  <-- a tag was read out as a word' : ''}`);
  if (level !== 'off' && /\b(chuckle|whisper|bracket)\b/i.test(heard)) ok = false;
}

// 2. Live call: the realtime voice with the expressive instruction; its transcript is cleaned.
const ws = new WebSocket('wss://api.x.ai/v1/realtime', { headers: { authorization: `Bearer ${key}` } } as never);
const transcript: string[] = [];
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('live: timeout')), 90_000);
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'session.update', session: { voice: 'eve', instructions: "You are Sara, talking with Alex on a live call. Short turns. Let your voice be expressive: laugh when something is funny, sigh, take a breath, drop to a whisper for something private. Never say the names of these sounds out loud and never write them as words.", turn_detection: null, audio: { output: { format: { type: 'audio/pcm', rate: 24000 } } } } }));
    ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Tell me the dumbest thing you did this week, and then whisper a secret.' }] } }));
    ws.send(JSON.stringify({ type: 'response.create' }));
  });
  ws.addEventListener('message', (m) => {
    if (typeof m.data !== 'string') return;
    const ev = JSON.parse(m.data) as { type: string; delta?: string; error?: { message?: string } };
    if (ev.type === 'response.output_audio_transcript.delta') transcript.push(String(ev.delta ?? ''));
    if (ev.type === 'error') {
      clearTimeout(timer);
      reject(new Error(`live: ${ev.error?.message ?? 'error'}`));
    }
    if (ev.type === 'response.done') {
      clearTimeout(timer);
      resolve();
    }
  });
  ws.addEventListener('error', () => reject(new Error('live: socket error')));
});
ws.close();
const raw = transcript.join('');
console.log(`live   raw transcript: ${raw}\n       saved/shown:    ${stripTags(raw)}`);
if (/\[(laugh|chuckle|sigh|breath|pause)\]|<\/?(whisper|soft)>/i.test(stripTags(raw))) ok = false;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
