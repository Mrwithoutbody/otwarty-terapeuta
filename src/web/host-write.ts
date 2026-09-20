/**
 * Zapis z edytora stron z powrotem do tej bazy.
 *
 * Bloki hosta niosą jej dane - imię, opis, cennik, FAQ, kwalifikacje. Pola
 * oznaczone w `HOST_SECTIONS` jako `data` edytuje się w formularzu bloku, a
 * usługa odsyła je tutaj przy zapisie. Dzięki temu cena widnieje w jednym
 * miejscu: w tej bazie, z której żyją też katalog i narzędzia MCP.
 *
 * Dostęp daje token, który host sam wystawił otwierając sesję edycji: HMAC nad
 * identyfikatorem terapeutki i czasem wygaśnięcia. Usługa go tylko przechowuje
 * i odsyła - nie zna klucza i nie potrafi go podrobić.
 */
import { Hono } from 'hono';
import type { Env } from '../env';
import { getTherapist } from '../db/catalog';
import { audit } from '../lib/audit';
import { hmacBase64Url, randomId, timingSafeEqual } from '../lib/crypto';
import { normalizeForSearch, sanitizeLine, sanitizeRichText } from '../lib/sanitize';
import { nowIso } from '../lib/time';
import { FAQ_CATEGORIES, FAQ_ROWS, OFFER_ROWS, OFFER_TYPES, resolveAll, summarize } from './host-blocks';
import { CREDENTIAL_ROWS, patchesFor } from './data-fields';
import { profileContext } from './pages';
import { pagesOrigin, savePageJson } from './pages-client';

/** Ile żyje prawo do zapisu. Tyle, ile sesja edycji po stronie usługi. */
const TOKEN_TTL_SECONDS = 2 * 60 * 60;

type Values = Record<string, unknown>;

export const hostWriteApp = new Hono<{ Bindings: Env }>();

/** Token dla jednej sesji edycji: `<id>.<exp>.<podpis>`. */
export async function writeToken(env: Env, therapistId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const body = `${therapistId}.${exp}`;
  return `${body}.${await hmacBase64Url(env.TOKEN_SIGNING_KEY, `hostwrite:${body}`)}`;
}

/** Identyfikator terapeutki z tokenu, albo null - wygasł, podrobiony, obcy. */
async function therapistFromToken(env: Env, token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || token.length > 300) return null;
  const [id, exp, signature] = token.split('.');
  if (!id || !exp || !signature) return null;
  if (!Number.isFinite(Number(exp)) || Number(exp) * 1000 < Date.now()) return null;
  const expected = await hmacBase64Url(env.TOKEN_SIGNING_KEY, `hostwrite:${id}.${exp}`);
  return timingSafeEqual(expected, signature) ? id : null;
}

/** Odmowa zapisu z powodem, który edytor pokaże terapeutce. */
class Refused extends Error {
  constructor(readonly status: 400 | 409 | 413 | 415 | 502, message: string) {
    super(message);
  }
}

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const rows = (value: unknown): Values[] => (Array.isArray(value) ? (value as Values[]) : []);
/** Wartość z listy zamkniętej albo domyślna - select z edytora to nadal cudze wejście. */
const oneOf = (options: Array<[string, string]>, value: unknown, fallback: string): string =>
  options.some(([slug]) => slug === value) ? (value as string) : fallback;

/**
 * Kwalifikacje z edytora scalone z tym, co jest w bazie. Formularz nie niesie
 * znacznika „zweryfikowane" (nadaje go administrator) i pokazuje tylko pierwsze
 * `CREDENTIAL_ROWS` wpisów, więc zapis wprost kasowałby weryfikację i obcinał listę.
 * Znacznik wraca po nazwie i wydającym, tak jak w panelu; wpisy spoza formularza zostają.
 */
async function mergeCredentials(env: Env, id: string, sentJson: string): Promise<string> {
  const row = await env.DB.prepare(`SELECT credentials FROM therapists WHERE id = ?`).bind(id).first<{ credentials: string | null }>();
  let stored: Values[] = [];
  try {
    const parsed: unknown = JSON.parse(row?.credentials ?? '[]');
    if (Array.isArray(parsed)) stored = parsed.filter((c): c is Values => typeof c === 'object' && c !== null);
  } catch {
    // zepsuty JSON w kolumnie: nie ma czego zachować
  }
  const key = (c: Values): string => `${normalizeForSearch(String(c.title ?? ''))}|${normalizeForSearch(String(c.issuer ?? ''))}`;
  const verified = new Set(stored.filter((c) => c.verified === true).map(key));
  const sent = JSON.parse(sentJson) as Values[];
  return JSON.stringify([...sent.map((c) => ({ ...c, verified: verified.has(key(c)) })), ...stored.slice(CREDENTIAL_ROWS)]);
}

/**
 * Magic bytes, not the declared `Content-Type`: `/media/:key` serves the stored
 * type straight back, so the type is decided here, from the file itself.
 */
export function sniffImageType(bytes: Uint8Array): { mime: string; extension: string } | null {
  const startsWith = (...signature: number[]): boolean => signature.every((byte, index) => bytes[index] === byte);
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: 'image/png', extension: 'png' };
  if (startsWith(0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', extension: 'jpg' };
  if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { mime: 'image/webp', extension: 'webp' };
  }
  return null;
}

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Portret wybrany w oknie mediów edytora leży w magazynie usługi stron. Katalog
 * jeszcze by go pokazał, ale widżet w ChatGPT wpuszcza obrazy tylko z tego serwisu,
 * więc plik przechodzi do naszego R2, a w bazie zostaje nasz adres. Przyjmujemy
 * wyłącznie pliki usługi (i własne): dowolny adres z sieci to pobieranie na zlecenie.
 */
async function adoptPhoto(env: Env, id: string, url: string): Promise<string> {
  if (url === '' || url.startsWith('/media/')) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Refused(400, 'Nieprawidłowy adres zdjęcia.');
  }
  if (parsed.origin === new URL(env.PUBLIC_BASE_URL).origin && parsed.pathname.startsWith('/media/')) return parsed.pathname;
  if (parsed.origin !== pagesOrigin(env) || !parsed.pathname.startsWith('/media/')) {
    throw new Refused(400, 'Zdjęcie wybierz albo wgraj w oknie mediów.');
  }
  // Środowisko bez magazynu (preview): adres usługi, który strona i katalog wpuszczają.
  if (!env.MEDIA) return parsed.href;

  // Usługa serwuje pliki wprost z R2; przekierowanie wyprowadziłoby pobieranie poza jej origin.
  const res = await fetch(parsed.href, { redirect: 'manual', signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res?.ok) throw new Refused(502, 'Nie udało się pobrać zdjęcia. Spróbuj jeszcze raz.');
  if (Number(res.headers.get('content-length') ?? 0) > PHOTO_MAX_BYTES) throw new Refused(413, 'Zdjęcie ma ponad 2 MB.');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES) throw new Refused(413, 'Zdjęcie ma ponad 2 MB.');
  const kind = sniffImageType(bytes);
  if (!kind) throw new Refused(415, 'Zdjęcie musi być w formacie PNG, JPEG albo WebP.');

  const own = `/media/therapists/${id}/${randomId('img')}.${kind.extension}`;
  await env.MEDIA.put(own.slice('/media/'.length), bytes, { httpMetadata: { contentType: kind.mime } });
  await env.DB.prepare(`INSERT INTO therapist_media (id, therapist_id, url, created_at) VALUES (?, ?, ?, ?)`)
    .bind(randomId('med'), id, own, nowIso())
    .run();
  return own;
}

/**
 * Jej pliki w naszym magazynie, których już nic nie używa: ani portret, ani żadna jej
 * strona. Galerii do ręcznego sprzątania nie ma, więc stary portret znika przy zmianie.
 * `instr`, nie `LIKE`: D1 odrzuca wzorzec dłuższy niż 50 znaków, a klucz pliku jest dłuższy.
 */
async function pruneMedia(env: Env, id: string, portrait: string): Promise<void> {
  if (!env.MEDIA) return;
  const { results } = await env.DB.prepare(`SELECT id, url FROM therapist_media WHERE therapist_id = ?`)
    .bind(id)
    .all<{ id: string; url: string }>();
  for (const media of results) {
    if (media.url === portrait || !media.url.startsWith(`/media/therapists/${id}/`)) continue;
    const key = media.url.slice('/media/'.length);
    const stem = key.replace(/\.[a-z]+$/, '');
    const used = await env.DB.prepare(`SELECT 1 FROM therapist_pages WHERE therapist_id = ? AND instr(page_json, ?) > 0 LIMIT 1`)
      .bind(id, stem)
      .first();
    if (used) continue;
    await Promise.all([key, key.replace(/(\.[a-z]+)$/, '-160$1')].map((k) => env.MEDIA!.delete(k)));
    await env.DB.prepare(`DELETE FROM therapist_media WHERE id = ?`).bind(media.id).run();
  }
}

/**
 * Wartości z bloków w bazie. Co gdzie idzie, mówi `FIELDS` w `data-fields.ts`,
 * więc nowe pole nie wymaga zmiany w tym pliku. Wyjątki zależą od stanu w bazie
 * albo w magazynie: kwalifikacje (`mergeCredentials`), zajęty adres profilu i portret
 * (`adoptPhoto`). Wszystkie sprawdzenia idą przed pierwszym zapisem.
 */
async function writeFields(env: Env, id: string, data: Record<string, Values>): Promise<string[]> {
  const patches = Object.entries(data).flatMap(([type, sent]) => patchesFor(type, sent));
  const columns = patches.filter((p): p is { column: string; value: string | number } => 'column' in p);
  for (const patch of columns) {
    if (patch.column === 'credentials') patch.value = await mergeCredentials(env, id, String(patch.value));
    if (patch.column === 'photo_url') patch.value = await adoptPhoto(env, id, String(patch.value));
    if (patch.column === 'slug') {
      const taken = await env.DB.prepare(`SELECT 1 FROM therapists WHERE slug = ? AND id != ?`).bind(patch.value, id).first();
      if (taken) throw new Refused(409, `Adres „${patch.value}” ma już inny profil.`);
    }
  }
  const relations = patches.filter((p): p is { relation: 'languages' | 'topics' | 'modalities'; values: string[] } => 'relation' in p);

  if (columns.length > 0) {
    await env.DB.prepare(
      `UPDATE therapists SET ${columns.map((p) => `${p.column}=?`).join(', ')}, updated_at=? WHERE id = ?`,
    )
      .bind(...columns.map((p) => p.value), nowIso(), id)
      .run();
  }

  for (const patch of relations) {
    const { table, column, source, key } = RELATIONS[patch.relation];
    const statements = [env.DB.prepare(`DELETE FROM ${table} WHERE therapist_id = ?`).bind(id)];
    for (const value of patch.values) {
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO ${table} (therapist_id, ${column}) SELECT ?, ${key} FROM ${source} WHERE ${key} = ?`,
        ).bind(id, value),
      );
    }
    await env.DB.batch(statements);
  }

  for (const patch of patches) {
    if ('location' in patch) await writeLocation(env, id, patch.location);
  }

  const portrait = columns.find((p) => p.column === 'photo_url');
  if (portrait) await pruneMedia(env, id, String(portrait.value));

  return [
    ...columns.map((p) => p.column),
    ...relations.map((p) => p.relation),
    ...patches.flatMap((p) => ('location' in p ? ['location'] : [])),
  ];
}

/** Jeden gabinet: puste miasto zdejmuje adres z profilu. */
async function writeLocation(env: Env, id: string, loc: { city: string; address: string }): Promise<void> {
  const statements = [env.DB.prepare(`DELETE FROM therapist_locations WHERE therapist_id = ?`).bind(id)];
  if (loc.city !== '') {
    statements.push(
      env.DB.prepare(
        `INSERT INTO therapist_locations (id, therapist_id, city, city_norm, country, address_line, is_primary)
         VALUES (?, ?, ?, ?, 'PL', ?, 1)`,
      ).bind(randomId('loc'), id, loc.city, normalizeForSearch(loc.city), loc.address),
    );
  }
  await env.DB.batch(statements);
}

/** Tabele wiążące dla wyborów wielokrotnych; słownik pilnuje, co wolno wstawić. */
const RELATIONS = {
  languages: { table: 'therapist_languages', column: 'language_code', source: 'languages', key: 'code' },
  topics: { table: 'therapist_specialties', column: 'specialty_slug', source: 'specialties', key: 'slug' },
  modalities: { table: 'therapist_modalities', column: 'modality_slug', source: 'modalities', key: 'slug' },
} as const;

/**
 * Cennik. Wiersz z identyfikatorem poprawia ofertę, wiersz bez niego zakłada
 * nową, a oferta, której w formularzu zabrakło, przestaje być aktywna - nigdy
 * nie znika, bo mogą do niej być przypięte rezerwacje.
 *
 * Wyłączanie działa tylko wtedy, gdy formularz pokazał wszystkie aktywne oferty.
 * Przy większej liczbie brak wiersza nie znaczy „usuń", tylko „nie było go widać".
 */
async function writeOffers(env: Env, id: string, list: Values[]): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT id FROM session_offers WHERE therapist_id = ? AND active = 1`)
    .bind(id)
    .all<{ id: string }>();
  const at = nowIso();
  const kept = new Set<string>();
  let changes = 0;

  for (const row of list.slice(0, OFFER_ROWS)) {
    const title = sanitizeLine(String(row.title ?? ''), 120);
    const priceMinor = Math.round(Math.min(Math.max(Number(String(row.price ?? '').replace(',', '.')) || 0, 0), 5000) * 100);
    const minutes = Math.min(Math.max(Number(row.minutes ?? 50) || 50, 15), 240);
    const mode = row.mode === 'in_person' ? 'in_person' : 'online';
    const type = oneOf(OFFER_TYPES, row.type, 'individual');
    const offerId = str(row.id, 64);
    if (title === '') continue; // pusty wiersz to wyłączenie oferty albo nic
    kept.add(offerId);
    if (offerId !== '' && results.some((existing) => existing.id === offerId)) {
      await env.DB.prepare(
        `UPDATE session_offers SET title=?, session_type=COALESCE(?, session_type), price_minor=?, duration_minutes=?, mode=?, updated_at=? WHERE id = ? AND therapist_id = ?`,
      )
        // Sesja edycji otwarta przed dodaniem pola nie przyśle typu: brak znaczy „zostaw", nie „indywidualna".
        .bind(title, 'type' in row ? type : null, priceMinor, minutes, mode, at, offerId, id)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO session_offers (id, therapist_id, title, session_type, mode, duration_minutes, price_minor, currency, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PLN', 1, ?, ?)`,
      )
        .bind(randomId('of'), id, title, type, mode, minutes, priceMinor, at, at)
        .run();
    }
    changes += 1;
  }

  for (const existing of results.length > OFFER_ROWS ? [] : results) {
    if (kept.has(existing.id)) continue;
    await env.DB.prepare(`UPDATE session_offers SET active = 0, updated_at = ? WHERE id = ? AND therapist_id = ?`)
      .bind(at, existing.id, id)
      .run();
    changes += 1;
  }
  return changes;
}

/** FAQ: wiersz z identyfikatorem poprawia wpis, bez - zakłada, brakujący znika - o ile formularz pokazał wszystkie. */
async function writeFaq(env: Env, id: string, list: Values[]): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT id FROM faq_items WHERE therapist_id = ? AND status = 'published'`)
    .bind(id)
    .all<{ id: string }>();
  const at = nowIso();
  const kept = new Set<string>();
  let changes = 0;

  for (const [position, row] of list.slice(0, FAQ_ROWS).entries()) {
    const question = sanitizeLine(String(row.q ?? ''), 200);
    const answer = sanitizeRichText(String(row.a ?? ''), 2000);
    const faqId = str(row.id, 64);
    const category = oneOf(FAQ_CATEGORIES, row.category, 'general');
    if (question === '' || answer === '') continue;
    kept.add(faqId);
    if (faqId !== '' && results.some((existing) => existing.id === faqId)) {
      await env.DB.prepare(`UPDATE faq_items SET question=?, answer=?, category=COALESCE(?, category), position=?, updated_at=? WHERE id = ? AND therapist_id = ?`)
        .bind(question, answer, 'category' in row ? category : null, position, at, faqId, id)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO faq_items (id, therapist_id, question, answer, category, position, status, approved_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
      )
        .bind(randomId('faq'), id, question, answer, category, position, at, at, at)
        .run();
    }
    changes += 1;
  }

  for (const existing of results.length > FAQ_ROWS ? [] : results) {
    if (kept.has(existing.id)) continue;
    await env.DB.prepare(`UPDATE faq_items SET status = 'archived', updated_at = ? WHERE id = ? AND therapist_id = ?`)
      .bind(at, existing.id, id)
      .run();
    changes += 1;
  }
  return changes;
}

/**
 * Jedno wywołanie usługi po zapisie w edytorze. Odpowiedź niesie świeże
 * `resolved` i `summary`, więc edytor zaraz po zapisie pokazuje nowe liczby,
 * a nie te sprzed dwóch godzin z migawki sesji.
 */
hostWriteApp.post('/host-blocks', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { token?: unknown; data?: unknown; page?: unknown } | null;
  if (!body) return c.json({ error: 'invalid_json' }, 400);
  const id = await therapistFromToken(c.env, body.token);
  if (id === null) return c.json({ error: 'unauthorized' }, 401);

  // Strona po edycji (motyw, kolejność, układ, poprawione pola) - własność tej bazy.
  // Usługa stron jej nie trzyma; `?page=` mówi, o którą z jej stron chodzi.
  if (typeof body.page === 'object' && body.page !== null && !Array.isArray(body.page)) {
    const pageId = c.req.query('page') ?? '';
    if (!(await savePageJson(c.env, id, pageId, body.page as Record<string, unknown>))) return c.json({ error: 'not_found' }, 404);
    await audit(c.env, { actorType: 'therapist', actorId: id, action: 'therapist.page_saved', subjectType: 'therapist', subjectId: id, meta: { page: pageId } });
  }

  const data = (typeof body.data === 'object' && body.data !== null ? body.data : {}) as Record<string, Values>;
  let touched: string[];
  try {
    touched = await writeFields(c.env, id, data);
  } catch (err) {
    if (err instanceof Refused) return c.json({ error: err.message }, err.status);
    throw err;
  }
  if (data.offers && 'offer_rows' in data.offers) {
    if ((await writeOffers(c.env, id, rows(data.offers.offer_rows))) > 0) touched.push('offers');
  }
  if (data['faq-profil'] && 'faq_rows' in data['faq-profil']) {
    if ((await writeFaq(c.env, id, rows(data['faq-profil'].faq_rows))) > 0) touched.push('faq');
  }

  const therapist = await getTherapist(c.env, { therapist_id: id }, { drafts: true });
  if (!therapist) return c.json({ error: 'not_found' }, 404);

  if (touched.length > 0) {
    await audit(c.env, {
      actorType: 'therapist',
      actorId: id,
      action: 'therapist.updated',
      subjectType: 'therapist',
      subjectId: id,
      meta: { field: touched.slice(0, 8).join(','), count: touched.length },
    });
  }

  const ctx = await profileContext(c.env, therapist);
  const resolved = resolveAll(ctx);
  return c.json({ resolved, summary: summarize(resolved) });
});
