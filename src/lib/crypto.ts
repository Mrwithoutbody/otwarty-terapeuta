/**
 * Web Crypto helpers. Every secret-derived value in this project is either an
 * HMAC (lookup keys, token hashes) or AES-GCM ciphertext (contact PII).
 * Raw secrets are never persisted.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  return bytes.toBase64({ alphabet: 'base64url', omitPadding: true });
}

export function fromBase64Url(value: string): Uint8Array {
  return Uint8Array.fromBase64(value, { alphabet: 'base64url' });
}

const toHex = (bytes: Uint8Array): string => bytes.toHex();

/** Cryptographically random opaque identifier, e.g. `th_4f1a…` (24 hex chars). */
export function randomId(prefix: string, bytes = 12): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return `${prefix}_${toHex(buf)}`;
}

/** URL-safe random secret used for tokens the user receives (never stored raw). */
export function randomSecret(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toBase64Url(buf);
}

/** Human-friendly booking reference, e.g. `OT-7K3QD2`. Ambiguous glyphs excluded. */
export function randomPublicRef(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let out = '';
  for (const b of buf) out += alphabet[b % alphabet.length];
  return `OT-${out}`;
}

/** Numeric login code. Six digits is the usability/entropy trade-off; rate limits carry the rest. */
export function randomLoginCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + ((buf[0] ?? 0) % 900000));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return toHex(new Uint8Array(digest));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return toHex(new Uint8Array(sig));
}

export async function hmacBase64Url(secret: string, data: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return toBase64Url(new Uint8Array(sig));
}

// `lib: DOM` shadows the Workers `SubtleCrypto` (workers-types declares it as a
// class, so the two do not merge). This module only ever runs in the Worker.
const subtle = crypto.subtle as SubtleCrypto & {
  timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
};

/**
 * Constant-time comparison for equal-length hex/base64url strings. The Workers
 * primitive throws on a length mismatch, so the (non-secret) length is compared
 * first - exactly as before.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return subtle.timingSafeEqual(enc.encode(a), enc.encode(b));
}

async function aesKey(base64Key: string): Promise<CryptoKey> {
  const raw = Uint8Array.fromBase64(base64Key);
  if (raw.byteLength !== 32) {
    throw new Error('PII_ENC_KEY musi być 32-bajtowym kluczem zakodowanym w base64.');
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** AES-256-GCM. Output layout: base64url(iv[12] || ciphertext||tag). */
export async function encryptPii(base64Key: string, plaintext: string): Promise<string> {
  const key = await aesKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  const out = new Uint8Array(iv.byteLength + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.byteLength);
  return toBase64Url(out);
}

export async function decryptPii(base64Key: string, payload: string): Promise<string> {
  const key = await aesKey(base64Key);
  const raw = fromBase64Url(payload);
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return dec.decode(pt);
}

/** Stable, non-reversible lookup key for an e-mail address. */
export async function emailLookupHash(secret: string, email: string): Promise<string> {
  return hmacHex(secret, `email:${email.trim().toLowerCase()}`);
}
