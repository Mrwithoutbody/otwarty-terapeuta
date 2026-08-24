import { describe, expect, it } from 'vitest';
import {
  defaultSections,
  parseSections,
  renderSections,
  SECTIONS_DEF,
  type SectionCtx,
} from '../src/web/sections';
import type { PublicTherapist } from '../src/db/types';

const THERAPIST = {
  therapist_id: 'th_x', slug: 'x', display_name: 'X', headline: null, bio: 'Pracuję w nurcie Gestalt.',
  photo_url: null, profile_url: 'https://example.org/x', locations: [], offers_online: true,
  offers_in_person: false, languages: ['pl'], topics: [], modalities: [], session_types: [],
  age_groups: [], accepting_new_clients: true, credentials: [], links: [],
  verification_status: 'verified', verified_at: null, offers: [], price_min_minor: null,
  price_max_minor: null, currency: 'PLN', next_available_slot_utc: null, timezone: 'Europe/Warsaw',
  cancellation_policy: '', cancellation_cutoff_hours: 24, profile_blocks: [], sections: [],
  first_meeting: { course: '', prep: '', decision: '' }, is_demo: false,
} as unknown as PublicTherapist;

const CTX: SectionCtx = {
  env: { PUBLIC_PLUGIN_URL: '' } as SectionCtx['env'],
  therapist: THERAPIST,
  faq: [],
  slots: [],
};

describe('parseSections', () => {
  it('drops unknown types, unknown fields and over-long text', () => {
    const parsed = parseSections(
      JSON.stringify([
        { type: 'nie-ma-takiej', body: 'x' },
        { type: 'cytat', body: 'a'.repeat(900), author: 'Autor', podstep: '<script>' },
      ]),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.type).toBe('cytat');
    expect(parsed[0]?.podstep).toBeUndefined();
    expect(String(parsed[0]?.body)).toHaveLength(400);
  });

  it('keeps only declared variants', () => {
    expect(parseSections('[{"type":"tekst","body":"a","variant":"dark"}]')[0]?.variant).toBe('dark');
    expect(parseSections('[{"type":"tekst","body":"a","variant":"neon"}]')[0]?.variant).toBeUndefined();
  });

  it('survives broken input instead of throwing', () => {
    expect(parseSections('nie-json')).toEqual([]);
    expect(parseSections('{"nie":"tablica"}')).toEqual([]);
    expect(parseSections(null)).toEqual([]);
  });

  it('drops urls that are not https', () => {
    const [section] = parseSections('[{"type":"tekst","body":"a","cta_label":"Klik","cta_href":"javascript:alert(1)"}]');
    expect(section?.cta_href).toBeUndefined();
  });
});

describe('renderSections', () => {
  it('escapes text the therapist wrote', () => {
    const html = renderSections(parseSections('[{"type":"cytat","body":"<img src=x onerror=alert(1)>"}]'), CTX);
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x');
  });

  it('skips a section whose data is empty', () => {
    const html = renderSections([{ type: 'topics' }, { type: 'intro' }], CTX);
    expect(html).not.toContain('Nie musisz wiedzieć');
    expect(html).toContain('Gestalt');
  });

  it('puts the background on the section, not on its position', () => {
    const html = renderSections([{ type: 'intro', variant: 'dark' }], CTX);
    expect(html).toContain('class="pblock pblock--dark"');
  });

  it('gives one anchor to the first section that claims it', () => {
    const html = renderSections([{ type: 'intro' }, { type: 'intro' }], CTX);
    expect(html.match(/id="/g)).toBeNull();
  });

  it('lets one broken section fail alone', () => {
    const broken = { label: 'Zepsuta', hint: '', group: 'wlasne' as const, render: () => { throw new Error('boom'); } };
    SECTIONS_DEF['zepsuta'] = broken;
    try {
      const html = renderSections([{ type: 'zepsuta' }, { type: 'intro' }], CTX);
      expect(html).toContain('Gestalt');
    } finally {
      delete SECTIONS_DEF['zepsuta'];
    }
  });
});

describe('defaultSections', () => {
  it('gives an unarranged profile the full spine, closing on the invitation', () => {
    const sections = defaultSections([]);
    expect(sections.map((s) => s.type)).toEqual([
      'hero', 'kluczowe', 'intro', 'first_meeting', 'topics', 'offers', 'slots', 'faq',
      'credentials', 'links', 'policy', 'zaproszenie',
    ]);
    expect(sections[3]?.variant).toBe('alt');
  });

  // Alternating tints are assigned by position; the closing band must not lose
  // its dark because it happened to land on an even one.
  it('leaves a section that has a background of its own alone', () => {
    const sections = defaultSections([]);
    expect(sections.at(-1)).toEqual({ type: 'zaproszenie' });
    expect(renderSections([{ type: 'zaproszenie' }], CTX)).toContain('pblock--dark');
  });

  // An old `profile_blocks` value predates both the heading and the fact row,
  // so a page built from one still has to get them.
  it('adds the masthead and the close to an order that predates them', () => {
    expect(defaultSections(['faq', 'intro']).map((s) => s.type)).toEqual([
      'hero', 'kluczowe', 'faq', 'intro', 'zaproszenie',
    ]);
  });

  it('leaves the heading she chose alone', () => {
    expect(defaultSections(['hero-spotlight', 'faq']).map((s) => s.type)).toEqual([
      'hero-spotlight', 'faq', 'zaproszenie',
    ]);
  });
});
