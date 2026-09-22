import type { Env } from '../../../shared/env';
import { randomId } from '../../../shared/lib/crypto';
import {
  addCivilDays,
  civilDateIn,
  DEFAULT_TIMEZONE,
  formatTime,
  isoOf,
  nowIso,
  weekdayOf,
  zonedTimeToUtc,
  type CivilDate,
} from '../../../shared/lib/time';

/**
 * Grafik i wolne terminy - jak w ZnanymLekarzu: grafik tygodniowy zostaje
 * w bazie i powtarza się sam, urlop wycina dni, pojedynczy termin da się
 * zablokować kliknięciem.
 *
 * Grafik należy do oferty (`session_offers.schedule`): dla każdego dnia
 * tygodnia godziny rozpoczęcia, lokalnie w strefie terapeutki. Dwie oferty
 * to zwykle „online" i „w gabinecie" w różne dni - stąd grafik per oferta.
 * Terminy powstają z grafiku na HORIZON_DAYS do przodu; cron dokłada ogon.
 *
 * Jedno miejsce, bo grafik zapisuje panel (zakładka „Dostępność"), a dopełnia
 * go cron. Błąd tutaj znaczy
 * termin o złej godzinie u realnej osoby.
 *
 * Terminy powstają z LOKALNEJ daty i LOKALNEJ godziny, przeliczonych na
 * instant UTC: „10:00 w Europe/Warsaw" zostaje dziesiątą po obu stronach
 * zmiany czasu. Unikalność `(therapist_id, starts_at_utc)` czyni zapis
 * idempotentnym, więc powtórzenie planu niczego nie dubluje.
 */

/** Siedem list godzin, indeks = dzień tygodnia (0 = niedziela). */
type Week = number[][];

/** Osiem tygodni do przodu; cron dokłada, gdy zostaje mniej niż siedem. */
export const HORIZON_DAYS = 56;

/** Godziny do wyboru w siatce grafiku w panelu. */
export const SCHEDULE_HOURS: number[] = Array.from({ length: 15 }, (_, i) => i + 7);

export const emptyWeek = (): Week => [[], [], [], [], [], [], []];

/** Kolejność polskiego tygodnia; liczba to indeks dnia w grafiku (0 = niedziela). */
export const WEEKDAYS: Array<[number, string]> = [
  [1, 'Poniedziałek'], [2, 'Wtorek'], [3, 'Środa'], [4, 'Czwartek'], [5, 'Piątek'], [6, 'Sobota'], [0, 'Niedziela'],
];

export function cleanHours(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((h) => SCHEDULE_HOURS.includes(h)))].sort((a, b) => a - b);
}

export function parseWeek(raw: string | null | undefined): Week {
  try {
    const value: unknown = JSON.parse(raw || '[]');
    if (Array.isArray(value) && value.length === 7) return value.map(cleanHours);
  } catch {
    // zepsuty JSON = brak grafiku, nie wyjątek przy renderze panelu
  }
  return emptyWeek();
}

/** Pusty grafik zapisuje się jako pusty napis - po nim cron poznaje, kogo pominąć. */
export const weekJson = (week: Week): string => (week.some((day) => day.length > 0) ? JSON.stringify(week) : '');

/** Data lokalna jako "YYYY-MM-DD" - tak leżą daty urlopu. */
export const dayKey = (d: CivilDate): string =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

export const parseDay = (key: string): CivilDate => {
  const [year, month, day] = key.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
};

/** Dzień tygodnia i godzina terminu tak, jak widzi je terapeutka. */
export function localSlot(iso: string, timezone: string): { weekday: number; hour: number } {
  return {
    weekday: weekdayOf(civilDateIn(timezone, new Date(iso))),
    hour: Number(formatTime(iso, timezone).split(':')[0]),
  };
}

export interface TimeOff {
  starts_on: string;
  ends_on: string;
}

interface SlotPlan {
  offerId: string;
  durationMinutes: number;
  timezone: string;
  week: Week;
  timeOff?: TimeOff[];
}

function slotStatements(env: Env, therapistId: string, plan: SlotPlan): D1PreparedStatement[] {
  const at = nowIso();
  const today = civilDateIn(plan.timezone, new Date());
  const statements: D1PreparedStatement[] = [];

  for (let d = 1; d <= HORIZON_DAYS; d++) {
    const day = addCivilDays(today, d);
    const key = dayKey(day);
    if (plan.timeOff?.some((off) => off.starts_on <= key && key <= off.ends_on)) continue;

    for (const hour of plan.week[weekdayOf(day)] ?? []) {
      const start = zonedTimeToUtc(day, hour, 0, plan.timezone);
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

/**
 * Wolne terminy znikają. Termin, na którym wisi odwołana rezerwacja, zostaje
 * zablokowany zamiast usunięty - `bookings.slot_id` to klucz obcy.
 */
export function closeSlots(env: Env, ids: string[], reason: string): D1PreparedStatement[] {
  if (ids.length === 0) return [];
  const list = JSON.stringify(ids);
  return [
    env.DB.prepare(
      `UPDATE appointment_slots SET status = 'blocked', block_reason = ?, updated_at = ?
        WHERE status = 'open' AND id IN (SELECT value FROM json_each(?))
          AND id IN (SELECT slot_id FROM bookings)`,
    ).bind(reason, nowIso(), list),
    env.DB.prepare(`DELETE FROM appointment_slots WHERE status = 'open' AND id IN (SELECT value FROM json_each(?))`).bind(list),
  ];
}

export async function listTimeOff(env: Env, therapistId: string): Promise<Array<TimeOff & { id: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT id, starts_on, ends_on FROM therapist_time_off WHERE therapist_id = ? AND ends_on >= ? ORDER BY starts_on`,
  )
    .bind(therapistId, nowIso().slice(0, 10))
    .all<TimeOff & { id: string }>();
  return results;
}

interface OfferSchedule {
  id: string;
  duration_minutes: number;
  week: Week;
}

/**
 * Nowe grafiki ofert jednej terapeutki, jednym zapisem: grafik do bazy, wolne
 * terminy spoza niego zamknięte, brakujące dołożone. Zarezerwowane i
 * zablokowane zostają, jak były. Najpierw wszystkie zamknięcia, potem
 * wszystkie wstawienia - godzina przeniesiona z oferty A do B inaczej
 * trafiłaby na jeszcze otwarty termin A i przepadła.
 */
export async function saveSchedules(env: Env, therapistId: string, timezone: string, offers: OfferSchedule[]): Promise<void> {
  if (offers.length === 0) return;
  const [{ results: open }, timeOff] = await Promise.all([
    env.DB.prepare(
      `SELECT id, offer_id, starts_at_utc FROM appointment_slots
        WHERE therapist_id = ? AND status = 'open' AND starts_at_utc > ?`,
    )
      .bind(therapistId, nowIso())
      .all<{ id: string; offer_id: string; starts_at_utc: string }>(),
    listTimeOff(env, therapistId),
  ]);
  const weekOf = new Map(offers.map((o) => [o.id, o.week]));
  const outside = open
    .filter((s) => {
      const week = weekOf.get(s.offer_id);
      if (!week) return false;
      const local = localSlot(s.starts_at_utc, timezone);
      return !week[local.weekday]!.includes(local.hour);
    })
    .map((s) => s.id);

  const at = nowIso();
  await env.DB.batch([
    ...offers.map((o) =>
      env.DB.prepare(`UPDATE session_offers SET schedule = ?, updated_at = ? WHERE id = ? AND therapist_id = ?`).bind(
        weekJson(o.week),
        at,
        o.id,
        therapistId,
      ),
    ),
    ...closeSlots(env, outside, 'poza grafikiem'),
    ...offers.flatMap((o) =>
      slotStatements(env, therapistId, { offerId: o.id, durationMinutes: o.duration_minutes, timezone, week: o.week, timeOff }),
    ),
  ]);
}

/**
 * Terminy z grafików. Bez `therapistId` to cron: tylko kalendarze, którym
 * zostało mniej niż tydzień zapasu - zwykły przebieg to jedno zapytanie. Z
 * `therapistId` od razu, bo po zdjęciu urlopu dziura jest w środku. Wstawienia
 * są idempotentne, więc zawsze idzie cały horyzont.
 */
export async function fillFromSchedules(env: Env, therapistId: string | null = null): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.therapist_id, o.duration_minutes, o.schedule, t.timezone,
            (SELECT MAX(s.starts_at_utc) FROM appointment_slots s WHERE s.therapist_id = o.therapist_id) AS last_slot
       FROM session_offers o JOIN therapists t ON t.id = o.therapist_id
      WHERE o.active = 1 AND o.schedule != '' AND t.deleted_at IS NULL
        AND (?1 IS NULL OR o.therapist_id = ?1)`,
  )
    .bind(therapistId)
    .all<{ id: string; therapist_id: string; duration_minutes: number; schedule: string; timezone: string | null; last_slot: string | null }>();

  const cutoff = isoOf(new Date(Date.now() + (HORIZON_DAYS - 7) * 86_400_000));
  const due = therapistId ? results : results.filter((r) => r.last_slot === null || r.last_slot < cutoff);
  if (due.length === 0) return 0;

  const { results: off } = await env.DB.prepare(
    `SELECT therapist_id, starts_on, ends_on FROM therapist_time_off
      WHERE ends_on >= ? AND therapist_id IN (SELECT value FROM json_each(?))`,
  )
    .bind(nowIso().slice(0, 10), JSON.stringify([...new Set(due.map((r) => r.therapist_id))]))
    .all<TimeOff & { therapist_id: string }>();

  const statements = due.flatMap((r) =>
    slotStatements(env, r.therapist_id, {
      offerId: r.id,
      durationMinutes: r.duration_minutes,
      timezone: r.timezone || DEFAULT_TIMEZONE,
      week: parseWeek(r.schedule),
      timeOff: off.filter((o) => o.therapist_id === r.therapist_id),
    }),
  );
  if (statements.length > 0) await env.DB.batch(statements);
  return statements.length;
}
