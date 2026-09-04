import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createAdminSession } from '../src/auth/session';
import { findOrCreateUserByEmail } from '../src/db/users';
import { getTherapist } from '../src/db/catalog';
import { writeToken } from '../src/web/host-write';
import { pagesFetch } from '../src/web/pages-client';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';

const write = async (data: Record<string, unknown>, token?: string) =>
  SELF.fetch('https://localhost/api/host-blocks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: token ?? (await writeToken(env, ANNA)), data }),
  });

describe('pola danych bloku wracają do bazy', () => {
  it('formularz bloku niesie jej cennik, FAQ i opis, nie same tytuły', async () => {
    const user = await findOrCreateUserByEmail(env, 'anna-pola@example.invalid');
    await env.DB.prepare(`UPDATE users SET role = 'therapist', therapist_id = ? WHERE id = ?`).bind(ANNA, user.id).run();
    const { cookie } = await createAdminSession(env, user.id);
    const panel = await (await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}`, { headers: { cookie } })).text();
    const editorUrl = /data-page-editor="([^"]+)"/.exec(panel)![1]!;
    const form = await (await pagesFetch(env, new URL(editorUrl).pathname)).text();

    // Wiersz cennika: ukryty identyfikator oferty i jej liczby do poprawienia.
    expect(form).toMatch(/<input type="hidden" name="sec_\d+_offer_rows_0_id" value="of_/);
    expect(form).toContain('Sesja indywidualna online');
    expect(form).toContain('name="sec_5_offer_rows_0_price"');
    // FAQ i opis też są treścią, nie podpowiedzią.
    expect(form).toMatch(/name="sec_\d+_faq_rows_0_q"/);
    expect(form).toMatch(/name="sec_\d+_bio"/);
  });

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

describe('przyciski i zdjęcie w bloku', () => {
  it('edytor pokazuje pola przycisków i zdjęcia, a wpisany napis wygrywa nad domyślnym', async () => {
    const user = await findOrCreateUserByEmail(env, 'anna-guziki@example.invalid');
    await env.DB.prepare(`UPDATE users SET role = 'therapist', therapist_id = ? WHERE id = ?`).bind(ANNA, user.id).run();
    const { cookie } = await createAdminSession(env, user.id);
    const panel = await (await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}`, { headers: { cookie } })).text();
    const path = new URL(/data-page-editor="([^"]+)"/.exec(panel)![1]!).pathname;
    const form = await (await pagesFetch(env, path)).text();

    // Hero: napis i adres każdego przycisku do poprawienia.
    expect(form).toMatch(/name="sec_0_buttons_0_label"/);
    expect(form).toMatch(/name="sec_0_buttons_0_href"/);
    // „Jak pracuję": pole na adres zdjęcia.
    expect(form).toMatch(/name="sec_\d+_media"/);

    const token = path.split('/').pop()!;
    const body = new URLSearchParams([['csrf', token]]);
    for (const [index, type] of ['hero-profil', 'intro'].entries()) {
      body.append(`sec_${index}_type`, type);
      body.append(`sec_${index}_pos`, String(index + 1));
    }
    body.append('sec_0_buttons_0_label', 'Napisz do mnie');
    // Adres pełny, nie kotwica: usługa wyrzuca przycisk celujący w sekcję,
    // której na stronie nie ma - a ta strona ma tylko dwa bloki.
    body.append('sec_0_buttons_0_href', 'https://otwartyterapeuta.pl/jak-to-dziala');
    body.append('sec_0_buttons_0_style', 'primary');
    expect((await pagesFetch(env, path, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    })).status).toBe(303);

    const html = await (await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo')).text();
    expect(html).toContain('Napisz do mnie');
    expect(html).not.toContain('Zobacz wolne terminy');
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

  it('kalendarz: zaznaczone godziny dostają wolne terminy, odznaczone je tracą', async () => {
    expect((await write({ slots: { slot_hours: ['9', '15'], slot_days: '5' } })).status).toBe(200);
    const hours = async () => {
      const { results } = await env.DB.prepare(
        `SELECT starts_at_utc, timezone FROM appointment_slots WHERE therapist_id = ? AND status = 'open' AND starts_at_utc > ?`,
      ).bind(ANNA, new Date().toISOString()).all<{ starts_at_utc: string; timezone: string }>();
      const { formatTime } = await import('../src/lib/time');
      return [...new Set(results.map((r) => Number(formatTime(r.starts_at_utc, r.timezone).split(':')[0])))].sort((a, b) => a - b);
    };
    expect(await hours()).toEqual([9, 15]);

    expect((await write({ slots: { slot_hours: ['15'], slot_days: '5' } })).status).toBe(200);
    expect(await hours()).toEqual([15]);
  });

  it('liczby pod nagłówkiem są zadeklarowane jako wyliczone, ze źródłem', async () => {
    const { HOST_BLOCK_DEFS } = await import('../src/web/host-blocks');
    const stat = HOST_BLOCK_DEFS['hero-profil']!.fields!.find((f) => f.name === 'stat_price')!;
    expect(stat.kind).toBe('computed');
    expect(stat.hint).toContain('Oferta');
  });
});
