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
import type { PublicTherapist, SessionType, AgeGroup } from '../db/types';
import { sanitizeLine, sanitizeRichText } from '../lib/sanitize';

export interface Field {
  kind: 'text' | 'textarea' | 'url' | 'select' | 'multiselect' | 'list' | 'media' | 'hidden';
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

/** Co zapis ma zrobić z wartością: kolumna profilu albo tabela wiążąca. */
export type Patch =
  | { column: string; value: string | number }
  | { relation: 'languages' | 'topics' | 'modalities'; values: string[] };

export interface DataField {
  field: Field;
  /** Wartość dla formularza i podglądu, z tego, co widzi katalog. */
  read(t: PublicTherapist): unknown;
  /** Co zapisać, gdy formularz przyśle tę wartość. Pusta lista = nic. */
  write(value: unknown): Patch[];
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
  options: Array<[string, string]>,
  read: (t: PublicTherapist) => string[],
  target: 'languages' | 'topics' | 'modalities' | { column: string },
  hint?: string,
): DataField {
  return {
    field: { kind: 'multiselect', name, label, hint, options, data: true },
    read,
    write: (value) => {
      const allowed = new Set(options.map(([v]) => v));
      const picked = list(value).filter((v) => allowed.has(v));
      return typeof target === 'string'
        ? [{ relation: target, values: picked }]
        : [{ column: target.column, value: JSON.stringify(picked) }];
    },
  };
}

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
        hint: 'Adres z galerii w panelu (zakładka Dane). Puste = rysunek zastępczy.' },
      read: (t) => t.photo_url ?? '',
      write: (value) => {
        const raw = typeof value === 'object' && value !== null ? String((value as { url?: unknown }).url ?? '') : String(value ?? '');
        return [{ column: 'photo_url', value: str(raw, 500) }];
      },
    },
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

/** Pola danych bloku jako deklaracje dla usługi. */
export const fieldsOf = (type: string): Field[] => (FIELDS[type] ?? []).map((f) => f.field);

/** Wartości pól danych bloku - to, co zobaczy formularz w edytorze. */
export function valuesOf(type: string, t: PublicTherapist): Record<string, unknown> {
  return Object.fromEntries((FIELDS[type] ?? []).map((f) => [f.field.name, f.read(t)]));
}

/** Co zapisać dla jednego bloku, z tego, co przysłał edytor. */
export function patchesFor(type: string, sent: Record<string, unknown>): Patch[] {
  return (FIELDS[type] ?? []).flatMap((f) => (f.field.name in sent ? f.write(sent[f.field.name]) : []));
}
