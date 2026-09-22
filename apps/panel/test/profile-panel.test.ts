import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createAdminSession } from '../auth/session';
import { findOrCreateUserByEmail } from '../../../shared/db/users';
import { getTherapist } from '../../../shared/db/catalog';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';

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
