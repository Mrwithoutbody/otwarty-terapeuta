import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
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

async function scheduleOf(offerId: string): Promise<string> {
  const row = await env.DB.prepare(`SELECT schedule FROM session_offers WHERE id = ?`).bind(offerId).first<{ schedule: string }>();
  return row?.schedule ?? '';
}

describe('logowanie do panelu', () => {
  it('informuje o możliwym opóźnieniu wiadomości z kodem', async () => {
    const response = await SELF.fetch('https://localhost/admin');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Wiadomość może czasem dotrzeć z opóźnieniem');
  });
});

describe('admin panel authorisation', () => {
  it('rejects a write without a valid CSRF token', async () => {
    const admin = await actor('admin-csrf@example.invalid', 'admin');
    const response = await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}/grafik`, {
      method: 'POST',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: 'podrobiony', offer: ANNA_ONLINE_OFFER }).toString(),
      redirect: 'manual',
    });
    expect(response.status).toBe(403);
  });

  it('rejects a write with no session at all', async () => {
    const response = await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}/grafik`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: 'x', offer: ANNA_ONLINE_OFFER }).toString(),
      redirect: 'manual',
    });
    expect(response.status).toBe(401);
  });

  it("stops a therapist from touching another therapist's availability", async () => {
    const marek = await actor('marek@example.invalid', 'therapist', MAREK);
    const before = await scheduleOf(ANNA_ONLINE_OFFER);

    const response = await SELF.fetch(
      `https://localhost/admin/terapeuci/${ANNA}/grafik`,
      form(marek, { offer: ANNA_ONLINE_OFFER, g_of_01: '1-21', timezone: 'Europe/Warsaw' }),
    );
    expect(response.status).toBe(403);
    expect(await scheduleOf(ANNA_ONLINE_OFFER)).toBe(before);
  });

  it('lets a therapist manage their own availability', async () => {
    const marek = await actor('marek@example.invalid', 'therapist', MAREK);
    const response = await SELF.fetch(
      `https://localhost/admin/terapeuci/${MAREK}/grafik`,
      form(marek, { offer: 'of_04', g_of_04: '4-19', timezone: 'Europe/Warsaw' }),
    );
    expect(response.status).toBe(302);
    expect(JSON.parse(await scheduleOf('of_04'))[4]).toEqual([19]);
  });

  it('does not let support change availability', async () => {
    const support = await actor('support@example.invalid', 'support');
    const response = await SELF.fetch(
      `https://localhost/admin/terapeuci/${ANNA}/grafik`,
      form(support, { offer: ANNA_ONLINE_OFFER, g_of_01: '1-21', timezone: 'Europe/Warsaw' }),
    );
    expect(response.status).toBe(403);
  });
});

describe('zakładanie profilu i weryfikacja', () => {
  it('zakłada wiersz z imieniem i adresem, a weryfikacja nie rusza is_demo, timezone ani created_at', async () => {
    const admin = await actor('admin-upsert@example.invalid', 'admin');

    const created = await SELF.fetch(
      'https://localhost/admin/terapeuci/nowy',
      // Stary formularz mógł nieść treść i status: nowy profil i tak zaczyna jako roboczy, bez treści.
      form(admin, { slug: 'Nowa Osoba Łódź', display_name: 'Nowa Osoba', bio: 'Pracuję krótko.', status: 'published' }),
    );
    expect(created.status).toBe(302);

    const row = await env.DB.prepare(
      `SELECT id, display_name, bio, is_demo, timezone, created_at, cancellation_cutoff_h, status FROM therapists WHERE slug = ?`,
    )
      .bind('nowa-osoba-lodz')
      .first<{ id: string; display_name: string; bio: string; is_demo: number; timezone: string; created_at: string; cancellation_cutoff_h: number; status: string }>();
    expect(row).not.toBeNull();
    expect(created.headers.get('location')).toBe(`/admin/terapeuci/${row!.id}`);
    expect(row!.display_name).toBe('Nowa Osoba');
    expect(row!.bio).toBe('');
    expect(row!.status).toBe('draft');
    expect(row!.is_demo).toBe(0);
    expect(row!.timezone).toBe('Europe/Warsaw');
    expect(row!.cancellation_cutoff_h).toBe(24);

    const twice = await SELF.fetch('https://localhost/admin/terapeuci/nowy', form(admin, { slug: 'nowa-osoba-lodz', display_name: 'Ktoś inny' }));
    expect(twice.status).toBe(409);

    // Wiersz wygląda jak zaimportowany: demo, inna strefa. Weryfikacja ma to zostawić.
    await env.DB.prepare(`UPDATE therapists SET is_demo = 1, timezone = 'Europe/Berlin' WHERE id = ?`).bind(row!.id).run();
    const verified = await SELF.fetch(
      `https://localhost/admin/terapeuci/${row!.id}`,
      form(admin, { status: 'published', verification_status: 'verified', display_name: 'Nadpisane', slug: 'nadpisane' }),
    );
    expect(verified.status).toBe(302);

    const after = await env.DB.prepare(
      `SELECT slug, display_name, status, verification_status, verified_at, is_demo, timezone, created_at FROM therapists WHERE id = ?`,
    )
      .bind(row!.id)
      .first<{ slug: string; display_name: string; status: string; verification_status: string; verified_at: string | null; is_demo: number; timezone: string; created_at: string }>();
    expect(after!.status).toBe('published');
    expect(after!.verification_status).toBe('verified');
    expect(after!.verified_at).not.toBeNull();
    // Imię i adres po założeniu zmienia się w edytorze strony, nie tym formularzem.
    expect(after!.display_name).toBe('Nowa Osoba');
    expect(after!.slug).toBe('nowa-osoba-lodz');
    expect(after!.is_demo).toBe(1);
    expect(after!.timezone).toBe('Europe/Berlin');
    expect(after!.created_at).toBe(row!.created_at);
  });
});
