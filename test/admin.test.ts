import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAdminSession, loadAdminSession } from '../src/auth/session';
import { findOrCreateUserByEmail } from '../src/db/users';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';
const ANNA_ONLINE_OFFER = 'of_01';
const MAREK = 'th_8b2d6e10f4a97c53d1e08b26';

interface Actor {
  cookie: string;
  csrf: string;
}

/** Signs a role in without going through the e-mail code screens. */
async function actor(email: string, role: string, therapistId: string | null = null): Promise<Actor> {
  const user = await findOrCreateUserByEmail(env, email);
  await env.DB.prepare(`UPDATE users SET role = ?, therapist_id = ? WHERE id = ?`)
    .bind(role, therapistId, user.id)
    .run();

  const { cookie } = await createAdminSession(env, user.id);
  const session = await loadAdminSession(
    env,
    new Request('https://localhost/admin', { headers: { cookie } }),
  );
  if (!session) throw new Error('nie udało się utworzyć sesji testowej');
  return { cookie, csrf: session.csrfToken };
}

function form(actorInfo: Actor, fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: {
      cookie: actorInfo.cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ csrf: actorInfo.csrf, ...fields }).toString(),
    redirect: 'manual',
  };
}

async function generatedSlots(offerId: string): Promise<Array<{ starts_at_utc: string; timezone: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT starts_at_utc, timezone FROM appointment_slots WHERE offer_id = ? ORDER BY starts_at_utc`,
  )
    .bind(offerId)
    .all<{ starts_at_utc: string; timezone: string }>();
  return results;
}

function localHour(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('pl-PL', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

describe('logowanie do panelu', () => {
  it('informuje o możliwym opóźnieniu wiadomości z kodem', async () => {
    const response = await SELF.fetch('https://localhost/admin');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Wiadomość może czasem dotrzeć z opóźnieniem');
  });
});

describe('slot generation through the admin panel', () => {
  let admin: Actor;

  beforeAll(async () => {
    admin = await actor('admin-slots@example.invalid', 'admin');
  });

  it('creates slots at the requested LOCAL hour, not the UTC hour', async () => {
    // 21:00 is outside the hour lanes the seed uses, so nothing collides.
    const response = await SELF.fetch(
      `https://localhost/admin/terapeuci/${ANNA}/terminy`,
      form(admin, {
        offer_id_manual: ANNA_ONLINE_OFFER,
        days: '30',
        hours: '21',
        timezone: 'Europe/Warsaw',
      }),
    );
    expect(response.status).toBe(302);

    const slots = (await generatedSlots(ANNA_ONLINE_OFFER)).filter(
      (s) => localHour(s.starts_at_utc, 'Europe/Warsaw') === '21:00',
    );
    expect(slots.length).toBeGreaterThan(15);

    // Every single one reads back as 21:00 for the therapist, whatever the
    // UTC hour ended up being.
    for (const slot of slots) {
      expect(localHour(slot.starts_at_utc, slot.timezone)).toBe('21:00');
      expect(slot.timezone).toBe('Europe/Warsaw');
    }

    // Whether this particular window crosses a DST change depends on when the
    // suite runs; the transition itself is pinned by the unit tests in
    // `unit.test.ts`. Here we assert the invariants that must hold always.
    expect(slots.every((s) => Date.parse(s.starts_at_utc) > Date.now())).toBe(true);
    expect(new Set(slots.map((s) => s.starts_at_utc)).size).toBe(slots.length);
  });

  it('honours a non-Polish therapist timezone', async () => {
    const response = await SELF.fetch(
      `https://localhost/admin/terapeuci/${MAREK}/terminy`,
      form(admin, {
        offer_id_manual: 'of_03',
        days: '10',
        hours: '9',
        timezone: 'Asia/Kolkata',
      }),
    );
    expect(response.status).toBe(302);

    const slots = (await generatedSlots('of_03')).filter((s) => s.timezone === 'Asia/Kolkata');
    expect(slots.length).toBeGreaterThan(3);
    for (const slot of slots) {
      expect(localHour(slot.starts_at_utc, 'Asia/Kolkata')).toBe('09:00');
      // +05:30 offset means the UTC instant lands at 03:30 the same day.
      expect(slot.starts_at_utc.slice(11, 16)).toBe('03:30');
    }
  });

  it('refuses an unknown timezone instead of silently defaulting', async () => {
    const before = (await generatedSlots('of_02')).length;
    const response = await SELF.fetch(
      `https://localhost/admin/terapeuci/${ANNA}/terminy`,
      form(admin, {
        offer_id_manual: 'of_02',
        days: '5',
        hours: '20',
        timezone: 'Mars/Olympus',
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Nieznana strefa czasowa');
    expect((await generatedSlots('of_02')).length).toBe(before);
  });

  it('skips weekends in the therapist timezone', async () => {
    await SELF.fetch(
      `https://localhost/admin/terapeuci/${ANNA}/terminy`,
      form(admin, {
        offer_id_manual: ANNA_ONLINE_OFFER,
        days: '21',
        hours: '22',
        timezone: 'Europe/Warsaw',
      }),
    );
    const slots = (await generatedSlots(ANNA_ONLINE_OFFER)).filter(
      (s) => localHour(s.starts_at_utc, 'Europe/Warsaw') === '22:00',
    );
    expect(slots.length).toBeGreaterThan(10);
    for (const slot of slots) {
      const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Warsaw',
        weekday: 'short',
      }).format(new Date(slot.starts_at_utc));
      expect(['Sat', 'Sun']).not.toContain(weekday);
    }
  });
});

describe('admin panel authorisation', () => {
  it('rejects a write without a valid CSRF token', async () => {
    const admin = await actor('admin-csrf@example.invalid', 'admin');
    const response = await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}/terminy`, {
      method: 'POST',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: 'podrobiony', offer_id_manual: ANNA_ONLINE_OFFER }).toString(),
      redirect: 'manual',
    });
    expect(response.status).toBe(403);
  });

  it('rejects a write with no session at all', async () => {
    const response = await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}/terminy`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: 'x', offer_id_manual: ANNA_ONLINE_OFFER }).toString(),
      redirect: 'manual',
    });
    expect(response.status).toBe(401);
  });

  it("stops a therapist from touching another therapist's availability", async () => {
    const marek = await actor('marek@example.invalid', 'therapist', MAREK);
    const before = (await generatedSlots(ANNA_ONLINE_OFFER)).length;

    const response = await SELF.fetch(
      `https://localhost/admin/terapeuci/${ANNA}/terminy`,
      form(marek, {
        offer_id_manual: ANNA_ONLINE_OFFER,
        days: '5',
        hours: '23',
        timezone: 'Europe/Warsaw',
      }),
    );
    expect(response.status).toBe(403);
    expect((await generatedSlots(ANNA_ONLINE_OFFER)).length).toBe(before);
  });

  it('lets a therapist manage their own availability', async () => {
    const marek = await actor('marek@example.invalid', 'therapist', MAREK);
    const response = await SELF.fetch(
      `https://localhost/admin/terapeuci/${MAREK}/terminy`,
      form(marek, {
        offer_id_manual: 'of_04',
        days: '7',
        hours: '19',
        timezone: 'Europe/Warsaw',
      }),
    );
    expect(response.status).toBe(302);
    const slots = await generatedSlots('of_04');
    expect(slots.some((s) => localHour(s.starts_at_utc, 'Europe/Warsaw') === '19:00')).toBe(true);
  });

  it('does not let support generate availability', async () => {
    const support = await actor('support@example.invalid', 'support');
    const response = await SELF.fetch(
      `https://localhost/admin/terapeuci/${ANNA}/terminy`,
      form(support, {
        offer_id_manual: ANNA_ONLINE_OFFER,
        days: '5',
        hours: '23',
        timezone: 'Europe/Warsaw',
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe('zapis terapeutki jednym UPSERT-em', () => {
  it('zakłada wiersz, a przy edycji nie rusza is_demo, timezone ani created_at', async () => {
    const admin = await actor('admin-upsert@example.invalid', 'admin');

    const created = await SELF.fetch(
      'https://localhost/admin/terapeuci/nowy',
      form(admin, {
        slug: 'nowa-osoba-upsert',
        display_name: 'Nowa Osoba',
        headline: 'psychoterapeutka',
        bio: 'Pracuję krótko.',
        status: 'published',
        verification_status: 'verified',
        offers_online: '1',
        cancellation_cutoff_h: '48',
      }),
    );
    expect(created.status).toBe(302);

    const row = await env.DB.prepare(
      `SELECT id, display_name, is_demo, timezone, created_at, updated_at, cancellation_cutoff_h
         FROM therapists WHERE slug = ?`,
    )
      .bind('nowa-osoba-upsert')
      .first<{
        id: string;
        display_name: string;
        is_demo: number;
        timezone: string;
        created_at: string;
        updated_at: string;
        cancellation_cutoff_h: number;
      }>();
    expect(row).not.toBeNull();
    expect(row!.display_name).toBe('Nowa Osoba');
    expect(row!.is_demo).toBe(0);
    expect(row!.timezone).toBe('Europe/Warsaw');

    // Wiersz wygląda jak zaimportowany: demo, inna strefa. Edycja ma to zostawić.
    await env.DB.prepare(`UPDATE therapists SET is_demo = 1, timezone = 'Europe/Berlin' WHERE id = ?`)
      .bind(row!.id)
      .run();

    const updated = await SELF.fetch(
      `https://localhost/admin/terapeuci/${row!.id}`,
      form(admin, {
        slug: 'nowa-osoba-upsert',
        display_name: 'Nowa Osoba (po edycji)',
        headline: 'psychoterapeutka',
        bio: 'Pracuję krótko.',
        status: 'published',
        verification_status: 'verified',
        offers_online: '1',
        cancellation_cutoff_h: '72',
      }),
    );
    expect(updated.status).toBe(302);

    const after = await env.DB.prepare(
      `SELECT display_name, is_demo, timezone, created_at, cancellation_cutoff_h
         FROM therapists WHERE id = ?`,
    )
      .bind(row!.id)
      .first<{
        display_name: string;
        is_demo: number;
        timezone: string;
        created_at: string;
        cancellation_cutoff_h: number;
      }>();
    expect(after!.display_name).toBe('Nowa Osoba (po edycji)');
    expect(after!.cancellation_cutoff_h).toBe(72);
    expect(after!.is_demo).toBe(1);
    expect(after!.timezone).toBe('Europe/Berlin');
    expect(after!.created_at).toBe(row!.created_at);
  });
});
