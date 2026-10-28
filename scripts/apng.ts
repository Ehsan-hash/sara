// Phase 54: PNG and animated PNG (APNG) with nothing but node:zlib, for the README's demo animation
// and small screenshots. Decodes 8-bit PNGs (grey, RGB, RGBA, palette; no interlace), resizes,
// re-encodes at zlib level 9 with a per-row filter choice, and writes APNGs whose frames only
// store the rectangle that changed since the previous frame.
//   node scripts/apng.ts shrink <in.png> <out.png> [--width 1280]
//   node scripts/apng.ts animate <out.png> <frame1.png> <ms> <frame2.png> <ms> … [--width 960]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

export interface Image {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, rows top to bottom. */
  data: Buffer;
}

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(SIG)) throw new Error('Not a PNG file.');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let palette: Buffer | undefined;
  let trns: Buffer | undefined;
  const idat: Buffer[] = [];
  while (pos < file.length) {
    const len = file.readUInt32BE(pos);
    const kind = file.toString('latin1', pos + 4, pos + 8);
    const data = file.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      if (data[12] !== 0) throw new Error('Interlaced PNGs are not supported.');
    } else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
  }
  if (depth !== 8) throw new Error(`Only 8-bit PNGs are supported (this one is ${depth}-bit).`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`Unknown PNG colour type ${type}.`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const up = y ? px.subarray((y - 1) * stride, y * stride) : undefined;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = up ? up[x] : 0;
      const c = up && x >= channels ? up[x - channels] : 0;
      row[x] = (src[x] + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? paeth(a, b, c) : 0)) & 255;
    }
  }
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const o = i * 4;
    if (type === 6) px.copy(out, o, j, j + 4);
    else if (type === 2) {
      out[o] = px[j];
      out[o + 1] = px[j + 1];
      out[o + 2] = px[j + 2];
      out[o + 3] = 255;
    } else if (type === 0 || type === 4) {
      out[o] = out[o + 1] = out[o + 2] = px[j];
      out[o + 3] = type === 4 ? px[j + 1] : 255;
    } else {
      const k = px[j];
      out[o] = palette![k * 3];
      out[o + 1] = palette![k * 3 + 1];
      out[o + 2] = palette![k * 3 + 2];
      out[o + 3] = trns && k < trns.length ? trns[k] : 255;
    }
  }
  return { width, height, data: out };
}

/** Box-filter resize to a new width (height keeps the aspect ratio). */
export function resize(img: Image, width: number): Image {
  if (width >= img.width) return img;
  const height = Math.max(1, Math.round((img.height * width) / img.width));
  const out = Buffer.alloc(width * height * 4);
  const sx = img.width / width;
  const sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          a += img.data[i + 3];
          n++;
        }
      const o = (y * width + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width, height, data: out };
}

/** Image data (RGB when fully opaque, else RGBA) filtered row by row and compressed at level 9. */
function compress(img: Image, opaque: boolean): Buffer {
  const ch = opaque ? 3 : 4;
  const stride = img.width * ch;
  const px = Buffer.alloc(stride * img.height);
  for (let i = 0, j = 0; i < img.width * img.height; i++, j += ch) {
    img.data.copy(px, j, i * 4, i * 4 + ch);
  }
  const out = Buffer.alloc((stride + 1) * img.height);
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < img.height; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    const up = y ? px.subarray((y - 1) * stride, y * stride) : undefined;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? row[x - ch] : 0;
        const b = up ? up[x] : 0;
        const cc = up && x >= ch ? up[x - ch] : 0;
        const v = (row[x] - (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? paeth(a, b, cc) : 0)) & 255;
        c[x] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    out[y * (stride + 1)] = best;
    cand[best].copy(out, y * (stride + 1) + 1);
  }
  return deflateSync(out, { level: 9, memLevel: 9 });
}

const isOpaque = (imgs: Image[]) => imgs.every((im) => {
  for (let i = 3; i < im.data.length; i += 4) if (im.data[i] !== 255) return false;
  return true;
});

function ihdr(width: number, height: number, opaque: boolean): Buffer {
  const h = Buffer.alloc(13);
  h.writeUInt32BE(width, 0);
  h.writeUInt32BE(height, 4);
  h[8] = 8;
  h[9] = opaque ? 2 : 6;
  return h;
}

export function encodePng(img: Image): Buffer {
  const opaque = isOpaque([img]);
  return Buffer.concat([SIG, chunk('IHDR', ihdr(img.width, img.height, opaque)), chunk('IDAT', compress(img, opaque)), chunk('IEND', Buffer.alloc(0))]);
}

function crop(img: Image, x: number, y: number, w: number, h: number): Image {
  const data = Buffer.alloc(w * h * 4);
  for (let r = 0; r < h; r++) img.data.copy(data, r * w * 4, ((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4);
  return { width: w, height: h, data };
}

/** The rectangle that differs between two same-size images (undefined when identical). */
export function changed(a: Image, b: Image): { x: number; y: number; w: number; h: number } | undefined {
  let x0 = a.width;
  let y0 = a.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data.readUInt32BE(i) !== b.data.readUInt32BE(i)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  return x1 < 0 ? undefined : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** An animated PNG that loops forever. Every frame must be the size of the first. */
export function encodeApng(frames: { img: Image; ms: number }[]): Buffer {
  if (!frames.length) throw new Error('No frames.');
  const { width, height } = frames[0].img;
  if (frames.some((f) => f.img.width !== width || f.img.height !== height)) throw new Error('All frames must be the same size.');
  const opaque = isOpaque(frames.map((f) => f.img));
  const parts: Buffer[] = [SIG, chunk('IHDR', ihdr(width, height, opaque))];
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  actl.writeUInt32BE(0, 4); // loop forever
  parts.push(chunk('acTL', actl));
  let seq = 0;
  frames.forEach((f, i) => {
    const r = i === 0 ? { x: 0, y: 0, w: width, h: height } : (changed(frames[i - 1].img, f.img) ?? { x: 0, y: 0, w: 1, h: 1 });
    const fc = Buffer.alloc(26);
    fc.writeUInt32BE(seq++, 0);
    fc.writeUInt32BE(r.w, 4);
    fc.writeUInt32BE(r.h, 8);
    fc.writeUInt32BE(r.x, 12);
    fc.writeUInt32BE(r.y, 16);
    fc.writeUInt16BE(Math.max(1, Math.round(f.ms)), 20);
    fc.writeUInt16BE(1000, 22); // delay in milliseconds
    fc[24] = 0; // dispose: none (the next frame draws over this one)
    fc[25] = 0; // blend: source (replace the rectangle)
    parts.push(chunk('fcTL', fc));
    const data = compress(crop(f.img, r.x, r.y, r.w, r.h), opaque);
    if (i === 0) parts.push(chunk('IDAT', data));
    else {
      const sq = Buffer.alloc(4);
      sq.writeUInt32BE(seq++);
      parts.push(chunk('fdAT', Buffer.concat([sq, data])));
    }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const wi = args.indexOf('--width');
  const width = wi >= 0 ? Number(args.splice(wi, 2)[1]) : undefined;
  const [cmd, out, ...rest] = args;
  if (cmd === 'shrink' && out && rest[0]) {
    const before = readFileSync(out).length;
    const img = decodePng(readFileSync(out));
    const png = encodePng(width ? resize(img, width) : img);
    writeFileSync(rest[0], png);
    console.log(`${out} (${Math.round(before / 1024)} KB) → ${rest[0]} (${Math.round(png.length / 1024)} KB)`);
  } else if (cmd === 'animate' && out && rest.length >= 2) {
    const frames: { img: Image; ms: number }[] = [];
    for (let i = 0; i + 1 < rest.length; i += 2) {
      const img = decodePng(readFileSync(rest[i]));
      frames.push({ img: width ? resize(img, width) : img, ms: Number(rest[i + 1]) });
    }
    const apng = encodeApng(frames);
    writeFileSync(out, apng);
    console.log(`${out}: ${frames.length} frames, ${Math.round(apng.length / 1024)} KB`);
  } else {
    console.log('node scripts/apng.ts shrink <in.png> <out.png> [--width N]\nnode scripts/apng.ts animate <out.png> <frame.png> <ms> [<frame.png> <ms> …] [--width N]');
    process.exit(2);
  }
}
