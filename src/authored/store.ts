/**
 * Strony autorskie w D1: szkic, publikacja i most do pól profilu.
 *
 * Publikacja robi dwie rzeczy naraz, w jednym `batch`: zamraża szkic jako wersję
 * dla pacjentów i przepisuje jej słowa do kolumn, z których czyta wtyczka ChatGPT
 * (`headline`, `bio`, `first_meeting_*`, FAQ). Dzięki temu strona i asystent mówią
 * to samo, a MCP nie wie, że cokolwiek się zmieniło.
 */
import type { Env } from '../env';
import type { PublicFaqItem, PublicTherapist } from '../db/types';
import { randomId } from '../lib/crypto';
import { sanitizeLine, sanitizeRichText } from '../lib/sanitize';
import { nowIso } from '../lib/time';
import { answered, clean, emptyDraft, LIMITS, MIN_ANSWERS, normalizeDraft, pageFlags, TYPES, type PageDraft, type PageFlag, type Person } from './core';

export interface AuthoredPage {
  id: string;
  draft: PageDraft;
  published: PageDraft | null;
  published_at: string | null;
  updated_at: string;
}

interface Row {
  id: string;
  draft_json: string;
  published_json: string | null;
  published_at: string | null;
  updated_at: string;
}

const parse = (json: string | null): PageDraft | null => {
  if (!json) return null;
  try {
    return normalizeDraft(JSON.parse(json));
  } catch {
    return null;
  }
};

export async function getAuthored(env: Env, therapistId: string): Promise<AuthoredPage | null> {
  const row = await env.DB.prepare(`SELECT id, draft_json, published_json, published_at, updated_at FROM authored_pages WHERE therapist_id = ? AND type = 'profil'`)
    .bind(therapistId)
    .first<Row>();
  if (!row) return null;
  return { id: row.id, draft: parse(row.draft_json) ?? emptyDraft(), published: parse(row.published_json), published_at: row.published_at, updated_at: row.updated_at };
}

/** Sama wersja dla pacjentów - jedno zapytanie na ścieżce publicznej. */
export async function getPublished(env: Env, therapistId: string): Promise<{ page: PageDraft; published_at: string } | null> {
  const row = await env.DB.prepare(`SELECT published_json, published_at FROM authored_pages WHERE therapist_id = ? AND type = 'profil' AND published_json IS NOT NULL`)
    .bind(therapistId)
    .first<{ published_json: string; published_at: string }>();
  const page = parse(row?.published_json ?? null);
  return page && row ? { page, published_at: row.published_at } : null;
}

/**
 * Pierwszy szkic z tego, co już napisała w profilu: nikt nie zaczyna od pustej
 * kartki. Jej FAQ trafia pod gotowe pytanie, gdy brzmi tak samo, inaczej zostaje
 * jej własnym pytaniem.
 */
export function seedDraft(t: PublicTherapist, faq: PublicFaqItem[]): PageDraft {
  const draft = emptyDraft();
  draft.line = sanitizeLine(t.headline ?? '', LIMITS.line);
  const put = (id: string, text: string): void => {
    if (text.trim() === '' || draft.answers[id] !== undefined) return;
    draft.answers[id] = text.trim().slice(0, LIMITS.answer);
    draft.order.push(id);
  };
  put('who', t.bio);
  put('first', t.first_meeting.course);
  put('prep', t.first_meeting.prep);
  put('decide', t.first_meeting.decision);
  const same = (a: string, b: string): boolean => a.trim().toLowerCase().replace(/[?.!\s]+$/, '') === b.trim().toLowerCase().replace(/[?.!\s]+$/, '');
  for (const item of faq) {
    const known = TYPES.profil!.questions.find((q) => q.field === 'faq' && same(q.q, item.question));
    if (known) put(known.id, item.answer);
    else if (draft.custom.length < LIMITS.custom) {
      const id = `c_${draft.custom.length + 1}`;
      draft.custom.push({ id, q: sanitizeLine(item.question, LIMITS.question) });
      put(id, item.answer);
    }
  }
  return draft;
}

/** Tekst z przeglądarki: kształt pilnuje `normalizeDraft`, treść - te same sanitizery co reszta profilu. */
function fromBrowser(raw: unknown): PageDraft {
  const draft = normalizeDraft(raw);
  draft.line = sanitizeLine(draft.line, LIMITS.line);
  for (const id of draft.order) draft.answers[id] = sanitizeRichText(draft.answers[id] ?? '', LIMITS.answer);
  draft.custom = draft.custom.map((c) => ({ id: c.id, q: sanitizeLine(c.q, LIMITS.question) }));
  return draft;
}

export async function saveDraft(env: Env, therapistId: string, raw: unknown): Promise<PageDraft> {
  const draft = fromBrowser(raw);
  const at = nowIso();
  await env.DB.prepare(
    `INSERT INTO authored_pages (id, therapist_id, type, draft_json, created_at, updated_at) VALUES (?, ?, 'profil', ?, ?, ?)
     ON CONFLICT (therapist_id) WHERE type = 'profil' DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at`,
  )
    .bind(randomId('ap'), therapistId, JSON.stringify(draft), at, at)
    .run();
  return draft;
}

export type PublishResult = { ok: true; published_at: string } | { ok: false; reason: 'flags'; flags: PageFlag[] } | { ok: false; reason: 'empty' };

/** Szkic staje się stroną, a jej słowa - treścią profilu dla wtyczki. Zdanie z faktem wpisanym prozą zatrzymuje całość. */
export async function publish(env: Env, therapistId: string, raw: unknown): Promise<PublishResult> {
  const draft = await saveDraft(env, therapistId, raw);
  const flags = pageFlags(draft);
  if (flags.length > 0) return { ok: false, reason: 'flags', flags };
  const ids = answered(draft);
  if (ids.length < MIN_ANSWERS) return { ok: false, reason: 'empty' };

  const at = nowIso();
  const text = (id: string): string => clean(draft.answers[id] ?? '').trim();
  const byField = (field: string): string =>
    ids
      .filter((id) => TYPES.profil!.questions.find((q) => q.id === id)?.field === field)
      .map(text)
      .join('\n\n');
  const faq = ids
    .map((id) => ({ id, known: TYPES.profil!.questions.find((q) => q.id === id), own: draft.custom.find((c) => c.id === id) }))
    .filter((x) => x.known?.field === 'faq' || x.own)
    .map((x) => ({ q: x.known?.q ?? x.own!.q, a: text(x.id) }))
    .filter((x) => x.q !== '');

  await env.DB.batch([
    env.DB.prepare(`UPDATE authored_pages SET published_json = draft_json, published_at = ?, updated_at = ? WHERE therapist_id = ? AND type = 'profil'`).bind(at, at, therapistId),
    env.DB.prepare(
      `UPDATE therapists SET headline = ?, bio = ?, first_meeting_course = ?, first_meeting_prep = ?, first_meeting_decision = ?, updated_at = ? WHERE id = ?`,
    ).bind(draft.line || null, byField('bio'), byField('first_meeting_course'), byField('first_meeting_prep'), byField('first_meeting_decision'), at, therapistId),
    env.DB.prepare(`UPDATE faq_items SET status = 'archived', updated_at = ? WHERE therapist_id = ? AND status = 'published'`).bind(at, therapistId),
    ...faq.map((item, position) =>
      env.DB.prepare(
        `INSERT INTO faq_items (id, therapist_id, question, answer, category, position, status, approved_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'general', ?, 'published', ?, ?, ?)`,
      ).bind(randomId('faq'), therapistId, item.q, item.a, position, at, at, at),
    ),
  ]);
  return { ok: true, published_at: at };
}

/** Fakty z bazy w kształcie, który zna renderer. Nic stąd nie pochodzi od autorki. */
export function personOf(t: PublicTherapist, slots: string[], bookingHref: string): Person {
  return {
    name: t.display_name,
    city: t.offers_in_person ? (t.locations[0]?.city ?? '') : '',
    photo: t.photo_url,
    timezone: t.timezone,
    is_demo: t.is_demo,
    verified: t.verification_status === 'verified',
    online: t.offers_online,
    in_person: t.offers_in_person,
    accepting: t.accepting_new_clients,
    credentials: t.credentials,
    offers: t.offers.map((o) => ({ title: o.title, duration_minutes: o.duration_minutes, price_minor: o.price_minor })),
    cancellation_policy: t.cancellation_policy,
    slots: [...slots].sort(),
    booking_href: bookingHref,
  };
}
