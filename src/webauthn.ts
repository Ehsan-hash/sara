// Phase 24: passkeys (WebAuthn) for the owner, written from the spec with Node's crypto only:
// no libraries, no outside services. Registration accepts "none" attestation (we trust the
// authenticator the owner chose; we don't need to know its maker). Sign-in checks the challenge,
// the origin, the relying-party id hash, user presence and verification, the signature, and the
// signature counter.
import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto';

// ---------- CBOR (RFC 8949): just what WebAuthn uses ----------

type Cbor = number | bigint | string | Buffer | boolean | null | undefined | Cbor[] | Map<Cbor, Cbor>;

/** Decodes one CBOR item; returns it and the bytes it used. */
export function decodeCbor(buf: Buffer, start = 0): { value: Cbor; end: number } {
  let p = start;
  const need = (n: number) => {
    if (p + n > buf.length) throw new Error('CBOR: truncated');
  };
  const arg = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) return need(1), buf[p++];
    if (info === 25) return need(2), (p += 2), buf.readUInt16BE(p - 2);
    if (info === 26) return need(4), (p += 4), buf.readUInt32BE(p - 4);
    if (info === 27) {
      need(8);
      const v = buf.readBigUInt64BE(p);
      p += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CBOR: number too large');
      return Number(v);
    }
    throw new Error('CBOR: indefinite lengths are not used by WebAuthn');
  };
  const item = (depth: number): Cbor => {
    if (depth > 16) throw new Error('CBOR: too deep');
    need(1);
    const b = buf[p++];
    const major = b >> 5;
    const info = b & 31;
    switch (major) {
      case 0:
        return arg(info);
      case 1:
        return -1 - arg(info);
      case 2: {
        const n = arg(info);
        need(n);
        p += n;
        return Buffer.from(buf.subarray(p - n, p));
      }
      case 3: {
        const n = arg(info);
        need(n);
        p += n;
        return buf.subarray(p - n, p).toString('utf8');
      }
      case 4: {
        const n = arg(info);
        if (n > 1000) throw new Error('CBOR: array too long');
        return Array.from({ length: n }, () => item(depth + 1));
      }
      case 5: {
        const n = arg(info);
        if (n > 1000) throw new Error('CBOR: map too long');
        const m = new Map<Cbor, Cbor>();
        for (let i = 0; i < n; i++) {
          const k = item(depth + 1);
          m.set(k, item(depth + 1));
        }
        return m;
      }
      case 6:
        arg(info); // tag: ignore, keep the value
        return item(depth + 1);
      default:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new Error('CBOR: unsupported value');
    }
  };
  const value = item(0);
  return { value, end: p };
}

// ---------- authenticator data ----------

export interface AuthData {
  rpIdHash: Buffer;
  flags: { up: boolean; uv: boolean; be: boolean; bs: boolean; at: boolean };
  signCount: number;
  credentialId?: Buffer;
  publicKey?: Map<Cbor, Cbor>;
}

export function parseAuthData(a: Buffer): AuthData {
  if (a.length < 37) throw new Error('Authenticator data is too short.');
  const f = a[32];
  const out: AuthData = {
    rpIdHash: a.subarray(0, 32),
    flags: { up: Boolean(f & 0x01), uv: Boolean(f & 0x04), be: Boolean(f & 0x08), bs: Boolean(f & 0x10), at: Boolean(f & 0x40) },
    signCount: a.readUInt32BE(33),
  };
  if (out.flags.at) {
    if (a.length < 55) throw new Error('Authenticator data is too short.');
    const len = a.readUInt16BE(53);
    out.credentialId = a.subarray(55, 55 + len);
    const { value } = decodeCbor(a, 55 + len);
    if (!(value instanceof Map)) throw new Error('The passkey has no public key.');
    out.publicKey = value;
  }
  return out;
}

/** COSE public key → JWK (ES256, RS256 and Ed25519: what passkeys use). */
export function coseToJwk(k: Map<Cbor, Cbor>): { jwk: JsonWebKey; alg: number } {
  const kty = k.get(1);
  const alg = Number(k.get(3));
  const b64 = (v: Cbor) => {
    if (!Buffer.isBuffer(v)) throw new Error('Bad key.');
    return v.toString('base64url');
  };
  if (kty === 2 && alg === -7 && k.get(-1) === 1) return { alg, jwk: { kty: 'EC', crv: 'P-256', x: b64(k.get(-2)), y: b64(k.get(-3)) } };
  if (kty === 3 && alg === -257) return { alg, jwk: { kty: 'RSA', n: b64(k.get(-1)), e: b64(k.get(-2)) } };
  if (kty === 1 && alg === -8 && k.get(-1) === 6) return { alg, jwk: { kty: 'OKP', crv: 'Ed25519', x: b64(k.get(-2)) } };
  throw new Error('This kind of passkey is not supported.');
}

export function verifySignature(jwk: JsonWebKey, alg: number, data: Buffer, sig: Buffer): boolean {
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  if (alg === -8) return verify(null, data, key, sig);
  return verify('sha256', data, key, sig); // ES256 signatures are DER, Node's default
}

// ---------- ceremonies ----------

export interface StoredPasskey {
  id: string; // credential id, base64url
  jwk: JsonWebKey;
  alg: number;
  signCount: number;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export const newChallenge = () => randomBytes(32).toString('base64url');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

function checkClientData(raw: Buffer, want: { type: string; challenge: string; origin: string }): void {
  let c: ClientData;
  try {
    c = JSON.parse(raw.toString('utf8')) as ClientData;
  } catch {
    throw new Error('Bad client data.');
  }
  if (c.type !== want.type) throw new Error('Wrong kind of passkey request.');
  if (c.challenge !== want.challenge) throw new Error('This passkey request has expired. Try again.');
  if (c.origin !== want.origin) throw new Error(`This passkey request came from ${String(c.origin)}, not ${want.origin}.`);
  if (c.crossOrigin) throw new Error('Passkeys from another site are not accepted.');
}

/** Checks a new passkey (navigator.credentials.create) and returns what to store. */
export function verifyRegistration(
  r: { clientDataJSON: string; attestationObject: string },
  want: { challenge: string; origin: string; rpId: string },
): { id: string; jwk: JsonWebKey; alg: number; signCount: number } {
  const clientData = Buffer.from(r.clientDataJSON, 'base64url');
  checkClientData(clientData, { type: 'webauthn.create', ...want });
  const { value } = decodeCbor(Buffer.from(r.attestationObject, 'base64url'));
  if (!(value instanceof Map) || !Buffer.isBuffer(value.get('authData'))) throw new Error('Bad passkey data.');
  const ad = parseAuthData(value.get('authData') as Buffer);
  if (!ad.rpIdHash.equals(sha256(want.rpId))) throw new Error('This passkey was made for another site.');
  if (!ad.flags.up) throw new Error('The passkey did not confirm you were there.');
  if (!ad.flags.uv) throw new Error('The passkey must check it is you (fingerprint, face or PIN).');
  if (!ad.credentialId?.length || !ad.publicKey) throw new Error('The passkey has no key.');
  const { jwk, alg } = coseToJwk(ad.publicKey);
  createPublicKey({ key: jwk, format: 'jwk' }); // a usable key
  return { id: ad.credentialId.toString('base64url'), jwk, alg, signCount: ad.signCount };
}

/** Checks a passkey sign-in (navigator.credentials.get). Returns the new signature counter. */
export function verifyAssertion(
  r: { id: string; clientDataJSON: string; authenticatorData: string; signature: string },
  key: StoredPasskey,
  want: { challenge: string; origin: string; rpId: string },
): number {
  const clientData = Buffer.from(r.clientDataJSON, 'base64url');
  checkClientData(clientData, { type: 'webauthn.get', ...want });
  const authData = Buffer.from(r.authenticatorData, 'base64url');
  const ad = parseAuthData(authData);
  if (!ad.rpIdHash.equals(sha256(want.rpId))) throw new Error('This passkey was made for another site.');
  if (!ad.flags.up || !ad.flags.uv) throw new Error('The passkey must check it is you (fingerprint, face or PIN).');
  const ok = verifySignature(key.jwk, key.alg, Buffer.concat([authData, sha256(clientData)]), Buffer.from(r.signature, 'base64url'));
  if (!ok) throw new Error('The passkey signature is wrong.');
  // A counter that goes backwards means a copied authenticator (synced passkeys keep it at 0).
  if ((ad.signCount !== 0 || key.signCount !== 0) && ad.signCount <= key.signCount) throw new Error('This passkey may have been copied; it was refused. Remove it and add it again.');
  return ad.signCount;
}
