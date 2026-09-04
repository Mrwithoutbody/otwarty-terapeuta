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
import { addCivilDays, civilDateIn, DEFAULT_TIMEZONE, formatTime, isValidTimezone, nowIso, weekdayIn, zonedTimeToUtc } from '../lib/time';
import { resolveAll, summarize } from './host-blocks';
import { patchesFor } from './data-fields';
import { profileContext } from './pages';

/** Ile żyje prawo do zapisu. Tyle, ile sesja edycji po stronie usługi. */
const TOKEN_TTL_SECONDS = 2 * 60 * 60;

type Values = Record<string, unknown>;

export const hostWriteApp = new Hono<{ Bindings: Env }>();

function signingKey(env: Env): string {
  if (!env.TOKEN_SIGNING_KEY) throw new Error('Brak TOKEN_SIGNING_KEY.');
  return env.TOKEN_SIGNING_KEY;
}

/** Token dla jednej sesji edycji: `<id>.<exp>.<podpis>`. */
export async function writeToken(env: Env, therapistId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const body = `${therapistId}.${exp}`;
  return `${body}.${await hmacBase64Url(signingKey(env), `hostwrite:${body}`)}`;
}

/** Identyfikator terapeutki z tokenu, albo null - wygasł, podrobiony, obcy. */
async function therapistFromToken(env: Env, token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || token.length > 300) return null;
  const [id, exp, signature] = token.split('.');
  if (!id || !exp || !signature) return null;
  if (!Number.isFinite(Number(exp)) || Number(exp) * 1000 < Date.now()) return null;
  const expected = await hmacBase64Url(signingKey(env), `hostwrite:${id}.${exp}`);
  return timingSafeEqual(expected, signature) ? id : null;
}

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const rows = (value: unknown): Values[] => (Array.isArray(value) ? (value as Values[]) : []);

/**
 * Wartości z bloków w bazie. Co gdzie idzie, mówi `FIELDS` w `data-fields.ts`
 * - tutaj nie ma ani jednej nazwy kolumny, więc nowe pole nie wymaga zmiany
 * w tym pliku.
 */
async function writeFields(env: Env, id: string, data: Record<string, Values>): Promise<string[]> {
  const patches = Object.entries(data).flatMap(([type, sent]) => patchesFor(type, sent));
  const columns = patches.filter((p): p is { column: string; value: string | number } => 'column' in p);
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
    if ('slots' in patch) await writeSlots(env, id, patch.slots);
  }

  return [
    ...columns.map((p) => p.column),
    ...relations.map((p) => p.relation),
    ...patches.flatMap((p) => ('location' in p ? ['location'] : 'slots' in p ? ['slots'] : [])),
  ];
}

/** Jeden gabinet: puste miasto zdejmuje adres z profilu, tak jak w panelu. */
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

/**
 * Kalendarz z bloku: zaznaczone godziny dostają wolne terminy w dni robocze
 * na N dni do przodu (te same wiersze co generator w panelu; unikalność
 * `(therapist_id, starts_at_utc)` czyni to idempotentnym), a odznaczona
 * godzina traci swoje przyszłe WOLNE terminy. Zarezerwowane zostają.
 */
async function writeSlots(env: Env, id: string, plan: { hours: number[]; days: number }): Promise<void> {
  const t = await env.DB.prepare(`SELECT timezone FROM therapists WHERE id = ?`).bind(id).first<{ timezone: string | null }>();
  const offer = await env.DB.prepare(
    `SELECT id, duration_minutes FROM session_offers WHERE therapist_id = ? AND active = 1 ORDER BY created_at LIMIT 1`,
  ).bind(id).first<{ id: string; duration_minutes: number }>();
  if (!offer) return; // bez oferty nie ma czego zaplanować - blok mówi to w podpowiedzi
  const timezone = t?.timezone && isValidTimezone(t.timezone) ? t.timezone : DEFAULT_TIMEZONE;
  const at = nowIso();

  const { results: open } = await env.DB.prepare(
    `SELECT id, starts_at_utc FROM appointment_slots WHERE therapist_id = ? AND status = 'open' AND starts_at_utc > ?`,
  ).bind(id, at).all<{ id: string; starts_at_utc: string }>();
  const keep = new Set(plan.hours);
  const statements = open
    .filter((s) => !keep.has(Number(formatTime(s.starts_at_utc, timezone).split(':')[0])))
    .map((s) => env.DB.prepare(`DELETE FROM appointment_slots WHERE id = ? AND status = 'open'`).bind(s.id));

  const today = civilDateIn(timezone, new Date());
  for (let d = 1; d <= plan.days; d++) {
    const day = addCivilDays(today, d);
    const weekday = weekdayIn(timezone, day);
    if (weekday === 0 || weekday === 6) continue;
    for (const hour of plan.hours) {
      const start = zonedTimeToUtc(day, hour, 0, timezone);
      const end = new Date(start.getTime() + offer.duration_minutes * 60_000);
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO appointment_slots
             (id, therapist_id, offer_id, starts_at_utc, ends_at_utc, timezone, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        ).bind(randomId('sl'), id, offer.id, start.toISOString().replace(/\.\d{3}Z$/, 'Z'), end.toISOString().replace(/\.\d{3}Z$/, 'Z'), timezone, at, at),
      );
    }
  }
  if (statements.length > 0) await env.DB.batch(statements);
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
 */
async function writeOffers(env: Env, id: string, list: Values[]): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT id FROM session_offers WHERE therapist_id = ? AND active = 1`)
    .bind(id)
    .all<{ id: string }>();
  const at = nowIso();
  const kept = new Set<string>();
  let changes = 0;

  for (const row of list.slice(0, 4)) {
    const title = sanitizeLine(String(row.title ?? ''), 120);
    const priceMinor = Math.round(Math.min(Math.max(Number(String(row.price ?? '').replace(',', '.')) || 0, 0), 5000) * 100);
    const minutes = Math.min(Math.max(Number(row.minutes ?? 50) || 50, 15), 240);
    const mode = row.mode === 'in_person' ? 'in_person' : 'online';
    const offerId = str(row.id, 64);
    if (title === '') continue; // pusty wiersz to wyłączenie oferty albo nic
    kept.add(offerId);
    if (offerId !== '' && results.some((existing) => existing.id === offerId)) {
      await env.DB.prepare(
        `UPDATE session_offers SET title=?, price_minor=?, duration_minutes=?, mode=?, updated_at=? WHERE id = ? AND therapist_id = ?`,
      )
        .bind(title, priceMinor, minutes, mode, at, offerId, id)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO session_offers (id, therapist_id, title, session_type, mode, duration_minutes, price_minor, currency, active, created_at, updated_at)
         VALUES (?, ?, ?, 'individual', ?, ?, ?, 'PLN', 1, ?, ?)`,
      )
        .bind(randomId('of'), id, title, mode, minutes, priceMinor, at, at)
        .run();
    }
    changes += 1;
  }

  for (const existing of results) {
    if (kept.has(existing.id)) continue;
    await env.DB.prepare(`UPDATE session_offers SET active = 0, updated_at = ? WHERE id = ? AND therapist_id = ?`)
      .bind(at, existing.id, id)
      .run();
    changes += 1;
  }
  return changes;
}

/** FAQ: wiersz z identyfikatorem poprawia wpis, bez - zakłada, brakujący znika. */
async function writeFaq(env: Env, id: string, list: Values[]): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT id FROM faq_items WHERE therapist_id = ? AND status = 'published'`)
    .bind(id)
    .all<{ id: string }>();
  const at = nowIso();
  const kept = new Set<string>();
  let changes = 0;

  for (const [position, row] of list.slice(0, 10).entries()) {
    const question = sanitizeLine(String(row.q ?? ''), 200);
    const answer = sanitizeRichText(String(row.a ?? ''), 2000);
    const faqId = str(row.id, 64);
    if (question === '' || answer === '') continue;
    kept.add(faqId);
    if (faqId !== '' && results.some((existing) => existing.id === faqId)) {
      await env.DB.prepare(`UPDATE faq_items SET question=?, answer=?, position=?, updated_at=? WHERE id = ? AND therapist_id = ?`)
        .bind(question, answer, position, at, faqId, id)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO faq_items (id, therapist_id, question, answer, category, position, status, approved_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'general', ?, 'published', ?, ?, ?)`,
      )
        .bind(randomId('faq'), id, question, answer, position, at, at, at)
        .run();
    }
    changes += 1;
  }

  for (const existing of results) {
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
  const body = (await c.req.json().catch(() => null)) as { token?: unknown; data?: unknown } | null;
  if (!body) return c.json({ error: 'invalid_json' }, 400);
  const id = await therapistFromToken(c.env, body.token);
  if (id === null) return c.json({ error: 'unauthorized' }, 401);

  const data = (typeof body.data === 'object' && body.data !== null ? body.data : {}) as Record<string, Values>;
  const touched = await writeFields(c.env, id, data);
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
