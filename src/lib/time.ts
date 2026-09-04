/**
 * Time handling rules for this project:
 *  - everything is stored and transported as ISO-8601 UTC ("...Z");
 *  - the appointment's own IANA timezone is stored alongside it and is what
 *    the therapist and the client agreed on;
 *  - the user's timezone only affects presentation, never storage.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_TIMEZONE = 'Europe/Warsaw';

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Validates an IANA identifier by asking the runtime, not by pattern matching. */
export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function isoPlusSeconds(seconds: number, from = new Date()): string {
  return new Date(from.getTime() + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function hoursBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000;
}

/**
 * Human-readable local time, e.g. "wtorek, 2 wrzesnia 2026, 10:00".
 * `timeZone` is the appointment's zone unless the caller overrides it.
 */
export function formatDateTime(iso: string, timeZone = DEFAULT_TIMEZONE, locale = 'pl-PL'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone = DEFAULT_TIMEZONE, locale = 'pl-PL'): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

export function formatDate(iso: string, timeZone = DEFAULT_TIMEZONE, locale = 'pl-PL'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(iso));
}

/** Short zone label, e.g. "GMT+2", to disambiguate cross-timezone bookings. */
export function timezoneLabel(iso: string, timeZone: string, locale = 'pl-PL'): string {
  const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(iso))
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

/** Civil date as it reads on the wall clock of `timeZone` at instant `at`. */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

function partsIn(timeZone: string, at: Date): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const out: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  // Some runtimes render midnight as hour 24 with hour12:false.
  if (out.hour === 24) out.hour = 0;
  return out;
}

/**
 * Offset of `timeZone` from UTC at a given instant, in milliseconds
 * (positive east of Greenwich). Derived from the runtime's own zone data, so
 * it is correct across DST transitions and historical rule changes.
 */
export function timezoneOffsetMs(timeZone: string, at: Date): number {
  const p = partsIn(timeZone, at);
  const asIfUtc = Date.UTC(
    p.year ?? 1970,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0,
  );
  return asIfUtc - at.getTime();
}

export function civilDateIn(timeZone: string, at: Date): CivilDate {
  const p = partsIn(timeZone, at);
  return { year: p.year ?? 1970, month: p.month ?? 1, day: p.day ?? 1 };
}

/**
 * Converts a wall-clock time in `timeZone` to the UTC instant it denotes.
 *
 * Two passes: the first uses the offset that applies at the naive instant, the
 * second re-reads the offset at the resolved instant. That second pass is what
 * makes a time on the far side of a DST transition land correctly.
 *
 * Edge cases at transitions, both documented rather than hidden:
 *  - a "spring forward" gap time (e.g. 02:30 on the day clocks jump 02:00->03:00)
 *    does not exist locally and resolves to the instant one hour later;
 *  - an ambiguous "fall back" time resolves to the first (pre-transition) instant.
 */
export function zonedTimeToUtc(
  date: CivilDate,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0);
  const firstPass = naive - timezoneOffsetMs(timeZone, new Date(naive));
  const secondPass = naive - timezoneOffsetMs(timeZone, new Date(firstPass));
  return new Date(secondPass);
}

/** Day of week (0 = Sunday) as it reads in `timeZone`. */
export function weekdayIn(timeZone: string, date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** `date` shifted by `days` on the civil calendar, independent of any offset. */
export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * 86_400_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function formatPrice(minor: number, currency: string, locale = 'pl-PL'): string {
  // Pełne złote bez groszy: cennik gabinetu to okrągłe kwoty, a "250,00 zł"
  // w wielkim kroju szablonu czyta się jak faktura.
  const fraction = minor % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: fraction }).format(minor / 100);
}
