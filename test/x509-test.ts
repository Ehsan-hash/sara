// Tests only: a tiny X.509 certificate maker (DER by hand, signed with node:crypto), so the Alexa
// signature tests can build their own root → intermediate → leaf chain without openssl or a
// package. Never used by the server.
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, body: Buffer) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
function int(n: number | Buffer): Buffer {
  let hex = Buffer.isBuffer(n) ? '' : n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let b = Buffer.isBuffer(n) ? n : Buffer.from(hex, 'hex');
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
function oid(s: string): Buffer {
  const p = s.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const stack = [v & 0x7f];
    let x = v >> 7;
    while (x > 0) {
      stack.unshift((x & 0x7f) | 0x80);
      x >>= 7;
    }
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
const bits = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const octets = (b: Buffer) => tlv(0x04, b);
const name = (cn: string) => seq(set(seq(oid('2.5.4.3'), utf8(cn))));
function time(d: Date): Buffer {
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
}
const SHA256_RSA = seq(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));

export interface TestCert {
  pem: string;
  key: KeyObject;
  name: string;
}

let serial = 1000;
/** One certificate: `issuer` signs it (none = self-signed). */
export function makeCert(o: { cn: string; ca?: boolean; dns?: string[]; issuer?: TestCert; notBefore: Date; notAfter: Date }): TestCert {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const exts: Buffer[] = [];
  if (o.ca) exts.push(seq(oid('2.5.29.19'), Buffer.from([0x01, 0x01, 0xff]), octets(seq(Buffer.from([0x01, 0x01, 0xff])))));
  if (o.ca) exts.push(seq(oid('2.5.29.15'), Buffer.from([0x01, 0x01, 0xff]), octets(tlv(0x03, Buffer.from([0x01, 0x06])))));
  if (o.dns?.length) exts.push(seq(oid('2.5.29.17'), octets(seq(...o.dns.map((d) => tlv(0x82, Buffer.from(d)))))));
  const tbs = seq(
    tlv(0xa0, int(2)),
    int(serial++),
    SHA256_RSA,
    name(o.issuer?.name ?? o.cn),
    seq(time(o.notBefore), time(o.notAfter)),
    name(o.cn),
    publicKey.export({ type: 'spki', format: 'der' }),
    ...(exts.length ? [tlv(0xa3, seq(...exts))] : []),
  );
  const signature = sign('sha256', tbs, o.issuer?.key ?? privateKey);
  const der = seq(tbs, SHA256_RSA, bits(signature));
  const pem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END CERTIFICATE-----\n`;
  return { pem, key: privateKey, name: o.cn };
}

/** Root → intermediate → leaf for echo-api.amazon.com (or another name), valid around `now`. */
export function makeChain(now: Date, o: { dns?: string; leafDays?: number; leafExpired?: boolean } = {}): { root: TestCert; inter: TestCert; leaf: TestCert; chainPem: string } {
  const day = 86_400_000;
  const root = makeCert({ cn: 'Sara Test Root', ca: true, notBefore: new Date(now.getTime() - 30 * day), notAfter: new Date(now.getTime() + 3650 * day) });
  const inter = makeCert({ cn: 'Sara Test Intermediate', ca: true, issuer: root, notBefore: new Date(now.getTime() - 30 * day), notAfter: new Date(now.getTime() + 365 * day) });
  const leaf = makeCert({
    cn: o.dns ?? 'echo-api.amazon.com',
    dns: [o.dns ?? 'echo-api.amazon.com'],
    issuer: inter,
    notBefore: new Date(now.getTime() - (o.leafExpired ? 60 : 1) * day),
    notAfter: new Date(now.getTime() + (o.leafExpired ? -1 : (o.leafDays ?? 30)) * day),
  });
  return { root, inter, leaf, chainPem: leaf.pem + inter.pem };
}
