/**
 * Host blocks: what a therapist's page knows that the pages service cannot.
 *
 * Every block here is a data provider. It reads the database - her portrait
 * and facts, her offer, her calendar, her FAQ, her credentials - and hands the
 * service an ordinary block filled with it: a `hero`, a `pricing`, a `faq`.
 * The service draws it the way the chosen theme draws every hero and every
 * price list, so switching a template restyles her data along with her words.
 * What she typed over the data in the editor (a heading of her own) wins over
 * what is sent here; the service merges the two.
 *
 * Even the calendar is data: seven days of hours, drawn by the service's
 * `calendar` block the way the chosen theme draws it.
 *
 * `HOST_BLOCK_DEFS` is what the service is told about these blocks (label,
 * hint, the fields she may fill); `resolveAll` is what it gets at render time.
 */
import type { Env } from '../env';
import type { PublicFaqItem, PublicSlot, PublicTherapist } from '../db/types';
import { escapeHtml } from '../lib/sanitize';
import { addCivilDays, civilDateIn, formatPrice, formatTime } from '../lib/time';
import type { CivilDate } from '../lib/time';

/** Public names for the enum codes the catalogue stores. */
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

/** What every page of hers renders from. */
export interface SectionCtx {
  env: Env;
  therapist: PublicTherapist;
  faq: PublicFaqItem[];
  slots: PublicSlot[];
}

type Values = Record<string, unknown>;
type Block = Values & { type: string };



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

const base = (env: Env): string => env.PUBLIC_BASE_URL.replace(/\/$/, '');



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
 * Her open slots as the service's calendar block wants them: seven consecutive
 * calendar days (an empty column says "she does not work weekends", which is
 * worth knowing), at most five hours per column, the rest counted in `more`.
 */
function calendarDays(slots: PublicSlot[]): { days: Values[]; more: string } | null {
  const first = slots[0];
  if (!first) return null;
  const today = civilDateIn(first.timezone, new Date());
  const columns = Array.from({ length: SLOT_DAYS_SHOWN }, (_, i) => {
    const day = addCivilDays(today, i);
    const items = slots.filter((s) => {
      const c = civilDateIn(s.timezone, new Date(s.starts_at_utc));
      return c.year === day.year && c.month === day.month && c.day === day.day;
    });
    return { day, items };
  });
  if (columns.every((c) => c.items.length === 0)) return null;
  const hidden = columns.reduce((n, c) => n + Math.max(0, c.items.length - SLOT_ROWS_SHOWN), 0);
  return {
    days: columns.map(({ day, items }) => {
      const label = dayLabel(day, today);
      return {
        name: label.name,
        date: label.date,
        times: items
          .slice(0, SLOT_ROWS_SHOWN)
          .map((s) => `${formatTime(s.starts_at_utc, s.timezone)} · ${s.mode === 'online' ? 'online' : 'gabinet'}`)
          .join('\n'),
      };
    }),
    more: hidden > 0 ? `…i ${hidden} ${hidden === 1 ? 'kolejny termin' : 'kolejnych terminów'} w tych dniach.` : '',
  };
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

/** The same call as a button of a service block. */
function pluginButton(env: Env): Values {
  const url = env.PUBLIC_PLUGIN_URL?.trim();
  return url
    ? { label: 'Znajdź terapeutę z pomocą ChatGPT ↗', href: url, style: 'ghost' }
    : { label: 'Zobacz, jak działa w ChatGPT', href: `${base(env)}/jak-to-dziala`, style: 'ghost' };
}


// -------------------------------------------------------------- providers ---

const T = (name: string, label: string, hint?: string): { kind: 'text'; name: string; label: string; hint?: string; max: number } =>
  ({ kind: 'text', name, label, hint, max: 160 });

/** Fields the person may fill to override what the data would say. */
const OWN = [T('eyebrow', 'Nadtytuł', 'puste = z danych'), T('heading', 'Nagłówek', 'puste = z danych'), T('lead', 'Podtytuł', 'puste = z danych')];

function facts(t: PublicTherapist): Values[] {
  const out: Values[] = [];
  const price = t.price_min_minor === null
    ? null
    : t.price_min_minor === t.price_max_minor
      ? formatPrice(t.price_min_minor, t.currency)
      : `od ${formatPrice(t.price_min_minor, t.currency)}`;
  if (price) out.push({ value: price, label: 'za sesję' });
  const duration = t.offers[0]?.duration_minutes;
  if (duration) out.push({ value: `${duration} min`, label: 'jedna sesja' });
  const modes = [t.offers_online ? 'online' : '', t.offers_in_person ? 'gabinet' : ''].filter(Boolean).join(' i ');
  if (modes) out.push({ value: modes, label: t.locations[0]?.city ?? 'forma spotkań' });
  out.push(
    t.next_available_slot_utc
      ? { value: compactDateTime(t.next_available_slot_utc, t.timezone), label: 'najbliższy wolny termin' }
      : { value: t.accepting_new_clients ? 'przyjmuje' : 'lista oczekujących', label: 'nowe osoby' },
  );
  return out.slice(0, 4);
}

/** Both buttons, always: the service drops the one whose section is not on the page. */
function bookButtons(ctx: SectionCtx): Values[] {
  const out: Values[] = [];
  if (ctx.slots.length > 0) out.push({ label: 'Zobacz wolne terminy', href: '#terminy', style: 'primary' });
  out.push({ label: 'Jak wygląda pierwsze spotkanie', href: '#steps', style: 'ghost' });
  return out;
}

/** The opening sentence of her description: a lead, not a biography. */
function firstSentence(text: string): string {
  const para = text.split('\n')[0]?.trim() ?? '';
  const m = /^(.+?[.!?])(\s|$)/.exec(para);
  return (m ? m[1]! : para).slice(0, 240);
}

/** Her portrait with an absolute address: the editor's preview lives on the service's origin. */
const photo = (ctx: SectionCtx): Values => {
  const t = ctx.therapist;
  if (!t.photo_url) return { kind: 'generated' };
  const url = t.photo_url.startsWith('/') ? `${base(ctx.env)}${t.photo_url}` : t.photo_url;
  return { kind: 'url', url, alt: t.display_name };
};

/** A host block as the service is told about it, plus how this host fills it. */
export interface HostDef {
  label: string;
  hint: string;
  fields?: Array<{ kind: 'text'; name: string; label: string; hint?: string; max: number }>;
  tone?: 'alt' | 'dark' | 'narrow';
  family?: string;
  anchor?: string;
  /** Her data as a core block of the service, or null when there is nothing to show. */
  resolve(ctx: SectionCtx): Block | null;
}

export const HOST_SECTIONS: Record<string, HostDef> = {
  'hero-profil': {
    label: 'Nagłówek profilu', hint: 'Imię, zdjęcie, jedno zdanie i fakty z Twoich danych', family: 'hero',
    fields: OWN,
    resolve: (ctx) => {
      const t = ctx.therapist;
      return {
        type: 'hero',
        eyebrow: t.headline || t.locations[0]?.city || '',
        heading: t.display_name,
        lead: firstSentence(t.bio),
        buttons: bookButtons(ctx),
        stats: facts(t),
        media: photo(ctx),
      };
    },
  },
  intro: {
    label: 'Jak pracuję', hint: 'Twój opis i zdjęcie obok siebie',
    fields: OWN,
    resolve: (ctx) => {
      const t = ctx.therapist;
      if (t.bio.trim() === '') return null;
      // No portrait here: the hero already shows it, and the service never repeats a photograph on a page.
      return { type: 'media-text', eyebrow: 'Jak pracuję', heading: 'Tak wygląda praca ze mną', body: t.bio };
    },
  },
  dane: {
    label: 'Podstawowe informacje', hint: 'Cena, długość sesji, forma, najbliższy termin', tone: 'narrow',
    fields: OWN,
    resolve: (ctx) => ({ type: 'stats', items: facts(ctx.therapist) }),
  },
  topics: {
    label: 'Z czym przychodzą', hint: 'Obszary i nurty z Twoich danych', tone: 'alt',
    fields: OWN,
    resolve: (ctx) => {
      const t = ctx.therapist;
      const items = [
        ...t.topics.map((x) => ({ title: x.name })),
        ...t.modalities.map((x) => ({ title: x.name })),
      ].slice(0, 6);
      return items.length === 0 ? null : { type: 'features', eyebrow: 'Obszary', heading: 'Z czym możesz przyjść', items };
    },
  },
  offers: {
    label: 'Oferta', hint: 'Sesje i ceny z zakładki Oferta', family: 'oferta',
    fields: OWN,
    resolve: (ctx) => {
      const t = ctx.therapist;
      if (t.offers.length === 0) return null;
      return {
        type: 'pricing', eyebrow: 'Oferta', heading: 'Sesje i ceny',
        items: t.offers.slice(0, 4).map((o) => ({
          name: o.title, price: formatPrice(o.price_minor, o.currency), per: `${o.duration_minutes} min · ${o.mode === 'online' ? 'online' : 'w gabinecie'}`,
          cta_label: 'Zobacz terminy', cta_href: '#terminy',
        })),
      };
    },
  },
  slots: {
    label: 'Wolne terminy', hint: 'Kalendarz z zakładki Dostępność, z zasadami odwołania', tone: 'alt', anchor: 'terminy',
    fields: [T('heading', 'Nagłówek', 'puste = domyślny')],
    resolve: (ctx) => {
      const cal = calendarDays(ctx.slots);
      if (!cal) return null;
      const t = ctx.therapist;
      const policy = t.cancellation_policy.trim() !== ''
        ? t.cancellation_policy
        : `Bezpłatne odwołanie najpóźniej na ${cutoffLabel(t.cancellation_cutoff_hours)} przed sesją; później sesja jest płatna.`;
      return {
        type: 'calendar',
        eyebrow: 'Najbliższe wolne terminy',
        heading: 'Kiedy możemy się spotkać',
        days: cal.days,
        more: cal.more,
        notes: `Rezerwacja odbywa się przez asystenta ChatGPT.\n\n${policy}`,
        buttons: [pluginButton(ctx.env)],
      };
    },
  },
  gabinet: {
    label: 'Gdzie się spotykamy', hint: 'Adres gabinetu, sesje online i zasady odwołania z Twoich danych', tone: 'narrow', anchor: 'gabinet',
    fields: OWN,
    resolve: (ctx) => {
      const t = ctx.therapist;
      const items: Values[] = [];
      const office = t.locations[0];
      if (t.offers_in_person && office) items.push({ label: 'Gabinet', value: [office.address_line, office.city].filter(Boolean).join(', ') });
      if (t.offers_online) items.push({ label: 'Online', value: 'sesje przez wideo, z dowolnego miejsca' });
      if (items.length === 0) return null;
      items.push({ label: 'Odwołanie', value: `bezpłatne do ${cutoffLabel(t.cancellation_cutoff_hours)} przed sesją` });
      items.push({ label: 'Rezerwacja', value: 'przez asystenta ChatGPT', href: `${base(ctx.env)}/jak-to-dziala` });
      return { type: 'contact', eyebrow: 'Gdzie się spotykamy', heading: 'Gabinet i online', items };
    },
  },
  zestawienie: {
    label: 'Pierwsze spotkanie', hint: 'Trzy odpowiedzi z zakładki O mnie', tone: 'alt', anchor: 'steps',
    fields: OWN,
    resolve: (ctx) => {
      const m = ctx.therapist.first_meeting;
      const items = [
        { title: 'Jak wygląda pierwsze spotkanie', body: m.course },
        { title: 'Jak się przygotować', body: m.prep },
        { title: 'Co potem', body: m.decision },
      ].filter((x) => x.body.trim() !== '');
      return items.length === 0 ? null : { type: 'steps', eyebrow: 'Pierwsze spotkanie', heading: 'Jak to wygląda na początku', items };
    },
  },
  'faq-profil': {
    label: 'Pytania i odpowiedzi', hint: 'Twoje odpowiedzi z zakładki FAQ', tone: 'alt',
    fields: OWN,
    resolve: (ctx) =>
      ctx.faq.length === 0
        ? null
        : { type: 'faq', eyebrow: 'Pytania i odpowiedzi', heading: 'Pytania, które padają najczęściej', items: ctx.faq.slice(0, 10).map((f) => ({ q: f.question, a: f.answer })) },
  },
  credentials: {
    label: 'Kwalifikacje', hint: 'Dyplomy i certyfikaty', tone: 'alt',
    fields: OWN,
    resolve: (ctx) => {
      const c = ctx.therapist.credentials;
      return c.length === 0
        ? null
        : { type: 'features', eyebrow: 'Kwalifikacje', heading: 'Skąd mam do tego przygotowanie',
            items: c.slice(0, 6).map((x) => ({ title: x.title, body: [x.issuer, x.year, x.verified ? 'zweryfikowane' : ''].filter(Boolean).join(' · ') })) };
    },
  },
  zaproszenie: {
    label: 'Zaproszenie na koniec', hint: 'Ciemny pas domykający stronę', tone: 'dark',
    fields: OWN,
    resolve: (ctx) => {
      const t = ctx.therapist;
      return {
        type: 'cta',
        heading: t.accepting_new_clients ? 'Umów pierwszą rozmowę' : 'Zapisz się na listę oczekujących',
        lead: 'Rezerwacja przez asystenta ChatGPT, bez telefonów i bez pisania w nocy.',
        buttons: bookButtons(ctx),
      };
    },
  },
};

/** The declaration the service keeps: everything but the code. */
export const HOST_BLOCK_DEFS: Record<string, Omit<HostDef, 'resolve'>> = Object.fromEntries(
  Object.entries(HOST_SECTIONS).map(([type, { resolve: _resolve, ...def }]) => [type, def]),
);

/** Her data for every host block, keyed by type - what a render and an edit session send. */
export function resolveAll(ctx: SectionCtx): Record<string, Block | null> {
  return Object.fromEntries(Object.entries(HOST_SECTIONS).map(([type, def]) => [type, def.resolve(ctx)]));
}

/** One line per host block for the editor's list: what it holds today, or that it would not show. */
export function summarize(resolved: Record<string, Block | null>): Record<string, { text: string; empty?: true }> {
  return Object.fromEntries(
    Object.entries(HOST_SECTIONS).map(([type, def]) => [
      type,
      resolved[type] ? { text: def.hint } : { text: `${def.hint} — brak danych`, empty: true as const },
    ]),
  );
}

/** The default spine of a profile that has never been arranged. */
export const DEFAULT_PROFILE = [
  'hero-profil', 'intro', 'dane', 'zestawienie', 'topics', 'offers', 'slots', 'gabinet', 'faq-profil', 'credentials', 'zaproszenie',
];
