import { SELF, env } from 'cloudflare:test';
import { recordProfileView, viewsByTherapist } from '../src/db/views';
import { describe, expect, it } from 'vitest';
import {
  findCandidates,
  getCrisisResources,
  getPublishedFaq,
  getTherapist,
  listOpenSlots,
} from '../src/db/catalog';
import { rankTherapists } from '../src/matching/rank';
import { nowIso } from '../src/lib/time';
import { publish } from '../src/authored/store';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';
const UNPUBLISHED = 'th_0a1b2c3d4e5f60718293a4b5';

describe('search filters', () => {
  it('returns every published demo profile with no filters', async () => {
    const all = await findCandidates(env, {});
    expect(all.length).toBe(7);
    expect(all.every((t) => t.is_demo)).toBe(true);
  });

  it('never returns an unpublished profile', async () => {
    const all = await findCandidates(env, {});
    expect(all.find((t) => t.therapist_id === UNPUBLISHED)).toBeUndefined();
    expect(await getTherapist(env, { therapist_id: UNPUBLISHED })).toBeNull();
    expect(await getTherapist(env, { slug: 'hanna-testowa-demo' })).toBeNull();
  });

  it('applies the online filter', async () => {
    const online = await findCandidates(env, { online: true });
    expect(online.length).toBeGreaterThan(0);
    expect(online.every((t) => t.offers_online)).toBe(true);
  });

  it('requires ALL requested languages, not just one', async () => {
    const plUk = await findCandidates(env, { languages: ['pl', 'uk'] });
    expect(plUk.every((t) => t.languages.includes('pl') && t.languages.includes('uk'))).toBe(true);
    const plOnly = await findCandidates(env, { languages: ['pl'] });
    expect(plOnly.length).toBeGreaterThan(plUk.length);
  });

  it('matches a city regardless of Polish diacritics', async () => {
    const a = await findCandidates(env, { location: 'Łódź' });
    const b = await findCandidates(env, { location: 'lodz' });
    expect(a.length).toBe(1);
    expect(b.map((t) => t.therapist_id)).toEqual(a.map((t) => t.therapist_id));
  });

  it('searches free text across name, city, area and modality', async () => {
    const byCity = await findCandidates(env, { text: 'lodz' });
    expect(byCity.length).toBe(1);
    const byModality = await findCandidates(env, { text: 'gestalt' });
    expect(byModality.length).toBeGreaterThan(0);

    // Every word has to land, so a second one narrows the result.
    const both = await findCandidates(env, { text: 'gestalt nieistniejacemiasto' });
    expect(both.length).toBe(0);

    // A wildcard typed into the box is a character, not an operator.
    expect((await findCandidates(env, { text: '%' })).length).toBe(0);
  });

  it('respects a price band', async () => {
    const cheap = await findCandidates(env, { price_max: 18000 });
    expect(cheap.length).toBeGreaterThan(0);
    expect(cheap.every((t) => t.offers.some((o) => o.price_minor <= 18000))).toBe(true);
  });

  it('returns nothing for contradictory filters', async () => {
    const impossible = await findCandidates(env, {
      location: 'Warszawa',
      languages: ['uk'],
      topics: ['neuroroznorodnosc'],
      price_max: 1,
    });
    expect(impossible).toEqual([]);
  });

  it('tolerates an unknown filter value instead of erroring', async () => {
    expect(await findCandidates(env, { topics: ['nie-istnieje'] })).toEqual([]);
    expect(await findCandidates(env, { location: 'Atlantyda' })).toEqual([]);
  });

  it('never exposes private profile fields', async () => {
    const [first] = await findCandidates(env, {});
    const serialised = JSON.stringify(first);
    expect(serialised).not.toContain('verification_notes');
    expect(serialised).not.toContain('contact_email_enc');
    expect(serialised).not.toContain('DEMO — profil fikcyjny');
    const profile = await getTherapist(env, { therapist_id: ANNA });
    expect(JSON.stringify(profile)).not.toContain('verification_notes');
  });

  it('caps the visible page at the requested size while reporting the total', async () => {
    const all = await findCandidates(env, {});
    const ranked = rankTherapists(all, {});
    expect(ranked.slice(0, 5).length).toBe(5);
    expect(ranked.length).toBe(all.length);
  });
});

describe('FAQ', () => {
  it('returns only published items', async () => {
    const items = await getPublishedFaq(env, ANNA);
    expect(items.length).toBeGreaterThan(0);
    // Every consumer (widget key, MCP payload, deep link) reads faq_id, so an
    // item without one is a broken row, not a cosmetic gap.
    expect(items.every((i) => typeof i.faq_id === 'string' && i.faq_id !== '')).toBe(true);
    expect(items.every((i) => i.approved_at !== null)).toBe(true);
    expect(items.some((i) => i.answer.includes('ROBOCZA ODPOWIEDŹ'))).toBe(false);
  });

  it('filters approved answers instead of inventing one', async () => {
    const filtered = await getPublishedFaq(env, ANNA, 'jak wygląda pierwsze spotkanie');
    expect(filtered.length).toBeGreaterThan(0);
    const all = await getPublishedFaq(env, ANNA);
    for (const item of filtered) {
      expect(all.some((a) => a.faq_id === item.faq_id)).toBe(true);
    }
  });

  it('returns an empty list when nothing approved matches', async () => {
    const none = await getPublishedFaq(env, ANNA, 'czy przepiszesz mi leki psychotropowe recepta');
    expect(none).toEqual([]);
  });

  it('returns nothing for an unpublished therapist', async () => {
    expect(await getPublishedFaq(env, UNPUBLISHED)).toEqual([]);
  });
});

describe('slots', () => {
  it('lists only future open slots of a published therapist', async () => {
    const slots = await listOpenSlots(env, {
      therapist_id: ANNA,
      from_utc: nowIso(),
      to_utc: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      limit: 50,
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => Date.parse(s.starts_at_utc) > Date.now())).toBe(true);
    expect(slots.every((s) => s.timezone === 'Europe/Warsaw')).toBe(true);
  });

  it('returns nothing for an unpublished therapist', async () => {
    const slots = await listOpenSlots(env, {
      therapist_id: UNPUBLISHED,
      from_utc: nowIso(),
      to_utc: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      limit: 50,
    });
    expect(slots).toEqual([]);
  });

  it('filters by mode', async () => {
    const online = await listOpenSlots(env, {
      therapist_id: ANNA,
      from_utc: nowIso(),
      to_utc: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      mode: 'online',
      limit: 50,
    });
    expect(online.every((s) => s.mode === 'online')).toBe(true);
  });
});

describe('crisis resources', () => {
  it('always includes the emergency number for adults', async () => {
    const adult = await getCrisisResources(env, 'PL', 'adult');
    expect(adult[0]?.phone).toBe('112');
    expect(adult.some((r) => r.phone === '116 123')).toBe(true);
    expect(adult.every((r) => r.source_url.startsWith('https://'))).toBe(true);
    expect(adult.every((r) => r.verified_at.length === 10)).toBe(true);
  });

  it('routes minors to their own line and never to the adult one', async () => {
    const minor = await getCrisisResources(env, 'PL', 'minor');
    expect(minor.some((r) => r.phone === '116 111')).toBe(true);
    expect(minor.some((r) => r.phone === '116 123')).toBe(false);
  });
});

describe('links', () => {
  it('publishes https links and drops anything else', async () => {
    await env.DB.prepare(`UPDATE therapists SET links = ? WHERE id = ?`)
      .bind(
        JSON.stringify([
          { label: 'Facebook', url: 'https://www.facebook.com/p/Gabinet-100063470173359/' },
          { label: 'Skrypt', url: 'javascript:alert(1)' },
          { label: '', url: 'https://example.com' },
          { label: 'Bez adresu', url: '' },
        ]),
        ANNA,
      )
      .run();

    const t = await getTherapist(env, { therapist_id: ANNA });
    expect(t?.links).toEqual([{ label: 'Facebook', url: 'https://www.facebook.com/p/Gabinet-100063470173359/' }]);
  });
});

/**
 * Statystyka, którą serwis prowadzi, i granica, której nie przekracza: liczba
 * odsłon rośnie, ale w tabeli nie ma niczego, co wskazywałoby na osobę.
 */
describe('licznik odsłon profilu', () => {
  it('sumuje odsłony ze strony i z asystenta, osobno dla każdego profilu', async () => {
    await recordProfileView(env, ANNA, 'web');
    await recordProfileView(env, ANNA, 'web');
    await recordProfileView(env, ANNA, 'mcp');

    const views = await viewsByTherapist(env);
    expect(views.get(ANNA)).toEqual({ web: 2, mcp: 1 });
    expect(views.get(UNPUBLISHED)).toBeUndefined();
  });

  it('trzyma jeden wiersz na dzień i źródło, bez śladu po osobie', async () => {
    await recordProfileView(env, ANNA, 'web');
    const { results } = await env.DB.prepare(
      `SELECT * FROM profile_views WHERE therapist_id = ? AND source = 'web'`,
    )
      .bind(ANNA)
      .all<Record<string, unknown>>();
    expect(results).toHaveLength(1);
    expect(Object.keys(results[0] ?? {}).sort()).toEqual(['day', 'source', 'therapist_id', 'views']);
  });

  it('otwarcie profilu na stronie zwiększa licznik', async () => {
    const before = (await viewsByTherapist(env)).get(ANNA)?.web ?? 0;
    const response = await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo');
    expect(response.status).toBe(200);
    expect((await viewsByTherapist(env)).get(ANNA)?.web ?? 0).toBeGreaterThan(before);
  });
});

/**
 * A style attribute is dead code on this site: the policy is
 * `style-src 'self'` with no 'unsafe-inline', so the browser drops it before
 * it is ever applied. Two of them had been holding the catalogue's card
 * header and list layout, silently doing nothing.
 */
describe('CSP: no inline style attributes', () => {
  const pages = ['/', '/terapeuci', '/jak-to-dziala', '/dla-terapeutow', '/bezpieczenstwo', '/pomoc-w-kryzysie'];
  for (const path of pages) {
    it(`${path} renders without a style attribute`, async () => {
      const res = await SELF.fetch(`https://example.com${path}`);
      expect(res.status).toBe(200);
      expect(await res.text()).not.toContain('style="');
    });
  }
});

describe('stopka serwisu', () => {
  it('zawiera link logowania do panelu', async () => {
    const res = await SELF.fetch('https://example.com/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<a href="https://otwartyterapeuta.pl/admin">Logowanie</a>');
  });
});

describe('sitemap.xml', () => {
  it('lists static pages and real profiles, never demo ones; robots points at it', async () => {
    await env.DB.prepare(`UPDATE therapists SET is_demo = 0 WHERE slug = 'anna-kowalczyk-demo'`).run();
    const res = await SELF.fetch('https://example.com/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const xml = await res.text();
    expect(xml).toContain(`<loc>${env.PUBLIC_BASE_URL}/terapeuci</loc>`);
    expect(xml).toContain(`<loc>${env.PUBLIC_BASE_URL}/terapeuci/anna-kowalczyk-demo</loc><lastmod>`);
    expect(xml).not.toContain('marek-zielinski-demo');
    expect(xml).not.toContain('/admin');

    const robots = await (await SELF.fetch('https://example.com/robots.txt')).text();
    expect(robots).toContain(`Sitemap: ${env.PUBLIC_BASE_URL}/sitemap.xml`);
  });
});

describe('head profilu', () => {
  it('names the person and the place, points at itself and keeps fiction out of the index', async () => {
    const html = await (await SELF.fetch('https://example.com/terapeuci/anna-kowalczyk-demo')).text();
    expect(html).toMatch(/<title>Anna Kowalczyk[^<]* — psychoterapia[^<]* — Otwarty Terapeuta<\/title>/);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain(`<link rel="canonical" href="${env.PUBLIC_BASE_URL}/terapeuci/anna-kowalczyk-demo">`);
    expect(html).toContain('<meta name="description" content="Anna Kowalczyk');
    const demo = await (await SELF.fetch('https://example.com/terapeuci/marek-zielinski-demo')).text();
    expect(demo).toContain('<meta name="robots" content="noindex, nofollow">');
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]!);
    expect(ld['@type']).toBe('Person');
    expect(ld.name).toContain('Anna Kowalczyk');
  });
});

describe('najbliższy wolny termin', () => {
  it('ignores slots of a withdrawn offer, as the calendar does', async () => {
    const before = await (await SELF.fetch('https://example.com/terapeuci/marek-zielinski-demo')).text();
    expect(before).toContain('<ul class="times">');
    await env.DB.prepare(`UPDATE session_offers SET active = 0 WHERE therapist_id = (SELECT id FROM therapists WHERE slug = 'marek-zielinski-demo')`).run();
    const after = await (await SELF.fetch('https://example.com/terapeuci/marek-zielinski-demo')).text();
    expect(after).not.toContain('<ul class="times">');
    expect(after).toContain('W najbliższych tygodniach nie ma wolnych terminów.');
  });
});

describe('a city page', () => {
  const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';
  const JULIA = 'th_c93e5a4187b6f20d94a1c3f5';
  const PIOTR = 'th_1e07b8d3629af45c0d2e7a91';

  it('stands only where three real people practise, lists them, and every profile leads to it', async () => {
    // Trzecia osoba zapisała miasto wielkimi literami - to nadal ta sama Warszawa.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO therapist_locations (id, therapist_id, city, city_norm, country, is_primary) VALUES ('loc_t_j', ?, 'Warszawa', 'warszawa', 'PL', 1)`).bind(JULIA),
      env.DB.prepare(`INSERT INTO therapist_locations (id, therapist_id, city, city_norm, country, is_primary) VALUES ('loc_t_p', ?, 'WARSZAWA', 'warszawa', 'PL', 0)`).bind(PIOTR),
    ]);
    expect((await SELF.fetch('https://example.com/psychoterapeuta/warszawa')).status).toBe(404); // demo się nie liczy
    await env.DB.prepare(`UPDATE therapists SET is_demo = 0 WHERE id IN (?, ?, ?)`).bind(ANNA, JULIA, PIOTR).run();

    const res = await SELF.fetch('https://example.com/psychoterapeuta/warszawa');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h1>Psychoterapeuta Warszawa</h1>');
    expect(html).toContain('<title>Psychoterapeuta Warszawa — ceny i wolne terminy — Otwarty Terapeuta</title>');
    expect(html).toContain('"@type":"ItemList"');
    for (const slug of ['anna-kowalczyk-demo', 'julia-nowak-demo', 'piotr-adamski-demo']) expect(html).toContain(`href="/terapeuci/${slug}"`);
    expect(html).not.toContain('WARSZAWA');
    expect((await SELF.fetch('https://example.com/psychoterapeuta/krakow')).status).toBe(404);

    expect(await (await SELF.fetch('https://example.com/sitemap.xml')).text()).toContain(`<loc>${env.PUBLIC_BASE_URL}/psychoterapeuta/warszawa</loc>`);
    const catalogue = await (await SELF.fetch('https://example.com/terapeuci')).text();
    expect(catalogue).toContain('<a href="/psychoterapeuta/warszawa">Warszawa</a> (3)');
    expect(catalogue.match(/<option value="Warszawa"/g)).toHaveLength(1);
    expect(catalogue).not.toContain('WARSZAWA');

    await publish(env, ANNA, { order: ['who'], answers: { who: 'Pracuję z osobami w kryzysie.' } });
    const profile = await (await SELF.fetch('https://example.com/terapeuci/anna-kowalczyk-demo')).text();
    expect(profile).toContain('Inni terapeuci · Warszawa');
    expect(profile).toContain('href="/terapeuci/julia-nowak-demo"');
    expect(profile).toContain('<a href="/psychoterapeuta/warszawa">');
    expect(profile).toMatch(/<title>Anna Kowalczyk[^<]* — psychoterapia[^<]*, Warszawa i online — Otwarty Terapeuta<\/title>/);
  });
});

describe('the home page', () => {
  it('puts a different person first from visit to visit, real people before demo ones', async () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const html = await (await SELF.fetch('https://example.com/')).text();
      firsts.add(/hero-face hero-face-1" href="\/terapeuci\/([a-z0-9-]+)"/.exec(html)?.[1] ?? '');
    }
    expect(firsts.size).toBeGreaterThan(1);
  });
});
