import type { Env } from '../env';
import type { PublicFaqItem, PublicSlot, PublicTherapist, TherapistRow } from '../db/types';
import { escapeHtml, renderBodyText, safeUrl, sanitizeLine, sanitizeRichText } from '../lib/sanitize';
import { addCivilDays, civilDateIn, formatPrice, formatTime } from '../lib/time';
import type { CivilDate } from '../lib/time';

/**
 * The profile is a list of sections the therapist assembles herself.
 *
 * Two kinds live here. An `auto` section renders data she already keeps
 * elsewhere in the panel - her offer, her calendar, her FAQ - so the same fact
 * is never typed twice and the MCP tools keep serving it whatever the page
 * shows. A free section carries its own text, which is what stops two profiles
 * built from the same blocks from reading like the same page.
 *
 * `SECTIONS_DEF` is the single source: the builder's forms, the validation on
 * save and the renderer all come from it. A new section type or field is added
 * there and nowhere else.
 */

export interface SectionCtx {
  env: Env;
  therapist: PublicTherapist;
  faq: PublicFaqItem[];
  slots: PublicSlot[];
}

export type Values = Record<string, unknown>;
export interface Section extends Values {
  type: string;
}

/**
 * How a block sits on the page. This is a property of the type, not something
 * to set per section: a settable background is a second axis on top of "which
 * block", and every block then needs thinking about twice. Where two tones are
 * genuinely wanted - a plain paragraph and a highlighted one - they are two
 * blocks.
 */
export type Tone = '' | 'alt' | 'dark' | 'narrow';

type FieldKind = 'text' | 'textarea' | 'url' | 'select' | 'list';

export interface Field {
  kind: FieldKind;
  name: string;
  label: string;
  hint?: string;
  /** Only an administrator may set it; the therapist never sees the input. */
  adminOnly?: boolean;
  /** Character budget for text fields, item budget for lists. */
  max?: number;
  options?: Array<[string, string]>;
  /** Shape of one list entry. */
  of?: Field[];
}

export interface SecDef {
  label: string;
  hint: string;
  /**
   * An auto section whose content the therapist edits right here, in the
   * builder, rather than in a separate fixed form. The values live in their own
   * columns - the MCP tools and the catalogue read them - so the section says
   * how to read them out of a row and how to write them back, and they never
   * enter `sections_json`.
   */
  data?: {
    fields: Field[];
    read(row: TherapistRow): Values;
    write(values: Values, row: TherapistRow | null, isAdmin: boolean): Partial<TherapistRow>;
  };
  /** True when the content comes from the database rather than from these fields. */
  auto?: boolean;
  fields?: Field[];
  /** How this block sits on the page. Fixed for the type. */
  tone?: Tone;
  /** May this type appear more than once on one profile? */
  repeatable?: boolean;
  /**
   * Only one section from a family may sit on a page. The heading blocks are a
   * family: each renders the `<h1>`, and a page has exactly one of those.
   */
  family?: string;
  /** Returns the inside of the section. Empty string means "do not render". */
  render(section: Section, ctx: SectionCtx): string;
}

const T = (name: string, label: string, extra: Partial<Field> = {}): Field =>
  ({ kind: 'text', name, label, max: 120, ...extra });
const AREA = (name: string, label: string, extra: Partial<Field> = {}): Field =>
  ({ kind: 'textarea', name, label, max: 2000, ...extra });

export const MAX_SECTIONS = 24;

/** Rows the therapist edits inside a section, cleaned the way the column wants. */
function textRows(values: Values): Values[] {
  return Array.isArray(values.items) ? (values.items as Values[]) : [];
}

/** A JSON column holding a list of objects, read defensively. */
function parseJsonRows(raw: string | null): Values[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? (parsed.filter((x) => typeof x === 'object' && x !== null) as Values[]) : [];
  } catch {
    return [];
  }
}

/** Same credential twice under one title+issuer is the same credential. */
function credentialKey(title: string, issuer: string): string {
  return `${title.toLowerCase()}|${issuer.toLowerCase()}`;
}

const PUBLIC_LABELS: Record<string, string> = {
  individual: 'indywidualne',
  couples: 'dla par',
  family: 'rodzinne',
  adults: 'dorośli',
  teens: 'młodzież',
  children: 'dzieci',
  seniors: 'seniorzy',
  pl: 'polski',
  en: 'angielski',
  uk: 'ukraiński',
  ru: 'rosyjski',
  de: 'niemiecki',
  fr: 'francuski',
  es: 'hiszpański',
  be: 'białoruski',
};

export function labelList(values: string[], empty: string): string {
  return values.map((value) => PUBLIC_LABELS[value] ?? value).join(', ') || empty;
}

/**
 * Flagi rysowane inline: żadnej zewnętrznej biblioteki ani pliku, bo strona ma
 * ścisły CSP i nie wolno jej nic dociągać. Kształty są uproszczone — przy 1em
 * i tak widać tylko układ barw. Flaga oznacza język, nie kraj; to skrót
 * wizualny, więc nazwa języka zostaje obok jako właściwa informacja.
 */
const LANGUAGE_FLAGS: Record<string, string> = {
  pl: '<svg viewBox="0 0 3 2"><rect width="3" height="2" fill="#fff"/><rect y="1" width="3" height="1" fill="#d4213d"/></svg>',
  en: '<svg viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169"/><path d="M0,0 L60,40 M60,0 L0,40" stroke="#fff" stroke-width="8"/><path d="M0,0 L60,40 M60,0 L0,40" stroke="#c8102e" stroke-width="4"/><path d="M30,0 V40 M0,20 H60" stroke="#fff" stroke-width="12"/><path d="M30,0 V40 M0,20 H60" stroke="#c8102e" stroke-width="6"/></svg>',
  uk: '<svg viewBox="0 0 3 2"><rect width="3" height="2" fill="#ffd500"/><rect width="3" height="1" fill="#005bbb"/></svg>',
  ru: '<svg viewBox="0 0 3 3"><rect width="3" height="3" fill="#d52b1e"/><rect width="3" height="2" fill="#0039a6"/><rect width="3" height="1" fill="#fff"/></svg>',
  de: '<svg viewBox="0 0 3 3"><rect width="3" height="3" fill="#ffce00"/><rect width="3" height="2" fill="#dd0000"/><rect width="3" height="1" fill="#000"/></svg>',
  fr: '<svg viewBox="0 0 3 2"><rect width="3" height="2" fill="#ce1126"/><rect width="2" height="2" fill="#fff"/><rect width="1" height="2" fill="#002654"/></svg>',
  es: '<svg viewBox="0 0 12 8"><rect width="12" height="8" fill="#aa151b"/><rect y="2" width="12" height="4" fill="#f1bf00"/></svg>',
  be: '<svg viewBox="0 0 12 8"><rect width="12" height="8" fill="#007c30"/><rect width="12" height="5" fill="#cf0921"/><rect width="2" height="8" fill="#fff"/></svg>',
};

export function languageList(codes: string[]): string {
  if (codes.length === 0) return 'brak danych';
  return codes
    .map((code) => {
      const name = escapeHtml(PUBLIC_LABELS[code] ?? code);
      const flag = LANGUAGE_FLAGS[code];
      return flag ? `<span class="lang">${flag}${name}</span>` : name;
    })
    .join(', ');
}

// --------------------------------------------------------------- helpers ---

/** A heading the therapist may override, falling back to the block's own. */
function heading(section: Section, fallback: string): string {
  const own = str(section.heading);
  return own === '' ? fallback : own;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function items(section: Section): Values[] {
  return Array.isArray(section.items) ? (section.items as Values[]) : [];
}

function eyebrow(text: string): string {
  return text === '' ? '' : `<p class="eyebrow">${escapeHtml(text)}</p>`;
}

/**
 * The lead under a heading is optional on purpose. Every block used to carry
 * one, and a sentence that only restates the heading is what made the page read
 * as a template being filled in.
 */
function lead(section: Section): string {
  const text = str(section.lead);
  return text === '' ? '' : `<p class="block-lead">${escapeHtml(text)}</p>`;
}

function ctaButton(section: Section, ghost = false): string {
  const label = str(section.cta_label);
  const href = safeUrl(str(section.cta_href));
  if (label === '' || href === null) return '';
  return `<a class="btn${ghost ? ' ghost' : ''}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

/** Her words beside her portrait; `flip` puts the photograph on the left. */
function splitBody(s: Section, ctx: SectionCtx, flip: boolean): string {
  const body = renderBodyText(str(s.body));
  if (body === '') return '';
  const title = str(s.heading);
  const photo = ctx.therapist.photo_url
    ? `<img src="${escapeHtml(ctx.therapist.photo_url)}" alt="" width="320" height="400" loading="lazy" decoding="async">`
    : '<span class="psplit-empty" aria-hidden="true"></span>';
  return `<div class="psplit${flip ? ' psplit--flip' : ''}">
  <div>${eyebrow(str(s.eyebrow))}${title === '' ? '' : `<h2>${escapeHtml(title)}</h2>`}${body}${ctaButton(s, true)}</div>
  <figure class="psplit-photo">${photo}</figure>
</div>`;
}

/** A heading, a paragraph and an optional button - the plain text blocks. */
function plainBody(s: Section): string {
  const body = renderBodyText(str(s.body));
  if (body === '') return '';
  const title = str(s.heading);
  return `${eyebrow(str(s.eyebrow))}${title === '' ? '' : `<h2>${escapeHtml(title)}</h2>`}${body}${ctaButton(s)}`;
}

/**
 * What every heading block puts on the page. The parts it shows differ; the
 * order never does, so a screen reader hears the same profile whichever shape
 * she picked.
 */
function heroBody(
  ctx: SectionCtx,
  opts: { facts: boolean; actions: boolean; greeting?: string },
): string {
  const t = ctx.therapist;
  const formats = [t.offers_online ? 'online' : null, t.offers_in_person ? 'stacjonarnie' : null]
    .filter((x): x is string => x !== null);
  return `${
    t.photo_url
      // The master, not the thumbnail: this renders small but must stay sharp on
      // a high-DPI screen. The 160px rendition is for the catalogue cards.
      ? `<img class="phero-photo" src="${escapeHtml(t.photo_url)}" alt="" width="320" height="400" decoding="async">`
      : '<span class="phero-photo empty" aria-hidden="true"></span>'
  }
  <div>
    <ul class="badges">
      ${t.verification_status === 'verified' ? `<li class="badge ok">profil zweryfikowany${t.verified_at ? ` (${escapeHtml(t.verified_at.slice(0, 10))})` : ''}</li>` : '<li class="badge">dane deklarowane przez terapeutę</li>'}
      ${t.accepting_new_clients ? '<li class="badge">przyjmuje nowe osoby</li>' : '<li class="badge">brak wolnych miejsc</li>'}
      ${t.is_demo ? '<li class="badge demo">profil demonstracyjny — osoba fikcyjna</li>' : ''}
    </ul>
    <h1>${escapeHtml(t.display_name)}</h1>
    ${opts.greeting ? `<p class="phero-greeting">${escapeHtml(opts.greeting)}</p>` : ''}
    ${t.headline ? `<p class="phero-headline">${escapeHtml(t.headline)}</p>` : ''}
    ${
      opts.facts
        ? `<ul class="phero-facts">
      ${t.locations.length > 0 ? `<li>${escapeHtml(t.locations.map((l) => l.city).join(', '))}</li>` : ''}
      ${formats.length > 0 ? `<li>${escapeHtml(formats.join(' i '))}</li>` : ''}
      <li>${languageList(t.languages)}</li>
      ${t.session_types.length > 0 ? `<li>${escapeHtml(labelList(t.session_types, ''))}</li>` : ''}
    </ul>`
        : ''
    }
    ${
      opts.actions
        ? `<div class="phero-actions">
      ${ctx.slots[0] ? '<a class="btn" href="#terminy">Zobacz wolne terminy <span aria-hidden="true">→</span></a>' : ''}
      ${sectionHasContent('first_meeting', ctx) ? '<a class="btn ghost" href="#pierwsze">Jak wygląda pierwsze spotkanie</a>' : ''}
    </div>`
        : ''
    }
  </div>`;
}

/** The compact "wt., 25 sie, 11:00" the fact row uses. */
function compactDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

// ------------------------------------------------------- auto: the spine ---

/**
 * A long "about me" pushes the price and the free slots below the fold, which is
 * what turned the therapist's own site into a wall. Three paragraphs stay open,
 * the rest is one click away - nothing is hidden, only deferred.
 */
const INTRO_PARAGRAPHS_OPEN = 3;

function introBody(bio: string): string {
  const paragraphs = bio.split(/\n{2,}/).filter((b) => b.trim() !== '');
  if (paragraphs.length <= INTRO_PARAGRAPHS_OPEN) return renderBodyText(bio);
  const head = paragraphs.slice(0, INTRO_PARAGRAPHS_OPEN).join('\n\n');
  const rest = paragraphs.slice(INTRO_PARAGRAPHS_OPEN);
  return `${renderBodyText(head)}
<details class="read-more"><summary>Czytaj dalej (${rest.length} ${rest.length === 1 ? 'akapit' : 'akapity'})</summary>
<div class="details-body">${renderBodyText(rest.join('\n\n'))}</div></details>`;
}

// A week. Not four days - that number came from ZnanyLekarz, where the calendar
// sits in a narrow column beside a result card. On a full-width profile there is
// room for the unit people actually plan in.
const SLOT_DAYS_SHOWN = 7;
const SLOT_ROWS_SHOWN = 5;

function dayLabel(day: CivilDate, today: CivilDate): { name: string; date: string } {
  const at = new Date(Date.UTC(day.year, day.month - 1, day.day, 12));
  const diff =
    Date.UTC(day.year, day.month - 1, day.day) - Date.UTC(today.year, today.month - 1, today.day);
  const days = Math.round(diff / 86_400_000);
  const date = new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(at);
  if (days === 0) return { name: 'Dziś', date };
  if (days === 1) return { name: 'Jutro', date };
  const weekday = new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC', weekday: 'short' }).format(at);
  return { name: weekday, date };
}

/**
 * Days as columns, hours stacked beneath - the pattern ZnanyLekarz and Booksy
 * have already taught every Polish user. Missing hours render as a dash so the
 * columns stay aligned, and the first two days are named relatively.
 */
function slotsByDay(slots: PublicSlot[]): string {
  const first = slots[0];
  if (!first) return '';
  const zone = first.timezone;
  const today = civilDateIn(zone, new Date());

  // Seven consecutive calendar days, not seven days that happen to have slots.
  // Skipping empty days silently makes Friday and Monday look adjacent; an empty
  // column says "she does not work weekends", which is worth knowing.
  const columns = Array.from({ length: SLOT_DAYS_SHOWN }, (_, i) => {
    const day = addCivilDays(today, i);
    const entries = slots.filter((s) => {
      const c = civilDateIn(s.timezone, new Date(s.starts_at_utc));
      return c.year === day.year && c.month === day.month && c.day === day.day;
    });
    return { day, items: entries };
  });

  if (columns.every((c) => c.items.length === 0)) return '';

  const rows = Math.min(SLOT_ROWS_SHOWN, Math.max(...columns.map((c) => c.items.length)));
  const hidden = columns.reduce((n, c) => n + Math.max(0, c.items.length - rows), 0);

  const head = columns
    .map(({ day }) => {
      const label = dayLabel(day, today);
      return `<th scope="col"><b>${escapeHtml(label.name)}</b><span>${escapeHtml(label.date)}</span></th>`;
    })
    .join('');

  const body = Array.from({ length: rows }, (_, r) => {
    const cells = columns
      .map(({ items: dayItems }) => {
        const s = dayItems[r];
        if (!s) return '<td><span class="slot-none" aria-label="brak terminu">–</span></td>';
        // No price per cell: it is already in the offer block above, and repeating
        // it thirty-five times is what made the grid shout.
        return `<td><span class="slot-time">${escapeHtml(formatTime(s.starts_at_utc, s.timezone))}</span>
          <span class="slot-mode">${s.mode === 'online' ? 'online' : 'gabinet'}</span></td>`;
      })
      .join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `<div class="slot-table-scroll">
  <table class="slot-table">
    <caption class="visually-hidden">Wolne terminy w najbliższych siedmiu dniach</caption>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</div>${hidden > 0 ? `<p class="hint">…i ${hidden} ${hidden === 1 ? 'kolejny termin' : 'kolejnych terminów'} w tych dniach.</p>` : ''}`;
}

/** Days read better than hours: nobody plans in units of 48. */
export function cutoffLabel(hours: number): string {
  if (hours % 24 === 0 && hours >= 24) {
    const days = hours / 24;
    return days === 1 ? '1 dzień' : `${days} dni`;
  }
  return `${hours} godz.`;
}

export function pluginCta(env: Env): string {
  const url = env.PUBLIC_PLUGIN_URL?.trim();
  if (!url) {
    return `<a class="btn secondary" href="#w-chatgpt">Zobacz, jak działa w ChatGPT <span aria-hidden="true">↓</span></a>`;
  }
  return `<a class="btn secondary" href="${escapeHtml(url)}" rel="noopener">Znajdź terapeutę z pomocą ChatGPT <span aria-hidden="true">↗</span></a>`;
}

const HEADING_FIELD = T('heading', 'Nagłówek', { hint: 'puste = domyślny' });
const LEAD_FIELD = T('lead', 'Zdanie pod nagłówkiem', { max: 200, hint: 'opcjonalne — pomiń, jeśli tylko powtarza nagłówek' });

// ------------------------------------------------------------ definitions ---

export const SECTIONS_DEF: Record<string, SecDef> = {
  // --- heading blocks: one per page, three shapes, different content -------

  /**
   * The plain heading: portrait beside the name, the facts someone comparing
   * profiles needs, and the way in.
   */
  hero: {
    label: 'Nagłówek — klasyczny', hint: 'Portret obok imienia, fakty i przycisk',
    auto: true, family: 'hero', fields: [],
    render: (_s, ctx) => heroBody(ctx, { facts: true, actions: true }),
  },

  /**
   * Dark, centred, the portrait round and above the name. No fact pills: this
   * one is for a therapist whose profile is the whole of her practice, and the
   * facts live in the block below it.
   */
  'hero-spotlight': {
    label: 'Nagłówek — spotlight', hint: 'Ciemny, wyśrodkowany, okrągły portret',
    auto: true, family: 'hero',
    fields: [AREA('powitanie', 'Zdanie na powitanie', { max: 240,
      hint: 'np. Nie musisz wiedzieć, od czego zacząć.' })],
    render: (s, ctx) => heroBody(ctx, { facts: false, actions: true, greeting: str(s.powitanie) }),
  },

  /**
   * A wide photograph with the details on a card riding over its lower edge.
   * Wants a landscape photo; a portrait one is cropped to its upper third.
   */
  'hero-okladka': {
    label: 'Nagłówek — okładka', hint: 'Szerokie zdjęcie, dane na karcie pod nim',
    auto: true, family: 'hero', fields: [],
    render: (_s, ctx) => heroBody(ctx, { facts: true, actions: true }),
  },


  /**
   * The dense end of the range. A thumbnail, the name, the facts on one line -
   * a card, not a landing page. Someone who wants her profile read in ten
   * seconds picks this and nothing about the page argues with her.
   */
  'hero-zwiezly': {
    label: 'Nagłówek — zwięzły', hint: 'Miniatura i fakty w jednej linii, bez dużego portretu',
    auto: true, family: 'hero', fields: [],
    render: (_s, ctx) => heroBody(ctx, { facts: true, actions: true }),
  },

  /**
   * Price, length and the next free slot in one line. Separate from the heading
   * because it is the row people compare between profiles, and it has to sit in
   * the same place whichever heading she picked.
   */
  kluczowe: {
    label: 'Cena i najbliższy termin', hint: 'Wiersz faktów do porównywania profili',
    auto: true, fields: [],
    render: (_s, { therapist: t, slots }) => {
      const nextSlot = slots[0];
      const duration = t.offers[0]?.duration_minutes ?? null;
      return `<div class="pfacts">
  <div class="pfact${t.price_min_minor === null ? ' empty' : ''}">
    <strong>${t.price_min_minor === null ? 'cena do ustalenia' : escapeHtml(formatPrice(t.price_min_minor, t.currency))}</strong>
    <span>${t.price_min_minor === null ? 'zapytaj przy kontakcie' : 'za sesję'}</span>
  </div>
  <div class="pfact${duration === null ? ' empty' : ''}">
    <strong>${duration === null ? 'nie podano' : `${duration} min`}</strong><span>długość sesji</span>
  </div>
  <div class="pfact${nextSlot ? '' : ' empty'}">
    <strong>${nextSlot ? escapeHtml(compactDateTime(nextSlot.starts_at_utc, nextSlot.timezone)) : 'brak wolnych terminów'}</strong>
    <span>${nextSlot ? 'najbliższy wolny termin' : 'w najbliższych trzech tygodniach'}</span>
  </div>
  <div class="pfact-cta">${nextSlot ? '<a class="btn" href="#terminy">Zobacz wolne terminy</a>' : ''}</div>
</div>`;
    },
  },

  // --- auto: her data, already in the panel --------------------------------
  intro: {
    label: 'Jak pracuję', hint: 'Twój opis i nurt pracy', auto: true,
    fields: [HEADING_FIELD, LEAD_FIELD],
    render: (s, { therapist: t }) => {
      if (t.bio.trim() === '') return '';
      return `${eyebrow('Jak pracuję')}<h2>${escapeHtml(heading(s, 'Tak wygląda praca ze mną'))}</h2>${lead(s)}
${introBody(t.bio)}
${t.modalities.length === 0 ? '' : `<ul class="chips">${t.modalities.map((m) => `<li>${escapeHtml(m.name)}</li>`).join('')}</ul>`}`;
    },
  },

  /**
   * The question everyone has before writing to a stranger about their mental
   * health: what will actually happen. Rendered as steps because that is what it
   * is - each answer she gave, in the order the person will live them.
   */
  first_meeting: {
    label: 'Pierwsze spotkanie', hint: 'Czego może się spodziewać osoba, która się odezwie', auto: true, fields: [HEADING_FIELD, LEAD_FIELD],
    render: (s, { therapist: t }) => {
      const candidates: Array<[string, string]> = [
        ['Jak wygląda pierwsze spotkanie', t.first_meeting.course],
        ['Czy trzeba się przygotować', t.first_meeting.prep],
        ['Kiedy decydujecie o dalszej pracy', t.first_meeting.decision],
      ];
      const steps = candidates.filter(([, body]) => body.trim() !== '');
      if (steps.length === 0) return '';
      return `${eyebrow('Pierwsze spotkanie')}<h2>${escapeHtml(heading(s, 'Zanim się umówisz'))}</h2>${lead(s)}
<ol class="meeting-steps">${steps
        .map(([title, body]) => `<li><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></li>`)
        .join('')}</ol>`;
    },
  },

  topics: {
    label: 'Z czym pracuję', hint: 'Obszary wybrane w zakładce profilu', tone: 'alt', auto: true,
    fields: [HEADING_FIELD, LEAD_FIELD],
    render: (s, { therapist: t }) =>
      t.topics.length === 0
        ? ''
        : `${eyebrow('Z czym pracuję')}<h2>${escapeHtml(heading(s, 'Nie musisz wiedzieć, jak to nazwać'))}</h2>${lead(s)}
<ul class="chips">${t.topics.map((x) => `<li>${escapeHtml(x.name)}</li>`).join('')}</ul>`,
  },

  offers: {
    label: 'Oferta — karty', hint: 'Każda sesja na osobnej karcie', auto: true,
    family: 'oferta', fields: [HEADING_FIELD, LEAD_FIELD],
    render: (s, { therapist: t }) =>
      t.offers.length === 0
        ? ''
        : `${eyebrow('Oferta')}<h2>${escapeHtml(heading(s, 'Jedna cena, bez gwiazdek'))}</h2>${lead(s)}
<div class="offer-grid">${t.offers
            .map(
              (o) => `<div class="offer-card">
        <h3>${escapeHtml(o.title)}</h3>
        <span class="amount">${escapeHtml(formatPrice(o.price_minor, o.currency))}</span>
        <span class="per">${o.duration_minutes} min · ${o.mode === 'online' ? 'online' : 'stacjonarnie'}</span>
      </div>`,
            )
            .join('')}</div>`,
  },


  /**
   * The offer as rows rather than cards. Three cards of one line each is a lot
   * of furniture for "one session, one price".
   */
  'oferta-lista': {
    label: 'Oferta — lista', hint: 'Wiersze zamiast kart, dla zwięzłej strony',
    auto: true, family: 'oferta', fields: [HEADING_FIELD, LEAD_FIELD],
    render: (s, { therapist: t }) =>
      t.offers.length === 0
        ? ''
        : `${eyebrow('Oferta')}<h2>${escapeHtml(heading(s, 'Jedna cena, bez gwiazdek'))}</h2>${lead(s)}
<ul class="offer-rows">${t.offers
            .map(
              (o) => `<li><span class="offer-name">${escapeHtml(o.title)}</span>
        <span class="offer-meta">${o.duration_minutes} min · ${o.mode === 'online' ? 'online' : 'stacjonarnie'}</span>
        <span class="offer-price">${escapeHtml(formatPrice(o.price_minor, o.currency))}</span></li>`,
            )
            .join('')}</ul>`,
  },

  slots: {
    label: 'Wolne terminy', hint: 'Z Twojego kalendarza', tone: 'alt', auto: true,
    fields: [HEADING_FIELD, LEAD_FIELD],
    render: (s, { therapist: _t, slots, env }) => {
      const table = slotsByDay(slots);
      if (table === '') return '';
      return `${eyebrow('Najbliższe wolne terminy')}<h2>${escapeHtml(heading(s, 'Kiedy możemy się spotkać'))}</h2>${lead(s)}
${table}
<p class="hint">Rezerwacja odbywa się przez asystenta ChatGPT.</p>
${pluginCta(env)}`;
    },
  },

  faq: {
    label: 'Pytania i odpowiedzi', hint: 'Twoje odpowiedzi z zakładki FAQ', auto: true,
    fields: [HEADING_FIELD, LEAD_FIELD],
    render: (s, { faq }) =>
      faq.length === 0
        ? ''
        : `${eyebrow('Pytania i odpowiedzi')}<h2>${escapeHtml(heading(s, 'Pytania, które padają najczęściej'))}</h2>${lead(s)}
${faq
            .map(
              (item) => `<details id="faq-${escapeHtml(item.faq_id)}">
        <summary>${escapeHtml(item.question)}</summary>
        <div class="details-body"><p>${escapeHtml(item.answer).replace(/\n/g, '<br>')}</p>
        <p class="hint">Odpowiedź terapeuty, zaktualizowana ${escapeHtml(item.updated_at.slice(0, 10))}.</p></div>
      </details>`,
            )
            .join('')}
<p class="hint">Odpowiedzi pochodzą wprost od terapeuty. Nie zastępują konsultacji ani porady klinicznej.</p>`,
  },

  credentials: {
    label: 'Kwalifikacje', hint: 'Dyplomy i certyfikaty', tone: 'alt', auto: true,
    fields: [HEADING_FIELD, LEAD_FIELD],
    data: {
      fields: [{
        kind: 'list', name: 'items', label: 'Kwalifikacje', max: 20,
        of: [
          T('title', 'Nazwa'), T('issuer', 'Wydający'),
          { kind: 'text', name: 'year', label: 'Rok', max: 4 },
          { kind: 'select', name: 'verified', label: 'Zweryfikowane', adminOnly: true,
            options: [['', 'deklarowane'], ['1', 'zweryfikowane']] },
        ],
      }],
      read: (row) => ({
        items: parseJsonRows(row.credentials).map((c) => ({
          title: str(c.title), issuer: str(c.issuer),
          year: c.year === null || c.year === undefined ? '' : String(c.year),
          verified: c.verified === true ? '1' : '',
        })),
      }),
      write: (values, row, isAdmin) => {
        // A therapist may edit her own entries but never mark one verified; an
        // entry keeps the flag an administrator already gave it, keyed by what
        // it says, so renaming it drops the claim rather than carrying it over.
        const alreadyVerified = new Set(
          parseJsonRows(row?.credentials ?? null)
            .filter((c) => c.verified === true)
            .map((c) => credentialKey(str(c.title), str(c.issuer))),
        );
        const out = textRows(values)
          .map((item) => {
            const title = sanitizeLine(str(item.title), 120);
            const issuer = sanitizeLine(str(item.issuer), 120);
            const parsed = Number(str(item.year));
            return {
              title, issuer,
              year: Number.isInteger(parsed) && parsed >= 1950 && parsed <= 2100 ? parsed : null,
              verified: isAdmin
                ? str(item.verified) === '1'
                : alreadyVerified.has(credentialKey(title, issuer)),
            };
          })
          .filter((c) => c.title !== '');
        return { credentials: JSON.stringify(out) };
      },
    },
    render: (s, { therapist: t }) =>
      t.credentials.length === 0
        ? ''
        : `${eyebrow('Kwalifikacje')}<h2>${escapeHtml(heading(s, 'Skąd mam do tego przygotowanie'))}</h2>${lead(s)}
${t.credentials
            .map(
              (cr) => `<details><summary>${escapeHtml(cr.title)}</summary><div class="details-body">
        <p>${cr.issuer ? `${escapeHtml(cr.issuer)}` : 'Wystawca nie podany'}${cr.year ? `, ${cr.year}` : ''} —
        ${cr.verified ? '<strong>zweryfikowane</strong>' : 'deklarowane przez terapeutę'}</p></div></details>`,
            )
            .join('')}`,
  },

  links: {
    label: 'Więcej o mnie', hint: 'Linki do Twoich stron', auto: true,
    fields: [HEADING_FIELD, LEAD_FIELD],
    data: {
      fields: [{
        kind: 'list', name: 'items', label: 'Linki', max: 8,
        of: [T('label', 'Nazwa', { max: 40 }), { kind: 'url', name: 'url', label: 'Adres (https)', max: 500 }],
      }],
      read: (row) => ({
        items: parseJsonRows(row.links).map((l) => ({ label: str(l.label), url: str(l.url) })),
      }),
      write: (values) => ({
        links: JSON.stringify(
          textRows(values)
            .map((item) => ({
              label: sanitizeLine(str(item.label), 40),
              url: safeUrl(sanitizeLine(str(item.url), 500)),
            }))
            .filter((l): l is { label: string; url: string } => l.label !== '' && l.url !== null),
        ),
      }),
    },
    render: (s, { therapist: t }) =>
      t.links.length === 0
        ? ''
        : `${eyebrow('Więcej o mnie')}<h2>${escapeHtml(heading(s, 'Gdzie jeszcze mnie znajdziesz'))}</h2>${lead(s)}
<ul class="linklist">${t.links
            .map(
              (l) => `<li><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(l.label)} ↗</a></li>`,
            )
            .join('')}</ul>`,
  },

  // The free-text policy is often empty, so the cutoff carries the meaning.
  policy: {
    label: 'Zasady odwołania', hint: 'Wyliczone z Twojego wyprzedzenia', tone: 'alt', auto: true,
    fields: [HEADING_FIELD],
    render: (s, { therapist: t }) =>
      `${eyebrow('Zasady odwołania')}<h2>${escapeHtml(heading(s, 'Kiedy musisz odwołać'))}</h2>
<div class="policy-box"><p>${
        t.cancellation_policy.trim() !== ''
          ? escapeHtml(t.cancellation_policy)
          : `Wizytę możesz odwołać bezpłatnie najpóźniej na <strong>${cutoffLabel(t.cancellation_cutoff_hours)}</strong> przed jej terminem. Jeśli odwołasz później albo nie przyjdziesz, sesja jest płatna.`
      }</p></div>`,
  },

  /**
   * The close. Built from what the profile already knows, so every profile ends
   * on an invitation rather than on its cancellation policy - and a therapist
   * who never opens the builder still gets one.
   */
  zaproszenie: {
    label: 'Zaproszenie na koniec', hint: 'Ciemny pas domykający stronę', auto: true,
    tone: 'dark', fields: [HEADING_FIELD, AREA('body', 'Treść', { max: 600 })],
    render: (s, { therapist: t, env }) => {
      const body = str(s.body);
      const written = body === ''
        ? `<p>${t.accepting_new_clients
            ? 'Nie musisz wiedzieć, od czego zacząć ani jak nazwać to, z czym przychodzisz. Wystarczy pierwsze pytanie.'
            : 'W tej chwili nie przyjmuję nowych osób, ale możesz sprawdzić terminy później albo poszukać kogoś innego w katalogu.'}</p>`
        : renderBodyText(body);
      return `<h2>${escapeHtml(heading(s, t.accepting_new_clients ? 'Nie wiesz, czy to dla Ciebie?' : 'Wróć, kiedy zwolnią się miejsca'))}</h2>
${written}
<p class="phero-actions">${
        t.accepting_new_clients && t.next_available_slot_utc
          ? '<a class="btn" href="#terminy">Zobacz wolne terminy <span aria-hidden="true">→</span></a>'
          : '<a class="btn" href="/terapeuci">Wróć do katalogu</a>'
      }${pluginCta(env)}</p>`;
    },
  },

  // --- her own words: what stops two profiles reading as one template ------

  tekst: {
    label: 'Tekst', hint: 'Akapit własnymi słowami', repeatable: true,
    fields: [
      T('eyebrow', 'Nadtytuł', { max: 60, hint: 'małe litery nad nagłówkiem' }),
      HEADING_FIELD, AREA('body', 'Treść', { hint: 'pusta linia = nowy akapit' }),
      T('cta_label', 'Przycisk — napis', { max: 60 }),
      { kind: 'url', name: 'cta_href', label: 'Przycisk — adres', max: 500 },
    ],
    render: (s) => plainBody(s),
  },

  cytat: {
    label: 'Cytat', hint: 'Jedno zdanie, które ma wybrzmieć', repeatable: true,
    fields: [AREA('body', 'Cytat', { max: 400 }), T('author', 'Podpis', { max: 80 })],
    render: (s) => {
      const body = str(s.body);
      if (body === '') return '';
      const author = str(s.author);
      return `<figure class="pquote"><blockquote><p>${escapeHtml(body)}</p></blockquote>${
        author === '' ? '' : `<figcaption>${escapeHtml(author)}</figcaption>`
      }</figure>`;
    },
  },

  /**
   * Two columns: her words beside her photograph. The old page had no such
   * section at all, which is why every block was one full-width column and the
   * page went flat after the third one.
   */
  'zdjecie-tekst': {
    label: 'Zdjęcie i tekst', hint: 'Dwie kolumny: Twoje słowa obok portretu', repeatable: true,
    fields: [
      T('eyebrow', 'Nadtytuł', { max: 60 }), HEADING_FIELD,
      AREA('body', 'Treść'),
      T('cta_label', 'Przycisk — napis', { max: 60 }),
      { kind: 'url', name: 'cta_href', label: 'Przycisk — adres', max: 500 },
    ],
    render: (s, ctx) => splitBody(s, ctx, false),
  },

  'tekst-zdjecie': {
    label: 'Tekst i zdjęcie', hint: 'Dwie kolumny: portret po lewej, słowa po prawej',
    repeatable: true,
    fields: [
      T('eyebrow', 'Nadtytuł', { max: 60 }), HEADING_FIELD,
      AREA('body', 'Treść'),
      T('cta_label', 'Przycisk — napis', { max: 60 }),
      { kind: 'url', name: 'cta_href', label: 'Przycisk — adres', max: 500 },
    ],
    render: (s, ctx) => splitBody(s, ctx, true),
  },

  /** A paragraph that carries its own tinted band, for something worth stopping on. */
  'tekst-wyrozniony': {
    label: 'Tekst wyróżniony', hint: 'Akapit na przyciemnionym tle', repeatable: true, tone: 'alt',
    fields: [
      T('eyebrow', 'Nadtytuł', { max: 60, hint: 'małe litery nad nagłówkiem' }),
      HEADING_FIELD, AREA('body', 'Treść', { hint: 'pusta linia = nowy akapit' }),
      T('cta_label', 'Przycisk — napis', { max: 60 }),
      { kind: 'url', name: 'cta_href', label: 'Przycisk — adres', max: 500 },
    ],
    render: (s) => plainBody(s),
  },

  kroki: {
    label: 'Kroki', hint: 'Numerowane etapy — np. jak wygląda współpraca', repeatable: true,
    fields: [
      HEADING_FIELD, LEAD_FIELD,
      {
        kind: 'list', name: 'items', label: 'Kroki', max: 6,
        of: [T('title', 'Tytuł'), AREA('desc', 'Opis', { max: 400 })],
      },
    ],
    render: (s) => {
      const steps = items(s).filter((it) => str(it.title) !== '');
      if (steps.length === 0) return '';
      const title = str(s.heading);
      return `${title === '' ? '' : `<h2>${escapeHtml(title)}</h2>`}${lead(s)}
<ol class="meeting-steps">${steps
        .map((it) => `<li><h3>${escapeHtml(str(it.title))}</h3>${
          str(it.desc) === '' ? '' : `<p>${escapeHtml(str(it.desc))}</p>`
        }</li>`)
        .join('')}</ol>`;
    },
  },

  /**
   * The narrow strip the reference page puts under the hero. Its job is rhythm:
   * a short band between two tall sections is what keeps a long page from
   * reading as one column.
   */
  fakty: {
    label: 'Pasek faktów', hint: 'Cztery krótkie fakty w jednej linii',
    repeatable: true, tone: 'narrow',
    fields: [
      {
        kind: 'list', name: 'items', label: 'Fakty', max: 4,
        of: [T('value', 'Fakt', { max: 60 }), T('label', 'Doprecyzowanie', { max: 90 })],
      },
    ],
    render: (s) => {
      const facts = items(s).filter((it) => str(it.value) !== '');
      if (facts.length === 0) return '';
      return `<ul class="pfacts-strip">${facts
        .map((it) => `<li><strong>${escapeHtml(str(it.value))}</strong>${
          str(it.label) === '' ? '' : `<span>${escapeHtml(str(it.label))}</span>`
        }</li>`)
        .join('')}</ul>`;
    },
  },

  /**
   * The dark band the reference page closes with. The profile used to end on
   * "Zasady odwołania" - the dullest thing it had to say.
   */
  wyroznienie: {
    label: 'Wyróżniony pas', hint: 'Ciemny pas — dobre domknięcie strony',
    repeatable: true, tone: 'dark',
    fields: [
      HEADING_FIELD, AREA('body', 'Treść', { max: 600 }),
      T('cta_label', 'Przycisk — napis', { max: 60 }),
      { kind: 'url', name: 'cta_href', label: 'Przycisk — adres', max: 500 },
    ],
    render: (s) => {
      const title = str(s.heading);
      const body = renderBodyText(str(s.body));
      if (title === '' && body === '') return '';
      return `${title === '' ? '' : `<h2>${escapeHtml(title)}</h2>`}${body}${ctaButton(s)}`;
    },
  },
};

/** The palette is split the same way the engine is: her data, then her words. */
export const SECTION_GROUPS: Array<[boolean, string]> = [
  [true, 'Twoje dane'],
  [false, 'Własna treść'],
];

// ---------------------------------------------------------- parse & render ---

/**
 * Sections arrive as JSON that a person edited, so nothing is trusted on the
 * way in: an unknown type is dropped, an unknown field is dropped, and every
 * string is cut to the length its field declares. A profile must never come out
 * broken because this column was hand-edited.
 */
export function parseSections(raw: unknown): Section[] {
  let parsed: unknown = raw;
  if (typeof raw === 'string' || raw === null || raw === undefined) {
    try {
      parsed = JSON.parse(raw || '[]');
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out: Section[] = [];
  for (const entry of parsed.slice(0, MAX_SECTIONS)) {
    const clean = cleanSection(entry);
    if (clean) out.push(clean);
  }
  return out;
}

function cleanSection(entry: unknown): Section | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const raw = entry as Values;
  const type = typeof raw.type === 'string' ? raw.type : '';
  const def = SECTIONS_DEF[type];
  if (!def) return null;

  const out: Section = { type };
  for (const field of def.fields ?? []) {
    const value = cleanField(field, raw[field.name]);
    if (value !== undefined) out[field.name] = value;
  }
  return out;
}

function cleanField(field: Field, value: unknown): unknown {
  if (field.kind === 'list') {
    if (!Array.isArray(value)) return undefined;
    const rows = value.slice(0, field.max ?? 12).map((item) => {
      const src = (typeof item === 'object' && item !== null ? item : {}) as Values;
      const dst: Values = {};
      for (const sub of field.of ?? []) {
        const clean = cleanField(sub, src[sub.name]);
        if (clean !== undefined) dst[sub.name] = clean;
      }
      return dst;
    });
    return rows.filter((row) => Object.keys(row).length > 0);
  }

  if (typeof value !== 'string') return undefined;
  if (field.kind === 'url') return safeUrl(value) ?? undefined;
  if (field.kind === 'select') {
    return (field.options ?? []).some(([v]) => v === value) ? value : undefined;
  }
  const text = field.kind === 'textarea'
    ? sanitizeRichText(value, field.max ?? 2000)
    : sanitizeLine(value, field.max ?? 120);
  return text === '' ? undefined : text;
}

/**
 * The order a profile falls back to before the therapist has arranged anything.
 * It reproduces the fixed spine the page had before sections existed, so an
 * untouched profile keeps rendering exactly as it did.
 */
const DEFAULT_ORDER = [
  'hero', 'kluczowe', 'intro', 'first_meeting', 'topics', 'offers', 'slots', 'faq', 'credentials', 'links', 'policy',
  'zaproszenie',
] as const;

/**
 * What the page actually renders: her arrangement if she made one, the default
 * spine otherwise - and in both cases exactly one heading block. A page without
 * one has no `<h1>` and no photograph, which is broken rather than minimal, so
 * it is not something the builder can leave out by accident.
 */
export function pageSections(arranged: Section[], blocks: readonly string[]): Section[] {
  if (arranged.length === 0) return defaultSections(blocks);
  return arranged.some((section) => SECTIONS_DEF[section.type]?.family === 'hero')
    ? arranged
    : [{ type: 'hero' }, ...arranged];
}

export function defaultSections(blocks: readonly string[]): Section[] {
  // `profile_blocks` was written with a default of its own by an old migration,
  // so it is almost never empty and the closing band would never appear. It is
  // part of the spine, not a choice - a page has to land somewhere.
  const stored = blocks.length > 0 ? blocks : DEFAULT_ORDER;
  const withClose = stored.includes('zaproszenie') ? stored : [...stored, 'zaproszenie'];
  // `profile_blocks` predates both of these, so an old value carries neither.
  const hasHead = withClose.some((id) => SECTIONS_DEF[id]?.family === 'hero');
  const order = hasHead ? withClose : ['hero', 'kluczowe', ...withClose];
  return order
    .filter((id) => SECTIONS_DEF[id]?.auto === true)
    .map((id) => ({ type: id }));
}



/** Anchors kept from the old markup: the hero and the widget link to them. */
const ANCHORS: Record<string, string> = { slots: 'terminy', faq: 'faq', first_meeting: 'pierwsze' };

/**
 * One broken section must not take the profile down with it, so each renders
 * inside its own try/catch. A section whose renderer returns nothing - no bio,
 * no offer, no slots - is skipped entirely: a heading above nothing is the thing
 * that reads as broken.
 */
export function renderSections(sections: Section[], ctx: SectionCtx): string {
  const seenAnchor = new Set<string>();
  return sections
    .map((section) => {
      const def = SECTIONS_DEF[section.type];
      if (!def) return '';
      let inner: string;
      try {
        inner = def.render(section, ctx);
      } catch {
        return '';
      }
      if (inner.trim() === '') return '';

      // The heading block is the page's masthead, not one of the bands below
      // it: it brings its own element and its own layout class.
      if (def.family === 'hero') {
        return `<header class="phero phero--${escapeHtml(section.type.replace(/^hero-?/, '') || 'klasyczny')}">${inner}</header>`;
      }
      const anchor = ANCHORS[section.type];
      const id = anchor && !seenAnchor.has(anchor) && !!seenAnchor.add(anchor) ? ` id="${anchor}"` : '';
      const tone = def.tone ?? '';
      const cls = tone === '' ? 'pblock' : `pblock pblock--${tone}`;
      return `<section class="${cls}"${id}>${inner}</section>`;
    })
    .join('');
}

/** Which auto sections would render something for this therapist right now. */
export function sectionHasContent(type: string, ctx: SectionCtx): boolean {
  const def = SECTIONS_DEF[type];
  if (!def?.auto) return true;
  try {
    return def.render({ type }, ctx).trim() !== '';
  } catch {
    return false;
  }
}
