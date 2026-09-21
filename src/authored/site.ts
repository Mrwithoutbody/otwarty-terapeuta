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
import { esc, renderPublic } from './core';
import { AUTHORED_CSS } from './page-css';
import { getPublished, personOf } from './store';
import { listPages, publishedSubpages } from '../web/pages-client';

export const AUTHORED_CSS_VERSION = fnv1a(AUTHORED_CSS).toString(36);

const monthOf = (iso: string, timeZone: string): string => new Date(iso).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric', timeZone });

/** `pages`: her published subpages - the only road to them besides the sitemap. */
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
</head>
<body>
<a class="skip" href="#tresc">Przejdź do treści</a>
<div class="top"><a class="brand" href="/">Otwarty Terapeuta</a><nav aria-label="Strony">${pages.map((p) => `<a href="${esc(p.href)}">${esc(p.title)}</a>`).join('')}<a href="/terapeuci">‹ Wszyscy terapeuci</a></nav></div>
<div id="tresc">${article}</div>
</body>
</html>`;
}

/** `null`, dopóki niczego nie opublikowała - wtedy profil dalej niesie usługa stron. */
export async function serveAuthored(env: Env, t: PublicTherapist, slots: PublicSlot[]): Promise<string | null> {
  const published = await getPublished(env, t.therapist_id);
  if (!published) return null;
  const person = personOf(t, slots.map((s) => s.starts_at_utc), '/jak-to-dziala');
  const pages = publishedSubpages(await listPages(env, t.therapist_id)).map((p) => ({ href: `/terapeuci/${t.slug}/${p.slug}`, title: p.title }));
  return authoredDocument(t.display_name, renderPublic(person, published.page, monthOf(published.published_at, t.timezone)), pages);
}
