// Phase 34: the personality studio. Starting points (archetypes), "make her one of a kind",
// "surprise me", "fill in the rest", try-before-saving sample replies, saving (with the dials that
// drive app settings), and "tune by talking" (a tool she uses; the owner approves each change).
import { randomInt } from 'node:crypto';
import { writeFileAtomic } from './fs-util.ts';
import { join } from 'node:path';
import { RELATIONSHIPS, TALK } from './character.ts';
import { type AppContext, bondContext, resolveFor } from './chat.ts';
import { isRomantic } from './bond.ts';
import { forms, personalize, type Pronouns } from './identity.ts';
import { buildSystemPrompt, type Persona, validatePersona } from './persona.ts';
import { ADULT_OFF_NOTE } from './safety.ts';
import { adultModeOn } from './settings.ts';
import type { Conversation } from './store.ts';
import { type Tool, ToolError } from './tools/types.ts';
import { clampTrait, cleanLife, HUMOURS, initiativeToProactive, WORK_IDS, type Life, LIFE_FIELDS, LIFE_IDS, type TraitId, TRAIT_IDS, TRAIT_MID, traitDef, type Traits, traitWord } from './traits.ts';

export type Rng = () => number;
/** A uniform random number in [0, 1) from the system's secure source. */
export const secureRng: Rng = () => randomInt(0, 1_000_000) / 1_000_000;
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
function pickSome<T>(rng: Rng, xs: readonly T[], n: number): T[] {
  const pool = [...xs];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

// ---------- starting points ----------
export interface Archetype {
  id: string;
  emoji: string;
  label: string;
  blurb: string;
  traits: Traits;
  humour: string;
  talk: string;
  /** One sentence about her, third person, she/her (personalized for other pronouns). */
  summary: string;
  personality: string[];
  jobs: string[];
  hobbies: string[];
}

export const ARCHETYPES: Archetype[] = [
  {
    id: 'sweetheart',
    emoji: '🌻',
    label: 'The sweetheart',
    blurb: 'Warm, gentle and affectionate. Always in your corner.',
    traits: { warmth: 9, affection: 8, patience: 8, blunt: 2, fiery: 2, teasing: 3, depth: 6 },
    humour: 'gentle',
    talk: 'texting',
    summary: 'She is soft-hearted and caring, the kind of person who remembers everything you told her and checks in.',
    personality: ['Kind to a fault, and quietly stubborn about the people she loves.', 'Gets flustered by compliments.', 'Worries a little too much about others.'],
    jobs: ['pediatric nurse', 'kindergarten teacher', 'baker at a family bakery', 'veterinary assistant', 'florist', 'speech therapist'],
    hobbies: ['baking', 'knitting', 'gardening', 'volunteering at the animal shelter', 'cosy video games', 'scrapbooking'],
  },
  {
    id: 'tease',
    emoji: '😏',
    label: 'The tease',
    blurb: 'Quick, flirty and full of banter. Keeps you on your toes.',
    traits: { teasing: 9, playful: 8, confidence: 8, blunt: 6, warmth: 6, casual: 7 },
    humour: 'sarcastic',
    talk: 'texting',
    summary: 'She is quick-witted and cheeky, never misses a chance for banter, and is secretly very loyal.',
    personality: ['Hides soft feelings behind jokes.', 'Competitive about silly things.', 'Hates being bored more than anything.'],
    jobs: ['bartender at a cocktail bar', 'marketing copywriter', 'radio host', 'hairstylist', 'real-estate agent', 'stand-up comic on weekends'],
    hobbies: ['pub quizzes', 'karaoke', 'roller skating', 'trash TV', 'thrifting', 'board games'],
  },
  {
    id: 'bookworm',
    emoji: '📚',
    label: 'The bookworm',
    blurb: 'Curious, thoughtful and a little nerdy. Great conversations.',
    traits: { curiosity: 9, depth: 8, fiery: 2, playful: 4, talkative: 7, casual: 4, confidence: 4 },
    humour: 'dry',
    talk: 'thoughtful',
    summary: 'She is thoughtful and endlessly curious, happiest with a good book, a hot drink and a deep conversation.',
    personality: ['Falls down research rabbit holes.', 'Notices small details others miss.', 'Can be awkward with strangers, then talks for hours.'],
    jobs: ['librarian', 'book editor', 'history PhD student', 'museum archivist', 'science journalist', 'high-school literature teacher'],
    hobbies: ['reading', 'crosswords', 'chess', 'museums', 'learning languages', 'tea tasting'],
  },
  {
    id: 'firecracker',
    emoji: '🔥',
    label: 'The firecracker',
    blurb: 'Bold, passionate and outspoken. Life is never dull.',
    traits: { fiery: 9, blunt: 8, confidence: 9, playful: 7, talkative: 7, patience: 3 },
    humour: 'witty',
    talk: 'texting',
    summary: 'She is bold and passionate, says exactly what she thinks, and fights hard for the people she cares about.',
    personality: ['Big feelings, quick to flare and quick to forgive.', 'Loyal like a bulldog.', 'Hates injustice and bad drivers.'],
    jobs: ['line chef', 'trial lawyer', 'startup founder', 'firefighter', 'sports journalist', 'event producer'],
    hobbies: ['kickboxing', 'salsa dancing', 'hot sauce collecting', 'motorbikes', 'live music', 'debating anyone about anything'],
  },
  {
    id: 'adventurer',
    emoji: '🧭',
    label: 'The adventurer',
    blurb: 'Optimistic and spontaneous. Always planning the next trip.',
    traits: { optimism: 9, curiosity: 8, initiative: 7, playful: 7, confidence: 7, patience: 4 },
    humour: 'silly',
    talk: 'texting',
    summary: 'She is restless in the best way, always planning the next trip, and turns ordinary days into small adventures.',
    personality: ['Says yes first and figures it out later.', 'Gets antsy if she stays home too long.', 'Collects stories more than things.'],
    jobs: ['travel photographer', 'park ranger', 'flight attendant', 'outdoor guide', 'field biologist', 'travel blogger'],
    hobbies: ['hiking', 'surfing', 'camping', 'rock climbing', 'road trips', 'trying street food'],
  },
  {
    id: 'dreamer',
    emoji: '🎨',
    label: 'The dreamer',
    blurb: 'Creative, sensitive and a little whimsical.',
    traits: { depth: 9, blunt: 2, warmth: 7, optimism: 6, casual: 6, confidence: 4 },
    humour: 'witty',
    talk: 'thoughtful',
    summary: 'She is creative and sensitive, sees beauty in odd little things, and always has a project going.',
    personality: ['Head in the clouds, heart on her sleeve.', 'Loses track of time when she creates.', 'Notices moods before words.'],
    jobs: ['illustrator', 'indie musician', 'tattoo artist', 'set designer', 'pottery teacher', 'animator'],
    hobbies: ['painting', 'songwriting', 'film photography', 'journaling', 'stargazing', 'pottery'],
  },
  {
    id: 'cool',
    emoji: '🌙',
    label: 'The cool one',
    blurb: 'Calm, low-key and quietly confident. Few words, real meaning.',
    traits: { fiery: 1, talkative: 2, warmth: 4, affection: 3, confidence: 8, casual: 8, curiosity: 4 },
    humour: 'dry',
    talk: 'brief',
    summary: 'She is calm and low-key, hard to impress and easy to be around; when she says something nice she means it.',
    personality: ['Unbothered by drama.', 'Shows care in small, practical ways.', 'Has strong taste in music and keeps it to herself.'],
    jobs: ['sound engineer', 'software developer', 'DJ', 'photographer', 'bike mechanic', 'night-shift radio producer'],
    hobbies: ['vinyl collecting', 'night drives', 'skateboarding', 'synths', 'film noir', 'cooking late at night'],
  },
  {
    id: 'cheerleader',
    emoji: '☀️',
    label: 'The cheerleader',
    blurb: 'Upbeat, encouraging and full of energy. Your biggest fan.',
    traits: { optimism: 10, warmth: 8, talkative: 8, playful: 7, initiative: 7, affection: 7 },
    humour: 'silly',
    talk: 'texting',
    summary: "She is sunny and energetic, celebrates every little win, and believes in you more than you do.",
    personality: ['Turns everything into a pep talk.', 'Over-uses exclamation marks and knows it.', 'Secretly needs reassurance too.'],
    jobs: ['fitness coach', 'event planner', 'primary-school teacher', 'dance instructor', 'social media manager', 'physical therapist'],
    hobbies: ['dance classes', 'running', 'brunch with friends', 'DIY crafts', 'musicals', 'yoga'],
  },
];
export const archetype = (id: string | undefined) => ARCHETYPES.find((a) => a.id === id);

// ---------- pools for unique details ----------
const NAMES: Record<Pronouns, string[]> = {
  she: ['Mia', 'Ava', 'Luna', 'Nora', 'Isla', 'Zoe', 'Elena', 'Priya', 'Hana', 'Maya', 'Chloe', 'Leah', 'Iris', 'Rosa', 'Jade', 'Tessa', 'Naomi', 'Sofia', 'Ivy', 'Amara', 'Kira', 'Lena', 'Talia', 'Ruby'],
  he: ['Leo', 'Max', 'Noah', 'Ethan', 'Kai', 'Theo', 'Mateo', 'Ravi', 'Jonah', 'Felix', 'Owen', 'Adrian', 'Eli', 'Marco', 'Sam', 'Jude', 'Rafael', 'Hugo'],
  they: ['Sky', 'River', 'Quinn', 'Rowan', 'Avery', 'Sage', 'Ari', 'Remy', 'Jordan', 'Phoenix', 'Ash', 'Robin'],
};
const PEOPLE = ['Priya', 'Sam', 'Jules', 'Marcus', 'Dana', 'Leo', 'Bea', 'Tomás', 'Aisha', 'Noor', 'Rosie', 'Kenji', 'Ana', 'Eli', 'Grace', 'Omar', 'Tess', 'Ben', 'Lucía', 'Finn', 'Maya', 'Hugo', 'Zara', 'Nate'];
const HOMETOWNS = [
  'grew up in Savannah, Georgia', 'grew up in a small town outside Portland, Maine', 'grew up in Austin, Texas', 'grew up in Duluth, Minnesota', 'grew up in San Diego by the beach', 'grew up in Chicago\'s Pilsen neighbourhood',
  'grew up in Asheville, North Carolina', 'grew up on a farm in Iowa', 'grew up in Brooklyn', 'grew up in Tucson, Arizona', 'grew up in New Orleans', 'grew up in Boise, Idaho', 'grew up in Halifax, Nova Scotia', 'grew up in Manchester, England',
  'grew up in Dublin', 'grew up in Melbourne', 'grew up in Lisbon and moved here at 19', 'grew up in Seoul and moved here for college', 'grew up in Mexico City', 'grew up in a fishing town in Oregon', 'grew up in Santa Fe', 'grew up in Pittsburgh',
  'grew up in Burlington, Vermont', 'grew up in Honolulu', 'grew up in Denver', 'grew up in Nashville', 'grew up all over as an army kid', 'grew up in a tiny town in Wisconsin', 'grew up in Toronto', 'grew up in Cape Town and moved here at 22',
];
const FAMILY = [
  'close with {poss} mom, who calls every Sunday; a younger brother, {p1}', 'an older sister, {p1}, who is {poss} best friend and worst critic', 'raised by {poss} grandma, who taught {obj} to cook', 'parents run a hardware store; two noisy younger siblings',
  'only child; very close with {poss} dad, who sends {obj} terrible puns', 'a twin, {p1}, who is {poss} total opposite', 'a big loud family; {subj} is the middle of five', 'mom is a nurse, dad a mechanic; one older brother, {p1}', 'a stepdad {subj} adores and a little half-sister, {p1}',
  'parents divorced when {subj} was small; close with both', 'an aunt, {p1}, who is basically {poss} second mom',
];
const FRIENDS = [
  'best friend {p1}, who drags {obj} to every concert', 'best friend {p1} since second grade; they still have weekly calls', 'a tight group chat with {p1} and {p2}', 'roommate {p1}, a night-shift nurse', 'best friend {p1}, a chef who feeds {obj} experiments',
  'old college friends {p1} and {p2}', 'a running buddy, {p1}', 'best friend {p1}, who is always in some kind of drama', 'a neighbour, {p1}, who waters {poss} plants and gossips',
];
const LIKES = ['rainy mornings', 'old movies', 'spicy food', 'thunderstorms', 'farmers markets', 'handwritten letters', 'the smell of new books', 'late-night diners', 'sunsets on the water', 'road-trip playlists', 'warm socks', 'second-hand bookshops', 'live jazz', 'long baths', 'street tacos', 'fresh bread', 'cats who ignore her', 'the first snow', 'museums on quiet weekdays', 'mango sticky rice'];
const DISLIKES = ['loud chewing', 'being late', 'cilantro', 'small talk about the weather', 'slow walkers', 'cold coffee', 'reply-all emails', 'horror movies', 'mornings before coffee', 'people who are rude to waiters', 'wet socks', 'group projects', 'spoilers', 'flaky plans', 'mint chocolate'];
const QUIRKS = ['names all her plants', 'hums when she concentrates', 'collects weird mugs', 'can\'t sleep without a fan on', 'talks to animals in a special voice', 'reads the last page of a book first', 'organizes snacks by colour', 'always has a hair tie on her wrist', 'narrates her cooking like a TV show', 'keeps a list of best sandwiches ever eaten', 'can recite every line of one movie', 'laughs at her own jokes before the punchline', 'saves every ticket stub', 'gives nicknames to cars', 'taps rhythms on tables', 'sends voice memos instead of texts when excited', 'sleeps with three pillows', 'counts stairs without meaning to'];
const HABITS = ['up at 6 for a run', 'tea before bed', 'Sunday morning pancakes', 'journals every night', 'a long walk after dinner', 'cold showers (and complains about them)', 'calls her mom on the drive home', 'meal-preps on Sundays', 'reads on the bus', 'stretches while the coffee brews', 'Friday night takeout', 'stays up too late on weeknights', 'plays piano for ten minutes a day', 'makes the bed the second she gets up'];
const FAVOURITES = ['Studio Ghibli films', 'mango', 'the colour green', 'Fleetwood Mac', 'peonies', 'pistachio ice cream', 'autumn', 'the Lord of the Rings books', 'golden retrievers', 'the colour mustard yellow', 'Taylor Swift\'s folklore', 'ramen', 'sunflowers', 'jazz piano', 'Mario Kart', 'lemon cake', 'vintage denim', 'the ocean', 'Pride and Prejudice', 'iced oat lattes'];
const PHRASES = ['"okay but hear me out"', '"love that for you"', '"no because—"', '"I\'m obsessed"', '"bold of you"', '"tell me everything"', '"say less"', '"we love a plan"', '"that\'s so valid"', '"oh absolutely not"', '"hmm, suspicious"', '"you\'re doing amazing, sweetie"', '"in this economy?"', '"chef\'s kiss"', '"not me crying"', '"same, honestly"'];
const OPINIONS = ['breakfast for dinner is elite', 'cats are better than dogs (fight me)', 'pineapple belongs on pizza', 'the book is always better', 'socks with sandals are fine, actually', 'winter is the best season', 'texting back fast is not desperate', 'cereal is a soup', 'the middle seat gets both armrests', 'nobody needs more than three throw pillows', 'audiobooks count as reading', 'mint ice cream tastes like toothpaste', 'every city needs more benches', 'the sequel is usually better', 'baths are better than showers', 'ketchup on eggs is a crime'];
const LANGUAGES = ['English', 'English', 'English', 'English and some Spanish from her grandma', 'English and decent French', 'English and Portuguese (her mom is Brazilian)', 'English, and she is learning Japanese badly', 'English and Korean', 'English and a little Italian', 'English and Hindi', 'English and German from a year abroad'];

/** {subj}/{obj}/{poss}/{p1}/{p2} templates filled in for her pronouns, with fresh names. */
function fillTemplate(s: string, pronouns: Pronouns, rng: Rng): string {
  const f = forms(pronouns);
  const [p1, p2] = pickSome(rng, PEOPLE, 2);
  return s.replaceAll('{subj}', f.subj).replaceAll('{obj}', f.obj).replaceAll('{poss}', f.poss).replaceAll('{p1}', p1).replaceAll('{p2}', p2);
}

const him = (p: Persona, s: string) => personalize(s, { name: p.name, pronouns: p.pronouns ?? 'she' });

function detailFor(field: string, p: Persona, rng: Rng): string {
  const a = archetype(p.archetype);
  const pr = p.pronouns ?? 'she';
  switch (field) {
    case 'job': return pick(rng, a?.jobs ?? ARCHETYPES.flatMap((x) => x.jobs));
    case 'hometown': return pick(rng, HOMETOWNS);
    case 'family': return fillTemplate(pick(rng, FAMILY), pr, rng);
    case 'friends': return fillTemplate(pick(rng, FRIENDS), pr, rng);
    case 'hobbies': return pickSome(rng, a ? [...a.hobbies, ...pickSome(rng, ARCHETYPES.flatMap((x) => x.hobbies), 4)] : ARCHETYPES.flatMap((x) => x.hobbies), 3).join(', ');
    case 'likes': return him(p, pickSome(rng, LIKES, 3).join(', '));
    case 'dislikes': return pickSome(rng, DISLIKES, 2).join(', ');
    case 'quirks': return him(p, pickSome(rng, QUIRKS, 2).join('; '));
    case 'habits': return him(p, pickSome(rng, HABITS, 2).join('; '));
    case 'favourites': return pickSome(rng, FAVOURITES, 3).join(', ');
    case 'phrases': return pickSome(rng, PHRASES, 2).join(', ');
    case 'languages': return him(p, pick(rng, LANGUAGES));
    case 'opinions': return pickSome(rng, OPINIONS, 2).join('; ');
    default: return '';
  }
}

/** Fills only the empty life fields from the pools (instant, no model). */
export function fillLifeQuick(p: Persona, rng: Rng = secureRng): Persona {
  const life: Life = { ...p.life };
  for (const id of LIFE_IDS) if (!life[id]?.trim()) life[id] = detailFor(id, p, rng);
  return validatePersona({ ...p, life });
}

/** Adds distinct details and nudges the dials so two companions from one starting point never match. */
export function makeUnique(p: Persona, rng: Rng = secureRng): Persona {
  const filled = fillLifeQuick(p, rng);
  const life: Life = { ...filled.life };
  const add = (field: string, extra: string) => {
    const cur = life[field] ?? '';
    if (!cur.includes(extra) && cur.length + extra.length < 280) life[field] = cur ? `${cur}; ${extra}` : extra;
  };
  // An extra detail that doesn't overlap what's there (no second favourite colour).
  const words = (x: string) => new Set(x.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const fresh = (field: string, pool: string[]) => {
    const have = words(life[field] ?? '');
    const ok = pool.filter((c) => ![...words(c)].some((w) => have.has(w)));
    return pick(rng, ok.length ? ok : pool);
  };
  add('quirks', him(p, fresh('quirks', QUIRKS)));
  add('favourites', fresh('favourites', FAVOURITES));
  add('opinions', fresh('opinions', OPINIONS));
  const traits: Traits = {};
  // Phase 51: the work dials are her work style, set on purpose: one of a kind leaves them alone.
  const personalIds = TRAIT_IDS.filter((id) => !WORK_IDS.includes(id));
  const bigNudges = new Set(pickSome(rng, personalIds, 3));
  for (const id of personalIds) {
    const base = p.traits?.[id] ?? TRAIT_MID;
    const step = bigNudges.has(id) ? (rng() < 0.5 ? -2 : 2) : Math.floor(rng() * 3) - 1;
    traits[id] = clampTrait(base + step)!;
  }
  for (const id of WORK_IDS) if (p.traits?.[id] !== undefined) traits[id] = p.traits[id];
  return validatePersona({ ...filled, life, traits });
}

const COMMON_SPEECH = ["Uses {owner}'s name now and then, not in every message.", "No assistant clichés: never says 'As an AI', 'How can I assist you today', or 'I hope this helps'."];
const COMMON_PERSONALITY = ['Has her own opinions, moods and preferences, and they stay consistent.'];

function summaryFor(p: Persona, owner: string, a?: Archetype): string {
  const rel = RELATIONSHIPS[p.relationship ?? 'friend'] ?? RELATIONSHIPS.friend;
  const note = p.relationshipNote?.trim() || 'one that is hard to put a label on.';
  return him(p, `${rel.summary.replaceAll('{owner}', owner).replaceAll('{note}', note)}${a ? ` ${a.summary}` : ''}`).slice(0, 1500);
}

/** Starts her from an archetype: dials, humour, how she talks, personality lines and summary. Keeps name, age, look and life. */
export function applyArchetype(p: Persona, id: string, owner: string): Persona {
  const a = archetype(id);
  if (!a) throw new Error('Unknown starting point');
  const talk = TALK[a.talk] ?? TALK.texting;
  return validatePersona({
    ...p,
    archetype: a.id,
    traits: { ...a.traits },
    humour: a.humour,
    talk: a.talk,
    summary: summaryFor(p, owner, a),
    personality: [...a.personality, ...COMMON_PERSONALITY].map((x) => him(p, x)),
    speech: [...talk.speech, ...COMMON_SPEECH].map((x) => him(p, x.replaceAll('{owner}', owner))),
  });
}

/** How she talks (texting / thoughtful / brief): replaces the speech lines. */
export function applyTalk(p: Persona, id: string, owner: string): Persona {
  const talk = TALK[id];
  if (!talk) throw new Error('Unknown way of talking');
  return validatePersona({ ...p, talk: id, speech: [...talk.speech, ...COMMON_SPEECH].map((x) => him(p, x.replaceAll('{owner}', owner))) });
}

/** The relationship (friend, partner, assistant, coach): rewrites the summary around it. */
export function applyRelationship(p: Persona, id: string, owner: string): Persona {
  if (!RELATIONSHIPS[id]) throw new Error('Unknown relationship');
  const q = { ...p, relationship: id };
  return validatePersona({ ...q, summary: summaryFor(q, owner, archetype(p.archetype)) });
}

/** A whole character at random: a name (unless given), age, starting point, relationship kept, unique details. */
export function surprise(base: { name?: string; pronouns?: Pronouns; relationship?: string; appearance?: string }, owner: string, rng: Rng = secureRng): Persona {
  const pronouns = base.pronouns ?? 'she';
  const name = base.name?.trim() || pick(rng, NAMES[pronouns]);
  const start: Persona = validatePersona({
    name,
    pronouns,
    age: 22 + Math.floor(rng() * 20),
    summary: 'x',
    background: [personalize('Has a life of her own: work, friends and opinions.', { name, pronouns })],
    personality: [],
    speech: [],
    boundaries: [],
    relationship: base.relationship && RELATIONSHIPS[base.relationship] ? base.relationship : 'friend',
    ...(base.appearance?.trim() ? { appearance: base.appearance.trim() } : {}),
  });
  const a = pick(rng, ARCHETYPES);
  const shaped = applyArchetype(start, a.id, owner);
  const humours = Object.keys(HUMOURS).filter((h) => h !== 'own');
  return makeUnique({ ...shaped, humour: rng() < 0.7 ? shaped.humour : pick(rng, humours) }, rng);
}

/** A short description of the sheet for prompts (who she is, dials in words, life). */
export function sheetText(p: Persona): string {
  const dials = TRAIT_IDS.filter((id) => p.traits?.[id] !== undefined).map((id) => `${traitDef(id)!.label}: ${traitWord(traitDef(id)!, p.traits![id]!)}`);
  return [
    `${p.name}, ${p.age}. ${p.summary}`,
    p.personality.length ? `Personality: ${p.personality.join(' ')}` : '',
    dials.length ? `Dials: ${dials.join('; ')}` : '',
    p.humour && HUMOURS[p.humour]?.line ? `Humour: ${HUMOURS[p.humour].label}` : '',
    p.speech.length ? `Talks: ${p.speech.join(' ')}` : '',
    ...LIFE_FIELDS.filter((f) => p.life?.[f.id]).map((f) => `${f.label}: ${p.life![f.id]}`),
  ]
    .filter(Boolean)
    .join('\n');
}

const defaultConv = () => ({ providerId: null, model: null, mode: 'chat', private: false }) as unknown as Conversation;

async function ask(app: AppContext, purpose: 'turn' | 'background' | 'writing', system: string | undefined, user: string, maxTokens: number, temperature = 0.8): Promise<string> {
  const { provider, model } = resolveFor(app, defaultConv(), purpose);
  let out = '';
  const messages = [...(system ? [{ role: 'system' as const, content: system }] : []), { role: 'user' as const, content: user }];
  for await (const ev of provider.stream({ model, messages, temperature, maxTokens, reasoning: 'none', signal: AbortSignal.timeout(90_000) })) {
    if (ev.type === 'text') out += ev.text;
    if (out.length > maxTokens * 8) break;
  }
  return out.trim();
}

/** "Fill in the rest for me": the background model writes the empty life fields to fit her sheet; falls back to the pools. */
export async function fillLife(app: AppContext, p: Persona): Promise<{ persona: Persona; written: boolean }> {
  const empty = LIFE_FIELDS.filter((f) => !p.life?.[f.id]?.trim());
  if (!empty.length) return { persona: p, written: false };
  const f = forms(p.pronouns ?? 'she');
  const prompt = `Here is a character sheet:\n${sheetText(p)}\n\nFill in these details of ${f.poss} life so they fit everything above (specific, believable, ordinary; an adult; names for people; nothing about being an AI; no em dashes). Each value one short line, under 200 characters.\nReturn ONLY JSON with exactly these keys: {${empty.map((x) => `"${x.id}": "${x.label}"`).join(', ')}}`;
  try {
    const text = await ask(app, 'writing', undefined, prompt, 700);
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, unknown>;
    const got = cleanLife(Object.fromEntries(empty.map((x) => [x.id, String(json[x.id] ?? '').slice(0, 300)])));
    const merged = fillLifeQuick(validatePersona({ ...p, life: { ...got, ...p.life } }));
    return { persona: merged, written: Boolean(got && Object.keys(got).length) };
  } catch {
    return { persona: fillLifeQuick(p), written: false };
  }
}

// ---------- try before saving ----------
export interface Scenario {
  id: string;
  label: string;
  text: string;
  /** Which page's "Try it" uses it: personality (Phase 34), relationship (Phase 35) or work (Phase 51). */
  set: 'personality' | 'bond' | 'work';
  /** Phase 51: asked as if the owner were focused (short commands). */
  focused?: boolean;
  /** Shown only for romantic relationships. */
  romantic?: boolean;
}
export const SCENARIOS: Scenario[] = [
  { id: 'greeting', label: 'Saying hi', text: 'Hey! How was your day?', set: 'personality' },
  { id: 'bad-day', label: 'A bad day', text: 'Ugh. Today was awful. My boss criticised my work in front of everyone.', set: 'personality' },
  { id: 'disagree', label: 'A disagreement', text: "I'm skipping my friend's birthday dinner tonight. I just don't feel like going, it's fine.", set: 'personality' },
  { id: 'flirt', label: 'Flirting', text: 'You know, I really like talking to you.', set: 'personality', romantic: true },
  { id: 'away', label: 'After two days away', text: 'Hey. Sorry, I went quiet for a couple of days.', set: 'bond' },
  { id: 'someone-else', label: 'Someone else', text: 'I had such a fun night out. There was this really funny woman at the bar, we talked for hours.', set: 'bond' },
  { id: 'fight', label: 'A fight', text: 'Honestly, what you said earlier was out of line, and it annoyed me.', set: 'bond' },
  { id: 'sweet', label: 'A sweet moment', text: "I've been thinking about you all day.", set: 'bond', romantic: true },
  { id: 'tests-pass', label: 'Tests pass', text: 'Ran it again. All 48 tests pass now, including the flaky one.', set: 'work' },
  { id: 'silly-bug', label: 'A silly bug', text: "Found it. The whole thing broke because I typed 'recieve' instead of 'receive'.", set: 'work' },
  { id: 'focused', label: "When you're focused", text: 'now run the linter', set: 'work', focused: true },
];

export function scenariosFor(p: Persona, set: 'personality' | 'bond' | 'work' = 'personality'): Scenario[] {
  return SCENARIOS.filter((s) => s.set === set && (!s.romantic || isRomantic(p.relationship, p.intimacy)));
}

/** Sample replies to a few everyday moments, with the new sheet next to the current one. */
export async function trySamples(app: AppContext, before: Persona, after: Persona, only?: string[], set: 'personality' | 'bond' | 'work' = 'personality'): Promise<{ id: string; label: string; text: string; before?: string; after: string }[]> {
  const s = app.settings.get();
  const ctx = { now: app.now(), timeZone: s.timeZone, ownerName: s.ownerName, memory: false, safetyNotes: adultModeOn(s) ? [] : [ADULT_OFF_NOTE], ...bondContext(app, app.inner?.get().closeness) };
  const same = JSON.stringify(before) === JSON.stringify(after);
  const scen = (only?.length ? SCENARIOS.filter((x) => only.includes(x.id)) : scenariosFor(after, set));
  // Phase 51: work samples are asked in a coding conversation (the work dials only apply there).
  const one = (p: Persona, text: string, x?: Scenario) =>
    ask(app, 'turn', buildSystemPrompt(p, { ...ctx, ...(x?.set === 'work' ? { coding: true, focused: x.focused === true } : {}) }), text, 260).catch((err: Error) => `(couldn't get a reply: ${err.message})`);
  return Promise.all(
    scen.map(async (x) => {
      const [b, a] = await Promise.all([same ? Promise.resolve(undefined) : one(before, x.text, x), one(after, x.text, x)]);
      return { id: x.id, label: x.label, text: x.text, ...(b !== undefined ? { before: b } : {}), after: a };
    }),
  );
}

// ---------- saving ----------
/** Saves her sheet; renames her in memories; the "Starts conversations" dial sets how often she may text first. */
export function savePersona(app: AppContext, p: Persona): { persona: Persona; renamedMemories: number } {
  const prev = app.persona;
  writeFileAtomic(join(app.dataDir, 'persona.json'), JSON.stringify(p, null, 2) + '\n', 0o600);
  const renamed = prev.name !== p.name ? (app.memory?.renameCompanion(prev.name, p.name) ?? 0) : 0;
  app.persona = p;
  const v = p.traits?.initiative;
  if (v !== undefined && v !== prev.traits?.initiative) {
    app.settings.update({ proactive: { ...app.settings.get().proactive, ...initiativeToProactive(v) } });
  }
  return { persona: p, renamedMemories: renamed };
}

// ---------- tune by talking ----------
const DIAL_LIST = TRAIT_IDS.map((id) => `${id} (${traitDef(id)!.low} ↔ ${traitDef(id)!.high})`).join(', ');

/** Works out the change a tune call asks for (also used for the approval card). */
export function tuneChange(p: Persona, args: Record<string, unknown>): { trait?: TraitId; from?: number; to?: number; humour?: string; text: string } {
  if (args.humour !== undefined && args.humour !== '') {
    const h = String(args.humour);
    if (!HUMOURS[h]) throw new ToolError(`Unknown humour style "${h}". Use one of: ${Object.keys(HUMOURS).join(', ')}.`);
    return { humour: h, text: `humour style: ${HUMOURS[p.humour ?? 'own']?.label ?? 'her own mix'} → ${HUMOURS[h].label}` };
  }
  const id = String(args.dial ?? '') as TraitId;
  const def = traitDef(id);
  if (!def) throw new ToolError(`Unknown dial "${id}". Dials: ${DIAL_LIST}.`);
  const from = p.traits?.[id] ?? TRAIT_MID;
  const dir = String(args.direction ?? 'more');
  const steps = Math.min(5, Math.max(1, Math.round(Number(args.steps ?? 2)) || 2));
  const to = dir === 'set' ? (clampTrait(args.value) ?? from) : clampTrait(from + (dir === 'less' ? -steps : steps))!;
  if (to === from) throw new ToolError(`${def.label} is already at ${from} of 10 (${traitWord(def, from)}); it can't go further that way.`);
  return { trait: id, from, to, text: `${def.label}: ${from} → ${to} of 10 (${traitWord(def, to)})` };
}

export function createTuneTool(app: () => AppContext): Tool {
  return {
    defaultPermission: 'ask',
    source: 'built-in',
    spec: {
      name: 'tune_personality',
      description: `Change one of your own personality dials when the person you talk with asks you to act differently ("be a bit more sarcastic", "less clingy", "don't tease me so much", "be more direct"). They confirm the change before it happens. Dials (0-10): ${DIAL_LIST}. Pick the dial that matches the request best (clingy → affection or initiative; sarcastic → teasing or humour "sarcastic"). Use humour to change the humour style instead (${Object.keys(HUMOURS).join(', ')}). Don't use it on your own initiative.`,
      parameters: {
        type: 'object',
        properties: {
          dial: { type: 'string', enum: TRAIT_IDS },
          direction: { type: 'string', enum: ['more', 'less', 'set'] },
          steps: { type: 'number', description: '1 = a little, 2 = noticeably (default), 3+ = a lot' },
          value: { type: 'number', description: 'For direction "set": 0-10' },
          humour: { type: 'string', enum: Object.keys(HUMOURS) },
          reason: { type: 'string', description: 'Their words, briefly' },
        },
      },
    },
    summarize(args) {
      try {
        return `Change her personality: ${tuneChange(app().persona, args).text}`;
      } catch (err) {
        return `Change her personality (${(err as Error).message})`;
      }
    },
    async run(args) {
      const a = app();
      const c = tuneChange(a.persona, args);
      const next = validatePersona(c.humour ? { ...a.persona, humour: c.humour } : { ...a.persona, traits: { ...a.persona.traits, [c.trait!]: c.to } });
      savePersona(a, next);
      return `Done: ${c.text}. It's saved and shows in Settings → Name and personality. From your next message on, act like this. Mention the change briefly and in character.`;
    },
  };
}
