import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminSession, loadAdminSession } from '../src/auth/session';
import { getTherapist } from '../src/db/catalog';
import { findOrCreateUserByEmail } from '../src/db/users';
import { writeToken } from '../src/web/host-write';
import { ensureProfilePage } from '../src/web/lp';
import { savePageJson } from '../src/web/pages-client';

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

/** Posts the verification form. Pairs, not a record, because checkbox groups repeat a name. */
function saveProfile(who: Actor, pairs: Array<[string, string]>): Promise<Response> {
  const body = new URLSearchParams();
  body.append('csrf', who.csrf);
  for (const [key, value] of pairs) body.append(key, value);
  return SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}`, {
    method: 'POST',
    headers: { cookie: who.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'manual',
  });
}

function editorHtml(who: Actor, query = ''): Promise<string> {
  return SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}${query}`, {
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

/** Zapis z edytora strony, tak jak odsyła go usługa stron. */
const write = async (data: Record<string, unknown>): Promise<Response> =>
  SELF.fetch('https://localhost/api/host-blocks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: await writeToken(env, ANNA), data }),
  });

const therapist = async (): Promise<{ slug: string; photo_url: string | null; credentials: string; status: string }> =>
  (await env.DB.prepare('SELECT slug, photo_url, credentials, status FROM therapists WHERE id = ?').bind(ANNA).first())!;

describe('panel terapeutki: strony, grafik, rezerwacje', () => {
  let admin: Actor;
  let anna: Actor;

  beforeAll(async () => {
    admin = await actor('editor-admin@example.invalid', 'admin');
    anna = await actor('editor-anna@example.invalid', 'therapist', ANNA);
  });

  it('słowa pisze w narzędziu strony, fakty w zakładce „Dane i cennik”; edytora bloków już nie ma', async () => {
    const html = await editorHtml(admin);
    // Opis, nagłówek, zdjęcie i pierwsze spotkanie należą do strony pisanej własnymi słowami.
    for (const name of ['headline', 'bio', 'photo_url', 'first_meeting_course', 'slug']) expect(html).not.toContain(`name="hero-profil.${name}"`);
    expect(html).not.toContain('name="intro.bio"');
    for (const tab of ['Strona', 'Dane i cennik', 'Dostępność', 'Rezerwacje', 'Weryfikacja']) expect(html).toContain(`data-tab-label="${tab}"`);
    expect(html).toContain(`href="/admin/terapeuci/${ANNA}/strona"`);
    expect(html).not.toContain('Edytuj swoją stronę');
    expect(html).not.toContain('data-editor-autoopen');
    // Fakty: imię, cennik z jej ofertami, gabinet, obszary.
    expect(html).toContain('name="hero-profil.display_name"');
    expect(html).toContain('name="offers.offer_rows.0.price" maxlength="10" value="220"');
    expect(html).toContain('name="gabinet.city"');
    expect(html).toMatch(/name="topics\.topics" value="[a-z-]+" checked/);
  });

  it('terapeutka po wejściu do panelu ląduje w pisaniu swojej strony', async () => {
    const home = await SELF.fetch('https://localhost/admin', { headers: { cookie: anna.cookie }, redirect: 'manual' });
    expect(home.status).toBe(302);
    expect(home.headers.get('location')).toBe(`/admin/terapeuci/${ANNA}/strona`);

    const html = await editorHtml(anna);
    expect(html).toContain('data-tab-label="Rezerwacje"');
    expect(html).toContain('action="/admin/logout"');
    // Weryfikacja należy do zespołu.
    expect(html).not.toContain('data-tab-label="Weryfikacja"');
    expect(html).not.toContain('cred_title_0');
  });

  it('zmienia cenę, dopisuje sesję i odznacza ostatni język w zakładce „Dane i cennik”', async () => {
    const before = (await getTherapist(env, { therapist_id: ANNA }))!;
    const body = new URLSearchParams({ csrf: anna.csrf, 'hero-profil.display_name': before.display_name, 'gabinet.city': 'Warszawa', 'gabinet.address_line': 'ul. Długa 1' });
    before.offers.forEach((o, i) => {
      for (const [k, v] of Object.entries({ id: o.offer_id, title: o.title, type: o.session_type, price: i === 0 ? '240' : String(o.price_minor / 100), minutes: String(o.duration_minutes), mode: o.mode })) body.set(`offers.offer_rows.${i}.${k}`, v);
    });
    const n = before.offers.length;
    for (const [k, v] of Object.entries({ id: '', title: 'Konsultacja dla par', type: 'couples', price: '300', minutes: '80', mode: 'in_person' })) body.set(`offers.offer_rows.${n}.${k}`, v);
    // Pełny formularz: czego nie przyśle, to odznaczone - więc obszary i nurty jadą razem z resztą.
    for (const x of before.topics) body.append('topics.topics', x.slug);
    for (const x of before.modalities) body.append('topics.modalities', x.slug);
    for (const x of before.session_types) body.append('dane.session_types', x);
    for (const x of before.age_groups) body.append('dane.age_groups', x);
    body.append('dane.languages', 'pl');
    body.set('dane.offers_online', '1');
    body.set('dane.offers_in_person', '1');
    body.set('dane.accepting_new_clients', '1');

    const stranger = await actor('obcy-dane@example.invalid', 'therapist', 'th_8b2d6e10f4a97c53d1e08b26');
    const foreign = new URLSearchParams(body);
    foreign.set('csrf', stranger.csrf);
    expect((await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}/dane`, { method: 'POST', headers: { cookie: stranger.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: foreign.toString(), redirect: 'manual' })).status).toBe(403);

    const res = await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}/dane`, { method: 'POST', headers: { cookie: anna.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/terapeuci/${ANNA}?zapisano#panel-dane`);

    const after = (await getTherapist(env, { therapist_id: ANNA }))!;
    expect(after.offers.find((o) => o.offer_id === before.offers[0]!.offer_id)?.price_minor).toBe(24000);
    expect(after.offers.map((o) => o.title)).toContain('Konsultacja dla par');
    expect(after.languages).toEqual(['pl']);
    expect(after.locations[0]?.address_line).toBe('ul. Długa 1');
    expect(after.topics.map((x) => x.slug)).toEqual(before.topics.map((x) => x.slug));
    // Słów strony ten formularz nie dotyka.
    expect(after.bio).toBe(before.bio);
    expect(after.headline).toBe(before.headline);
  });

  it('terapeutka nie zapisze formularza weryfikacji', async () => {
    const before = await therapist();
    const own = await saveProfile(anna, [['cred_title_0', 'Dopisany sobie'], ['cred_verified_0', '1'], ['status', 'unpublished'], ['verification_status', 'verified']]);
    expect(own.status).toBe(403);
    expect(await therapist()).toEqual(before);
  });

  // Dawny zapis podmieniał relacje i adres hurtem z tego, co przysłał formularz.
  // Formularz ich już nie niesie, więc zapis nie może ich dotknąć.
  it('weryfikacja nie rusza treści profilu: relacji, gabinetu, opisu ani form pracy', async () => {
    const before = await env.DB.prepare(`SELECT slug, display_name, photo_url, bio, headline, session_types, offers_online FROM therapists WHERE id = ?`).bind(ANNA).first();
    const languages = await column('therapist_languages', 'language_code');
    const topics = await column('therapist_specialties', 'specialty_slug');
    expect(languages.length).toBeGreaterThan(0);
    expect(topics.length).toBeGreaterThan(0);

    // Stary formularz w pamięci przeglądarki może jeszcze przysłać pola treści.
    const response = await saveProfile(admin, [['bio', 'nadpisane'], ['city', ''], ['languages', 'de'], ['display_name', 'X'], ['photo_url', '/x.png'], ['status', 'published']]);
    expect(response.status).toBe(302);

    expect(await env.DB.prepare(`SELECT slug, display_name, photo_url, bio, headline, session_types, offers_online FROM therapists WHERE id = ?`).bind(ANNA).first()).toEqual(before);
    expect(await column('therapist_languages', 'language_code')).toEqual(languages);
    expect(await column('therapist_specialties', 'specialty_slug')).toEqual(topics);
    expect(await column('therapist_locations', 'city')).toEqual(['Warszawa']);
  });

  it('administrator weryfikuje kwalifikacje', async () => {
    const res = await saveProfile(admin, [
      ['cred_title_0', 'Certyfikat psychoterapeuty'],
      ['cred_issuer_0', 'PTP'],
      ['cred_year_0', '2019'],
      ['cred_verified_0', '1'],
      ['status', 'published'],
    ]);
    expect(res.status).toBe(302);
    expect(JSON.parse((await therapist()).credentials)).toEqual([{ title: 'Certyfikat psychoterapeuty', issuer: 'PTP', year: 2019, verified: true }]);
    expect(await editorHtml(admin)).toContain('Certyfikat psychoterapeuty');
  });
});

describe('portret wybrany w edytorze przechodzi do naszego magazynu', () => {
  const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3];
  const served: Record<string, number[]> = {
    'https://pages.test/media/uploads/abc/portret.webp': WEBP,
    'https://pages.test/media/uploads/abc/drugi.webp': [...WEBP, 9],
    'https://pages.test/media/uploads/abc/nie-obraz.webp': [0x3c, 0x73, 0x76, 0x67],
  };
  const pages = vi.fn();

  beforeAll(() => {
    const real = globalThis.fetch;
    pages.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const bytes = served[url];
      return bytes ? Promise.resolve(new Response(new Uint8Array(bytes))) : real(input, init);
    });
    vi.stubGlobal('fetch', pages);
  });
  afterEach(() => pages.mockClear());

  const media = async (url: string): Promise<Response> => SELF.fetch(`https://localhost${url}`);

  it('kopiuje plik usługi do R2, a stary portret sprząta', async () => {
    expect((await write({ 'hero-profil': { photo_url: 'https://pages.test/media/uploads/abc/portret.webp' } })).status).toBe(200);
    const first = (await therapist()).photo_url!;
    expect(first).toMatch(new RegExp(`^/media/therapists/${ANNA}/img_[0-9a-f]+\\.webp$`));
    const file = await media(first);
    expect(file.headers.get('content-type')).toBe('image/webp');
    expect(new Uint8Array(await file.arrayBuffer()).length).toBe(WEBP.length);

    expect((await write({ 'hero-profil': { photo_url: 'https://pages.test/media/uploads/abc/drugi.webp' } })).status).toBe(200);
    const second = (await therapist()).photo_url!;
    expect(second).not.toBe(first);
    // Nic już nie wskazuje na pierwszy plik: znika z magazynu i z listy jej plików.
    expect((await media(first)).status).toBe(404);
    expect(await column('therapist_media', 'url')).toEqual([second]);
  });

  it('plik, którego używa któraś z jej stron, zostaje', async () => {
    await write({ 'hero-profil': { photo_url: 'https://pages.test/media/uploads/abc/portret.webp' } });
    const used = (await therapist()).photo_url!;
    const profile = await ensureProfilePage(env, ANNA, 'Anna Kowalczyk (DEMO)');
    await savePageJson(env, ANNA, profile.id, { blocks: [{ id: 'x', data: { media: { url: `https://otwartyterapeuta.pl${used}` } } }] });
    await write({ 'hero-profil': { photo_url: 'https://pages.test/media/uploads/abc/drugi.webp' } });
    expect((await media(used)).status).toBe(200);
  });

  it('nie pobiera z obcych adresów i nie przyjmuje czegoś, co nie jest obrazem', async () => {
    const before = (await therapist()).photo_url;
    const foreign = await write({ 'hero-profil': { photo_url: 'https://evil.example/portret.png' } });
    expect(foreign.status).toBe(400);
    expect(pages).not.toHaveBeenCalledWith('https://evil.example/portret.png', expect.anything());

    const fake = await write({ 'hero-profil': { photo_url: 'https://pages.test/media/uploads/abc/nie-obraz.webp' } });
    expect(fake.status).toBe(415);
    expect((await therapist()).photo_url).toBe(before);
  });

  it('własny adres zostaje taki, jaki jest', async () => {
    expect((await write({ 'hero-profil': { photo_url: '/media/demo/avatar-1.svg' } })).status).toBe(200);
    expect((await therapist()).photo_url).toBe('/media/demo/avatar-1.svg');
  });
});

describe('adres profilu w edytorze', () => {
  it('zmienia adres, a zajętego nie przyjmuje', async () => {
    expect((await write({ 'hero-profil': { slug: 'Anna Kowalczyk – Łódź' } })).status).toBe(200);
    expect((await therapist()).slug).toBe('anna-kowalczyk-lodz');
    expect((await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-lodz')).status).toBe(200);

    const taken = await write({ 'hero-profil': { slug: 'marek-zielinski-demo' } });
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: string }).error).toContain('marek-zielinski-demo');
    expect((await therapist()).slug).toBe('anna-kowalczyk-lodz');

    // Pusty albo z samych znaków spoza adresu: nic się nie zmienia.
    expect((await write({ 'hero-profil': { slug: '---' } })).status).toBe(200);
    expect((await therapist()).slug).toBe('anna-kowalczyk-lodz');

    await write({ 'hero-profil': { slug: 'anna-kowalczyk-demo' } });
  });
});

describe('the public profile shows the photo', () => {
  const setPhoto = (url: string) =>
    env.DB.prepare(`UPDATE therapists SET photo_url = ?, status = 'published' WHERE id = ?`).bind(url, ANNA).run();

  it('renders the master on the profile page and the thumbnail on the card', async () => {
    await setPhoto('/media/therapists/th_x/img_abc.webp');

    // Usługa stron przyjmuje zdjęcia wyłącznie z https; w testach PUBLIC_BASE_URL jest http,
    // więc portret sprawdza się na karcie w katalogu, a na profilu tylko pod https.
    const profile = await (await SELF.fetch('https://localhost/terapeuci/anna-kowalczyk-demo')).text();
    if (env.PUBLIC_BASE_URL.startsWith('https://')) expect(profile).toContain(`src="${env.PUBLIC_BASE_URL}/media/therapists/th_x/img_abc.webp"`);
    expect(profile).toContain('Anna Kowalczyk (DEMO)');

    const list = await (await SELF.fetch('https://localhost/terapeuci')).text();
    expect(list).toContain('src="/media/therapists/th_x/img_abc-160.webp"');
  });

  it('leaves an address that is not an upload untouched', async () => {
    await setPhoto('/media/demo/avatar-1.svg');
    const list = await (await SELF.fetch('https://localhost/terapeuci')).text();
    expect(list).toContain('src="/media/demo/avatar-1.svg"');
    expect(list).not.toContain('avatar-1-160');
  });
});
