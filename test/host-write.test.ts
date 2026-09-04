import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createAdminSession } from '../src/auth/session';
import { findOrCreateUserByEmail } from '../src/db/users';
import { getTherapist } from '../src/db/catalog';
import { writeToken } from '../src/web/host-write';
import { pagesFetch } from '../src/web/pages-client';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';

const write = async (data: Record<string, unknown>, token?: string) =>
  SELF.fetch('https://localhost/api/host-blocks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: token ?? (await writeToken(env, ANNA)), data }),
  });

describe('pola danych bloku wracają do bazy', () => {
  it('formularz bloku niesie jej cennik, FAQ i opis, nie same tytuły', async () => {
    const user = await findOrCreateUserByEmail(env, 'anna-pola@example.invalid');
    await env.DB.prepare(`UPDATE users SET role = 'therapist', therapist_id = ? WHERE id = ?`).bind(ANNA, user.id).run();
    const { cookie } = await createAdminSession(env, user.id);
    const panel = await (await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}`, { headers: { cookie } })).text();
    const editorUrl = /data-page-editor="([^"]+)"/.exec(panel)![1]!;
    const form = await (await pagesFetch(env, new URL(editorUrl).pathname)).text();

    // Wiersz cennika: ukryty identyfikator oferty i jej liczby do poprawienia.
    expect(form).toMatch(/<input type="hidden" name="sec_\d+_offer_rows_0_id" value="of_/);
    expect(form).toContain('Sesja indywidualna online');
    expect(form).toContain('name="sec_5_offer_rows_0_price"');
    // FAQ i opis też są treścią, nie podpowiedzią.
    expect(form).toMatch(/name="sec_\d+_faq_rows_0_q"/);
    expect(form).toMatch(/name="sec_\d+_bio"/);
  });

  it('zapisuje cennik, opis i FAQ, a wiersz bez nazwy wyłącza ofertę', async () => {
    const before = (await getTherapist(env, { therapist_id: ANNA }))!;
    const offerId = before.offers[0]!.offer_id;

    const res = await write({
      intro: { bio: 'Nowy opis pracy.' },
      offers: { offer_rows: [{ id: offerId, title: 'Sesja indywidualna online', price: '260', minutes: '55', mode: 'online' }] },
    });
    expect(res.status).toBe(200);
    const fresh = (await res.json()) as { resolved: Record<string, { offer_rows?: unknown[] }>; summary: Record<string, { text: string }> };
    expect(fresh.summary.offers!.text).toContain('260');

    const after = (await getTherapist(env, { therapist_id: ANNA }))!;
    expect(after.bio).toBe('Nowy opis pracy.');
    const offer = after.offers.find((o) => o.offer_id === offerId)!;
    expect(offer.price_minor).toBe(26_000);
    expect(offer.duration_minutes).toBe(55);
    // Oferty, której formularz nie przysłał, nie ma już w profilu.
    expect(after.offers.length).toBe(1);

    // Nowe pytanie do FAQ powstaje z wiersza bez identyfikatora.
    const faq = await write({ 'faq-profil': { faq_rows: [{ q: 'Czy pracujesz online?', a: 'Tak, w całej Polsce.' }] } });
    expect(faq.status).toBe(200);
    const items = await env.DB.prepare(`SELECT question, status FROM faq_items WHERE therapist_id = ? AND status = 'published'`)
      .bind(ANNA)
      .all<{ question: string; status: string }>();
    expect(items.results.map((r) => r.question)).toEqual(['Czy pracujesz online?']);
  });

  it('bez ważnego tokenu nie zapisuje niczego', async () => {
    const forged = await writeToken(env, ANNA);
    const [id, exp, sig] = forged.split('.');
    expect((await write({ intro: { bio: 'nie' } }, `${id}.${exp}.${sig!.slice(0, -2)}xx`)).status).toBe(401);
    expect((await write({ intro: { bio: 'nie' } }, `${id}.${Math.floor(Date.now() / 1000) - 10}.${sig}`)).status).toBe(401);
    expect((await write({ intro: { bio: 'nie' } }, 'bzdura')).status).toBe(401);
    const t = (await getTherapist(env, { therapist_id: ANNA }))!;
    expect(t.bio).not.toBe('nie');
  });
});
