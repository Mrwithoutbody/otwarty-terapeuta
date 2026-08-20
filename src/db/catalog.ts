import type { Env } from '../env';
import { normalizeForSearch, safeUrl } from '../lib/sanitize';
import { nowIso } from '../lib/time';
import type {
  AgeGroup,
  CrisisResource,
  NamedTag,
  PublicCredential,
  PublicFaqItem,
  PublicLocation,
  PublicOffer,
  PublicSlot,
  PublicTherapist,
  SessionMode,
  SessionType,
  TherapistRow,
} from './types';

/**
 * Every public read goes through this module. The projection functions below
 * are the single place where a database row becomes something the outside
 * world can see - which is what keeps `verification_notes` and encrypted
 * contact fields from leaking by accident.
 */

const PUBLISHED = `t.status = 'published' AND t.deleted_at IS NULL`;

function parseJsonArray<T>(raw: string, allowed: readonly string[]): T[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is T => typeof v === 'string' && allowed.includes(v));
  } catch {
    return [];
  }
}

const AGE_GROUPS = ['adults', 'teens', 'children', 'seniors'] as const;
const SESSION_TYPES = ['individual', 'couples', 'family'] as const;

function parseCredentials(raw: string): PublicCredential[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.slice(0, 12).map((entry) => {
      const c = entry as Record<string, unknown>;
      return {
        title: String(c.title ?? '').slice(0, 200),
        issuer: String(c.issuer ?? '').slice(0, 200),
        year: typeof c.year === 'number' ? c.year : null,
        verified: c.verified === true,
      };
    });
  } catch {
    return [];
  }
}

interface Related {
  locations: Map<string, PublicLocation[]>;
  languages: Map<string, string[]>;
  topics: Map<string, NamedTag[]>;
  modalities: Map<string, NamedTag[]>;
  offers: Map<string, PublicOffer[]>;
  nextSlot: Map<string, string>;
}

function emptyRelated(): Related {
  return {
    locations: new Map(),
    languages: new Map(),
    topics: new Map(),
    modalities: new Map(),
    offers: new Map(),
    nextSlot: new Map(),
  };
}

function placeholders(n: number): string {
  return new Array(n).fill('?').join(',');
}

/** `db.batch` is positional; this keeps the call sites free of `!` assertions. */
function rows<T>(result: D1Result<T> | undefined): T[] {
  return result?.results ?? [];
}

async function loadRelated(env: Env, ids: string[]): Promise<Related> {
  const related = emptyRelated();
  if (ids.length === 0) return related;
  const ph = placeholders(ids.length);

  const [locs, langs, specs, mods, offers, slots] = await env.DB.batch<Record<string, string | number>>([
    env.DB.prepare(
      `SELECT therapist_id, city, region, country, address_line
         FROM therapist_locations WHERE therapist_id IN (${ph})
        ORDER BY is_primary DESC, city`,
    ).bind(...ids),
    env.DB.prepare(
      `SELECT therapist_id, language_code FROM therapist_languages
        WHERE therapist_id IN (${ph}) ORDER BY language_code`,
    ).bind(...ids),
    env.DB.prepare(
      `SELECT ts.therapist_id, s.slug, s.name_pl FROM therapist_specialties ts
         JOIN specialties s ON s.slug = ts.specialty_slug
        WHERE ts.therapist_id IN (${ph}) ORDER BY s.name_pl`,
    ).bind(...ids),
    env.DB.prepare(
      `SELECT tm.therapist_id, m.slug, m.name_pl FROM therapist_modalities tm
         JOIN modalities m ON m.slug = tm.modality_slug
        WHERE tm.therapist_id IN (${ph}) ORDER BY m.name_pl`,
    ).bind(...ids),
    env.DB.prepare(
      `SELECT id, therapist_id, title, session_type, mode, duration_minutes, price_minor, currency
         FROM session_offers WHERE therapist_id IN (${ph}) AND active = 1
        ORDER BY price_minor`,
    ).bind(...ids),
    env.DB.prepare(
      `SELECT therapist_id, MIN(starts_at_utc) AS next_start
         FROM appointment_slots
        WHERE therapist_id IN (${ph}) AND status = 'open' AND starts_at_utc > ?
        GROUP BY therapist_id`,
    ).bind(...ids, nowIso()),
  ]);

  for (const row of rows(locs)) {
    const id = String(row.therapist_id);
    const list = related.locations.get(id) ?? [];
    list.push({
      city: String(row.city),
      region: row.region === null ? null : String(row.region),
      country: String(row.country),
      address_line: row.address_line === null ? null : String(row.address_line),
    });
    related.locations.set(id, list);
  }
  for (const row of rows(langs)) {
    const id = String(row.therapist_id);
    related.languages.set(id, [...(related.languages.get(id) ?? []), String(row.language_code)]);
  }
  for (const row of rows(specs)) {
    const id = String(row.therapist_id);
    const list = related.topics.get(id) ?? [];
    list.push({ slug: String(row.slug), name: String(row.name_pl) });
    related.topics.set(id, list);
  }
  for (const row of rows(mods)) {
    const id = String(row.therapist_id);
    const list = related.modalities.get(id) ?? [];
    list.push({ slug: String(row.slug), name: String(row.name_pl) });
    related.modalities.set(id, list);
  }
  for (const row of rows(offers)) {
    const id = String(row.therapist_id);
    const list = related.offers.get(id) ?? [];
    list.push({
      offer_id: String(row.id),
      title: String(row.title),
      session_type: String(row.session_type) as SessionType,
      mode: String(row.mode) as SessionMode,
      duration_minutes: Number(row.duration_minutes),
      price_minor: Number(row.price_minor),
      currency: String(row.currency),
    });
    related.offers.set(id, list);
  }
  for (const row of rows(slots)) {
    if (row.next_start) related.nextSlot.set(String(row.therapist_id), String(row.next_start));
  }
  return related;
}

/**
 * The one and only row -> public object conversion. `verification_notes` and
 * `contact_email_enc` are structurally absent from the result type, so a
 * future field cannot be leaked by spreading the row.
 */
function toPublicTherapist(row: TherapistRow, related: Related, baseUrl: string): PublicTherapist {
  const offers = related.offers.get(row.id) ?? [];
  const prices = offers.map((o) => o.price_minor);
  return {
    therapist_id: row.id,
    slug: row.slug,
    display_name: row.display_name,
    headline: row.headline,
    bio: row.bio,
    photo_url: safeUrl(row.photo_url),
    profile_url: `${baseUrl}/terapeuci/${encodeURIComponent(row.slug)}`,
    locations: related.locations.get(row.id) ?? [],
    offers_online: row.offers_online === 1,
    offers_in_person: row.offers_in_person === 1,
    languages: related.languages.get(row.id) ?? [],
    topics: related.topics.get(row.id) ?? [],
    modalities: related.modalities.get(row.id) ?? [],
    session_types: parseJsonArray<SessionType>(row.session_types, SESSION_TYPES),
    age_groups: parseJsonArray<AgeGroup>(row.age_groups, AGE_GROUPS),
    accepting_new_clients: row.accepting_new_clients === 1,
    credentials: parseCredentials(row.credentials),
    verification_status: row.verification_status,
    verified_at: row.verified_at,
    offers,
    price_min_minor: prices.length > 0 ? Math.min(...prices) : null,
    price_max_minor: prices.length > 0 ? Math.max(...prices) : null,
    currency: offers[0]?.currency ?? 'PLN',
    next_available_slot_utc: related.nextSlot.get(row.id) ?? null,
    timezone: row.timezone,
    cancellation_policy: row.cancellation_policy,
    cancellation_cutoff_hours: row.cancellation_cutoff_h,
    is_demo: row.is_demo === 1,
  };
}

export interface SearchFilters {
  location?: string;
  online?: boolean;
  in_person?: boolean;
  languages?: string[];
  topics?: string[];
  modalities?: string[];
  session_types?: SessionType[];
  age_group?: AgeGroup;
  price_min?: number;
  price_max?: number;
  available_from?: string;
  accepting_new_clients?: boolean;
}

/** Hard filters run in SQL; ranking runs in TypeScript so it stays explainable. */
export async function findCandidates(
  env: Env,
  filters: SearchFilters,
  limit = 200,
): Promise<PublicTherapist[]> {
  const where: string[] = [PUBLISHED];
  const params: Array<string | number> = [];

  if (filters.online === true) where.push('t.offers_online = 1');
  if (filters.in_person === true) where.push('t.offers_in_person = 1');
  if (filters.accepting_new_clients === true) where.push('t.accepting_new_clients = 1');

  if (filters.location) {
    where.push(
      `EXISTS (SELECT 1 FROM therapist_locations l WHERE l.therapist_id = t.id AND l.city_norm = ?)`,
    );
    params.push(normalizeForSearch(filters.location));
  }
  if (filters.age_group) {
    where.push(`EXISTS (SELECT 1 FROM json_each(t.age_groups) WHERE value = ?)`);
    params.push(filters.age_group);
  }
  if (filters.session_types && filters.session_types.length > 0) {
    where.push(
      `EXISTS (SELECT 1 FROM json_each(t.session_types) WHERE value IN (${placeholders(filters.session_types.length)}))`,
    );
    params.push(...filters.session_types);
  }
  if (filters.languages && filters.languages.length > 0) {
    // Every requested language must be offered, not just one of them.
    where.push(
      `(SELECT COUNT(DISTINCT tl.language_code) FROM therapist_languages tl
         WHERE tl.therapist_id = t.id AND tl.language_code IN (${placeholders(filters.languages.length)})) = ?`,
    );
    params.push(...filters.languages, filters.languages.length);
  }
  if (filters.topics && filters.topics.length > 0) {
    where.push(
      `EXISTS (SELECT 1 FROM therapist_specialties ts WHERE ts.therapist_id = t.id
                AND ts.specialty_slug IN (${placeholders(filters.topics.length)}))`,
    );
    params.push(...filters.topics);
  }
  if (filters.modalities && filters.modalities.length > 0) {
    where.push(
      `EXISTS (SELECT 1 FROM therapist_modalities tm WHERE tm.therapist_id = t.id
                AND tm.modality_slug IN (${placeholders(filters.modalities.length)}))`,
    );
    params.push(...filters.modalities);
  }
  if (typeof filters.price_min === 'number' || typeof filters.price_max === 'number') {
    const min = typeof filters.price_min === 'number' ? filters.price_min : 0;
    const max = typeof filters.price_max === 'number' ? filters.price_max : Number.MAX_SAFE_INTEGER;
    where.push(
      `EXISTS (SELECT 1 FROM session_offers o WHERE o.therapist_id = t.id AND o.active = 1
                AND o.price_minor BETWEEN ? AND ?)`,
    );
    params.push(min, max);
  }
  if (filters.available_from) {
    where.push(
      `EXISTS (SELECT 1 FROM appointment_slots s WHERE s.therapist_id = t.id
                AND s.status = 'open' AND s.starts_at_utc >= ?)`,
    );
    params.push(filters.available_from);
  }

  const { results } = await env.DB.prepare(
    `SELECT t.* FROM therapists t WHERE ${where.join(' AND ')} ORDER BY t.id LIMIT ?`,
  )
    .bind(...params, limit)
    .all<TherapistRow>();

  const related = await loadRelated(
    env,
    results.map((r) => r.id),
  );
  return results.map((row) => toPublicTherapist(row, related, env.PUBLIC_BASE_URL));
}

export async function getTherapist(
  env: Env,
  ref: { therapist_id?: string; slug?: string },
): Promise<PublicTherapist | null> {
  const column = ref.therapist_id ? 't.id' : 't.slug';
  const value = ref.therapist_id ?? ref.slug;
  if (!value) return null;

  const row = await env.DB.prepare(`SELECT t.* FROM therapists t WHERE ${column} = ? AND ${PUBLISHED}`)
    .bind(value)
    .first<TherapistRow>();
  if (!row) return null;

  const related = await loadRelated(env, [row.id]);
  return toPublicTherapist(row, related, env.PUBLIC_BASE_URL);
}

/** Admin-only variant: returns unpublished rows too, plus the private notes. */
export async function getTherapistRowForAdmin(env: Env, id: string): Promise<TherapistRow | null> {
  return env.DB.prepare(`SELECT * FROM therapists WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<TherapistRow>();
}

/**
 * Published FAQ only. Draft and archived answers are invisible to every public
 * caller - that is what makes "written or approved by the therapist" true.
 */
export async function getPublishedFaq(
  env: Env,
  therapistId: string,
  question?: string,
): Promise<PublicFaqItem[]> {
  const { results } = await env.DB.prepare(
    `SELECT f.id, f.therapist_id, f.question, f.answer, f.category, f.updated_at, f.approved_at
       FROM faq_items f
       JOIN therapists t ON t.id = f.therapist_id
      WHERE f.therapist_id = ? AND f.status = 'published' AND ${PUBLISHED}
      ORDER BY f.position, f.created_at`,
  )
    .bind(therapistId)
    .all<PublicFaqItem>();

  if (!question) return results;

  // Filtering only ever narrows the approved set. It never synthesises text.
  const needle = normalizeForSearch(question);
  const words = needle.split(/\s+/).filter((w) => w.length > 3);
  const scored = results
    .map((item) => {
      const haystack = normalizeForSearch(`${item.question} ${item.answer} ${item.category}`);
      const hits = words.filter((w) => haystack.includes(w)).length;
      return { item, hits };
    })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  return scored.map((entry) => entry.item);
}

export interface SlotQuery {
  therapist_id: string;
  from_utc: string;
  to_utc: string;
  session_type?: SessionType;
  mode?: SessionMode;
  limit: number;
}

export async function listOpenSlots(env: Env, query: SlotQuery): Promise<PublicSlot[]> {
  const conditions = [
    `s.therapist_id = ?`,
    `s.status = 'open'`,
    `s.starts_at_utc >= ?`,
    `s.starts_at_utc <= ?`,
    `o.active = 1`,
    PUBLISHED,
  ];
  const params: Array<string | number> = [query.therapist_id, query.from_utc, query.to_utc];
  if (query.session_type) {
    conditions.push('o.session_type = ?');
    params.push(query.session_type);
  }
  if (query.mode) {
    conditions.push('o.mode = ?');
    params.push(query.mode);
  }

  const { results } = await env.DB.prepare(
    `SELECT s.id AS slot_id, s.therapist_id, s.offer_id, s.starts_at_utc, s.ends_at_utc, s.timezone,
            o.session_type, o.mode, o.duration_minutes, o.price_minor, o.currency
       FROM appointment_slots s
       JOIN session_offers o ON o.id = s.offer_id
       JOIN therapists t ON t.id = s.therapist_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.starts_at_utc
      LIMIT ?`,
  )
    .bind(...params, query.limit)
    .all<PublicSlot>();
  return results;
}

/** Single slot with its commercial terms, used by preview/create. */
export async function getBookableSlot(env: Env, slotId: string): Promise<
  (PublicSlot & { slot_status: string; therapist_name: string; therapist_slug: string }) | null
> {
  return env.DB.prepare(
    `SELECT s.id AS slot_id, s.therapist_id, s.offer_id, s.starts_at_utc, s.ends_at_utc, s.timezone,
            s.status AS slot_status,
            o.session_type, o.mode, o.duration_minutes, o.price_minor, o.currency,
            t.display_name AS therapist_name, t.slug AS therapist_slug
       FROM appointment_slots s
       JOIN session_offers o ON o.id = s.offer_id
       JOIN therapists t ON t.id = s.therapist_id
      WHERE s.id = ? AND o.active = 1 AND ${PUBLISHED}`,
  )
    .bind(slotId)
    .first();
}

export async function getCrisisResources(
  env: Env,
  country: string,
  audience: 'all' | 'adult' | 'minor',
): Promise<CrisisResource[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, audience, title, description, phone, url, hours, source_url, verified_at, version
       FROM crisis_resources
      WHERE country = ? AND active = 1 AND (audience = 'all' OR audience = ?)
      ORDER BY priority, title`,
  )
    .bind(country, audience)
    .all<CrisisResource>();
  return results;
}

export async function listCities(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT l.city FROM therapist_locations l
       JOIN therapists t ON t.id = l.therapist_id
      WHERE ${PUBLISHED} ORDER BY l.city`,
  ).all<{ city: string }>();
  return results.map((r) => r.city);
}

export async function listVocabulary(env: Env): Promise<{
  topics: NamedTag[];
  modalities: NamedTag[];
  languages: NamedTag[];
}> {
  const [topics, modalities, languages] = await env.DB.batch<{ slug: string; name: string }>([
    env.DB.prepare(`SELECT slug, name_pl AS name FROM specialties ORDER BY name_pl`),
    env.DB.prepare(`SELECT slug, name_pl AS name FROM modalities ORDER BY name_pl`),
    env.DB.prepare(`SELECT code AS slug, name_pl AS name FROM languages ORDER BY name_pl`),
  ]);
  return {
    topics: rows(topics),
    modalities: rows(modalities),
    languages: rows(languages),
  };
}
