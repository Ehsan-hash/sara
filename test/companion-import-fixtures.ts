// Phase 65: small, invented chat files in the shapes companion apps and tools write (see
// src/companion-import/readers.ts for where each shape is described). No real people: the owner is
// "Alex", the companion in the other app is "Mira".

/** Character.AI, the newer shape: turns with candidates (the account export / CAI Tools). */
export function caiTurns(): Record<string, unknown> {
  const turn = (id: string, human: boolean, text: string, at: string, extra: string[] = []) => ({
    turn_key: { chat_id: 'cai-chat-1', turn_id: id },
    create_time: at,
    author: human ? { author_id: '111', is_human: true, name: 'Alex' } : { author_id: '222', name: 'Mira' },
    candidates: [...extra.map((t, i) => ({ candidate_id: `${id}-alt${i}`, raw_content: t })), { candidate_id: `${id}-c`, raw_content: text }],
    primary_candidate_id: `${id}-c`,
  });
  return {
    chats: [
      {
        chat_id: 'cai-chat-1',
        character_name: 'Mira',
        turns: [
          turn('t1', false, '*waves from the lighthouse door* You came back!', '2024-03-05T20:00:00Z'),
          turn('t2', true, 'I did! My sister Ana is visiting next week, so I wanted to tell you.', '2024-03-05T20:01:00Z'),
          turn('t3', false, "Ana! The one who bakes? *grins* Tell me everything.", '2024-03-05T20:02:00Z', ['(a reply that was swiped away)']),
          turn('t4', true, 'Yes, she bakes. I work at the hospital on night shifts, so we only have weekends.', '2024-03-05T20:03:00Z'),
          turn('t5', false, 'Weekends with Ana then. I will keep the tea warm.', '2024-03-05T20:04:00Z'),
        ],
      },
    ],
  };
}

/** Character.AI, the older CAI Tools shape: histories of msgs. */
export function caiHistories(): Record<string, unknown> {
  return {
    info: { character: { name: 'Mira', external_id: 'char-1' } },
    histories: {
      histories: [
        {
          external_id: 'hist-1',
          created: '2023-11-02T18:00:00Z',
          msgs: [
            { src: { name: 'Mira', is_human: false }, text: 'Hello traveller.' },
            { src: { name: 'Alex', is_human: true }, text: 'Hi Mira, I just adopted a cat called Pixel.' },
            { src: { name: 'Mira', is_human: false }, text: 'Pixel! Perfect name.' },
          ],
        },
      ],
    },
  };
}

/** A SillyTavern chat (.jsonl): header line, then messages; one system line. */
export function sillyTavernJsonl(): string {
  const lines = [
    { user_name: 'Alex', character_name: 'Mira', create_date: '2024-6-1@19h00m00s', chat_metadata: { note_prompt: '' } },
    { name: 'Mira', is_user: false, is_system: false, send_date: 'June 1, 2024 7:00pm', mes: 'Evening, Alex. How was the climb?', extra: {} },
    { name: 'Alex', is_user: true, is_system: false, send_date: 'June 1, 2024 7:01pm', mes: 'Great, we did the north ridge. I love bouldering more than anything.', extra: {} },
    { name: 'System', is_user: false, is_system: true, send_date: 'June 1, 2024 7:01pm', mes: '[hidden note]', extra: {} },
    { name: 'Mira', is_user: false, is_system: false, send_date: 'June 1, 2024 7:02pm', mes: 'Chalk everywhere, I bet.', extra: {}, swipes: ['Chalk everywhere, I bet.', 'Another swipe'] },
  ];
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

/** A CSV like browser-extension exports (Replika and others): timestamp, sender, message. */
export function chatCsv(): string {
  return ['timestamp,sender,message', '2024-02-10 09:00,Mira,"Good morning, sleepy head"', '2024-02-10 09:01,Alex,"Morning! My dog Biscuit woke me up, ""as usual"""', '2024-02-11 21:00,Alex,"I have a job interview on Friday, a bit nervous"', '2024-02-11 21:01,Mira,"You will do great. Deep breaths."'].join('\r\n');
}

/** A generic JSON chat (what a Kindroid- or Nomi-style tool might save): { messages: [...] }. */
export function genericJson(): Record<string, unknown> {
  return {
    title: 'Evenings with Mira',
    messages: [
      { sender: 'Alex', text: 'I live in Porto now, moved last month.', timestamp: '2024-04-01T19:00:00Z' },
      { sender: 'Mira', text: 'Porto! The tiles, the river. Do you like it?', timestamp: '2024-04-01T19:00:30Z' },
      { sender: 'system', text: 'memory updated', timestamp: '2024-04-01T19:00:31Z' },
      { sender: 'Alex', text: 'I love it, the bridges are amazing.', timestamp: '2024-04-01T19:01:00Z' },
    ],
  };
}

/** A plain-text transcript: date lines, times, a continuation line, two days. */
export function transcriptTxt(): string {
  return [
    '--- 2024-05-03 ---',
    '[21:14] Alex: Long day. My boss Dana moved the deadline again.',
    '[21:15] Mira: Ugh, Dana again? Want to vent?',
    '[21:16] Alex: Later. I am making pasta first.',
    'Carbonara, the real one.',
    '',
    '--- 2024-05-04 ---',
    '[08:02] Mira: Morning! How was the carbonara?',
    '[08:05] Alex: Perfect. I cook every Saturday.',
  ].join('\n');
}

/** A Markdown transcript ("**Name:** text"). */
export function transcriptMd(): string {
  return ['# Chat with Mira', '', '**Alex:** I finally finished the marathon!', '', '**Mira:** You did it!! I am so proud of you.', '', '**Alex:** My knees are not proud.', '', '**Mira:** Ice, then cake.'].join('\n');
}
