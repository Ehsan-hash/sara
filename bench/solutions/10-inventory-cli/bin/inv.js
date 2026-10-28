#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from '../src/args.js';
import { FORMATS } from '../src/format.js';

const { command, file, flags } = parseArgs(process.argv.slice(2));
if (command !== 'list' || !file) {
  console.error('usage: inv list <file.json> [--format table|csv|json] [--low N]');
  process.exit(1);
}
const name = flags.format ?? 'table';
const format = Object.hasOwn(FORMATS, name) ? FORMATS[name] : undefined;
if (!format) {
  console.error(`unknown format: ${name}`);
  process.exit(2);
}
let items = JSON.parse(readFileSync(file, 'utf8')).items;
if (flags.low !== undefined) items = items.filter((i) => i.qty < Number(flags.low));
console.log(format(items));
