import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createAdminSession } from '../src/auth/session';
import { findOrCreateUserByEmail } from '../src/db/users';
import { getTherapist } from '../src/db/catalog';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';

describe('the profile page', () => {
  it('stands from her data before she publishes her own words, as her own document with the crisis numbers', async () => {
    const t = (await getTherapist(env, { therapist_id: ANNA }))!;
    const res = await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo');
    expect(res.status).toBe(200);
    const html = await res.text();
    // Strona autorska z tego, co już jest w profilu (`seedDraft`): jej opis, cennik z danych.
    expect(html).toContain('/assets/strona.css');
    expect(html).toContain(t.bio.split('\n')[0]!.slice(0, 40));
    expect(html).toContain('220 zł');
    expect(html).toContain('116 123');
    expect(html).toContain('<a href="/terapeuci">‹ Wszyscy terapeuci</a>');
    // Nic z zewnątrz: arkusz, fonty i obrazy z tego serwisu.
    expect(html.match(/<link rel="stylesheet" href="([^"]+)"/g)?.every((l) => l.includes('href="/assets/'))).toBe(true);
    expect(res.headers.get('content-security-policy')).toContain(`style-src 'self' `);
    expect(res.headers.get('content-security-policy')).not.toMatch(/https:\/\/(?!challenges\.cloudflare\.com)/);
  });

  it('has no subpage she did not write', async () => {
    expect((await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo/cokolwiek')).status).toBe(404);
  });
});

describe('her page in the panel', () => {
  it('leads to the tool where she writes it; the block editor is gone from her profile', async () => {
    const user = await findOrCreateUserByEmail(env, 'anna-tpl@example.invalid');
    await env.DB.prepare(`UPDATE users SET role = 'therapist', therapist_id = ? WHERE id = ?`).bind(ANNA, user.id).run();
    const { cookie } = await createAdminSession(env, user.id);

    const panel = await (await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}`, { headers: { cookie } })).text();
    expect(panel).toContain(`href="/admin/terapeuci/${ANNA}/strona"`);
    expect(panel).not.toContain('<iframe');
  });

  it('opens for a profile she has not published yet', async () => {
    await env.DB.prepare(`UPDATE therapists SET status = 'draft' WHERE id = ?`).bind(ANNA).run();
    try {
      expect(await getTherapist(env, { therapist_id: ANNA })).toBeNull();
      const user = await findOrCreateUserByEmail(env, 'anna-draft@example.invalid');
      await env.DB.prepare(`UPDATE users SET role = 'therapist', therapist_id = ? WHERE id = ?`).bind(ANNA, user.id).run();
      const { cookie } = await createAdminSession(env, user.id);
      const tool = await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}/strona`, { headers: { cookie } });
      expect(tool.status).toBe(200);
      expect(await tool.text()).toContain('id="boot"');
    } finally {
      await env.DB.prepare(`UPDATE therapists SET status = 'published' WHERE id = ?`).bind(ANNA).run();
    }
  });
});
