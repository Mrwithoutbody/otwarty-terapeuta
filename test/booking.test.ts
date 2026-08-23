import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { cancelBooking, createBooking, listMyBookings, previewBooking } from '../src/booking/service';
import { findOrCreateUserByEmail, type UserRow } from '../src/db/users';
import { listOpenSlots } from '../src/db/catalog';
import { nowIso } from '../src/lib/time';
import { signConfirmationToken } from '../src/lib/tokens';
import { AppError } from '../src/lib/errors';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';
const KEY = env.TOKEN_SIGNING_KEY!;

async function anyOpenSlot(therapistId = ANNA): Promise<string> {
  const slots = await listOpenSlots(env, {
    therapist_id: therapistId,
    from_utc: nowIso(),
    to_utc: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    limit: 50,
  });
  const slot = slots[0];
  if (!slot) throw new Error('brak wolnych terminów w danych demonstracyjnych');
  return slot.slot_id;
}

function acceptance(): {
  accepted_terms_version: string;
  accepted_privacy_version: string;
  confirm: boolean;
} {
  return {
    accepted_terms_version: env.TERMS_VERSION,
    accepted_privacy_version: env.PRIVACY_VERSION,
    confirm: true,
  };
}

/**
 * Each test gets its own pair of accounts, so assertions can count rows without
 * depending on what earlier tests in the same file left behind.
 */
let seq = 0;
async function pair(): Promise<[UserRow, UserRow]> {
  seq += 1;
  return Promise.all([
    findOrCreateUserByEmail(env, `alice-${seq}@example.invalid`),
    findOrCreateUserByEmail(env, `bob-${seq}@example.invalid`),
  ]);
}

describe('booking flow', () => {
  let alice: UserRow;
  let bob: UserRow;

  beforeEach(async () => {
    [alice, bob] = await pair();
  });

  it('preview does not create a booking', async () => {
    const slotId = await anyOpenSlot();
    const preview = await previewBooking(env, alice, { slot_id: slotId });
    expect(preview.summary.slot_id).toBe(slotId);
    expect(preview.confirmation_token.length).toBeGreaterThan(20);

    const slot = await env.DB.prepare(`SELECT status FROM appointment_slots WHERE id = ?`)
      .bind(slotId)
      .first<{ status: string }>();
    expect(slot?.status).toBe('open');
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE slot_id = ?`)
      .bind(slotId)
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it('the confirmation summary carries every fact the user must see', async () => {
    const preview = await previewBooking(env, alice, { slot_id: await anyOpenSlot() });
    const s = preview.summary;
    for (const value of [
      s.therapist_name,
      s.local_start,
      s.local_timezone_label,
      s.price_display,
      s.session_type_label,
      s.mode_label,
      s.terms_version,
      s.privacy_version,
    ]) {
      expect(value).toBeTruthy();
    }
    expect(s.duration_minutes).toBeGreaterThan(0);
  });

  it('creates a booking after preview and marks the slot booked', async () => {
    const slotId = await anyOpenSlot();
    const preview = await previewBooking(env, alice, { slot_id: slotId });
    const result = await createBooking(env, alice, {
      confirmation_token: preview.confirmation_token,
      idempotency_key: `idem-happy-path-${seq}`,
      ...acceptance(),
    });

    expect(result.status).toBe('confirmed');
    expect(result.public_ref).toMatch(/^OT-[A-Z2-9]{6}$/);
    expect(result.manage_url).toContain(result.public_ref);

    const slot = await env.DB.prepare(`SELECT status FROM appointment_slots WHERE id = ?`)
      .bind(slotId)
      .first<{ status: string }>();
    expect(slot?.status).toBe('booked');
  });

  it('stores contact details encrypted, never in plaintext', async () => {
    const preview = await previewBooking(env, alice, { slot_id: await anyOpenSlot() });
    const result = await createBooking(env, alice, {
      confirmation_token: preview.confirmation_token,
      idempotency_key: `idem-encryption-${seq}`,
      contact_name: 'Alicja Testowa',
      contact_email: 'alice@example.invalid',
      contact_phone: '+48 600 700 800',
      ...acceptance(),
    });

    const row = await env.DB.prepare(
      `SELECT contact_name_enc, contact_email_enc, contact_phone_enc FROM bookings WHERE id = ?`,
    )
      .bind(result.booking_id)
      .first<Record<string, string>>();
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain('Alicja');
    expect(serialised).not.toContain('alice@example.invalid');
    expect(serialised).not.toContain('600 700 800');
  });

  it('replays the same result for a repeated idempotency key', async () => {
    const slotId = await anyOpenSlot();
    const preview = await previewBooking(env, alice, { slot_id: slotId });
    const args = {
      confirmation_token: preview.confirmation_token,
      idempotency_key: `idem-retry-${seq}`,
      ...acceptance(),
    };
    const first = await createBooking(env, alice, args);
    const second = await createBooking(env, alice, args);

    expect(second.booking_id).toBe(first.booking_id);
    expect(second.public_ref).toBe(first.public_ref);
    expect(second.replayed).toBe(true);

    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE slot_id = ?`)
      .bind(slotId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('lets exactly one of two concurrent bookings win the same slot', async () => {
    const slotId = await anyOpenSlot();
    const [previewA, previewB] = await Promise.all([
      previewBooking(env, alice, { slot_id: slotId }),
      previewBooking(env, bob, { slot_id: slotId }),
    ]);

    const results = await Promise.allSettled([
      createBooking(env, alice, {
        confirmation_token: previewA.confirmation_token,
        idempotency_key: `race-alice-${seq}`,
        ...acceptance(),
      }),
      createBooking(env, bob, {
        confirmation_token: previewB.confirmation_token,
        idempotency_key: `race-bob-${seq}`,
        ...acceptance(),
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'slot_unavailable' });

    const confirmed = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM bookings WHERE slot_id = ? AND status = 'confirmed'`,
    )
      .bind(slotId)
      .first<{ n: number }>();
    expect(confirmed?.n).toBe(1);
  });

  it('refuses a slot that was taken after the preview was shown', async () => {
    const slotId = await anyOpenSlot();
    const previewA = await previewBooking(env, alice, { slot_id: slotId });
    const previewB = await previewBooking(env, bob, { slot_id: slotId });

    await createBooking(env, alice, {
      confirmation_token: previewA.confirmation_token,
      idempotency_key: `stale-winner-${seq}`,
      ...acceptance(),
    });

    await expect(
      createBooking(env, bob, {
        confirmation_token: previewB.confirmation_token,
        idempotency_key: `stale-loser-${seq}`,
        ...acceptance(),
      }),
    ).rejects.toMatchObject({ code: 'slot_unavailable' });
  });

  it('refuses a confirmation token issued to another account', async () => {
    const preview = await previewBooking(env, alice, { slot_id: await anyOpenSlot() });
    await expect(
      createBooking(env, bob, {
        confirmation_token: preview.confirmation_token,
        idempotency_key: `idor-attempt-${seq}`,
        ...acceptance(),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses an expired confirmation token', async () => {
    const slotId = await anyOpenSlot();
    const preview = await previewBooking(env, alice, { slot_id: slotId });
    const { token } = await signConfirmationToken(
      KEY,
      {
        uid: alice.id,
        tid: ANNA,
        sid: slotId,
        oid: 'of_01',
        price: preview.summary.price_minor,
        cur: 'PLN',
        st: preview.summary.starts_at_utc,
        et: preview.summary.ends_at_utc,
        tz: 'Europe/Warsaw',
        mode: preview.summary.mode,
        stype: preview.summary.session_type,
        terms: env.TERMS_VERSION,
        priv: env.PRIVACY_VERSION,
      },
      -60,
    );
    await expect(
      createBooking(env, alice, { confirmation_token: token, idempotency_key: `expired-${seq}`, ...acceptance() }),
    ).rejects.toMatchObject({ code: 'token_expired' });
  });

  it('refuses a token whose price no longer matches the offer', async () => {
    const slotId = await anyOpenSlot();
    const preview = await previewBooking(env, alice, { slot_id: slotId });
    const { token } = await signConfirmationToken(KEY, {
      uid: alice.id,
      tid: ANNA,
      sid: slotId,
      oid: 'of_01',
      // A price the user "confirmed" that no longer matches the database.
      price: 100,
      cur: 'PLN',
      st: preview.summary.starts_at_utc,
      et: preview.summary.ends_at_utc,
      tz: 'Europe/Warsaw',
      mode: preview.summary.mode,
      stype: preview.summary.session_type,
      terms: env.TERMS_VERSION,
      priv: env.PRIVACY_VERSION,
    });

    await expect(
      createBooking(env, alice, { confirmation_token: token, idempotency_key: `price-${seq}`, ...acceptance() }),
    ).rejects.toMatchObject({ code: 'price_changed' });
  });

  it('refuses acceptance of a policy version other than the one previewed', async () => {
    const preview = await previewBooking(env, alice, { slot_id: await anyOpenSlot() });
    await expect(
      createBooking(env, alice, {
        confirmation_token: preview.confirmation_token,
        idempotency_key: `wrong-version-${seq}`,
        accepted_terms_version: '1999-01-01',
        accepted_privacy_version: env.PRIVACY_VERSION,
        confirm: true,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('records the accepted consent versions', async () => {
    const preview = await previewBooking(env, alice, { slot_id: await anyOpenSlot() });
    await createBooking(env, alice, {
      confirmation_token: preview.confirmation_token,
      idempotency_key: `consent-${seq}`,
      ...acceptance(),
    });
    const consents = await env.DB.prepare(
      `SELECT kind, version FROM consent_records WHERE user_id = ? AND source = 'mcp:create_booking'`,
    )
      .bind(alice.id)
      .all<{ kind: string; version: string }>();
    expect([...new Set(consents.results.map((c) => c.kind))].sort()).toEqual(['privacy', 'terms']);
    expect(consents.results.every((c) => c.version.length > 0)).toBe(true);
  });

  it('queues the confirmation e-mail outside the booking transaction', async () => {
    const preview = await previewBooking(env, alice, { slot_id: await anyOpenSlot() });
    const result = await createBooking(env, alice, {
      confirmation_token: preview.confirmation_token,
      idempotency_key: `outbox-${seq}`,
      ...acceptance(),
    });
    const outbox = await env.DB.prepare(
      `SELECT kind, status, payload_enc FROM notification_outbox WHERE booking_id = ?`,
    )
      .bind(result.booking_id)
      .first<{ kind: string; status: string; payload_enc: string }>();
    expect(outbox?.kind).toBe('booking.confirmed');
    expect(outbox?.status).toBe('pending');
    // The queued payload holds an address, so it must be encrypted at rest.
    expect(outbox?.payload_enc).not.toContain('alice@example.invalid');
  });
});

describe('cancellation', () => {
  it('cancels, releases the slot, and is idempotent', async () => {
    const [alice] = await pair();
    const slotId = await anyOpenSlot();
    const preview = await previewBooking(env, alice, { slot_id: slotId });
    const booking = await createBooking(env, alice, {
      confirmation_token: preview.confirmation_token,
      idempotency_key: `cancel-me-${seq}`,
      ...acceptance(),
    });

    const first = await cancelBooking(env, alice, { booking_id: booking.booking_id, confirm: true });
    expect(first.status).toBe('cancelled');
    expect(first.already_cancelled).toBe(false);

    const slot = await env.DB.prepare(`SELECT status FROM appointment_slots WHERE id = ?`)
      .bind(slotId)
      .first<{ status: string }>();
    expect(slot?.status).toBe('open');

    const second = await cancelBooking(env, alice, { booking_id: booking.booking_id, confirm: true });
    expect(second.status).toBe('cancelled');
    expect(second.already_cancelled).toBe(true);
  });

  it('requires an explicit confirmation', async () => {
    const [alice] = await pair();
    await expect(
      cancelBooking(env, alice, { booking_id: 'bk_0000000000000000000000aa', confirm: false }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it("refuses to cancel somebody else's booking and does not confirm it exists", async () => {
    const [alice, bob] = await pair();
    const preview = await previewBooking(env, alice, { slot_id: await anyOpenSlot() });
    const booking = await createBooking(env, alice, {
      confirmation_token: preview.confirmation_token,
      idempotency_key: `not-yours-${seq}`,
      ...acceptance(),
    });

    await expect(
      cancelBooking(env, bob, { booking_id: booking.booking_id, confirm: true }),
    ).rejects.toMatchObject({ code: 'not_found' });

    const still = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`)
      .bind(booking.booking_id)
      .first<{ status: string }>();
    expect(still?.status).toBe('confirmed');
  });
});

describe('booking needs explicit consent', () => {
  it('refuses to create a booking when confirm is not true', async () => {
    const [alice] = await pair();
    const preview = await previewBooking(env, alice, { slot_id: await anyOpenSlot() });
    // Holding a valid confirmation token is NOT consent: a model can obtain one
    // and call straight through without ever asking the person.
    await expect(
      createBooking(env, alice, {
        confirmation_token: preview.confirmation_token,
        idempotency_key: `no-consent-${seq}`,
        ...acceptance(),
        confirm: false,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('my bookings', () => {
  it('returns only the caller own bookings', async () => {
    const [alice, bob] = await pair();
    const preview = await previewBooking(env, alice, { slot_id: await anyOpenSlot() });
    await createBooking(env, alice, {
      confirmation_token: preview.confirmation_token,
      idempotency_key: `mine-${seq}`,
      ...acceptance(),
    });

    expect((await listMyBookings(env, alice)).length).toBe(1);
    expect(await listMyBookings(env, bob)).toEqual([]);
  });
});
