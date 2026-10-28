// Who the companion is to the owner: name and pronouns. The app ships as "Sara" (she/her); owners
// can rename their companion and pick pronouns. All built-in wording (screens, prompts, messages)
// is written for "Sara"/she and passed through personalize(). Owner and companion text (chats,
// memories, titles) is never rewritten.
// No imports: this file is also served to the browser (types stripped) so both sides agree.

export type Pronouns = 'she' | 'he' | 'they';

export interface Identity {
  name: string;
  pronouns: Pronouns;
}

export const DEFAULT_IDENTITY: Identity = { name: 'Sara', pronouns: 'she' };

const FORMS = {
  she: { subj: 'she', obj: 'her', poss: 'her', poss2: 'hers', refl: 'herself' },
  he: { subj: 'he', obj: 'him', poss: 'his', poss2: 'his', refl: 'himself' },
  they: { subj: 'they', obj: 'them', poss: 'their', poss2: 'theirs', refl: 'themself' },
} as const;

/** Pronoun forms for templates: subj (she), obj (her), poss (her), poss2 (hers), refl (herself). */
export function forms(p: Pronouns): (typeof FORMS)[Pronouns] {
  return FORMS[p] ?? FORMS.she;
}

// After "her": these words mean it was the object ("wait for her or…", "let her keep going").
// Words that are also common nouns after a possessive (look, reply, laugh, work…) are left out.
const AFTER_OBJECT = new Set(
  'and or to for about with at in on up out off first again back now too more that when if so but a an the yet alone there here it anything something everything nothing what how why than as by from into before after while until know be do go see say tell feel take send stop wait try use write think remember decide have add find make keep get give let hear want speak learn choose forget any anytime every each some all once later soon today tonight tomorrow anyway instead directly right'.split(' '),
);

const KEEP_S = new Set(['is', 'was', 'has', 'does', 'this', 'yes', 'its', 'has', 'always', 'perhaps', 'sometimes', 'thus', 'plus']);

const cap = (s: string, like: string) => (like[0] === like[0].toUpperCase() ? s[0].toUpperCase() + s.slice(1) : s);

/** "keeps" → "keep", "watches" → "watch", "tries" → "try" (for they). */
function baseVerb(v: string): string {
  if (KEEP_S.has(v.toLowerCase()) || !/s$/.test(v) || /ss$/.test(v)) return v;
  if (/ies$/.test(v)) return v.slice(0, -3) + 'y';
  if (/(sh|ch|ss|x|z|o)es$/.test(v)) return v.slice(0, -2);
  return v.slice(0, -1);
}

/** Rewrites built-in wording written for "Sara"/she to the owner's companion. */
export function personalize(text: string, id: Identity = DEFAULT_IDENTITY): string {
  if (!text) return text;
  let out = text;
  if (id.name && id.name !== 'Sara') out = out.replace(/\bSara\b/g, id.name);
  if (id.pronouns === 'she' || !id.pronouns) return out;
  const f = forms(id.pronouns);
  if (id.pronouns === 'they') {
    out = out
      .replace(/\b([Ss])he's\b/g, (_m, s: string) => cap("they're", s))
      .replace(/\b([Ss])he (is|was|has|does|doesn't|isn't|wasn't|hasn't)\b/g, (_m, s: string, v: string) => {
        const map: Record<string, string> = { is: 'are', was: 'were', has: 'have', does: 'do', "doesn't": "don't", "isn't": "aren't", "wasn't": "weren't", "hasn't": "haven't" };
        return `${cap('they', s)} ${map[v]}`;
      })
      .replace(/\b([Ss])he ((?:never|always|also|only|still|just|really|sometimes|usually|often|even|already) )?([a-z]+)\b/g, (_m, s: string, adv: string | undefined, v: string) => `${cap('they', s)} ${adv ?? ''}${baseVerb(v)}`);
  }
  out = out
    .replace(/\b([Hh])erself\b/g, (_m, h: string) => cap(f.refl, h))
    .replace(/\b([Hh])ers\b/g, (_m, h: string) => cap(f.poss2, h))
    .replace(/\b([Ss])he\b/g, (_m, s: string) => cap(f.subj, s))
    .replace(/\b([Hh])er\b(\s*)([A-Za-z']*)/g, (_m, h: string, sp: string, next: string) => {
      const object = !next || AFTER_OBJECT.has(next.toLowerCase());
      return `${cap(object ? f.obj : f.poss, h)}${sp}${next}`;
    });
  return out;
}

/** Normalizes stored settings into an Identity (unknown pronouns fall back to she). */
export function toIdentity(name: unknown, pronouns: unknown): Identity {
  const n = String(name ?? '').trim() || DEFAULT_IDENTITY.name;
  const p = pronouns === 'he' || pronouns === 'they' ? pronouns : 'she';
  return { name: n, pronouns: p };
}
