// Fake `claude setup-token` for tests: prints a sign-in link (wrapped and with escape codes, like
// the real terminal UI), waits for a code on stdin, then prints a token (or an error).
import { createInterface } from 'node:readline';

if (process.argv.at(-1) !== 'setup-token') process.exit(2);
const out = (s: string) => process.stdout.write(s);
out('\x1b[?25l\x1b[1mWelcome to Claude Code\x1b[22m\r\n');
out('Browser didn\x1b[1Ct open? Use the url below to sign in\r\n');
out('https://claude.com/cai/oauth/authorize?code=true&client_id=abc&response_type=code&redi\r\nrect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&state=xyz\r\n');
out('Paste code here if prompted > ');
createInterface({ input: process.stdin }).on('line', (line) => {
  const code = line.replace(/\r/g, '').trim();
  if (code === 'good#code') {
    out('\r\n\x1b[32m✓ Long-lived authentication token created successfully!\x1b[39m\r\n');
    out('Your OAuth token (valid for 1 year):\r\n\r\nsk-ant-oat01-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345\r\n6789abcdef\r\n');
    out('Store this token securely.\r\n');
    setTimeout(() => process.exit(0), 2000);
  } else {
    // Like the real program: says why and stays open, waiting for Enter.
    out('\r\n\x1b[31mOAuth error: Request failed with status code 400\x1b[39m\r\n\r\nPress Enter to retry. ');
  }
});
