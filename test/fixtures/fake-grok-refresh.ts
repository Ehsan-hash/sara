// Stands in for `grok models`: renews the sign-in in $HOME/.grok/auth.json like the real program.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.at(-1) === 'models') {
  const file = join(process.env.HOME ?? '', '.grok', 'auth.json');
  const d = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { key: string; expires_at: string }>;
  const k = Object.keys(d)[0];
  d[k] = { ...d[k], key: 'renewed-token', expires_at: new Date(Date.now() + 6 * 3600_000).toISOString() };
  writeFileSync(file, JSON.stringify(d));
  console.log('You are logged in with grok.com.');
}
