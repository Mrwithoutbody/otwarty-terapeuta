import type { Env } from '../env';
import { log } from './log';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verifies a Turnstile token for a public form submission.
 * Fails closed: a network error or a missing secret means "not verified".
 */
export async function verifyTurnstile(env: Env, token: string | null, ip: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return false;
  if (!token || token.length > 4096) return false;

  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);

  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (error) {
    log.error('turnstile.verify_failed', error);
    return false;
  }
}
