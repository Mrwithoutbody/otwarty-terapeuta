/**
 * Zapis faktów profilu z zakładki „Dane i cennik”: kolumny i relacje z `FIELDS`
 * (`data-fields.ts`), adres gabinetu, kwalifikacje i cennik. Słowa strony zapisuje
 * publikacja w narzędziu strony (`src/authored/store.ts`), nie ten moduł.
 */
import type { Env } from '../env';
import { randomId } from '../lib/crypto';
import { cityName, normalizeForSearch, sanitizeLine } from '../lib/sanitize';
import { nowIso } from '../lib/time';
import { CREDENTIAL_ROWS, OFFER_ROWS, OFFER_TYPES, patchesFor } from './data-fields';

type Values = Record<string, unknown>;

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const rows = (value: unknown): Values[] => (Array.isArray(value) ? (value as Values[]) : []);
/** Wartość z listy zamkniętej albo domyślna - select z formularza to nadal cudze wejście. */
const oneOf = (options: Array<[string, string]>, value: unknown, fallback: string): string =>
  options.some(([slug]) => slug === value) ? (value as string) : fallback;

/**
 * Kwalifikacje z formularza scalone z tym, co jest w bazie. Formularz nie niesie
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

/** Kolumny, relacje i gabinet z grup formularza. Co gdzie idzie, mówi `FIELDS`. */
async function writeFields(env: Env, id: string, data: Record<string, Values>): Promise<string[]> {
  const patches = Object.entries(data).flatMap(([type, sent]) => patchesFor(type, sent));
  const columns = patches.filter((p): p is { column: string; value: string | number } => 'column' in p);
  for (const patch of columns) {
    if (patch.column === 'credentials') patch.value = await mergeCredentials(env, id, String(patch.value));
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
      ).bind(randomId('loc'), id, cityName(loc.city), normalizeForSearch(loc.city), loc.address),
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
        // Wiersz bez typu znaczy „zostaw”, nie „indywidualna”.
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

/** Fakty profilu z formularza: grupy `FIELDS` i cennik. Zwraca, co się zmieniło. */
export async function writeProfileData(env: Env, id: string, data: Record<string, Values>): Promise<string[]> {
  const touched = await writeFields(env, id, data);
  if (data.offers && 'offer_rows' in data.offers) {
    if ((await writeOffers(env, id, rows(data.offers.offer_rows))) > 0) touched.push('offers');
  }
  return touched;
}
