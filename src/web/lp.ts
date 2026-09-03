/**
 * The therapist's pages, served from the pages service.
 *
 * Her profile and every subpage (a landing, a group, a workshop) are pages the
 * service stores and renders; this host brings what the service cannot know -
 * her data, as blocks (`host-blocks.ts`) - and the frame the page sits in:
 * the catalogue link, the crisis numbers, its own stylesheet for the calendar.
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
import { APP_CSS } from './styles';

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

/**
 * Only the catalogue rules the host blocks need, pulled out of `app.css` by
 * the class names `host-blocks.ts` renders. The engine's own sheet comes from
 * the service; loading the whole of `app.css` into the page document was
 * measured to break the engine, so the document takes only these.
 */
const SECTION_CLASSES = [
  'lang', 'pdata', 'pillars', 'slot-foot', 'slot-mode', 'slot-none', 'slot-table', 'slot-table-scroll', 'slot-time',
  'slots-wrap', 'visually-hidden', 'btn', 'secondary',
];
const SECTION_CLASS = new RegExp(`\\.(${SECTION_CLASSES.join('|')})(?![\\w-])`);

/** Top-level rules of a stylesheet, nested blocks kept whole. */
function splitRules(css: string): Array<{ head: string; body: string }> {
  const out: Array<{ head: string; body: string }> = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) open = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        out.push({ head: css.slice(start, open).trim(), body: css.slice(open + 1, i) });
        start = i + 1;
      }
    }
  }
  return out;
}

/** Comma-separated selectors, commas inside `:is(...)` and friends left alone. */
function splitSelectors(head: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(head.slice(start, i));
      start = i + 1;
    }
  }
  out.push(head.slice(start));
  return out.map((x) => x.trim()).filter((x) => x !== '');
}

function keepSectionRules(css: string): string {
  return splitRules(css.replace(/\/\*[\s\S]*?\*\//g, ''))
    .map(({ head, body }) => {
      if (head.startsWith('@font-face')) return '';
      if (head.startsWith('@media') || head.startsWith('@supports')) {
        const inner = keepSectionRules(body);
        return inner === '' ? '' : `${head}{${inner}}`;
      }
      if (head.startsWith('@')) return '';
      const parts = splitSelectors(head).filter((x) => SECTION_CLASS.test(x));
      return parts.length === 0 ? '' : `${parts.join(',')}{${body}}`;
    })
    .filter((x) => x !== '')
    .join('\n');
}

/** What this host adds to the service's sheet: the calendar and its buttons. Served as /assets/lp-host.css. */
export const LP_HOST_CSS = keepSectionRules(APP_CSS);

/** The crisis numbers every catalogue page carries in its footer; a subpage is no exception. */
const CRISIS_FOOTER = `<p class="lp-crisis"><strong>Potrzebujesz pomocy natychmiast?</strong>
<a href="tel:112">112</a> zagrożenie życia ·
<a href="tel:116123">116 123</a> wsparcie emocjonalne, całą dobę ·
<a href="tel:116111">116 111</a> telefon zaufania dla młodzieży ·
<a href="/pomoc-w-kryzysie">pełna lista miejsc pomocy</a></p>`;

function chromeFor(t: PublicTherapist): Record<string, unknown> {
  const profileHref = `/terapeuci/${t.slug}`;
  return {
    brand: { label: t.display_name, href: profileHref },
    links: [{ label: 'Katalog', href: '/terapeuci' }],
    siblings: { base: profileHref, profileLabel: 'Profil' },
    footerExtra: CRISIS_FOOTER,
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
  opts: { drafts: boolean; hostCss: string },
): Promise<ServedPage | null> {
  const request = {
    owner: t.therapist_id,
    slug,
    resolved: resolveAll(ctx),
    chrome: chromeFor(t),
    stylesheet: ['engine', opts.hostCss],
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
${CRISIS_FOOTER}`;
}

/** A link into the service's editor for one of her pages, with her data for the preview. */
export async function editorUrl(env: Env, page: PageInfo, ctx: SectionCtx | null): Promise<string> {
  const resolved = ctx ? resolveAll(ctx) : {};
  return editSession(env, page.id, {
    resolved,
    summary: ctx ? summarize(resolved) : {},
    css: LP_HOST_CSS,
    fixed: page.slug === PROFILE_SLUG,
  });
}
