import type { Env } from '../env';
import { decryptPii, emailLookupHash, encryptPii, randomId } from '../lib/crypto';
import { nowIso } from '../lib/time';

export type Role = 'user' | 'support' | 'therapist' | 'admin';

export interface UserRow {
  id: string;
  email_hash: string;
  email_enc: string;
  name_enc: string | null;
  role: Role;
  therapist_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function requireKeys(env: Env): { pii: string; token: string } {
  if (!env.PII_ENC_KEY || !env.TOKEN_SIGNING_KEY) {
    throw new Error('Brak PII_ENC_KEY lub TOKEN_SIGNING_KEY.');
  }
  return { pii: env.PII_ENC_KEY, token: env.TOKEN_SIGNING_KEY };
}

/**
 * Users are keyed by an HMAC of their e-mail address, so the database can find
 * an account without holding a searchable copy of the address itself. The
 * address is additionally stored AES-GCM encrypted for the one thing it is
 * needed for: sending the person their own booking confirmation.
 */
export async function findOrCreateUserByEmail(env: Env, email: string): Promise<UserRow> {
  const keys = requireKeys(env);
  const normalized = email.trim().toLowerCase();
  const hash = await emailLookupHash(keys.token, normalized);

  const existing = await env.DB.prepare(
    `SELECT * FROM users WHERE email_hash = ? AND deleted_at IS NULL`,
  )
    .bind(hash)
    .first<UserRow>();
  if (existing) return existing;

  const bootstrap = (env.ADMIN_BOOTSTRAP_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const role: Role = bootstrap.includes(normalized) ? 'admin' : 'user';

  const row: UserRow = {
    id: randomId('usr'),
    email_hash: hash,
    email_enc: await encryptPii(keys.pii, normalized),
    name_enc: null,
    role,
    therapist_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    deleted_at: null,
  };
  await env.DB.prepare(
    `INSERT INTO users (id, email_hash, email_enc, name_enc, role, therapist_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(row.id, row.email_hash, row.email_enc, null, row.role, null, row.created_at, row.updated_at)
    .run();
  return row;
}

export async function getUser(env: Env, userId: string): Promise<UserRow | null> {
  return env.DB.prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL`)
    .bind(userId)
    .first<UserRow>();
}

export async function decryptUserEmail(env: Env, user: UserRow): Promise<string> {
  const keys = requireKeys(env);
  return decryptPii(keys.pii, user.email_enc);
}

export async function recordConsent(
  env: Env,
  userId: string,
  kind: 'terms' | 'privacy',
  version: string,
  source: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO consent_records (id, user_id, kind, version, granted_at, source) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(randomId('cons'), userId, kind, version, nowIso(), source)
    .run();
}

/**
 * Subject access request. Returns everything tied to the account, with the
 * encrypted fields decrypted - it is the user's own data.
 */
export async function exportUserData(env: Env, userId: string): Promise<Record<string, unknown>> {
  const keys = requireKeys(env);
  const user = await getUser(env, userId);
  if (!user) return { user: null };

  const [bookings, consents] = await env.DB.batch<Record<string, string | number | null>>([
    env.DB.prepare(`SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at`).bind(userId),
    env.DB.prepare(`SELECT * FROM consent_records WHERE user_id = ? ORDER BY granted_at`).bind(userId),
  ]);

  const decrypt = async (value: unknown): Promise<string | null> =>
    typeof value === 'string' && value.length > 0 ? decryptPii(keys.pii, value) : null;

  return {
    exported_at: nowIso(),
    user: {
      id: user.id,
      email: await decrypt(user.email_enc),
      name: await decrypt(user.name_enc),
      role: user.role,
      created_at: user.created_at,
    },
    bookings: await Promise.all(
      (bookings?.results ?? []).map(async (b) => ({
        id: b.id,
        public_ref: b.public_ref,
        status: b.status,
        therapist_id: b.therapist_id,
        starts_at_utc: b.starts_at_utc,
        ends_at_utc: b.ends_at_utc,
        timezone: b.timezone,
        price_minor: b.price_minor,
        currency: b.currency,
        contact_name: await decrypt(b.contact_name_enc),
        contact_email: await decrypt(b.contact_email_enc),
        contact_phone: await decrypt(b.contact_phone_enc),
        terms_version: b.terms_version,
        privacy_version: b.privacy_version,
        created_at: b.created_at,
        cancelled_at: b.cancelled_at,
      })),
    ),
    consents: consents?.results ?? [],
    note:
      'Otwarty Terapeuta nie przechowuje treści rozmów z ChatGPT, powodów szukania terapii ani ' +
      'żadnych notatek z sesji. Poniższy eksport zawiera komplet danych powiązanych z kontem.',
  };
}

/**
 * Erasure request. Contact details and the account are removed; the booking
 * rows survive in pseudonymised form because the therapist and the operator
 * need an auditable record that a paid appointment existed.
 */
export async function eraseUserData(env: Env, userId: string): Promise<void> {
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE bookings SET contact_name_enc = NULL, contact_email_enc = NULL,
              contact_phone_enc = NULL, updated_at = ? WHERE user_id = ?`,
    ).bind(at, userId),
    env.DB.prepare(`DELETE FROM oauth_tokens WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM oauth_auth_codes WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM admin_sessions WHERE user_id = ?`).bind(userId),
    env.DB.prepare(
      `UPDATE users SET email_enc = '', name_enc = NULL, email_hash = ?, deleted_at = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(`erased:${userId}`, at, at, userId),
  ]);
}

/**
 * Adres, pod który idą powiadomienia dla terapeutki. Najpierw adres kontaktowy
 * z profilu, bo to ten, który sama podała do spraw zawodowych; jeżeli go nie ma,
 * adres konta, którym się loguje. Brak obu oznacza, że nie ma dokąd wysłać —
 * rezerwacja i tak się uda, powiadomienie po prostu nie powstanie.
 */
export async function therapistNotificationEmail(
  env: Env,
  therapistId: string,
): Promise<string | null> {
  if (!env.PII_ENC_KEY) return null;

  const profile = await env.DB.prepare(
    `SELECT contact_email_enc FROM therapists WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(therapistId)
    .first<{ contact_email_enc: string | null }>();
  if (profile?.contact_email_enc) return decryptPii(env.PII_ENC_KEY, profile.contact_email_enc);

  const account = await env.DB.prepare(
    `SELECT email_enc FROM users WHERE therapist_id = ? AND deleted_at IS NULL LIMIT 1`,
  )
    .bind(therapistId)
    .first<{ email_enc: string }>();
  return account?.email_enc ? decryptPii(env.PII_ENC_KEY, account.email_enc) : null;
}
