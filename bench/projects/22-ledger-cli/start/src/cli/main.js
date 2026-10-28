// Entry point: run(argv, io) → exit code.
import { join, resolve } from 'node:path';
import { parseArgs } from './args.js';
import { DataError, UsageError } from './errors.js';
import { usage } from './help.js';
import { COMMANDS, GLOBAL_OPTIONS } from '../commands/index.js';
import { todayFrom } from '../core/dates.js';
import { openLedger } from '../io/store.js';

export async function run(argv, io) {
  const [command, ...rest] = argv;
  try {
    if (!command || command === '--help' || command === '-h' || command === 'help') {
      io.stdout(usage(rest[0]));
      return 0;
    }
    const cmd = COMMANDS[command];
    if (!cmd) throw new UsageError(`unknown command "${command}" (try: ledger --help)`);
    const { values, positionals } = parseArgs(rest, { options: { ...GLOBAL_OPTIONS, ...cmd.options } });
    if (values.help) {
      io.stdout(usage(command));
      return 0;
    }
    const file = resolve(io.cwd, values.file ?? io.env.LEDGER_FILE ?? join(io.cwd, 'ledger.json'));
    const ledger = openLedger(file);
    const ctx = { io, values, positionals, ledger, today: todayFrom(io.env), file };
    await cmd.run(ctx);
    if (cmd.writes) ledger.save();
    return 0;
  } catch (err) {
    if (err instanceof UsageError || err instanceof DataError) {
      io.stderr(`error: ${err.message}\n`);
      return err.exitCode;
    }
    io.stderr(`error: ${err.message}\n`);
    return 1;
  }
}
