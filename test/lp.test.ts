import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createAdminSession, loadAdminSession } from '../src/auth/session';
import { findOrCreateUserByEmail } from '../src/db/users';
import { writeToken } from '../src/web/host-write';

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

/** The whole life of one subpage: created here, arranged in the service's editor, saved back here, served. */
describe('podstrony terapeutki', () => {
  it('creates, saves the editor\'s page and lists a subpage', async () => {
    const anna = await actor('anna-pages@example.invalid', ANNA);

    const created = await post(anna, `/admin/terapeuci/${ANNA}/strony`, [['title', 'Grupa wsparcia dla rodziców'], ['look', 'lex']]);
    expect(created.status).toBe(303);
    const back = created.headers.get('location')!;
    expect(back).toMatch(new RegExp(`^/admin/terapeuci/${ANNA}\\?edytuj=pg_[a-f0-9]+#panel-strony$`));
    const pid = /edytuj=(pg_[a-f0-9]+)/.exec(back)![1]!;

    // The panel lists it; its row opens the editor through this host, which sends her to the service.
    const fresh = await (await SELF.fetch(`https://localhost${back}`, { headers: { cookie: anna.cookie } })).text();
    expect(fresh).toContain(`data-page-editor="/admin/terapeuci/${ANNA}/strony/${pid}"`);
    const hop = await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}/strony/${pid}`, { headers: { cookie: anna.cookie }, redirect: 'manual' });
    expect(hop.status).toBe(303);
    expect(hop.headers.get('location')).toMatch(/^https:\/\/pages\.test\/edit\//);

    // Served at once, in the look she picked, with her calendar and the crisis numbers.
    const slug = 'grupa-wsparcia-dla-rodzicow';
    const publicPage = await SELF.fetch(`https://localhost/terapeuci/anna-kowalczyk-demo/${slug}`);
    expect(publicPage.status).toBe(200);
    let html = await publicPage.text();
    expect(html).toContain('data-t="lex"');
    expect(html).toContain('id="terminy"');
    expect(html).not.toContain('class="header-cta"');
    expect(html).toContain('116 123');
    expect(html.match(/<link rel="stylesheet" href="([^"]+)"/g)?.every((l) => l.includes('https://pages.test/') || l.includes('https://fonts.googleapis.com/'))).toBe(true);
    expect(publicPage.headers.get('content-security-policy')).toContain(`img-src 'self' https://pages.test`);
    expect(publicPage.headers.get('content-security-policy')).toContain(`style-src 'self' https://pages.test`);
    expect(publicPage.headers.get('content-security-policy')).toContain(`font-src 'self' https://pages.test`);

    // The editor saves through the service to this host: her words, her order, her theme.
    const saved = await SELF.fetch(`https://localhost/api/host-blocks?page=${pid}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: await writeToken(env, ANNA),
        page: {
          theme: 'spokoj',
          blocks: [
            { id: 'hero-profil', type: 'hero', kind: 'siatka', layout: 'srodek', tone: 'base', data: { heading: 'Nie musisz tego dźwigać sama' } },
            { id: 'terminy', type: 'calendar', kind: 'siatka', layout: 'lista', tone: 'base', data: {} },
          ],
        },
      }),
    });
    expect(saved.status).toBe(200);
    html = await (await SELF.fetch(`https://localhost/terapeuci/anna-kowalczyk-demo/${slug}`)).text();
    expect(html).toContain('Nie musisz tego dźwigać sama');
    expect(html).toContain('data-t="spokoj"');
    expect(html).toContain('id="terminy"');

    // The profile links to it; the panel lists it.
    const profile = await (await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo')).text();
    expect(profile).toContain(`href="/terapeuci/anna-kowalczyk-demo/${slug}"`);
    const panel = await (await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}`, { headers: { cookie: anna.cookie } })).text();
    expect(panel).toContain(`/admin/terapeuci/${ANNA}/strony/${pid}`);
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
