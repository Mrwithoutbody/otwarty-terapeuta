import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { normalizeDraft, pageFlags } from '../../../shared/authored/core';
import { publish } from '../../../shared/authored/store';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';
const PROFILE = 'https://localhost/terapeuci/anna-kowalczyk-demo';

describe('a subpage', () => {
  const SUB = `${PROFILE}/grupa-wsparcia`;
  const page = {
    type: 'podstrona', title: 'Grupa wsparcia dla rodziców', form: 'droga', top: 'twarz', line: 'Miejsce dla rodziców.', order: ['what', 'start', 'c_1'],
    answers: { what: 'Rozmawiamy o tym, co trudne.', start: 'Najpierw konsultacja.', c_1: 'Nie. Mówisz tyle, ile chcesz.' },
    custom: [{ id: 'c_1', q: 'Czy muszę mówić przy innych?' }],
  };
  const insert = (slug: string, published: boolean): Promise<unknown> =>
    env.DB.prepare(
      `INSERT OR REPLACE INTO authored_pages (id, therapist_id, type, slug, draft_json, published_json, published_at, created_at, updated_at) VALUES (?, ?, 'podstrona', ?, ?, ?, ?, ?, ?)`,
    ).bind(`ap_t_${slug}`, ANNA, slug, JSON.stringify(page), published ? JSON.stringify(page) : null, published ? '2026-09-22T08:00:00Z' : null, '2026-09-22T08:00:00Z', '2026-09-22T08:00:00Z').run();

  it('is served at its address in her words and leads back to her profile', async () => {
    await insert('grupa-wsparcia', true);
    const res = await SELF.fetch(SUB);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h1>Grupa wsparcia dla rodziców</h1>');
    expect(html).toContain('Rozmawiamy o tym, co trudne.');
    expect(html).toContain('Czy muszę mówić przy innych?');
    expect(html).toContain('/assets/strona.css');
    expect(html).toContain('116 123');
    expect(html).toContain('<a href="/terapeuci/anna-kowalczyk-demo">Anna Kowalczyk');
    expect(html).toContain('<title>Grupa wsparcia dla rodziców — Anna Kowalczyk');
    expect(html).toContain('<meta name="description" content="Grupa wsparcia dla rodziców. Miejsce dla rodziców.');
    expect(html).toContain(`<link rel="canonical" href="${env.PUBLIC_BASE_URL}/terapeuci/anna-kowalczyk-demo/grupa-wsparcia">`);
    // Ta sama głowa co strony serwisu: podgląd linku, ikona, okruszki w wyniku wyszukiwania.
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    for (const tag of ['name="twitter:card"', 'property="og:site_name"', 'property="og:locale"', 'rel="apple-touch-icon"', 'name="theme-color"']) expect(html).toContain(tag);
    const crumbs = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]!)).find((j) => j['@type'] === 'BreadcrumbList');
    expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(['Otwarty Terapeuta', 'Terapeuci', expect.stringContaining('Anna Kowalczyk'), 'Grupa wsparcia dla rodziców']);
  });

  it('stays out of sight until published', async () => {
    await insert('warsztaty', false);
    expect((await SELF.fetch(`${PROFILE}/warsztaty`)).status).toBe(404);
  });

  it('hangs off her profile once and stands in the sitemap once; a draft does neither', async () => {
    await publish(env, ANNA, { order: ['who'], answers: { who: 'Pracuję z osobami w kryzysie.' } });
    await insert('grupa-wsparcia', true);
    await insert('warsztaty', false);
    await env.DB.prepare(`UPDATE therapists SET is_demo = 0 WHERE id = ?`).bind(ANNA).run();

    const profile = await (await SELF.fetch(PROFILE)).text();
    expect(profile.split('href="/terapeuci/anna-kowalczyk-demo/grupa-wsparcia"').length - 1).toBe(1);
    expect(profile).toContain('>Grupa wsparcia dla rodziców</a>');
    expect(profile).not.toContain('/terapeuci/anna-kowalczyk-demo/warsztaty');
    // Prawdziwa osoba (już nie demo): Google może pokazać przy wyniku dużą miniaturę jej zdjęcia.
    expect(await (await SELF.fetch(SUB)).text()).toContain('<meta name="robots" content="max-image-preview:large">');
    const xml = await (await SELF.fetch('https://localhost/sitemap.xml')).text();
    expect(xml.split('/terapeuci/anna-kowalczyk-demo/grupa-wsparcia</loc>').length - 1).toBe(1);
    expect(xml).not.toContain('/warsztaty');
  });

  it('keeps prices out of its title too', () => {
    expect(pageFlags(normalizeDraft({ ...page, title: 'Grupa za 200 zł' }, 'podstrona'))).toMatchObject([{ where: 'title', kind: 'kwota' }]);
  });
});
