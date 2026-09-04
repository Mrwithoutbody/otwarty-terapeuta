import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createAdminSession, loadAdminSession } from '../src/auth/session';
import { findOrCreateUserByEmail } from '../src/db/users';
import { pagesFetch } from '../src/web/pages-client';

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

/** The editor's own form, posted straight to the service the way the framed page does. */
function postEditor(editorUrl: string, pairs: Array<[string, string]>): Promise<Response> {
  const path = new URL(editorUrl).pathname;
  const token = path.split('/').pop()!;
  return pagesFetch(env, path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams([['csrf', token], ...pairs]).toString(),
  });
}

const editorSrc = (html: string): string => /<a class="btn" href="(https:[^"]+)" target="_blank"/.exec(html)![1]!;

/** The whole life of one subpage: created, arranged in the service's editor, published, deleted. */
describe('podstrony terapeutki', () => {
  it('creates, arranges, publishes and lists a subpage', async () => {
    const anna = await actor('anna-pages@example.invalid', ANNA);

    const created = await post(anna, `/admin/terapeuci/${ANNA}/strony`, [['title', 'Grupa wsparcia dla rodziców'], ['look', 'default:ink']]);
    expect(created.status).toBe(303);
    const editor = created.headers.get('location')!;
    expect(editor).toMatch(new RegExp(`^/admin/terapeuci/${ANNA}/strony/[a-z0-9]+$`));

    // The panel links out to the service's editor; the editor is the template picker, the block list, one preview.
    const shell = await (await SELF.fetch(`https://localhost${editor}`, { headers: { cookie: anna.cookie } })).text();
    const editorUrl = editorSrc(shell);
    expect(editorUrl).toMatch(/^https:\/\/pages\.test\/edit\/[a-z0-9]+\/[a-z0-9]+\.\d+\.[\w-]+$/);
    const form = await (await pagesFetch(env, new URL(editorUrl).pathname)).text();
    // Jeden kafel szablonu i siedem próbek jego palet.
    expect((form.match(/data-theme="default"/g) ?? []).length).toBe(8);
    expect(form).toContain('data-variant="ink" data-label="Atrament" aria-pressed="true"'); // wybrana paleta szablonu
    expect((form.match(/<iframe /g) ?? []).length).toBe(1);
    expect(form).toContain('name="sec_0_type" value="hero"');
    expect(form).toContain('<div class="add-group"><h3>Twoje dane</h3>'); // her blocks lead the palette
    expect(form).toContain('value="add_section:slots"'); // and each one is a tile, not a select option

    // A draft is invisible to the public, even with the right address.
    const slug = 'grupa-wsparcia-dla-rodzicow';
    expect((await SELF.fetch(`https://localhost/terapeuci/anna-kowalczyk-demo/${slug}`)).status).toBe(404);

    const saved = await postEditor(editorUrl, [
      ['title', 'Grupa wsparcia dla rodziców'],
      ['slug', slug],
      ['status', 'published'],
      ['action', 'apply_theme:default:clay'],
      ['sec_0_type', 'hero'], ['sec_0_pos', '1'], ['sec_0_heading', 'Nie musisz tego dźwigać sama'],
      ['sec_1_type', 'text'], ['sec_1_pos', '2'], ['sec_1_body', 'Spotykamy się co czwartek o 18:00.\n\nMała grupa, do ośmiu osób.'],
      ['sec_2_type', 'slots'], ['sec_2_pos', '3'],
      ['sec_3_type', 'faq-profil'], ['sec_3_pos', '4'],
      ['sec_4_type', 'nope'], ['sec_4_pos', '5'],
    ]);
    expect(saved.status).toBe(303);

    const publicPage = await SELF.fetch(`https://localhost/terapeuci/anna-kowalczyk-demo/${slug}`);
    expect(publicPage.status).toBe(200);
    const html = await publicPage.text();
    expect(html).toContain('<h1>Nie musisz tego dźwigać sama</h1>');
    expect(html).toContain('Mała grupa, do ośmiu osób.');
    expect(html).toContain('class="lp lp--theme-clay');
    // The calendar on the subpage is the profile's calendar - same markup, same data.
    expect(html).toContain('lp-cal');
    expect(html).toContain('id="terminy"');
    // Its own document: no catalogue header, one bar back to her, the crisis numbers.
    expect(html).not.toContain('class="header-cta"');
    expect(html).toContain('class="lp-bar"');
    expect(html).toContain('<a href="tel:116123">116 123</a> wsparcie emocjonalne');
    expect(html).toContain('aria-current="page">Grupa wsparcia dla rodziców');

    // Every stylesheet is the service's (its base sheet, then the theme's); this host ships no CSS for her pages.
    expect(html).toContain('<link rel="stylesheet" href="https://pages.test/themes/base.css?v=');
    expect(html).toContain('<link rel="stylesheet" href="https://pages.test/themes/builtin%3Adefault/style.css?v=');
    expect(html.match(/<link rel="stylesheet" href="([^"]+)"/g)?.every((l) => l.includes('https://pages.test/'))).toBe(true);
    expect(publicPage.headers.get('content-security-policy')).toContain(`img-src 'self' https://pages.test`);
    expect(publicPage.headers.get('content-security-policy')).toContain(`style-src 'self' https://pages.test`);
    expect(publicPage.headers.get('content-security-policy')).toContain(`font-src 'self' https://pages.test`);

    // The profile links to it.
    const profile = await (await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo')).text();
    expect(profile).toContain(`href="/terapeuci/anna-kowalczyk-demo/${slug}"`);

    // Deleting happens in the editor, with the confirmation ticked.
    const deleted = await postEditor(editorUrl, [['action', 'delete'], ['confirm_delete', '1']]);
    expect(deleted.status).toBe(200);
    expect((await SELF.fetch(`https://localhost/terapeuci/anna-kowalczyk-demo/${slug}`)).status).toBe(404);
  });

  it('keeps one therapist out of another one\'s subpages', async () => {
    const anna = await actor('anna-pages-2@example.invalid', ANNA);
    const marek = await actor('marek-pages@example.invalid', MAREK);
    const created = await post(anna, `/admin/terapeuci/${ANNA}/strony`, [['title', 'Warsztat']]);
    const editor = created.headers.get('location')!;

    expect((await SELF.fetch(`https://localhost${editor}`, { headers: { cookie: marek.cookie } })).status).toBe(403);
    expect((await post(marek, `/admin/terapeuci/${ANNA}/strony`, [['title', 'x']])).status).toBe(403);
    expect((await SELF.fetch(`https://localhost${editor}`)).status).toBe(401);
    // Marek's own panel cannot open Anna's page by id either.
    const pid = editor.split('/').pop()!;
    expect((await SELF.fetch(`https://localhost/admin/terapeuci/${MAREK}/strony/${pid}`, { headers: { cookie: marek.cookie } })).status).toBe(404);
  });
});
