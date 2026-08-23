import type { Env } from '../env';
import { decryptPii, encryptPii, randomId } from '../lib/crypto';
import { log } from '../lib/log';
import { isoPlusSeconds, nowIso } from '../lib/time';
import { createNotificationSender, type NotificationMessage } from './provider';

/**
 * Notifications live in an outbox, not in the booking transaction. A booking
 * that succeeded must stay valid even if the mail provider is down, and a
 * retry must never be able to create a second booking.
 *
 * The payload contains the recipient address, so it is stored encrypted.
 */

const MAX_ATTEMPTS = 6;
const BACKOFF_SECONDS = [60, 300, 900, 3600, 10800, 21600];

export async function enqueueNotification(
  env: Env,
  kind: string,
  bookingId: string | null,
  message: NotificationMessage,
): Promise<void> {
  if (!env.PII_ENC_KEY) throw new Error('Brak PII_ENC_KEY.');
  await env.DB.prepare(
    `INSERT INTO notification_outbox (id, kind, booking_id, payload_enc, status, attempts, next_retry_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
  )
    .bind(
      randomId('nt'),
      kind,
      bookingId,
      await encryptPii(env.PII_ENC_KEY, JSON.stringify(message)),
      nowIso(),
      nowIso(),
      nowIso(),
    )
    .run();
}

interface OutboxRow {
  id: string;
  kind: string;
  payload_enc: string;
  attempts: number;
}

/**
 * Drains due messages. Called from `ctx.waitUntil` after a booking and from
 * the scheduled handler, so a failed send is retried without the user waiting.
 */
export async function drainOutbox(env: Env, limit = 20): Promise<{ sent: number; failed: number }> {
  if (!env.PII_ENC_KEY) return { sent: 0, failed: 0 };
  const send = createNotificationSender(env);

  const { results } = await env.DB.prepare(
    `SELECT id, kind, payload_enc, attempts FROM notification_outbox
      WHERE status = 'pending' AND next_retry_at <= ? ORDER BY next_retry_at LIMIT ?`,
  )
    .bind(nowIso(), limit)
    .all<OutboxRow>();

  let sent = 0;
  let failed = 0;

  for (const row of results) {
    try {
      const message = JSON.parse(await decryptPii(env.PII_ENC_KEY, row.payload_enc)) as NotificationMessage;
      await send(message);
      await env.DB.prepare(
        `UPDATE notification_outbox SET status = 'sent', attempts = attempts + 1, updated_at = ? WHERE id = ?`,
      )
        .bind(nowIso(), row.id)
        .run();
      sent++;
    } catch (error) {
      failed++;
      const attempts = row.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      const backoff = BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length - 1)] ?? 21600;
      await env.DB.prepare(
        `UPDATE notification_outbox
            SET status = ?, attempts = ?, last_error = ?, next_retry_at = ?, updated_at = ?
          WHERE id = ?`,
      )
        .bind(
          exhausted ? 'failed' : 'pending',
          attempts,
          error instanceof Error ? error.message.slice(0, 200) : 'unknown',
          isoPlusSeconds(backoff),
          nowIso(),
          row.id,
        )
        .run();
      log.error('outbox.send_failed', error, { count: attempts });
    }
  }

  return { sent, failed };
}
