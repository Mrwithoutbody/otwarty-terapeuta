import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { profileBlocks, profileLayout } from '../src/web/lp';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';

describe('the old profile JSON, read by the engine', () => {
  it('translates the previous engine\'s types, fields and presentation', () => {
    const blocks = profileBlocks(JSON.stringify([
      { type: 'tekst', heading: 'O mnie', body: 'Akapit.', cta_label: 'Napisz', cta_href: 'mailto:a@b.pl', tlo: 'ciemne', kadr: 'pas' },
      { type: 'filary', heading: 'Trzy rzeczy', items: [{ title: 'Uważność', desc: 'Opis.' }] },
      { type: 'cytat', body: 'Zdanie.', author: 'Ktoś' },
      { type: 'faq' },
      { type: 'nie-ma-takiej' },
    ]));
    expect(blocks.map((b) => b.type)).toEqual(['hero-profil', 'text', 'features', 'quote', 'faq-profil']);
    expect(blocks[1]).toMatchObject({ heading: 'O mnie', tone: 'dark', frame: 'stripe', buttons: [{ label: 'Napisz', href: 'mailto:a@b.pl' }] });
    expect((blocks[2]!.items as Array<{ body: string }>)[0]!.body).toBe('Opis.');
  });

  it('gives an empty or broken column the default spine with a heading first', () => {
    for (const raw of ['', '[]', 'not json', null]) {
      const types = profileBlocks(raw).map((b) => b.type);
      expect(types[0]).toBe('hero-profil');
      expect(types).toContain('slots');
      expect(types.at(-1)).toBe('zaproszenie');
    }
  });

  it('maps the old layout values onto the engine axes and validates the rest', () => {
    expect(profileLayout('{"theme":"glina","bands":"pasy","nav":"kotwice","display":"plakat"}'))
      .toMatchObject({ theme: 'clay', bands: 'stripes', nav: 'anchors', display: 'poster' });
    expect(profileLayout('{"theme":"ink","hero":"nonsense"}')).toMatchObject({ theme: 'ink', hero: '' });
    expect(profileLayout('broken').theme).toBe('sage');
  });
});

describe('the profile page on the engine', () => {
  it('renders her data blocks inside the catalogue, in her theme', async () => {
    await env.DB.prepare(`UPDATE therapists SET sections_json = ?, layout_json = ? WHERE id = ?`)
      .bind(JSON.stringify([{ type: 'hero-profil' }, { type: 'tekst', heading: 'Jak pracuję', body: 'Powoli.' }, { type: 'slots' }, { type: 'zaproszenie' }]), '{"theme":"forest","bands":"stripes"}', ANNA)
      .run();
    const html = await (await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo')).text();
    expect(html).toContain('class="header-cta"');
    expect(html).toContain('class="lp lp--theme-forest lp--stripes');
    expect(html).toContain('<h1>Anna Kowalczyk (DEMO)</h1>');
    expect(html).toContain('<h2>Jak pracuję</h2>');
    expect(html).toContain('slot-table');
    expect(html).toContain('id="terminy"');
    expect(html).toContain('/assets/lp.css');
    expect(html).not.toContain('/assets/lp-doc.css');
  });
});
