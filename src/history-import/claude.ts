// Phase 51: reads a Claude data export (claude.ai → Settings → Privacy → Export data). The zip
// holds conversations.json (some exports: conversations.jsonl, one per line), users.json and
// projects.json. Each conversation is { uuid, name, created_at, updated_at, chat_messages: [
// { uuid, sender: 'human' | 'assistant', text, content: [{ type: 'text' | 'thinking' |
// 'tool_use' | 'tool_result' | …, text }], created_at, attachments: [{ file_name,
// extracted_content }], files: [{ file_name }] } ] }. Format as publicly described, e.g.
// https://github.com/davehaas/claudeExplorer (JSON schema summary) and
// https://github.com/Agent-Deployment-Co/argus/issues/95 (checked 2026-10).
import { clipText, type ImportedConversation, type ImportedMessage, isoTime, noSkips, type ParsedExport } from './types.ts';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const IMAGE = /\.(png|jpe?g|gif|webp|heic|bmp|svg)$/i;

export function looksLikeClaude(list: unknown): boolean {
  return Array.isArray(list) && list.some((c) => Array.isArray(obj(c)?.chat_messages));
}

export function parseClaude(lists: unknown[], now: Date): ParsedExport {
  const skipped = noSkips();
  const conversations: ImportedConversation[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const c = obj(raw);
      if (!c || !Array.isArray(c.chat_messages)) continue;
      const created = isoTime(c.created_at) ?? now.toISOString();
      const sourceId = String(c.uuid ?? c.id ?? '').trim() || `untitled-${created}-${String(c.name ?? '')}`;
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      const messages: ImportedMessage[] = [];
      let last = created;
      for (const rm of c.chat_messages) {
        const m = obj(rm);
        if (!m) continue;
        const sender = String(m.sender ?? m.role ?? '');
        const role = sender === 'human' || sender === 'user' ? 'user' : sender === 'assistant' ? 'assistant' : undefined;
        if (!role) {
          skipped.system++;
          continue;
        }
        const texts: string[] = [];
        let blocks = 0;
        if (Array.isArray(m.content)) {
          for (const b of m.content) {
            const bo = obj(b);
            if (!bo) continue;
            blocks++;
            const t = String(bo.type ?? '');
            if (t === 'text' && typeof bo.text === 'string') texts.push(bo.text);
            else if (t === 'thinking' || t === 'redacted_thinking') skipped.hidden++;
            else if (t === 'tool_use' || t === 'tool_result' || t === 'server_tool_use' || t.endsWith('_tool_result')) skipped.tool++;
            else if (t === 'image') skipped.images++;
          }
        }
        // Older exports have only `text`.
        if (!blocks && typeof m.text === 'string') texts.push(m.text);
        const attachments: string[] = [];
        for (const a of [...(Array.isArray(m.attachments) ? m.attachments : []), ...(Array.isArray(m.files) ? m.files : [])]) {
          const name = String(obj(a)?.file_name ?? obj(a)?.name ?? 'a file').slice(0, 120);
          if (attachments.includes(name)) continue;
          if (IMAGE.test(name)) skipped.images++;
          else skipped.attachments++;
          attachments.push(name);
        }
        const text = texts.join('\n').trim();
        if (!text && !attachments.length) {
          skipped.hidden++;
          continue;
        }
        let at = isoTime(m.created_at) ?? last;
        if (at < last) at = last;
        last = at;
        messages.push({ role, text: clipText(text || `[${attachments.join(', ')}]`), createdAt: at, ...(attachments.length ? { attachments } : {}) });
      }
      if (!messages.some((m) => m.role === 'user')) {
        skipped.emptyConversations++;
        continue;
      }
      conversations.push({
        sourceId,
        title: String(c.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || messages.find((m) => m.role === 'user')!.text.replace(/\s+/g, ' ').slice(0, 60),
        createdAt: created,
        updatedAt: isoTime(c.updated_at) ?? messages.at(-1)!.createdAt,
        messages,
      });
    }
  }
  return { source: 'claude', conversations, skipped };
}
