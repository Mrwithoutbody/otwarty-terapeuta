import type { Env } from '../env';
import { nowIso } from '../lib/time';

/**
 * Serialises booking attempts for ONE therapist.
 *
 * Two guarantees, deliberately layered:
 *  - this Durable Object is a single instance per `therapist_id`, and the
 *    promise chain below makes its critical section strictly sequential even
 *    across the `await`s inside it;
 *  - the database still carries `idx_bookings_one_active_per_slot`, so even a
 *    bug here (or a write that bypasses the coordinator) cannot produce two
 *    confirmed bookings for the same slot.
 *
 * The coordinator holds no state between requests. Everything authoritative
 * lives in D1.
 */

export interface ReserveCommand {
  bookingId: string;
  publicRef: string;
  userId: string;
  slotId: string;
  therapistId: string;
  sessionType: string;
  mode: string;
  startsAtUtc: string;
  endsAtUtc: string;
  timezone: string;
  /** Price the user actually confirmed, in minor units. Re-checked here. */
  priceMinor: number;
  currency: string;
  contactNameEnc: string | null;
  contactEmailEnc: string | null;
  contactPhoneEnc: string | null;
  termsVersion: string;
  privacyVersion: string;
  manageTokenHash: string;
  idempotencyKey: string;
  requestHash: string;
}

export type ReserveResult =
  | { ok: true; bookingId: string; publicRef: string; replayed: boolean }
  | { ok: false; code: 'slot_unavailable' | 'price_changed' | 'conflict' | 'invalid_input'; message: string };

export class TherapistBookingCoordinator implements DurableObject {
  // ponytail: pojedynczy łańcuch obietnic serializuje WSZYSTKIE próby dla jednego
  // terapeuty; przy bardzo dużym ruchu na jednym profilu zamienić na kolejkę
  // z limitem długości i szybkim odrzucaniem.
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/reserve') {
      return new Response('Not found', { status: 404 });
    }
    const command = (await request.json()) as ReserveCommand;

    // Strict serialisation: every attempt waits for the previous one to finish.
    const run = this.chain.then(
      () => this.reserve(command),
      () => this.reserve(command),
    );
    this.chain = run.catch(() => undefined);

    const result = await run;
    return Response.json(result, { status: result.ok ? 200 : 409 });
  }

  private async reserve(command: ReserveCommand): Promise<ReserveResult> {
    const db = this.env.DB;

    // 1. Idempotency: the same user retrying the same request gets the same answer.
    const prior = await db
      .prepare(`SELECT booking_id, request_hash FROM booking_idempotency WHERE user_id = ? AND idem_key = ?`)
      .bind(command.userId, command.idempotencyKey)
      .first<{ booking_id: string | null; request_hash: string }>();

    if (prior) {
      if (prior.request_hash !== command.requestHash) {
        return {
          ok: false,
          code: 'conflict',
          message: 'Ten sam idempotency_key został już użyty dla innej rezerwacji.',
        };
      }
      if (prior.booking_id) {
        const existing = await db
          .prepare(`SELECT public_ref FROM bookings WHERE id = ?`)
          .bind(prior.booking_id)
          .first<{ public_ref: string }>();
        if (existing) {
          return { ok: true, bookingId: prior.booking_id, publicRef: existing.public_ref, replayed: true };
        }
      }
    }

    // 2. Re-read the authoritative slot state. Nothing from the model or the
    //    widget is trusted here.
    const slot = await db
      .prepare(
        `SELECT s.id, s.status, s.starts_at_utc, s.ends_at_utc, s.timezone, s.therapist_id,
                o.price_minor, o.currency, o.session_type, o.mode, o.active AS offer_active,
                t.status AS therapist_status, t.deleted_at
           FROM appointment_slots s
           JOIN session_offers o ON o.id = s.offer_id
           JOIN therapists t ON t.id = s.therapist_id
          WHERE s.id = ?`,
      )
      .bind(command.slotId)
      .first<{
        id: string;
        status: string;
        starts_at_utc: string;
        ends_at_utc: string;
        timezone: string;
        therapist_id: string;
        price_minor: number;
        currency: string;
        session_type: string;
        mode: string;
        offer_active: number;
        therapist_status: string;
        deleted_at: string | null;
      }>();

    if (
      !slot ||
      slot.therapist_id !== command.therapistId ||
      slot.offer_active !== 1 ||
      slot.therapist_status !== 'published' ||
      slot.deleted_at !== null
    ) {
      return { ok: false, code: 'slot_unavailable', message: 'Ten termin nie jest już dostępny.' };
    }
    if (slot.status !== 'open') {
      return {
        ok: false,
        code: 'slot_unavailable',
        message: 'Ten termin został właśnie zarezerwowany przez kogoś innego. Odśwież listę terminów.',
      };
    }
    if (Date.parse(slot.starts_at_utc) <= Date.now()) {
      return { ok: false, code: 'slot_unavailable', message: 'Ten termin już minął.' };
    }
    if (slot.price_minor !== command.priceMinor || slot.currency !== command.currency) {
      return {
        ok: false,
        code: 'price_changed',
        message: 'Cena tego terminu zmieniła się. Poproś o nowe podsumowanie i potwierdź ponownie.',
      };
    }
    if (
      slot.starts_at_utc !== command.startsAtUtc ||
      slot.ends_at_utc !== command.endsAtUtc ||
      slot.timezone !== command.timezone
    ) {
      return {
        ok: false,
        code: 'slot_unavailable',
        message: 'Szczegóły terminu zmieniły się. Poproś o nowe podsumowanie.',
      };
    }

    // 3. One atomic batch: book the slot, write the booking, record idempotency.
    const at = nowIso();
    try {
      await db.batch([
        db
          .prepare(
            `UPDATE appointment_slots SET status = 'booked', updated_at = ?
              WHERE id = ? AND status = 'open'`,
          )
          .bind(at, command.slotId),
        db
          .prepare(
            `INSERT INTO bookings (id, public_ref, slot_id, therapist_id, user_id, status, session_type,
                                   mode, starts_at_utc, ends_at_utc, timezone, price_minor, currency,
                                   contact_name_enc, contact_email_enc, contact_phone_enc,
                                   terms_version, privacy_version, manage_token_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            command.bookingId,
            command.publicRef,
            command.slotId,
            command.therapistId,
            command.userId,
            command.sessionType,
            command.mode,
            command.startsAtUtc,
            command.endsAtUtc,
            command.timezone,
            command.priceMinor,
            command.currency,
            command.contactNameEnc,
            command.contactEmailEnc,
            command.contactPhoneEnc,
            command.termsVersion,
            command.privacyVersion,
            command.manageTokenHash,
            at,
            at,
          ),
        db
          .prepare(
            `INSERT INTO booking_idempotency (user_id, idem_key, request_hash, booking_id, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id, idem_key) DO UPDATE SET booking_id = excluded.booking_id`,
          )
          .bind(command.userId, command.idempotencyKey, command.requestHash, command.bookingId, at),
      ]);
    } catch {
      // The unique index is the backstop: another confirmed booking won the race.
      return {
        ok: false,
        code: 'slot_unavailable',
        message: 'Ten termin został właśnie zarezerwowany przez kogoś innego. Odśwież listę terminów.',
      };
    }

    return { ok: true, bookingId: command.bookingId, publicRef: command.publicRef, replayed: false };
  }
}
