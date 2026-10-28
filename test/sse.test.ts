import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sseEvents } from '../src/sse.ts';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

test('parses events split across chunks, CRLF, comments and multi-line data', async () => {
  const events = [];
  for await (const ev of sseEvents(streamOf(': ping\n\nevent: a\nda', 'ta: one\r\n\r\ndata: x\ndata: y\n\n', 'data: tail'))) events.push(ev);
  assert.deepEqual(events, [
    { event: 'a', data: 'one' },
    { event: undefined, data: 'x\ny' },
    { event: undefined, data: 'tail' },
  ]);
});
