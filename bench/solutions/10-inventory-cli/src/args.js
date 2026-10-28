/** Parses `command file --flag value --flag=value ...`. */
export function parseArgs(argv) {
  const [command, file, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(rest[i]);
    if (!m) continue;
    if (m[2] !== undefined) flags[m[1]] = m[2];
    else flags[m[1]] = rest[++i];
  }
  return { command, file, flags };
}
