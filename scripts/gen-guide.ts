// Rewrites the dial tables in web/help.html (between <!-- dials:start --> and <!-- dials:end -->)
// from the definitions in src/traits.ts, so the guide never drifts from the app.
//   node scripts/gen-guide.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRAITS } from '../src/traits.ts';
import { withDialTables } from '../src/guide-dials.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(ROOT, 'web', 'help.html');
const html = readFileSync(file, 'utf8');
// Keep the file's own line endings (a Windows checkout has CRLF).
const crlf = html.includes('\r\n');
const out = withDialTables(html.replace(/\r\n/g, '\n'));
writeFileSync(file, crlf ? out.replace(/\n/g, '\r\n') : out);
console.log(`Wrote ${TRAITS.length} dials into web/help.html`);
