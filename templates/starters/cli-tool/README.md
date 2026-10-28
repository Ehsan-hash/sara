# __PROJECT_NAME__

A command-line tool in plain Node.js (no packages). It counts lines, words and characters of
files or standard input, and can list the most common words. Use it as the starting point for
your own tool: the argument parsing, help text, exit codes and tests are already there.

## Use it

```sh
node cli.js notes.txt
node cli.js --top 5 --json notes.txt
cat notes.txt | node cli.js
```

To have it as a command: `npm link` (then `__PROJECT_NAME__ --help`).

## Test it

```sh
npm test
```

## Files

- `cli.js`: options (`node:util` parseArgs), help, exit codes (0 ok, 1 can't read, 2 bad usage).
- `lib.js`: the actual work (pure functions).
- `test/`: tests of both.
