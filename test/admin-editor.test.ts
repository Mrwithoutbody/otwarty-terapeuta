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

/** Posts the page-layout form, which saves on its own endpoint. */
function saveSections(who: Actor, pairs: Array<[string, string]>): Promise<Response> {
  const body = new URLSearchParams();
  body.append('csrf', who.csrf);
  for (const [key, value] of pairs) body.append(key, value);
  return SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}/sekcje`, {
    method: 'POST',
    headers: { cookie: who.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'manual',
  });
}

async function storedSections(): Promise<Array<Record<string, unknown>>> {
  const row = await env.DB.prepare(`SELECT sections_json FROM therapists WHERE id = ?`)
    .bind(ANNA)
    .first<{ sections_json: string }>();
  return JSON.parse(row?.sections_json ?? '[]') as Array<Record<string, unknown>>;
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

async function storedCredentials(): Promise<Array<Record<string, unknown>>> {
  const row = await env.DB.prepare(`SELECT credentials FROM therapists WHERE id = ?`)
    .bind(ANNA)
    .first<{ credentials: string }>();
  return JSON.parse(row?.credentials ?? '[]') as Array<Record<string, unknown>>;
}

describe('therapist editor form state', () => {
  let admin: Actor;

  beforeAll(async () => {
    admin = await actor('editor-admin@example.invalid', 'admin');
  });

  // The form used to render these inputs empty while the save handler replaced
  // the relations wholesale, so every save silently wiped them.
  it('renders the stored languages, topics and modalities as checked', async () => {
    const html = await editorHtml(admin);

    expect(html).toMatch(/<input id="languages-pl"[^>]*\schecked>/);
    expect(html).toMatch(/<input id="languages-en"[^>]*\schecked>/);
    expect(html).toMatch(/<input id="topics-lek"[^>]*\schecked>/);
    expect(html).toMatch(/<input id="modalities-poznawczo-behawioralna"[^>]*\schecked>/);

    // Something the profile does not have must render unchecked.
    expect(html).toMatch(/<input id="languages-de"(?![^>]*checked)[^>]*>/);
  });

  it('renders the stored city and address instead of blank inputs', async () => {
    const html = await editorHtml(admin);
    expect(html).toMatch(/<input id="city"[^>]*value="Warszawa">/);
    expect(html).toMatch(/<input id="address_line"[^>]*value="ul\. Przykładowa 1\/2">/);
  });

  it('keeps the relations that the rendered form posts back', async () => {
    const response = await saveProfile(admin, [
      ['languages', 'pl'],
      ['languages', 'en'],
      ['topics', 'lek'],
      ['topics', 'depresja'],
      ['modalities', 'poznawczo-behawioralna'],
      ['city', 'Warszawa'],
      ['address_line', 'ul. Przykładowa 1/2'],
    ]);
    expect(response.status).toBe(302);

    expect(await column('therapist_languages', 'language_code')).toEqual(['en', 'pl']);
    expect(await column('therapist_specialties', 'specialty_slug')).toEqual(['depresja', 'lek']);
    expect(await column('therapist_modalities', 'modality_slug')).toEqual(['poznawczo-behawioralna']);
    expect(await column('therapist_locations', 'city')).toEqual(['Warszawa']);
  });

  it('clears the office location when the city field is emptied', async () => {
    const response = await saveProfile(admin, [['city', '']]);
    expect(response.status).toBe(302);
    expect(await column('therapist_locations', 'city')).toEqual([]);
  });

  it('stores the checked session types and age groups as JSON', async () => {
    await saveProfile(admin, [
      ['session_types', 'individual'],
      ['session_types', 'couples'],
      ['age_groups', 'adults'],
      // Not one of the four allowed values.
      ['age_groups', 'wszyscy'],
    ]);

    const row = await env.DB.prepare(`SELECT session_types, age_groups FROM therapists WHERE id = ?`)
      .bind(ANNA)
      .first<{ session_types: string; age_groups: string }>();
    expect(JSON.parse(row?.session_types ?? '[]')).toEqual(['individual', 'couples']);
    expect(JSON.parse(row?.age_groups ?? '[]')).toEqual(['adults']);
  });
});

describe('credential verification is an administrator decision', () => {
  let admin: Actor;
  let therapist: Actor;

  beforeAll(async () => {
    admin = await actor('cred-admin@example.invalid', 'admin');
    therapist = await actor('cred-therapist@example.invalid', 'therapist', ANNA);
  });

  it('lets an administrator mark a credential verified', async () => {
    await saveProfile(admin, [
      ['cred_title_0', 'Certyfikat psychoterapeuty'],
      ['cred_issuer_0', 'PTP'],
      ['cred_year_0', '2019'],
      ['cred_verified_0', '1'],
    ]);

    expect(await storedCredentials()).toEqual([
      { title: 'Certyfikat psychoterapeuty', issuer: 'PTP', year: 2019, verified: true },
    ]);
  });

  it('refuses to let a therapist award the badge to themselves', async () => {
    await saveProfile(therapist, [
      ['cred_title_0', 'Dyplom wymyślony'],
      ['cred_issuer_0', 'Nikt'],
      ['cred_year_0', '2024'],
      ['cred_verified_0', '1'],
    ]);

    expect(await storedCredentials()).toEqual([
      { title: 'Dyplom wymyślony', issuer: 'Nikt', year: 2024, verified: false },
    ]);
  });

  it("preserves the administrator's decision across a therapist's own save", async () => {
    await saveProfile(admin, [
      ['cred_title_0', 'Certyfikat psychoterapeuty'],
      ['cred_issuer_0', 'PTP'],
      ['cred_year_0', '2019'],
      ['cred_verified_0', '1'],
    ]);

    // The therapist edits an unrelated field; the checkbox is not even rendered for them.
    await saveProfile(therapist, [
      ['cred_title_0', 'Certyfikat psychoterapeuty'],
      ['cred_issuer_0', 'PTP'],
      ['cred_year_0', '2019'],
      ['headline', 'Nowy nagłówek'],
    ]);

    expect(await storedCredentials()).toEqual([
      { title: 'Certyfikat psychoterapeuty', issuer: 'PTP', year: 2019, verified: true },
    ]);
  });

  it('drops rows with an empty title and rejects an out-of-range year', async () => {
    await saveProfile(admin, [
      ['cred_title_0', ''],
      ['cred_issuer_0', 'Pusty'],
      ['cred_title_1', 'Szkolenie'],
      ['cred_issuer_1', 'Instytut'],
      ['cred_year_1', '1200'],
    ]);

    expect(await storedCredentials()).toEqual([
      { title: 'Szkolenie', issuer: 'Instytut', year: null, verified: false },
    ]);
  });
});

describe('bio formatting', () => {
  let admin: Actor;

  beforeAll(async () => {
    admin = await actor('bio-admin@example.invalid', 'admin');
  });

  it('renders paragraphs and bold on the public profile, and escapes the rest', async () => {
    await saveProfile(admin, [
      ['bio', 'Pierwszy **akapit**.\n\nDrugi z gwiazdką \\* i <b>tagiem</b>.'],
      ['status', 'published'],
      ['verification_status', 'verified'],
    ]);

    const html = await (await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo')).text();
    expect(html).toContain('<p>Pierwszy <strong>akapit</strong>.</p>');
    expect(html).toContain('<p>Drugi z gwiazdką * i &lt;b&gt;tagiem&lt;/b&gt;.</p>');
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

    const profile = await (await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo')).text();
    expect(profile).toContain('class="phero-photo" src="/media/therapists/th_x/img_abc.webp"');

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

describe('slot hours come from the hour chips', () => {
  const OFFER = 'of_01';
  let admin: Actor;

  beforeAll(async () => {
    admin = await actor('hours-admin@example.invalid', 'admin');
  });

  function generate(pairs: Array<[string, string]>): Promise<Response> {
    const body = new URLSearchParams();
    body.append('csrf', admin.csrf);
    body.append('offer_id', OFFER);
    body.append('days', '7');
    body.append('timezone', 'Europe/Warsaw');
    for (const [key, value] of pairs) body.append(key, value);
    return SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}/terminy`, {
      method: 'POST',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'manual',
    });
  }

  async function countByLocalHour(): Promise<Record<string, number>> {
    const { results } = await env.DB.prepare(
      `SELECT starts_at_utc FROM appointment_slots WHERE offer_id = ?`,
    )
      .bind(OFFER)
      .all<{ starts_at_utc: string }>();
    const format = new Intl.DateTimeFormat('pl-PL', {
      timeZone: 'Europe/Warsaw',
      hour: '2-digit',
      hour12: false,
    });
    const counts: Record<string, number> = {};
    for (const row of results) {
      const hour = format.format(new Date(row.starts_at_utc));
      counts[hour] = (counts[hour] ?? 0) + 1;
    }
    return counts;
  }

  async function localHours(): Promise<string[]> {
    return Object.keys(await countByLocalHour()).sort();
  }

  it('accepts one entry per checked chip', async () => {
    const before = await localHours();
    const response = await generate([
      ['hours', '6'],
      ['hours', '7'],
      // Not an hour of the day; must be ignored rather than break the batch.
      ['hours', '99'],
    ]);
    expect(response.status).toBe(302);

    const added = (await localHours()).filter((hour) => !before.includes(hour));
    expect(added).toEqual(['06', '07']);

    // Every checked hour must land on the same set of working days: a per-hour
    // dropout would show up as two different counts.
    const perHour = await countByLocalHour();
    expect(perHour['06']).toBeGreaterThan(0);
    expect(perHour['07']).toBe(perHour['06']);
  });

  it('still accepts the older comma-separated single field', async () => {
    const before = await localHours();
    const response = await generate([['hours', '3,4']]);
    expect(response.status).toBe(302);

    const added = (await localHours()).filter((hour) => !before.includes(hour));
    expect(added).toEqual(['03', '04']);
  });

  it('refuses to generate anything when no hour is chosen', async () => {
    const before = await localHours();
    const response = await generate([]);
    expect(response.status).toBe(400);
    expect(await localHours()).toEqual(before);
  });

});

// The layout lives in its own tab and its own endpoint. It used to ride along
// with the profile form, so appending one empty section rewrote the whole
// profile - relations included, which are replaced wholesale.
describe('page layout saves on its own', () => {
  let admin: Actor;

  beforeAll(async () => {
    admin = await actor('layout-admin@example.invalid', 'admin');
  });

  it('stores the sections in the posted order, with their variants', async () => {
    await saveSections(admin, [
      ['sec_0_type', 'intro'], ['sec_0_pos', '2'], ['sec_0_variant', 'alt'],
      ['sec_1_type', 'cytat'], ['sec_1_pos', '1'], ['sec_1_body', 'Jedno zdanie.'],
    ]);

    const sections = await storedSections();
    expect(sections.map((section) => section.type)).toEqual(['cytat', 'intro']);
    expect(sections[1]?.variant).toBe('alt');
  });

  it('keeps the layout when the profile form is saved', async () => {
    await saveSections(admin, [['sec_0_type', 'cytat'], ['sec_0_pos', '1'], ['sec_0_body', 'Zostaje.']]);
    await saveProfile(admin, [['bio', 'Nowy opis.']]);

    const sections = await storedSections();
    expect(sections).toHaveLength(1);
    expect(sections[0]?.body).toBe('Zostaje.');
  });

  it('drops a section marked for removal and appends the one being added', async () => {
    await saveSections(admin, [
      ['sec_0_type', 'cytat'], ['sec_0_pos', '1'], ['sec_0_body', 'Do usunięcia.'], ['sec_0_del', '1'],
      ['sec_1_type', 'intro'], ['sec_1_pos', '2'],
      ['action', 'add_section'], ['add_section', 'wyroznienie'],
    ]);

    expect((await storedSections()).map((section) => section.type)).toEqual(['intro', 'wyroznienie']);
  });

  it('refuses a therapist reaching for someone else\'s layout', async () => {
    const stranger = await actor('layout-stranger@example.invalid', 'therapist', 'th_1e07b8d3629af45c0d2e7a91');
    const response = await saveSections(stranger, [['sec_0_type', 'intro'], ['sec_0_pos', '1']]);
    expect(response.status).toBe(403);
  });
});
