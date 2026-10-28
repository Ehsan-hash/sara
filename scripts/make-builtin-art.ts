// Makes the built-in pictures the default look is missing (e.g. a new expression and its talking
// frames), from the existing built-in portrait, with the same code a custom look uses.
//   XAI_KEY=… node scripts/make-builtin-art.ts <web dir> <out dir>
// Copy the new files from <out dir> into web/ after looking at them.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LOOK_PATHS, LookBuilder } from '../src/look.ts';

const [web, out] = process.argv.slice(2);
if (!web || !out || !process.env.XAI_KEY) throw new Error('usage: XAI_KEY=… node scripts/make-builtin-art.ts <web dir> <out dir>');
const data = join(out, '.work');
rmSync(data, { recursive: true, force: true });
mkdirSync(join(data, 'look', 'sara', 'frames'), { recursive: true });
for (const rel of LOOK_PATHS) if (existsSync(join(web, rel))) cpSync(join(web, rel), join(data, 'look', rel));
const look = new LookBuilder({ dataDir: data, key: async () => process.env.XAI_KEY, faceLock: () => false });
const todo = look.missingFrames();
console.log(`Making ${todo.length} pictures: ${todo.join(', ')}`);
await look.complete();
for (const rel of todo) {
  mkdirSync(join(out, rel, '..'), { recursive: true });
  cpSync(join(data, 'look', rel), join(out, rel));
}
rmSync(data, { recursive: true, force: true });
console.log(`Done: ${readdirSync(out, { recursive: true }).length} files in ${out}`);
