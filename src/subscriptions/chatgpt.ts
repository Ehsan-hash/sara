// "Continue with ChatGPT": OpenAI's documented Sign in with ChatGPT flow for open-source apps
// (ChatGPT plan usage), https://developers.openai.com/siwc/token-sharing-open-source
//
// - First sign-in registers this Sara install as the owner's own agent (client_id
//   dynamic_agent_client + agent_name_hint "Sara" + a stable ext_agent_host_id); later sign-ins
//   reuse the issued client_id. No client secret, no partner key.
// - Authorization code + PKCE (S256) + state + OIDC nonce; the ID token is verified against
//   OpenAI's JWKS (RS256, iss, aud, exp, nonce) and the grant must include chatgpt.tokens.use.direct.
// - The redirect is a 127.0.0.1 loopback URI as required. Sara usually runs on another machine, so
//   after approving, the owner's browser lands on a page that can't load; the owner pastes that
//   address back into Sara (the code is single-use, bound to our PKCE verifier and state).
// - Tokens live only in the encrypted vault; refresh is serialized (rotating refresh tokens).
import { createHash, createPublicKey, type JsonWebKey as NodeJwk, randomBytes, randomUUID, verify } from 'node:crypto';
import type { Vault } from '../vault.ts';

export const CHATGPT_VAULT = 'sub:chatgpt';
export const CHATGPT_HOST_VAULT = 'sub:chatgpt:host';
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
export const USAGE_URL = 'https://chatgpt.com/settings/usage';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const RESOURCE = 'https://api.openai.com/v1';
const REDIRECT = 'http://127.0.0.1:1455/auth/callback';
const ATTEMPT_TTL_MS = 15 * 60_000;

export interface ChatGptCredentials {
  email: string | null;
  subject: string;
  clientId: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  savedAt: string;
}

interface Stored {
  /** Issued client id for this owner + workspace; kept after sign-out for the next sign-in. */
  clientId?: string;
  email?: string | null;
  creds?: ChatGptCredentials;
  /** "You're using your ChatGPT plan" was shown. */
  welcomed?: boolean;
}

interface Attempt {
  state: string;
  nonce: string;
  verifier: string;
  clientId: string;
  created: number;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
}

const b64u = (b: Buffer) => b.toString('base64url');

export class ChatGptAuth {
  readonly #vault: Vault;
  readonly #issuer: string;
  readonly #now: () => number;
  readonly #fetch: typeof fetch;
  readonly #attempts = new Map<string, Attempt>();
  #discovery: Discovery | undefined;
  #jwks: { keys: (JsonWebKey & { kid?: string })[] } | undefined;
  #refreshing: Promise<ChatGptCredentials> | undefined;

  constructor(vault: Vault, opts: { issuer?: string; now?: () => number; fetch?: typeof fetch } = {}) {
    this.#vault = vault;
    this.#issuer = opts.issuer ?? 'https://auth.openai.com';
    this.#now = opts.now ?? Date.now;
    this.#fetch = opts.fetch ?? fetch;
  }

  #read(): Stored {
    const raw = this.#vault.get(CHATGPT_VAULT);
    return raw ? (JSON.parse(raw) as Stored) : {};
  }

  #write(s: Stored): void {
    this.#vault.set(CHATGPT_VAULT, JSON.stringify(s));
  }

  /** Stable per-install host id (kept across sign-outs). */
  get hostId(): string {
    let id = this.#vault.get(CHATGPT_HOST_VAULT);
    if (!id) {
      id = `urn:uuid:${randomUUID()}`;
      this.#vault.set(CHATGPT_HOST_VAULT, id);
    }
    return id;
  }

  status(): { signedIn: boolean; email: string | null; planUsage: boolean; registered: boolean; welcomed: boolean } {
    const s = this.#read();
    return { signedIn: Boolean(s.creds), email: s.creds?.email ?? s.email ?? null, planUsage: Boolean(s.creds?.scopes.includes(PLAN_SCOPE)), registered: Boolean(s.clientId), welcomed: Boolean(s.welcomed) };
  }

  markWelcomed(): void {
    this.#write({ ...this.#read(), welcomed: true });
  }

  async #disco(): Promise<Discovery> {
    if (!this.#discovery) {
      const res = await this.#fetch(`${this.#issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`OpenAI sign-in is unavailable (discovery HTTP ${res.status})`);
      this.#discovery = (await res.json()) as Discovery;
      if (this.#discovery.issuer !== this.#issuer) throw new Error('OpenAI discovery issuer mismatch');
    }
    return this.#discovery;
  }

  /** Builds the authorization URL for a new attempt (opened in the owner's browser). */
  async start(opts: { forceConsent?: boolean } = {}): Promise<{ url: string; state: string }> {
    const d = await this.#disco();
    const s = this.#read();
    const state = b64u(randomBytes(24));
    const nonce = b64u(randomBytes(24));
    const verifier = b64u(randomBytes(48));
    const clientId = s.clientId ?? 'dynamic_agent_client';
    for (const [k, a] of this.#attempts) if (this.#now() - a.created > ATTEMPT_TTL_MS) this.#attempts.delete(k);
    this.#attempts.set(state, { state, nonce, verifier, clientId, created: this.#now() });
    const q = new URLSearchParams({
      client_id: clientId,
      ext_agent_host_id: this.hostId,
      response_type: 'code',
      redirect_uri: REDIRECT,
      scope: SCOPES,
      resource: RESOURCE,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: b64u(createHash('sha256').update(verifier).digest()),
    });
    if (!s.clientId) q.set('agent_name_hint', 'Sara');
    if (s.creds?.idToken) q.set('id_token_hint', s.creds.idToken);
    if (s.email ?? s.creds?.email) q.set('login_hint', String(s.email ?? s.creds?.email));
    if (opts.forceConsent) q.set('prompt', 'consent');
    return { url: `${d.authorization_endpoint}?${q}`, state };
  }

  /**
   * Finishes sign-in from the address the browser ended on (or just its query string).
   * Returns the new status; throws a plain-language error otherwise.
   */
  async complete(pasted: string): Promise<ReturnType<ChatGptAuth['status']>> {
    const text = pasted.trim();
    const qs = text.includes('?') ? text.slice(text.indexOf('?') + 1) : text;
    const p = new URLSearchParams(qs.split('#')[0]);
    const state = p.get('state') ?? '';
    const attempt = this.#attempts.get(state);
    if (!attempt || this.#now() - attempt.created > ATTEMPT_TTL_MS) throw new Error('That sign-in link is from an old or unknown attempt. Press "Continue with ChatGPT" again.');
    this.#attempts.delete(state);
    if (p.get('error')) throw new Error(p.get('error') === 'access_denied' ? 'Sign-in was cancelled in the browser.' : `ChatGPT sign-in failed: ${p.get('error_description') ?? p.get('error')}`);
    // Read the code exactly as sent: URLSearchParams turns '+' into a space, which would break it.
    const rawCode = /(?:^|&)code=([^&#]*)/.exec(qs)?.[1];
    let code: string | null = null;
    try {
      code = rawCode ? decodeURIComponent(rawCode) : p.get('code');
    } catch {
      code = p.get('code');
    }
    if (!code) throw new Error('No sign-in code in that address. Copy the whole address from the browser bar.');
    let clientId = attempt.clientId;
    const issued = p.get('client_id');
    if (clientId === 'dynamic_agent_client') {
      if (!issued || issued === 'dynamic_agent_client') throw new Error('Registration did not finish (no client id returned). Try again.');
      clientId = issued;
    } else if (issued && issued !== clientId) {
      throw new Error('The sign-in returned a different client registration. Try again.');
    }
    const d = await this.#disco();
    const res = await this.#fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: REDIRECT, resource: RESOURCE }),
      signal: AbortSignal.timeout(30_000),
    });
    const tok = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const why = [tok.error, tok.error_description].filter(Boolean).join(': ') || `HTTP ${res.status}`;
      // Shape only, never the code itself.
      const shape = `code ${code.length} chars${/[^\w.~-]/.test(code) ? ' with unusual characters' : ''}; client ${clientId.slice(0, 7)}…; callback scope ${p.get('scope') ? 'present' : 'missing'}`;
      console.warn(`chatgpt sign-in: code exchange refused (${why}); ${attempt.clientId === 'dynamic_agent_client' ? 'new registration' : 'returning'}; ${Math.round((this.#now() - attempt.created) / 1000)} s after start; ${shape}`);
      // OpenAI: after invalid_grant, start again with the client id this attempt was issued, so
      // the next try is a plain sign-in to that registration instead of a new registration.
      if (attempt.clientId === 'dynamic_agent_client' && clientId !== 'dynamic_agent_client') this.#write({ ...this.#read(), clientId });
      throw new Error(tok.error === 'invalid_grant' ? `OpenAI didn't accept that sign-in (${why}). Press "Continue with ChatGPT" again and paste the new address within a few minutes; the next try reuses Sara's registration.` : `ChatGPT token exchange failed (${why})`);
    }
    const idToken = String(tok.id_token ?? '');
    const claims = await this.#verifyIdToken(idToken, clientId, attempt.nonce);
    const prev = this.#read();
    if (prev.creds && prev.clientId === clientId && prev.creds.subject !== claims.sub) throw new Error('That is a different ChatGPT account than the one registered here. Sign out first to switch accounts.');
    const scopes = String(tok.scope ?? '').split(/\s+/).filter(Boolean);
    const creds: ChatGptCredentials = {
      email: typeof claims.email === 'string' ? claims.email : null,
      subject: String(claims.sub),
      clientId,
      idToken,
      accessToken: String(tok.access_token ?? ''),
      refreshToken: String(tok.refresh_token ?? ''),
      expiresAt: this.#now() + Number(tok.expires_in ?? 3600) * 1000,
      scopes,
      savedAt: new Date(this.#now()).toISOString(),
    };
    if (!creds.accessToken) throw new Error('ChatGPT returned no access token.');
    this.#write({ ...prev, clientId, email: creds.email, creds });
    return this.status();
  }

  async #verifyIdToken(jwt: string, clientId: string, nonce: string): Promise<Record<string, unknown>> {
    const parts = jwt.split('.');
    if (parts.length !== 3) throw new Error('ChatGPT returned an invalid ID token.');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg?: string; kid?: string };
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>;
    if (header.alg !== 'RS256') throw new Error('Unexpected ID token algorithm.');
    const key = await this.#key(header.kid);
    if (!verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: key as NodeJwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('ID token signature is not valid.');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== this.#issuer) throw new Error('ID token issuer mismatch.');
    if (!aud.includes(clientId)) throw new Error('ID token audience mismatch.');
    if (Number(claims.exp) * 1000 < this.#now() - 60_000) throw new Error('ID token expired.');
    if (claims.nonce !== nonce) throw new Error('ID token nonce mismatch.');
    if (!claims.sub) throw new Error('ID token has no subject.');
    return claims;
  }

  async #key(kid: string | undefined): Promise<JsonWebKey> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.#jwks || attempt === 1) {
        const res = await this.#fetch((await this.#disco()).jwks_uri, { signal: AbortSignal.timeout(15_000) });
        this.#jwks = (await res.json()) as { keys: (JsonWebKey & { kid?: string })[] };
      }
      const k = this.#jwks.keys.find((x) => !kid || x.kid === kid);
      if (k) return k;
    }
    throw new Error('ID token signing key not found.');
  }

  /** A valid access token for inference (refreshing near expiry), or an error to show the owner. */
  async accessToken(): Promise<string> {
    const s = this.#read();
    if (!s.creds) throw new Error('Not signed in to ChatGPT. Open Settings → Subscriptions → Continue with ChatGPT.');
    if (!s.creds.scopes.includes(PLAN_SCOPE)) throw new Error('ChatGPT plan use is not enabled for Sara. Settings → Subscriptions → Enable ChatGPT plan use.');
    if (s.creds.expiresAt - this.#now() > 5 * 60_000) return s.creds.accessToken;
    this.#refreshing ??= this.#refresh(s.creds).finally(() => {
      this.#refreshing = undefined;
    });
    return (await this.#refreshing).accessToken;
  }

  async #refresh(creds: ChatGptCredentials): Promise<ChatGptCredentials> {
    const d = await this.#disco();
    const res = await this.#fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: creds.clientId, refresh_token: creds.refreshToken, resource: RESOURCE }),
      signal: AbortSignal.timeout(30_000),
    });
    const tok = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (res.status === 400 || res.status === 401) {
        const s = this.#read();
        this.#write({ ...s, creds: undefined });
        throw new Error('Your ChatGPT sign-in expired. Settings → Subscriptions → Continue with ChatGPT.');
      }
      throw new Error(`Couldn't renew the ChatGPT sign-in (HTTP ${res.status}). Will retry.`);
    }
    const next: ChatGptCredentials = {
      ...creds,
      accessToken: String(tok.access_token),
      refreshToken: String(tok.refresh_token ?? creds.refreshToken),
      expiresAt: this.#now() + Number(tok.expires_in ?? 3600) * 1000,
      scopes: tok.scope ? String(tok.scope).split(/\s+/).filter(Boolean) : creds.scopes,
      ...(tok.id_token ? { idToken: String(tok.id_token) } : {}),
      savedAt: new Date(this.#now()).toISOString(),
    };
    this.#write({ ...this.#read(), creds: next });
    return next;
  }

  /** Signs out: revokes the renewable session, clears tokens, keeps the client registration. */
  async signOut(): Promise<{ revoked: boolean }> {
    const s = this.#read();
    let revoked = false;
    if (s.creds?.refreshToken) {
      try {
        const d = await this.#disco();
        if (d.revocation_endpoint) {
          const res = await this.#fetch(d.revocation_endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: s.creds.refreshToken, token_type_hint: 'refresh_token', client_id: s.creds.clientId }),
            signal: AbortSignal.timeout(15_000),
          });
          revoked = res.ok;
        }
      } catch {
        /* revocation not confirmed; tokens are cleared anyway */
      }
    }
    this.#write({ clientId: s.clientId, email: s.email ?? s.creds?.email ?? null, welcomed: s.welcomed });
    return { revoked };
  }
}
