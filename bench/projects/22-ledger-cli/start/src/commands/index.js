// Every command with its options (parsed once by src/cli/args.js).
import { addCommand } from './add.js';
import { balanceCommand } from './balance.js';
import { exportCommand } from './export.js';
import { importCommand } from './import.js';
import { listCommand } from './list.js';
import { removeCommand } from './remove.js';
import { reportCommand } from './report.js';

export const GLOBAL_OPTIONS = {
  file: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

export const FILTER_OPTIONS = {
  since: { type: 'string' },
  until: { type: 'string' },
  month: { type: 'string' },
  category: { type: 'string', short: 'c' },
  tag: { type: 'string', short: 't' },
  min: { type: 'string' },
  max: { type: 'string' },
  search: { type: 'string', short: 's' },
};

const FORMAT = { format: { type: 'string', short: 'f', default: 'table' } };

export const COMMANDS = {
  add: {
    summary: 'Add an entry.',
    args: '<amount> <description…>',
    writes: true,
    options: { date: { type: 'string', short: 'd' }, category: { type: 'string', short: 'c' }, tag: { type: 'string', short: 't', multiple: true }, quiet: { type: 'boolean', short: 'q' } },
    run: addCommand,
  },
  list: { summary: 'List entries.', args: '', options: { ...FILTER_OPTIONS, ...FORMAT, limit: { type: 'string', short: 'n' } }, run: listCommand },
  report: { summary: 'Totals by category, month or tag.', args: '', options: { ...FILTER_OPTIONS, ...FORMAT, by: { type: 'string', short: 'b', default: 'category' } }, run: reportCommand },
  balance: { summary: 'The total of the matching entries.', args: '', options: { ...FILTER_OPTIONS }, run: balanceCommand },
  remove: { summary: 'Remove an entry by id.', args: '<id>', writes: true, options: {}, run: removeCommand },
  import: { summary: 'Import entries from a CSV file.', args: '<file.csv>', writes: true, options: { category: { type: 'string', short: 'c' }, quiet: { type: 'boolean', short: 'q' } }, run: importCommand },
  export: { summary: 'Write matching entries as CSV.', args: '', options: { ...FILTER_OPTIONS, out: { type: 'string', short: 'o' } }, run: exportCommand },
};
