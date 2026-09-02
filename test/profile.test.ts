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
  it('renders her data blocks as engine blocks, in her theme', async () => {
    await env.DB.prepare(`UPDATE therapists SET sections_json = ?, layout_json = ? WHERE id = ?`)
      .bind(JSON.stringify([{ type: 'hero-profil' }, { type: 'tekst', heading: 'Jak pracuję', body: 'Powoli.' }, { type: 'slots' }, { type: 'zaproszenie' }]), '{"theme":"forest","bands":"stripes"}', ANNA)
      .run();
    const html = await (await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo')).text();
    // Her own document: no catalogue header, the crisis numbers in the footer.
    expect(html).not.toContain('class="header-cta"');
    expect(html).toContain('lp-crisis');
    expect(html).toContain('class="lp lp--theme-forest lp--stripes');
    expect(html).toContain('<h1>Anna Kowalczyk (DEMO)</h1>');
    expect(html).toContain('<h2>Jak pracuję</h2>');
    expect(html).toContain('slot-table');
    expect(html).toContain('id="terminy"');
    expect(html).toContain('/assets/lp-doc.css');
  });
});

describe('templates in the panel', () => {
  it('shows every template as her own page and applies one without losing her words', async () => {
    const { createAdminSession, loadAdminSession } = await import('../src/auth/session');
    const { findOrCreateUserByEmail } = await import('../src/db/users');
    const user = await findOrCreateUserByEmail(env, 'anna-tpl@example.invalid');
    await env.DB.prepare(`UPDATE users SET role = 'therapist', therapist_id = ? WHERE id = ?`).bind(ANNA, user.id).run();
    const { cookie } = await createAdminSession(env, user.id);
    const session = await loadAdminSession(env, new Request('https://localhost/admin', { headers: { cookie } }));
    await env.DB.prepare(`UPDATE therapists SET sections_json = ?, layout_json = '{}' WHERE id = ?`)
      .bind(JSON.stringify([{ type: 'hero-profil' }, { type: 'text', heading: 'Moje słowa', body: 'Zostają.' }, { type: 'slots' }]), ANNA)
      .run();

    const panel = await (await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}`, { headers: { cookie } })).text();
    expect((panel.match(/data-preset="/g) ?? []).length).toBe(7);
    expect((panel.match(/<iframe /g) ?? []).length).toBe(1);
    expect(panel).toContain(`data-preview="/admin/terapeuci/${ANNA}/podglad"`);
    expect(panel).toContain(`src="/admin/terapeuci/${ANNA}/podglad" data-preview-frame`);

    const preview = await (await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}/podglad?preset=plakat`, { headers: { cookie } })).text();
    expect(preview).toContain('class="lp lp--theme-ink lp--scale-poster lp--stripes');
    expect(preview).toContain('class="lp-hero lp-hero--poster"');
    expect(preview).toContain('<h2>Moje słowa</h2>');
    expect((await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}/podglad`)).status).toBe(401);

    const body = new URLSearchParams([
      ['csrf', session!.csrfToken], ['action', 'apply_preset:plakat'],
      ['sec_0_type', 'hero-profil'], ['sec_0_pos', '1'],
      ['sec_1_type', 'text'], ['sec_1_pos', '2'], ['sec_1_heading', 'Moje słowa'], ['sec_1_body', 'Zostają.'],
      ['sec_2_type', 'slots'], ['sec_2_pos', '3'],
    ]);
    const saved = await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}/sekcje`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), redirect: 'manual',
    });
    expect(saved.status).toBe(302);
    const row = await env.DB.prepare(`SELECT sections_json, layout_json FROM therapists WHERE id = ?`).bind(ANNA).first<{ sections_json: string; layout_json: string }>();
    expect(JSON.parse(row!.layout_json)).toMatchObject({ theme: 'ink', display: 'poster', bands: 'stripes' });
    const types = (JSON.parse(row!.sections_json) as Array<{ type: string; heading?: string }>);
    expect(types.map((b) => b.type)).toEqual(['hero-profil', 'text', 'slots']);
    expect(types[1]!.heading).toBe('Moje słowa');
  });
});
