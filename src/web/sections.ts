import type { Env } from '../env';
import type { PublicFaqItem, PublicSlot, PublicTherapist } from '../db/types';
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
 * Background is a property of the section, not of its position. The old page
 * tinted every second block, which on seven blocks reads as one long column
 * with stripes rather than as a page with a shape.
 */
export const VARIANT_LABELS = [
  ['', 'jasne tło'],
  ['alt', 'przyciemnione tło'],
  ['dark', 'ciemny pas'],
  ['narrow', 'wąski pasek'],
] as const;
export type Variant = (typeof VARIANT_LABELS)[number][0];
export const VARIANTS: readonly string[] = VARIANT_LABELS.map(([value]) => value);

type FieldKind = 'text' | 'textarea' | 'url' | 'select' | 'list';

export interface Field {
  kind: FieldKind;
  name: string;
  label: string;
  hint?: string;
  /** Character budget for text fields, item budget for lists. */
  max?: number;
  options?: Array<[string, string]>;
  /** Shape of one list entry. */
  of?: Field[];
}

export interface SecDef {
  label: string;
  hint: string;
  /** True when the content comes from the database rather than from these fields. */
  auto?: boolean;
  fields?: Field[];
  /** Sensible starting background; the therapist can still change it. */
  defaultVariant?: Variant;
  /** May this type appear more than once on one profile? */
  repeatable?: boolean;
  /** Returns the inside of the section. Empty string means "do not render". */
  render(section: Section, ctx: SectionCtx): string;
}

const T = (name: string, label: string, extra: Partial<Field> = {}): Field =>
  ({ kind: 'text', name, label, max: 120, ...extra });
const AREA = (name: string, label: string, extra: Partial<Field> = {}): Field =>
  ({ kind: 'textarea', name, label, max: 2000, ...extra });

export const MAX_SECTIONS = 24;

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
  // --- auto: her data, already in the panel --------------------------------
  intro: {
    label: 'Jak pracuję', hint: 'Twój opis i nurt pracy', auto: true,
    fields: [HEADING_FIELD, LEAD_FIELD],
    render: (s, { therapist: t }) => {
      if (t.bio.trim() === '') return '';
      return `${eyebrow('Jak pracuję')}<h2>${escapeHtml(heading(s, 'Jak pracuję'))}</h2>${lead(s)}
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
    label: 'Z czym pracuję', hint: 'Obszary wybrane w zakładce profilu', auto: true,
    fields: [HEADING_FIELD, LEAD_FIELD],
    render: (s, { therapist: t }) =>
      t.topics.length === 0
        ? ''
        : `${eyebrow('Z czym pracuję')}<h2>${escapeHtml(heading(s, 'Nie musisz wiedzieć, jak to nazwać'))}</h2>${lead(s)}
<ul class="chips">${t.topics.map((x) => `<li>${escapeHtml(x.name)}</li>`).join('')}</ul>`,
  },

  offers: {
    label: 'Oferta i ceny', hint: 'Rodzaje sesji i ceny', auto: true,
    fields: [HEADING_FIELD, LEAD_FIELD],
    render: (s, { therapist: t }) =>
      t.offers.length === 0
        ? ''
        : `${eyebrow('Oferta')}<h2>${escapeHtml(heading(s, 'Ile to kosztuje'))}</h2>${lead(s)}
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

  slots: {
    label: 'Wolne terminy', hint: 'Z Twojego kalendarza', auto: true,
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
    label: 'Kwalifikacje', hint: 'Dyplomy i certyfikaty', auto: true,
    fields: [HEADING_FIELD, LEAD_FIELD],
    render: (s, { therapist: t }) =>
      t.credentials.length === 0
        ? ''
        : `${eyebrow('Kwalifikacje')}<h2>${escapeHtml(heading(s, 'Wykształcenie i certyfikaty'))}</h2>${lead(s)}
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
    render: (s, { therapist: t }) =>
      t.links.length === 0
        ? ''
        : `${eyebrow('Więcej o mnie')}<h2>${escapeHtml(heading(s, 'Więcej o mnie'))}</h2>${lead(s)}
<ul class="linklist">${t.links
            .map(
              (l) => `<li><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(l.label)} ↗</a></li>`,
            )
            .join('')}</ul>`,
  },

  // The free-text policy is often empty, so the cutoff carries the meaning.
  policy: {
    label: 'Zasady odwołania', hint: 'Wyliczone z Twojego wyprzedzenia', auto: true,
    fields: [HEADING_FIELD],
    render: (s, { therapist: t }) =>
      `${eyebrow('Zasady odwołania')}<h2>${escapeHtml(heading(s, 'Zasady odwołania'))}</h2>
<div class="policy-box"><p>${
        t.cancellation_policy.trim() !== ''
          ? escapeHtml(t.cancellation_policy)
          : `Wizytę możesz odwołać bezpłatnie najpóźniej na <strong>${cutoffLabel(t.cancellation_cutoff_hours)}</strong> przed jej terminem. Jeśli odwołasz później albo nie przyjdziesz, sesja jest płatna.`
      }</p></div>`,
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
    render: (s) => {
      const body = renderBodyText(str(s.body));
      if (body === '') return '';
      const title = str(s.heading);
      return `${eyebrow(str(s.eyebrow))}${title === '' ? '' : `<h2>${escapeHtml(title)}</h2>`}${body}${ctaButton(s)}`;
    },
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
      {
        kind: 'select', name: 'strona', label: 'Zdjęcie po stronie',
        options: [['prawa', 'prawej'], ['lewa', 'lewej']],
      },
      T('cta_label', 'Przycisk — napis', { max: 60 }),
      { kind: 'url', name: 'cta_href', label: 'Przycisk — adres', max: 500 },
    ],
    render: (s, { therapist: t }) => {
      const body = renderBodyText(str(s.body));
      if (body === '') return '';
      const title = str(s.heading);
      const photo = t.photo_url
        ? `<img src="${escapeHtml(t.photo_url)}" alt="" width="320" height="400" loading="lazy" decoding="async">`
        : '<span class="psplit-empty" aria-hidden="true"></span>';
      return `<div class="psplit${str(s.strona) === 'lewa' ? ' psplit--flip' : ''}">
  <div>${eyebrow(str(s.eyebrow))}${title === '' ? '' : `<h2>${escapeHtml(title)}</h2>`}${body}${ctaButton(s, true)}</div>
  <figure class="psplit-photo">${photo}</figure>
</div>`;
    },
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
    repeatable: true, defaultVariant: 'narrow',
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
    repeatable: true, defaultVariant: 'dark',
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
  const variant = typeof raw.variant === 'string' ? raw.variant : '';
  if (variant !== '' && VARIANTS.includes(variant)) out.variant = variant;
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
  'intro', 'first_meeting', 'topics', 'offers', 'slots', 'faq', 'credentials', 'links', 'policy',
] as const;

export function defaultSections(blocks: readonly string[], hasContent?: (type: string) => boolean): Section[] {
  const order = blocks.length > 0 ? blocks : DEFAULT_ORDER;
  // Tinting follows what actually renders, not the position in the list: with
  // one empty section in between, counting positions puts two tinted sections
  // side by side. The builder keeps listing the empty ones - it just does not
  // let them consume a stripe.
  let shown = 0;
  return order
    .filter((id) => SECTIONS_DEF[id]?.auto === true)
    .map((id) => {
      const visible = hasContent ? hasContent(id) : true;
      const variant = visible && shown++ % 2 === 1 ? 'alt' : '';
      return variant === '' ? { type: id } : { type: id, variant };
    });
}

export function variantOf(section: Section): Variant {
  const declared = typeof section.variant === 'string' ? section.variant : '';
  if (VARIANTS.includes(declared)) return declared as Variant;
  return SECTIONS_DEF[section.type]?.defaultVariant ?? '';
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

      const variant = variantOf(section);
      const anchor = ANCHORS[section.type];
      const id = anchor && !seenAnchor.has(anchor) && !!seenAnchor.add(anchor) ? ` id="${anchor}"` : '';
      const cls = variant === '' ? 'pblock' : `pblock pblock--${variant}`;
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
