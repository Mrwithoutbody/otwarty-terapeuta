/**
 * Words a search result is made of - the title and the grey text under it. Kept apart
 * from the page renderers: the profile head (`lp.ts`) and the authored page (`authored/site.ts`)
 * both need them, and neither may import the other.
 */
import type { PublicTherapist } from '../db/types';

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
