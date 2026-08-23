import type { Env } from '../env';
import { emailLookupHash, encryptPii, decryptPii, hmacHex, randomId, randomLoginCode, timingSafeEqual } from '../lib/crypto';
import { isoPlusSeconds, nowIso } from '../lib/time';

/**
 * One passwordless e-mail code flow, shared by every surface that needs one:
 * the OAuth consent screen, the admin panel and therapist self-signup.
 *
 * The code itself is never stored - only an HMAC of it, keyed by the server's
 * signing key and bound to the challenge id, so two challenges issued in the
 * same second cannot validate each other's code. The e-mail address is stored
 * encrypted because the row outlives the request that created it.
 *
 * `context` is whatever the caller needs back after verification (the pending
 * OAuth request, a pending therapist profile). It is read from the row rather
 * than from the form, so a tampered hidden field cannot change the outcome.
 */

export type ChallengePurpose = 'oauth' | 'admin' | 'therapist_signup';

const CODE_TTL_SECONDS = 900;
const MAX_ATTEMPTS = 5;

export async function issueEmailCode(
  env: Env,
  purpose: ChallengePurpose,
  email: string,
  context: unknown = {},
): Promise<{ challengeId: string; code: string }> {
  if (!env.TOKEN_SIGNING_KEY) throw new Error('Brak TOKEN_SIGNING_KEY.');
  const challengeId = randomId('lc');
  const code = randomLoginCode();

  await env.DB.prepare(
    `INSERT INTO login_challenges (id, email_hash, email_enc, code_hash, purpose, context, attempts, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(
      challengeId,
      await emailLookupHash(env.TOKEN_SIGNING_KEY, email),
      await encryptPii(env.PII_ENC_KEY ?? '', email),
      await hmacHex(env.TOKEN_SIGNING_KEY, `login:${challengeId}:${code}`),
      purpose,
      JSON.stringify(context),
      isoPlusSeconds(CODE_TTL_SECONDS),
      nowIso(),
    )
    .run();

  return { challengeId, code };
}

/**
 * `unknown` covers a missing row, a wrong purpose and an already-consumed
 * challenge alike: the caller must not be able to tell those apart, or the
 * form becomes an oracle.
 */
export type CodeVerdict =
  | { ok: true; email: string; context: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'attempts' | 'mismatch' };

export async function verifyEmailCode(
  env: Env,
  purpose: ChallengePurpose,
  challengeId: string,
  submitted: string,
): Promise<CodeVerdict> {
  if (!env.TOKEN_SIGNING_KEY) throw new Error('Brak TOKEN_SIGNING_KEY.');

  const row = await env.DB.prepare(
    `SELECT email_enc, code_hash, context, attempts, expires_at, consumed_at
       FROM login_challenges WHERE id = ? AND purpose = ?`,
  )
    .bind(challengeId, purpose)
    .first<{
      email_enc: string;
      code_hash: string;
      context: string;
      attempts: number;
      expires_at: string;
      consumed_at: string | null;
    }>();

  if (!row || row.consumed_at !== null) return { ok: false, reason: 'unknown' };
  if (Date.parse(row.expires_at) < Date.now()) return { ok: false, reason: 'expired' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'attempts' };

  const expected = await hmacHex(env.TOKEN_SIGNING_KEY, `login:${challengeId}:${submitted}`);
  if (!timingSafeEqual(expected, row.code_hash)) {
    await env.DB.prepare(`UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?`)
      .bind(challengeId)
      .run();
    return { ok: false, reason: 'mismatch' };
  }

  return { ok: true, email: await decryptPii(env.PII_ENC_KEY ?? '', row.email_enc), context: row.context };
}

/**
 * Marking the challenge used is returned as a statement rather than executed,
 * so a caller that also writes an authorization code or a therapist profile can
 * batch the consume together with them and never leave a code replayable.
 */
export function consumeEmailCode(env: Env, challengeId: string): D1PreparedStatement {
  return env.DB.prepare(`UPDATE login_challenges SET consumed_at = ? WHERE id = ?`).bind(
    nowIso(),
    challengeId,
  );
}
