/**
 * Fakty profilu, każdy opisany RAZ: jak go pokazać w zakładce „Dane i cennik” (`field`),
 * co tam wpisać na start (`read`) i co zapisać w bazie (`write`). Nowe pole = jeden wpis
 * w `FIELDS`; formularz (`admin-dane.ts`) i zapis (`profile-write.ts`) biorą je stąd.
 *
 * Listy powtarzalne (oferty, kwalifikacje) mają własną obsługę w zapisie, bo wiersz
 * odpowiada rekordowi albo pozycji JSON-a, a nie kolumnie.
 */
import type { PublicTherapist, SessionType, AgeGroup } from '../db/types';
import { sanitizeLine, sanitizeRichText } from '../lib/sanitize';

export interface Field {
  kind: 'text' | 'textarea' | 'select' | 'multiselect' | 'list' | 'hidden';
  name: string;
  label: string;
  hint?: string;
  max?: number;
  data?: boolean;
  item?: string;
  options?: Array<[string, string]>;
  of?: Field[];
}

/** Co zapis ma zrobić z wartością: kolumna profilu, tabela wiążąca, adres gabinetu, kalendarz. */
type Patch =
  | { column: string; value: string | number }
  | { relation: 'languages' | 'topics' | 'modalities'; values: string[] }
  | { location: { city: string; address: string } };

/** Listy zamknięte, które żyją w bazie (obszary, nurty). */
export type Dictionaries = Record<'topics' | 'modalities', Array<[string, string]>>;

interface DataField {
  field: Field;
  /** Opcje pola z bazy zamiast z kodu; formularz je wstawia. */
  optionsFrom?: keyof Dictionaries;
  /** Wartość, którą formularz pokazuje na start - to, co widzi katalog. */
  read(t: PublicTherapist): unknown;
  /** Co zapisać, gdy formularz przyśle tę wartość. Pusta lista = nic. */
  write(value: unknown): Patch[];
}

// ------------------------------------------------------------- słowniki ---

/** Ile kwalifikacji pokazuje formularz; zapis dokleja resztę z bazy (`profile-write.ts`). */
export const CREDENTIAL_ROWS = 6;

/**
 * Ile ofert mieści formularz cennika. Ta sama liczba w odczycie i w zapisie:
 * oferta, której formularz nie pokazał, nie może zniknąć przy zapisie.
 */
export const OFFER_ROWS = 12;

export const OFFER_TYPES: Array<[string, string]> = [['individual', 'indywidualna'], ['couples', 'para'], ['family', 'rodzina']];

/** Listy zamknięte są wspólne dla wszystkich terapeutek, więc siedzą w kodzie. */
const LANGUAGE_OPTIONS: Array<[string, string]> = [
  ['pl', 'polski'], ['en', 'angielski'], ['uk', 'ukraiński'], ['ru', 'rosyjski'],
  ['de', 'niemiecki'], ['fr', 'francuski'], ['es', 'hiszpański'], ['be', 'białoruski'],
];

const SESSION_TYPE_OPTIONS = Object.entries({
  individual: 'indywidualne', couples: 'dla par', family: 'rodzinne',
} satisfies Record<SessionType, string>);

const AGE_GROUP_OPTIONS = Object.entries({
  adults: 'dorośli', teens: 'młodzież', children: 'dzieci', seniors: 'seniorzy',
} satisfies Record<AgeGroup, string>);

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

/** Pola per grupa formularza. Klucz to nazwa grupy - ta sama w formularzu i w zapisie. */
export const FIELDS: Record<string, DataField[]> = {
  name: [col('display_name', 'Imię i nazwisko', (t) => t.display_name, { max: 120, required: true })],

  practice: [
    flag('offers_online', 'Sesje online', (t) => t.offers_online),
    flag('offers_in_person', 'Sesje w gabinecie', (t) => t.offers_in_person),
    flag('accepting_new_clients', 'Przyjmuje nowe osoby', (t) => t.accepting_new_clients),
    picks('session_types', 'Rodzaj sesji', SESSION_TYPE_OPTIONS, (t) => t.session_types as SessionType[], { column: 'session_types' }),
    picks('age_groups', 'Dla kogo', AGE_GROUP_OPTIONS, (t) => t.age_groups as AgeGroup[], { column: 'age_groups' }),
    picks('languages', 'Języki', LANGUAGE_OPTIONS, (t) => t.languages, 'languages'),
    number('cancellation_cutoff_h', 'Bezpłatne odwołanie (godziny przed sesją)', (t) => t.cancellation_cutoff_hours, [0, 168]),
    col('cancellation_policy', 'Zasady odwołania', (t) => t.cancellation_policy, { max: 500 }),
  ],

  topics: [
    picks('topics', 'Obszary pracy', 'topics', (t) => t.topics.map((x) => x.slug), 'topics'),
    picks('modalities', 'Nurty', 'modalities', (t) => t.modalities.map((x) => x.slug), 'modalities'),
  ],

  office: [
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

  // Kwalifikacje siedzą w kolumnie JSON, więc cała lista jest jedną wartością -
  // stąd `write` na miejscu. Znacznik weryfikacji i wpisy ponad limit formularza
  // dokleja `profile-write.ts` z tego, co już jest w bazie.
  credentials: [
    {
      field: {
        kind: 'list', name: 'credential_rows', label: 'Dyplomy i certyfikaty', item: 'Dyplom', max: CREDENTIAL_ROWS, data: true,
        hint: 'Wyczyszczona nazwa usuwa wpis. Weryfikacja zostaje po stronie administratora.',
        of: [
          { kind: 'text', name: 'title', label: 'Nazwa', max: 160 },
          { kind: 'text', name: 'issuer', label: 'Wydający', max: 160 },
          { kind: 'text', name: 'year', label: 'Rok', max: 4 },
        ],
      },
      read: (t) => t.credentials.slice(0, CREDENTIAL_ROWS).map((c) => ({
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
        }).filter((row) => row.title !== '').slice(0, CREDENTIAL_ROWS);
        return [{ column: 'credentials', value: JSON.stringify(items) }];
      },
    },
  ],

};

/** Co zapisać dla jednej grupy, z tego, co przysłał formularz. */
export function patchesFor(type: string, sent: Record<string, unknown>): Patch[] {
  const out = (FIELDS[type] ?? []).flatMap((f) => (f.field.name in sent ? f.write(sent[f.field.name]) : []));
  // Dwa pola, jeden rekord: adres gabinetu składa się z pary wartości,
  // więc łatka powstaje z całego bloku, nie z pojedynczego pola.
  if (type === 'office' && ('city' in sent || 'address_line' in sent)) {
    out.push({ location: { city: str(sent.city, 80), address: str(sent.address_line, 200) } });
  }
  return out;
}

