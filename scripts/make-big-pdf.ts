// Phase 74: makes a big test PDF from scratch (no libraries): a maintenance manual of N pages
// (default 1,000) in chapters and sections, with a real outline (bookmarks), varied text, and
// facts you can ask about on known pages ("The calibration constant for unit 7 is 4.183." on
// page 612 of 1,000). Optional: scanned pages (the page drawn as a picture with a small bitmap
// font, Flate-compressed, no text), object streams with a cross-reference stream (PDF 1.5 style),
// and bulk pictures that make the file big (to measure memory on a ~1 GB file).
//
//   node scripts/make-big-pdf.ts out.pdf [--pages 1000] [--scanned 50] [--objstm] [--bulk-mb 900]
//
// Writes out.pdf and out.pdf.facts.json (each fact: page, sentence, question, accepted answers).
// The file is written piece by piece, so even a 1 GB file needs little memory to make.
import { closeSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

export interface BigPdfFact {
  page: number;
  sentence: string;
  question: string;
  answers: string[];
  scanned: boolean;
}

export interface BigPdfResult {
  path: string;
  pages: number;
  bytes: number;
  scanned: number[];
  facts: BigPdfFact[];
  chapters: { title: string; page: number; sections: { title: string; page: number }[] }[];
}

export interface BigPdfOptions {
  pages?: number;
  /** How many pages are scans (pictures only), spread through the book. */
  scanned?: number;
  /** Pack small objects into object streams and write a cross-reference stream. */
  objstm?: boolean;
  /** Add incompressible pictures until the file is about this many megabytes. */
  bulkMb?: number;
  seed?: number;
}

// ---------------------------------------------------------------- facts to ask about

const FACTS: [string, string, string[]][] = [
  ['The calibration constant for unit 7 is 4.183.', 'What is the calibration constant for unit 7?', ['4.183']],
  ['The north gearbox must not exceed a torque of 318 newton metres.', 'What torque must the north gearbox not exceed?', ['318']],
  ['Valve Q-17 is replaced every 1,400 operating hours.', 'How often is valve Q-17 replaced?', ['1,400', '1400']],
  ['The Larkspur relay trips at 62 degrees Celsius.', 'At what temperature does the Larkspur relay trip?', ['62']],
  ['The emergency contact for the tidal station is Marguerite Okafor on extension 4471.', 'Who is the emergency contact for the tidal station?', ['Okafor']],
  ['Coolant mixture C is three parts glycol to five parts distilled water.', 'How much glycol goes into coolant mixture C?', ['three parts', '3 parts']],
  ['The spare impeller for pump P-9 is stored in cabinet 22B.', 'Where is the spare impeller for pump P-9 kept?', ['22B']],
  ['Brake pads on the yaw drive are changed when they are thinner than 7 millimetres.', 'When are the yaw drive brake pads changed?', ['7 mm', '7 millimetres', '7 millimeters', 'seven']],
  ['The firmware of the Heron controller is version 5.12.3.', 'Which firmware version does the Heron controller run?', ['5.12.3']],
  ['Nobody climbs the tower when the wind is above 14 metres per second.', 'Above what wind speed is climbing the tower not allowed?', ['14']],
  ['Bolts on the blade root flange are tightened to 1,850 newton metres.', 'What torque are the blade root flange bolts tightened to?', ['1,850', '1850']],
  ['The oil in the main bearing is sampled every 90 days.', 'How often is the main bearing oil sampled?', ['90']],
  ['Each fire suppression cylinder holds 46 kilograms of agent.', 'How much agent does a fire suppression cylinder hold?', ['46']],
  ['The Osprey inverter shuts down when the grid frequency drops below 47.5 hertz.', 'At what grid frequency does the Osprey inverter shut down?', ['47.5']],
  ['Service crews log every climb on form GL-30 in the green ledger.', 'Which form do service crews use to log a climb?', ['GL-30']],
  ['The anemometer on mast 3 is heated from October to April.', 'When is the anemometer on mast 3 heated?', ['October']],
  ['The backup diesel generator burns 31 litres of fuel per hour at full load.', 'How much fuel does the backup diesel generator burn per hour at full load?', ['31']],
  ['The substation gate code changes on the first Monday of each quarter.', 'When does the substation gate code change?', ['first Monday']],
  ['The nacelle crane is rated for 1.2 tonnes.', 'What load is the nacelle crane rated for?', ['1.2']],
  ['Lightning receptors pass the test when their resistance is below 0.05 ohms.', 'What resistance must lightning receptors stay below?', ['0.05']],
  ['The pitch accumulator is precharged with nitrogen to 95 bar.', 'What is the precharge pressure of the pitch accumulator?', ['95']],
  ['The generator vibration alarm goes off at 11 millimetres per second.', 'At what level does the generator vibration alarm go off?', ['11']],
  ['Transformer T-4 was commissioned on 12 March 2019.', 'When was transformer T-4 commissioned?', ['2019']],
  ['Delmar Coatings inspects the foundation for corrosion every five years.', 'Which company inspects the foundation for corrosion?', ['Delmar']],
  ['Slip ring brushes in the Kestrel series last about 18 months.', 'How long do Kestrel slip ring brushes last?', ['18']],
  ['The approved grease for the yaw bearing is Brightlube 220.', 'Which grease is approved for the yaw bearing?', ['Brightlube']],
  ['A full cold start of the converter takes 26 minutes.', 'How long does a full cold start of the converter take?', ['26']],
  ['The helideck on platform Sable closes when visibility is under 800 metres.', 'When does the helideck on platform Sable close?', ['800']],
  ['Hydraulic hoses are replaced after 6 years whatever their condition.', 'After how many years are hydraulic hoses replaced?', ['6 years', 'six years', '6']],
  ['The SCADA historian keeps one-second data for 400 days.', 'How long does the SCADA historian keep one-second data?', ['400']],
  ['The tower door seal has part number DS-5589.', 'What is the part number of the tower door seal?', ['DS-5589']],
  ['The cooling fan in cabinet K2 runs at 2,300 revolutions per minute.', 'How fast does the cooling fan in cabinet K2 run?', ['2,300', '2300']],
];

// ---------------------------------------------------------------- text

const CHAPTERS = ['Safety and Access', 'The Tower', 'Blades and Hub', 'Pitch System', 'Drive Train', 'Gearboxes', 'The Generator', 'Power Converter', 'Cooling Systems', 'Hydraulics', 'Yaw System', 'Electrical Cabinets', 'Transformers', 'Control and Firmware', 'Sensors and Masts', 'Fire Protection', 'Foundations', 'Offshore Platforms', 'Records and Logs', 'Spare Parts'];
const SECTION_KINDS = ['Overview', 'Inspection', 'Adjustment', 'Replacement', 'Troubleshooting', 'Checklists'];
const SUBJECTS = ['the housing', 'the inspection hatch', 'each fastener', 'the cable gland', 'the service platform', 'the cover plate', 'the mounting bracket', 'the access ladder', 'the gasket', 'the drain plug', 'the support frame', 'the junction box', 'the sight glass', 'the lifting eye', 'the guard rail'];
const VERBS = ['Inspect', 'Clean', 'Check', 'Record the state of', 'Look over', 'Wipe down', 'Examine', 'Test', 'Photograph', 'Label'];
const AFTER = ['before the next shift', 'and note anything unusual in the log', 'with the power isolated', 'using the approved tools only', 'after every heavy storm', 'while a second person watches', 'and report damage to the site lead', 'in good light', 'before refitting the cover', 'following the local rules'];
const WHY = ['Small faults found early are cheaper to fix.', 'Loose parts can fall and injure people below.', 'Moisture shortens the life of electrical parts.', 'Dust hides cracks that would otherwise be seen.', 'A clear record helps the next crew.', 'Wear often starts where two parts meet.', 'Most failures give a warning first.', 'Salt air speeds up corrosion near the coast.', 'Heat makes seals harden over time.', 'Vibration loosens even well-tightened joints.'];

/** A small seeded random number generator (same book every run). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function sentence(r: () => number): string {
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  return r() < 0.35 ? pick(WHY) : `${pick(VERBS)} ${pick(SUBJECTS)} ${pick(AFTER)}.`;
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    if (line && line.length + 1 + w.length > width) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

// ---------------------------------------------------------------- a tiny bitmap font (5 x 7), for scans

const GLYPHS: Record<string, string> = {
  A: '.###.#...##...#######...##...##...#', B: '####.#...##...#####.#...##...#####.', C: '.###.#...##....#....#....#...#.###.', D: '####.#...##...##...##...##...#####.',
  E: '######....#....####.#....#....#####', F: '######....#....####.#....#....#....', G: '.###.#...##....#.####...##...#.####', H: '#...##...##...#######...##...##...#',
  I: '.###...#....#....#....#....#...###.', J: '..###...#....#....#....#.#..#..##..', K: '#...##..#.#.#..##...#.#..#..#.#...#', L: '#....#....#....#....#....#....#####',
  M: '#...###.###.#.##.#.##...##...##...#', N: '#...##...###..##.#.##..###...##...#', O: '.###.#...##...##...##...##...#.###.', P: '####.#...##...#####.#....#....#....',
  Q: '.###.#...##...##...##.#.##..#..##.#', R: '####.#...##...#####.#.#..#..#.#...#', S: '.#####....#.....###.....#....#####.', T: '#####..#....#....#....#....#....#..',
  U: '#...##...##...##...##...##...#.###.', V: '#...##...##...##...##...#.#.#...#..', W: '#...##...##...##.#.##.#.##.#.#.#.#.', X: '#...##...#.#.#...#...#.#.#...##...#',
  Y: '#...##...#.#.#...#....#....#....#..', Z: '#####....#...#...#...#...#....#####',
  '0': '.###.#...##..###.#.###..##...#.###.', '1': '..#...##....#....#....#....#...###.', '2': '.###.#...#....#...#...#...#...#####', '3': '####.....#....#.###.....#....#####.',
  '4': '...#...##..#.#.#..#.#####...#....#.', '5': '######....####.....#....##...#.###.', '6': '..##..#...#....####.#...##...#.###.', '7': '#####....#...#...#...#....#....#...',
  '8': '.###.#...##...#.###.#...##...#.###.', '9': '.###.#...##...#.####....#...#..##..',
  '.': '..............................##...', ',': '.........................##....#...', ':': '......##...##........##...##.......', ';': '......##...##........##....#...#...',
  "'": '..#....#...#.......................', '-': '...............#####...............', '(': '...#...#...#....#....#.....#.....#.', ')': '.#.....#.....#....#....#...#...#...',
  '%': '##...##..#...#...#...#...#..##...##', '/': '....#...#....#...#...#....#...#....', '?': '.###.#...#....#...#...#.........#..', '!': '..#....#....#....#....#.........#..',
  '"': '.#.#..#.#..........................', '&': '.##..#..#.#.#...#...#.#.##..#..##.#', '+': '.......#....#..#####..#....#.......', '=': '..........#####.....#####..........',
  ' ': '...................................',
};

/** Draws lines of text into an 8-bit grey picture (white page, black letters). */
function rasterize(lines: string[], w: number, h: number, scale: number, margin: number): Buffer {
  const px = Buffer.alloc(w * h, 255);
  const adv = 6 * scale;
  const lineH = 10 * scale;
  lines.forEach((line, li) => {
    const y0 = margin + li * lineH;
    if (y0 + 7 * scale > h - margin) return;
    [...line.toUpperCase()].forEach((ch, ci) => {
      const g = GLYPHS[ch] ?? GLYPHS['?'];
      const x0 = margin + ci * adv;
      if (x0 + 5 * scale > w - margin / 2) return;
      for (let gy = 0; gy < 7; gy++)
        for (let gx = 0; gx < 5; gx++) {
          if (g[gy * 5 + gx] !== '#') continue;
          for (let dy = 0; dy < scale; dy++) px.fill(0, (y0 + gy * scale + dy) * w + x0 + gx * scale, (y0 + gy * scale + dy) * w + x0 + gx * scale + scale);
        }
    });
  });
  return px;
}

// ---------------------------------------------------------------- the PDF writer

const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?');

class Writer {
  readonly fd: number;
  pos = 0;
  readonly offsets = new Map<number, number>();
  constructor(path: string) {
    this.fd = openSync(path, 'w');
  }
  raw(b: Buffer | string): void {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
    writeSync(this.fd, buf);
    this.pos += buf.length;
  }
  obj(num: number, body: string): void {
    this.offsets.set(num, this.pos);
    this.raw(`${num} 0 obj\n${body}\nendobj\n`);
  }
  stream(num: number, dict: string, data: Buffer): void {
    this.offsets.set(num, this.pos);
    this.raw(`${num} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`);
    this.raw(data);
    this.raw('\nendstream\nendobj\n');
  }
}

/** Makes the book. Returns where everything is (for tests and the eval). */
export function makeBigPdf(path: string, opts: BigPdfOptions = {}): BigPdfResult {
  const N = Math.max(4, Math.floor(opts.pages ?? 1000));
  const r = rng(opts.seed ?? 74);
  // Scanned pages: spread evenly, never the first page; some carry facts.
  const scanCount = Math.min(N - 1, Math.max(0, Math.floor(opts.scanned ?? 0)));
  const scanned = new Set<number>();
  for (let k = 0; k < scanCount; k++) scanned.add(Math.min(N, 2 + Math.floor(((k + 0.5) * (N - 1)) / scanCount)));
  // Chapters and sections over the pages.
  const nCh = Math.max(2, Math.min(CHAPTERS.length, Math.round(N / 50)));
  const chapters: BigPdfResult['chapters'] = [];
  const pageHeads = new Map<number, { chapter?: string; section?: string }>();
  for (let c = 0; c < nCh; c++) {
    const start = 1 + Math.floor((c * N) / nCh);
    const end = Math.floor(((c + 1) * N) / nCh);
    const title = `Chapter ${c + 1}: ${CHAPTERS[c % CHAPTERS.length]}`;
    const nSec = Math.max(1, Math.min(SECTION_KINDS.length, Math.round((end - start + 1) / 10)));
    const sections: { title: string; page: number }[] = [];
    for (let s = 0; s < nSec; s++) {
      const p = start + Math.floor((s * (end - start + 1)) / nSec);
      const st = `${c + 1}.${s + 1} ${CHAPTERS[c % CHAPTERS.length].replace(/^The /, '')}: ${SECTION_KINDS[s]}`;
      sections.push({ title: st, page: p });
      pageHeads.set(p, { ...(pageHeads.get(p) ?? {}), section: st });
    }
    pageHeads.set(start, { ...(pageHeads.get(start) ?? {}), chapter: title });
    chapters.push({ title, page: start, sections });
  }
  // Facts on known pages (spread; a few on scanned pages when there are any).
  const facts: BigPdfFact[] = FACTS.map(([sentenceText, question, answers], k) => {
    let page = Math.min(N, 1 + Math.floor(((k + 0.5) * N) / FACTS.length));
    if (scanned.size && k % 6 === 3) page = [...scanned][Math.floor((k / FACTS.length) * scanned.size)] ?? page;
    else if (scanned.has(page)) page = page < N ? page + 1 : page - 1;
    return { page, sentence: sentenceText, question, answers, scanned: scanned.has(page) };
  });
  const factsOn = new Map<number, string[]>();
  for (const f of facts) factsOn.set(f.page, [...(factsOn.get(f.page) ?? []), f.sentence]);

  // Object numbers: 1 catalog, 2 pages, 3/4 fonts, 5 outlines, 6 info, then 3 per page, then outline items.
  const pageObj = (i: number) => 10 + i * 3;
  const contentObj = (i: number) => 11 + i * 3;
  const imageObj = (i: number) => 12 + i * 3;
  const outlineBase = 10 + N * 3;
  const bulkPerPage = opts.bulkMb ? Math.max(0, Math.floor((opts.bulkMb * 1024 * 1024) / N)) : 0;
  const bulkSide = bulkPerPage ? Math.max(16, Math.floor(Math.sqrt(bulkPerPage))) : 0;

  const w = new Writer(path);
  w.raw('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n');
  /** Small objects: written out now, or packed into object streams at the end. */
  const packed: [number, string][] = [];
  const small = (num: number, body: string) => (opts.objstm ? packed.push([num, body]) : w.obj(num, body));

  for (let i = 0; i < N; i++) {
    const pno = i + 1;
    const heads = pageHeads.get(pno) ?? {};
    // The page's text: headings, paragraphs (with any facts in the middle), a page number.
    const paras: string[] = [];
    const nPara = 5 + Math.floor(r() * 3);
    for (let k = 0; k < nPara; k++) {
      const n = 3 + Math.floor(r() * 4);
      paras.push(Array.from({ length: n }, () => sentence(r)).join(' '));
    }
    const fs = factsOn.get(pno) ?? [];
    fs.forEach((f, k) => {
      const at = Math.min(paras.length - 1, 1 + k * 2);
      paras[at] = `${sentence(r)} ${f} ${sentence(r)}`;
    });
    if (scanned.has(pno)) {
      const lines: string[] = [];
      if (heads.chapter) lines.push(heads.chapter, '');
      if (heads.section) lines.push(heads.section, '');
      for (const p of paras.slice(0, 4)) lines.push(...wrap(p, 54), '');
      lines.push(`Page ${pno}`);
      const W = 1224;
      const H = 1584;
      const img = deflateSync(rasterize(lines, W, H, 3, 72));
      w.stream(imageObj(i), `/Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, img);
      w.stream(contentObj(i), '/Filter /FlateDecode', deflateSync(Buffer.from('q 612 0 0 792 0 0 cm /Im1 Do Q\n', 'latin1')));
      small(pageObj(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObj(i)} 0 R /Resources << /XObject << /Im1 ${imageObj(i)} 0 R >> >> >>`);
      continue;
    }
    let y = 740;
    let ops = '';
    const line = (font: string, size: number, text: string, gap: number) => {
      ops += `BT /${font} ${size} Tf 72 ${y} Td (${esc(text)}) Tj ET\n`;
      y -= gap;
    };
    if (heads.chapter) line('F2', 20, heads.chapter, 34);
    if (heads.section) line('F2', 14, heads.section, 24);
    for (const p of paras) {
      for (const l of wrap(p, 92)) {
        if (y < 80) break;
        line('F1', 10, l, 13);
      }
      y -= 9;
      if (y < 80) break;
    }
    ops += `BT /F1 9 Tf 290 40 Td (${pno}) Tj ET\n`;
    let xo = '';
    if (bulkSide) {
      // An incompressible picture, drawn tiny in the corner (only there to make the file big).
      const data = Buffer.allocUnsafe(bulkSide * bulkSide);
      for (let k = 0; k < data.length; k += 4) data.writeUInt32LE(Math.floor(r() * 4294967296), Math.min(k, data.length - 4));
      w.stream(imageObj(i), `/Type /XObject /Subtype /Image /Width ${bulkSide} /Height ${bulkSide} /ColorSpace /DeviceGray /BitsPerComponent 8`, data);
      ops += 'q 6 0 0 6 600 780 cm /Im1 Do Q\n';
      xo = ` /XObject << /Im1 ${imageObj(i)} 0 R >>`;
    }
    w.stream(contentObj(i), '/Filter /FlateDecode', deflateSync(Buffer.from(ops, 'latin1')));
    small(pageObj(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObj(i)} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xo} >> >>`);
  }

  // The outline: chapters with their sections, each opening its page.
  let num = outlineBase;
  const chNums = chapters.map(() => num++);
  const secNums = chapters.map((c) => c.sections.map(() => num++));
  chapters.forEach((c, ci) => {
    const kids = secNums[ci];
    const links = `${ci > 0 ? ` /Prev ${chNums[ci - 1]} 0 R` : ''}${ci < chapters.length - 1 ? ` /Next ${chNums[ci + 1]} 0 R` : ''}`;
    small(chNums[ci], `<< /Title (${esc(c.title)}) /Parent 5 0 R${links} /First ${kids[0]} 0 R /Last ${kids.at(-1)} 0 R /Count ${kids.length} /Dest [${pageObj(c.page - 1)} 0 R /Fit] >>`);
    c.sections.forEach((s, si) => {
      const l2 = `${si > 0 ? ` /Prev ${kids[si - 1]} 0 R` : ''}${si < kids.length - 1 ? ` /Next ${kids[si + 1]} 0 R` : ''}`;
      small(kids[si], `<< /Title (${esc(s.title)}) /Parent ${chNums[ci]} 0 R${l2} /Dest [${pageObj(s.page - 1)} 0 R /XYZ 0 792 0] >>`);
    });
  });
  small(1, '<< /Type /Catalog /Pages 2 0 R /Outlines 5 0 R /PageMode /UseOutlines >>');
  small(2, `<< /Type /Pages /Count ${N} /Kids [${Array.from({ length: N }, (_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`);
  small(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  small(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  small(5, `<< /Type /Outlines /First ${chNums[0]} 0 R /Last ${chNums.at(-1)} 0 R /Count ${chapters.length} >>`);
  small(6, `<< /Title (Harbor Wind Farm Maintenance Manual) /Producer (Sara make-big-pdf) >>`);

  const size = num;
  const stmLocation = new Map<number, [number, number]>(); // obj -> [stream obj, index]
  if (opts.objstm) {
    // Object streams of up to 100 objects each.
    for (let k = 0; k < packed.length; k += 100) {
      const group = packed.slice(k, k + 100);
      const sn = num++;
      let header = '';
      let body = '';
      group.forEach(([on, b], idx) => {
        header += `${on} ${body.length} `;
        body += `${b}\n`;
        stmLocation.set(on, [sn, idx]);
      });
      const data = deflateSync(Buffer.from(header + body, 'latin1'));
      w.stream(sn, `/Type /ObjStm /N ${group.length} /First ${Buffer.byteLength(header, 'latin1')} /Filter /FlateDecode`, data);
    }
    const xrefNum = num++;
    const total = num;
    const rows = Buffer.alloc(total * 7);
    for (let o = 0; o < total; o++) {
      const at = o * 7;
      const loc = stmLocation.get(o);
      const off = o === xrefNum ? w.pos : w.offsets.get(o);
      if (loc) {
        rows[at] = 2;
        rows.writeUInt32BE(loc[0], at + 1);
        rows.writeUInt16BE(loc[1], at + 5);
      } else if (off !== undefined) {
        rows[at] = 1;
        rows.writeUInt32BE(off, at + 1);
      } else rows.writeUInt16BE(o === 0 ? 65535 : 0, at + 5);
    }
    const data = deflateSync(rows);
    const at = w.pos;
    w.stream(xrefNum, `/Type /XRef /Size ${total} /W [1 4 2] /Root 1 0 R /Info 6 0 R /Filter /FlateDecode`, data);
    w.raw(`startxref\n${at}\n%%EOF\n`);
  } else {
    const at = w.pos;
    let x = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let o = 1; o < size; o++) {
      const off = w.offsets.get(o);
      x += off === undefined ? '0000000000 00000 f \n' : `${String(off).padStart(10, '0')} 00000 n \n`;
    }
    w.raw(x);
    w.raw(`trailer\n<< /Size ${size} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${at}\n%%EOF\n`);
  }
  const bytes = w.pos;
  closeSync(w.fd);
  const result: BigPdfResult = { path, pages: N, bytes, scanned: [...scanned], facts, chapters };
  return result;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const out = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
  if (!out) {
    console.error('usage: node scripts/make-big-pdf.ts out.pdf [--pages 1000] [--scanned 50] [--objstm] [--bulk-mb 900]');
    process.exit(2);
  }
  const val = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? Number(args[i + 1]) : undefined;
  };
  const t0 = Date.now();
  const r = makeBigPdf(out, { pages: val('--pages'), scanned: val('--scanned'), objstm: args.includes('--objstm'), bulkMb: val('--bulk-mb') });
  writeFileSync(`${out}.facts.json`, JSON.stringify({ pages: r.pages, bytes: r.bytes, scanned: r.scanned, chapters: r.chapters, facts: r.facts }, null, 2));
  console.log(`${out}: ${r.pages} pages, ${(r.bytes / 1048576).toFixed(1)} MB, ${r.scanned.length} scanned, ${r.facts.length} facts, ${Date.now() - t0} ms`);
}
