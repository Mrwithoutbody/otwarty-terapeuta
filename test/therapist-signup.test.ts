import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { emailLookupHash, encryptPii, hmacHex, randomId } from '../src/lib/crypto';
import { isoPlusSeconds, nowIso } from '../src/lib/time';

const TOKEN_KEY = env.TOKEN_SIGNING_KEY!;
const PII_KEY = env.PII_ENC_KEY!;

async function challenge(email: string, code: string, name: string): Promise<string> {
  const id = randomId('tsc');
  await env.DB.prepare(
    `INSERT INTO therapist_signup_challenges
       (id, email_hash, email_enc, code_hash, profile_json, attempts, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(
      id,
      await emailLookupHash(TOKEN_KEY, email),
      await encryptPii(PII_KEY, email),
      await hmacHex(TOKEN_KEY, `therapist-signup:${id}:${code}`),
      JSON.stringify({
        displayName: name,
        headline: 'Psychoterapeuta',
        bio: 'Opis sposobu pracy',
        city: 'Warszawa',
        offersOnline: true,
        offersInPerson: false,
      }),
      isoPlusSeconds(900),
      nowIso(),
    )
    .run();
  return id;
}

describe('therapist self-registration', () => {
  it('shows a public signup form and explains moderation', async () => {
    const response = await SELF.fetch('https://localhost/dla-terapeutow');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Dołącz jako terapeuta');
    expect(html).toContain('profil roboczy, niezweryfikowany');
    expect(html).toContain('cf-turnstile');
  });

  it('creates an unverified draft owned by the confirmed e-mail account', async () => {
    const email = 'nowy-terapeuta@example.invalid';
    const id = await challenge(email, '123456', 'Jan Terapeuta');
    const response = await SELF.fetch('https://localhost/dla-terapeutow/potwierdz', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ challenge_id: id, code: '123456' }).toString(),
      redirect: 'manual',
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toMatch(/^\/admin\/terapeuci\/th_/);
    expect(response.headers.get('set-cookie')).toContain('__Host-ot_admin=');

    const user = await env.DB.prepare(`SELECT role, therapist_id FROM users WHERE email_hash = ?`)
      .bind(await emailLookupHash(TOKEN_KEY, email))
      .first<{ role: string; therapist_id: string }>();
    expect(user?.role).toBe('therapist');
    const profile = await env.DB.prepare(
      `SELECT display_name, status, verification_status, is_demo FROM therapists WHERE id = ?`,
    )
      .bind(user?.therapist_id)
      .first<{ display_name: string; status: string; verification_status: string; is_demo: number }>();
    expect(profile).toEqual({
      display_name: 'Jan Terapeuta',
      status: 'draft',
      verification_status: 'unverified',
      is_demo: 0,
    });
  });

  it('does not create a profile for an invalid code', async () => {
    const email = 'bledny-kod@example.invalid';
    const id = await challenge(email, '123456', 'Nie Powstanie');
    const response = await SELF.fetch('https://localhost/dla-terapeutow/potwierdz', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ challenge_id: id, code: '999999' }).toString(),
    });
    expect(response.status).toBe(400);
    const user = await env.DB.prepare(`SELECT id FROM users WHERE email_hash = ?`)
      .bind(await emailLookupHash(TOKEN_KEY, email))
      .first();
    expect(user).toBeNull();
  });
});
