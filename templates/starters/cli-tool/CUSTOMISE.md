# Notes for customising (for the assistant)

- Put the real work in `lib.js` as pure functions with tests; keep `cli.js` to options, input and
  output.
- Update `HELP` whenever an option changes, and keep the exit codes (0 ok, 1 runtime problem,
  2 bad usage).
- Use only Node's built-in modules unless the owner asks for a package.
- Rename the command in `package.json` (`bin`) if the owner wants another name.
- Run `npm test` after every change.
