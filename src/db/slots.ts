import type { Env } from '../env';
import { randomId } from '../lib/crypto';
import { addCivilDays, civilDateIn, isoOf, nowIso, weekdayIn, zonedTimeToUtc } from '../lib/time';

/**
 * Wolne terminy z planu „te godziny, w dni robocze, na N dni do przodu".
 *
 * Jedno miejsce, bo plan powstaje w trzech: w panelu (zakładka „Dostępność"),
 * w edytorze stron (blok kalendarza) i w cronie, który dopełnia profile
 * demonstracyjne. Trzy kopie tej samej pętli rozjeżdżały się przy każdej
 * poprawce — a błąd w niej znaczy termin o złej godzinie u realnej osoby.
 *
 * Terminy powstają z LOKALNEJ daty i LOKALNEJ godziny, przeliczonych na
 * instant UTC: „10:00 w Europe/Warsaw" zostaje dziesiątą po obu stronach
 * zmiany czasu. Unikalność `(therapist_id, starts_at_utc)` czyni zapis
 * idempotentnym, więc powtórzenie planu niczego nie dubluje.
 */
export interface SlotPlan {
  offerId: string;
  durationMinutes: number;
  timezone: string;
  /** Godziny rozpoczęcia w strefie terapeutki, 0-23. */
  hours: number[];
  /** Ile dni roboczych do przodu, licząc od jutra. */
  days: number;
  /** Pomija instanty nie później niż ten — cron demo dokłada tylko ogon kalendarza. */
  after?: string | null;
}

export function slotStatements(env: Env, therapistId: string, plan: SlotPlan): D1PreparedStatement[] {
  const at = nowIso();
  const today = civilDateIn(plan.timezone, new Date());
  const statements: D1PreparedStatement[] = [];

  for (let d = 1; d <= plan.days; d++) {
    const day = addCivilDays(today, d);
    const weekday = weekdayIn(plan.timezone, day);
    if (weekday === 0 || weekday === 6) continue;

    for (const hour of plan.hours) {
      const start = zonedTimeToUtc(day, hour, 0, plan.timezone);
      if (plan.after && start.toISOString() <= plan.after) continue;
      const end = new Date(start.getTime() + plan.durationMinutes * 60_000);
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO appointment_slots
             (id, therapist_id, offer_id, starts_at_utc, ends_at_utc, timezone, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        ).bind(randomId('sl'), therapistId, plan.offerId, isoOf(start), isoOf(end), plan.timezone, at, at),
      );
    }
  }
  return statements;
}

/** Zapisuje plan i zwraca liczbę wygenerowanych terminów. */
export async function generateSlots(env: Env, therapistId: string, plan: SlotPlan): Promise<number> {
  const statements = slotStatements(env, therapistId, plan);
  if (statements.length > 0) await env.DB.batch(statements);
  return statements.length;
}
