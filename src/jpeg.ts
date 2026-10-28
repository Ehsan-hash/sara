// A small baseline JPEG decoder (zero dependencies), so a character card PNG can carry her real
// portrait (her portraits and uploads are JPEGs). Only what baseline files use: Huffman coding
// (SOF0/SOF1), 8-bit samples, 1 or 3 components, any sampling factors, restart markers.
// Progressive, arithmetic, 12-bit and CMYK files return undefined, so the caller falls back.

export interface RgbImage {
  width: number;
  height: number;
  /** width × height × 3 bytes, RGB. */
  data: Uint8Array;
}

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const MAX_PIXELS = 40_000_000;

interface Huffman {
  maxcode: Int32Array;
  valptr: Int32Array;
  mincode: Int32Array;
  symbols: Uint8Array;
}

interface Component {
  id: number;
  h: number;
  v: number;
  tq: number;
  /** Blocks per line / column in this component's plane (padded to whole MCUs). */
  bw: number;
  bh: number;
  /** The decoded samples of the plane (bw*8 × bh*8). */
  plane: Uint8Array;
  pred: number;
  td: number;
  ta: number;
}

function buildHuffman(counts: Uint8Array, symbols: Uint8Array): Huffman {
  const maxcode = new Int32Array(18).fill(-1);
  const valptr = new Int32Array(17);
  const mincode = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    const n = counts[l - 1];
    if (n) {
      valptr[l] = k;
      mincode[l] = code;
      code += n;
      k += n;
      maxcode[l] = code - 1;
    }
    code <<= 1;
  }
  return { maxcode, valptr, mincode, symbols };
}

// Cosine table for the 8×8 inverse DCT.
const COS = new Float64Array(64);
for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) COS[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);

function idct(coef: Float64Array, out: Uint8Array, outOffset: number, stride: number, tmp: Float64Array): void {
  // Rows then columns (separable).
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let u = 0; u < 8; u++) s += COS[x * 8 + u] * coef[y * 8 + u];
      tmp[y * 8 + x] = s / 2;
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let s = 0;
      for (let v = 0; v < 8; v++) s += COS[y * 8 + v] * tmp[v * 8 + x];
      const val = Math.round(s / 2 + 128);
      out[outOffset + y * stride + x] = val < 0 ? 0 : val > 255 ? 255 : val;
    }
  }
}

/** Decodes a baseline JPEG to RGB, or undefined when it isn't one this decoder reads. */
export function decodeJpeg(buf: Uint8Array): RgbImage | undefined {
  try {
    return decode(buf);
  } catch {
    return undefined;
  }
}

function decode(d: Uint8Array): RgbImage | undefined {
  if (d.length < 4 || d[0] !== 0xff || d[1] !== 0xd8) return undefined;
  const qt: Int32Array[] = [];
  const dcT: Huffman[] = [];
  const acT: Huffman[] = [];
  let comps: Component[] = [];
  let width = 0;
  let height = 0;
  let hmax = 1;
  let vmax = 1;
  let mcusX = 0;
  let mcusY = 0;
  let restart = 0;
  let adobeRgb = false;
  let pos = 2;
  const u16 = (p: number) => (d[p] << 8) | d[p + 1];
  while (pos < d.length) {
    if (d[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = d[pos + 1];
    pos += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
      if (marker === 0xff) pos--;
      continue;
    }
    if (marker === 0xd9) break;
    const len = u16(pos);
    const seg = pos + 2;
    const end = pos + len;
    if (end > d.length) return undefined;
    if (marker === 0xdb) {
      for (let p = seg; p < end; ) {
        const pq = d[p] >> 4;
        const tq = d[p] & 15;
        const t = new Int32Array(64);
        for (let i = 0; i < 64; i++) t[i] = pq ? u16(p + 1 + i * 2) : d[p + 1 + i];
        qt[tq] = t;
        p += 1 + (pq ? 128 : 64);
      }
    } else if (marker === 0xc4) {
      for (let p = seg; p < end; ) {
        const tc = d[p] >> 4;
        const th = d[p] & 15;
        const counts = d.subarray(p + 1, p + 17);
        const total = counts.reduce((a, b) => a + b, 0);
        const symbols = d.subarray(p + 17, p + 17 + total);
        (tc === 0 ? dcT : acT)[th] = buildHuffman(counts, symbols);
        p += 17 + total;
      }
    } else if (marker === 0xc0 || marker === 0xc1) {
      if (d[seg] !== 8) return undefined;
      height = u16(seg + 1);
      width = u16(seg + 3);
      const n = d[seg + 5];
      if (!width || !height || width * height > MAX_PIXELS || (n !== 1 && n !== 3)) return undefined;
      comps = [];
      for (let i = 0; i < n; i++) {
        const p = seg + 6 + i * 3;
        const h = d[p + 1] >> 4;
        const v = d[p + 1] & 15;
        if (h < 1 || h > 4 || v < 1 || v > 4) return undefined;
        comps.push({ id: d[p], h, v, tq: d[p + 2], bw: 0, bh: 0, plane: new Uint8Array(0), pred: 0, td: 0, ta: 0 });
      }
      hmax = Math.max(...comps.map((c) => c.h));
      vmax = Math.max(...comps.map((c) => c.v));
      mcusX = Math.ceil(width / (8 * hmax));
      mcusY = Math.ceil(height / (8 * vmax));
      for (const c of comps) {
        c.bw = mcusX * c.h;
        c.bh = mcusY * c.v;
        c.plane = new Uint8Array(c.bw * 8 * c.bh * 8);
      }
    } else if (marker >= 0xc2 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return undefined; // progressive, lossless or arithmetic
    } else if (marker === 0xdd) {
      restart = u16(seg);
    } else if (marker === 0xee) {
      if (len >= 12 && String.fromCharCode(d[seg], d[seg + 1], d[seg + 2], d[seg + 3], d[seg + 4]) === 'Adobe') adobeRgb = d[seg + 11] === 0;
    } else if (marker === 0xda) {
      if (!comps.length) return undefined;
      const ns = d[seg];
      const scan: Component[] = [];
      for (let i = 0; i < ns; i++) {
        const c = comps.find((x) => x.id === d[seg + 1 + i * 2]);
        if (!c) return undefined;
        c.td = d[seg + 2 + i * 2] >> 4;
        c.ta = d[seg + 2 + i * 2] & 15;
        scan.push(c);
      }
      pos = decodeScan(d, end, scan, { qt, dcT, acT, restart, mcusX, mcusY, width, height, hmax, vmax });
      continue;
    }
    pos = end;
  }
  if (!comps.length) return undefined;
  const out = new Uint8Array(width * height * 3);
  if (comps.length === 1) {
    const c = comps[0];
    const stride = c.bw * 8;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out.fill(c.plane[y * stride + x], (y * width + x) * 3, (y * width + x) * 3 + 3);
    return { width, height, data: out };
  }
  const [Y, Cb, Cr] = comps;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (c: Component) => c.plane[Math.floor((y * c.v) / vmax) * c.bw * 8 + Math.floor((x * c.h) / hmax)];
      const yy = at(Y);
      const cb = at(Cb);
      const cr = at(Cr);
      const o = (y * width + x) * 3;
      if (adobeRgb) {
        out[o] = yy;
        out[o + 1] = cb;
        out[o + 2] = cr;
        continue;
      }
      const r = yy + 1.402 * (cr - 128);
      const g = yy - 0.344136 * (cb - 128) - 0.714136 * (cr - 128);
      const b = yy + 1.772 * (cb - 128);
      out[o] = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
      out[o + 1] = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
      out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
    }
  }
  return { width, height, data: out };
}

interface ScanCtx {
  qt: Int32Array[];
  dcT: Huffman[];
  acT: Huffman[];
  restart: number;
  mcusX: number;
  mcusY: number;
  width: number;
  height: number;
  hmax: number;
  vmax: number;
}

/** Decodes one scan; returns the position after its entropy-coded data. */
function decodeScan(d: Uint8Array, start: number, scan: Component[], ctx: ScanCtx): number {
  let pos = start;
  let bitbuf = 0;
  let bitcnt = 0;
  const bit = (): number => {
    if (bitcnt === 0) {
      let b = 0;
      if (pos < d.length) {
        b = d[pos];
        if (b === 0xff) {
          const n = d[pos + 1];
          if (n === 0) pos += 2;
          else b = 0; // a marker: pad with zeros, don't move past it
        } else pos++;
      }
      bitbuf = b;
      bitcnt = 8;
    }
    bitcnt--;
    return (bitbuf >> bitcnt) & 1;
  };
  const decodeHuff = (h: Huffman | undefined): number => {
    if (!h) throw new Error('missing Huffman table');
    let code = 0;
    for (let l = 1; l <= 16; l++) {
      code = (code << 1) | bit();
      if (code <= h.maxcode[l]) return h.symbols[h.valptr[l] + code - h.mincode[l]];
    }
    throw new Error('bad Huffman code');
  };
  const receive = (s: number): number => {
    let v = 0;
    for (let i = 0; i < s; i++) v = (v << 1) | bit();
    return v < 1 << (s - 1) ? v - (1 << s) + 1 : v;
  };
  const coef = new Float64Array(64);
  const tmp = new Float64Array(64);
  const block = (c: Component, row: number, col: number) => {
    coef.fill(0);
    const q = ctx.qt[c.tq];
    if (!q) throw new Error('missing quantisation table');
    const t = decodeHuff(ctx.dcT[c.td]);
    c.pred += t ? receive(t) : 0;
    coef[0] = c.pred * q[0];
    for (let k = 1; k < 64; ) {
      const rs = decodeHuff(ctx.acT[c.ta]);
      const r = rs >> 4;
      const s = rs & 15;
      if (!s) {
        if (r !== 15) break;
        k += 16;
        continue;
      }
      k += r;
      if (k > 63) break;
      coef[ZIGZAG[k]] = receive(s) * q[k];
      k++;
    }
    if (row < c.bh && col < c.bw) idct(coef, c.plane, row * 8 * c.bw * 8 + col * 8, c.bw * 8, tmp);
  };
  const resetAtMarker = () => {
    bitcnt = 0;
    while (pos < d.length - 1 && !(d[pos] === 0xff && d[pos + 1] >= 0xd0 && d[pos + 1] <= 0xd7)) pos++;
    pos += 2;
    for (const c of scan) c.pred = 0;
  };
  for (const c of scan) c.pred = 0;
  if (scan.length === 1) {
    // Non-interleaved: blocks cover only the component's own size.
    const c = scan[0];
    const bw = Math.ceil(Math.ceil((ctx.width * c.h) / ctx.hmax) / 8);
    const bh = Math.ceil(Math.ceil((ctx.height * c.v) / ctx.vmax) / 8);
    let n = 0;
    for (let row = 0; row < bh; row++) {
      for (let col = 0; col < bw; col++) {
        if (ctx.restart && n && n % ctx.restart === 0) resetAtMarker();
        block(c, row, col);
        n++;
      }
    }
  } else {
    let n = 0;
    for (let my = 0; my < ctx.mcusY; my++) {
      for (let mx = 0; mx < ctx.mcusX; mx++) {
        if (ctx.restart && n && n % ctx.restart === 0) resetAtMarker();
        for (const c of scan) for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) block(c, my * c.v + v, mx * c.h + h);
        n++;
      }
    }
  }
  // Move to the next marker (not a restart marker or stuffed byte).
  while (pos < d.length - 1 && !(d[pos] === 0xff && d[pos + 1] !== 0 && !(d[pos + 1] >= 0xd0 && d[pos + 1] <= 0xd7))) pos++;
  return pos;
}

/** A smaller copy (box average) so the longer side is at most `max` pixels. */
export function shrinkRgb(img: RgbImage, max = 1024): RgbImage {
  const scale = Math.max(img.width, img.height) / max;
  if (scale <= 1) return img;
  const w = Math.max(1, Math.round(img.width / scale));
  const h = Math.max(1, Math.round(img.height / scale));
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * scale)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * scale)));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * img.width + xx) * 3;
          r += img.data[o];
          g += img.data[o + 1];
          b += img.data[o + 2];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * w + x) * 3;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return { width: w, height: h, data: out };
}
