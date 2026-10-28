// Phase 27: hands-free classic calls. You can talk over her while she is still answering.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error plain browser JavaScript, no types
import { Call } from '../web/voice.js';

class FakeMic {
  ctx = { sampleRate: 16000 };
  chunks: Float32Array[] = [];
  onFrame: ((f: Float32Array, level: number) => void) | null = null;
  async open() {}
  start() {}
  close() {}
  trim() {}
  stop() {
    return new Uint8Array(10);
  }
  /** `ms` of sound at `level`, in 20 ms frames. */
  feed(level: number, ms: number) {
    for (let t = 0; t < ms; t += 20) {
      const f = new Float32Array(320);
      this.chunks.push(f);
      this.onFrame?.(f, level);
    }
  }
}

test('classic call: she can be interrupted while her reply is still coming, and the new words are sent', async () => {
  const mic = new FakeMic();
  const speaker = { speaking: false, stopped: 0, stop() { this.stopped++; this.speaking = false; } };
  const said: string[] = [];
  let interrupts = 0;
  let finishReply: () => void = () => {};
  let n = 0;
  const call = new Call({
    mic,
    speaker,
    transcribe: async () => ['tell me a long story', 'wait, stop'][n++],
    onUtterance: (text: string) => {
      said.push(text);
      // Her reply takes a while (streaming, then speaking).
      return new Promise<void>((r) => (finishReply = r));
    },
    onInterrupt: () => interrupts++,
    onStatus: () => {},
  });
  await call.start();
  mic.feed(0.2, 400);
  mic.feed(0, 1000);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(said, ['tell me a long story']);
  // She's speaking her (still unfinished) reply; you talk over her.
  speaker.speaking = true;
  mic.feed(0.3, 500);
  assert.equal(speaker.stopped, 1, 'her voice stops');
  assert.equal(interrupts, 1, 'her reply is stopped');
  mic.feed(0, 1000);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(said, ['tell me a long story', 'wait, stop']);
  finishReply();
  call.stop();
});
