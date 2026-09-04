/**
 * Jedna tabela pól danych. Każda edytowalna wartość opisana RAZ.
 *
 * Przedtem dodanie jednego pola do bloku wymagało trzech ruchów w trzech
 * plikach: deklaracji pola w `HOST_SECTIONS`, dopisania wartości do `resolve`
 * i ręcznego mapowania z powrotem na kolumnę w `host-write.ts`. Trzy miejsca
 * na pole, w każdym łatwo zapomnieć o jednym - i tak powstawał blok, który
 * pokazuje dane, ale nie da się ich tknąć.
 *
 * Teraz wpis tutaj daje wszystko naraz: formularz w edytorze (`fields`),
 * wartość w `resolved` (`read`) i zapis do bazy (`write`). Nowe pole = jeden
 * wpis w `FIELDS`, bez dotykania czegokolwiek innego.
 *
 * Listy powtarzalne (oferty, FAQ, kwalifikacje) mają własne `apply`, bo
 * wiersz odpowiada rekordowi w tabeli, a nie kolumnie.
 */
import type { PublicSlot, PublicTherapist, SessionType, AgeGroup } from '../db/types';
import { formatPrice, formatTime, formatDateTime } from '../lib/time';
import { sanitizeLine, sanitizeRichText } from '../lib/sanitize';

export interface Field {
  kind: 'text' | 'textarea' | 'url' | 'select' | 'multiselect' | 'list' | 'media' | 'hidden' | 'computed';
  name: string;
  label: string;
  hint?: string;
  max?: number;
  edit?: string;
  data?: boolean;
  item?: string;
  options?: Array<[string, string]>;
  of?: Field[];
}

/** Co zapis ma zrobić z wartością: kolumna profilu, tabela wiążąca, adres gabinetu, kalendarz. */
export type Patch =
  | { column: string; value: string | number }
  | { relation: 'languages' | 'topics' | 'modalities'; values: string[] }
  | { location: { city: string; address: string } }
  | { slots: { hours: number[]; days: number } };

/** Listy zamknięte, które żyją w bazie (obszary, nurty) - wczytane przy synchronizacji bloków. */
export type Dictionaries = Record<'topics' | 'modalities', Array<[string, string]>>;

export interface DataField {
  field: Field;
  /** Opcje pola z bazy zamiast z kodu; `fieldsOf` je wstawia. */
  optionsFrom?: keyof Dictionaries;
  /** Wartość dla formularza i podglądu, z tego, co widzi katalog. */
  read(t: PublicTherapist, ctx: ReadCtx): unknown;
  /** Co zapisać, gdy formularz przyśle tę wartość. Pusta lista = nic. */
  write(value: unknown): Patch[];
}

/** To, czego nie ma w samym profilu, a blok pokazuje: wolne terminy. */
export interface ReadCtx {
  slots: PublicSlot[];
}

// ------------------------------------------------------------- słowniki ---

/** Listy zamknięte są wspólne dla wszystkich terapeutek, więc mogą siedzieć w definicji bloku. */
export const LANGUAGE_OPTIONS: Array<[string, string]> = [
  ['pl', 'polski'], ['en', 'angielski'], ['uk', 'ukraiński'], ['ru', 'rosyjski'],
  ['de', 'niemiecki'], ['fr', 'francuski'], ['es', 'hiszpański'], ['be', 'białoruski'],
];

const SESSION_TYPE_OPTIONS: Array<[string, string]> = [
  ['individual', 'indywidualne'], ['couples', 'dla par'], ['family', 'rodzinne'],
];

const AGE_GROUP_OPTIONS: Array<[string, string]> = [
  ['adults', 'dorośli'], ['teens', 'młodzież'], ['children', 'dzieci'], ['seniors', 'seniorzy'],
];

const YES_NO: Array<[string, string]> = [['1', 'tak'], ['0', 'nie']];

// -------------------------------------------------------------- pomocne ---

const str = (value: unknown, max: number): string => sanitizeLine(String(value ?? ''), max);
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

/** Kolumna tekstowa profilu. */
function col(
  name: string,
  label: string,
  read: (t: PublicTherapist) => string,
  opts: { column?: string; max?: number; area?: boolean; hint?: string; required?: boolean } = {},
): DataField {
  const column = opts.column ?? name;
  const max = opts.max ?? 200;
  return {
    field: { kind: opts.area ? 'textarea' : 'text', name, label, hint: opts.hint, max, data: true },
    read,
    write: (value) => {
      const text = opts.area ? sanitizeRichText(String(value ?? ''), max) : str(value, max);
      // Puste imię zostawiłoby kartę w katalogu bez nazwy - takiego zapisu nie ma.
      if (opts.required === true && text === '') return [];
      return [{ column, value: text }];
    },
  };
}

/** Wybór wielokrotny ze słownika, zapisywany do tabeli wiążącej albo kolumny JSON. */
function picks(
  name: string,
  label: string,
  options: Array<[string, string]> | keyof Dictionaries,
  read: (t: PublicTherapist) => string[],
  target: 'languages' | 'topics' | 'modalities' | { column: string },
  hint?: string,
): DataField {
  const fixed = typeof options === 'string' ? [] : options;
  return {
    field: { kind: 'multiselect', name, label, hint, options: fixed, data: true },
    ...(typeof options === 'string' ? { optionsFrom: options } : {}),
    read,
    write: (value) => {
      // Słownik z bazy sprawdza zapis (`INSERT … SELECT … WHERE slug = ?`); listę
      // z kodu sprawdzamy tutaj.
      const picked = typeof options === 'string'
        ? list(value).map((v) => v.slice(0, 80)).slice(0, 24)
        : list(value).filter((v) => fixed.some(([o]) => o === v));
      return typeof target === 'string'
        ? [{ relation: target, values: picked }]
        : [{ column: target.column, value: JSON.stringify(picked) }];
    },
  };
}

/** Wartość wyliczona z innych danych: pokazana, podpisana źródłem, nie do wpisania. */
function computed(name: string, label: string, from: string, read: (t: PublicTherapist, ctx: ReadCtx) => string): DataField {
  return { field: { kind: 'computed', name, label, hint: `z: ${from}` }, read, write: () => [] };
}

const HOUR_OPTIONS: Array<[string, string]> = Array.from({ length: 15 }, (_, i) => {
  const h = i + 7;
  return [String(h), `${String(h).padStart(2, '0')}:00`];
});

/** Tak/nie jako kolumna 0/1. */
function flag(name: string, label: string, read: (t: PublicTherapist) => boolean, hint?: string): DataField {
  return {
    field: { kind: 'select', name, label, hint, options: YES_NO, data: true },
    read: (t) => (read(t) ? '1' : '0'),
    write: (value) => [{ column: name, value: String(value) === '1' ? 1 : 0 }],
  };
}

/** Liczba w zakresie, jako kolumna. */
function number(
  name: string,
  label: string,
  read: (t: PublicTherapist) => number,
  range: [number, number],
  opts: { column?: string; hint?: string } = {},
): DataField {
  return {
    field: { kind: 'text', name, label, hint: opts.hint, max: 6, data: true },
    read: (t) => String(read(t)),
    write: (value) => {
      const n = Number(String(value ?? '').replace(/\D/g, ''));
      if (!Number.isFinite(n)) return [];
      return [{ column: opts.column ?? name, value: Math.min(Math.max(n, range[0]), range[1]) }];
    },
  };
}

// ------------------------------------------------------- tabela wszystkiego ---

/**
 * Pola danych per blok. Klucz to typ bloku hosta, wartość to lista pól, które
 * ten blok pokazuje w grupie „Treść" i zapisuje do bazy.
 */
export const FIELDS: Record<string, DataField[]> = {
  'hero-profil': [
    col('display_name', 'Imię i nazwisko', (t) => t.display_name, { max: 120, required: true }),
    col('headline', 'Nadtytuł: nagłówek zawodowy', (t) => t.headline ?? '', {
      hint: 'Jedna linia nad imieniem — np. „psychoterapeutka, Warszawa”.',
    }),
    {
      field: { kind: 'media', name: 'photo_url', label: 'Zdjęcie profilowe', data: true,
        hint: 'Adres pliku z galerii w panelu — plik wgrywa się tam, bo tam jest magazyn. Puste = rysunek zastępczy.' },
      read: (t) => t.photo_url ?? '',
      write: (value) => {
        const raw = typeof value === 'object' && value !== null ? String((value as { url?: unknown }).url ?? '') : String(value ?? '');
        return [{ column: 'photo_url', value: str(raw, 500) }];
      },
    },
    computed('stat_price', 'Cena pod nagłówkiem', 'Oferta → najniższa cena aktywnej oferty', (t) =>
      t.price_min_minor === null ? '' : (t.price_min_minor === t.price_max_minor ? formatPrice(t.price_min_minor, t.currency) : `od ${formatPrice(t.price_min_minor, t.currency)}`)),
    computed('stat_duration', 'Czas sesji pod nagłówkiem', 'Oferta → czas pierwszej oferty', (t) =>
      t.offers[0] ? `${t.offers[0].duration_minutes} min` : ''),
    computed('stat_next', 'Najbliższy termin pod nagłówkiem', 'Wolne terminy → pierwszy wolny', (t) =>
      t.next_available_slot_utc ? formatDateTime(t.next_available_slot_utc, t.timezone) : ''),
  ],

  intro: [col('bio', 'Opis: jak pracujesz', (t) => t.bio, { area: true, max: 4000, hint: 'Pusta linia zaczyna nowy akapit.' })],

  dane: [
    flag('offers_online', 'Sesje online', (t) => t.offers_online),
    flag('offers_in_person', 'Sesje w gabinecie', (t) => t.offers_in_person),
    flag('accepting_new_clients', 'Przyjmuje nowe osoby', (t) => t.accepting_new_clients),
    picks('session_types', 'Rodzaj sesji', SESSION_TYPE_OPTIONS, (t) => t.session_types as SessionType[], { column: 'session_types' }),
    picks('age_groups', 'Dla kogo', AGE_GROUP_OPTIONS, (t) => t.age_groups as AgeGroup[], { column: 'age_groups' }),
    picks('languages', 'Języki', LANGUAGE_OPTIONS, (t) => t.languages, 'languages'),
    number('cancellation_cutoff_h', 'Bezpłatne odwołanie (godziny przed sesją)', (t) => t.cancellation_cutoff_hours, [0, 168]),
    col('cancellation_policy', 'Zasady odwołania', (t) => t.cancellation_policy, { max: 500 }),
    computed('city_shown', 'Miasto', 'Gdzie się spotykamy → miasto', (t) => t.locations[0]?.city ?? ''),
    computed('modalities_shown', 'Nurt', 'Z czym przychodzą → nurty', (t) => t.modalities.map((m) => m.name).join(', ')),
  ],

  topics: [
    picks('topics', 'Obszary pracy', 'topics', (t) => t.topics.map((x) => x.slug), 'topics'),
    picks('modalities', 'Nurty', 'modalities', (t) => t.modalities.map((x) => x.slug), 'modalities'),
  ],

  gabinet: [
    {
      field: { kind: 'text', name: 'city', label: 'Miasto', max: 80, data: true, hint: 'Puste = bez gabinetu, tylko online.' },
      read: (t) => t.locations[0]?.city ?? '',
      write: () => [],
    },
    {
      field: { kind: 'text', name: 'address_line', label: 'Adres gabinetu', max: 200, data: true },
      read: (t) => t.locations[0]?.address_line ?? '',
      write: () => [],
    },
  ],

  slots: [
    {
      field: { kind: 'multiselect', name: 'slot_hours', label: 'Godziny rozpoczęcia sesji', options: HOUR_OPTIONS, data: true,
        hint: 'Zaznaczone godziny w dni robocze dostają wolne terminy; odznaczona godzina usuwa swoje wolne terminy. Zarezerwowanych nie rusza.' },
      read: (_t, ctx) => [...new Set(ctx.slots.map(localHour))].sort((a, b) => Number(a) - Number(b)),
      write: () => [],
    },
    {
      field: { kind: 'text', name: 'slot_days', label: 'Na ile dni do przodu', max: 3, data: true, hint: 'Dni robocze, licząc od jutra. 1–60.' },
      read: () => '14',
      write: () => [],
    },
  ],

  // Kwalifikacje siedzą w kolumnie JSON, więc cała lista jest jedną wartością -
  // stąd `write` na miejscu zamiast osobnej obsługi w zapisie.
  credentials: [
    {
      field: {
        kind: 'list', name: 'credential_rows', label: 'Dyplomy i certyfikaty', item: 'Dyplom', max: 6, data: true,
        hint: 'Wyczyszczona nazwa usuwa wpis. Weryfikacja zostaje po stronie administratora.',
        of: [
          { kind: 'text', name: 'title', label: 'Nazwa', max: 160 },
          { kind: 'text', name: 'issuer', label: 'Wydający', max: 160 },
          { kind: 'text', name: 'year', label: 'Rok', max: 4 },
        ],
      },
      read: (t) => t.credentials.slice(0, 6).map((c) => ({
        title: c.title, issuer: c.issuer ?? '', year: c.year === null ? '' : String(c.year),
      })),
      write: (value) => {
        const items = (Array.isArray(value) ? value : []).map((raw) => {
          const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
          return {
            title: str(row.title, 160),
            issuer: str(row.issuer, 160),
            year: Number(String(row.year ?? '').replace(/\D/g, '').slice(0, 4)) || null,
            verified: false,
          };
        }).filter((row) => row.title !== '').slice(0, 6);
        return [{ column: 'credentials', value: JSON.stringify(items) }];
      },
    },
  ],

  zestawienie: [
    col('first_meeting_course', 'Jak wygląda pierwsze spotkanie', (t) => t.first_meeting.course, { area: true, max: 400 }),
    col('first_meeting_prep', 'Jak się przygotować', (t) => t.first_meeting.prep, { area: true, max: 400 }),
    col('first_meeting_decision', 'Co potem', (t) => t.first_meeting.decision, { area: true, max: 400 }),
  ],
};

/** Pola danych bloku jako deklaracje dla usługi; listy z bazy wstawione w opcje. */
export const fieldsOf = (type: string, dict?: Dictionaries): Field[] =>
  (FIELDS[type] ?? []).map((f) => (f.optionsFrom && dict ? { ...f.field, options: dict[f.optionsFrom] } : f.field));

/** Wartości pól danych bloku - to, co zobaczy formularz w edytorze. */
export function valuesOf(type: string, t: PublicTherapist, ctx: ReadCtx = { slots: [] }): Record<string, unknown> {
  return Object.fromEntries((FIELDS[type] ?? []).map((f) => [f.field.name, f.read(t, ctx)]));
}

/** Co zapisać dla jednego bloku, z tego, co przysłał edytor. */
export function patchesFor(type: string, sent: Record<string, unknown>): Patch[] {
  const out = (FIELDS[type] ?? []).flatMap((f) => (f.field.name in sent ? f.write(sent[f.field.name]) : []));
  // Dwa pola, jeden rekord: adres gabinetu i kalendarz składają się z pary
  // wartości, więc łatka powstaje z całego bloku, nie z pojedynczego pola.
  if (type === 'gabinet' && ('city' in sent || 'address_line' in sent)) {
    out.push({ location: { city: str(sent.city, 80), address: str(sent.address_line, 200) } });
  }
  if (type === 'slots' && 'slot_hours' in sent) {
    const hours = list(sent.slot_hours).map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
    const days = Math.min(Math.max(Number(String(sent.slot_days ?? '14').replace(/\D/g, '')) || 14, 1), 60);
    out.push({ slots: { hours, days } });
  }
  return out;
}

/** Godzina lokalna terminu, jako napis - klucz do porównania z opcjami. */
function localHour(slot: PublicSlot): string {
  return String(Number(formatTime(slot.starts_at_utc, slot.timezone).split(':')[0]));
}
