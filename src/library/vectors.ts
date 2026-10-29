// Phase 74: meaning search that scales to hundreds of thousands of passages. Vectors are kept in
// SQLite as Float32 blobs (exact) and, for searching, in memory as one block of 8-bit numbers
// (int8, a quarter of the size) with a scale per vector. A query is compared with every vector
// in that block (a plain loop over typed arrays, a few milliseconds per 10,000 passages), and the
// best few dozen are scored again exactly from their Float32 copies. Nothing here comes from a
// library; it is a brute-force top-k, measured in docs/RESULTS.md.
import type { DatabaseSync } from 'node:sqlite';

/** How many candidates the int8 pass keeps for the exact second pass. */
const RERANK = 48;

/** A vector as 8-bit numbers plus its scale (x ≈ q * scale). */
export function quantize(v: Float32Array): { q: Int8Array; scale: number } {
  let max = 0;
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i]);
    if (a > max) max = a;
  }
  const scale = max / 127 || 1;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(v[i] / scale)));
  return { q, scale };
}

const asFloat = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

/** The in-memory search block for one embedding model. */
export class VectorIndex {
  readonly model: string;
  dim = 0;
  count = 0;
  #ids = new Int32Array(1024);
  #docs = new Int32Array(1024);
  #scales = new Float32Array(1024);
  #q = new Int8Array(0);

  constructor(model: string, capacity = 1024) {
    this.model = model;
    const n = Math.max(16, capacity);
    this.#ids = new Int32Array(n);
    this.#docs = new Int32Array(n);
    this.#scales = new Float32Array(n);
  }

  /** Builds the block from the database (one pass, rows streamed). */
  static load(db: DatabaseSync, model: string): VectorIndex {
    // Sized once for what is there (plus room to grow), so a big library isn't allocated twice.
    const n = (db.prepare('SELECT COUNT(*) AS n FROM library_vectors WHERE model = ?').get(model) as { n: number }).n;
    const ix = new VectorIndex(model, Math.ceil(n * 1.05) + 64);
    const rows = db.prepare('SELECT v.passage_id AS id, p.doc_id AS doc, v.vec AS vec FROM library_vectors v JOIN library_passages p ON p.id = v.passage_id WHERE v.model = ?').iterate(model) as Iterable<{ id: number; doc: number; vec: Uint8Array }>;
    for (const r of rows) ix.add(r.id, r.doc, asFloat(r.vec));
    return ix;
  }

  #grow(need: number): void {
    if (need <= this.#ids.length) return;
    let n = this.#ids.length;
    while (n < need) n = Math.ceil(n * 1.5);
    const ids = new Int32Array(n);
    ids.set(this.#ids.subarray(0, this.count));
    const docs = new Int32Array(n);
    docs.set(this.#docs.subarray(0, this.count));
    const scales = new Float32Array(n);
    scales.set(this.#scales.subarray(0, this.count));
    const q = new Int8Array(n * this.dim);
    q.set(this.#q.subarray(0, this.count * this.dim));
    this.#ids = ids;
    this.#docs = docs;
    this.#scales = scales;
    this.#q = q;
  }

  add(id: number, doc: number, vec: Float32Array): void {
    if (!this.dim) {
      this.dim = vec.length;
      this.#q = new Int8Array(this.#ids.length * this.dim);
    }
    if (vec.length !== this.dim) return; // another model's size: ignored
    this.#grow(this.count + 1);
    const { q, scale } = quantize(vec);
    this.#ids[this.count] = id;
    this.#docs[this.count] = doc;
    this.#scales[this.count] = scale;
    this.#q.set(q, this.count * this.dim);
    this.count++;
  }

  /** Bytes the block uses (for the Library page and the measurements). */
  get bytes(): number {
    return this.#q.byteLength + this.#ids.byteLength * 3;
  }

  /**
   * The ids of the vectors closest to the query (approximate scores from the int8 block), only
   * in the allowed documents. `limit` candidates, best first.
   */
  candidates(query: Float32Array, allowedDocs: Set<number>, limit = RERANK): { id: number; score: number }[] {
    const dim = this.dim;
    if (!dim || query.length !== dim) return [];
    const q = this.#q;
    // A small sorted list of the best so far (limit is a few dozen).
    const bestIds: number[] = [];
    const bestScores: number[] = [];
    let floor = -Infinity;
    for (let r = 0; r < this.count; r++) {
      if (!allowedDocs.has(this.#docs[r])) continue;
      let s = 0;
      const base = r * dim;
      for (let i = 0; i < dim; i++) s += q[base + i] * query[i];
      s *= this.#scales[r];
      if (bestIds.length < limit || s > floor) {
        let at = bestScores.length;
        while (at > 0 && bestScores[at - 1] < s) at--;
        bestScores.splice(at, 0, s);
        bestIds.splice(at, 0, this.#ids[r]);
        if (bestIds.length > limit) {
          bestIds.pop();
          bestScores.pop();
        }
        floor = bestScores[bestScores.length - 1];
      }
    }
    return bestIds.map((id, i) => ({ id, score: bestScores[i] }));
  }
}

/** Exact cosine scores for a few passages (their Float32 vectors from the database). */
export function exactScores(db: DatabaseSync, model: string, query: Float32Array, ids: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (!ids.length) return out;
  const rows = db.prepare(`SELECT passage_id AS id, vec FROM library_vectors WHERE model = ? AND passage_id IN (${ids.map(() => '?').join(',')})`).all(model, ...ids) as { id: number; vec: Uint8Array }[];
  for (const r of rows) {
    const v = asFloat(r.vec);
    if (v.length !== query.length) continue;
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * query[i];
    out.set(r.id, s);
  }
  return out;
}
