// Phase 45: documents are read in a separate thread with its own memory limit and a time limit,
// so a strange or hostile file can only fail itself: the server keeps answering meanwhile, and a
// file that would use too much memory or time is stopped with a plain message.
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { readDocument, ReadError, type ReadResult } from './read.ts';

const READ_TIMEOUT_MS = 3 * 60_000;
const READ_MEMORY_MB = 1536;

interface Reply {
  ok: boolean;
  result?: ReadResult;
  message?: string;
  readError?: boolean;
}

if (!isMainThread && (workerData as { saraReader?: boolean } | null)?.saraReader) {
  parentPort!.once('message', async (msg: { name: string; bytes: Uint8Array }) => {
    let reply: Reply;
    try {
      reply = { ok: true, result: await readDocument(msg.name, Buffer.from(msg.bytes.buffer, msg.bytes.byteOffset, msg.bytes.byteLength)) };
    } catch (err) {
      reply = { ok: false, message: (err as Error).message, readError: err instanceof ReadError };
    }
    parentPort!.postMessage(reply);
  });
}

/** Reads a document in its own thread (same result as readDocument, or a ReadError). */
export function readInThread(name: string, bytes: Buffer, opts: { signal?: AbortSignal; timeoutMs?: number; memoryMb?: number } = {}): Promise<ReadResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), {
      workerData: { saraReader: true },
      resourceLimits: { maxOldGenerationSizeMb: opts.memoryMb ?? READ_MEMORY_MB },
      execArgv: ['--disable-warning=ExperimentalWarning'],
    });
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      void w.terminate();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new ReadError('Reading this document took too long, so she stopped. Try saving it again from the program that made it, or as a PDF.'))), opts.timeoutMs ?? READ_TIMEOUT_MS);
    const onAbort = () => finish(() => reject(new ReadError('Reading was stopped before it finished.')));
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    w.once('message', (r: Reply) =>
      finish(() => {
        if (!r.ok || !r.result) return reject(r.readError ? new ReadError(r.message ?? 'She couldn\'t read this document.') : new Error(r.message));
        // Pictures come back as plain bytes: make them Buffers again.
        const result = r.result;
        resolve({ ...result, images: result.images.map((im) => ({ ...im, data: Buffer.from(im.data) })) });
      }),
    );
    w.once('error', (err: Error & { code?: string }) =>
      finish(() => reject(err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new ReadError('This document needs more memory to read than she allows, so she stopped.') : new ReadError(`She couldn't read this document (${err.message}).`))),
    );
    w.once('exit', (code) => finish(() => reject(new ReadError(`She couldn't read this document (the reader stopped, code ${code}).`))));
    w.postMessage({ name, bytes });
  });
}
