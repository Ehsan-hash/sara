// Phase 51: small, realistic ChatGPT and Claude data exports for tests and the real checks, built
// from the publicly documented shapes (see src/history-import/chatgpt.ts and claude.ts for the
// sources). A tiny zip writer (stored + deflate) keeps it dependency-free.
import { crc32, deflateRawSync } from 'node:zlib';

/** A zip archive of the given files (deflated, like the real exports). */
export function makeZip(files: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

type Turn = { user: string; assistant: string };

const TOPICS: { title: string; turns: Turn[] }[] = [
  { title: 'Sourdough starter help', turns: [{ user: 'My sourdough starter is called Gerald and he smells like nail polish. Is he dead?', assistant: 'Not dead! That acetone smell means Gerald is hungry. Feed him twice a day for a few days.' }, { user: 'ok, I feed him rye flour usually', assistant: 'Rye is great for starters. Keep it up.' }] },
  { title: 'Trip to Lisbon', turns: [{ user: 'I am planning a trip to Lisbon in May with my sister Ana.', assistant: 'Lovely! May is a great time. Want an itinerary for Alfama and Belém?' }, { user: 'Yes, and we both hate early mornings.', assistant: 'Then we start every day at 10. Here is a relaxed plan.' }] },
  { title: 'Python list reverse', turns: [{ user: 'How do I reverse a list in Python?', assistant: 'Use my_list[::-1] or my_list.reverse().' }] },
  { title: 'Bike commute', turns: [{ user: 'I ride my bike to work at the hospital every day, about 8 km.', assistant: 'Nice commute! Do you want tips for rainy days?' }] },
  { title: 'Gift for dad', turns: [{ user: "My dad's 70th birthday is on March 3rd. He loves birdwatching.", assistant: 'A good pair of binoculars or a bird feeder camera would be a great gift.' }] },
];

/** A ChatGPT export with `n` conversations (the first few are the topics above, the rest filler). */
export function chatgptConversations(n: number, start = Date.parse('2024-01-05T10:00:00Z')): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const title = i < TOPICS.length ? topic.title : `${topic.title} (${i})`;
    const t0 = (start + i * 86_400_000 * 2) / 1000;
    const mapping: Record<string, unknown> = {};
    const node = (id: string, parent: string | null, message: unknown) => {
      mapping[id] = { id, message, parent, children: [] as string[] };
      if (parent) (mapping[parent] as { children: string[] }).children.push(id);
    };
    const root = `root-${i}`;
    node(root, null, null);
    node(`sys-${i}`, root, { id: `sys-${i}`, author: { role: 'system', name: null, metadata: {} }, create_time: null, content: { content_type: 'text', parts: [''] }, status: 'finished_successfully', end_turn: true, weight: 0, metadata: { is_visually_hidden_from_conversation: true }, recipient: 'all' });
    let parent = `sys-${i}`;
    let t = t0;
    topic.turns.forEach((turn, k) => {
      const u = `u-${i}-${k}`;
      node(u, parent, { id: u, author: { role: 'user', name: null, metadata: {} }, create_time: (t += 30), content: { content_type: 'text', parts: [turn.user] }, status: 'finished_successfully', weight: 1, metadata: {}, recipient: 'all' });
      // A regenerated reply that was not kept (another branch).
      if (k === 0) node(`old-${i}`, u, { id: `old-${i}`, author: { role: 'assistant' }, create_time: (t += 5), content: { content_type: 'text', parts: ['(an older answer that was regenerated)'] }, recipient: 'all', metadata: {} });
      const a = `a-${i}-${k}`;
      node(a, u, { id: a, author: { role: 'assistant', name: null, metadata: {} }, create_time: (t += 20), content: { content_type: 'text', parts: [`${turn.assistant}\ue200cite\ue202turn0search1\ue201`] }, status: 'finished_successfully', end_turn: true, weight: 1, metadata: {}, recipient: 'all' });
      parent = a;
    });
    // Every fifth conversation: a picture, a web search (tool call + tool output) and a code run.
    if (i % 5 === 0) {
      const p = `pic-${i}`;
      node(p, parent, { id: p, author: { role: 'user' }, create_time: (t += 40), content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-abc', size_bytes: 1000, width: 10, height: 10 }, 'What bird is this?'] }, metadata: { attachments: [{ id: 'file-abc', name: 'bird.jpg' }] }, recipient: 'all' });
      const call = `call-${i}`;
      node(call, p, { id: call, author: { role: 'assistant' }, create_time: (t += 5), content: { content_type: 'code', language: 'unknown', text: 'search("small brown bird")' }, recipient: 'browser', metadata: {} });
      const tool = `tool-${i}`;
      node(tool, call, { id: tool, author: { role: 'tool', name: 'browser' }, create_time: (t += 5), content: { content_type: 'tether_browsing_display', result: '…' }, recipient: 'all', metadata: {} });
      const think = `think-${i}`;
      node(think, tool, { id: think, author: { role: 'assistant' }, create_time: (t += 2), content: { content_type: 'thoughts', thoughts: [{ summary: 'x', content: 'y' }] }, recipient: 'all', metadata: {} });
      const ans = `ans-${i}`;
      node(ans, think, { id: ans, author: { role: 'assistant' }, create_time: (t += 10), content: { content_type: 'text', parts: ['That looks like a house sparrow.'] }, recipient: 'all', metadata: {} });
      parent = ans;
    }
    out.push({ title, create_time: t0, update_time: t + 60, mapping, moderation_results: [], current_node: parent, plugin_ids: null, conversation_id: `chatgpt-conv-${i}`, conversation_template_id: null, gizmo_id: null, is_archived: false, safe_urls: [], default_model_slug: 'gpt-4o', id: `chatgpt-conv-${i}` });
  }
  return out;
}

/** The zip ChatGPT emails: conversations.json (or split files), chat.html, user.json, a picture. */
export function chatgptZip(n: number, opts: { split?: boolean } = {}): Buffer {
  const convs = chatgptConversations(n);
  const files: Record<string, string | Buffer> = { 'user.json': JSON.stringify({ id: 'user-x', email: 'someone@example.com' }), 'chat.html': '<html><body>Your chats</body></html>', 'file-abc-bird.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]) };
  if (opts.split) {
    files['conversations-000.json'] = JSON.stringify(convs.slice(0, Math.ceil(n / 2)));
    files['conversations-001.json'] = JSON.stringify(convs.slice(Math.ceil(n / 2)));
  } else files['conversations.json'] = JSON.stringify(convs);
  return makeZip(files);
}

/** A Claude export: conversations.json, users.json, projects.json. */
export function claudeConversations(): Record<string, unknown>[] {
  const msg = (uuid: string, sender: 'human' | 'assistant', text: string, at: string, extra: Record<string, unknown> = {}) => ({
    uuid,
    text,
    content: [{ start_timestamp: at, stop_timestamp: at, type: 'text', text, citations: [] }],
    sender,
    created_at: at,
    updated_at: at,
    attachments: [],
    files: [],
    ...extra,
  });
  return [
    {
      uuid: 'claude-conv-1',
      name: 'Marathon training plan',
      created_at: '2025-02-10T08:00:00.000000Z',
      updated_at: '2025-02-10T08:20:00.000000Z',
      account: { uuid: 'acct-1' },
      chat_messages: [
        msg('m1', 'human', "I'm training for the Chicago marathon in October. My cat Miso keeps sitting on my running shoes.", '2025-02-10T08:00:00.000000Z'),
        {
          ...msg('m2', 'assistant', 'A cat with opinions about your training! Here is an 16-week plan.', '2025-02-10T08:01:00.000000Z'),
          content: [
            { type: 'thinking', thinking: 'The user wants a plan…' },
            { type: 'text', text: 'A cat with opinions about your training! Here is an 16-week plan.' },
          ],
        },
        msg('m3', 'human', 'Can you make it 5 days a week? Here is my current log.', '2025-02-10T08:05:00.000000Z', { attachments: [{ file_name: 'running-log.csv', file_size: 120, file_type: 'text/csv', extracted_content: 'date,km\n' }] }),
        {
          ...msg('m4', 'assistant', 'Done: five days, long run on Sunday.', '2025-02-10T08:06:00.000000Z'),
          content: [
            { type: 'tool_use', name: 'analysis', input: {} },
            { type: 'tool_result', content: [] },
            { type: 'text', text: 'Done: five days, long run on Sunday.' },
          ],
        },
      ],
    },
    {
      uuid: 'claude-conv-2',
      name: 'Rust lifetimes',
      created_at: '2025-03-01T19:00:00.000000Z',
      updated_at: '2025-03-01T19:10:00.000000Z',
      account: { uuid: 'acct-1' },
      chat_messages: [msg('n1', 'human', 'Why does the borrow checker hate me?', '2025-03-01T19:00:00.000000Z'), msg('n2', 'assistant', 'It loves you, it just wants proof your references live long enough.', '2025-03-01T19:01:00.000000Z')],
    },
    { uuid: 'claude-conv-empty', name: '', created_at: '2025-03-02T10:00:00.000000Z', updated_at: '2025-03-02T10:00:00.000000Z', chat_messages: [] },
  ];
}

export function claudeZip(): Buffer {
  return makeZip({
    'conversations.json': JSON.stringify(claudeConversations()),
    'users.json': JSON.stringify([{ uuid: 'acct-1', full_name: 'Test Person', email_address: 'someone@example.com' }]),
    'projects.json': JSON.stringify([{ uuid: 'proj-1', name: 'Running', docs: [] }]),
  });
}
