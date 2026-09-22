/**
 * Z czego składa się wynik wyszukiwania: tytuł, szary opis pod nim i nagłówek strony
 * terapeutki (`withSeoHead`). Stronę autorską renderuje `authored/site.ts`; tutaj tylko
 * to, co wyszukiwarka czyta przed nią.
 */
import type { Env } from '../env';
import type { PublicTherapist } from '../db/types';
import { escapeHtml } from '../lib/sanitize';

/** Profil to strona bez własnego adresu podstrony: `/terapeuci/<adres>`. */
export const PROFILE_SLUG = 'profil';

/**
 * Najniższa cena płatnej sesji. Bezpłatna rozmowa wstępna to nie cena sesji: „sesja od 0 zł”
 * obiecywałoby darmową terapię. Rozmowę wstępną i tak widać na karcie i w cenniku.
 */
export function sessionFrom(t: Pick<PublicTherapist, 'offers'>): number | null {
  const paid = t.offers.map((o) => o.price_minor).filter((p) => p > 0);
  return paid.length > 0 ? Math.min(...paid) : null;
}

/** Opis dla wyniku wyszukiwania: całe słowa, najwyżej tyle, ile Google pokaże. */
export function snippet(text: string, max = 155): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s,.;:—–-]+$/, '')}…`;
}

// Ludzie szukają „psychoterapeuta gestalt warszawa”, nie „psychoterapia”. Humanistyczna to parasol nad kilkoma nurtami - tylko gdy nic innego.
// Poza tymi pięcioma nazwą w tytule jest sam identyfikator nurtu („integracyjna”, „systemowa”).
const SHORT_MODALITY: Record<string, string> = { gestalt: 'Gestalt', 'poznawczo-behawioralna': 'CBT', act: 'ACT', dbt: 'DBT', emdr: 'EMDR' };

/** „psychoterapia Gestalt i integracyjna” - z nurtów, które sama zaznaczyła; bez nich samo „psychoterapia”. */
export function practiceOf(t: Pick<PublicTherapist, 'modalities'>): string {
  const named = t.modalities.map((m) => SHORT_MODALITY[m.slug] ?? m.slug);
  const specific = named.filter((x) => x !== 'humanistyczna');
  const pick = (specific.length > 0 ? specific : named).slice(0, 2);
  return pick.length > 0 ? `psychoterapia ${pick.join(' i ')}` : 'psychoterapia';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Tekst fragmentu HTML strony: bez znaczników, encje z powrotem w znaki - żeby escapować go raz. */
function textOf(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x?)([0-9a-f]+);/gi, (_, hex: string, n: string) => {
      const code = parseInt(n, hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    })
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Podstrona jej słowami: nagłówek i zdanie pod nim. Bez tego każda podstrona powtarzała
 * opis profilu i obie konkurowały o jedno zapytanie.
 */
function ownDescription(html: string): string {
  const body = html.slice(Math.max(0, html.indexOf('<body')));
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>([\s\S]*)/.exec(body);
  const heading = textOf(h1?.[1] ?? '');
  if (!heading) return '';
  const lead = textOf(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/.exec(h1![2]!)?.[1] ?? '');
  return [/[.!?…]$/.test(heading) ? heading : `${heading}.`, lead].filter(Boolean).join(' ');
}

/**
 * To, co wyszukiwarka czyta przed stroną: tytuł z imieniem, nurtem i miejscem, opis,
 * canonical, Open Graph, schema.org Person i okruszki. Profile demo zostają poza indeksem.
 */
export function withSeoHead(env: Env, html: string, t: PublicTherapist, pageSlug: string): string {
  const profile = pageSlug === PROFILE_SLUG;
  const url = `${env.PUBLIC_BASE_URL}/terapeuci/${t.slug}${profile ? '' : `/${pageSlug}`}`;
  const city = t.locations[0]?.city;
  const image = t.photo_url ? new URL(t.photo_url, env.PUBLIC_BASE_URL).href : undefined;
  const place = [city, t.offers_online ? 'online' : ''].filter(Boolean).join(' i ');
  const own = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? escapeHtml(t.display_name);
  const title = profile
    ? escapeHtml(`${t.display_name} — ${practiceOf(t)}${place ? `, ${place}` : ''} — Otwarty Terapeuta`)
    : `${own} — ${escapeHtml(t.display_name)} — Otwarty Terapeuta`;
  const topics = t.topics.slice(0, 4).map((x) => x.name.toLowerCase()).join(', ');
  const from = sessionFrom(t);
  // Najpierw to, po czym ktoś wybiera: kto, jak pracuje, gdzie, za ile - Google tnie po ~155 znakach.
  const description = snippet(
    (!profile && ownDescription(html)) ||
      [
        `${t.display_name} — ${practiceOf(t)}${place ? `, ${place}` : ''}.`,
        from !== null ? `Sesja od ${from / 100} zł.` : '',
        topics ? `Obszary: ${topics}.` : t.headline ? `${t.headline.replace(/[.\s]+$/, '')}.` : '',
      ].filter(Boolean).join(' '),
  );
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
  // Okruszki: Google pokazuje je w wyniku zamiast gołego adresu z identyfikatorem.
  const crumbs: Array<[string, string]> = [
    ['Otwarty Terapeuta', `${env.PUBLIC_BASE_URL}/`],
    ['Terapeuci', `${env.PUBLIC_BASE_URL}/terapeuci`],
    [t.display_name, `${env.PUBLIC_BASE_URL}/terapeuci/${t.slug}`],
    ...(profile ? [] : [[textOf(own), url] as [string, string]]),
  ];
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
  };
  const ld = (data: unknown): string => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
  const head = [
    `<meta name="description" content="${escapeHtml(description)}">`,
    // Google pokazuje przy wyniku dużą miniaturę jej zdjęcia tylko wtedy, gdy strona na to pozwala.
    `<meta name="robots" content="${t.is_demo ? 'noindex, nofollow' : 'max-image-preview:large'}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    '<meta property="og:type" content="profile">',
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    // Bez jej zdjęcia podgląd linku dostaje obraz serwisu; Person w JSON-LD zostaje bez `image`, bo to nie ona.
    `<meta property="og:image" content="${escapeHtml(image ?? `${env.PUBLIC_BASE_URL}/og-image.jpg`)}">`,
    '<meta property="og:site_name" content="Otwarty Terapeuta">',
    '<meta property="og:locale" content="pl_PL">',
    '<meta name="twitter:card" content="summary_large_image">',
    // `<` escaped so nothing in her bio can close the script element.
    ld(person),
    ld(breadcrumb),
  ].join('');
  return html.replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`).replace('</head>', () => `${head}</head>`);
}
