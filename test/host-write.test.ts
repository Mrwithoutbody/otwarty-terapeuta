import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getTherapist } from '../src/db/catalog';
import { writeToken } from '../src/web/host-write';
import { ensureProfilePage } from '../src/web/lp';
import { getPage } from '../src/web/pages-client';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';

const write = async (data: Record<string, unknown>, token?: string) =>
  SELF.fetch('https://localhost/api/host-blocks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: token ?? (await writeToken(env, ANNA)), data }),
  });

describe('strona po edycji wraca do bazy', () => {
  it('zapisuje JSON strony pod jej stroną, a poprawka wygrywa tylko w swoim polu', async () => {
    const profile = await ensureProfilePage(env, ANNA, 'Anna Kowalczyk (DEMO)');
    const page = {
      theme: 'lex',
      blocks: [
        { id: 'hero-profil', type: 'hero', kind: 'siatka', layout: 'kolumny-2', tone: 'base', data: { heading: 'Anna, po prostu' } },
        { id: 'offers', type: 'pricing', kind: 'siatka', layout: 'lista', tone: 'base', data: {} },
      ],
    };
    const res = await SELF.fetch(`https://localhost/api/host-blocks?page=${profile.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: await writeToken(env, ANNA), page }),
    });
    expect(res.status).toBe(200);
    const stored = (await getPage(env, profile.id))!;
    expect(stored.theme).toBe('lex');
    expect(stored.page).toEqual(page);

    const html = await (await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo')).text();
    expect(html).toContain('Anna, po prostu');
    expect(html).toContain('data-t="lex"');
    // Cennik liczy się świeżo z bazy, nie z zapisanej strony.
    expect(html).toContain('Sesja indywidualna online');

    // Cudza strona: token Anny nie zapisze strony Marka.
    const marek = await ensureProfilePage(env, 'th_8b2d6e10f4a97c53d1e08b26', 'Marek');
    const foreign = await SELF.fetch(`https://localhost/api/host-blocks?page=${marek.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: await writeToken(env, ANNA), page }),
    });
    expect(foreign.status).toBe(404);
    expect((await getPage(env, marek.id))!.page).toEqual({});
  });
});

describe('pola danych bloku wracają do bazy', () => {
  it('zapisuje cennik, opis i FAQ, a wiersz bez nazwy wyłącza ofertę', async () => {
    const before = (await getTherapist(env, { therapist_id: ANNA }))!;
    const offerId = before.offers[0]!.offer_id;

    const res = await write({
      intro: { bio: 'Nowy opis pracy.' },
      offers: { offer_rows: [{ id: offerId, title: 'Sesja indywidualna online', price: '260', minutes: '55', mode: 'online' }] },
    });
    expect(res.status).toBe(200);
    const fresh = (await res.json()) as { resolved: Record<string, { offer_rows?: unknown[] }>; summary: Record<string, { text: string }> };
    expect(fresh.summary.offers!.text).toContain('260');

    const after = (await getTherapist(env, { therapist_id: ANNA }))!;
    expect(after.bio).toBe('Nowy opis pracy.');
    const offer = after.offers.find((o) => o.offer_id === offerId)!;
    expect(offer.price_minor).toBe(26_000);
    expect(offer.duration_minutes).toBe(55);
    // Oferty, której formularz nie przysłał, nie ma już w profilu.
    expect(after.offers.length).toBe(1);

    // Nowe pytanie do FAQ powstaje z wiersza bez identyfikatora.
    const faq = await write({ 'faq-profil': { faq_rows: [{ q: 'Czy pracujesz online?', a: 'Tak, w całej Polsce.' }] } });
    expect(faq.status).toBe(200);
    const items = await env.DB.prepare(`SELECT question, status FROM faq_items WHERE therapist_id = ? AND status = 'published'`)
      .bind(ANNA)
      .all<{ question: string; status: string }>();
    expect(items.results.map((r) => r.question)).toEqual(['Czy pracujesz online?']);
  });

  it('bez ważnego tokenu nie zapisuje niczego', async () => {
    const forged = await writeToken(env, ANNA);
    const [id, exp, sig] = forged.split('.');
    expect((await write({ intro: { bio: 'nie' } }, `${id}.${exp}.${sig!.slice(0, -2)}xx`)).status).toBe(401);
    expect((await write({ intro: { bio: 'nie' } }, `${id}.${Math.floor(Date.now() / 1000) - 10}.${sig}`)).status).toBe(401);
    expect((await write({ intro: { bio: 'nie' } }, 'bzdura')).status).toBe(401);
    const t = (await getTherapist(env, { therapist_id: ANNA }))!;
    expect(t.bio).not.toBe('nie');
  });
});

describe('blok "Podstawowe informacje" jest edytowalny', () => {
  it('zapisuje formę, dla kogo, języki i zasady odwołania', async () => {
    const res = await write({
      dane: {
        offers_online: '1',
        offers_in_person: '1',
        accepting_new_clients: '0',
        session_types: ['individual', 'couples'],
        age_groups: ['adults', 'seniors'],
        languages: ['pl', 'en'],
        cancellation_cutoff_h: '36',
        cancellation_policy: 'Odwołanie do 36 godzin przed sesją jest bezpłatne.',
      },
    });
    expect(res.status).toBe(200);

    const t = (await getTherapist(env, { therapist_id: ANNA }, { drafts: true }))!;
    expect(t.offers_in_person).toBe(true);
    expect(t.accepting_new_clients).toBe(false);
    expect(t.session_types.sort()).toEqual(['couples', 'individual']);
    expect(t.age_groups.sort()).toEqual(['adults', 'seniors']);
    expect(t.languages.sort()).toEqual(['en', 'pl']);
    expect(t.cancellation_cutoff_hours).toBe(36);
    expect(t.cancellation_policy).toContain('36 godzin');
  });

  it('nowe pole nie wymaga zmiany w zapisie: wszystko idzie z jednej tabeli', async () => {
    const { FIELDS } = await import('../src/web/data-fields');
    // Każde pole danych umie i przeczytać, i zapisać - inaczej blok pokazywałby
    // wartość, której nie da się tknąć (albo odwrotnie).
    for (const [type, fields] of Object.entries(FIELDS)) {
      for (const f of fields) {
        expect(typeof f.read, `${type}.${f.field.name}`).toBe('function');
        expect(typeof f.write, `${type}.${f.field.name}`).toBe('function');
        // Pole wyliczone jest tylko do odczytu i mówi, skąd się bierze; reszta jest związana z bazą.
        if (f.field.kind === 'computed') expect(f.field.hint, `${type}.${f.field.name}`).toMatch(/^z: /);
        else expect(f.field.data, `${type}.${f.field.name}`).toBe(true);
      }
    }
  });
});

describe('związania, których brakowało', () => {
  it('obszary i nurty: opcje z bazy w definicji, zapis do tabel wiążących', async () => {
    const { hostBlockDefs } = await import('../src/web/host-blocks');
    const defs = hostBlockDefs({ topics: [['lek', 'lęk i niepokój']], modalities: [['cbt', 'CBT']] });
    const topics = defs.topics!.fields!.find((f) => f.name === 'topics')!;
    expect(topics.kind).toBe('multiselect');
    expect(topics.options).toEqual([['lek', 'lęk i niepokój']]);

    const res = await write({ topics: { topics: ['zaloba', 'lek'], modalities: ['psychodynamiczna'] } });
    expect(res.status).toBe(200);
    const t = (await getTherapist(env, { therapist_id: ANNA }, { drafts: true }))!;
    expect(t.topics.map((x) => x.slug).sort()).toEqual(['lek', 'zaloba']);
    expect(t.modalities.map((x) => x.slug)).toEqual(['psychodynamiczna']);
  });

  it('gabinet: miasto i adres to jeden rekord, puste miasto go zdejmuje', async () => {
    expect((await write({ gabinet: { city: 'Kraków', address_line: 'ul. Długa 5' } })).status).toBe(200);
    let t = (await getTherapist(env, { therapist_id: ANNA }, { drafts: true }))!;
    expect(t.locations[0]).toMatchObject({ city: 'Kraków', address_line: 'ul. Długa 5' });

    expect((await write({ gabinet: { city: '', address_line: 'ul. Długa 5' } })).status).toBe(200);
    t = (await getTherapist(env, { therapist_id: ANNA }, { drafts: true }))!;
    expect(t.locations).toEqual([]);
  });

  it('kwalifikacje: zapis z edytora nie kasuje weryfikacji ani wpisów spoza formularza', async () => {
    const MAREK = 'th_8b2d6e10f4a97c53d1e08b26';
    const stored = [
      { title: 'Certyfikat psychoterapeuty', issuer: 'PTPP', year: 2017, verified: true },
      ...Array.from({ length: 6 }, (_, i) => ({ title: `Kurs ${i + 1}`, issuer: 'Szkoła', year: 2020, verified: false })),
    ];
    await env.DB.prepare(`UPDATE therapists SET credentials = ? WHERE id = ?`).bind(JSON.stringify(stored), MAREK).run();

    // Formularz widzi sześć pierwszych; terapeuta poprawia rok i dopisuje nic więcej.
    const shown = stored.slice(0, 6).map((c) => ({ title: c.title, issuer: c.issuer, year: '2018' }));
    const res = await write({ credentials: { credential_rows: shown } }, await writeToken(env, MAREK));
    expect(res.status).toBe(200);

    const row = await env.DB.prepare(`SELECT credentials FROM therapists WHERE id = ?`).bind(MAREK).first<{ credentials: string }>();
    const after = JSON.parse(row!.credentials) as Array<{ title: string; year: number; verified: boolean }>;
    expect(after).toHaveLength(7);
    expect(after[0]).toMatchObject({ title: 'Certyfikat psychoterapeuty', year: 2018, verified: true });
    expect(after[1]!.verified).toBe(false);
    expect(after[6]!.title).toBe('Kurs 6');
  });

  it('cennik: przy ofertach ponad limit formularza zapis niczego nie wyłącza', async () => {
    const { OFFER_ROWS } = await import('../src/web/host-blocks');
    const MAREK = 'th_8b2d6e10f4a97c53d1e08b26';
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

    const res = await write({ offers: { offer_rows: [{ id: 'of_limit_0', title: 'Oferta 0 po zmianie', price: '900', minutes: '50', mode: 'online' }] } }, await writeToken(env, MAREK));
    expect(res.status).toBe(200);
    expect(await active()).toBe(before);
    const edited = await env.DB.prepare(`SELECT title, session_type FROM session_offers WHERE id = 'of_limit_0'`).first<{ title: string; session_type: string }>();
    expect(edited).toEqual({ title: 'Oferta 0 po zmianie', session_type: 'couples' });
  });

  it('typ oferty i kategoria FAQ: edytor je zapisuje, a ich brak w wierszu niczego nie nadpisuje', async () => {
    const JULIA = 'th_c93e5a4187b6f20d94a1c3f5';
    const token = await writeToken(env, JULIA);
    const created = await write({
      offers: { offer_rows: [{ title: 'Sesja dla par', type: 'couples', price: '300', minutes: '80', mode: 'online' }] },
      'faq-profil': { faq_rows: [{ q: 'Jak płacę?', a: 'Przelewem po sesji.', category: 'payment' }] },
    }, token);
    expect(created.status).toBe(200);
    const offer = (await env.DB.prepare(`SELECT id, session_type FROM session_offers WHERE therapist_id = ? AND title = 'Sesja dla par'`).bind(JULIA).first<{ id: string; session_type: string }>())!;
    const faq = (await env.DB.prepare(`SELECT id, category FROM faq_items WHERE therapist_id = ? AND question = 'Jak płacę?'`).bind(JULIA).first<{ id: string; category: string }>())!;
    expect(offer.session_type).toBe('couples');
    expect(faq.category).toBe('payment');

    // Wiersze bez `type` i `category`, jak z sesji edycji sprzed tej zmiany; obcy typ spada na domyślny.
    await write({
      offers: { offer_rows: [{ id: offer.id, title: 'Sesja dla par', price: '320', minutes: '80', mode: 'online' }] },
      'faq-profil': { faq_rows: [{ id: faq.id, q: 'Jak płacę?', a: 'Przelewem albo BLIK-iem.' }] },
    }, token);
    expect((await env.DB.prepare(`SELECT session_type, price_minor FROM session_offers WHERE id = ?`).bind(offer.id).first())).toEqual({ session_type: 'couples', price_minor: 32000 });
    expect((await env.DB.prepare(`SELECT category FROM faq_items WHERE id = ?`).bind(faq.id).first<{ category: string }>())!.category).toBe('payment');

    await write({ offers: { offer_rows: [{ id: offer.id, title: 'Sesja dla par', type: 'grupowa', price: '320', minutes: '80', mode: 'online' }] } }, token);
    expect((await env.DB.prepare(`SELECT session_type FROM session_offers WHERE id = ?`).bind(offer.id).first<{ session_type: string }>())!.session_type).toBe('individual');
  });

  it('edytor dostaje pola danych z opcjami z bazy, bez pól prezentacji, i każde z nich ma wartość w resolved', async () => {
    const { hostDataFields, HOST_LOCKS, resolveAll } = await import('../src/web/host-blocks');
    const { profileContext } = await import('../src/web/pages');
    const fields = hostDataFields({ topics: [['lek', 'Lęk']], modalities: [['cbt', 'CBT']] });
    expect(fields.offers!.map((f) => f.name)).toEqual(['offer_rows']);
    expect(fields['faq-profil']!.map((f) => f.name)).toEqual(['faq_rows']);
    expect(fields.topics!.find((f) => f.name === 'topics')!.options).toEqual([['lek', 'Lęk']]);
    // Nagłówek sekcji i przyciski to sloty usługi, nie dane tej bazy.
    expect(Object.values(fields).flat().some((f) => f.name === 'heading' || f.name === 'buttons')).toBe(false);
    expect(Object.keys(HOST_LOCKS).every((type) => type in fields)).toBe(true);

    // Usługa bierze wartość startową z resolved[blok][pole]: brak = puste pole i zapis, który czyści dane.
    const t = (await getTherapist(env, { therapist_id: ANNA }, { drafts: true }))!;
    const resolved = resolveAll(await profileContext(env, t));
    for (const [type, list] of Object.entries(fields)) {
      const block = resolved[type];
      if (!block) continue;
      for (const f of list.filter((x) => x.data)) expect(block, `${type}.${f.name}`).toHaveProperty(f.name);
    }
  });

  it('kalendarz: grafik układa się w panelu, blok pokazuje go jako wyliczony', async () => {
    const { HOST_BLOCK_DEFS } = await import('../src/web/host-blocks');
    const field = HOST_BLOCK_DEFS['slots']!.fields!.find((f) => f.name === 'slots_shown')!;
    expect(field.kind).toBe('computed');
    expect(field.hint).toContain('Dostępność');
  });

  it('liczby pod nagłówkiem są zadeklarowane jako wyliczone, ze źródłem', async () => {
    const { HOST_BLOCK_DEFS } = await import('../src/web/host-blocks');
    const stat = HOST_BLOCK_DEFS['hero-profil']!.fields!.find((f) => f.name === 'stat_price')!;
    expect(stat.kind).toBe('computed');
    expect(stat.hint).toContain('Oferta');
  });
});
