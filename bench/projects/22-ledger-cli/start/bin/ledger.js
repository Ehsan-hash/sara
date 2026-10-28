#!/usr/bin/env node
import { run } from '../src/cli/main.js';

const code = await run(process.argv.slice(2), {
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  env: process.env,
  cwd: process.cwd(),
});
process.exitCode = code;
