import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getTherapist } from '../../../shared/db/catalog';
import { FIELDS, OFFER_ROWS } from '../web/data-fields';
import { writeProfileData } from '../web/profile-write';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';
const MAREK = 'th_8b2d6e10f4a97c53d1e08b26';
const JULIA = 'th_c93e5a4187b6f20d94a1c3f5';

describe('fakty profilu z „Dane i cennik” trafiają do bazy', () => {
  it('cennik: poprawia ofertę, a wiersz, którego zabrakło, wyłącza', async () => {
    const before = (await getTherapist(env, { therapist_id: ANNA }))!;
    const offerId = before.offers[0]!.offer_id;
    const touched = await writeProfileData(env, ANNA, {
      offers: { offer_rows: [{ id: offerId, title: 'Sesja indywidualna online', price: '260', minutes: '55', mode: 'online' }] },
    });
    expect(touched).toContain('offers');
    const after = (await getTherapist(env, { therapist_id: ANNA }))!;
    const offer = after.offers.find((o) => o.offer_id === offerId)!;
    expect(offer.price_minor).toBe(26_000);
    expect(offer.duration_minutes).toBe(55);
    expect(after.offers.length).toBe(1);
  });

  it('jak pracuje: forma, dla kogo, języki i zasady odwołania', async () => {
    await writeProfileData(env, ANNA, {
      practice: {
        offers_online: '1', offers_in_person: '1', accepting_new_clients: '0',
        session_types: ['individual', 'couples'], age_groups: ['adults', 'seniors'], languages: ['pl', 'en'],
        cancellation_cutoff_h: '36', cancellation_policy: 'Odwołanie do 36 godzin przed sesją jest bezpłatne.',
      },
    });
    const t = (await getTherapist(env, { therapist_id: ANNA }, { drafts: true }))!;
    expect(t.offers_in_person).toBe(true);
    expect(t.accepting_new_clients).toBe(false);
    expect(t.session_types.sort()).toEqual(['couples', 'individual']);
    expect(t.age_groups.sort()).toEqual(['adults', 'seniors']);
    expect(t.languages.sort()).toEqual(['en', 'pl']);
    expect(t.cancellation_cutoff_hours).toBe(36);
    expect(t.cancellation_policy).toContain('36 godzin');
  });

  it('każde pole umie i przeczytać, i zapisać - nowe pole nie wymaga zmiany w zapisie', () => {
    for (const [group, fields] of Object.entries(FIELDS)) {
      for (const f of fields) {
        expect(typeof f.read, `${group}.${f.field.name}`).toBe('function');
        expect(typeof f.write, `${group}.${f.field.name}`).toBe('function');
      }
    }
  });

  it('obszary i nurty idą do tabel wiążących, tylko ze słownika', async () => {
    await writeProfileData(env, ANNA, { topics: { topics: ['zaloba', 'lek', 'nie-ma-takiego'], modalities: ['psychodynamiczna'] } });
    const t = (await getTherapist(env, { therapist_id: ANNA }, { drafts: true }))!;
    expect(t.topics.map((x) => x.slug).sort()).toEqual(['lek', 'zaloba']);
    expect(t.modalities.map((x) => x.slug)).toEqual(['psychodynamiczna']);
  });

  it('gabinet: miasto i adres to jeden rekord, puste miasto go zdejmuje, wielkie litery nie robią drugiego miasta', async () => {
    await writeProfileData(env, ANNA, { office: { city: 'KRAKÓW', address_line: 'ul. Długa 5' } });
    let t = (await getTherapist(env, { therapist_id: ANNA }, { drafts: true }))!;
    expect(t.locations[0]).toMatchObject({ city: 'Kraków', address_line: 'ul. Długa 5' });
    await writeProfileData(env, ANNA, { office: { city: '', address_line: 'ul. Długa 5' } });
    t = (await getTherapist(env, { therapist_id: ANNA }, { drafts: true }))!;
    expect(t.locations).toEqual([]);
  });

  it('kwalifikacje: zapis nie kasuje weryfikacji ani wpisów spoza formularza', async () => {
    const stored = [
      { title: 'Certyfikat psychoterapeuty', issuer: 'PTPP', year: 2017, verified: true },
      ...Array.from({ length: 6 }, (_, i) => ({ title: `Kurs ${i + 1}`, issuer: 'Szkoła', year: 2020, verified: false })),
    ];
    await env.DB.prepare(`UPDATE therapists SET credentials = ? WHERE id = ?`).bind(JSON.stringify(stored), MAREK).run();
    const shown = stored.slice(0, 6).map((c) => ({ title: c.title, issuer: c.issuer, year: '2018' }));
    await writeProfileData(env, MAREK, { credentials: { credential_rows: shown } });
    const row = await env.DB.prepare(`SELECT credentials FROM therapists WHERE id = ?`).bind(MAREK).first<{ credentials: string }>();
    const after = JSON.parse(row!.credentials) as Array<{ title: string; year: number; verified: boolean }>;
    expect(after).toHaveLength(7);
    expect(after[0]).toMatchObject({ title: 'Certyfikat psychoterapeuty', year: 2018, verified: true });
    expect(after[1]!.verified).toBe(false);
    expect(after[6]!.title).toBe('Kurs 6');
  });

  it('cennik: przy ofertach ponad limit formularza zapis niczego nie wyłącza', async () => {
    const at = '2026-09-01T00:00:00Z';
    for (let i = 0; i <= OFFER_ROWS; i++) {
      await env.DB.prepare(
        `INSERT INTO session_offers (id, therapist_id, title, session_type, mode, duration_minutes, price_minor, currency, active, created_at, updated_at)
         VALUES (?, ?, ?, 'couples', 'online', 50, ?, 'PLN', 1, ?, ?)`,
      ).bind(`of_limit_${i}`, MAREK, `Oferta ${i}`, 90000 + i, at, at).run();
    }
    const active = async (): Promise<number> =>
      (await env.DB.prepare(`SELECT COUNT(*) n FROM session_offers WHERE therapist_id = ? AND active = 1`).bind(MAREK).first<{ n: number }>())!.n;
    const before = await active();
    expect(before).toBeGreaterThan(OFFER_ROWS);
    await writeProfileData(env, MAREK, { offers: { offer_rows: [{ id: 'of_limit_0', title: 'Oferta 0 po zmianie', price: '900', minutes: '50', mode: 'online' }] } });
    expect(await active()).toBe(before);
    const edited = await env.DB.prepare(`SELECT title, session_type FROM session_offers WHERE id = 'of_limit_0'`).first<{ title: string; session_type: string }>();
    expect(edited).toEqual({ title: 'Oferta 0 po zmianie', session_type: 'couples' });
  });

  it('typ oferty: zapisuje go, brak w wierszu niczego nie nadpisuje, obcy spada na domyślny', async () => {
    await writeProfileData(env, JULIA, { offers: { offer_rows: [{ title: 'Sesja dla par', type: 'couples', price: '300', minutes: '80', mode: 'online' }] } });
    const offer = (await env.DB.prepare(`SELECT id, session_type FROM session_offers WHERE therapist_id = ? AND title = 'Sesja dla par'`).bind(JULIA).first<{ id: string; session_type: string }>())!;
    expect(offer.session_type).toBe('couples');
    await writeProfileData(env, JULIA, { offers: { offer_rows: [{ id: offer.id, title: 'Sesja dla par', price: '320', minutes: '80', mode: 'online' }] } });
    expect(await env.DB.prepare(`SELECT session_type, price_minor FROM session_offers WHERE id = ?`).bind(offer.id).first()).toEqual({ session_type: 'couples', price_minor: 32000 });
    await writeProfileData(env, JULIA, { offers: { offer_rows: [{ id: offer.id, title: 'Sesja dla par', type: 'grupowa', price: '320', minutes: '80', mode: 'online' }] } });
    expect((await env.DB.prepare(`SELECT session_type FROM session_offers WHERE id = ?`).bind(offer.id).first<{ session_type: string }>())!.session_type).toBe('individual');
  });
});
