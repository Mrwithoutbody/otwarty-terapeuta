/**
 * The therapist's pages, typeset by the pages service.
 *
 * Her profile and every subpage (a landing, a group, a workshop) are rows in
 * this database; the service renders them and offers the editor. This host
 * brings her data, as blocks (`host-blocks.ts`), the page JSON the editor last
 * saved, and the frame the page sits in: the catalogue link and the crisis
 * numbers. Not one line of markup or CSS.
 *
 * Render is per request: her open slots change by the minute. The last good
 * HTML of every page is kept in R2, so the service being down cannot take her
 * profile off the air - it goes stale, it does not go missing.
 */
import type { Env } from '../env';
import type { PublicTherapist } from '../db/types';
import { escapeHtml } from '../lib/sanitize';
import { createPage, editSession, listPages, PagesUnavailable, renderPage, type PageInfo } from './pages-client';
import { HOST_LOCKS, hostDataFields, resolveAll, type SectionCtx } from './host-blocks';
import { writeToken } from './host-write';
import { hmacBase64Url } from '../lib/crypto';

export { PagesUnavailable };
export type { SectionCtx };

export const PROFILE_SLUG = 'profil';

/** Her profile page, made on first need; its blocks are her data, its look the service's default theme. */
export async function ensureProfilePage(env: Env, therapistId: string, displayName: string): Promise<PageInfo> {
  const existing = (await listPages(env, therapistId)).find((p) => p.slug === PROFILE_SLUG);
  if (existing) return existing;
  const made = await createPage(env, { owner: therapistId, slug: PROFILE_SLUG, title: displayName, status: 'published' });
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

/** The frame: her name, the catalogue, her other pages (the service lists nothing itself), the crisis numbers. */
export function chromeFor(t: PublicTherapist, pages: PageInfo[] = []): Record<string, unknown> {
  const profileHref = `/terapeuci/${t.slug}`;
  return {
    brand: { label: t.display_name, href: profileHref },
    links: [
      { label: 'Katalog', href: '/terapeuci' },
      ...pages.filter((p) => p.slug !== PROFILE_SLUG && p.status === 'published').map((p) => ({ label: p.title, href: `${profileHref}/${p.slug}` })),
    ],
    footerNote: CRISIS,
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
 * down, the copy kept from the last time it was not. A page she does not have is null.
 */
export async function serveTherapistPage(
  env: Env,
  t: PublicTherapist,
  ctx: SectionCtx,
  slug: string,
): Promise<ServedPage | null> {
  const request = {
    owner: t.therapist_id,
    slug,
    resolved: resolveAll(ctx),
    chrome: chromeFor(t, await listPages(env, t.therapist_id)),
  };
  try {
    let html = await renderPage(env, request);
    if (!html && slug === PROFILE_SLUG) {
      await ensureProfilePage(env, t.therapist_id, t.display_name);
      html = await renderPage(env, request);
    }
    if (!html) return null;
    if (env.MEDIA) {
      // ponytail: one R2 write per view; throttle by version when views pass ~100k/day.
      await env.MEDIA.put(copyKey(t.therapist_id, slug), html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
    }
    return { html, stale: false };
  } catch (err) {
    if (!(err instanceof PagesUnavailable)) throw err;
    const copy = env.MEDIA ? await env.MEDIA.get(copyKey(t.therapist_id, slug)) : null;
    if (!copy) throw err;
    return { html: await copy.text(), stale: true };
  }
}

/**
 * What a search engine reads before it reads the page. The service typesets the body
 * and knows nothing of the address the page lives at, her city or her prices - the host
 * does, so the host writes the head: title with name and place, description, canonical,
 * Open Graph and a schema.org Person. Fictional profiles stay out of the index.
 */
export function withSeoHead(env: Env, html: string, t: PublicTherapist, pageSlug: string): string {
  const profile = pageSlug === PROFILE_SLUG;
  const url = `${env.PUBLIC_BASE_URL}/terapeuci/${t.slug}${profile ? '' : `/${pageSlug}`}`;
  const city = t.locations[0]?.city;
  const image = t.photo_url ? new URL(t.photo_url, env.PUBLIC_BASE_URL).href : undefined;
  const place = [city, t.offers_online ? 'online' : ''].filter(Boolean).join(' i ');
  const own = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? escapeHtml(t.display_name);
  const title = profile
    ? escapeHtml(`${t.display_name} — psychoterapia${place ? `, ${place}` : ''} — Otwarty Terapeuta`)
    : `${own} — ${escapeHtml(t.display_name)} — Otwarty Terapeuta`;
  const topics = t.topics.slice(0, 4).map((x) => x.name.toLowerCase()).join(', ');
  const description = [
    `${t.display_name}${t.headline ? ` — ${t.headline.replace(/[.\s]+$/, '')}` : ''}.`,
    topics ? `Obszary pracy: ${topics}.` : '',
    place ? `Psychoterapia: ${place}.` : '',
    t.price_min_minor !== null ? `Sesja od ${t.price_min_minor / 100} zł.` : '',
  ].filter(Boolean).join(' ').slice(0, 300);
  const person = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: t.display_name,
    jobTitle: t.headline ?? 'Psychoterapeuta',
    url: `${env.PUBLIC_BASE_URL}/terapeuci/${t.slug}`,
    image,
    description: t.bio.replace(/[*_#>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 500) || undefined,
    knowsAbout: t.topics.map((x) => x.name),
    knowsLanguage: t.languages,
    address: t.locations.map((l) => ({ '@type': 'PostalAddress', addressLocality: l.city, addressCountry: l.country })),
  };
  const head = [
    `<meta name="description" content="${escapeHtml(description)}">`,
    t.is_demo ? '<meta name="robots" content="noindex, nofollow">' : '',
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    '<meta property="og:type" content="profile">',
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    // Bez jej zdjęcia podgląd linku dostaje obraz serwisu; Person w JSON-LD zostaje bez `image`, bo to nie ona.
    `<meta property="og:image" content="${escapeHtml(image ?? `${env.PUBLIC_BASE_URL}/og-image.jpg`)}">`,
    // `<` escaped so nothing in her bio can close the script element.
    `<script type="application/ld+json">${JSON.stringify(person).replace(/</g, '\\u003c')}</script>`,
  ].join('');
  return html.replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`).replace('</head>', () => `${head}</head>`);
}

/** What a page shows when the service is down and no copy exists: the numbers that matter, and a way back. */
export function unavailablePage(t: PublicTherapist): string {
  return `<h1>${escapeHtml(t.display_name)}</h1>
<p>Strona profilu jest chwilowo niedostępna. Spróbuj za chwilę albo wróć do <a href="/terapeuci">katalogu</a>.</p>
<p><strong>${escapeHtml(CRISIS.lead)}</strong> ${CRISIS.items.map((i) => `<a href="${escapeHtml(i.href)}">${escapeHtml(i.label)}</a>${i.text ? ` ${escapeHtml(i.text)}` : ''}`).join(' · ')}</p>`;
}

/** A link into the service's editor for one of her pages, with her data for the preview. */
/** Obszary i nurty z bazy: opcje pól wyboru w edytorze. */
async function dictionaries(env: Env): Promise<Record<'topics' | 'modalities', Array<[string, string]>>> {
  const [topics, modalities] = await Promise.all([
    env.DB.prepare(`SELECT slug, name_pl FROM specialties ORDER BY category, name_pl`).all<{ slug: string; name_pl: string }>(),
    env.DB.prepare(`SELECT slug, name_pl FROM modalities ORDER BY name_pl`).all<{ slug: string; name_pl: string }>(),
  ]);
  const pairs = (rows: Array<{ slug: string; name_pl: string }>): Array<[string, string]> => rows.map((r) => [r.slug, r.name_pl]);
  return { topics: pairs(topics.results), modalities: pairs(modalities.results) };
}

export async function editorUrl(env: Env, page: PageInfo, ctx: SectionCtx | null): Promise<string> {
  return editSession(env, page, {
    resolved: ctx ? resolveAll(ctx) : {},
    // Pola danych tej bazy w formularzach bloków; usługa odeśle zmienione w `data` (`host-write.ts`).
    fields: ctx ? hostDataFields(await dictionaries(env)) : {},
    locks: ctx ? HOST_LOCKS : {},
    chrome: ctx ? chromeFor(ctx.therapist) : {},
    // Strona po edycji wraca tutaj: usługa odsyła ją pod ten adres z tym tokenem,
    // a zapisuje ją ta baza. Usługa stron nie trzyma.
    write: { url: `${env.PUBLIC_BASE_URL}/api/host-blocks?page=${encodeURIComponent(page.id)}`, token: await writeToken(env, page.owner) },
    // Jej półka plików w edytorze: stały sekret z naszego klucza, więc usługa pokaże wgrane
    // logo i zdjęcia tylko w sesjach, które otworzyliśmy dla niej - sam identyfikator nie wystarczy.
    media: { scope: await hmacBase64Url(env.TOKEN_SIGNING_KEY, `media:${page.owner}`) },
  });
}
