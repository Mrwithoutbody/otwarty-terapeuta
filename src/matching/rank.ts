import type { SearchFilters } from '../db/catalog';
import type { PublicTherapist } from '../db/types';

/**
 * Ranking rules, in the order the product specifies:
 *
 *  1. exclusions      - handled in SQL (published, age group, language, mode,
 *                       availability). Nothing here can rescue an excluded profile.
 *  2. topic overlap   - how many of the requested areas of work the therapist declares.
 *  3. logistics       - modality, session type, price band, city.
 *  4. soonest availability.
 *  5. stable tie-break - a per-day hash rotation, so equally matching profiles
 *                        do not always appear in the same order and nobody can
 *                        buy a position. There is no paid ranking anywhere.
 *
 * The function is pure and deterministic given (therapists, filters, dayKey),
 * which is what makes it testable and what makes `match_reasons` honest: every
 * reason is derived from a field the caller can see in the same response.
 */

export interface RankedTherapist {
  therapist: PublicTherapist;
  score: number;
  match_reasons: string[];
}

const WEIGHT = {
  topic: 1000,
  modality: 300,
  sessionType: 250,
  language: 200,
  city: 200,
  mode: 150,
  price: 150,
  acceptingNewClients: 120,
  verified: 80,
  availabilitySoon: 100,
} as const;

/** Stable 32-bit FNV-1a. Used only for the tie-breaker. */
function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** "2026-08-19" in UTC - the rotation bucket for the tie-breaker. */
export function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function daysUntil(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const diff = Date.parse(iso) - now;
  if (Number.isNaN(diff)) return null;
  return diff / 86_400_000;
}

// ponytail: punktacja liczona w TS na maks. 200 kandydatach zwróconych przez SQL;
// przy katalogu powyżej kilkuset profili na zapytanie przenieść ją do zapytania.
export function rankTherapists(
  therapists: PublicTherapist[],
  filters: SearchFilters,
  options: { now?: Date; dayKey?: string } = {},
): RankedTherapist[] {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const rotation = options.dayKey ?? dayKey(now);

  const wantedTopics = new Set(filters.topics ?? []);
  const wantedModalities = new Set(filters.modalities ?? []);
  const wantedSessionTypes = new Set(filters.session_types ?? []);
  const wantedLanguages = new Set(filters.languages ?? []);

  const ranked = therapists.map((therapist) => {
    let score = 0;
    const reasons: string[] = [];

    // 2. areas of work
    const topicHits = therapist.topics.filter((t) => wantedTopics.has(t.slug));
    if (topicHits.length > 0) {
      score += WEIGHT.topic * topicHits.length;
      reasons.push(`pracuje z obszarami: ${topicHits.map((t) => t.name).join(', ')}`);
    }

    // 3. logistics
    const modalityHits = therapist.modalities.filter((m) => wantedModalities.has(m.slug));
    if (modalityHits.length > 0) {
      score += WEIGHT.modality * modalityHits.length;
      reasons.push(`pracuje w nurcie: ${modalityHits.map((m) => m.name).join(', ')}`);
    }

    const sessionHits = therapist.session_types.filter((s) => wantedSessionTypes.has(s));
    if (sessionHits.length > 0) {
      score += WEIGHT.sessionType * sessionHits.length;
      reasons.push(`prowadzi spotkania: ${sessionHits.map(sessionTypeLabel).join(', ')}`);
    }

    const languageHits = therapist.languages.filter((l) => wantedLanguages.has(l));
    if (languageHits.length > 0) {
      score += WEIGHT.language * languageHits.length;
      reasons.push(`prowadzi sesje w językach: ${languageHits.join(', ')}`);
    }

    if (filters.location) {
      const wanted = filters.location.toLowerCase();
      const city = therapist.locations.find((l) => l.city.toLowerCase().includes(wanted));
      if (city) {
        score += WEIGHT.city;
        reasons.push(`przyjmuje w mieście: ${city.city}`);
      }
    }

    if (filters.online === true && therapist.offers_online) {
      score += WEIGHT.mode;
      reasons.push('prowadzi sesje online');
    }
    if (filters.in_person === true && therapist.offers_in_person) {
      score += WEIGHT.mode;
      reasons.push('przyjmuje stacjonarnie');
    }

    if (
      (typeof filters.price_min === 'number' || typeof filters.price_max === 'number') &&
      therapist.price_min_minor !== null
    ) {
      const min = filters.price_min ?? 0;
      const max = filters.price_max ?? Number.MAX_SAFE_INTEGER;
      const inBand = therapist.offers.some((o) => o.price_minor >= min && o.price_minor <= max);
      if (inBand) {
        score += WEIGHT.price;
        reasons.push('ma ofertę w podanym przedziale cenowym');
      }
    }

    if (therapist.accepting_new_clients) {
      score += WEIGHT.acceptingNewClients;
      reasons.push('przyjmuje nowe osoby');
    }

    if (therapist.verification_status === 'verified') {
      score += WEIGHT.verified;
      reasons.push('profil zweryfikowany przez zespół Otwartego Terapeuty');
    }

    // 4. soonest availability - a bounded bonus, so it never outweighs a real
    //    match on the areas of work.
    const days = daysUntil(therapist.next_available_slot_utc, nowMs);
    if (days !== null && days >= 0) {
      score += Math.round(WEIGHT.availabilitySoon * Math.max(0, 1 - days / 21));
      reasons.push('ma wolne terminy w najbliższych tygodniach');
    }

    return { therapist, score, match_reasons: reasons };
  });

  return ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    // 4b. earlier availability wins before the tie-breaker.
    const aNext = a.therapist.next_available_slot_utc;
    const bNext = b.therapist.next_available_slot_utc;
    if (aNext !== bNext) {
      if (aNext === null) return 1;
      if (bNext === null) return -1;
      return aNext < bNext ? -1 : 1;
    }

    // 5. daily rotation, then id, so the order is total and reproducible.
    const aHash = hash32(`${rotation}:${a.therapist.therapist_id}`);
    const bHash = hash32(`${rotation}:${b.therapist.therapist_id}`);
    if (aHash !== bHash) return aHash - bHash;
    return a.therapist.therapist_id < b.therapist.therapist_id ? -1 : 1;
  });
}

export function sessionTypeLabel(value: string): string {
  switch (value) {
    case 'individual':
      return 'indywidualne';
    case 'couples':
      return 'dla par';
    case 'family':
      return 'rodzinne';
    default:
      return value;
  }
}
