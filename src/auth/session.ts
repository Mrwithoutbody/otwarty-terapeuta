import type { Env } from '../env';
import { getUser, type UserRow } from '../db/users';
import { hmacHex, randomSecret, timingSafeEqual } from '../lib/crypto';
import { isoPlusSeconds, nowIso } from '../lib/time';

/**
 * Cookie sessions for the admin panel. Separate from OAuth on purpose: the
 * panel is a first-party browser surface with CSRF exposure, the MCP endpoint
 * is a bearer-token API with none.
 *
 * The CSRF token is derived from the session secret with the server's HMAC key
 * rather than stored: an attacker who can make a cross-site request still
 * cannot read the cookie, so they cannot derive the token either.
 */

const SESSION_TTL_SECONDS = 8 * 3600;
const COOKIE_NAME = '__Host-ot_admin';

export interface AdminSession {
  user: UserRow;
  csrfToken: string;
}

function signingKey(env: Env): string {
  if (!env.TOKEN_SIGNING_KEY) throw new Error('Brak TOKEN_SIGNING_KEY.');
  return env.TOKEN_SIGNING_KEY;
}

async function deriveCsrf(env: Env, sessionSecret: string): Promise<string> {
  return hmacHex(signingKey(env), `csrf:${sessionSecret}`);
}

export async function createAdminSession(env: Env, userId: string): Promise<{ cookie: string }> {
  const key = signingKey(env);
  const sessionSecret = randomSecret(32);

  await env.DB.prepare(
    `INSERT INTO admin_sessions (session_hash, user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(
      await hmacHex(key, `session:${sessionSecret}`),
      userId,
      isoPlusSeconds(SESSION_TTL_SECONDS),
      nowIso(),
    )
    .run();

  // `__Host-` forces Secure + Path=/ + no Domain: the strictest scope a
  // first-party session cookie can have.
  const cookie = `${COOKIE_NAME}=${sessionSecret}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
  return { cookie };
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export async function loadAdminSession(env: Env, request: Request): Promise<AdminSession | null> {
  const secret = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (!secret || secret.length < 16 || secret.length > 128) return null;

  const row = await env.DB.prepare(
    `SELECT user_id, expires_at FROM admin_sessions WHERE session_hash = ?`,
  )
    .bind(await hmacHex(signingKey(env), `session:${secret}`))
    .first<{ user_id: string; expires_at: string }>();

  if (!row || Date.parse(row.expires_at) < Date.now()) return null;
  const user = await getUser(env, row.user_id);
  if (!user) return null;

  return { user, csrfToken: await deriveCsrf(env, secret) };
}

export async function verifyCsrf(env: Env, request: Request, submitted: string): Promise<boolean> {
  const secret = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (!secret || !submitted) return false;
  return timingSafeEqual(await deriveCsrf(env, secret), submitted);
}

export async function destroyAdminSession(env: Env, request: Request): Promise<string> {
  const secret = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (secret) {
    await env.DB.prepare(`DELETE FROM admin_sessions WHERE session_hash = ?`)
      .bind(await hmacHex(signingKey(env), `session:${secret}`))
      .run();
  }
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** A therapist may only ever touch their own profile. */
export function ownsTherapist(user: UserRow, therapistId: string): boolean {
  if (user.role === 'admin') return true;
  return user.role === 'therapist' && user.therapist_id === therapistId;
}
