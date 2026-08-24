import { CONFIRMATION_TOKEN_TTL_SECONDS, type Env } from '../env';
import { getBookableSlot, getTherapist } from '../db/catalog';
import {
  decryptUserEmail,
  getUser,
  recordConsent,
  therapistNotificationEmail,
  type UserRow,
} from '../db/users';
import { audit } from '../lib/audit';
import { encryptPii, hmacHex, randomId, randomPublicRef, randomSecret, sha256Hex } from '../lib/crypto';
import { AppError, errors } from '../lib/errors';
import { isEmail, isPhone, sanitizeLine } from '../lib/sanitize';
import { formatDateTime, formatPrice, hoursBetween, nowIso, timezoneLabel } from '../lib/time';
import { signConfirmationToken, verifyConfirmationToken } from '../lib/tokens';
import { enqueueNotification } from '../notify/outbox';
import type { ReserveCommand, ReserveResult } from './coordinator';
import { sessionTypeLabel } from '../matching/rank';

export interface BookingSummary {
  therapist_id: string;
  therapist_name: string;
  therapist_profile_url: string;
  slot_id: string;
  starts_at_utc: string;
  ends_at_utc: string;
  timezone: string;
  local_start: string;
  local_timezone_label: string;
  duration_minutes: number;
  session_type: string;
  session_type_label: string;
  mode: string;
  mode_label: string;
  price_minor: number;
  currency: string;
  price_display: string;
  cancellation_policy: string;
  cancellation_cutoff_hours: number;
  terms_version: string;
  privacy_version: string;
  terms_url: string;
  privacy_url: string;
}

export interface PreviewResult {
  summary: BookingSummary;
  confirmation_token: string;
  confirmation_token_expires_at: string;
  /** Shown to the user verbatim before they say yes. */
  confirmation_prompt: string;
}

function modeLabel(mode: string): string {
  return mode === 'online' ? 'online' : 'stacjonarnie';
}

function requireSigningKey(env: Env): string {
  if (!env.TOKEN_SIGNING_KEY) throw errors.internal('Brak konfiguracji podpisu tokenów.');
  return env.TOKEN_SIGNING_KEY;
}

function requirePiiKey(env: Env): string {
  if (!env.PII_ENC_KEY) throw errors.internal('Brak konfiguracji szyfrowania danych kontaktowych.');
  return env.PII_ENC_KEY;
}

/**
 * Builds the full summary a user must see BEFORE anything is written, and
 * issues a short-lived signed token that binds this exact user, therapist,
 * slot, price and policy version together.
 */
export async function previewBooking(
  env: Env,
  user: UserRow,
  input: { slot_id: string; user_timezone?: string },
): Promise<PreviewResult> {
  const slot = await getBookableSlot(env, input.slot_id);
  if (!slot) throw errors.notFound('Nie znaleziono takiego terminu.');
  if (slot.slot_status !== 'open') {
    throw new AppError('slot_unavailable', 'Ten termin nie jest już dostępny.', 409);
  }
  if (Date.parse(slot.starts_at_utc) <= Date.now()) {
    throw new AppError('slot_unavailable', 'Ten termin już minął.', 409);
  }

  const therapist = await getTherapist(env, { therapist_id: slot.therapist_id });
  if (!therapist) throw errors.notFound('Profil terapeuty nie jest dostępny.');

  const displayTz = input.user_timezone ?? slot.timezone;
  const summary: BookingSummary = {
    therapist_id: therapist.therapist_id,
    therapist_name: therapist.display_name,
    therapist_profile_url: therapist.profile_url,
    slot_id: slot.slot_id,
    starts_at_utc: slot.starts_at_utc,
    ends_at_utc: slot.ends_at_utc,
    timezone: slot.timezone,
    local_start: formatDateTime(slot.starts_at_utc, displayTz),
    local_timezone_label: timezoneLabel(slot.starts_at_utc, displayTz),
    duration_minutes: slot.duration_minutes,
    session_type: slot.session_type,
    session_type_label: sessionTypeLabel(slot.session_type),
    mode: slot.mode,
    mode_label: modeLabel(slot.mode),
    price_minor: slot.price_minor,
    currency: slot.currency,
    price_display: formatPrice(slot.price_minor, slot.currency),
    cancellation_policy: therapist.cancellation_policy,
    cancellation_cutoff_hours: therapist.cancellation_cutoff_hours,
    terms_version: env.TERMS_VERSION,
    privacy_version: env.PRIVACY_VERSION,
    terms_url: `${env.PUBLIC_BASE_URL}/regulamin`,
    privacy_url: `${env.PUBLIC_BASE_URL}/polityka-prywatnosci`,
  };

  const { token, expiresAt } = await signConfirmationToken(
    requireSigningKey(env),
    {
      uid: user.id,
      tid: therapist.therapist_id,
      sid: slot.slot_id,
      oid: slot.offer_id,
      price: slot.price_minor,
      cur: slot.currency,
      st: slot.starts_at_utc,
      et: slot.ends_at_utc,
      tz: slot.timezone,
      mode: slot.mode,
      stype: slot.session_type,
      terms: env.TERMS_VERSION,
      priv: env.PRIVACY_VERSION,
    },
    CONFIRMATION_TOKEN_TTL_SECONDS,
  );

  return {
    summary,
    confirmation_token: token,
    confirmation_token_expires_at: expiresAt,
    confirmation_prompt:
      `Czy potwierdzasz rezerwację: ${summary.therapist_name}, ${summary.local_start} ` +
      `(${summary.local_timezone_label}), ${summary.session_type_label}, ${summary.mode_label}, ` +
      `${summary.price_display}? Rezerwacja oznacza akceptację regulaminu (wersja ${summary.terms_version}) ` +
      `i polityki prywatności (wersja ${summary.privacy_version}).`,
  };
}

export interface CreateBookingInput {
  confirmation_token: string;
  idempotency_key: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  accepted_terms_version: string;
  /** Explicit user consent. Never inferred, never defaulted. */
  confirm: boolean;
  accepted_privacy_version: string;
}

export interface CreateBookingResult {
  booking_id: string;
  public_ref: string;
  status: 'confirmed';
  summary: BookingSummary;
  manage_url: string;
  cancellation_policy: string;
  replayed: boolean;
}

export async function createBooking(
  env: Env,
  user: UserRow,
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  // Creating a booking blocks a therapist's slot and sends her an e-mail, so it
  // gets the same explicit gate as cancelling one. Holding a confirmation token is
  // not consent: a model can obtain one and call straight through without ever
  // asking the person. This makes that a deliberate act, not an accident.
  if (input.confirm !== true) {
    throw errors.invalid(
      'Rezerwacja wymaga jednoznacznego potwierdzenia użytkownika (confirm = true). ' +
        'Najpierw pokaż pełne podsumowanie z preview_booking i poczekaj na zgodę.',
    );
  }

  const signingKey = requireSigningKey(env);
  const piiKey = requirePiiKey(env);

  const payload = await verifyConfirmationToken(signingKey, input.confirmation_token);

  // The token is bound to the user it was issued to. A token belonging to
  // somebody else is worthless even if it is otherwise valid.
  if (payload.uid !== user.id) {
    throw errors.forbidden('To podsumowanie zostało wystawione dla innego konta.');
  }
  if (
    input.accepted_terms_version !== payload.terms ||
    input.accepted_privacy_version !== payload.priv
  ) {
    throw errors.invalid(
      'Zaakceptowana wersja regulaminu lub polityki prywatności nie zgadza się z podsumowaniem. ' +
        'Poproś o nowe podsumowanie.',
    );
  }
  if (payload.terms !== env.TERMS_VERSION || payload.priv !== env.PRIVACY_VERSION) {
    throw errors.invalid(
      'Regulamin lub polityka prywatności zmieniły się od czasu podsumowania. Poproś o nowe podsumowanie.',
    );
  }

  const contactName = input.contact_name ? sanitizeLine(input.contact_name, 120) : null;
  const contactEmail = input.contact_email?.trim().toLowerCase() ?? (await decryptUserEmail(env, user));
  const contactPhone = input.contact_phone ? input.contact_phone.trim() : null;
  if (!isEmail(contactEmail)) throw errors.invalid('Nieprawidłowy adres e-mail do kontaktu.');
  if (contactPhone !== null && !isPhone(contactPhone)) {
    throw errors.invalid('Nieprawidłowy numer telefonu.');
  }

  const manageSecret = randomSecret(24);
  const command: ReserveCommand = {
    bookingId: randomId('bk'),
    publicRef: randomPublicRef(),
    userId: user.id,
    slotId: payload.sid,
    therapistId: payload.tid,
    sessionType: payload.stype,
    mode: payload.mode,
    startsAtUtc: payload.st,
    endsAtUtc: payload.et,
    timezone: payload.tz,
    priceMinor: payload.price,
    currency: payload.cur,
    contactNameEnc: contactName ? await encryptPii(piiKey, contactName) : null,
    contactEmailEnc: await encryptPii(piiKey, contactEmail),
    contactPhoneEnc: contactPhone ? await encryptPii(piiKey, contactPhone) : null,
    termsVersion: payload.terms,
    privacyVersion: payload.priv,
    manageTokenHash: await hmacHex(signingKey, `manage:${manageSecret}`),
    idempotencyKey: input.idempotency_key,
    // The request hash intentionally covers only the commercial facts, so a
    // retry with the same intent replays instead of conflicting.
    requestHash: await sha256Hex(
      `${payload.sid}|${payload.tid}|${payload.price}|${payload.cur}|${payload.st}|${user.id}`,
    ),
  };

  const stub = env.BOOKING_COORDINATOR.get(env.BOOKING_COORDINATOR.idFromName(payload.tid));
  const response = await stub.fetch('https://booking-coordinator.internal/reserve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  const result = (await response.json()) as ReserveResult;

  if (!result.ok) {
    const status = result.code === 'conflict' ? 409 : result.code === 'price_changed' ? 409 : 409;
    throw new AppError(result.code, result.message, status);
  }

  const bookingId = result.bookingId;

  if (!result.replayed) {
    await recordConsent(env, user.id, 'terms', payload.terms, 'mcp:create_booking');
    await recordConsent(env, user.id, 'privacy', payload.priv, 'mcp:create_booking');
    await audit(env, {
      actorType: 'user',
      actorId: user.id,
      action: 'booking.created',
      subjectType: 'booking',
      subjectId: bookingId,
      meta: { price_minor: payload.price, currency: payload.cur, source: 'mcp' },
    });
  }

  const summary = await loadSummary(env, bookingId);
  const manageUrl = `${env.PUBLIC_BASE_URL}/rezerwacja/${encodeURIComponent(result.publicRef)}?k=${manageSecret}`;

  if (!result.replayed) {
    await enqueueNotification(env, 'booking.confirmed', bookingId, {
      to: contactEmail,
      subject: `Potwierdzenie rezerwacji ${result.publicRef} - Otwarty Terapeuta`,
      text:
        `Rezerwacja potwierdzona.\n\n` +
        `Terapeuta: ${summary.therapist_name}\n` +
        `Termin: ${summary.local_start} (${summary.local_timezone_label})\n` +
        `Forma: ${summary.session_type_label}, ${summary.mode_label}\n` +
        `Czas trwania: ${summary.duration_minutes} min\n` +
        `Cena: ${summary.price_display}\n` +
        `Numer rezerwacji: ${result.publicRef}\n\n` +
        `Zasady odwołania: ${summary.cancellation_policy || 'zgodnie z regulaminem'}\n\n` +
        `Zarządzaj rezerwacją: ${manageUrl}\n\n` +
        `Otwarty Terapeuta jest katalogiem i systemem rezerwacji. Nie jest usługą terapeutyczną ` +
        `ani pomocą w nagłym zagrożeniu. W sytuacji zagrożenia życia zadzwoń pod 112, ` +
        `a po wsparcie emocjonalne pod 116 123.`,
    });
  }

  if (!result.replayed) {
    // Terapeutka musi wiedzieć, kto przyjdzie i jak się z tą osobą skontaktować -
    // bez tego rezerwacja jest dla niej wpisem w kalendarzu bez człowieka.
    const therapistEmail = await therapistNotificationEmail(env, summary.therapist_id);
    if (therapistEmail) {
      await enqueueNotification(env, 'booking.confirmed_therapist', bookingId, {
        to: therapistEmail,
        subject: `Nowa rezerwacja ${result.publicRef} - ${summary.local_start}`,
        text:
          `Masz nową rezerwację.\n\n` +
          `Termin: ${summary.local_start} (${summary.local_timezone_label})\n` +
          `Forma: ${summary.session_type_label}, ${summary.mode_label}\n` +
          `Czas trwania: ${summary.duration_minutes} min\n` +
          `Cena: ${summary.price_display}\n` +
          `Numer rezerwacji: ${result.publicRef}\n\n` +
          `Osoba rezerwująca:\n` +
          `  imię: ${contactName ?? 'nie podano'}\n` +
          `  e-mail: ${contactEmail}\n` +
          `  telefon: ${contactPhone ?? 'nie podano'}\n\n` +
          `Te dane służą wyłącznie do kontaktu w sprawie tej wizyty.`,
      });
    }
  }

  return {
    booking_id: bookingId,
    public_ref: result.publicRef,
    status: 'confirmed',
    summary,
    manage_url: manageUrl,
    cancellation_policy: summary.cancellation_policy,
    replayed: result.replayed,
  };
}

interface BookingRow {
  id: string;
  public_ref: string;
  slot_id: string;
  therapist_id: string;
  user_id: string;
  status: 'confirmed' | 'cancelled';
  session_type: string;
  mode: string;
  starts_at_utc: string;
  ends_at_utc: string;
  timezone: string;
  price_minor: number;
  currency: string;
  manage_token_hash: string;
  created_at: string;
  cancelled_at: string | null;
}

async function loadSummary(env: Env, bookingId: string): Promise<BookingSummary> {
  const row = await env.DB.prepare(
    `SELECT b.*, t.display_name, t.slug, t.cancellation_policy, t.cancellation_cutoff_h
       FROM bookings b JOIN therapists t ON t.id = b.therapist_id WHERE b.id = ?`,
  )
    .bind(bookingId)
    .first<
      BookingRow & {
        display_name: string;
        slug: string;
        cancellation_policy: string;
        cancellation_cutoff_h: number;
      }
    >();
  if (!row) throw errors.notFound('Nie znaleziono rezerwacji.');

  return {
    therapist_id: row.therapist_id,
    therapist_name: row.display_name,
    therapist_profile_url: `${env.PUBLIC_BASE_URL}/terapeuci/${encodeURIComponent(row.slug)}`,
    slot_id: row.slot_id,
    starts_at_utc: row.starts_at_utc,
    ends_at_utc: row.ends_at_utc,
    timezone: row.timezone,
    local_start: formatDateTime(row.starts_at_utc, row.timezone),
    local_timezone_label: timezoneLabel(row.starts_at_utc, row.timezone),
    duration_minutes: Math.round(
      (Date.parse(row.ends_at_utc) - Date.parse(row.starts_at_utc)) / 60_000,
    ),
    session_type: row.session_type,
    session_type_label: sessionTypeLabel(row.session_type),
    mode: row.mode,
    mode_label: modeLabel(row.mode),
    price_minor: row.price_minor,
    currency: row.currency,
    price_display: formatPrice(row.price_minor, row.currency),
    cancellation_policy: row.cancellation_policy,
    cancellation_cutoff_hours: row.cancellation_cutoff_h,
    terms_version: env.TERMS_VERSION,
    privacy_version: env.PRIVACY_VERSION,
    terms_url: `${env.PUBLIC_BASE_URL}/regulamin`,
    privacy_url: `${env.PUBLIC_BASE_URL}/polityka-prywatnosci`,
  };
}

export interface MyBooking {
  booking_id: string;
  public_ref: string;
  status: 'confirmed' | 'cancelled';
  therapist_name: string;
  therapist_profile_url: string;
  starts_at_utc: string;
  timezone: string;
  local_start: string;
  session_type_label: string;
  mode_label: string;
  price_display: string;
  can_cancel_free_until_utc: string | null;
}

/** Minimal projection: only what the person needs to recognise their own booking. */
export async function listMyBookings(
  env: Env,
  user: UserRow,
  options: { include_past?: boolean; limit?: number } = {},
): Promise<MyBooking[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const conditions = ['b.user_id = ?'];
  const params: Array<string | number> = [user.id];
  if (!options.include_past) {
    conditions.push('b.starts_at_utc >= ?');
    params.push(nowIso());
  }

  const { results } = await env.DB.prepare(
    `SELECT b.*, t.display_name, t.slug, t.cancellation_cutoff_h
       FROM bookings b JOIN therapists t ON t.id = b.therapist_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY b.starts_at_utc
      LIMIT ?`,
  )
    .bind(...params, limit)
    .all<BookingRow & { display_name: string; slug: string; cancellation_cutoff_h: number }>();

  return results.map((row) => ({
    booking_id: row.id,
    public_ref: row.public_ref,
    status: row.status,
    therapist_name: row.display_name,
    therapist_profile_url: `${env.PUBLIC_BASE_URL}/terapeuci/${encodeURIComponent(row.slug)}`,
    starts_at_utc: row.starts_at_utc,
    timezone: row.timezone,
    local_start: formatDateTime(row.starts_at_utc, row.timezone),
    session_type_label: sessionTypeLabel(row.session_type),
    mode_label: modeLabel(row.mode),
    price_display: formatPrice(row.price_minor, row.currency),
    can_cancel_free_until_utc:
      row.status === 'confirmed'
        ? new Date(Date.parse(row.starts_at_utc) - row.cancellation_cutoff_h * 3_600_000).toISOString()
        : null,
  }));
}

export interface CancelResult {
  booking_id: string;
  public_ref: string;
  status: 'cancelled';
  cancelled_at: string;
  within_free_cancellation_window: boolean;
  message: string;
  already_cancelled: boolean;
}

/**
 * Cancels a booking the caller owns. Idempotent: cancelling twice returns the
 * same authoritative state rather than an error.
 */
export async function cancelBooking(
  env: Env,
  user: UserRow,
  input: { booking_id: string; confirm: boolean; reason_code?: string },
): Promise<CancelResult> {
  if (input.confirm !== true) {
    throw errors.invalid('Odwołanie wizyty wymaga jednoznacznego potwierdzenia (confirm = true).');
  }

  const row = await env.DB.prepare(
    `SELECT b.*, t.cancellation_cutoff_h FROM bookings b
       JOIN therapists t ON t.id = b.therapist_id WHERE b.id = ?`,
  )
    .bind(input.booking_id)
    .first<BookingRow & { cancellation_cutoff_h: number }>();

  // A booking belonging to somebody else is reported as "not found", so the
  // endpoint cannot be used to probe which booking ids exist.
  if (!row || row.user_id !== user.id) throw errors.notFound('Nie znaleziono takiej rezerwacji.');

  if (row.status === 'cancelled') {
    return {
      booking_id: row.id,
      public_ref: row.public_ref,
      status: 'cancelled',
      cancelled_at: row.cancelled_at ?? row.created_at,
      within_free_cancellation_window: false,
      message: 'Ta rezerwacja była już odwołana.',
      already_cancelled: true,
    };
  }

  const at = nowIso();
  const hoursLeft = hoursBetween(at, row.starts_at_utc);
  const free = hoursLeft >= row.cancellation_cutoff_h;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?,
              cancel_reason = ?, updated_at = ? WHERE id = ? AND status = 'confirmed'`,
    ).bind(at, 'user', input.reason_code ?? null, at, row.id),
    // Releasing the slot is safe: the partial unique index only covers
    // confirmed bookings, so the slot can be booked again.
    env.DB.prepare(
      `UPDATE appointment_slots SET status = 'open', updated_at = ? WHERE id = ? AND status = 'booked'`,
    ).bind(at, row.slot_id),
  ]);

  await audit(env, {
    actorType: 'user',
    actorId: user.id,
    action: 'booking.cancelled',
    subjectType: 'booking',
    subjectId: row.id,
    meta: { reason_code: input.reason_code ?? 'unspecified', status: free ? 'free' : 'late' },
  });

  // Odwołanie działa w obie strony: terapeutka zwalnia godzinę w kalendarzu i
  // musi o tym wiedzieć równie szybko co osoba, która odwołała.
  const therapistEmail = await therapistNotificationEmail(env, row.therapist_id);
  if (therapistEmail) {
    await enqueueNotification(env, 'booking.cancelled_therapist', row.id, {
      to: therapistEmail,
      subject: `Odwołana rezerwacja ${row.public_ref}`,
      text:
        `Rezerwacja ${row.public_ref} została odwołana przez osobę rezerwującą.\n` +
        `Termin: ${row.starts_at_utc} (${row.timezone})\n` +
        (free
          ? 'Odwołanie nastąpiło w bezpłatnym okresie.'
          : 'Odwołanie nastąpiło po upływie bezpłatnego okresu.') +
        `\n\nTermin wrócił do puli wolnych godzin.`,
    });
  }

  const owner = await getUser(env, row.user_id);
  if (owner) {
    await enqueueNotification(env, 'booking.cancelled', row.id, {
      to: await decryptUserEmail(env, owner),
      subject: `Rezerwacja ${row.public_ref} została odwołana - Otwarty Terapeuta`,
      text:
        `Rezerwacja ${row.public_ref} została odwołana.\n\n` +
        (free
          ? 'Odwołanie nastąpiło w bezpłatnym okresie wskazanym przez terapeutę.'
          : 'Odwołanie nastąpiło po upływie bezpłatnego okresu. Zasady rozliczenia określa regulamin terapeuty.'),
    });
  }

  return {
    booking_id: row.id,
    public_ref: row.public_ref,
    status: 'cancelled',
    cancelled_at: at,
    within_free_cancellation_window: free,
    message: free
      ? 'Rezerwacja odwołana w bezpłatnym okresie.'
      : 'Rezerwacja odwołana po upływie bezpłatnego okresu odwołania. Zasady rozliczenia określa regulamin terapeuty.',
    already_cancelled: false,
  };
}
