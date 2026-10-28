// Phase 44: a PDF text reader written from scratch. It finds every object in the file (by
// scanning, so damaged cross-reference tables don't matter, plus compressed object streams),
// opens compressed streams, walks the pages in order and runs each page's drawing instructions
// just far enough to know which text is shown where, so words, lines and paragraphs come out in
// reading order. Fonts are mapped to letters through their ToUnicode tables or their encodings.
// PDFs "locked" with an empty password (common for statements) are opened; really
// password-protected ones are refused politely. A page that is only a picture (a scan) is handed
// back as an image for the picture model.
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { constants, deflateSync, inflateSync } from 'node:zlib';
import type { DocPart, PageImage, ReadResult } from './read.ts';
import { ReadError } from './read.ts';

// ---------------------------------------------------------------- objects

class Ref {
  readonly num: number;
  readonly gen: number;
  constructor(num: number, gen: number) {
    this.num = num;
    this.gen = gen;
  }
}
class Name {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}
/** A PDF string: raw bytes (decoded by whoever uses it). */
class PStr {
  bytes: Buffer;
  constructor(bytes: Buffer) {
    this.bytes = bytes;
  }
}
class Op {
  readonly op: string;
  constructor(op: string) {
    this.op = op;
  }
}
type Dict = Map<string, PVal>;
type PVal = number | boolean | null | Name | PStr | Ref | PVal[] | Dict | Stream;
interface Stream {
  dict: Dict;
  raw: Buffer;
  /** Which object it is (for decryption). */
  num: number;
  gen: number;
}
const isDict = (v: unknown): v is Dict => v instanceof Map;
const isStream = (v: unknown): v is Stream => typeof v === 'object' && v !== null && !(v instanceof Map) && 'raw' in (v as object) && 'dict' in (v as object);

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

/** Reads PDF tokens and values from a buffer. */
class Lexer {
  readonly b: Buffer;
  pos: number;
  constructor(b: Buffer, pos = 0) {
    this.b = b;
    this.pos = pos;
  }

  skipWs(): void {
    const b = this.b;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (WS.has(c)) this.pos++;
      else if (c === 0x25) {
        // comment to end of line
        while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      } else break;
    }
  }

  /** The next value or operator; undefined at the end. */
  next(depth = 0): PVal | Op | undefined {
    if (depth > 64) throw new ReadError('This PDF is nested too deeply to read.');
    this.skipWs();
    const b = this.b;
    if (this.pos >= b.length) return undefined;
    const c = b[this.pos];
    if (c === 0x2f) return this.#name();
    if (c === 0x28) return this.#literal();
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return this.#dict(depth);
      }
      return this.#hex();
    }
    if (c === 0x3e && b[this.pos + 1] === 0x3e) {
      this.pos += 2;
      return new Op('>>');
    }
    if (c === 0x5b) {
      this.pos++;
      const arr: PVal[] = [];
      for (;;) {
        const v = this.next(depth + 1);
        if (v === undefined) break;
        if (v instanceof Op) {
          if (v.op === ']') break;
          if (v.op === 'R' && arr.length >= 2) {
            const gen = arr.pop() as number;
            const num = arr.pop() as number;
            arr.push(new Ref(num, gen));
          }
          continue;
        }
        arr.push(v);
      }
      return arr;
    }
    if (c === 0x5d) {
      this.pos++;
      return new Op(']');
    }
    if (c === 0x7b || c === 0x7d) {
      this.pos++;
      return new Op(String.fromCharCode(c));
    }
    // number or keyword
    const start = this.pos;
    while (this.pos < b.length && !WS.has(b[this.pos]) && !DELIM.has(b[this.pos])) this.pos++;
    if (this.pos === start) {
      this.pos++;
      return new Op(String.fromCharCode(c));
    }
    const word = b.toString('latin1', start, this.pos);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    return new Op(word);
  }

  #name(): Name {
    const b = this.b;
    this.pos++;
    let s = '';
    while (this.pos < b.length && !WS.has(b[this.pos]) && !DELIM.has(b[this.pos])) {
      if (b[this.pos] === 0x23 && /^[0-9a-fA-F]{2}$/.test(b.toString('latin1', this.pos + 1, this.pos + 3))) {
        s += String.fromCharCode(parseInt(b.toString('latin1', this.pos + 1, this.pos + 3), 16));
        this.pos += 3;
      } else s += String.fromCharCode(b[this.pos++]);
    }
    return new Name(s);
  }

  #literal(): PStr {
    const b = this.b;
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 0x5c) {
        const e = b[this.pos++];
        const map: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };
        if (e in map) out.push(map[e]);
        else if (e >= 0x30 && e <= 0x37) {
          let n = e - 0x30;
          for (let k = 0; k < 2 && b[this.pos] >= 0x30 && b[this.pos] <= 0x37; k++) n = n * 8 + (b[this.pos++] - 0x30);
          out.push(n & 0xff);
        } else if (e === 0x0d) {
          if (b[this.pos] === 0x0a) this.pos++;
        } else if (e !== 0x0a) out.push(e);
      } else if (c === 0x28) {
        depth++;
        out.push(c);
      } else if (c === 0x29) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return new PStr(Buffer.from(out));
  }

  #hex(): PStr {
    const b = this.b;
    this.pos++;
    let s = '';
    while (this.pos < b.length && b[this.pos] !== 0x3e) {
      const ch = String.fromCharCode(b[this.pos++]);
      if (/[0-9a-fA-F]/.test(ch)) s += ch;
    }
    this.pos++;
    if (s.length % 2) s += '0';
    return new PStr(Buffer.from(s, 'hex'));
  }

  #dict(depth: number): Dict {
    const d: Dict = new Map();
    const items: (PVal | Op)[] = [];
    for (;;) {
      const v = this.next(depth + 1);
      if (v === undefined) break;
      if (v instanceof Op) {
        if (v.op === '>>') break;
        if (v.op === 'R' && items.length >= 2) {
          const gen = items.pop() as number;
          const num = items.pop() as number;
          items.push(new Ref(num, gen));
        }
        continue;
      }
      items.push(v);
    }
    for (let i = 0; i + 1 < items.length; i += 2) {
      const k = items[i];
      if (k instanceof Name) d.set(k.name, items[i + 1] as PVal);
      else i--; // a stray value: resync on the next name
    }
    return d;
  }
}

// ---------------------------------------------------------------- filters

/** The most one stream may decode to, and all of a document's streams together. */
const MAX_STREAM = 128 * 1024 * 1024;
const MAX_DOC_DECODED = 768 * 1024 * 1024;

function inflate(b: Buffer): Buffer {
  try {
    return inflateSync(b, { maxOutputLength: MAX_STREAM });
  } catch {
    // Truncated or slightly damaged: keep what decompresses.
    try {
      return inflateSync(b, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: MAX_STREAM });
    } catch {
      return Buffer.alloc(0);
    }
  }
}

function asciiHex(b: Buffer): Buffer {
  const s = b.toString('latin1').replace(/>.*$/s, '').replace(/[^0-9a-fA-F]/g, '');
  return Buffer.from(s.length % 2 ? `${s}0` : s, 'hex');
}

/** A growing byte buffer with a hard size limit (decoders write into it, never into JS arrays). */
class Bytes {
  buf = Buffer.alloc(4096);
  len = 0;
  push(v: number): void {
    if (this.len === this.buf.length) this.#grow(1);
    this.buf[this.len++] = v;
  }
  pushAll(src: ArrayLike<number>): void {
    if (this.len + src.length > this.buf.length) this.#grow(src.length);
    for (let i = 0; i < src.length; i++) this.buf[this.len++] = src[i];
  }
  fill(v: number, n: number): void {
    if (this.len + n > this.buf.length) this.#grow(n);
    this.buf.fill(v, this.len, this.len + n);
    this.len += n;
  }
  #grow(need: number): void {
    if (this.len + need > MAX_STREAM) throw new ReadError('This PDF has a part too large to read.');
    const next = Buffer.alloc(Math.min(MAX_STREAM, Math.max(this.buf.length * 2, this.len + need)));
    this.buf.copy(next, 0, 0, this.len);
    this.buf = next;
  }
  done(): Buffer {
    return this.buf.subarray(0, this.len);
  }
}

function ascii85(b: Buffer): Buffer {
  const s = b.toString('latin1').replace(/^<~/, '').replace(/~>.*$/s, '').replace(/\s/g, '');
  const out = new Bytes();
  let group: number[] = [];
  for (const ch of s) {
    if (ch === 'z' && !group.length) {
      out.fill(0, 4);
      continue;
    }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) continue;
    group.push(c);
    if (group.length === 5) {
      let n = 0;
      for (const g of group) n = n * 85 + g;
      out.pushAll([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
      group = [];
    }
  }
  if (group.length > 1) {
    const k = group.length;
    while (group.length < 5) group.push(84);
    let n = 0;
    for (const g of group) n = n * 85 + g;
    out.pushAll([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].slice(0, k - 1));
  }
  return out.done();
}

function lzw(b: Buffer, early = 1): Buffer {
  const out = new Bytes();
  let dict: Uint8Array[] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < 256; i++) dict.push(Uint8Array.of(i));
    dict.push(new Uint8Array(0), new Uint8Array(0));
  };
  reset();
  let bits = 9;
  let buf = 0;
  let have = 0;
  let prev: Uint8Array | null = null;
  const join = (a: Uint8Array, c: number) => {
    const r = new Uint8Array(a.length + 1);
    r.set(a);
    r[a.length] = c;
    return r;
  };
  for (let i = 0; i < b.length; i++) {
    buf = (buf << 8) | b[i];
    have += 8;
    while (have >= bits) {
      const code = (buf >>> (have - bits)) & ((1 << bits) - 1);
      have -= bits;
      buf &= (1 << have) - 1;
      if (code === 256) {
        reset();
        bits = 9;
        prev = null;
        continue;
      }
      if (code === 257) return out.done();
      let entry: Uint8Array;
      if (code < dict.length) entry = dict[code];
      else if (prev) entry = join(prev, prev[0]);
      else return out.done();
      out.pushAll(entry);
      if (prev && dict.length < 4096) dict.push(join(prev, entry[0]));
      prev = entry;
      if (dict.length + early >= 1 << bits && bits < 12) bits++;
    }
  }
  return out.done();
}

function runLength(b: Buffer): Buffer {
  const out = new Bytes();
  for (let i = 0; i < b.length; ) {
    const n = b[i++];
    if (n === 128) break;
    if (n < 128) {
      const end = Math.min(b.length, i + n + 1);
      out.pushAll(b.subarray(i, end));
      i = end;
    } else out.fill(b[i++], 257 - n);
  }
  return out.done();
}

/** Undoes PNG/TIFF predictors (DecodeParms /Predictor). */
function unpredict(b: Buffer, parms: Dict | undefined): Buffer {
  const pred = Number(parms?.get('Predictor') ?? 1);
  if (pred < 10) return b;
  const colors = Number(parms?.get('Colors') ?? 1);
  const bpc = Number(parms?.get('BitsPerComponent') ?? 8);
  const cols = Number(parms?.get('Columns') ?? 1);
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const row = Math.ceil((colors * bpc * cols) / 8);
  const out = Buffer.alloc(Math.floor(b.length / (row + 1)) * row);
  let prev = Buffer.alloc(row);
  for (let r = 0, i = 0; i + row < b.length + 1 && r * row < out.length; r++) {
    const type = b[i++];
    const cur = Buffer.from(b.subarray(i, i + row));
    i += row;
    for (let x = 0; x < row; x++) {
      const left = x >= bpp ? cur[x - bpp] : 0;
      const up = prev[x];
      const ul = x >= bpp ? prev[x - bpp] : 0;
      if (type === 1) cur[x] = (cur[x] + left) & 255;
      else if (type === 2) cur[x] = (cur[x] + up) & 255;
      else if (type === 3) cur[x] = (cur[x] + ((left + up) >> 1)) & 255;
      else if (type === 4) {
        const p = left + up - ul;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - ul);
        cur[x] = (cur[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)) & 255;
      }
    }
    cur.copy(out, r * row);
    prev = cur;
  }
  return out;
}

const IMAGE_FILTERS = new Set(['DCTDecode', 'DCT', 'JPXDecode', 'CCITTFaxDecode', 'CCF', 'JBIG2Decode']);

// ---------------------------------------------------------------- encryption (empty password)

const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

function aesCbc(key: Buffer, data: Buffer, iv?: Buffer, padded = true): Buffer {
  const ivv = iv ?? data.subarray(0, 16);
  const body = iv ? data : data.subarray(16);
  if (!body.length || body.length % 16) return Buffer.alloc(0);
  const d = createDecipheriv(key.length === 32 ? 'aes-256-cbc' : 'aes-128-cbc', key, ivv);
  d.setAutoPadding(false);
  const out = Buffer.concat([d.update(body), d.final()]);
  if (!padded) return out;
  const p = out[out.length - 1];
  return p >= 1 && p <= 16 ? out.subarray(0, out.length - p) : out;
}

/** Revision 6 password hash (ISO 32000-2, algorithm 2.B), for the empty password. */
function hash6(pw: Buffer, salt: Buffer, udata: Buffer): Buffer {
  let k = createHash('sha256').update(Buffer.concat([pw, salt, udata])).digest();
  for (let i = 0; ; i++) {
    const k1 = Buffer.concat(Array.from({ length: 64 }, () => Buffer.concat([pw, k, udata])));
    const c = createCipherNoPad(k.subarray(0, 16), k.subarray(16, 32), k1);
    let sum = 0;
    for (let j = 0; j < 16; j++) sum += c[j];
    k = createHash(['sha256', 'sha384', 'sha512'][sum % 3]).update(c).digest();
    if (i >= 63 && c[c.length - 1] <= i - 32) break;
  }
  return k.subarray(0, 32);
}

function createCipherNoPad(key: Buffer, iv: Buffer, data: Buffer): Buffer {
  // AES-128-CBC encryption without padding (data is a multiple of 16).
  const c = createCipheriv('aes-128-cbc', key, iv);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
}

interface Crypt {
  /** Decrypts a stream's or string's bytes for object num/gen. */
  data(b: Buffer, num: number, gen: number, isString?: boolean): Buffer;
}

function bytesOf(v: PVal | undefined): Buffer {
  return v instanceof PStr ? v.bytes : Buffer.alloc(0);
}

function setupCrypt(enc: Dict, ids: PVal | undefined): Crypt {
  const filter = (enc.get('Filter') as Name | undefined)?.name;
  if (filter && filter !== 'Standard') throw new ReadError('This PDF is protected with a certificate or a special lock, so she can\'t open it.');
  const v = Number(enc.get('V') ?? 0);
  const r = Number(enc.get('R') ?? 2);
  const o = bytesOf(enc.get('O'));
  const u = bytesOf(enc.get('U'));
  const p = Number(enc.get('P') ?? 0);
  const id0 = Array.isArray(ids) && ids[0] instanceof PStr ? ids[0].bytes : Buffer.alloc(0);
  const locked = () => new ReadError('This PDF is locked with a password, so she can\'t read it. Open it, save or print a copy without the password, and add that.');
  // Which method strings and streams use (V4/V5 name their crypt filters).
  let method: 'rc4' | 'aes128' | 'aes256' | 'none' = 'rc4';
  if (v >= 4) {
    const cf = enc.get('CF');
    const stmf = (enc.get('StmF') as Name | undefined)?.name ?? 'Identity';
    const f = isDict(cf) ? cf.get(stmf) : undefined;
    const cfm = isDict(f) ? (f.get('CFM') as Name | undefined)?.name : undefined;
    method = stmf === 'Identity' ? 'none' : cfm === 'AESV2' ? 'aes128' : cfm === 'AESV3' ? 'aes256' : 'rc4';
  }
  if (r >= 5) {
    const pw = Buffer.alloc(0);
    const check = r === 5 ? createHash('sha256').update(Buffer.concat([pw, u.subarray(32, 40)])).digest() : hash6(pw, u.subarray(32, 40), Buffer.alloc(0));
    if (!check.equals(u.subarray(0, 32))) throw locked();
    const ik = r === 5 ? createHash('sha256').update(Buffer.concat([pw, u.subarray(40, 48)])).digest() : hash6(pw, u.subarray(40, 48), Buffer.alloc(0));
    const fileKey = aesCbc(ik, bytesOf(enc.get('UE')), Buffer.alloc(16), false);
    return { data: (b) => (method === 'none' ? b : aesCbc(fileKey, b)) };
  }
  const len = v === 1 ? 5 : Math.max(5, Math.min(16, Number(enc.get('Length') ?? 40) / 8));
  const pb = Buffer.alloc(4);
  pb.writeInt32LE(p | 0);
  const meta = enc.get('EncryptMetadata') === false && r >= 4 ? Buffer.from([255, 255, 255, 255]) : Buffer.alloc(0);
  let key = createHash('md5').update(Buffer.concat([PAD, o, pb, id0, meta])).digest();
  if (r >= 3) for (let i = 0; i < 50; i++) key = createHash('md5').update(key.subarray(0, len)).digest();
  key = key.subarray(0, len);
  // Is the empty password the user password?
  let ok: boolean;
  if (r === 2) ok = rc4(key, PAD).equals(u.subarray(0, 32));
  else {
    let x = rc4(key, createHash('md5').update(Buffer.concat([PAD, id0])).digest());
    for (let i = 1; i <= 19; i++) x = rc4(Buffer.from(key.map((k) => k ^ i)), x);
    ok = x.equals(u.subarray(0, 16));
  }
  if (!ok) throw locked();
  return {
    data(b, num, gen) {
      if (method === 'none') return b;
      const ext = Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255]);
      const ok2 = createHash('md5').update(Buffer.concat([key, ext, method === 'aes128' ? Buffer.from('sAlT') : Buffer.alloc(0)])).digest().subarray(0, Math.min(16, len + 5));
      return method === 'aes128' ? aesCbc(ok2, b) : rc4(ok2, b);
    },
  };
}

// ---------------------------------------------------------------- the document

class Doc {
  readonly b: Buffer;
  readonly objs = new Map<number, { pos?: number; val?: PVal; gen: number; inStm?: { stm: number; idx: number } }>();
  trailer: Dict = new Map();
  crypt: Crypt | undefined;
  /** Bytes unpacked so far (a small file that unpacks to gigabytes is refused). */
  decoded = 0;
  #resolving = new Set<number>();

  constructor(b: Buffer) {
    this.b = b;
    this.#scan();
  }

  #scan(): void {
    const s = this.b.toString('latin1');
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      // A later definition (incremental update) replaces an earlier one.
      this.objs.set(Number(m[1]), { pos: m.index + m[0].length, gen: Number(m[2]) });
      if (this.objs.size > 2_000_000) throw new ReadError('This PDF is too large to read.');
    }
    // Trailers (the last one wins), or cross-reference streams (which carry the same keys).
    const tre = /trailer\s*<</g;
    for (let m = tre.exec(s); m; m = tre.exec(s)) {
      const lx = new Lexer(this.b, m.index + m[0].length - 2);
      const d = lx.next();
      if (isDict(d)) for (const [k, v] of d) this.trailer.set(k, v);
    }
    for (const [num] of this.objs) {
      const v = this.#parse(num);
      if (isStream(v)) {
        const type = (v.dict.get('Type') as Name | undefined)?.name;
        if (type === 'XRef') for (const k of ['Root', 'Info', 'Encrypt', 'ID']) if (v.dict.has(k) && !this.trailer.has(k)) this.trailer.set(k, v.dict.get(k)!);
      }
    }
    // Objects packed inside object streams (only those not written out directly).
    for (const [num] of [...this.objs]) {
      const v = this.#parse(num);
      if (!isStream(v) || (v.dict.get('Type') as Name | undefined)?.name !== 'ObjStm') continue;
      this.#unpackObjStm(num, v);
    }
  }

  #unpackObjStm(num: number, v: Stream): void {
    let data: Buffer;
    try {
      data = this.streamData(v);
    } catch {
      return;
    }
    const n = Number(v.dict.get('N') ?? 0);
    const first = Number(v.dict.get('First') ?? 0);
    const lx = new Lexer(data);
    const heads: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const on = lx.next();
      const off = lx.next();
      if (typeof on !== 'number' || typeof off !== 'number') break;
      heads.push([on, off]);
    }
    for (const [on, off] of heads) {
      if (this.objs.has(on) && this.objs.get(on)!.pos !== undefined) continue;
      try {
        const vlx = new Lexer(data, first + off);
        const val = readValue(vlx);
        this.objs.set(on, { gen: 0, val, inStm: { stm: num, idx: 0 } });
      } catch {
        /* a damaged entry: skip it */
      }
    }
  }

  /** The object itself (streams keep their raw bytes until read). */
  #parse(num: number): PVal {
    const e = this.objs.get(num);
    if (!e) return null;
    if (e.val !== undefined) return e.val;
    if (e.pos === undefined) return null;
    const lx = new Lexer(this.b, e.pos);
    let val = readValue(lx);
    // A stream follows its dictionary.
    lx.skipWs();
    if (isDict(val) && this.b.toString('latin1', lx.pos, lx.pos + 6) === 'stream') {
      let p = lx.pos + 6;
      if (this.b[p] === 0x0d) p++;
      if (this.b[p] === 0x0a) p++;
      const lenV = val.get('Length');
      let len = typeof lenV === 'number' ? lenV : -1;
      if (lenV instanceof Ref && !this.#resolving.has(lenV.num)) {
        this.#resolving.add(lenV.num);
        const l = this.#parse(lenV.num);
        this.#resolving.delete(lenV.num);
        if (typeof l === 'number') len = l;
      }
      let end = len >= 0 ? p + len : -1;
      // Check the length really ends at "endstream" (it is often wrong); else search for it.
      if (end < 0 || end > this.b.length || !/^\s*endstream/.test(this.b.toString('latin1', end, end + 20))) {
        const found = this.b.indexOf('endstream', p, 'latin1');
        end = found < 0 ? this.b.length : found;
        while (end > p && (this.b[end - 1] === 0x0a || this.b[end - 1] === 0x0d)) end--;
      }
      val = { dict: val, raw: this.b.subarray(p, end), num, gen: e.gen } as Stream;
    }
    e.val = val;
    return val;
  }

  get(v: PVal | undefined, depth = 0): PVal | undefined {
    if (v instanceof Ref) {
      if (depth > 32) return undefined;
      return this.get(this.#parse(v.num), depth + 1);
    }
    return v;
  }

  dict(v: PVal | undefined): Dict | undefined {
    const r = this.get(v);
    return isDict(r) ? r : isStream(r) ? r.dict : undefined;
  }

  name(v: PVal | undefined): string | undefined {
    const r = this.get(v);
    return r instanceof Name ? r.name : undefined;
  }

  num(v: PVal | undefined, d = 0): number {
    const r = this.get(v);
    return typeof r === 'number' ? r : d;
  }

  arr(v: PVal | undefined): PVal[] {
    const r = this.get(v);
    return Array.isArray(r) ? r : r === undefined || r === null ? [] : [r];
  }

  /** A stream's decoded bytes (image filters are left as they are). */
  streamData(s: Stream, _stopAtImage = false): Buffer {
    let data = s.raw;
    const type = (s.dict.get('Type') as Name | undefined)?.name;
    if (this.crypt && type !== 'XRef' && !(type === 'Metadata')) data = this.crypt.data(data, s.num, s.gen);
    const filters = this.arr(s.dict.get('Filter')).map((f) => (this.get(f) as Name | undefined)?.name ?? '');
    const parms = this.arr(s.dict.get('DecodeParms'));
    for (let i = 0; i < filters.length; i++) {
      const f = filters[i];
      const p = this.dict(parms[i]);
      if (f === 'FlateDecode' || f === 'Fl') data = unpredict(inflate(data), p);
      else if (f === 'ASCIIHexDecode' || f === 'AHx') data = asciiHex(data);
      else if (f === 'ASCII85Decode' || f === 'A85') data = ascii85(data);
      else if (f === 'LZWDecode' || f === 'LZW') data = unpredict(lzw(data, this.num(p?.get('EarlyChange'), 1)), p);
      else if (f === 'RunLengthDecode' || f === 'RL') data = runLength(data);
      else if (IMAGE_FILTERS.has(f)) return data; // pictures stay encoded (JPEG goes to the picture model as it is)
      if (data.length > MAX_STREAM) throw new ReadError('This PDF has a part too large to read.');
    }
    this.decoded += data.length;
    if (this.decoded > MAX_DOC_DECODED) throw new ReadError('This PDF unpacks to far more than its size, so she stopped reading it.');
    return data;
  }

  /** Decrypts a string found directly in an object (not in a stream). */
  str(v: PVal | undefined, owner?: { num: number; gen: number }): Buffer | undefined {
    const r = this.get(v);
    if (!(r instanceof PStr)) return undefined;
    return this.crypt && owner ? this.crypt.data(r.bytes, owner.num, owner.gen, true) : r.bytes;
  }

  refOf(v: PVal | undefined): { num: number; gen: number } | undefined {
    return v instanceof Ref ? { num: v.num, gen: this.objs.get(v.num)?.gen ?? v.gen } : undefined;
  }
}

/** Reads one value (dictionaries and arrays whole, "n g R" as a reference). */
function readValue(lx: Lexer): PVal {
  const v = lx.next();
  if (v instanceof Op || v === undefined) return null;
  if (typeof v === 'number') {
    const save = lx.pos;
    const g = lx.next();
    if (typeof g === 'number') {
      const r = lx.next();
      if (r instanceof Op && r.op === 'R') return new Ref(v, g);
    }
    lx.pos = save;
  }
  return v;
}

/** A PDF "text string" (titles): UTF-16 with a byte-order mark, else PDFDocEncoding (≈ Latin-1). */
function textString(b: Buffer): string {
  if (b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2, 2 + ((b.length - 2) & ~1))).swap16().toString('utf16le');
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  return b.toString('latin1');
}

// ---------------------------------------------------------------- fonts

const STANDARD_DIFF: Record<number, string> = { 0x27: '\u2019', 0x60: '\u2018', 0xa1: '¡', 0xa2: '¢', 0xa3: '£', 0xa4: '\u2044', 0xa5: '¥', 0xa6: 'ƒ', 0xa7: '§', 0xa8: '¤', 0xa9: "'", 0xaa: '\u201c', 0xab: '«', 0xac: '\u2039', 0xad: '\u203a', 0xae: 'fi', 0xaf: 'fl', 0xb1: '\u2013', 0xb2: '\u2020', 0xb3: '\u2021', 0xb4: '·', 0xb6: '¶', 0xb7: '\u2022', 0xb8: '\u201a', 0xb9: '\u201e', 0xba: '\u201d', 0xbb: '»', 0xbc: '\u2026', 0xbd: '\u2030', 0xbf: '¿', 0xc1: '`', 0xc2: '´', 0xc3: 'ˆ', 0xc4: '˜', 0xc5: '¯', 0xc6: '˘', 0xc7: '˙', 0xc8: '¨', 0xca: '˚', 0xcb: '¸', 0xcd: '˝', 0xce: '˛', 0xcf: 'ˇ', 0xd0: '\u2014', 0xe1: 'Æ', 0xe3: 'ª', 0xe8: 'Ł', 0xe9: 'Ø', 0xea: 'Œ', 0xeb: 'º', 0xf1: 'æ', 0xf5: 'ı', 0xf8: 'ł', 0xf9: 'ø', 0xfa: 'œ', 0xfb: 'ß' };

const cp1252 = new TextDecoder('windows-1252');
let macDecoder: TextDecoder | undefined;
try {
  macDecoder = new TextDecoder('macintosh');
} catch {
  macDecoder = undefined;
}

function baseEncoding(name: string | undefined): string[] {
  const out: string[] = [];
  for (let c = 0; c < 256; c++) {
    if (name === 'MacRomanEncoding' && macDecoder) out.push(c < 128 ? String.fromCharCode(c) : macDecoder.decode(Uint8Array.of(c)));
    else if (name === 'WinAnsiEncoding') out.push(cp1252.decode(Uint8Array.of(c)));
    else if (name === 'StandardEncoding' || name === undefined) out.push(STANDARD_DIFF[c] ?? (c >= 0x80 ? '' : String.fromCharCode(c)));
    else out.push(String.fromCharCode(c));
  }
  return out;
}

/** Glyph names (from /Differences) to letters: the common Adobe names, uniXXXX and uXXXX. */
const GLYPHS: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", quoteright: '\u2019', quoteleft: '\u2018', parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '\u2212', period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
  bullet: '\u2022', endash: '\u2013', emdash: '\u2014', ellipsis: '\u2026', quotedblleft: '\u201c', quotedblright: '\u201d', quotesinglbase: '\u201a', quotedblbase: '\u201e', guillemotleft: '«', guillemotright: '»', guilsinglleft: '\u2039', guilsinglright: '\u203a', dagger: '\u2020', daggerdbl: '\u2021', trademark: '\u2122', copyright: '©', registered: '®', degree: '°', section: '§', paragraph: '¶', periodcentered: '·', multiply: '×', divide: '÷', plusminus: '±', fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', Euro: '€', euro: '€', sterling: '£', yen: '¥', cent: '¢', florin: 'ƒ', germandbls: 'ß', dotlessi: 'ı', nbspace: ' ', uni00A0: ' ', onehalf: '½', onequarter: '¼', threequarters: '¾', mu: 'µ', exclamdown: '¡', questiondown: '¿', ordfeminine: 'ª', ordmasculine: 'º', logicalnot: '¬', brokenbar: '¦', dieresis: '¨', macron: '¯', acute: '´', cedilla: '¸', circumflex: 'ˆ', tilde: '˜', caron: 'ˇ', breve: '˘', dotaccent: '˙', ring: '˚', ogonek: '˛', hungarumlaut: '˝', fraction: '\u2044', perthousand: '\u2030', OE: 'Œ', oe: 'œ', AE: 'Æ', ae: 'æ', Oslash: 'Ø', oslash: 'ø', Lslash: 'Ł', lslash: 'ł', Eth: 'Ð', eth: 'ð', Thorn: 'Þ', thorn: 'þ', checkmark: '\u2713', arrowright: '\u2192', arrowleft: '\u2190',
};
const ACCENTS: Record<string, string> = { acute: '\u0301', grave: '\u0300', circumflex: '\u0302', dieresis: '\u0308', tilde: '\u0303', ring: '\u030a', cedilla: '\u0327', caron: '\u030c' };

export function glyphToText(name: string): string {
  if (name in GLYPHS) return GLYPHS[name];
  if (/^[A-Za-z]$/.test(name)) return name;
  let m = /^uni([0-9A-Fa-f]{4,})$/.exec(name);
  if (m) {
    let s = '';
    for (let i = 0; i + 4 <= m[1].length; i += 4) s += String.fromCharCode(parseInt(m[1].slice(i, i + 4), 16));
    return s;
  }
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  // Accented letters: Aacute, eacute, odieresis…
  m = /^([A-Za-z])(acute|grave|circumflex|dieresis|tilde|ring|cedilla|caron)$/.exec(name);
  if (m) return (m[1] + ACCENTS[m[2]]).normalize('NFC');
  // "a.sc", "one.oldstyle", "f_f_i": the part before the dot; ligatures joined.
  if (name.includes('.')) return glyphToText(name.split('.')[0]);
  if (name.includes('_')) return name.split('_').map(glyphToText).join('');
  return '';
}

interface Font {
  /** Splits a string's bytes into character codes. */
  codes(b: Buffer): number[];
  text(code: number): string;
  /** Glyph advance in thousandths of the font size. */
  width(code: number): number;
  /** True when the code is a single-byte 32 (word spacing applies). */
  isSpace(code: number): boolean;
  /** Letters it couldn't map (for the "unreadable font" warning). */
  unknown: number;
}

/** Reads a ToUnicode CMap: code ranges (byte lengths) and the code → text mappings. */
export function parseCMap(src: string): { map: Map<number, string>; lengths: { len: number; lo: number; hi: number }[] } {
  const map = new Map<number, string>();
  const lengths: { len: number; lo: number; hi: number }[] = [];
  const hex = (h: string) => parseInt(h || '0', 16);
  const utf16 = (h: string) => {
    const b = Buffer.from(h.length % 2 ? `${h}0` : h, 'hex');
    return b.length >= 2 ? Buffer.from(b.subarray(0, b.length & ~1)).swap16().toString('utf16le') : String.fromCharCode(b[0] ?? 0);
  };
  for (const m of src.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const r of m[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) lengths.push({ len: r[1].length / 2, lo: hex(r[1]), hi: hex(r[2]) });
  }
  for (const m of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const r of m[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(hex(r[1]), utf16(r[2]));
  }
  for (const m of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of m[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = hex(r[1]);
      const hi = Math.min(hex(r[2]), lo + 65535);
      if (r[3].startsWith('[')) {
        const items = [...r[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]);
        for (let c = lo; c <= hi && c - lo < items.length; c++) map.set(c, utf16(items[c - lo]));
      } else {
        const dst = r[3].slice(1, -1);
        const b = Buffer.from(dst.length % 2 ? `${dst}0` : dst, 'hex');
        for (let c = lo; c <= hi; c++) {
          const nb = Buffer.from(b);
          // The last byte counts up (carrying into the one before, as some writers expect).
          let add = c - lo;
          for (let i = nb.length - 1; i >= 0 && add; i--) {
            const s = nb[i] + add;
            nb[i] = s & 255;
            add = s >> 8;
          }
          map.set(c, nb.length >= 2 ? Buffer.from(nb.subarray(0, nb.length & ~1)).swap16().toString('utf16le') : String.fromCharCode(nb[0] ?? 0));
        }
      }
    }
  }
  return { map, lengths };
}

function loadFont(doc: Doc, fd: Dict | undefined): Font {
  const sub = doc.name(fd?.get('Subtype'));
  let cmap: ReturnType<typeof parseCMap> | undefined;
  const tu = doc.get(fd?.get('ToUnicode'));
  if (isStream(tu)) {
    try {
      cmap = parseCMap(doc.streamData(tu).toString('latin1'));
    } catch {
      cmap = undefined;
    }
  }
  const font: Font = { codes: () => [], text: () => '', width: () => 500, isSpace: () => false, unknown: 0 };
  if (sub === 'Type0') {
    const desc = doc.dict(doc.arr(fd?.get('DescendantFonts'))[0]);
    // Widths: /W [c [w1 w2 …]] or [c1 c2 w]; default /DW.
    const dw = doc.num(desc?.get('DW'), 1000);
    const widths = new Map<number, number>();
    const w = doc.arr(desc?.get('W'));
    for (let i = 0; i < w.length && widths.size < 200_000; ) {
      const c = doc.get(w[i]);
      const n = doc.get(w[i + 1]);
      if (typeof c === 'number' && Array.isArray(n)) {
        n.forEach((x, k) => widths.set(c + k, doc.num(x)));
        i += 2;
      } else if (typeof c === 'number' && typeof n === 'number') {
        const wv = doc.num(w[i + 2]);
        for (let k = c; k <= n && k - c < 65536; k++) widths.set(k, wv);
        i += 3;
      } else i++;
    }
    const lens = cmap?.lengths.length ? cmap.lengths : [{ len: 2, lo: 0, hi: 0xffff }];
    font.codes = (b) => {
      const out: number[] = [];
      for (let i = 0; i < b.length; ) {
        let done = false;
        for (const len of [...new Set(lens.map((l) => l.len))].sort((x, y) => x - y)) {
          if (i + len > b.length) continue;
          let c = 0;
          for (let k = 0; k < len; k++) c = (c << 8) | b[i + k];
          if (lens.some((l) => l.len === len && c >= l.lo && c <= l.hi)) {
            out.push(c);
            i += len;
            done = true;
            break;
          }
        }
        if (!done) {
          out.push(b.length - i >= 2 ? (b[i] << 8) | b[i + 1] : b[i]);
          i += Math.min(2, b.length - i);
        }
      }
      return out;
    };
    font.width = (c) => widths.get(c) ?? dw;
    font.text = (c) => {
      const t = cmap?.map.get(c);
      if (t !== undefined) return t;
      font.unknown++;
      return '';
    };
    return font;
  }
  // Simple fonts (Type1, TrueType, Type3, MMType1): one byte per character.
  const encV = doc.get(fd?.get('Encoding'));
  const encD = isDict(encV) ? encV : undefined;
  const flags = doc.num(doc.dict(fd?.get('FontDescriptor'))?.get('Flags'));
  const symbolic = (flags & 4) !== 0 && !(flags & 32);
  const baseName = encV instanceof Name ? encV.name : doc.name(encD?.get('BaseEncoding'));
  const table = baseEncoding(baseName ?? (sub === 'TrueType' || symbolic ? 'latin1' : undefined));
  const diffs = doc.arr(encD?.get('Differences'));
  let code = 0;
  for (const d of diffs) {
    const v = doc.get(d);
    if (typeof v === 'number') code = v;
    else if (v instanceof Name) {
      if (code < 256) table[code] = glyphToText(v.name);
      code++;
    }
  }
  const first = doc.num(fd?.get('FirstChar'), 0);
  const ws = doc.arr(fd?.get('Widths')).map((x) => doc.num(x));
  const missing = doc.num(doc.dict(fd?.get('FontDescriptor'))?.get('MissingWidth'), 0) || 500;
  const isType3 = sub === 'Type3';
  const fm = isType3 ? doc.arr(fd?.get('FontMatrix')).map((x) => doc.num(x)) : [];
  const t3scale = isType3 && fm.length ? fm[0] * 1000 : 1;
  font.codes = (b) => [...b];
  font.width = (c) => (c - first >= 0 && c - first < ws.length ? ws[c - first] * t3scale : missing);
  font.isSpace = (c) => c === 32;
  font.text = (c) => {
    const t = cmap?.map.get(c);
    if (t !== undefined) return t;
    const s = table[c];
    if (s) return s;
    font.unknown++;
    return '';
  };
  return font;
}

// ---------------------------------------------------------------- pages

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const ID: M = [1, 0, 0, 1, 0, 0];

interface Run {
  text: string;
  x: number;
  y: number;
  endX: number;
  size: number;
}

interface PageOut {
  runs: Run[];
  images: { w: number; h: number; stream: Stream }[];
}

/** Runs a page's drawing instructions, collecting the text runs (with positions) and images. */
function runContent(doc: Doc, data: Buffer, res: Dict | undefined, out: PageOut, ctm0: M, depth: number, budget: { ops: number }): void {
  const lx = new Lexer(data);
  const stack: (PVal | Op)[] = [];
  let ctm: M = ctm0;
  const saved: M[] = [];
  let tm: M = ID;
  let tlm: M = ID;
  let font: Font | undefined;
  let fs = 12;
  let tc = 0;
  let tw = 0;
  let th = 1;
  let tl = 0;
  let rise = 0;
  const fonts = new Map<string, Font>();
  const fontRes = doc.dict(res?.get('Font'));
  const xobjs = doc.dict(res?.get('XObject'));
  const fontOf = (n: string): Font => {
    if (!fonts.has(n)) fonts.set(n, loadFont(doc, doc.dict(fontRes?.get(n))));
    return fonts.get(n)!;
  };
  const show = (s: Buffer) => {
    if (!font) font = loadFont(doc, undefined);
    const codes = font.codes(s);
    let txt = '';
    const start = mul([1, 0, 0, 1, 0, rise], mul(tm, ctm));
    for (const c of codes) {
      txt += font.text(c);
      const adv = ((font.width(c) / 1000) * fs + tc + (font.isSpace(c) ? tw : 0)) * th;
      tm = mul([1, 0, 0, 1, adv, 0], tm);
    }
    const end = mul(tm, ctm);
    const scale = Math.hypot(start[2], start[3]) || 1;
    if (txt) out.runs.push({ text: txt, x: start[4], y: start[5], endX: end[4], size: Math.abs(fs * scale) || 1 });
  };
  for (;;) {
    if (++budget.ops > 25_000_000) throw new ReadError('This PDF takes too long to read.');
    let t: PVal | Op | undefined;
    try {
      t = lx.next();
    } catch {
      break;
    }
    if (t === undefined) break;
    if (!(t instanceof Op)) {
      stack.push(t);
      if (stack.length > 10_000) stack.splice(0, 5_000);
      continue;
    }
    const op = t.op;
    const args = stack.splice(0);
    const n = (i: number) => (typeof args[i] === 'number' ? (args[i] as number) : 0);
    switch (op) {
      case 'BI': {
        // Inline image: skip its bytes up to EI.
        const ei = data.indexOf('EI', lx.pos, 'latin1');
        let p = ei;
        while (p >= 0 && !(WS.has(data[p - 1]) && (p + 2 >= data.length || WS.has(data[p + 2])))) p = data.indexOf('EI', p + 2, 'latin1');
        lx.pos = p < 0 ? data.length : p + 2;
        break;
      }
      case 'q':
        saved.push(ctm);
        if (saved.length > 256) saved.shift();
        break;
      case 'Q':
        ctm = saved.pop() ?? ctm0;
        break;
      case 'cm':
        ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], ctm);
        break;
      case 'BT':
        tm = ID;
        tlm = ID;
        break;
      case 'Tf':
        font = args[0] instanceof Name ? fontOf(args[0].name) : font;
        fs = n(1) || fs;
        break;
      case 'Tc':
        tc = n(0);
        break;
      case 'Tw':
        tw = n(0);
        break;
      case 'Tz':
        th = n(0) / 100;
        break;
      case 'TL':
        tl = n(0);
        break;
      case 'Ts':
        rise = n(0);
        break;
      case 'Td':
        tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm);
        tm = tlm;
        break;
      case 'TD':
        tl = -n(1);
        tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm);
        tm = tlm;
        break;
      case 'Tm':
        tlm = [n(0), n(1), n(2), n(3), n(4), n(5)];
        tm = tlm;
        break;
      case 'T*':
        tlm = mul([1, 0, 0, 1, 0, -tl], tlm);
        tm = tlm;
        break;
      case 'Tj':
        if (args[0] instanceof PStr) show(args[0].bytes);
        break;
      case "'":
        tlm = mul([1, 0, 0, 1, 0, -tl], tlm);
        tm = tlm;
        if (args[0] instanceof PStr) show(args[0].bytes);
        break;
      case '"':
        tw = n(0);
        tc = n(1);
        tlm = mul([1, 0, 0, 1, 0, -tl], tlm);
        tm = tlm;
        if (args[2] instanceof PStr) show(args[2].bytes);
        break;
      case 'TJ': {
        for (const item of Array.isArray(args[0]) ? args[0] : []) {
          if (item instanceof PStr) show(item.bytes);
          else if (typeof item === 'number') tm = mul([1, 0, 0, 1, (-item / 1000) * fs * th, 0], tm);
        }
        break;
      }
      case 'Do': {
        if (!(args[0] instanceof Name)) break;
        const xo = doc.get(xobjs?.get(args[0].name));
        if (!isStream(xo)) break;
        const st = doc.name(xo.dict.get('Subtype'));
        if (st === 'Image') {
          const w = doc.num(xo.dict.get('Width'));
          const h = doc.num(xo.dict.get('Height'));
          out.images.push({ w, h, stream: xo });
        } else if (st === 'Form' && depth < 8) {
          const fm = doc.arr(xo.dict.get('Matrix')).map((x) => doc.num(x));
          const m: M = fm.length === 6 ? (fm as M) : ID;
          try {
            runContent(doc, doc.streamData(xo), doc.dict(xo.dict.get('Resources')) ?? res, out, mul(m, ctm), depth + 1, budget);
          } catch (err) {
            if (err instanceof ReadError) throw err;
          }
        }
        break;
      }
      default:
        break;
    }
  }
}

/** Puts a page's text runs into lines and paragraphs, in reading order. */
export function layout(runs: Run[], headingSize = 0): string {
  if (!runs.length) return '';
  // Lines: runs whose baselines are close, in the order they were drawn (usually reading order);
  // a run far above or below starts a new line.
  const lines: { y: number; size: number; text: string; endX: number; x: number }[] = [];
  for (const r of runs) {
    const cur = lines.at(-1);
    if (cur && Math.abs(r.y - cur.y) <= Math.max(cur.size, r.size) * 0.45) {
      const gap = r.x - cur.endX;
      const needSpace = gap > Math.min(cur.size, r.size) * 0.2 && !/\s$/.test(cur.text) && !/^\s/.test(r.text);
      // A run that jumps far back on the same line (columns drawn out of order) still joins with a space.
      cur.text += (needSpace || gap < -cur.size * 2 ? ' ' : '') + r.text;
      cur.endX = Math.max(cur.endX, r.endX);
      cur.size = Math.max(cur.size, r.size);
    } else lines.push({ y: r.y, size: r.size, text: r.text, endX: r.endX, x: r.x });
  }
  let out = '';
  let prev: (typeof lines)[number] | undefined;
  let prevHeading = false;
  for (const l of lines) {
    const text = l.text.replace(/[ \t\u00a0]+/g, ' ').trim();
    if (!text) continue;
    const isHeading = headingSize > 0 && l.size >= headingSize && text.length <= 120;
    if (prev) {
      const gap = prev.y - l.y;
      const lead = Math.max(prev.size, l.size);
      // A bigger gap than a line's height (or going back up the page: a new column) = new paragraph.
      const para = isHeading || prevHeading || gap > lead * 1.75 || gap < -lead * 0.5;
      if (para) out += '\n\n';
      // A word broken at the line end ("Café-" / "style") is joined back, keeping the hyphen
      // (it can't be told from a real one like "well-known").
      else if (/\p{L}-$/u.test(out) && /^\p{Ll}/u.test(text)) void 0;
      else out += '\n';
    }
    out += isHeading ? `# ${text}` : text;
    prev = l;
    prevHeading = isHeading;
  }
  return out;
}

/** A plain image's pixels as a PNG (8-bit grey or RGB; 1-bit grey is widened). */
function toPng(pixels: Buffer, w: number, h: number, channels: 1 | 3, bpc: number, invert = false): Buffer | undefined {
  const rowIn = Math.ceil((w * channels * bpc) / 8);
  if (pixels.length < rowIn * h) return undefined;
  const rowOut = w * channels;
  const raw = Buffer.alloc((rowOut + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (rowOut + 1)] = 0;
    for (let x = 0; x < rowOut; x++) {
      let v: number;
      if (bpc === 8) v = pixels[y * rowIn + x];
      else if (bpc === 1) v = (pixels[y * rowIn + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
      else return undefined;
      raw[y * (rowOut + 1) + 1 + x] = invert ? 255 - v : v;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 3 ? 2 : 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** A scanned page's picture, ready for the picture model (JPEG as it is, plain pixels as PNG). */
function pageImage(doc: Doc, img: { w: number; h: number; stream: Stream }): { mime: 'image/jpeg' | 'image/png'; data: Buffer } | string {
  const filters = doc.arr(img.stream.dict.get('Filter')).map((f) => doc.name(f) ?? '');
  const last = filters.at(-1) ?? '';
  if (last === 'DCTDecode' || last === 'DCT') {
    const data = doc.streamData(img.stream, true);
    return data[0] === 0xff && data[1] === 0xd8 ? { mime: 'image/jpeg', data } : 'its picture is damaged';
  }
  if (IMAGE_FILTERS.has(last)) return `its picture is stored in a format she can't open yet (${last.replace(/Decode$/, '')})`;
  if (img.w * img.h > 40_000_000) return 'its picture is too large';
  const cs = doc.get(img.stream.dict.get('ColorSpace'));
  const csName = cs instanceof Name ? cs.name : Array.isArray(cs) ? (doc.name(cs[0]) ?? '') : '';
  let channels: 1 | 3 | undefined;
  if (csName === 'DeviceGray' || csName === 'CalGray' || img.stream.dict.get('ImageMask') === true) channels = 1;
  else if (csName === 'DeviceRGB' || csName === 'CalRGB') channels = 3;
  else if (csName === 'ICCBased' && Array.isArray(cs)) {
    const nn = doc.num(doc.dict(cs[1])?.get('N'));
    channels = nn === 1 ? 1 : nn === 3 ? 3 : undefined;
  }
  const bpc = img.stream.dict.get('ImageMask') === true ? 1 : doc.num(img.stream.dict.get('BitsPerComponent'), 8);
  if (!channels || (bpc !== 8 && bpc !== 1)) return 'its picture uses colours she can\'t convert yet';
  const png = toPng(doc.streamData(img.stream), img.w, img.h, channels, bpc, img.stream.dict.get('ImageMask') === true);
  return png ? { mime: 'image/png', data: png } : 'its picture is damaged';
}

/** Reads a PDF into one part per page (and pictures of scanned pages). */
export async function readPdf(bytes: Buffer, opts: { signal?: AbortSignal; maxChars?: number } = {}): Promise<ReadResult> {
  const doc = new Doc(bytes);
  const warnings: string[] = [];
  const enc = doc.dict(doc.trailer.get('Encrypt'));
  if (enc) doc.crypt = setupCrypt(enc, doc.get(doc.trailer.get('ID')));
  let root = doc.dict(doc.trailer.get('Root'));
  if (!root || !doc.dict(root.get('Pages'))) {
    // No usable trailer: find the catalog by its type.
    for (const [num] of doc.objs) {
      const d = doc.dict(new Ref(num, 0));
      if (d && doc.name(d.get('Type')) === 'Catalog' && doc.dict(d.get('Pages'))) {
        root = d;
        break;
      }
    }
  }
  if (!root) throw new ReadError('This PDF is damaged (she couldn\'t find its pages).');
  // Pages in order, with inherited resources.
  const pages: { dict: Dict; res?: Dict }[] = [];
  const seen = new Set<Dict>();
  const walk = (node: Dict | undefined, res: Dict | undefined, depth: number) => {
    if (!node || seen.has(node) || depth > 64 || pages.length >= 5000) return;
    seen.add(node);
    const r = doc.dict(node.get('Resources')) ?? res;
    const kids = node.get('Kids');
    if (kids !== undefined && doc.name(node.get('Type')) !== 'Page') for (const k of doc.arr(kids)) walk(doc.dict(k), r, depth + 1);
    else pages.push({ dict: node, res: r });
  };
  walk(doc.dict(root.get('Pages')), undefined, 0);
  if (!pages.length) throw new ReadError('This PDF has no pages she can find.');
  if (pages.length >= 5000) warnings.push('Only the first 5,000 pages were read.');
  // First pass: text runs per page (font sizes decide what counts as a heading).
  const outs: PageOut[] = [];
  const budget = { ops: 0 };
  let chars = 0;
  for (const [i, p] of pages.entries()) {
    if (opts.signal?.aborted) throw new ReadError('Reading was stopped before it finished.');
    if (i % 20 === 19) await new Promise((r) => setImmediate(r));
    const out: PageOut = { runs: [], images: [] };
    const contents = doc.arr(p.dict.get('Contents'));
    const datas: Buffer[] = [];
    for (const c of contents) {
      const s = doc.get(c);
      if (isStream(s)) {
        try {
          datas.push(doc.streamData(s));
        } catch (err) {
          if (err instanceof ReadError) throw err;
        }
      }
    }
    try {
      runContent(doc, Buffer.concat(datas.flatMap((d) => [d, Buffer.from('\n')])), p.res, out, ID, 0, budget);
    } catch (err) {
      if (err instanceof ReadError) throw err;
      warnings.push(`Page ${i + 1} is damaged; some of its text may be missing.`);
    }
    outs.push(out);
    chars += out.runs.reduce((n, r) => n + r.text.length, 0);
    if (chars > (opts.maxChars ?? 5_000_000) * 1.2) {
      warnings.push(`This document is very long, so she only read the first ${i + 1} pages.`);
      break;
    }
  }
  // Body text size = the most common size (by characters); clearly bigger lines are headings.
  const bySize = new Map<number, number>();
  for (const o of outs) for (const r of o.runs) bySize.set(Math.round(r.size), (bySize.get(Math.round(r.size)) ?? 0) + r.text.length);
  const body = [...bySize].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const headingSize = body ? body * 1.3 : 0;
  const parts: DocPart[] = [];
  const images: PageImage[] = [];
  let unreadable = 0;
  let scansSkipped = 0;
  for (const [i, o] of outs.entries()) {
    const text = layout(o.runs, headingSize);
    const where = `page ${i + 1}`;
    const visible = text.replace(/\s|#/g, '');
    if (visible.length >= 20) {
      // Text that is mostly unmapped glyphs (a font with no letter table) is useless.
      const bad = (visible.match(/[\u0000-\u0008\u000e-\u001f\ufffd\ue000-\uf8ff]/g) ?? []).length;
      if (bad > visible.length * 0.3) unreadable++;
      else parts.push({ text: text.replace(/[\u0000-\u0008\u000e-\u001f\ufffd]/g, ''), where });
      continue;
    }
    // Little or no text: is it a scan (one big picture)?
    const big = o.images.filter((im) => im.w * im.h >= 250_000).sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (big) {
      if (images.length >= 40) {
        scansSkipped++;
        continue;
      }
      const im = pageImage(doc, big);
      if (typeof im === 'string') warnings.push(`Page ${i + 1} is a scanned picture, but ${im}.`);
      else images.push({ where, ...im });
    } else if (visible.length) parts.push({ text, where });
  }
  if (unreadable) warnings.push(`${unreadable} page${unreadable === 1 ? '' : 's'} use a font without a letter table, so their text couldn't be read.`);
  if (scansSkipped) warnings.push(`${scansSkipped} more scanned pages were not read (only the first 40 are).`);
  const info = doc.dict(doc.trailer.get('Info'));
  const titleBytes = info ? doc.str(info.get('Title'), doc.refOf(doc.trailer.get('Info'))) : undefined;
  const title = titleBytes ? textString(titleBytes).replace(/\0/g, '').trim() || undefined : undefined;
  return { kind: 'pdf', ...(title ? { title } : {}), parts, images, warnings };
}
