import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createAdminSession } from '../src/auth/session';
import { findOrCreateUserByEmail } from '../src/db/users';
import { getTherapist } from '../src/db/catalog';
import { serveTherapistPage } from '../src/web/lp';
import { listPages } from '../src/web/pages-client';
import { profileContext } from '../src/web/pages';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';

describe('the profile page, typeset by the pages service', () => {
  it('is made on first view as a row here, rendered there with her data, as her own document', async () => {
    const res = await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('class="header-cta"');
    expect(html).toContain('116 123');
    expect(html).toContain('wsparcie emocjonalne');
    expect(html).toContain('Anna Kowalczyk (DEMO)');
    expect(html).toContain('href="/terapeuci">Katalog</a>');
    // Every stylesheet is the service's; this host ships no CSS for her pages.
    expect(html).toContain('href="https://pages.test/base.css');
    expect(html.match(/<link rel="stylesheet" href="([^"]+)"/g)?.every((l) => l.includes('https://pages.test/') || l.includes('https://fonts.googleapis.com/'))).toBe(true);
    expect(res.headers.get('x-pages-stale')).toBeNull();
    // The page is a row in this database; the service kept nothing.
    const pages = await listPages(env, ANNA);
    expect(pages.map((p) => p.slug)).toEqual(['profil']);
    expect(pages[0]!.page).toEqual({});
  });

  it('serves the last good copy when the service is down, and a page with the crisis numbers when there is none', async () => {
    const t = (await getTherapist(env, { therapist_id: ANNA }))!;
    const ctx = await profileContext(env, t);
    const down = { ...env, PAGES_URL: 'memory://down' };

    await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo'); // writes the copy
    const stale = await serveTherapistPage(down, t, ctx, 'profil', { drafts: false });
    expect(stale?.stale).toBe(true);
    expect(stale?.html).toContain('Anna Kowalczyk (DEMO)');

    await env.MEDIA!.delete(`pages-html/${ANNA}/profil.html`);
    await expect(serveTherapistPage(down, t, ctx, 'profil', { drafts: false })).rejects.toThrow(/unreachable/);
  });
});

describe('the editor link in the panel', () => {
  it("opens the service's editor in a new tab; the panel frames nothing", async () => {
    const user = await findOrCreateUserByEmail(env, 'anna-tpl@example.invalid');
    await env.DB.prepare(`UPDATE users SET role = 'therapist', therapist_id = ? WHERE id = ?`).bind(ANNA, user.id).run();
    const { cookie } = await createAdminSession(env, user.id);

    const panel = await (await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}`, { headers: { cookie } })).text();
    const editorUrl = /data-page-editor="([^"]+)"/.exec(panel)![1]!;
    expect(editorUrl).toMatch(/^https:\/\/pages\.test\/edit\//);
    expect(panel).not.toContain('<iframe');
    expect(panel).toContain('data-editor-dialog');
  });

  it('still opens for a profile she has not published yet', async () => {
    await env.DB.prepare(`UPDATE therapists SET status = 'draft' WHERE id = ?`).bind(ANNA).run();
    try {
      expect(await getTherapist(env, { therapist_id: ANNA })).toBeNull();
      const user = await findOrCreateUserByEmail(env, 'anna-draft@example.invalid');
      await env.DB.prepare(`UPDATE users SET role = 'therapist', therapist_id = ? WHERE id = ?`).bind(ANNA, user.id).run();
      const { cookie } = await createAdminSession(env, user.id);
      const panel = await (await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}`, { headers: { cookie } })).text();
      expect(panel).toMatch(/data-page-editor="https:\/\/pages\.test\/edit\//);
    } finally {
      await env.DB.prepare(`UPDATE therapists SET status = 'published' WHERE id = ?`).bind(ANNA).run();
    }
  });
});
