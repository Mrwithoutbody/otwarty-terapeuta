/**
 * Strona autorska jako dokument HTML dla pacjenta.
 *
 * Renderuje się przy każdym żądaniu z dwóch źródeł: słowa z `authored_pages`,
 * fakty z tabel. Żadnego JavaScriptu po stronie pacjenta i żadnej usługi po
 * drodze - jeżeli D1 odpowiada, strona stoi.
 */
import type { Env } from '../../../shared/env';
import type { PublicFaqItem, PublicSlot, PublicTherapist } from '../../../shared/db/types';
import { fnv1a } from '../../../shared/lib/crypto';
import { esc, renderPublic, type PageDraft } from '../../../shared/authored/core';
import { AUTHORED_CSS } from '../../../shared/authored/page-css';
import { getPublished, getPublishedSubpage, listPublishedSubpages, personOf, seedDraft } from '../../../shared/authored/store';
import { findCandidates } from '../../../shared/db/catalog';
import { slugOf } from '../../../shared/lib/sanitize';
import { nowIso } from '../../../shared/lib/time';
import { practiceOf } from '../web/seo';

export const AUTHORED_CSS_VERSION = fnv1a(AUTHORED_CSS).toString(36);

const monthOf = (iso: string, timeZone: string): string => new Date(iso).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric', timeZone });

/** `pages`: jej pozostałe strony - jedyna droga do nich poza sitemapą. */
export function authoredDocument(title: string, article: string, pages: Array<{ href: string; title: string }>): string {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/assets/strona.css?v=${AUTHORED_CSS_VERSION}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#f7f8f1">
</head>
<body>
<a class="skip" href="#tresc">Przejdź do treści</a>
<div class="top"><a class="brand" href="/">Otwarty Terapeuta</a><nav aria-label="Strony">${pages.map((p) => `<a href="${esc(p.href)}">${esc(p.title)}</a>`).join('')}<a href="/terapeuci">‹ Wszyscy terapeuci</a></nav></div>
<div id="tresc">${article}</div>
</body>
</html>`;
}

/** Jej strony w pasku u góry; na podstronie pierwszy jest powrót do profilu. */
async function navFor(env: Env, t: PublicTherapist, current: string | null): Promise<Array<{ href: string; title: string }>> {
  const profile = `/terapeuci/${t.slug}`;
  const pages = (await listPublishedSubpages(env, t.therapist_id))
    .filter((p) => p.slug !== current)
    .map((p) => ({ href: `${profile}/${p.slug}`, title: p.title }));
  return current === null ? pages : [{ href: profile, title: t.display_name }, ...pages];
}

/**
 * Pod profilem: do czterech innych realnych osób z jej miasta i droga do strony miasta.
 * Pacjent widzi alternatywy, a Google - że profile tworzą jeden katalog, nie osobne wyspy.
 */
async function othersNearby(env: Env, t: PublicTherapist): Promise<string> {
  const city = t.locations[0]?.city;
  if (!city) return '';
  const all = (await findCandidates(env, { location: city })).filter((o) => !o.is_demo);
  const others = all.filter((o) => o.therapist_id !== t.therapist_id).slice(0, 4);
  if (others.length === 0) return '';
  // Strona miasta istnieje od trzech realnych profili (`listCityPages`).
  const cityLink = all.length >= 3 ? `<p><a href="/psychoterapeuta/${esc(slugOf(city))}">Wszyscy terapeuci · ${esc(city)}</a></p>` : '';
  return `<section class="others" aria-labelledby="inni"><h2 id="inni">Inni terapeuci · ${esc(city)}</h2><ul>${others
    .map((o) => `<li><a href="/terapeuci/${esc(o.slug)}"><strong>${esc(o.display_name)}</strong><span>${esc(practiceOf(o))}</span></a></li>`)
    .join('')}</ul>${cityLink}</section>`;
}

async function render(env: Env, t: PublicTherapist, slots: PublicSlot[], published: { page: PageDraft; published_at: string }, current: string | null): Promise<string> {
  const person = personOf(t, slots.map((s) => s.starts_at_utc), '/jak-to-dziala');
  const article = renderPublic(person, published.page, monthOf(published.published_at, t.timezone), current === null ? await othersNearby(env, t) : '');
  return authoredDocument(current === null ? t.display_name : published.page.title || t.display_name, article, await navFor(env, t, current));
}

/**
 * Jej profil. Zanim opublikuje własną stronę, profil składa się z tego, co już jest
 * w danych - opis, pierwsze spotkanie, FAQ (`seedDraft`) - tak jak przy migracji profili.
 * Nowa osoba w katalogu ma więc stronę od pierwszego dnia, z cennikiem i terminami.
 */
export async function serveAuthored(env: Env, t: PublicTherapist, slots: PublicSlot[], faq: PublicFaqItem[]): Promise<string> {
  const published = (await getPublished(env, t.therapist_id)) ?? { page: seedDraft(t, faq), published_at: nowIso() };
  return render(env, t, slots, published, null);
}

/** Jej opublikowana podstrona pod tym adresem; `null` = nie ma takiej strony. */
export async function serveAuthoredSubpage(env: Env, t: PublicTherapist, slots: PublicSlot[], slug: string): Promise<string | null> {
  const published = await getPublishedSubpage(env, t.therapist_id, slug);
  return published ? render(env, t, slots, published, slug) : null;
}
