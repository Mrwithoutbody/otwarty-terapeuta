import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createAdminSession, loadAdminSession } from '../src/auth/session';
import { findOrCreateUserByEmail } from '../src/db/users';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';
const MAREK = 'th_8b2d6e10f4a97c53d1e08b26';

interface Actor {
  cookie: string;
  csrf: string;
}

async function actor(email: string, therapistId: string): Promise<Actor> {
  const user = await findOrCreateUserByEmail(env, email);
  await env.DB.prepare(`UPDATE users SET role = 'therapist', therapist_id = ? WHERE id = ?`).bind(therapistId, user.id).run();
  const { cookie } = await createAdminSession(env, user.id);
  const session = await loadAdminSession(env, new Request('https://localhost/admin', { headers: { cookie } }));
  if (!session) throw new Error('nie udało się utworzyć sesji testowej');
  return { cookie, csrf: session.csrfToken };
}

function post(who: Actor, path: string, pairs: Array<[string, string]>): Promise<Response> {
  const body = new URLSearchParams([['csrf', who.csrf], ...pairs]);
  return SELF.fetch(`https://localhost${path}`, {
    method: 'POST',
    headers: { cookie: who.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'manual',
  });
}

/** The whole life of one subpage: created, arranged, published, deleted. */
describe('podstrony terapeutki', () => {
  it('creates, arranges, publishes and lists a subpage', async () => {
    const anna = await actor('anna-pages@example.invalid', ANNA);

    const created = await post(anna, `/admin/terapeuci/${ANNA}/strony`, [['title', 'Grupa wsparcia dla rodziców'], ['preset', 'plakat']]);
    expect(created.status).toBe(303);
    const editor = created.headers.get('location')!;
    expect(editor).toMatch(new RegExp(`^/admin/terapeuci/${ANNA}/strony/pg_`));
    const pid = editor.split('/').pop()!;

    // The template filled the page in: its theme, its axes and one empty block per type, hero titled.
    const fresh = await env.DB.prepare(`SELECT blocks_json, layout_json FROM therapist_pages WHERE id = ?`).bind(pid).first<{ blocks_json: string; layout_json: string }>();
    expect(JSON.parse(fresh!.layout_json)).toMatchObject({ theme: 'ink', display: 'poster', bands: 'stripes' });
    expect(JSON.parse(fresh!.blocks_json)[0]).toEqual({ type: 'hero-poster', heading: 'Grupa wsparcia dla rodziców' });

    // Editor renders the block palette in Polish and the host blocks from her data.
    const form = await (await SELF.fetch(`https://localhost${editor}`, { headers: { cookie: anna.cookie } })).text();
    expect(form).toContain('Wolne terminy');
    expect(form).toContain('Nagłówek — plakat');
    expect(form).not.toContain('Hero — classic');

    // A draft is invisible to the public, even with the right address.
    const slug = 'grupa-wsparcia-dla-rodzicow';
    expect((await SELF.fetch(`https://localhost/terapeuci/anna-kowalczyk-demo/${slug}`)).status).toBe(404);

    const saved = await post(anna, editor, [
      ['title', 'Grupa wsparcia dla rodziców'],
      ['slug', slug],
      ['status', 'published'],
      ['layout_theme', 'clay'],
      ['sec_0_type', 'hero'],
      ['sec_0_pos', '1'],
      ['sec_0_heading', 'Nie musisz tego dźwigać sama'],
      ['sec_1_type', 'text'],
      ['sec_1_pos', '2'],
      ['sec_1_body', 'Spotykamy się co czwartek o 18:00.\n\nMała grupa, do ośmiu osób.'],
      ['sec_2_type', 'slots'],
      ['sec_2_pos', '3'],
      ['sec_3_type', 'faq-profil'],
      ['sec_3_pos', '4'],
      ['sec_4_type', 'nope'],
      ['sec_4_pos', '5'],
    ]);
    expect(saved.status).toBe(303);

    const row = await env.DB.prepare(`SELECT * FROM therapist_pages WHERE id = ?`).bind(pid).first<{ blocks_json: string; layout_json: string; status: string }>();
    expect(row?.status).toBe('published');
    expect(JSON.parse(row!.blocks_json).map((b: { type: string }) => b.type)).toEqual(['hero', 'text', 'slots', 'faq-profil']);
    expect(JSON.parse(row!.layout_json).theme).toBe('clay');

    const publicPage = await SELF.fetch(`https://localhost/terapeuci/anna-kowalczyk-demo/${slug}`);
    expect(publicPage.status).toBe(200);
    const html = await publicPage.text();
    expect(html).toContain('<h1>Nie musisz tego dźwigać sama</h1>');
    expect(html).toContain('Mała grupa, do ośmiu osób.');
    expect(html).toContain('class="lp lp--theme-clay');
    expect(html).toContain('/assets/lp-doc.css');
    // The calendar on the subpage is the profile's calendar - same renderer, same data.
    expect(html).toContain('slot-table');
    // Its own document: no catalogue header, one bar back to her.
    expect(html).not.toContain('class="header-cta"');
    expect(html).toContain('class="lp-bar"');
    expect(html).toContain('<main id="main" class="lp ');

    // The profile links to it, and the subpage links back.
    const profile = await (await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo')).text();
    expect(profile).toContain(`href="/terapeuci/anna-kowalczyk-demo/${slug}"`);
    expect(html).toContain('aria-current="page">Grupa wsparcia dla rodziców');

    // The engine stylesheet is a file, so the strict CSP stays as it is.
    expect(publicPage.headers.get('content-security-policy')).toContain(`style-src 'self'`);
    expect((await SELF.fetch('https://localhost/assets/lp-doc.css')).headers.get('content-type')).toContain('text/css');

    const deleted = await post(anna, `${editor}/usun`, []);
    expect(deleted.status).toBe(303);
    expect((await SELF.fetch(`https://localhost/terapeuci/anna-kowalczyk-demo/${slug}`)).status).toBe(404);
  });

  it('keeps one therapist out of another one\'s subpages', async () => {
    const anna = await actor('anna-pages-2@example.invalid', ANNA);
    const marek = await actor('marek-pages@example.invalid', MAREK);
    const created = await post(anna, `/admin/terapeuci/${ANNA}/strony`, [['title', 'Warsztat']]);
    const editor = created.headers.get('location')!;

    expect((await SELF.fetch(`https://localhost${editor}`, { headers: { cookie: marek.cookie } })).status).toBe(403);
    expect((await post(marek, editor, [['title', 'x'], ['slug', 'x'], ['status', 'published']])).status).toBe(403);
    expect((await post(marek, `${editor}/usun`, [])).status).toBe(403);
    expect((await SELF.fetch(`https://localhost${editor}/podglad`)).status).toBe(401);
  });
});
