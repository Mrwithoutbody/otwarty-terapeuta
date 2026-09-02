/**
 * Host blocks: the parts of a therapist's page that come from the database.
 *
 * The page itself is composed and rendered by the x402-landings engine; these
 * are the blocks the engine cannot know about - her portrait and facts in the
 * heading, her offer, her calendar, her FAQ, her credentials, the closing
 * invitation. Each one renders from `SectionCtx` (the therapist, her FAQ, her
 * open slots) and is registered into the engine in `lp.ts`.
 *
 * What used to live here as well - text blocks, layout axes, the parser and
 * the page renderer - is the engine's job now and was deleted.
 */
import type { Block as Section, Field, Values } from 'x402-landings';
import type { Env } from '../env';
import type { PublicFaqItem, PublicSlot, PublicTherapist } from '../db/types';
import { escapeHtml, renderBodyText, safeUrl } from '../lib/sanitize';
import { addCivilDays, civilDateIn, formatPrice, formatTime } from '../lib/time';
import type { CivilDate } from '../lib/time';

export interface SectionCtx {
  env: Env;
  therapist: PublicTherapist;
  faq: PublicFaqItem[];
  slots: PublicSlot[];
  /**
   * Anchors the arrangement actually renders. She can delete the slots block
   * while keeping a calendar full of slots; a button jumping to an anchor that
   * is not on the page is worse than no button. `renderProfile` fills this in,
   * and an absent set means "render every link", which is what a caller
   * rendering one section on its own wants.
   */
  anchors?: ReadonlySet<string>;
}

export type Tone = '' | 'alt' | 'dark' | 'narrow';

export interface SecDef {
  label: string;
  hint: string;
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


/**
 * Presentation of one block, chosen per section. Content fields differ per
 * type; these three are the same on every block, so they live outside
 * `fields`. An empty value means "as the type / the page decides", which is
 * why a profile saved before this existed renders exactly as it did.
 */






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


function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function items(section: Section): Values[] {
  return Array.isArray(section.items) ? (section.items as Values[]) : [];
}

function eyebrow(text: string): string {
  return text === '' ? '' : `<p class="lp-kicker">${escapeHtml(text)}</p>`;
}


function ctaButton(section: Section, ghost = false): string {
  const label = str(section.cta_label);
  const href = safeUrl(str(section.cta_href));
  if (label === '' || href === null) return '';
  return `<a class="lp-btn${ghost ? ' lp-btn--ghost' : ''}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

/**
 * Where else to find her. This used to be a band of its own, which gave a link
 * to Instagram the same weight as her offer; it belongs next to her name and in
 * the closing band, where someone is already deciding whether to write.
 */
function profileLinks(t: PublicTherapist): string {
  if (t.links.length === 0) return '';
  return `<ul class="phero-links">${t.links
    .map(
      (l) => `<li><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(l.label)} <span aria-hidden="true">↗</span></a></li>`,
    )
    .join('')}</ul>`;
}

/** Is the block this anchor belongs to on the page at all? */
function hasAnchor(ctx: SectionCtx, anchor: string): boolean {
  return ctx.anchors === undefined || ctx.anchors.has(anchor);
}

/** Does she have first-meeting answers? The hero links to that block only then. */
function hasFirstMeeting(t: PublicTherapist): boolean {
  const { course, prep, decision } = t.first_meeting;
  return `${course}${prep}${decision}`.trim() !== '';
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

/** The offer as rows, used by the list block and by the two-card block. */
function offerRows(t: PublicTherapist): string {
  return `<ul class="offer-rows">${t.offers
    .map(
      (o) => `<li><span class="offer-name">${escapeHtml(o.title)}</span>
      <span class="offer-meta">${o.duration_minutes} min · ${o.mode === 'online' ? 'online' : 'stacjonarnie'}</span>
      <span class="offer-price">${escapeHtml(formatPrice(o.price_minor, o.currency))}</span></li>`,
    )
    .join('')}</ul>`;
}

/**
 * What opens a written block: her small label, her heading, her sentence under
 * it. Each part is skipped when empty, which is why every block that has these
 * fields starts the same way.
 */
function blockHead(s: Section): string {
  const title = str(s.heading);
  const lead = str(s.lead);
  return `${eyebrow(str(s.eyebrow))}${title === '' ? '' : `<h2>${escapeHtml(title)}</h2>`}${
    lead === '' ? '' : `<p class="block-lead">${escapeHtml(lead)}</p>`
  }`;
}

/**
 * What every heading block puts on the page. The parts it shows differ; the
 * order never does, so a screen reader hears the same profile whichever shape
 * she picked.
 */
function heroBody(
  ctx: SectionCtx,
  opts: {
    facts: boolean;
    greeting?: string;
    badge?: string;
    /** Her sentence in the <h1>; the name then moves onto the portrait card. */
    eyebrow?: string;
    title?: string;
    quote?: string;
    lead?: string;
    caption?: string;
  },
): string {
  const t = ctx.therapist;
  const card = opts.caption !== undefined;
  const formats = [t.offers_online ? 'online' : null, t.offers_in_person ? 'stacjonarnie' : null]
    .filter((x): x is string => x !== null);

  const photo = t.photo_url
    // The master, not the thumbnail: this renders small but must stay sharp on
    // a high-DPI screen. The 160px rendition is for the catalogue cards.
    ? `<img class="${card ? '' : 'phero-photo'}" src="${escapeHtml(t.photo_url)}" alt="" width="320" height="400" decoding="async">`
    : `<span class="${card ? 'phero-card-empty' : 'phero-photo empty'}" aria-hidden="true"></span>`;

  const frame = card
    ? `<figure class="phero-card">${photo}
    <figcaption><strong>${escapeHtml(t.display_name)}</strong>
      <span>${escapeHtml(opts.caption ?? '')}</span></figcaption>
  </figure>`
    : opts.badge
      ? `<figure class="phero-frame">${photo}${opts.badge}</figure>`
      : photo;

  // Each fact is finished HTML by the time it lands here: the plain ones are
  // escaped as they are built, and the language list arrives with the inline
  // flag SVGs it draws itself. Escaping the lot printed that markup as text.
  const facts = card
    ? [
        t.price_min_minor === null
          ? null
          : escapeHtml(`${formatPrice(t.price_min_minor, t.currency)}${t.offers[0] ? ` / ${t.offers[0].duration_minutes} min` : ''}`),
        escapeHtml(t.locations.map((l) => [l.city, l.address_line].filter(Boolean).join(', ')).find((x) => x !== '') ?? ''),
        t.offers_online ? 'lub online' : null,
        t.session_types.length > 0 ? escapeHtml(labelList(t.session_types, '')) : null,
      ]
    : [
        escapeHtml(t.locations.map((l) => l.city).join(', ')),
        escapeHtml(formats.join(' i ')),
        languageList(t.languages),
        t.session_types.length > 0 ? escapeHtml(labelList(t.session_types, '')) : null,
      ];
  const shown = facts.filter((x): x is string => x !== null && x !== '');

  return `${frame}
  <div>
    <ul class="badges">
      ${t.verification_status === 'verified' ? `<li class="badge ok">profil zweryfikowany${t.verified_at ? ` (${escapeHtml(t.verified_at.slice(0, 10))})` : ''}</li>` : '<li class="badge">dane deklarowane przez terapeutę</li>'}
      ${t.accepting_new_clients ? '<li class="badge">przyjmuje nowe osoby</li>' : '<li class="badge">brak wolnych miejsc</li>'}
      ${t.is_demo ? '<li class="badge demo">profil demonstracyjny — osoba fikcyjna</li>' : ''}
    </ul>
    ${eyebrow(opts.eyebrow ?? '')}
    <h1>${escapeHtml(opts.title || t.display_name)}</h1>
    ${opts.quote ? `<p class="phero-quote">${escapeHtml(opts.quote)}</p>` : ''}
    ${opts.greeting ? `<p class="phero-greeting">${escapeHtml(opts.greeting)}</p>` : ''}
    ${opts.lead ? `<p class="phero-lead">${escapeHtml(opts.lead)}</p>` : t.headline ? `<p class="phero-headline">${escapeHtml(t.headline)}</p>` : ''}
    <div class="phero-actions">
      ${ctx.slots[0] && hasAnchor(ctx, 'terminy') ? '<a class="lp-btn" href="#terminy">Zobacz wolne terminy <span aria-hidden="true">→</span></a>' : ''}
      ${hasFirstMeeting(t) && hasAnchor(ctx, 'pierwsze') ? '<a class="lp-btn lp-btn--ghost" href="#pierwsze">Jak wygląda pierwsze spotkanie</a>' : ''}
    </div>
    ${opts.facts && shown.length > 0 ? `<ul class="phero-facts">${shown.map((f) => `<li>${f}</li>`).join('')}</ul>` : ''}
    ${profileLinks(t)}
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

/** Every block of hers that reads the database, keyed by the type the engine sees. */
export const HOST_SECTIONS: Record<string, SecDef> = {
  'hero-profil': {
    label: 'Nagłówek — klasyczny', hint: 'Portret obok imienia, fakty i przycisk',
    auto: true, family: 'hero',
    render: (_s, ctx) => heroBody(ctx, { facts: true }),
  },


  /**
   * The heading a one-person practice writes for itself: her sentence in the
   * <h1>, a line she is quoted on, and the name on a card under the portrait.
   * The other headings lead with the name, which is right for a catalogue entry
   * and wrong for a page that has to say "this is for you" first.
   */
  'hero-obietnica': {
    label: 'Nagłówek — obietnica', hint: 'Twoje zdanie w tytule, nazwisko na karcie pod portretem',
    auto: true, family: 'hero',
    fields: [
      T('nadtytul', 'Nadtytuł', { max: 90, hint: 'np. Psychoterapia Gestalt · Warszawa i online' }),
      T('tytul', 'Tytuł', { max: 120, hint: 'zdanie do osoby, nie Twoje nazwisko' }),
      AREA('cytat', 'Cytat', { max: 240 }),
      AREA('wstep', 'Akapit wprowadzający', { max: 600 }),
      T('podpis', 'Podpis pod nazwiskiem', { max: 120, hint: 'puste = Twój nagłówek profilu' }),
    ],
    render: (s, ctx) => heroBody(ctx, {
      facts: true,
      eyebrow: str(s.nadtytul),
      title: str(s.tytul),
      quote: str(s.cytat),
      lead: str(s.wstep),
      caption: str(s.podpis) || ctx.therapist.headline || '',
    }),
  },


  /**
   * The landing-page opening: the slogan at display size with the portrait
   * beside it. Kicker, a slogan-sized <h1>, the lead and the two ways in;
   * the name still renders (small, under the actions) whenever the slogan
   * takes the <h1>, because a page must say whose it is. A profile without
   * a photograph gets the full-width typographic version.
   */
  'hero-plakat': {
    label: 'Nagłówek — plakatowy', hint: 'Cały ekran typografii: nadtytuł, hasło, przyciski',
    auto: true, family: 'hero',
    fields: [
      T('nadtytul', 'Nadtytuł', { max: 90, hint: 'np. Psychoterapeutka · Warszawa · od 2009' }),
      AREA('tytul', 'Hasło w tytule', { max: 140, hint: 'puste = Twoje imię i nazwisko' }),
      AREA('wstep', 'Zdanie pod hasłem', { max: 300, hint: 'puste = nagłówek profilu' }),
      {
        kind: 'select', name: 'portret', label: 'Zdjęcie w nagłówku',
        options: [['', 'Bez zdjęcia — portret pokazuje sekcja „Jak pracuję"'], ['pokaz', 'Ze zdjęciem obok hasła']],
      },
    ],
    render: (s, ctx) => {
      const t = ctx.therapist;
      const title = str(s.tytul);
      const lead = str(s.wstep) || t.headline || '';
      // The poster leads with the promise; the trust line and the badges are
      // its footer. A verification date above the headline reads as bureaucracy.
      const photo = str(s.portret) === 'pokaz' && t.photo_url
        ? `<figure class="phero-plakat-photo"><img src="${escapeHtml(t.photo_url)}" alt="" width="320" height="400" decoding="async"></figure>`
        : '';
      return `<div>
    ${eyebrow(str(s.nadtytul))}
    <h1>${escapeHtml(title || t.display_name)}</h1>
    ${lead === '' ? '' : `<p class="phero-lead">${escapeHtml(lead)}</p>`}
    <div class="phero-actions">
      ${ctx.slots[0] && hasAnchor(ctx, 'terminy') ? '<a class="lp-btn" href="#terminy">Zobacz wolne terminy <span aria-hidden="true">→</span></a>' : ''}
      ${hasFirstMeeting(t) && hasAnchor(ctx, 'pierwsze') ? '<a class="lp-btn lp-btn--ghost" href="#pierwsze">Jak wygląda pierwsze spotkanie</a>' : ''}
    </div>
    ${title === '' ? '' : `<p class="phero-plakat-name">${escapeHtml(t.display_name)}</p>`}
    <ul class="badges">
      ${t.verification_status === 'verified' ? `<li class="badge ok">profil zweryfikowany${t.verified_at ? ` (${escapeHtml(t.verified_at.slice(0, 10))})` : ''}</li>` : '<li class="badge">dane deklarowane przez terapeutę</li>'}
      ${t.accepting_new_clients ? '<li class="badge">przyjmuje nowe osoby</li>' : '<li class="badge">brak wolnych miejsc</li>'}
      ${t.is_demo ? '<li class="badge demo">profil demonstracyjny — osoba fikcyjna</li>' : ''}
    </ul>
    ${profileLinks(t)}
  </div>
  ${photo}`;
    },
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
    render: (s, ctx) => heroBody(ctx, { facts: false, greeting: str(s.powitanie) }),
  },

  /**
   * A wide photograph with the details on a card riding over its lower edge.
   * Wants a landscape photo; a portrait one is cropped to its upper third.
   */
  /**
   * A coloured block carrying the whole heading: words on one side, the portrait
   * on the other with one concrete fact pinned to it. The first attempt made
   * this a 21:9 panorama, which turns a portrait photograph - or worse, a
   * placeholder avatar - into a cropped forehead.
   */
  'hero-okladka': {
    label: 'Nagłówek — na kolorze', hint: 'Całość na barwnym bloku, portret z plakietką',
    auto: true, family: 'hero',
    fields: [AREA('powitanie', 'Zdanie na powitanie', { max: 240 })],
    render: (s, ctx) => {
      const next = ctx.slots[0];
      const badge = next
        ? `<span class="phero-badge"><b>${escapeHtml(compactDateTime(next.starts_at_utc, next.timezone))}</b>
           <span>najbliższy wolny termin</span></span>`
        : '';
      return heroBody(ctx, { facts: true, greeting: str(s.powitanie), badge });
    },
  },


  /**
   * Price, length and the next free slot in one line. Separate from the heading
   * because it is the row people compare between profiles, and it has to sit in
   * the same place whichever heading she picked.
   */
  kluczowe: {
    label: 'Cena i najbliższy termin', hint: 'Wiersz faktów do porównywania profili',
    auto: true,
    render: (_s, ctx) => {
      const { therapist: t, slots } = ctx;
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
  <div class="pfact-cta">${nextSlot && hasAnchor(ctx, 'terminy') ? '<a class="lp-btn" href="#terminy">Zobacz wolne terminy</a>' : ''}</div>
</div>`;
    },
  },

  // --- auto: her data, already in the panel --------------------------------
  intro: {
    label: 'Jak pracuję', hint: 'Twój opis i nurt pracy, ze zdjęciem', auto: true,
    render: (s, { therapist: t }) => {
      if (t.bio.trim() === '') return '';
      const text = `${introBody(t.bio)}
${t.modalities.length === 0 ? '' : `<ul class="chips">${t.modalities.map((m) => `<li>${escapeHtml(m.name)}</li>`).join('')}</ul>`}`;
      // The portrait lives here, beside her own words - not in the poster
      // heading, which is typography.
      const head = `${eyebrow('Jak pracuję')}<h2>${escapeHtml('Tak wygląda praca ze mną')}</h2>`;
      if (!t.photo_url) return `${head}${text}`;
      return `${head}<div class="psplit">
  <div>${text}</div>
  <figure class="psplit-photo"><img src="${escapeHtml(t.photo_url)}" alt="" width="320" height="400" loading="lazy" decoding="async"></figure>
</div>`;
    },
  },

  /**
   * The question everyone has before writing to a stranger about their mental
   * health: what will actually happen. Rendered as steps because that is what it
   * is - each answer she gave, in the order the person will live them.
   */
  first_meeting: {
    label: 'Pierwsze spotkanie', hint: 'Czego może się spodziewać osoba, która się odezwie', tone: 'alt', auto: true,
    render: (s, { therapist: t }) => {
      const candidates: Array<[string, string]> = [
        ['Jak wygląda pierwsze spotkanie', t.first_meeting.course],
        ['Czy trzeba się przygotować', t.first_meeting.prep],
        ['Kiedy decydujecie o dalszej pracy', t.first_meeting.decision],
      ];
      const steps = candidates.filter(([, body]) => body.trim() !== '');
      if (steps.length === 0) return '';
      return `${eyebrow('Pierwsze spotkanie')}<h2>${escapeHtml('Zanim się umówisz')}</h2><ol class="meeting-steps">${steps
        .map(([title, body]) => `<li><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></li>`)
        .join('')}</ol>`;
    },
  },

  topics: {
    label: 'Z czym pracuję', hint: 'Obszary wybrane w zakładce profilu', tone: 'alt', auto: true,
    render: (s, { therapist: t }) =>
      t.topics.length === 0
        ? ''
        : `${eyebrow('Z czym pracuję')}<h2>${escapeHtml('Nie musisz wiedzieć, jak to nazwać')}</h2><ul class="chips">${t.topics.map((x) => `<li>${escapeHtml(x.name)}</li>`).join('')}</ul>`,
  },

  offers: {
    label: 'Oferta — karty', hint: 'Każda sesja na osobnej karcie', auto: true,
    family: 'oferta',
    render: (s, { therapist: t }) =>
      t.offers.length === 0
        ? ''
        : `${eyebrow('Oferta')}<h2>${escapeHtml('Jedna cena, bez gwiazdek')}</h2><div class="offer-grid">${t.offers
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
    auto: true, family: 'oferta',
    render: (s, { therapist: t }) =>
      t.offers.length === 0
        ? ''
        : `${eyebrow('Oferta')}<h2>${escapeHtml('Jedna cena, bez gwiazdek')}</h2>${offerRows(t)}`,
  },

  slots: {
    label: 'Wolne terminy', hint: 'Z Twojego kalendarza, z zasadami odwołania', tone: 'alt', auto: true,
    render: (s, { therapist: t, slots, env }) => {
      const table = slotsByDay(slots);
      if (table === '') return '';
      // The cancellation rule is a footnote of the calendar, not a chapter of
      // the page: it matters at the moment of picking an hour and nowhere else.
      const policy = t.cancellation_policy.trim() !== ''
        ? escapeHtml(t.cancellation_policy)
        : `Bezpłatne odwołanie najpóźniej na ${cutoffLabel(t.cancellation_cutoff_hours)} przed sesją; później sesja jest płatna.`;
      return `${eyebrow('Najbliższe wolne terminy')}<h2>${escapeHtml('Kiedy możemy się spotkać')}</h2>${table}
<div class="slot-foot">
  <p>Rezerwacja odbywa się przez asystenta ChatGPT.</p>
  <p>${policy}</p>
  ${pluginCta(env)}
</div>`;
    },
  },


  /**
   * Offer and next slots side by side, in two cards. Two full-width bands for
   * "one session, 260 zl" and "here are the hours" is what makes a profile
   * sprawl; someone comparing four therapists wants both facts in one glance.
   */
  zestawienie: {
    label: 'Oferta i terminy obok siebie', hint: 'Dwie karty w jednym rzędzie — zwarty układ',
    auto: true,
    render: (s, { therapist: t, slots, env }) => {
      if (t.offers.length === 0 && slots.length === 0) return '';
      const soon = slots.slice(0, 6);
      const rest = slots.length - soon.length;
      return `${eyebrow('W skrócie')}<h2>${escapeHtml('Ile kosztuje i kiedy możemy się spotkać')}</h2>
<div class="pcards">
  ${
    t.offers.length === 0
      ? ''
      : `<div class="pcard">
    <h3>Oferta</h3>
    ${offerRows(t)}
  </div>`
  }
  ${
    soon.length === 0
      ? ''
      : `<div class="pcard">
    <h3>Najbliższe wolne terminy</h3>
    <ul class="slot-chips">${soon
        .map(
          (slot) => `<li><b>${escapeHtml(compactDateTime(slot.starts_at_utc, slot.timezone))}</b>
      <span>${slot.mode === 'online' ? 'online' : 'gabinet'} · ${slot.duration_minutes} min</span></li>`,
        )
        .join('')}</ul>
    ${rest > 0 ? `<p class="hint">…i ${rest} ${rest === 1 ? 'kolejny termin' : 'kolejnych terminów'}.</p>` : ''}
    ${pluginCta(env)}
  </div>`
  }
</div>`;
    },
  },


  /**
   * Every basic fact in one place, as label and value in two columns - the
   * layout the catalogue card has always used. A page of prose is no help to
   * someone holding four profiles side by side; this is the part they compare.
   */
  dane: {
    label: 'Podstawowe informacje', hint: 'Wszystkie fakty w dwóch kolumnach', tone: 'alt', auto: true,
    render: (s, { therapist: t, slots }) => {
      const duration = t.offers[0]?.duration_minutes ?? null;
      const price =
        t.price_min_minor === null
          ? null
          : t.price_min_minor === t.price_max_minor
            ? formatPrice(t.price_min_minor, t.currency)
            : `${formatPrice(t.price_min_minor, t.currency)} – ${formatPrice(t.price_max_minor ?? t.price_min_minor, t.currency)}`;
      const modes = [t.offers_online ? 'online' : null, t.offers_in_person ? 'stacjonarnie' : null]
        .filter((x): x is string => x !== null)
        .join(', ');
      const next = slots[0];

      // Pairs, not a fixed table: a row nobody filled in is a row nobody reads.
      const rows: Array<[string, string]> = [
        ['Cena', price ?? ''],
        ['Długość sesji', duration === null ? '' : `${duration} min`],
        ['Forma', modes],
        ['Miejscowość', t.locations.map((l) => l.city).join(', ') || (t.offers_online ? 'tylko online' : '')],
        ['Języki', t.languages.length === 0 ? '' : languageList(t.languages)],
        ['Rodzaje spotkań', labelList(t.session_types, '')],
        ['Dla kogo', labelList(t.age_groups, '')],
        ['Nurt', t.modalities.map((m) => m.name).join(', ')],
        ['Najbliższy termin', next ? compactDateTime(next.starts_at_utc, next.timezone) : 'brak wolnych terminów'],
        ['Bezpłatne odwołanie', `najpóźniej ${cutoffLabel(t.cancellation_cutoff_hours)} przed sesją`],
      ].filter((row): row is [string, string] => row[1] !== '');

      if (rows.length === 0) return '';
      return `${eyebrow('W skrócie')}<h2>${escapeHtml('Podstawowe informacje')}</h2>
<dl class="pdata">${rows
        .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${label === 'Języki' ? value : escapeHtml(value)}</dd></div>`)
        .join('')}</dl>`;
    },
  },

  'faq-profil': {
    label: 'Pytania i odpowiedzi', hint: 'Twoje odpowiedzi z zakładki FAQ', auto: true,
    render: (s, { faq }) =>
      faq.length === 0
        ? ''
        : `${eyebrow('Pytania i odpowiedzi')}<h2>${escapeHtml('Pytania, które padają najczęściej')}</h2>${faq
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

    render: (s, { therapist: t }) =>
      t.credentials.length === 0
        ? ''
        : `${eyebrow('Kwalifikacje')}<h2>${escapeHtml('Skąd mam do tego przygotowanie')}</h2>${t.credentials
            .map(
              (cr) => `<details><summary>${escapeHtml(cr.title)}</summary><div class="details-body">
        <p>${cr.issuer ? `${escapeHtml(cr.issuer)}` : 'Wystawca nie podany'}${cr.year ? `, ${cr.year}` : ''} —
        ${cr.verified ? '<strong>zweryfikowane</strong>' : 'deklarowane przez terapeutę'}</p></div></details>`,
            )
            .join('')}`,
  },

  // The free-text policy is often empty, so the cutoff carries the meaning.
  /**
   * The close. Built from what the profile already knows, so every profile ends
   * on an invitation rather than on its cancellation policy - and a therapist
   * who never opens the builder still gets one.
   */
  zaproszenie: {
    label: 'Zaproszenie na koniec', hint: 'Ciemny pas domykający stronę', tone: 'dark', auto: true,
    render: (_s, ctx) => {
      const { therapist: t, env } = ctx;
      const written = `<p>${t.accepting_new_clients
            ? 'Nie musisz wiedzieć, od czego zacząć ani jak nazwać to, z czym przychodzisz. Wystarczy pierwsze pytanie.'
            : 'W tej chwili nie przyjmuję nowych osób, ale możesz sprawdzić terminy później albo poszukać kogoś innego w katalogu.'}</p>`;
      return `<h2>${escapeHtml(t.accepting_new_clients ? 'Nie wiesz, czy to dla Ciebie?' : 'Wróć, kiedy zwolnią się miejsca')}</h2>
${written}
<p class="phero-actions">${
        t.accepting_new_clients && t.next_available_slot_utc && hasAnchor(ctx, 'terminy')
          ? '<a class="lp-btn" href="#terminy">Zobacz wolne terminy <span aria-hidden="true">→</span></a>'
          : '<a class="lp-btn" href="/terapeuci">Wróć do katalogu</a>'
      }${pluginCta(env)}</p>
${profileLinks(t)}`;
    },
  },

  // --- her own words: what stops two profiles reading as one template ------


  usluga: {
    label: 'Usługa', hint: 'Opis jednej usługi: zakres, cytat i praktyczne szczegóły',
    repeatable: true, tone: 'alt',
    fields: [
      T('eyebrow', 'Kategoria', { max: 60, hint: 'np. Terapia indywidualna' }),
      HEADING_FIELD,
      LEAD_FIELD,
      AREA('body', 'Opis', { max: 800 }),
      {
        kind: 'list', name: 'cechy', label: 'Z czym pomaga', max: 6,
        of: [T('tekst', 'Punkt', { max: 60 })],
      },
      AREA('cytat', 'Cytat', { max: 240 }),
      T('cytat_autor', 'Autor cytatu', { max: 80 }),
      {
        kind: 'list', name: 'szczegoly', label: 'Praktyczne szczegóły', max: 4,
        hint: 'np. Czas trwania — 50 minut, Cena — 200 zł',
        of: [T('etykieta', 'Etykieta', { max: 40 }), T('wartosc', 'Wartość', { max: 60 })],
      },
    ],
    render: (s) => {
      const body = renderBodyText(str(s.body));
      const cechy = (Array.isArray(s.cechy) ? (s.cechy as Values[]) : [])
        .map((r) => str(r.tekst)).filter((x) => x !== '');
      const szczegoly = (Array.isArray(s.szczegoly) ? (s.szczegoly as Values[]) : [])
        .map((r) => [str(r.etykieta), str(r.wartosc)] as const)
        .filter(([k, v]) => k !== '' && v !== '');
      const quote = str(s.cytat);
      const autor = str(s.cytat_autor);
      if (body === '' && cechy.length === 0) return '';
      return `${blockHead(s)}<div class="pservice">
  <div>${body}${
        cechy.length === 0 ? '' : `<ul class="pservice-points">${cechy.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`
      }${
        quote === '' ? '' : `<figure class="pquote pquote--inline"><blockquote><p>${escapeHtml(quote)}</p></blockquote>${
          autor === '' ? '' : `<figcaption>${escapeHtml(autor)}</figcaption>`}</figure>`
      }</div>${
        szczegoly.length === 0 ? '' : `<dl class="pservice-facts">${szczegoly
          .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`
      }
</div>${ctaButton(s)}`;
    },
  },


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

  artykuly: {
    label: 'Teksty i publikacje', hint: 'Karty z odnośnikami do Twoich tekstów',
    repeatable: true, tone: 'alt',
    fields: [
      T('eyebrow', 'Nadtytuł', { max: 60 }), HEADING_FIELD, LEAD_FIELD,
      {
        kind: 'list', name: 'items', label: 'Teksty', max: 4,
        of: [
          T('title', 'Tytuł'),
          AREA('desc', 'Zajawka', { max: 300 }),
          { kind: 'url', name: 'url', label: 'Adres (https)', max: 500 },
          T('meta', 'Podpis', { max: 60, hint: 'np. Blog, 2026' }),
        ],
      },
    ],
    render: (s) => {
      const entries = items(s).filter((it) => str(it.title) !== '' && str(it.url) !== '');
      if (entries.length === 0) return '';
      return `${blockHead(s)}<ul class="plinks">${entries
        .map((it) => `<li><a href="${escapeHtml(str(it.url))}" target="_blank" rel="noopener noreferrer nofollow">
        <strong>${escapeHtml(str(it.title))}</strong>${
          str(it.desc) === '' ? '' : `<span>${escapeHtml(str(it.desc))}</span>`
        }<em>${escapeHtml(str(it.meta) || 'Czytaj')} <span aria-hidden="true">↗</span></em></a></li>`)
        .join('')}</ul>`;
    },
  },

};
