// What the bot says. Pure functions: easy to test and to change.
// Each handler gets the message text and the sender's first name and returns the reply text
// (or null to stay quiet).

export const COMMANDS = {
  '/start': (_args, name) => `Hi ${name}! I'm a small bot. Send /help to see what I can do.`,
  '/help': () => ['Here is what I understand:', '/help - this list', '/echo <text> - I repeat it', '/time - the time on my server'].join('\n'),
  '/echo': (args) => (args ? args : 'Tell me what to repeat, like: /echo hello'),
  '/time': () => `It's ${new Date().toUTCString()} on my server.`,
};

/** The reply to one text message, or null. */
export function replyTo(text, firstName = 'there') {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (t.startsWith('/')) {
    // "/echo@MyBot hello" also works in groups.
    const [head, ...rest] = t.split(/\s+/);
    const cmd = head.replace(/@\w+$/, '').toLowerCase();
    const handler = COMMANDS[cmd];
    return handler ? handler(rest.join(' '), firstName) : `I don't know ${cmd}. Try /help.`;
  }
  return `You said: ${t}`;
}
