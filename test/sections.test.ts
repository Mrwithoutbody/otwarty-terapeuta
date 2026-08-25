import { describe, expect, it } from 'vitest';
import {
  defaultSections,
  layoutClasses,
  parseLayout,
  pageSections,
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
  cancellation_policy: '', cancellation_cutoff_hours: 24, sections: [],
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

  // `variant` was the first design's background field and `tlo` is the current
  // one: the old name stays dropped, the new one is validated like any select.
  it('ignores a background stored by the old design, keeps the current one', () => {
    expect(parseSections('[{"type":"tekst","body":"a","variant":"dark"}]')[0]?.variant).toBeUndefined();
    expect(parseSections('[{"type":"tekst","body":"a","tlo":"ciemne"}]')[0]?.tlo).toBe('ciemne');
    expect(parseSections('[{"type":"tekst","body":"a","tlo":"tęczowe"}]')[0]?.tlo).toBeUndefined();
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

  it('takes the background from the type until the section overrides it', () => {
    expect(renderSections([{ type: 'intro' }], CTX)).toContain('class="pblock"');
    expect(renderSections([{ type: 'zaproszenie' }], CTX)).toContain('class="pblock pblock--dark"');
    expect(renderSections([{ type: 'intro', tlo: 'ciemne' }], CTX)).toContain('class="pblock pblock--dark"');
    expect(renderSections([{ type: 'zaproszenie', tlo: 'zwykle' }], CTX)).toContain('class="pblock"');
  });

  it('resolves karta/pas per section, with the page as the default', () => {
    const alt = { type: 'intro', tlo: 'panel' };
    expect(renderSections([alt], CTX)).not.toContain('pblock--pas');
    expect(renderSections([alt], CTX, { bands: 'pasy' })).toContain('pblock--pas');
    expect(renderSections([{ ...alt, kadr: 'karta' }], CTX, { bands: 'pasy' })).not.toContain('pblock--pas');
    expect(renderSections([{ ...alt, kadr: 'pas' }], CTX)).toContain('pblock--pas');
    // A plain block has no band to stretch: kadr changes nothing there.
    expect(renderSections([{ type: 'intro', kadr: 'pas' }], CTX)).not.toContain('pblock--pas');
  });

  it('scales one heading without touching the page axis', () => {
    expect(renderSections([{ type: 'intro', skala: 'plakat' }], CTX)).toContain('pblock--skala-plakat');
  });

  it('renders the poster hero and the service chapter', () => {
    const hero = renderSections([{ type: 'hero-plakat', tytul: 'Przestrzeń dla zmiany' }], CTX);
    expect(hero).toContain('phero--plakat');
    expect(hero).toContain('Przestrzeń dla zmiany');
    expect(hero).toContain('phero-plakat-name'); // hasło w h1, więc nazwisko wraca pod spodem
    const svc = renderSections([{
      type: 'usluga', eyebrow: 'Terapia indywidualna', heading: 'Przestrzeń dla Ciebie',
      body: 'Opis.', cechy: [{ tekst: 'Lęk' }], szczegoly: [{ etykieta: 'Czas', wartosc: '50 minut' }],
    }], CTX);
    expect(svc).toContain('pservice-facts');
    expect(svc).toContain('50 minut');
    // pusta usługa się nie renderuje
    expect(renderSections([{ type: 'usluga', eyebrow: 'X' }], CTX)).toBe('');
  });

  it('gives one anchor to the first section that claims it', () => {
    const html = renderSections([{ type: 'intro' }, { type: 'intro' }], CTX);
    expect(html.match(/id="/g)).toBeNull();
  });

  // She can keep a full calendar and still delete the block that shows it.
  it('links to an anchor only when the block carrying it is on the page', () => {
    const slot = { starts_at_utc: '2026-09-01T09:00:00.000Z', timezone: 'Europe/Warsaw', mode: 'online', duration_minutes: 50 };
    const ctx = { ...CTX, slots: [slot] } as SectionCtx;
    expect(renderSections([{ type: 'hero' }, { type: 'slots' }], ctx)).toContain('href="#terminy"');
    expect(renderSections([{ type: 'hero' }, { type: 'zestawienie' }], ctx)).toContain('href="#terminy"');
    expect(renderSections([{ type: 'hero' }], ctx)).not.toContain('href="#terminy"');
    expect(renderSections([{ type: 'kluczowe' }], ctx)).not.toContain('href="#terminy"');
  });

  // Both blocks show the free slots, so both claim the same anchor - and an id
  // written twice is an id the browser stops trusting.
  it('never writes the same id twice', () => {
    const slot = { starts_at_utc: '2026-09-01T09:00:00.000Z', timezone: 'Europe/Warsaw', mode: 'online', duration_minutes: 50 };
    const html = renderSections(
      [{ type: 'zestawienie' }, { type: 'slots' }],
      { ...CTX, slots: [slot] } as SectionCtx,
    );
    expect(html.match(/id="terminy"/g)).toHaveLength(1);
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
  // A page always renders one heading, whatever she arranged.
  it('adds a heading to an arrangement that lacks one', () => {
    expect(pageSections([{ type: 'faq' }]).map((s) => s.type)).toEqual(['hero', 'faq']);
    expect(pageSections([{ type: 'hero-spotlight' }]).map((s) => s.type)).toEqual(['hero-spotlight']);
  });

  it('gives an unarranged profile the full spine, closing on the invitation', () => {
    const sections = defaultSections();
    expect(sections.map((s) => s.type)).toEqual([
      'hero', 'kluczowe', 'intro', 'dane', 'first_meeting', 'topics', 'offers', 'slots', 'faq',
      'credentials', 'policy', 'zaproszenie',
    ]);
    expect(sections.every((section) => section.variant === undefined)).toBe(true);
  });

  it('closes on the invitation, which carries its own dark band', () => {
    expect(defaultSections().at(-1)).toEqual({ type: 'zaproszenie' });
    expect(renderSections([{ type: 'zaproszenie' }], CTX)).toContain('pblock--dark');
  });
});

// A fictional profile in a public catalogue has to say so, whichever heading
// block it uses - the badge lives in the heading and one of them was missing it.
describe('every heading block declares what the profile is', () => {
  const demo = { ...THERAPIST, is_demo: true } as PublicTherapist;
  const ctx = { ...CTX, therapist: demo };

  for (const type of Object.keys(SECTIONS_DEF).filter((t) => SECTIONS_DEF[t]?.family === 'hero')) {
    it(`${type} carries the demo badge`, () => {
      expect(renderSections([{ type }], ctx)).toContain('osoba fikcyjna');
    });
  }
});

// The fact pills carry the language list, which draws its own flag SVGs. A pass
// through escapeHtml printed that markup as text in the hero.
describe('hero facts', () => {
  it('renders the language flags instead of printing their markup', () => {
    const html = renderSections([{ type: 'hero' }], CTX);
    expect(html).toContain('<span class="lang">');
    expect(html).not.toContain('&lt;span class=&quot;lang&quot;');
  });

  it('still escapes a city name that contains markup', () => {
    const nasty = { ...THERAPIST, locations: [{ city: '<script>x</script>', region: null, country: 'PL', address_line: null }] };
    const html = renderSections([{ type: 'hero' }], { ...CTX, therapist: nasty as PublicTherapist });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>x');
  });
});

describe('page layout', () => {
  it('says nothing when nothing was chosen', () => {
    expect(layoutClasses(undefined)).toBe('');
    expect(layoutClasses({})).toBe('');
  });

  it('drops the heading card with the full-width bands', () => {
    expect(layoutClasses({ bands: 'pasy' })).toBe(' profile-page--pasy profile-page--hero-goly');
  });

  it('lets her keep the card over bands, and drop it over panels', () => {
    expect(layoutClasses({ bands: 'pasy', hero: 'karta' })).toBe(' profile-page--pasy');
    expect(layoutClasses({ bands: 'panele', hero: 'goly' })).toBe(' profile-page--hero-goly');
  });

  it('ignores a value it does not know', () => {
    expect(layoutClasses({ bands: 'onclick=x', hero: 'onclick=x' })).toBe('');
  });

  it('reads the column as stored, and survives a hand edit', () => {
    const defaults = { theme: '', rhythm: '', display: '', bands: 'panele', hero: '', nav: '' };
    expect(parseLayout('{"bands":"pasy","hero":"karta"}')).toEqual({ ...defaults, bands: 'pasy', hero: 'karta' });
    expect(parseLayout('nie-json')).toEqual(defaults);
    expect(parseLayout('[]')).toEqual(defaults);
    expect(layoutClasses('{"bands":"pasy"}')).toBe(' profile-page--pasy profile-page--hero-goly');
  });

  // A theme is a palette on the profile element, nothing more - and a palette
  // nobody defined is not a class the stylesheet can be asked to have.
  it('carries the theme and the rhythm as classes, and drops what it does not know', () => {
    expect(layoutClasses({ theme: 'bursztyn', rhythm: 'zwarty', display: 'plakat' }))
      .toBe(' profile-page--theme-bursztyn profile-page--rytm-zwarty profile-page--skala-plakat');
    expect(layoutClasses({ theme: '"><script>', rhythm: 'szybki' })).toBe('');
    expect(parseLayout('{"nav":"kotwice"}').nav).toBe('kotwice');
  });
});

describe('the anchor bar', () => {
  const arranged = [{ type: 'hero' }, { type: 'intro' }, { type: 'topics' }, { type: 'faq' }];
  const withFaq = {
    ...CTX,
    faq: [{ faq_id: 'f1', question: 'Ile trwa sesja?', answer: '50 minut.', updated_at: '2026-08-01T00:00:00.000Z' }],
  } as SectionCtx;

  it('is built from the headings the page actually rendered', () => {
    const html = renderSections(arranged, withFaq, { nav: true });
    // `topics` and `faq` render nothing for this therapist, so they are not in it.
    expect(html).toContain('class="pnav"');
    // The eyebrow, not the sentence-long heading: a bar of full headings wraps.
    expect(html.match(/<nav class="pnav"[\s\S]*?<\/nav>/)?.[0]).toContain('>Jak pracuję<');
    expect(html).not.toContain('Nie musisz wiedzieć, jak to nazwać');
  });

  it('stops at six links, because a seventh wraps the bar onto a second line', () => {
    const many = [
      { type: 'hero' }, { type: 'intro' }, { type: 'dane' }, { type: 'faq' },
      { type: 'policy' }, { type: 'zaproszenie' },
      { type: 'filary', eyebrow: 'Siodmy', items: [{ title: 'x', desc: 'y' }] },
      { type: 'tekst', eyebrow: 'Osmy', body: 'z' },
    ];
    const html = renderSections(many, withFaq, { nav: true });
    const bar = /<nav class="pnav"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(bar.match(/<a /g)).toHaveLength(6);
    expect(bar).not.toContain('Osmy');
  });

  it('stays off unless she asks for it, and needs more than one link', () => {
    expect(renderSections(arranged, withFaq)).not.toContain('pnav');
    // One rendered section with a heading is not a bar.
    expect(renderSections([{ type: 'hero' }, { type: 'intro' }], CTX, { nav: true })).not.toContain('pnav');
  });
});

describe('the new written blocks', () => {
  it('renders three pillars and drops the ones with no title', () => {
    const html = renderSections(
      [{ type: 'filary', heading: 'W co wierzę', items: [{ title: 'Uważność', desc: 'Opis' }, { desc: 'sierota' }] }],
      CTX,
    );
    expect(html).toContain('class="pillars"');
    expect(html).toContain('Uważność');
    expect(html).not.toContain('sierota');
  });

  it('needs a title and an https address before an article card exists', () => {
    const items = [
      { title: 'Tekst', desc: 'Zajawka', url: 'https://example.org/a', meta: 'Blog' },
      { title: 'Bez adresu' },
    ];
    const [section] = parseSections(JSON.stringify([{ type: 'artykuly', items }]));
    const html = renderSections([section!], CTX);
    expect(html).toContain('href="https://example.org/a"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).not.toContain('Bez adresu');
  });
});
