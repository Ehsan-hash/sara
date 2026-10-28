// Example chat bridge: the smallest shape of a bridge like src/bridges/telegram.ts or discord.ts,
// without any real chat service. A "transport" delivers incoming messages and sends replies; the
// bridge decides who is talking (owner or someone else), picks the right conversation, runs one
// turn and sends her reply back. See docs/EXTENDING.md → "Add a bridge".
//
// The rules every bridge must keep:
//  1. Owners are recognised by a stable user ID the owner typed in (or a link code), never by a
//     display name that anyone can copy.
//  2. Everyone else gets a PARTNER conversation (`partner` set on the conversation). runTurn then
//     gives her no tools, no memory and no adult content there, and her own AI disclosure for that
//     person. Owner and partner conversations for the same chat stay apart.
//  3. Never bypass runTurn: the safety layer (AI disclosure, honest answer when sincerely asked,
//     crisis resources, the minor-content block) lives inside it. A bridge only carries text.
//  4. One turn per conversation at a time (queue), and tool approvals only for owners.
import { runTurn, type AppContext, type ChatEvent } from '../../src/chat.ts';
import type { Conversation } from '../../src/store.ts';

export interface IncomingMessage {
  /** The chat or channel (a DM, a group) the message came from. */
  chatId: string;
  /** The sender's stable ID on that service. */
  userId: string;
  /** Display name, used only as a label for partner conversations. */
  userName: string;
  text: string;
}

export interface Transport {
  send(chatId: string, text: string): Promise<void>;
}

export interface LineBridgeOptions {
  /** Short channel name stored on conversations, e.g. "matrix" or "irc". */
  channel: string;
  /** User IDs that count as the owner. */
  ownerIds: string[];
  /** Answer people other than the owner at all? (Off by default, like the real bridges.) */
  allowOthers?: boolean;
}

export class LineBridge {
  readonly #app: AppContext;
  readonly #transport: Transport;
  readonly #opts: LineBridgeOptions;
  readonly #queues = new Map<string, Promise<void>>();

  constructor(app: AppContext, transport: Transport, opts: LineBridgeOptions) {
    this.#app = app;
    this.#transport = transport;
    this.#opts = opts;
  }

  isOwner(userId: string): boolean {
    return this.#opts.ownerIds.includes(userId);
  }

  /** The conversation for this chat: the owner's own one, or a partner one for anybody else. */
  conversationFor(msg: IncomingMessage): Conversation {
    const owner = this.isOwner(msg.userId);
    const key = owner ? msg.chatId : `${msg.chatId}:${msg.userId}`;
    const found = this.#app.store.findChannelConversation(this.#opts.channel, key, owner ? 'owner' : 'partner');
    if (found) return found;
    return this.#app.store.createConversation({
      title: owner ? `${this.#opts.channel}` : `${this.#opts.channel}: ${msg.userName}`,
      channel: this.#opts.channel,
      channelKey: key,
      partner: owner ? null : msg.userName || 'someone',
    });
  }

  /** Handle one incoming message. Resolves when her reply has been sent. */
  receive(msg: IncomingMessage): Promise<void> {
    if (!this.isOwner(msg.userId) && !this.#opts.allowOthers) return Promise.resolve();
    const conv = this.conversationFor(msg);
    // One turn per conversation at a time: chain onto whatever is running.
    const prev = this.#queues.get(conv.id) ?? Promise.resolve();
    const next = prev.then(() => this.#turn(conv, msg)).catch((err: Error) => console.warn(`${this.#opts.channel}: ${err.message}`));
    this.#queues.set(conv.id, next);
    return next;
  }

  async #turn(conv: Conversation, msg: IncomingMessage): Promise<void> {
    const owner = this.isOwner(msg.userId);
    const out: string[] = [];
    let reply = '';
    const flush = () => {
      if (reply.trim()) out.push(reply.trim());
      reply = '';
    };
    const onEvent = (ev: ChatEvent) => {
      if (ev.type === 'notice') out.push(`ℹ️ ${ev.text}`); // the AI disclosure arrives this way
      else if (ev.type === 'token') reply += ev.text;
      else if (ev.type === 'replace') reply = ev.text; // a safety check replaced her reply
      else if (ev.type === 'tool_call') flush();
      else if (ev.type === 'approval' && owner) out.push(`She wants to: ${ev.summary} (approve it in the app)`);
      else if (ev.type === 'error') {
        flush();
        out.push(owner ? `(Something went wrong: ${ev.message})` : "Sorry, I can't answer right now.");
      }
    };
    for await (const ev of runTurn(this.#app, conv.id, msg.text)) onEvent(ev);
    flush();
    for (const t of out) await this.#transport.send(msg.chatId, t);
  }
}
