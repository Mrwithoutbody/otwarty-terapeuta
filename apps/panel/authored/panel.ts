/**
 * Narzędzie stron autorskich w panelu: `/admin/terapeuci/:id/strona`.
 *
 * Jeden dokument z narzędziem i trzy trasy zapisu. Każda sprawdza sesję, to, że
 * profil należy do zalogowanej osoby, i token CSRF (nagłówek `x-csrf`, bo ciało
 * jest JSON-em albo plikiem). Treść z przeglądarki przechodzi przez `store.ts`,
 * czyli przez te same sanitizery i tego samego strażnika faktów co publikacja.
 */
import { Hono } from 'hono';
import { pingIndexNow } from '../../../shared/lib/indexnow';
import type { Env } from '../../../shared/env';
import { loadAdminSession, ownsTherapist, verifyCsrf, type AdminSession } from '../auth/session';
import { getPublishedFaq, getTherapist, listOpenSlots } from '../../../shared/db/catalog';
import type { PublicTherapist } from '../../../shared/db/types';
import { audit } from '../../../shared/lib/audit';
import { fnv1a, randomId } from '../../../shared/lib/crypto';
import { nowIso } from '../../../shared/lib/time';
import { securityHeaders } from '../../../shared/web/layout';
import { PHOTO_MAX_BYTES, sniffImageType } from '../web/profile-write';
import { esc, GUARD_MSG } from '../../../shared/authored/core';
import { AUTHORED_CSS } from '../../../shared/authored/page-css';
import { getAuthored, personOf, publish, saveDraft, seedDraft } from '../../../shared/authored/store';
import { TOOL_CSS } from './tool-css';
import { TOOL_JS } from './tool-generated';

export const PANEL_CSS = `${AUTHORED_CSS}\n${TOOL_CSS}`;
export const PANEL_ASSET_VERSION = fnv1a(`${PANEL_CSS}\u0000${TOOL_JS}`).toString(36);
export { TOOL_JS };

export const authoredPanel = new Hono<{ Bindings: Env }>();

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

type Ctx = { env: Env; req: { raw: Request; param(name: string): string | undefined } };

/** Sesja + własność profilu; przy zapisie także CSRF. Profil szkicowy też ma narzędzie, więc czytamy go bez filtra publikacji. */
async function owner(c: Ctx, write: boolean): Promise<{ session: AdminSession; t: PublicTherapist } | Response> {
  const session = await loadAdminSession(c.env, c.req.raw);
  if (!session) return write ? json({ error: 'Sesja wygasła. Odśwież stronę i zaloguj się ponownie.' }, 401) : Response.redirect(new URL('/admin', c.req.raw.url).href, 302);
  const id = c.req.param('id') ?? '';
  if (!['admin', 'therapist'].includes(session.user.role) || !ownsTherapist(session.user, id)) return json({ error: 'Brak uprawnień do tego profilu.' }, 403);
  if (write && !(await verifyCsrf(c.env, c.req.raw, c.req.raw.headers.get('x-csrf') ?? ''))) return json({ error: 'Nieprawidłowy token. Odśwież stronę.' }, 403);
  const t = await getTherapist(c.env, { therapist_id: id }, { drafts: true });
  if (!t) return json({ error: 'Nie znaleziono profilu.' }, 404);
  return { session, t };
}

async function slotsOf(env: Env, t: PublicTherapist): Promise<string[]> {
  const slots = await listOpenSlots(env, { therapist_id: t.therapist_id, from_utc: nowIso(), to_utc: new Date(Date.now() + 21 * 86_400_000).toISOString(), limit: 80 });
  return slots.map((s) => s.starts_at_utc);
}

authoredPanel.get('/', async (c) => {
  const o = await owner(c, false);
  if (o instanceof Response) return o;
  const { session, t } = o;
  const [page, faq, slots, row] = await Promise.all([
    getAuthored(c.env, t.therapist_id),
    getPublishedFaq(c.env, t.therapist_id),
    slotsOf(c.env, t),
    c.env.DB.prepare(`SELECT status FROM therapists WHERE id = ?`).bind(t.therapist_id).first<{ status: string }>(),
  ]);
  const boot = {
    draft: page?.draft ?? seedDraft(t, faq),
    published: page?.published ?? null,
    published_at: page?.published_at ?? null,
    person: personOf(t, slots, '/jak-to-dziala'),
    csrf: session.csrfToken,
    api: `/admin/terapeuci/${t.therapist_id}/strona`,
    public_url: `${c.env.PUBLIC_BASE_URL}/terapeuci/${t.slug}`,
    panel_url: `/admin/terapeuci/${t.therapist_id}`,
    can_upload: Boolean(c.env.MEDIA),
    // „Opublikuj” publikuje treść; do katalogu profil wpuszcza administrator po weryfikacji.
    in_catalogue: row?.status === 'published',
  };
  const html = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Strona o mnie — ${esc(t.display_name)}</title>
<link rel="stylesheet" href="/assets/strona-panel.css?v=${PANEL_ASSET_VERSION}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
<a class="skip" href="#app">Przejdź do treści</a>
<main id="app"></main>
<div id="toast" role="status" aria-live="polite" hidden></div>
<script type="application/json" id="boot">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>
<script src="/assets/strona-panel.js?v=${PANEL_ASSET_VERSION}" defer></script>
</body>
</html>`;
  return new Response(html, { headers: { ...securityHeaders(c.env), 'cache-control': 'no-store' } });
});

const draftOf = async (req: Request): Promise<unknown> => {
  try {
    return ((await req.json()) as { draft?: unknown }).draft;
  } catch {
    return null;
  }
};

authoredPanel.put('/szkic', async (c) => {
  const o = await owner(c, true);
  if (o instanceof Response) return o;
  await saveDraft(c.env, o.t.therapist_id, await draftOf(c.req.raw));
  return json({ ok: true });
});

authoredPanel.post('/publikuj', async (c) => {
  const o = await owner(c, true);
  if (o instanceof Response) return o;
  const result = await publish(c.env, o.t.therapist_id, await draftOf(c.req.raw));
  if (!result.ok) {
    const error = result.reason === 'empty' ? 'Strona potrzebuje choć jednej odpowiedzi.' : `${GUARD_MSG[result.flags[0]!.kind][0]}: „${result.flags[0]!.sentence}”. Popraw to zdanie i opublikuj jeszcze raz.`;
    return json({ ok: false, error }, 422);
  }
  await audit(c.env, {
    actorType: o.session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: o.session.user.id,
    action: 'therapist.page_published',
    subjectType: 'therapist',
    subjectId: o.t.therapist_id,
    meta: {},
  });
  c.executionCtx.waitUntil(pingIndexNow(c.env, [`/terapeuci/${o.t.slug}`]));
  return json(result);
});

/** Portret i miniatura przychodzą już przycięte; serwer sprawdza, że to naprawdę obrazy, i kładzie je w R2 obok siebie. */
authoredPanel.post('/zdjecie', async (c) => {
  const o = await owner(c, true);
  if (o instanceof Response) return o;
  const media = c.env.MEDIA;
  if (!media) return json({ error: 'Magazyn plików nie jest włączony w tym środowisku.' }, 503);
  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    return json({ error: 'Nieprawidłowe dane formularza.' }, 400);
  }
  const read = async (field: string): Promise<{ bytes: Uint8Array; kind: { mime: string; extension: string } } | string> => {
    const value = form.get(field);
    if (!(value instanceof File)) return 'Brak pliku.';
    if (value.size === 0 || value.size > PHOTO_MAX_BYTES) return 'Zdjęcie ma ponad 2 MB.';
    const bytes = new Uint8Array(await value.arrayBuffer());
    const kind = sniffImageType(bytes);
    return kind ? { bytes, kind } : 'Zdjęcie musi być w formacie PNG, JPEG albo WebP.';
  };
  const [photo, thumb] = [await read('photo'), await read('photo_thumb')];
  if (typeof photo === 'string') return json({ error: photo }, 415);
  if (typeof thumb === 'string') return json({ error: thumb }, 415);

  // Katalog wyprowadza adres miniatury z adresu portretu (`-160`), więc oba pliki dzielą klucz.
  const id = o.t.therapist_id;
  const base = `therapists/${id}/${randomId('img')}`;
  const url = `/media/${base}.${photo.kind.extension}`;
  await Promise.all([
    media.put(`${base}.${photo.kind.extension}`, photo.bytes, { httpMetadata: { contentType: photo.kind.mime } }),
    media.put(`${base}-160.${photo.kind.extension}`, thumb.bytes, { httpMetadata: { contentType: thumb.kind.mime } }),
  ]);
  const at = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO therapist_media (id, therapist_id, url, created_at) VALUES (?, ?, ?, ?)`).bind(randomId('med'), id, url, at),
    c.env.DB.prepare(`UPDATE therapists SET photo_url = ?, updated_at = ? WHERE id = ?`).bind(url, at, id),
  ]);
  return json({ photo_url: url });
});
