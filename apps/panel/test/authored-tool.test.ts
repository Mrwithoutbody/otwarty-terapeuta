import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createAdminSession, loadAdminSession } from '../auth/session';
import { findOrCreateUserByEmail } from '../../../shared/db/users';
import { getAuthored } from '../../../shared/authored/store';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';
const PROFILE = 'https://localhost/terapeuci/anna-kowalczyk-demo';

describe('the tool in her panel', () => {
  const TOOL = `https://localhost/admin/terapeuci/${ANNA}/strona`;
  async function actor(email: string, role: string, therapistId: string | null): Promise<{ cookie: string; csrf: string }> {
    const user = await findOrCreateUserByEmail(env, email);
    await env.DB.prepare(`UPDATE users SET role = ?, therapist_id = ? WHERE id = ?`).bind(role, therapistId, user.id).run();
    const { cookie } = await createAdminSession(env, user.id);
    const session = await loadAdminSession(env, new Request('https://localhost/admin', { headers: { cookie } }));
    return { cookie, csrf: session!.csrfToken };
  }
  const send = (who: { cookie: string; csrf: string }, path: string, method: string, draft: unknown, csrf = who.csrf): Promise<Response> =>
    SELF.fetch(TOOL + path, { method, headers: { cookie: who.cookie, 'x-csrf': csrf, 'content-type': 'application/json' }, body: JSON.stringify({ draft }) });

  it('opens with her existing words, her facts and no editor of blocks', async () => {
    const anna = await actor('anna-strona@example.invalid', 'therapist', ANNA);
    const res = await SELF.fetch(TOOL, { headers: { cookie: anna.cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    const boot = JSON.parse(/<script type="application\/json" id="boot">(.*?)<\/script>/s.exec(html)![1]!) as { draft: { answers: Record<string, string> }; person: { offers: unknown[] } };
    expect(boot.draft.answers.who).toContain('Pracuję z osobami');
    expect(boot.person.offers.length).toBeGreaterThan(0);
    expect(html).toContain('/assets/strona-panel.js');
    expect((await SELF.fetch('https://localhost/assets/strona-panel.js')).status).toBe(200);
  });

  it('saves a draft and publishes it, for its owner only and only with the CSRF token', async () => {
    const anna = await actor('anna-strona@example.invalid', 'therapist', ANNA);
    const other = await actor('ktos-inny@example.invalid', 'therapist', 'th_8b2d6e10f4a97c53d1e08b26');
    const draft = { form: 'spis', order: ['who'], answers: { who: 'Pracuję z osobami, które długo odkładały przyjście.' } };

    expect((await send(other, '/szkic', 'PUT', draft)).status).toBe(403);
    expect((await send(anna, '/szkic', 'PUT', draft, 'zly-token')).status).toBe(403);
    expect((await SELF.fetch(`${TOOL}/szkic`, { method: 'PUT', body: '{}' })).status).toBe(401);

    expect((await send(anna, '/szkic', 'PUT', draft)).status).toBe(200);
    expect((await getAuthored(env, ANNA))?.draft.form).toBe('spis');

    const refused = await send(anna, '/publikuj', 'POST', { order: ['who'], answers: { who: 'Sesja kosztuje 180 zł.' } });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toContain('To wygląda na cenę');

    const ok = await send(anna, '/publikuj', 'POST', draft);
    expect(ok.status).toBe(200);
    expect(await (await SELF.fetch(PROFILE)).text()).toContain('które długo odkładały przyjście');
  });
});
