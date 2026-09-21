import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createAdminSession, loadAdminSession } from '../src/auth/session';
import { getPublishedFaq, getTherapist } from '../src/db/catalog';
import { findOrCreateUserByEmail } from '../src/db/users';
import { cut, guard, normalizeDraft, pageFlags, renderPublic, shape, type Person } from '../src/authored/core';
import { getAuthored, publish, saveDraft, seedDraft } from '../src/authored/store';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';
const PROFILE = 'https://localhost/terapeuci/anna-kowalczyk-demo';

const person: Person = {
  name: 'Anna Kowalczyk', city: 'Warszawa', photo: null, timezone: 'Europe/Warsaw', is_demo: true, verified: true, online: true, in_person: true, accepting: true,
  credentials: [{ title: 'Certyfikat psychoterapeuty', issuer: 'PTTPB', year: 2019, verified: true }],
  offers: [{ title: 'Sesja online', duration_minutes: 50, price_minor: 22000 }],
  cancellation_policy: 'Bezpłatne odwołanie do 24 godzin.', slots: ['2026-09-21T09:00:00Z'], booking_href: '/jak-to-dziala',
};

describe('the fact guard', () => {
  it('stops prices, dates, hours and credentials written as prose', () => {
    for (const s of ['Sesja kosztuje 180 zł.', 'Biorę dwieście złotych za spotkanie.', 'Wolny termin mam we wtorek.', 'Przyjmuję o 17:00.', 'Zapraszam 12 października.']) {
      expect(guard(s), s).toHaveLength(1);
    }
  });

  it('lets her say how she trained and who supervises her - that is her own description', () => {
    expect(guard('Jestem certyfikowaną psychoterapeutką Gestalt. Pracuję pod stałą superwizją superwizora PTP. dr J. Kabat-Zinn.')).toEqual([]);
  });

  it('lets her talk about her work', () => {
    const text = 'Pracuję z osobami dorosłymi, które mierzą się z lękiem. Pierwsze spotkanie to rozmowa, nie egzamin.\nNie trzeba się przygotowywać.';
    expect(guard(text)).toEqual([]);
  });

  it('cuts exactly the sentence it named', () => {
    const text = 'Nie trzeba. Sesja kosztuje 180 zł. Wystarczy przyjść.';
    expect(cut(text, guard(text)[0]!.i)).toBe('Nie trzeba. Wystarczy przyjść.');
  });
});

describe('a draft from the browser', () => {
  it('keeps only known questions, known shapes and bounded text', () => {
    const draft = normalizeDraft({
      form: 'gutenberg', top: 'fakty', line: 'Psychoterapeutka\nWarszawa', order: ['who', 'who', 'hack', 'c_1', 'c_zly id'],
      answers: { who: 'x'.repeat(5000), hack: 'nope', c_1: 'Tak.' }, custom: [{ id: 'c_1', q: 'Czy mogę przyjść z psem?' }, { id: 'c_zly id', q: '?' }], facts: { price: 1 },
    });
    expect(draft.form).toBe('rozmowa');
    expect(draft.top).toBe('fakty');
    expect(draft.line).toBe('Psychoterapeutka Warszawa');
    expect(draft.order).toEqual(['who', 'c_1']);
    expect(draft.answers.who).toHaveLength(4000);
    expect(Object.keys(draft)).not.toContain('facts');
  });
});

describe('the page', () => {
  const draft = normalizeDraft({ form: 'list', top: 'slowa', line: 'Psychoterapeutka, Warszawa', order: ['who', 'prep'], answers: { who: 'Pracuję z lękiem. Sesja kosztuje 999 zł.', prep: 'Nie trzeba.' } });

  it('shows her words, the facts from data and the crisis numbers - and never a fact she typed', () => {
    const html = renderPublic(person, draft, 'wrzesień 2026');
    expect(html).toContain('Pracuję z lękiem.');
    expect(html).not.toContain('999');
    expect(html).toContain('220 zł');
    expect(html).toContain('Certyfikat psychoterapeuty');
    for (const n of ['116 123', '800 70 2222', '112']) expect(html).toContain(n);
    expect(html).toContain('<blockquote class="open">Pracuję z lękiem.</blockquote>');
  });

  it('is a different document for each way of greeting, not a recoloured one', () => {
    const tags = (form: string): string => (renderPublic(person, { ...draft, form: form as 'list' }, 'wrzesień 2026').match(/<(main|aside|details|nav|section|ol)\b/g) ?? []).join('');
    expect(new Set(['rozmowa', 'list', 'droga', 'spis'].map(tags)).size).toBe(4);
  });

  it('escapes what she wrote', () => {
    const html = renderPublic(person, normalizeDraft({ order: ['who'], answers: { who: '<script>alert(1)</script> i dłuższe zdanie, żeby nie było cytatem, tylko zwykłym akapitem tekstu.' } }), 'wrzesień 2026');
    expect(html).not.toContain('<script>');
  });

  it('bolds what she marked with ** and omits a qualifications card with nothing in it', () => {
    const d = normalizeDraft({ order: ['who'], answers: { who: '**„Człowiekiem jestem”** i dłuższe zdanie, żeby to był zwykły akapit, a nie krótki cytat na stronie.' } });
    const html = renderPublic({ ...person, credentials: [] }, d, 'wrzesień 2026');
    expect(html).toContain('<strong>„Człowiekiem jestem”</strong>');
    expect(html).not.toContain('**');
    expect(html).not.toContain('id="f-creds"');
    expect(renderPublic(person, d, 'wrzesień 2026')).toContain('id="f-creds"');
  });

  it('takes its shape from how she wrote', () => {
    expect(shape('Nie trzeba.')).toContain('class="say"');
    expect(shape('Najpierw pytam.\nPotem dopytuję.\nNa koniec mówię, co myślę.')).toContain('<ol class="steps">');
  });
});

describe('publishing', () => {
  it('starts her from what her profile already says', async () => {
    const t = (await getTherapist(env, { therapist_id: ANNA }))!;
    const draft = seedDraft(t, await getPublishedFaq(env, ANNA));
    expect(draft.answers.who).toBe(t.bio);
    expect(draft.line).toBe(t.headline);
    expect(pageFlags(draft)).toEqual([]);
  });

  it('refuses a page that states a price, and says where', async () => {
    const result = await publish(env, ANNA, { order: ['who'], answers: { who: 'Pracuję z lękiem. Sesja kosztuje 180 zł.' } });
    expect(result).toMatchObject({ ok: false, reason: 'flags', flags: [{ where: 'who', kind: 'kwota' }] });
    expect((await getAuthored(env, ANNA))?.published).toBeNull();
  });

  it('puts her page at her address and her words in the profile the plugin reads', async () => {
    const before = await (await SELF.fetch(PROFILE)).text();
    expect(before).toContain('https://pages.test/');

    await saveDraft(env, ANNA, { order: ['who'], answers: { who: 'Szkic, którego pacjent nie widzi.' } });
    expect(await (await SELF.fetch(PROFILE)).text()).toContain('https://pages.test/');

    const result = await publish(env, ANNA, {
      form: 'droga', top: 'fakty', line: 'Psychoterapeutka, Warszawa i online', order: ['who', 'how', 'first', 'silence', 'c_1'],
      answers: { who: 'Pracuję z osobami w kryzysie.', how: 'Nazywamy problem i sprawdzamy, co pomaga.', first: 'Najpierw rozmawiamy.', silence: 'To się zdarza i niczego nie psuje.', c_1: 'Tak, jeśli jest spokojny.' },
      custom: [{ id: 'c_1', q: 'Czy mogę przyjść z psem?' }],
    });
    expect(result.ok).toBe(true);

    const res = await SELF.fetch(PROFILE);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('/assets/strona.css');
    expect(html).not.toContain('https://pages.test/');
    expect(html).toContain('Pracuję z osobami w kryzysie.');
    expect(html).toContain('220 zł');
    expect(html).toContain('116 123');
    expect(html).toContain('<link rel="canonical"');

    const t = (await getTherapist(env, { therapist_id: ANNA }))!;
    expect(t.bio).toBe('Pracuję z osobami w kryzysie.\n\nNazywamy problem i sprawdzamy, co pomaga.');
    expect(t.first_meeting.course).toBe('Najpierw rozmawiamy.');
    expect((await getPublishedFaq(env, ANNA)).map((f) => f.question)).toEqual(['A jeśli nie będę wiedzieć, co powiedzieć?', 'Czy mogę przyjść z psem?']);
  });

  it('serves the stylesheet it links', async () => {
    const res = await SELF.fetch('https://localhost/assets/strona.css');
    expect(res.headers.get('content-type')).toContain('text/css');
    expect(await res.text()).toContain('.crisis');
  });
});

describe('the tool in her panel', () => {
  const TOOL = `https://localhost/admin/terapeuci/${ANNA}/strona`;
  async function actor(email: string, role: string, therapistId: string | null): Promise<{ cookie: string; csrf: string }> {
    const user = await findOrCreateUserByEmail(env, email);
    await env.DB.prepare(`UPDATE users SET role = ?, therapist_id = ? WHERE id = ?`).bind(role, therapistId, user.id).run();
    const { cookie } = await createAdminSession(env, user.id);
    const session = await loadAdminSession(env, new Request('https://localhost/admin', { headers: { cookie } }));
    return { cookie, csrf: session!.csrfToken };
  }
  const send = (who: { cookie: string; csrf: string }, path: string, method: string, draft: unknown, csrf = who.csrf): Promise<Response> =>
    SELF.fetch(TOOL + path, { method, headers: { cookie: who.cookie, 'x-csrf': csrf, 'content-type': 'application/json' }, body: JSON.stringify({ draft }) });

  it('opens with her existing words, her facts and no editor of blocks', async () => {
    const anna = await actor('anna-strona@example.invalid', 'therapist', ANNA);
    const res = await SELF.fetch(TOOL, { headers: { cookie: anna.cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    const boot = JSON.parse(/<script type="application\/json" id="boot">(.*?)<\/script>/s.exec(html)![1]!) as { draft: { answers: Record<string, string> }; person: { offers: unknown[] } };
    expect(boot.draft.answers.who).toContain('Pracuję z osobami');
    expect(boot.person.offers.length).toBeGreaterThan(0);
    expect(html).toContain('/assets/strona-panel.js');
    expect((await SELF.fetch('https://localhost/assets/strona-panel.js')).status).toBe(200);
  });

  it('saves a draft and publishes it, for its owner only and only with the CSRF token', async () => {
    const anna = await actor('anna-strona@example.invalid', 'therapist', ANNA);
    const other = await actor('ktos-inny@example.invalid', 'therapist', 'th_8b2d6e10f4a97c53d1e08b26');
    const draft = { form: 'spis', order: ['who'], answers: { who: 'Pracuję z osobami, które długo odkładały przyjście.' } };

    expect((await send(other, '/szkic', 'PUT', draft)).status).toBe(403);
    expect((await send(anna, '/szkic', 'PUT', draft, 'zly-token')).status).toBe(403);
    expect((await SELF.fetch(`${TOOL}/szkic`, { method: 'PUT', body: '{}' })).status).toBe(401);

    expect((await send(anna, '/szkic', 'PUT', draft)).status).toBe(200);
    expect((await getAuthored(env, ANNA))?.draft.form).toBe('spis');

    const refused = await send(anna, '/publikuj', 'POST', { order: ['who'], answers: { who: 'Sesja kosztuje 180 zł.' } });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toContain('To wygląda na cenę');

    const ok = await send(anna, '/publikuj', 'POST', draft);
    expect(ok.status).toBe(200);
    expect(await (await SELF.fetch(PROFILE)).text()).toContain('które długo odkładały przyjście');
  });
});
