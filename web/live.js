// Phase 11: live voice calls (Grok or OpenAI realtime voice, through Sara's server).
// Microphone → 16-bit PCM at 24 kHz → server; her voice comes back the same way and plays without
// gaps. Talking over her stops her at once (the voice service notices, and so do we).
import { t } from './naming.js';

const RATE = 24000;
/** Mic audio is sent in 40 ms blocks. */
const BLOCK = (RATE * 40) / 1000;

export class LiveCall {
  /**
   * @param {{ conversationId: string, onEvent: (ev: object) => void }} opts
   *   onEvent gets the server's events (status, notice, you, caption, said, error, ended).
   */
  constructor({ conversationId, onEvent, ringId, video = false }) {
    this.conversationId = conversationId;
    /** Phase 69: a video call (the server adds the video note to her instructions). */
    this.video = video;
    /** Phase 69: mute (your microphone sends silence) and her sound on/off. */
    this.muted = false;
    /** Phase 26: answering a call from her. */
    this.ringId = ringId;
    this.onEvent = onEvent;
    this.ctx = null;
    this.ws = null;
    this.sources = new Set();
    this.playHead = 0;
    this.pending = new Int16Array(BLOCK);
    this.pendingLen = 0;
    this.floor = 0.006;
    this.loudMs = 0;
    this.active = false;
    /** Analyser on her voice, for the animated portrait. */
    this.analyser = null;
  }

  /** True while her voice is playing (used to tell her echo from the owner talking). */
  get speaking() {
    return this.ctx ? this.playHead > this.ctx.currentTime + 0.05 : false;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    this.ctx = new AudioContext({ sampleRate: RATE });
    await this.ctx.audioWorklet.addModule('/recorder-worklet.js');
    this.out = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.out.connect(this.analyser);
    // Her volume sits after the analyser, so her lips keep moving with the sound off.
    this.vol = this.ctx.createGain();
    this.analyser.connect(this.vol);
    this.vol.connect(this.ctx.destination);
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'sara-recorder');
    this.node.port.onmessage = (e) => this.#mic(e.data);
    src.connect(this.node);

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = new URLSearchParams();
    if (this.ringId) q.set('ring', this.ringId);
    if (this.video) q.set('video', '1');
    const ws = (this.ws = new WebSocket(`${proto}://${location.host}/api/live/${encodeURIComponent(this.conversationId)}${q.size ? `?${q}` : ''}`));
    ws.binaryType = 'arraybuffer';
    this.active = true;
    ws.onmessage = (m) => {
      if (typeof m.data !== 'string') return this.#play(new Int16Array(m.data));
      const ev = JSON.parse(m.data);
      if (ev.type === 'interrupt') this.#silence();
      this.onEvent(ev);
      if (ev.type === 'ended') this.#cleanup();
    };
    ws.onclose = () => {
      if (this.active) this.onEvent({ type: 'ended', reason: 'The call was disconnected.' });
      this.#cleanup();
    };
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(t('Could not connect the call.'))), { once: true });
    });
  }

  /** Phase 69: a voice call switched to video: the server tells her (and lets camera pictures through). */
  setVideo(on) {
    if (!on || this.video) return;
    this.video = true;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'video' }));
  }

  /** Her voice on or off (the call goes on). */
  setSound(on) {
    if (this.vol) this.vol.gain.value = on ? 1 : 0;
    return on;
  }

  hangUp() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'hangup' }));
    this.#cleanup();
  }

  #cleanup() {
    if (!this.active) return;
    this.active = false;
    this.#silence();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node?.port && (this.node.port.onmessage = null);
    try {
      this.ws?.close();
    } catch {
      /* closed */
    }
    this.ctx?.close();
  }

  #mic(frame) {
    if (!this.active || this.ws?.readyState !== WebSocket.OPEN) return;
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const level = Math.sqrt(sum / frame.length);
    const ms = (frame.length / RATE) * 1000;
    // While she talks, the mic can still hear her through the speakers despite echo cancellation.
    // Send silence then, unless the owner is clearly talking over her (louder, for a moment).
    let open = !this.muted;
    if (this.muted) this.loudMs = 0;
    else if (this.speaking) {
      this.loudMs = level > Math.max(0.035, this.floor * 6) ? this.loudMs + ms : Math.max(0, this.loudMs - ms);
      open = this.loudMs >= 160;
    } else {
      this.loudMs = 0;
      if (level < this.floor * 2) this.floor = this.floor * 0.995 + level * 0.005;
    }
    for (let i = 0; i < frame.length; i++) {
      const s = open ? Math.max(-1, Math.min(1, frame[i])) : 0;
      this.pending[this.pendingLen++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.pendingLen === BLOCK) {
        this.ws.send(this.pending.buffer.slice(0));
        this.pendingLen = 0;
      }
    }
  }

  #play(pcm) {
    if (!this.ctx || !pcm.length) return;
    const buf = this.ctx.createBuffer(1, pcm.length, RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    const at = Math.max(this.ctx.currentTime + 0.03, this.playHead);
    src.start(at);
    this.playHead = at + buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** Stop her voice right now (she was interrupted, or the call ended). */
  #silence() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* not started */
      }
    }
    this.sources.clear();
    this.playHead = this.ctx?.currentTime ?? 0;
  }
}
