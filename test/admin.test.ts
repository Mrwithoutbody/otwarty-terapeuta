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
      `SELECT id, display_name, is_demo, timezone, created_at, updated_at, cancellation_cutoff_h, status
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
        status: string;
      }>();
    expect(row).not.toBeNull();
    expect(row!.display_name).toBe('Nowa Osoba');
    expect(row!.is_demo).toBe(0);
    expect(row!.timezone).toBe('Europe/Warsaw');
    expect(row!.status).toBe('published');
    // Treść należy do edytora stron: panel jej nie zapisuje, kolumny biorą wartości domyślne.
    expect(row!.cancellation_cutoff_h).toBe(24);

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
    expect(after!.cancellation_cutoff_h).toBe(24);
    expect(after!.is_demo).toBe(1);
    expect(after!.timezone).toBe('Europe/Berlin');
    expect(after!.created_at).toBe(row!.created_at);
  });
});

describe('edycja istniejącej oferty', () => {
  it('zmienia cenę i czas, i potrafi ofertę wyłączyć', async () => {
    const admin = await actor('admin-oferta@example.invalid', 'admin');
    const offer = await env.DB.prepare(
      `SELECT id, title, duration_minutes, price_minor FROM session_offers WHERE therapist_id = ? AND active = 1 LIMIT 1`,
    )
      .bind(ANNA)
      .first<{ id: string; title: string; duration_minutes: number; price_minor: number }>();
    expect(offer).not.toBeNull();

    const panel = await (await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}`, { headers: { cookie: admin.cookie } })).text();
    // Istniejąca oferta jest formularzem, nie wierszem tabeli.
    expect(panel).toContain(`action="/admin/terapeuci/${ANNA}/oferta/${offer!.id}"`);
    expect(panel).toContain(`value="${offer!.price_minor / 100}"`);

    const saved = await SELF.fetch(
      `https://localhost/admin/terapeuci/${ANNA}/oferta/${offer!.id}`,
      form(admin, {
        title: 'Sesja indywidualna online',
        session_type: 'individual',
        mode: 'online',
        duration_minutes: '60',
        price: '190',
        active: '1',
      }),
    );
    expect(saved.status).toBe(302);

    const after = await env.DB.prepare(`SELECT duration_minutes, price_minor, active FROM session_offers WHERE id = ?`)
      .bind(offer!.id)
      .first<{ duration_minutes: number; price_minor: number; active: number }>();
    expect(after).toEqual({ duration_minutes: 60, price_minor: 19_000, active: 1 });

    // Bez zaznaczonego pola oferta znika z profilu, ale zostaje w bazie.
    await SELF.fetch(
      `https://localhost/admin/terapeuci/${ANNA}/oferta/${offer!.id}`,
      form(admin, { title: offer!.title, session_type: 'individual', mode: 'online', duration_minutes: '60', price: '190' }),
    );
    const off = await env.DB.prepare(`SELECT active FROM session_offers WHERE id = ?`).bind(offer!.id).first<{ active: number }>();
    expect(off!.active).toBe(0);

    // Sprzątanie: kolejne testy w tym pliku liczą na aktywną ofertę Anny.
    await env.DB.prepare(`UPDATE session_offers SET active = 1, duration_minutes = ?, price_minor = ? WHERE id = ?`)
      .bind(offer!.duration_minutes, offer!.price_minor, offer!.id)
      .run();
  });
});
