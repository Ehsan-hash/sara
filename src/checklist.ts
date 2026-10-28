// Phase 23: "Getting started" on the Today page. A short list of the steps that make Sara
// useful, each ticked off by itself when it's done (nothing to mark by hand), each opening the
// place where it's done. The owner can hide the list.
import type { AppContext } from './chat.ts';
import { NOT_IMPORTED } from './store.ts';
import { DEFAULT_VOICE, VOICE_VAULT } from './voice.ts';

export interface ChecklistItem {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  /** Settings page (or view) that does it. */
  open: string;
}

export interface ChecklistInput {
  /** Signed-in device labels (e.g. "Sara app on iPhone"). */
  devices: string[];
  /** Browsers/phones that get notifications. */
  pushDevices: number;
  personaCustom: boolean;
}

/** M6: her voice counts as picked only when the chosen engine can really speak. */
export function voiceWorks(app: AppContext): boolean {
  const v = app.speech?.settings() ?? { ...DEFAULT_VOICE, ...app.settings.get().voice };
  if (!app.settings.get().voice || v.tts === 'off') return false;
  if (v.tts === 'local') return Boolean(app.voice?.voices().length);
  if (v.tts === 'xai') return app.speech?.hasXai() ?? Boolean(app.vault.get(VOICE_VAULT.xai));
  return Boolean(app.vault.get(v.tts === 'openai' ? VOICE_VAULT.openai : VOICE_VAULT.elevenlabs));
}

export function checklist(app: AppContext, input: ChecklistInput): { hidden: boolean; items: ChecklistItem[] } {
  const s = app.settings.get();
  const subs = app.subscriptions;
  const brain = Boolean(s.defaultProviderId && s.defaultModel) || Boolean(subs?.grokStatus().signedIn || subs?.claudeStatus().signedIn || subs?.chatgpt?.status().signedIn);
  const talked = Boolean(app.store.db.prepare(`SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.role = 'user' AND c.partner IS NULL AND ${NOT_IMPORTED} LIMIT 1`).get());
  const items: ChecklistItem[] = [
    { id: 'brain', label: 'Connect a brain', hint: 'The AI model she thinks with: on this computer, in the cloud, or your subscription.', done: brain, open: 'settings:models-default' },
    { id: 'talk', label: 'Say hello', hint: 'Just type: ask her anything, or tell her about your day.', done: talked, open: 'chat' },
    { id: 'yours', label: 'Make Sara your own', hint: 'Her name, personality and look.', done: input.personaCustom || Boolean(app.look?.custom), open: 'settings:her-character' },
    { id: 'phone', label: 'Put her on your phone', hint: 'Install the app or add her to your home screen, and get notifications.', done: input.pushDevices > 0 || input.devices.some((d) => /Sara app|iPhone|Android/i.test(d)), open: 'settings:co-phone' },
    { id: 'voice', label: 'Pick her voice', hint: 'For voice notes, read-aloud and calls.', done: voiceWorks(app), open: 'settings:her-voice' },
    { id: 'morning', label: 'Get a morning briefing', hint: 'Weather, your list and calendar, once a day.', done: Boolean(s.briefing?.enabled), open: 'settings:you-briefing' },
    { id: 'backup', label: 'Keep a copy somewhere else', hint: 'An encrypted backup off this server, in case the server is lost.', done: Boolean(s.offsite?.kind && s.offsite.kind !== 'off'), open: 'settings:dh-backups' },
  ];
  return { hidden: Boolean(s.checklistHidden), items };
}
