#!/usr/bin/env node
// __PROJECT_NAME__: counts lines, words and characters of files (or standard input).
//   node cli.js notes.txt         node cli.js --top 3 notes.txt       cat a.txt | node cli.js
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { count, topWords } from './lib.js';

const HELP = `Usage: __PROJECT_NAME__ [options] [file ...]

Counts lines, words and characters. Reads standard input when no file is given.

Options:
  --top <n>     also list the n most common words
  --json        print JSON instead of text
  -h, --help    show this help
  -v, --version show the version`;

export async function main(argv, io = { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin }) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { top: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } } });
  } catch (err) {
    io.stderr.write(`${err.message}\n\n${HELP}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) return (io.stdout.write(`${HELP}\n`), 0);
  if (values.version) return (io.stdout.write('0.1.0\n'), 0);
  const top = values.top === undefined ? 0 : Number(values.top);
  if (!Number.isInteger(top) || top < 0) {
    io.stderr.write('--top needs a whole number\n');
    return 2;
  }
  const inputs = [];
  try {
    if (positionals.length) for (const f of positionals) inputs.push({ name: f, text: readFileSync(f, 'utf8') });
    else {
      let text = '';
      for await (const c of io.stdin) text += c;
      inputs.push({ name: '-', text });
    }
  } catch (err) {
    io.stderr.write(`Can't read ${err.path ?? 'input'}: ${err.code === 'ENOENT' ? 'no such file' : err.message}\n`);
    return 1;
  }
  const results = inputs.map((i) => ({ file: i.name, ...count(i.text), ...(top ? { top: topWords(i.text, top) } : {}) }));
  if (values.json) io.stdout.write(`${JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}\n`);
  else
    for (const r of results) {
      io.stdout.write(`${r.lines}\t${r.words}\t${r.chars}\t${r.file}\n`);
      for (const t of r.top ?? []) io.stdout.write(`  ${t.times}\t${t.word}\n`);
    }
  return 0;
}

if (process.argv[1]?.endsWith('cli.js')) process.exitCode = await main(process.argv.slice(2));
