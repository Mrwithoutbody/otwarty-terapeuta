import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { publish } from '../../../shared/authored/store';

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
