import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createAdminSession, loadAdminSession } from '../src/auth/session';
import { findOrCreateUserByEmail } from '../src/db/users';
import { getTherapist } from '../src/db/catalog';
import { serveTherapistPage } from '../src/web/lp';
import { pagesFetch } from '../src/web/pages-client';
import { profileContext } from '../src/web/pages';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';

describe('the profile page on the pages service', () => {
  it('is made on first view with her data blocks, in the service\'s theme, as her own document', async () => {
    const res = await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('class="header-cta"');
    expect(html).toContain('<a href="tel:116123">116 123</a> wsparcie emocjonalne');
    expect(html).toContain('<h1>Anna Kowalczyk (DEMO)</h1>');
    expect(html).toContain('lp-cal');
    expect(html).toContain('id="terminy"');
    expect(html).toContain('href="#terminy"'); // the hero's button, kept because the calendar rendered
    expect(html).toContain('href="/terapeuci">Katalog</a>');
    expect(html).toContain('<link rel="stylesheet" href="https://pages.test/assets/page.css?v=');
    expect(res.headers.get('x-pages-stale')).toBeNull();
  });

  it('serves the last good copy when the service is down, and a page with the crisis numbers when there is none', async () => {
    const t = (await getTherapist(env, { therapist_id: ANNA }))!;
    const ctx = await profileContext(env, t);
    const down = { ...env, PAGES_URL: 'memory://down' };

    await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo'); // writes the copy
    const stale = await serveTherapistPage(down, t, ctx, 'profil', { drafts: false });
    expect(stale?.stale).toBe(true);
    expect(stale?.html).toContain('<h1>Anna Kowalczyk (DEMO)</h1>');

    await env.MEDIA!.delete(`pages-html/${ANNA}/profil.html`);
    await expect(serveTherapistPage(down, t, ctx, 'profil', { drafts: false })).rejects.toThrow(/unreachable/);
  });
});

describe('templates in the panel', () => {
  it('frames the service\'s editor for her profile and applies a template without losing her words', async () => {
    const user = await findOrCreateUserByEmail(env, 'anna-tpl@example.invalid');
    await env.DB.prepare(`UPDATE users SET role = 'therapist', therapist_id = ? WHERE id = ?`).bind(ANNA, user.id).run();
    const { cookie } = await createAdminSession(env, user.id);
    const session = await loadAdminSession(env, new Request('https://localhost/admin', { headers: { cookie } }));

    const panel = await (await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}`, { headers: { cookie } })).text();
    const editorUrl = /<iframe class="pages-editor" src="([^"]+)" title="Edytor Twojej strony"/.exec(panel)![1]!;
    expect(editorUrl).toMatch(/^https:\/\/pages\.test\/edit\//);
    expect(panel).toContain('class="pages-editor"');

    const path = new URL(editorUrl).pathname;
    const editor = await pagesFetch(env, path);
    expect(editor.headers.get('content-security-policy')).toContain(`frame-ancestors 'self' ${env.PUBLIC_BASE_URL}`);
    const form = await editor.text();
    expect((form.match(/data-preset="/g) ?? []).length).toBe(8);
    expect(form).toContain('name="sec_0_type" value="hero-profil"');
    expect(form).not.toContain('name="slug"'); // the profile's address and visibility are the host's

    // The preview shows her data in a template she has not chosen yet.
    const preview = await (await pagesFetch(env, `${path}/preview?preset=plakat`)).text();
    expect(preview).toContain('class="lp lp--theme-ink lp--scale-poster lp--stripes');
    expect(preview).toContain('class="lp-hero lp-hero--poster"');
    expect(preview).toContain('Anna Kowalczyk (DEMO)');
    expect(preview).toContain('lp-cal');

    const token = path.split('/').pop()!;
    const saved = await pagesFetch(env, path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams([
        ['csrf', token], ['action', 'apply_preset:plakat'],
        ['sec_0_type', 'hero-profil'], ['sec_0_pos', '1'],
        ['sec_1_type', 'text'], ['sec_1_pos', '2'], ['sec_1_heading', 'Moje słowa'], ['sec_1_body', 'Zostają.'],
        ['sec_2_type', 'slots'], ['sec_2_pos', '3'],
      ]).toString(),
    });
    expect(saved.status).toBe(303);

    const html = await (await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo')).text();
    expect(html).toContain('class="lp lp--theme-ink lp--scale-poster lp--stripes');
    expect(html).toContain('class="lp-hero lp-hero--poster"');
    expect(html).toContain('<h2>Moje słowa</h2>');
    expect(html).toContain('lp-cal');
    expect(session).not.toBeNull();
  });
});
