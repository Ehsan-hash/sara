// Her reply as words to be spoken aloud: one cleaner for every voice (the app's own voice,
// Alexa, Home Assistant speakers). Markdown, code, emoji and long links go; what's said in their
// place depends on where she is heard (see FOR_APP and FOR_SPEAKER).

export interface SpokenOptions {
  /** 'word': a bare web address is said as "a link"; 'host': as its site name ("example.com"). */
  links?: 'word' | 'host';
  /** Said in place of a code block. */
  codeNote?: string;
  /** Longest result (characters); a longer text is cut at a sentence and gets `restNote`. */
  max?: number;
  /** Added after a cut. */
  restNote?: string;
}

/** The app's own voice: the code and links are right there in the chat. */
export const FOR_APP: SpokenOptions = { links: 'word', codeNote: '(I put the code in the chat.)' };
/** A smart speaker (Alexa, Home Assistant): nothing to look at, so name the site and point to the app. */
export const FOR_SPEAKER: SpokenOptions = { links: 'host', codeNote: '(I left out some code: it is in the Sara app.)', max: 1_400, restNote: 'The rest is in the Sara app.' };

/** Plain spoken words: no markdown, code, emoji, control characters or long links. */
export function spokenText(input: string, opts: SpokenOptions = FOR_APP): string {
  const o = { ...FOR_APP, ...opts };
  let s = String(input ?? '');
  s = s.replace(/```[\s\S]*?(```|$)/g, ` ${o.codeNote} `);
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = o.links === 'host'
    ? s.replace(/https?:\/\/([^\s/)]+)(\/[^\s)]*)?/gi, (_m, host: string) => host.replace(/^www\./i, ''))
    : s.replace(/https?:\/\/\S+/gi, 'a link');
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/^\s*[-*+•]\s+/gm, '').replace(/^\s*\d+[.)]\s+/gm, '').replace(/^\s*>\s?/gm, '');
  // Bold, italics, strike-through. Underscores count only at word edges, so my_var_name keeps its
  // parts (spoken "my var name" below) instead of being glued into "myvarname".
  s = s.replace(/(\*\*|\*|~~)(?=\S)([\s\S]*?\S)\1/g, '$2');
  s = s.replace(/(?<![\p{L}\p{N}_])(__|_)(?=\S)([\s\S]*?\S)\1(?![\p{L}\p{N}_])/gu, '$2');
  // Leftover markup characters become pauses ('<', '>' and '#' stay: "a < b", "<b> tags", "#1").
  s = s.replace(/[|*_~]/g, ' ');
  // Emoji, pictographs, variation selectors, joiners, keycaps, skin tones and flags.
  s = s.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{FE0E}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu, '');
  // Control characters (newlines and tabs become spaces just below).
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  const max = o.max;
  if (max !== undefined && s.length > max) {
    const cut = s.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = `${end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`}${o.restNote ? ` ${o.restNote}` : ''}`;
  }
  return s;
}
