/**
 * Strona autorska jako dokument HTML dla pacjenta.
 *
 * Renderuje się przy każdym żądaniu z dwóch źródeł: słowa z `authored_pages`,
 * fakty z tabel. Żadnego JavaScriptu po stronie pacjenta i żadnej usługi po
 * drodze - jeżeli D1 odpowiada, strona stoi.
 */
import type { Env } from '../env';
import type { PublicSlot, PublicTherapist } from '../db/types';
import { fnv1a } from '../lib/crypto';
import { esc, renderPublic, type PageDraft } from './core';
import { AUTHORED_CSS } from './page-css';
import { getPublished, getPublishedSubpage, listPublishedSubpages, personOf } from './store';
import { listPages, publishedSubpages } from '../web/pages-client';

export const AUTHORED_CSS_VERSION = fnv1a(AUTHORED_CSS).toString(36);

const monthOf = (iso: string, timeZone: string): string => new Date(iso).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric', timeZone });

/** `pages`: jej pozostałe strony - jedyna droga do nich poza sitemapą. */
export function authoredDocument(title: string, article: string, pages: Array<{ href: string; title: string }> = []): string {
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

/**
 * Jej strony w pasku u góry: najpierw autorskie podstrony, potem dawne z usługi stron,
 * których żadna autorska nie zastąpiła. Na podstronie pierwszy jest powrót do profilu.
 */
async function navFor(env: Env, t: PublicTherapist, current: string | null): Promise<Array<{ href: string; title: string }>> {
  const profile = `/terapeuci/${t.slug}`;
  const [own, legacy] = await Promise.all([listPublishedSubpages(env, t.therapist_id), listPages(env, t.therapist_id)]);
  const taken = new Set(own.map((p) => p.slug));
  const pages = [...own, ...publishedSubpages(legacy).filter((p) => !taken.has(p.slug))]
    .filter((p) => p.slug !== current)
    .map((p) => ({ href: `${profile}/${p.slug}`, title: p.title }));
  return current === null ? pages : [{ href: profile, title: t.display_name }, ...pages];
}

async function render(env: Env, t: PublicTherapist, slots: PublicSlot[], published: { page: PageDraft; published_at: string }, current: string | null): Promise<string> {
  const person = personOf(t, slots.map((s) => s.starts_at_utc), '/jak-to-dziala');
  const article = renderPublic(person, published.page, monthOf(published.published_at, t.timezone));
  return authoredDocument(current === null ? t.display_name : published.page.title || t.display_name, article, await navFor(env, t, current));
}

/** `null`, dopóki niczego nie opublikowała - wtedy profil dalej niesie usługa stron. */
export async function serveAuthored(env: Env, t: PublicTherapist, slots: PublicSlot[]): Promise<string | null> {
  const published = await getPublished(env, t.therapist_id);
  return published ? render(env, t, slots, published, null) : null;
}

/** Jej podstrona pod tym adresem; `null` oddaje adres dawnej usłudze stron. */
export async function serveAuthoredSubpage(env: Env, t: PublicTherapist, slots: PublicSlot[], slug: string): Promise<string | null> {
  const published = await getPublishedSubpage(env, t.therapist_id, slug);
  return published ? render(env, t, slots, published, slug) : null;
}
