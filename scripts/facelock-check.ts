// Phase 36 exit check: 10 pictures of the default look in different outfits and places, all made with
// the face lock (her original portrait as the second reference). The owner looks them over.
//   XAI_KEY=… node scripts/facelock-check.ts <portrait.jpg> <out dir>
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LookBuilder } from '../src/look.ts';

const [portrait, out] = process.argv.slice(2);
if (!portrait || !out || !process.env.XAI_KEY) throw new Error('usage: XAI_KEY=… node scripts/facelock-check.ts <portrait.jpg> <out dir>');
mkdirSync(out, { recursive: true });
const data = join(out, '.work');
rmSync(data, { recursive: true, force: true });
mkdirSync(data, { recursive: true });
copyFileSync(portrait, join(data, 'look-face.jpg'));
const look = new LookBuilder({ dataDir: data, key: async () => process.env.XAI_KEY, faceLock: () => true });
const face = readFileSync(portrait);
const runs: [string, string?][] = [
  ['work', 'office'],
  ['evening', 'city'],
  ['sporty', 'gym'],
  ['winter', 'outdoors'],
  ['summer', 'beach'],
  ['pajamas', 'bedroom'],
  ['date', 'cafe'],
  ['rain', 'outdoors'],
  ['hoodie', 'room'],
  ['halloween'],
];
let n = 0;
for (const [outfit, place] of runs) {
  n++;
  await look.outfit(face, outfit, { place });
  copyFileSync(look.draftFile, join(out, `${String(n).padStart(2, '0')}-${outfit}${place ? `-${place}` : ''}.jpg`));
  console.log(`${n}/10 ${outfit}${place ? ` at ${place}` : ''}`);
}
rmSync(data, { recursive: true, force: true });
