import type { Env } from '../env';
import { slotStatements } from './slots';

/**
 * Keeps the demonstration profiles from going stale.
 *
 * They are published in the live catalogue, and a profile whose calendar ran
 * out three weeks ago says "brak wolnych terminów" and drops its slot block -
 * which is the one thing a sample profile must never demonstrate. Seeded slots
 * covered three weeks and would simply have expired.
 *
 * Runs from the cron. The common case is one COUNT and nothing else: it only
 * writes when a demo profile has fewer than a fortnight of open slots left.
 */
const KEEP_DAYS_AHEAD = 14;
const TOP_UP_TO_DAYS = 28;
const HOURS = [9, 11, 13, 15, 17];

interface DemoRow {
  id: string;
  timezone: string;
  offer_id: string | null;
  duration_minutes: number | null;
  last_slot: string | null;
}

export async function topUpDemoSlots(env: Env): Promise<{ added: number }> {
  const horizon = new Date(Date.now() + KEEP_DAYS_AHEAD * 86_400_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.timezone,
            (SELECT o.id FROM session_offers o WHERE o.therapist_id = t.id AND o.active = 1 LIMIT 1) AS offer_id,
            (SELECT o.duration_minutes FROM session_offers o WHERE o.therapist_id = t.id AND o.active = 1 LIMIT 1) AS duration_minutes,
            (SELECT MAX(s.starts_at_utc) FROM appointment_slots s
              WHERE s.therapist_id = t.id AND s.status = 'open') AS last_slot
       FROM therapists t
      WHERE t.is_demo = 1 AND t.status = 'published' AND t.deleted_at IS NULL`,
  ).all<DemoRow>();

  const statements = results.flatMap((row) =>
    row.offer_id === null
      ? []
      : row.last_slot !== null && row.last_slot >= horizon
        ? []
        : slotStatements(env, row.id, {
            offerId: row.offer_id,
            durationMinutes: row.duration_minutes ?? 50,
            timezone: row.timezone,
            hours: HOURS,
            days: TOP_UP_TO_DAYS,
            // Already covered: the query above tells us where her calendar ends.
            after: row.last_slot,
          }),
  );

  if (statements.length > 0) await env.DB.batch(statements);
  return { added: statements.length };
}
