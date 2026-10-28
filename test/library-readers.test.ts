// Phase 44: the document readers. Real files made by real software (Microsoft Word, Excel and
// PowerPoint; PDFs printed by Edge and exported by Word; PDFs encrypted by pypdf; scanned pages)
// in test/fixtures/library, plus hand-built files for the cases those don't cover, plus damaged
// and hostile input that must fail politely, never hang or crash.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { detectKind, parseCsv, readDocument, ReadError } from '../src/library/read.ts';
import { glyphToText, parseCMap } from '../src/library/pdf.ts';
import { readInThread } from '../src/library/read-thread.ts';
import { ROOT } from './helpers.ts';

const FIX = join(ROOT, 'test', 'fixtures', 'library');
const fixture = (f: string) => readFileSync(join(FIX, f));
const all = (r: { parts: { text: string }[] }) => r.parts.map((p) => p.text).join('\n\n');

/** A small zip writer (stored or deflated entries) for hand-built Office/EPUB files. */
function zip(files: [string, string | Buffer][], store = false): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = store ? data : deflateRawSync(data);
    const nameB = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(store ? 0 : 8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(packed.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, packed);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(store ? 0 : 8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(packed.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameB.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameB);
    offset += 30 + nameB.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** A hand-built PDF from object bodies (numbered from 1), with a correct xref table. */
function pdf(objs: string[], trailerExtra = ''): Buffer {
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const stream = (body: string | Buffer, extra = '') => {
  const b = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
  return `<< /Length ${b.length} ${extra}>>\nstream\n${b.toString('latin1')}\nendstream`;
};

test('readers: real Word, Excel and PowerPoint files', async () => {
  const docx = await readDocument('word-guide.docx', fixture('word-guide.docx'));
  assert.equal(docx.kind, 'docx');
  assert.equal(docx.title, 'Dishwasher quick guide');
  assert.deepEqual(
    docx.parts.map((p) => p.heading),
    ['Dishwasher quick guide', 'Programmes', 'Error codes'],
  );
  assert.match(all(docx), /Eco 50 \| 3 h 20 min/);
  assert.match(all(docx), /E24 means the water is not draining/);
  const xlsx = await readDocument('excel-budget.xlsx', fixture('excel-budget.xlsx'));
  assert.deepEqual(
    xlsx.parts.map((p) => p.where),
    ['sheet Budget', 'sheet Contacts'],
  );
  assert.match(xlsx.parts[0].text, /Rent \| 1450\nElectricity \| 82\.5\nTotal \| 1532\.5/, 'formulas show their computed value');
  assert.match(xlsx.parts[1].text, /Mike \(boiler\) \| 555-0199/);
  const pptx = await readDocument('powerpoint-garden.pptx', fixture('powerpoint-garden.pptx'));
  assert.deepEqual(
    pptx.parts.map((p) => p.where),
    ['slide 1', 'slide 2'],
  );
  assert.match(pptx.parts[1].text, /Courgettes by the fence[\s\S]*Speaker notes: Remember to order seeds in February\./);
});

test('readers: real PDFs (printed by Edge, exported by Word): pages, headings, accents, words joined right', async () => {
  const edge = await readDocument('edge-lease.pdf', fixture('edge-lease.pdf'));
  assert.equal(edge.title, 'Lease summary - 14 Elm Street');
  assert.deepEqual(
    edge.parts.map((p) => p.where),
    ['page 1', 'page 2'],
  );
  const t = all(edge);
  assert.match(t, /^# Lease summary\n\nThe lease for 14 Elm Street ends on March 31, 2027\. Monthly rent is \$1,450 — due\non the first\./);
  assert.match(t, /# Pets/);
  assert.match(t, /Café-style déjà vu: naïve “quotes” stay intact\./);
  assert.match(edge.parts[1].text, /# Moving out\n\nGive at least 60 days written notice\./);
  const word = await readDocument('word-guide.pdf', fixture('word-guide.pdf'));
  assert.match(all(word), /Clean the filter once a month: twist it anticlockwise, lift it out and rinse it under warm\nwater\./);
  assert.match(all(word), /Eco 50 3 h 20 min/);
});

test('readers: PDFs locked with an empty password open (RC4, AES-128, AES-256); a real password is refused politely', async () => {
  for (const f of ['locked-empty-rc4.pdf', 'locked-empty-aes128.pdf', 'locked-empty-aes256.pdf']) {
    const r = await readDocument(f, fixture(f));
    assert.equal(r.title, 'Lease summary - 14 Elm Street', f);
    assert.match(all(r), /ends on March 31, 2027/, f);
  }
  await assert.rejects(() => readDocument('locked-password.pdf', fixture('locked-password.pdf')), (e: Error) => e instanceof ReadError && /locked with a password/.test(e.message));
});

test('readers: scanned pages and photos of pages go to the picture model (JPEG as it is, plain pixels as PNG)', async () => {
  const jpg = await readDocument('scanned-jpg.pdf', fixture('scanned-jpg.pdf'));
  assert.equal(jpg.parts.length, 0);
  assert.equal(jpg.images[0].where, 'page 1');
  assert.equal(jpg.images[0].mime, 'image/jpeg');
  assert.deepEqual([...jpg.images[0].data.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  const png = await readDocument('scanned-png.pdf', fixture('scanned-png.pdf'));
  assert.equal(png.images[0].mime, 'image/png');
  assert.equal(png.images[0].data.subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(png.images[0].data.readUInt32BE(16), 900, 'the full-size picture');
  const photo = await readDocument('page-photo.jpg', fixture('page-photo.jpg'));
  assert.equal(photo.kind, 'image');
  assert.equal(photo.images.length, 1);
});

test('readers: hand-built PDFs: WinAnsi and /Differences fonts, CID fonts with ranges, object streams, ASCII85, a broken xref', async () => {
  const content = 'BT /F1 12 Tf 72 720 Td (Caf\\351 cr\\350me ) Tj (\\223quoted\\224) Tj 0 -20 Td <0102> Tj ET\nBT /F2 12 Tf 72 680 Td <00410042> Tj ET';
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0041> <0042> <0058> endbfrange endcmap end end';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>', // resources inherited from the page tree
    stream(deflateSync(Buffer.from(content, 'latin1')), '/Filter /FlateDecode'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding << /BaseEncoding /WinAnsiEncoding /Differences [1 /fi /uni2713] >> >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [8 0 R] /ToUnicode 7 0 R >>',
    stream(cmap),
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /DW 600 >>',
  ];
  const r = await readDocument('hand.pdf', pdf(objs));
  assert.match(all(r), /Café crème “quoted”\nfi✓\n\nXY|Café crème “quoted”\nfi✓\nXY/);
  // Same page through an object stream (catalog and fonts packed), ASCII85 content, no xref at all.
  const a85 = (s: string) => {
    const b = Buffer.from(s, 'latin1');
    let o = '';
    for (let i = 0; i < b.length; i += 4) {
      const chunk = Buffer.concat([b.subarray(i, i + 4), Buffer.alloc(4)]).subarray(0, 4);
      let n = chunk.readUInt32BE(0);
      const digits: string[] = [];
      for (let k = 0; k < 5; k++) {
        digits.unshift(String.fromCharCode((n % 85) + 33));
        n = Math.floor(n / 85);
      }
      o += digits.slice(0, Math.min(4, b.length - i) + 1).join('');
    }
    return `${o}~>`;
  };
  const packed = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 6 0 R >> >> >>'];
  let header = '';
  let body = '';
  packed.forEach((o, i) => {
    header += `${[1, 2, 3][i]} ${body.length} `;
    body += `${o}\n`;
  });
  header += `6 ${body.length} `;
  body += '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\n';
  const objstm = Buffer.from(header + body, 'latin1');
  let raw = '%PDF-1.5\n';
  raw += `5 0 obj\n${stream(deflateSync(objstm), `/Type /ObjStm /N 4 /First ${header.length} /Filter /FlateDecode`)}\nendobj\n`;
  raw += `4 0 obj\n${stream(a85('BT /F1 10 Tf 50 700 Td (Packed away) Tj ET'), '/Filter /ASCII85Decode')}\nendobj\n`;
  raw += 'xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n999999\n%%EOF\n';
  const r2 = await readDocument('packed.pdf', Buffer.from(raw, 'latin1'));
  assert.equal(all(r2), 'Packed away');
  // Building blocks.
  assert.equal(glyphToText('eacute'), 'é');
  assert.equal(glyphToText('f_f_i'), 'ffi');
  assert.equal(glyphToText('one.oldstyle'), '1');
  assert.equal(parseCMap('1 beginbfchar <0003> <00200041> endbfchar').map.get(3), ' A');
});

test('readers: EPUB chapters in spine order; web pages without menus and scripts; Markdown; text; CSV with quotes', async () => {
  const epub = zip(
    [
      ['mimetype', 'application/epub+zip'],
      ['META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
      ['OEBPS/content.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Lighthouse</dc:title></metadata><manifest><item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c2"/><itemref idref="c1"/></spine></package>'],
      ['OEBPS/one.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Storm</h1><p>The lamp failed at midnight.</p></body></html>'],
      ['OEBPS/two.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Arrival</h1><p>Maren reached the island on a Tuesday.</p></body></html>'],
    ],
    true,
  );
  const e = await readDocument('book.epub', epub);
  assert.equal(e.kind, 'epub');
  assert.equal(e.title, 'The Lighthouse');
  assert.deepEqual(
    e.parts.map((p) => p.heading),
    ['Arrival', 'Storm'],
  );
  const html = await readDocument('page.html', Buffer.from('<html><head><title>Cake</title><style>p{}</style><script>track()</script></head><body><nav>Home | About</nav><h1>Lemon cake</h1><p>Bake at 175&deg;C &amp; cool.</p></body></html>'));
  assert.equal(html.title, 'Cake');
  assert.match(all(html), /Lemon cake[\s\S]*Bake at 175°C & cool\./);
  assert.doesNotMatch(all(html), /track\(\)|p\{\}/);
  const md = await readDocument('notes.md', Buffer.from('# Boiler\n\nService in October.\n\n## Bins\n\nTuesday nights.\n'));
  assert.match(all(md), /Service in October/);
  const csv = await readDocument('t.csv', Buffer.from('\ufeffname,note\n"Smith, Ann","said ""hi"""\nBob,ok\n'));
  assert.match(all(csv), /Smith, Ann \| said "hi"/);
  assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  const utf16 = await readDocument('w.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Grüße aus Köln', 'utf16le')]));
  assert.equal(all(utf16), 'Grüße aus Köln');
  const latin = await readDocument('l.txt', Buffer.from('caf\xe9 \x93ok\x94', 'latin1'));
  assert.equal(all(latin), 'café “ok”');
});

test('readers: what a file is comes from its bytes first', () => {
  assert.equal(detectKind('x.bin', fixture('edge-lease.pdf')), 'pdf');
  assert.equal(detectKind('renamed.zip', fixture('word-guide.docx')), 'docx');
  assert.equal(detectKind('photo', fixture('page-photo.jpg')), 'image');
  assert.equal(detectKind('notes.md', Buffer.from('# hi')), 'markdown');
  assert.equal(detectKind('fake.pdf', Buffer.from('not a pdf at all')), undefined);
  assert.equal(detectKind('app.exe', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])), undefined);
});

test('readers: damaged and hostile files fail politely (no crash, no hang, no huge memory)', async () => {
  const bad = async (name: string, b: Buffer, re: RegExp) => {
    const t0 = Date.now();
    await assert.rejects(() => readDocument(name, b), (e: Error) => e instanceof ReadError && re.test(e.message), name);
    assert.ok(Date.now() - t0 < 5000, `${name} took too long`);
  };
  await bad('empty.pdf', Buffer.alloc(0), /empty/);
  await bad('garbage.pdf', Buffer.from('%PDF-1.7\n' + 'x'.repeat(5000)), /damaged|pages/);
  await bad('truncated.docx', fixture('word-guide.docx').subarray(0, 3000), /damaged|isn't one|read/);
  await bad('old.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), /older Office file/);
  // A zip bomb: one small entry that inflates past the 100 MB limit per entry.
  const bomb = zip([
    ['[Content_Types].xml', '<Types/>'],
    ['word/document.xml', Buffer.alloc(110 * 1024 * 1024, 0x20)],
  ]);
  assert.ok(bomb.length < 2_000_000);
  await bad('bomb.docx', bomb, /.+/);
  // Deep nesting and a reference loop in a PDF.
  const deep = pdf(['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [2 0 R] /X ${'['.repeat(500)} >>`]);
  await bad('deep.pdf', deep, /.+/);
  // A billion-laughs XML entity attack is not expanded.
  const laughs = zip([
    ['[Content_Types].xml', '<Types/>'],
    ['word/document.xml', '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>&b;ok</w:t></w:r></w:p></w:body></w:document>'],
  ]);
  const r = await readDocument('laughs.docx', laughs).catch((e: Error) => e);
  if (!(r instanceof Error)) assert.ok(all(r).length < 100, 'entities not expanded');
});

test('readers: run in their own thread; a PDF that unpacks hugely is refused without the server growing', async () => {
  const same = await readInThread('edge-lease.pdf', fixture('edge-lease.pdf'));
  assert.match(all(same), /ends on March 31, 2027/);
  const scan = await readInThread('scanned-jpg.pdf', fixture('scanned-jpg.pdf'));
  assert.ok(Buffer.isBuffer(scan.images[0].data), 'pictures come back as Buffers');
  // 40 RunLength streams of 2 bytes each that would unpack to 128 bytes * 4 million each.
  const rl = Buffer.alloc(8_000_000);
  for (let i = 0; i < rl.length; i += 2) {
    rl[i] = 129; // repeat the next byte 128 times
    rl[i + 1] = 0x41;
  }
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>', stream(rl, '/Filter /RunLengthDecode')];
  // The reader thread lives in the same process (its capped buffers count in the process's
  // memory), so what must not grow is Sara's own heap, on the main thread.
  const before = process.memoryUsage().heapUsed;
  const t0 = Date.now();
  await assert.rejects(() => readInThread('bomb.pdf', pdf(objs)), (e: Error) => e instanceof ReadError && /too large|far more|memory/.test(e.message));
  assert.ok(Date.now() - t0 < 30_000);
  assert.ok(process.memoryUsage().heapUsed - before < 100_000_000, 'the server itself did not grow');
  await assert.rejects(() => readInThread('slow.txt', Buffer.from('hello'), { timeoutMs: 1 }), /took too long/);
});
