/**
 * The therapist's pages, served from the pages service.
 *
 * Her profile and every subpage (a landing, a group, a workshop) are pages the
 * service stores and renders; this host brings what the service cannot know -
 * her data, as blocks (`host-blocks.ts`) - and the frame the page sits in:
 * the catalogue link and the crisis numbers. Not one line of markup or CSS.
 *
 * Render is per request: her open slots change by the minute. The last good
 * HTML of every page is kept in R2, so the service being down cannot take her
 * profile off the air - it goes stale, it does not go missing.
 */
import type { Env } from '../env';
import type { PublicTherapist } from '../db/types';
import { escapeHtml } from '../lib/sanitize';
import { createPage, editSession, listPages, PagesUnavailable, renderPage, type PageInfo } from './pages-client';
import { DEFAULT_PROFILE, resolveAll, summarize, type SectionCtx } from './host-blocks';
import { writeToken } from './host-write';

export { PagesUnavailable };
export type { SectionCtx };

export const PROFILE_SLUG = 'profil';

/** Her profile page in the service, made on first need with the default spine. */
export async function ensureProfilePage(env: Env, therapistId: string, displayName: string): Promise<PageInfo> {
  const existing = (await listPages(env, therapistId)).find((p) => p.slug === PROFILE_SLUG);
  if (existing) return existing;
  const made = await createPage(env, {
    owner: therapistId,
    slug: PROFILE_SLUG,
    title: displayName,
    status: 'published',
    blocks: DEFAULT_PROFILE.map((type) => ({ type })),
  });
  if (made === 'slug_taken') {
    const again = (await listPages(env, therapistId)).find((p) => p.slug === PROFILE_SLUG);
    if (again) return again;
    throw new PagesUnavailable('profile page vanished between list and create');
  }
  return made;
}

/** The crisis numbers every catalogue page carries in its footer; a subpage is no exception. */
const CRISIS = {
  lead: 'Potrzebujesz pomocy natychmiast?',
  items: [
    { label: '112', href: 'tel:112', text: 'zagrożenie życia' },
    { label: '116 123', href: 'tel:116123', text: 'wsparcie emocjonalne, całą dobę' },
    { label: '116 111', href: 'tel:116111', text: 'telefon zaufania dla młodzieży' },
    { label: 'pełna lista miejsc pomocy', href: '/pomoc-w-kryzysie' },
  ],
};

function chromeFor(t: PublicTherapist): Record<string, unknown> {
  const profileHref = `/terapeuci/${t.slug}`;
  return {
    brand: { label: t.display_name, href: profileHref },
    links: [{ label: 'Katalog', href: '/terapeuci' }],
    siblings: { base: profileHref, profileLabel: 'Profil' },
    footerNote: CRISIS,
    navLabel: 'Strony terapeuty',
  };
}

export interface ServedPage {
  html: string;
  /** Served from the R2 copy because the service did not answer. */
  stale: boolean;
}

const copyKey = (therapistId: string, slug: string): string => `pages-html/${therapistId}/${slug}.html`;

/**
 * One of her pages, rendered now with her data - or, when the service is
 * down, the copy kept from the last time it was not. A draft is served only
 * when asked for (her own preview); a page she does not have is null.
 */
export async function serveTherapistPage(
  env: Env,
  t: PublicTherapist,
  ctx: SectionCtx,
  slug: string,
  opts: { drafts: boolean },
): Promise<ServedPage | null> {
  const request = {
    owner: t.therapist_id,
    slug,
    resolved: resolveAll(ctx),
    chrome: chromeFor(t),
  };
  try {
    let rendered = await renderPage(env, request);
    if (!rendered && slug === PROFILE_SLUG) {
      await ensureProfilePage(env, t.therapist_id, t.display_name);
      rendered = await renderPage(env, request);
    }
    if (!rendered) return null;
    if (rendered.status !== 'published' && !opts.drafts) return null;
    if (rendered.status === 'published' && env.MEDIA) {
      // ponytail: one R2 write per view; throttle by version when views pass ~100k/day.
      await env.MEDIA.put(copyKey(t.therapist_id, slug), rendered.html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
    }
    return { html: rendered.html, stale: false };
  } catch (err) {
    if (!(err instanceof PagesUnavailable)) throw err;
    const copy = env.MEDIA ? await env.MEDIA.get(copyKey(t.therapist_id, slug)) : null;
    if (!copy) throw err;
    return { html: await copy.text(), stale: true };
  }
}

/** What a page shows when the service is down and no copy exists: the numbers that matter, and a way back. */
export function unavailablePage(t: PublicTherapist): string {
  return `<h1>${escapeHtml(t.display_name)}</h1>
<p>Strona profilu jest chwilowo niedostępna. Spróbuj za chwilę albo wróć do <a href="/terapeuci">katalogu</a>.</p>
<p><strong>${escapeHtml(CRISIS.lead)}</strong> ${CRISIS.items.map((i) => `<a href="${escapeHtml(i.href)}">${escapeHtml(i.label)}</a>${i.text ? ` ${escapeHtml(i.text)}` : ''}`).join(' · ')}</p>`;
}

/** A link into the service's editor for one of her pages, with her data for the preview. */
export async function editorUrl(env: Env, page: PageInfo, ctx: SectionCtx | null): Promise<string> {
  const resolved = ctx ? resolveAll(ctx) : {};
  return editSession(env, page.id, {
    resolved,
    summary: ctx ? summarize(resolved) : {},
    fixed: page.slug === PROFILE_SLUG,
    // Adres jej panelu: edytor robi z niego odnośnik przy każdym bloku danych,
    // prosto do zakładki, w której ta treść powstaje.
    panelUrl: `${env.PUBLIC_BASE_URL}/admin/terapeuci/${page.owner}`,
    // Pola danych bloku wracają tutaj: usługa odsyła je pod ten adres z tym
    // tokenem, a zapisuje je ta baza. Bez tego edytor mógłby je tylko pokazać.
    write: { url: `${env.PUBLIC_BASE_URL}/api/host-blocks`, token: await writeToken(env, page.owner) },
  });
}
