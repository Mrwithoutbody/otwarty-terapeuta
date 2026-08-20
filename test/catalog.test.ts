import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  findCandidates,
  getCrisisResources,
  getPublishedFaq,
  getTherapist,
  listOpenSlots,
} from '../src/db/catalog';
import { rankTherapists } from '../src/matching/rank';
import { nowIso } from '../src/lib/time';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';
const UNPUBLISHED = 'th_0a1b2c3d4e5f60718293a4b5';

describe('search filters', () => {
  it('returns every published demo profile with no filters', async () => {
    const all = await findCandidates(env, {});
    expect(all.length).toBe(8);
    expect(all.every((t) => t.is_demo)).toBe(true);
  });

  it('never returns an unpublished profile', async () => {
    const all = await findCandidates(env, {});
    expect(all.find((t) => t.therapist_id === UNPUBLISHED)).toBeUndefined();
    expect(await getTherapist(env, { therapist_id: UNPUBLISHED })).toBeNull();
    expect(await getTherapist(env, { slug: 'hanna-testowa-demo' })).toBeNull();
  });

  it('applies the online filter', async () => {
    const online = await findCandidates(env, { online: true });
    expect(online.length).toBeGreaterThan(0);
    expect(online.every((t) => t.offers_online)).toBe(true);
  });

  it('requires ALL requested languages, not just one', async () => {
    const plUk = await findCandidates(env, { languages: ['pl', 'uk'] });
    expect(plUk.every((t) => t.languages.includes('pl') && t.languages.includes('uk'))).toBe(true);
    const plOnly = await findCandidates(env, { languages: ['pl'] });
    expect(plOnly.length).toBeGreaterThan(plUk.length);
  });

  it('matches a city regardless of Polish diacritics', async () => {
    const a = await findCandidates(env, { location: 'Łódź' });
    const b = await findCandidates(env, { location: 'lodz' });
    expect(a.length).toBe(1);
    expect(b.map((t) => t.therapist_id)).toEqual(a.map((t) => t.therapist_id));
  });

  it('respects a price band', async () => {
    const cheap = await findCandidates(env, { price_max: 18000 });
    expect(cheap.length).toBeGreaterThan(0);
    expect(cheap.every((t) => t.offers.some((o) => o.price_minor <= 18000))).toBe(true);
  });

  it('returns nothing for contradictory filters', async () => {
    const impossible = await findCandidates(env, {
      location: 'Warszawa',
      languages: ['uk'],
      topics: ['neuroroznorodnosc'],
      price_max: 1,
    });
    expect(impossible).toEqual([]);
  });

  it('tolerates an unknown filter value instead of erroring', async () => {
    expect(await findCandidates(env, { topics: ['nie-istnieje'] })).toEqual([]);
    expect(await findCandidates(env, { location: 'Atlantyda' })).toEqual([]);
  });

  it('never exposes private profile fields', async () => {
    const [first] = await findCandidates(env, {});
    const serialised = JSON.stringify(first);
    expect(serialised).not.toContain('verification_notes');
    expect(serialised).not.toContain('contact_email_enc');
    expect(serialised).not.toContain('DEMO — profil fikcyjny');
    const profile = await getTherapist(env, { therapist_id: ANNA });
    expect(JSON.stringify(profile)).not.toContain('verification_notes');
  });

  it('caps the visible page at the requested size while reporting the total', async () => {
    const all = await findCandidates(env, {});
    const ranked = rankTherapists(all, {});
    expect(ranked.slice(0, 5).length).toBe(5);
    expect(ranked.length).toBe(all.length);
  });
});

describe('FAQ', () => {
  it('returns only published items', async () => {
    const items = await getPublishedFaq(env, ANNA);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.approved_at !== null)).toBe(true);
    expect(items.some((i) => i.answer.includes('ROBOCZA ODPOWIEDŹ'))).toBe(false);
  });

  it('filters approved answers instead of inventing one', async () => {
    const filtered = await getPublishedFaq(env, ANNA, 'jak wygląda pierwsze spotkanie');
    expect(filtered.length).toBeGreaterThan(0);
    const all = await getPublishedFaq(env, ANNA);
    for (const item of filtered) {
      expect(all.some((a) => a.faq_id === item.faq_id)).toBe(true);
    }
  });

  it('returns an empty list when nothing approved matches', async () => {
    const none = await getPublishedFaq(env, ANNA, 'czy przepiszesz mi leki psychotropowe recepta');
    expect(none).toEqual([]);
  });

  it('returns nothing for an unpublished therapist', async () => {
    expect(await getPublishedFaq(env, UNPUBLISHED)).toEqual([]);
  });
});

describe('slots', () => {
  it('lists only future open slots of a published therapist', async () => {
    const slots = await listOpenSlots(env, {
      therapist_id: ANNA,
      from_utc: nowIso(),
      to_utc: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      limit: 50,
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => Date.parse(s.starts_at_utc) > Date.now())).toBe(true);
    expect(slots.every((s) => s.timezone === 'Europe/Warsaw')).toBe(true);
  });

  it('returns nothing for an unpublished therapist', async () => {
    const slots = await listOpenSlots(env, {
      therapist_id: UNPUBLISHED,
      from_utc: nowIso(),
      to_utc: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      limit: 50,
    });
    expect(slots).toEqual([]);
  });

  it('filters by mode', async () => {
    const online = await listOpenSlots(env, {
      therapist_id: ANNA,
      from_utc: nowIso(),
      to_utc: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      mode: 'online',
      limit: 50,
    });
    expect(online.every((s) => s.mode === 'online')).toBe(true);
  });
});

describe('crisis resources', () => {
  it('always includes the emergency number for adults', async () => {
    const adult = await getCrisisResources(env, 'PL', 'adult');
    expect(adult[0]?.phone).toBe('112');
    expect(adult.some((r) => r.phone === '116 123')).toBe(true);
    expect(adult.every((r) => r.source_url.startsWith('https://'))).toBe(true);
    expect(adult.every((r) => r.verified_at.length === 10)).toBe(true);
  });

  it('routes minors to their own line and never to the adult one', async () => {
    const minor = await getCrisisResources(env, 'PL', 'minor');
    expect(minor.some((r) => r.phone === '116 111')).toBe(true);
    expect(minor.some((r) => r.phone === '116 123')).toBe(false);
  });
});
