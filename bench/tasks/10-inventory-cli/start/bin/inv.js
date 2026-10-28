#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from '../src/args.js';
import { table } from '../src/format.js';

const { command, file } = parseArgs(process.argv.slice(2));
if (command !== 'list' || !file) {
  console.error('usage: inv list <file.json> [--format table|csv|json] [--low N]');
  process.exit(1);
}
const items = JSON.parse(readFileSync(file, 'utf8')).items;
console.log(table(items));
