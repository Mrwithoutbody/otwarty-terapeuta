import { fromBase64Url, hmacBase64Url, randomId, timingSafeEqual, toBase64Url } from './crypto';
import { CONFIRMATION_TOKEN_TTL_SECONDS } from '../env';
import { AppError } from './errors';

/**
 * The payload of a `preview_booking` confirmation token.
 *
 * Deliberately contains no name, e-mail, phone, reason for seeking therapy or
 * any other sensitive value - only identifiers and the commercial terms that
 * `create_booking` must re-verify against the database.
 */
export interface ConfirmationPayload {
  v: 1;
  /** User the preview was issued to. A token is worthless to anybody else. */
  uid: string;
  tid: string;
  sid: string;
  oid: string;
  /** Price in minor units at preview time. A later change invalidates the token. */
  price: number;
  cur: string;
  /** Slot start/end in UTC, plus the appointment's own timezone. */
  st: string;
  et: string;
  tz: string;
  mode: string;
  stype: string;
  terms: string;
  priv: string;
  /** Unix seconds. */
  exp: number;
  jti: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodePayload(payload: ConfirmationPayload): string {
  return toBase64Url(encoder.encode(JSON.stringify(payload)));
}

export async function signConfirmationToken(
  signingKey: string,
  payload: Omit<ConfirmationPayload, 'v' | 'exp' | 'jti'>,
  ttlSeconds = CONFIRMATION_TOKEN_TTL_SECONDS,
): Promise<{ token: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + Math.min(ttlSeconds, CONFIRMATION_TOKEN_TTL_SECONDS);
  const full: ConfirmationPayload = { v: 1, ...payload, exp, jti: randomId('cnf', 8) };
  const body = encodePayload(full);
  const signature = await hmacBase64Url(signingKey, `cnf.v1.${body}`);
  return { token: `${body}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/**
 * Verifies signature first, then expiry. Any tampering with the body changes
 * the signature, so a modified price or slot can never reach the database.
 */
export async function verifyConfirmationToken(
  signingKey: string,
  token: string,
): Promise<ConfirmationPayload> {
  if (typeof token !== 'string' || token.length > 2048) {
    throw new AppError('token_invalid', 'Token potwierdzenia jest nieprawidłowy.', 400);
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new AppError('token_invalid', 'Token potwierdzenia jest nieprawidłowy.', 400);
  }
  const [body, signature] = parts as [string, string];

  const expected = await hmacBase64Url(signingKey, `cnf.v1.${body}`);
  if (!timingSafeEqual(expected, signature)) {
    throw new AppError('token_invalid', 'Token potwierdzenia jest nieprawidłowy.', 400);
  }

  let payload: ConfirmationPayload;
  try {
    payload = JSON.parse(decoder.decode(fromBase64Url(body))) as ConfirmationPayload;
  } catch {
    throw new AppError('token_invalid', 'Token potwierdzenia jest nieprawidłowy.', 400);
  }
  if (payload.v !== 1) {
    throw new AppError('token_invalid', 'Token potwierdzenia jest nieprawidłowy.', 400);
  }
  if (payload.exp * 1000 < Date.now()) {
    throw new AppError(
      'token_expired',
      'Podsumowanie rezerwacji wygasło. Poproś o nowe podsumowanie i potwierdź ponownie.',
      400,
    );
  }
  return payload;
}
