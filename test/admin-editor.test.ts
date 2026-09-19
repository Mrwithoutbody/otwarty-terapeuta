import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAdminSession, loadAdminSession } from '../src/auth/session';
import { findOrCreateUserByEmail } from '../src/db/users';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';

interface Actor {
  cookie: string;
  csrf: string;
}

async function actor(email: string, role: string, therapistId: string | null = null): Promise<Actor> {
  const user = await findOrCreateUserByEmail(env, email);
  await env.DB.prepare(`UPDATE users SET role = ?, therapist_id = ? WHERE id = ?`)
    .bind(role, therapistId, user.id)
    .run();
  const { cookie } = await createAdminSession(env, user.id);
  const session = await loadAdminSession(
    env,
    new Request('https://localhost/admin', { headers: { cookie } }),
  );
  if (!session) throw new Error('nie udało się utworzyć sesji testowej');
  return { cookie, csrf: session.csrfToken };
}

/** Posts the profile form. Pairs, not a record, because checkbox groups repeat a name. */
function saveProfile(who: Actor, pairs: Array<[string, string]>): Promise<Response> {
  const body = new URLSearchParams();
  body.append('csrf', who.csrf);
  body.append('display_name', 'Anna Kowalczyk (DEMO)');
  body.append('slug', 'anna-kowalczyk-demo');
  for (const [key, value] of pairs) body.append(key, value);
  return SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}`, {
    method: 'POST',
    headers: { cookie: who.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'manual',
  });
}

function editorHtml(who: Actor): Promise<string> {
  return SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}`, {
    headers: { cookie: who.cookie },
  }).then((response) => response.text());
}

async function column(table: string, field: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT ${field} AS value FROM ${table} WHERE therapist_id = ? ORDER BY ${field}`,
  )
    .bind(ANNA)
    .all<{ value: string }>();
  return results.map((row) => row.value);
}


describe('formularz panelu: tożsamość tak, treść nie', () => {
  let admin: Actor;

  beforeAll(async () => {
    admin = await actor('editor-admin@example.invalid', 'admin');
  });

  it('nie pokazuje pól treści, za to prowadzi do edytora strony', async () => {
    const html = await editorHtml(admin);
    expect(html).toMatch(/<input id="display_name"[^>]*value="Anna Kowalczyk \(DEMO\)">/);
    expect(html).toMatch(/<input id="slug"[^>]*value="anna-kowalczyk-demo">/);
    for (const id of ['headline', 'bio', 'city', 'address_line', 'first_meeting_course', 'cancellation_policy', 'languages-pl', 'topics-lek']) {
      expect(html).not.toContain(`id="${id}"`);
    }
    expect(html).toMatch(/data-editor-open data-page-editor="\/admin\/terapeuci\/th_[a-z0-9]+\/strony\/[^"]+">Edytuj treść strony/);
  });

  // Dawny zapis podmieniał relacje i adres hurtem z tego, co przysłał formularz.
  // Formularz ich już nie niesie, więc zapis nie może ich dotknąć.
  it('zapis nie rusza treści profilu: relacji, gabinetu, opisu ani form pracy', async () => {
    const before = await env.DB.prepare(`SELECT bio, headline, session_types, age_groups, offers_online, cancellation_cutoff_h FROM therapists WHERE id = ?`).bind(ANNA).first();
    const languages = await column('therapist_languages', 'language_code');
    const topics = await column('therapist_specialties', 'specialty_slug');
    const modalities = await column('therapist_modalities', 'modality_slug');
    expect(languages.length).toBeGreaterThan(0);
    expect(topics.length).toBeGreaterThan(0);

    // Stary formularz w pamięci przeglądarki może jeszcze przysłać pola treści.
    const response = await saveProfile(admin, [['bio', 'nadpisane'], ['city', ''], ['languages', 'de'], ['session_types', 'family']]);
    expect(response.status).toBe(302);

    expect(await env.DB.prepare(`SELECT bio, headline, session_types, age_groups, offers_online, cancellation_cutoff_h FROM therapists WHERE id = ?`).bind(ANNA).first()).toEqual(before);
    expect(await column('therapist_languages', 'language_code')).toEqual(languages);
    expect(await column('therapist_specialties', 'specialty_slug')).toEqual(topics);
    expect(await column('therapist_modalities', 'modality_slug')).toEqual(modalities);
    expect(await column('therapist_locations', 'city')).toEqual(['Warszawa']);
  });

  it('administrator weryfikuje kwalifikacje, a zapis terapeutki ich nie zmienia', async () => {
    const res = await saveProfile(admin, [
      ['cred_title_0', 'Certyfikat psychoterapeuty'],
      ['cred_issuer_0', 'PTP'],
      ['cred_year_0', '2019'],
      ['cred_verified_0', '1'],
    ]);
    expect(res.status).toBe(302);
    const stored = async (): Promise<unknown> =>
      JSON.parse((await env.DB.prepare('SELECT credentials FROM therapists WHERE id = ?').bind(ANNA).first<{ credentials: string }>())!.credentials);
    const expected = [{ title: 'Certyfikat psychoterapeuty', issuer: 'PTP', year: 2019, verified: true }];
    expect(await stored()).toEqual(expected);
    expect(await editorHtml(admin)).toContain('Certyfikat psychoterapeuty');

    const status = async (): Promise<string> =>
      (await env.DB.prepare('SELECT status FROM therapists WHERE id = ?').bind(ANNA).first<{ status: string }>())!.status;
    const statusBefore = await status();
    const therapist = await actor('editor-anna@example.invalid', 'therapist', ANNA);
    expect(await editorHtml(therapist)).not.toContain('cred_title_0');
    const own = await saveProfile(therapist, [['cred_title_0', 'Dopisany sobie'], ['cred_verified_0', '1'], ['status', 'unpublished'], ['verification_status', 'verified']]);
    expect(own.status).toBe(302);
    expect(await stored()).toEqual(expected);
    expect(await status()).toBe(statusBefore);
  });
});

describe('licznik odsłon w panelu', () => {
  let admin: Actor;

  beforeAll(async () => {
    admin = await actor('views-admin@example.invalid', 'admin');
  });

  it('pokazuje sumę i podział na źródła', async () => {
    await env.DB.prepare(
      `INSERT INTO profile_views (therapist_id, day, source, views) VALUES (?, ?, 'web', 7)
       ON CONFLICT (therapist_id, day, source) DO UPDATE SET views = 7`,
    )
      .bind(ANNA, new Date().toISOString().slice(0, 10))
      .run();

    const html = await SELF.fetch('https://localhost/admin', {
      headers: { cookie: admin.cookie },
    }).then((r) => r.text());

    expect(html).toContain('Odsłony (30 dni)');
    expect(html).toContain('strona 7');
  });
});

describe('profile photo upload', () => {
  let admin: Actor;

  beforeAll(async () => {
    admin = await actor('photo-admin@example.invalid', 'admin');
  });

  function toFile(bytes: number[], name: string): File {
    const buffer = new ArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);
    return new File([buffer], name, { type: 'image/png' });
  }

  function upload(bytes: number[], csrf = admin.csrf, thumb?: number[]): Promise<Response> {
    const data = new FormData();
    data.append('csrf', csrf);
    data.append('photo', toFile(bytes, 'profil.png'));
    if (thumb) data.append('photo_thumb', toFile(thumb, 'profil-160.png'));
    return SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}/zdjecie`, {
      method: 'POST',
      headers: { cookie: admin.cookie },
      body: data,
      redirect: 'manual',
    });
  }

  const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  it('rejects a file whose bytes are not an image, whatever the declared type says', async () => {
    const response = await upload([0x3c, 0x73, 0x76, 0x67, 0x20]);
    expect(response.status).toBe(415);
  });

  it('rejects a request without a valid CSRF token', async () => {
    const response = await upload([...PNG_HEADER, 0, 0, 0, 0], 'nie-ten-token');
    expect(response.status).toBe(403);
  });

  it('stores a real image and points the profile at it', async () => {
    const response = await upload([...PNG_HEADER, 1, 2, 3, 4]);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as { url: string };
    expect(payload.url).toMatch(new RegExp(`^/media/therapists/${ANNA}/img_[0-9a-f]+\\.png$`));

    const row = await env.DB.prepare(`SELECT photo_url FROM therapists WHERE id = ?`)
      .bind(ANNA)
      .first<{ photo_url: string }>();
    expect(row?.photo_url).toBe(payload.url);

    const served = await SELF.fetch(`https://localhost${payload.url}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
  });

  it('stores the thumbnail beside the master under a derived key', async () => {
    const response = await upload([...PNG_HEADER, 9, 9], admin.csrf, [...PNG_HEADER, 7]);
    expect(response.status).toBe(200);

    const { url } = (await response.json()) as { url: string };
    const thumb = url.replace(/\.png$/, '-160.png');

    const servedThumb = await SELF.fetch(`https://localhost${thumb}`);
    expect(servedThumb.status).toBe(200);
    expect(new Uint8Array(await servedThumb.arrayBuffer()).length).toBe(PNG_HEADER.length + 1);

    const servedMaster = await SELF.fetch(`https://localhost${url}`);
    expect(new Uint8Array(await servedMaster.arrayBuffer()).length).toBe(PNG_HEADER.length + 2);
  });

  it('falls back to the master when a thumbnail was never written', async () => {
    // An upload from before thumbnails existed: master only.
    const response = await upload([...PNG_HEADER, 1, 2, 3]);
    expect(response.status).toBe(200);

    const { url } = (await response.json()) as { url: string };
    const served = await SELF.fetch(`https://localhost${url.replace(/\.png$/, '-160.png')}`);
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer()).length).toBe(PNG_HEADER.length + 3);
  });

  it('rejects a thumbnail whose bytes are not an image', async () => {
    const response = await upload([...PNG_HEADER, 1], admin.csrf, [0x3c, 0x73, 0x76, 0x67]);
    expect(response.status).toBe(415);
  });
});

describe('the public profile shows the photo', () => {
  let admin: Actor;

  beforeAll(async () => {
    admin = await actor('profile-photo-admin@example.invalid', 'admin');
  });

  it('renders the master on the profile page and the thumbnail on the card', async () => {
    await saveProfile(admin, [
      ['photo_url', '/media/therapists/th_x/img_abc.webp'],
      ['status', 'published'],
    ]);

    // Usługa stron przyjmuje zdjęcia wyłącznie z https; w testach PUBLIC_BASE_URL jest http,
    // więc portret sprawdza się na karcie w katalogu, a na profilu tylko pod https.
    const profile = await (await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo')).text();
    if (env.PUBLIC_BASE_URL.startsWith('https://')) expect(profile).toContain(`src="${env.PUBLIC_BASE_URL}/media/therapists/th_x/img_abc.webp"`);
    expect(profile).toContain('Anna Kowalczyk (DEMO)');

    const list = await (await SELF.fetch('https://localhost/terapeuci')).text();
    expect(list).toContain('src="/media/therapists/th_x/img_abc-160.webp"');
  });

  it('leaves an address that is not an upload untouched', async () => {
    await saveProfile(admin, [
      ['photo_url', '/media/demo/avatar-1.svg'],
      ['status', 'published'],
    ]);

    const list = await (await SELF.fetch('https://localhost/terapeuci')).text();
    expect(list).toContain('src="/media/demo/avatar-1.svg"');
    expect(list).not.toContain('avatar-1-160');
  });
});
