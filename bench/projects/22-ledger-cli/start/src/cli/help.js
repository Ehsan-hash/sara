import { COMMANDS } from '../commands/index.js';

export function usage(command) {
  if (command && COMMANDS[command]) {
    const c = COMMANDS[command];
    const opts = Object.entries(c.options)
      .map(([name, o]) => `  --${name}${o.type === 'boolean' ? '' : ' <value>'}${o.short ? `, -${o.short}` : ''}${o.multiple ? ' (repeatable)' : ''}`)
      .join('\n');
    return `ledger ${command} ${c.args}\n${c.summary}\n${opts ? `\nOptions:\n${opts}\n` : ''}`;
  }
  const list = Object.entries(COMMANDS)
    .map(([name, c]) => `  ${name.padEnd(8)} ${c.summary}`)
    .join('\n');
  return `ledger <command> [options]\n\nCommands:\n${list}\n\nGlobal options: --file <path>, --help\nSee docs/CLI.md for details.\n`;
}
