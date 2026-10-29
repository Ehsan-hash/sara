// Phase 72: writes the Alexa interaction model (integrations/alexa/interaction-model.en-US.json) from
// src/alexa.ts, so the shipped file and the server's download stay the same (test/phase72.test.ts).
// Usage: node scripts/alexa-model.ts [--check]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alexaModel } from '../src/alexa.ts';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'integrations', 'alexa', 'interaction-model.en-US.json');
const json = `${JSON.stringify(alexaModel(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  const same = (() => {
    try {
      return readFileSync(file, 'utf8') === json;
    } catch {
      return false;
    }
  })();
  console.log(same ? 'The Alexa model file is current.' : 'The Alexa model file is out of date: run node scripts/alexa-model.ts');
  process.exit(same ? 0 : 1);
}
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, json);
console.log(`Wrote ${file}`);
