#!/usr/bin/env node
// __PROJECT_NAME__: count words, lines and characters in a file (or standard input).
import { readFileSync } from 'node:fs';
import { count } from './lib.js';

const file = process.argv[2];
const text = readFileSync(file ?? 0, 'utf8');
const c = count(text);
console.log(`${c.words} words, ${c.lines} lines, ${c.characters} characters`);
