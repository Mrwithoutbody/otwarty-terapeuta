import { z } from 'zod';
import { isIsoDate, isValidTimezone } from '../lib/time';

/**
 * Input and output schemas for every MCP tool.
 *
 * Two rules run through all of them:
 *  - inputs are structured criteria only. There is no field anywhere that
 *    accepts a conversation transcript, a description of symptoms or a
 *    therapy history, because the server must never receive or store one;
 *  - every string has a length cap and every category is an enum, so a model
 *    cannot smuggle a payload through a "free text" field.
 */

export const SESSION_TYPE = z.enum(['individual', 'couples', 'family']);
export const SESSION_MODE = z.enum(['online', 'in_person']);
export const AGE_GROUP = z.enum(['adults', 'teens', 'children', 'seniors']);

const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'Dozwolone są małe litery, cyfry i myślniki.');

const languageCode = z
  .string()
  .length(2)
  .regex(/^[a-z]{2}$/, 'Kod języka w formacie ISO 639-1.');

const therapistId = z
  .string()
  .min(6)
  .max(64)
  .regex(/^th_[0-9a-f]{16,48}$/, 'Nieprawidłowy identyfikator terapeuty.');

const slotId = z
  .string()
  .min(6)
  .max(64)
  .regex(/^sl_[0-9a-f]{16,48}$/, 'Nieprawidłowy identyfikator terminu.');

const bookingId = z
  .string()
  .min(6)
  .max(64)
  .regex(/^bk_[0-9a-f]{16,48}$/, 'Nieprawidłowy identyfikator rezerwacji.');

const isoDate = z.string().refine(isIsoDate, 'Oczekiwano daty w formacie YYYY-MM-DD.');
const timezone = z
  .string()
  .max(64)
  .refine(isValidTimezone, 'Nieznana strefa czasowa IANA (np. Europe/Warsaw).');

const priceMinor = z.number().int().min(0).max(10_000_000);

// Kontrolowane słowniki. MUSZĄ być zgodne z tabelami `specialties` i `modalities`
// (migrations/0003_reference_data.sql i późniejsze). Wyliczenie zamiast odsyłacza do
// zasobu jest tym, co powstrzymuje model przed zmyślaniem slugów typu "anxiety".
const TOPIC_SLUG = z.enum([
  'lek', 'depresja', 'stres-zawodowy', 'relacje', 'zwiazki', 'rodzicielstwo',
  'zaloba', 'trauma', 'samoocena', 'zmiana-zyciowa', 'sen', 'uzaleznienia',
  'zaburzenia-odzywiania', 'lgbtq', 'migracja', 'neuroroznorodnosc', 'seksualnosc',
]);
const MODALITY_SLUG = z.enum([
  'poznawczo-behawioralna', 'psychodynamiczna', 'humanistyczna', 'systemowa',
  'schematu', 'act', 'emdr', 'integracyjna', 'gestalt', 'dbt',
]);

// ---------------------------------------------------------------- search ---

export const searchTherapistsInput = z.object({
  location: z
    .string()
    .max(80)
    .optional()
    .describe('Miejscowość dla spotkań stacjonarnych, np. "Warszawa". Pomiń przy sesjach online.'),
  online: z.boolean().optional().describe('true, jeżeli osoba szuka wyłącznie sesji online.'),
  in_person: z.boolean().optional().describe('true, jeżeli osoba szuka spotkań stacjonarnych.'),
  languages: z
    .array(languageCode)
    .max(5)
    .optional()
    .describe('Kody języków, w których ma być prowadzona sesja. Wszystkie muszą być spełnione.'),
  topics: z
    .array(TOPIC_SLUG)
    .max(8)
    .optional()
    .describe(
      'Obszary pracy — wyłącznie wartości z tej listy, po polsku. Dopasuj potrzebę użytkownika ' +
        'do najbliższego slugu (lęk → "lek", stres/wypalenie → "stres-zawodowy"). ' +
        'Nie przekazuj tu opisu objawów ani historii osoby.',
    ),
  modalities: z
    .array(MODALITY_SLUG)
    .max(6)
    .optional()
    .describe('Preferowane nurty pracy — wyłącznie wartości z tej listy.'),
  session_types: z.array(SESSION_TYPE).max(3).optional(),
  age_group: AGE_GROUP.optional().describe('Grupa wiekowa osoby, która ma korzystać z terapii.'),
  price_min: priceMinor
    .optional()
    .describe('Dolna granica ceny za sesję W GROSZACH, nie w złotych. 150 zł = 15000.'),
  price_max: priceMinor
    .optional()
    .describe('Górna granica ceny za sesję W GROSZACH, nie w złotych. 300 zł = 30000.'),
  available_from: isoDate.optional().describe('Najwcześniejsza akceptowalna data wizyty.'),
  accepting_new_clients: z.boolean().optional(),
  limit: z.number().int().min(1).max(10).default(5),
  cursor: z.string().max(200).optional().describe('Kursor z poprzedniej odpowiedzi.'),
});

const publicTherapistSummary = z.object({
  therapist_id: z.string(),
  slug: z.string(),
  display_name: z.string(),
  headline: z.string().nullable(),
  photo_url: z.string().nullable(),
  profile_url: z.string(),
  cities: z.array(z.string()),
  offers_online: z.boolean(),
  offers_in_person: z.boolean(),
  languages: z.array(z.string()),
  topics: z.array(z.string()),
  modalities: z.array(z.string()),
  session_types: z.array(z.string()),
  age_groups: z.array(z.string()),
  accepting_new_clients: z.boolean(),
  verification_status: z.string(),
  verified_at: z.string().nullable(),
  price_min_minor: z.number().nullable(),
  price_max_minor: z.number().nullable(),
  currency: z.string(),
  price_display: z.string(),
  next_available_slot_utc: z.string().nullable(),
  is_demo: z.boolean(),
  match_reasons: z.array(z.string()),
});

export const searchTherapistsOutput = z.object({
  results: z.array(publicTherapistSummary),
  total_matching: z.number().int(),
  next_cursor: z.string().nullable(),
  applied_filters: z.record(z.string(), z.unknown()),
  disclaimer: z.string(),
});

// --------------------------------------------------------------- profile ---

export const getTherapistProfileInput = z
  .object({
    therapist_id: therapistId.optional(),
    slug: slug.optional(),
  })
  .refine((v) => Boolean(v.therapist_id) !== Boolean(v.slug), {
    message: 'Podaj dokładnie jedno: therapist_id albo slug.',
  });

export const getTherapistProfileOutput = z.object({
  therapist: z.object({
    therapist_id: z.string(),
    slug: z.string(),
    display_name: z.string(),
    headline: z.string().nullable(),
    bio: z.string(),
    photo_url: z.string().nullable(),
    profile_url: z.string(),
    locations: z.array(
      z.object({
        city: z.string(),
        region: z.string().nullable(),
        country: z.string(),
        address_line: z.string().nullable(),
      }),
    ),
    offers_online: z.boolean(),
    offers_in_person: z.boolean(),
    languages: z.array(z.string()),
    topics: z.array(z.object({ slug: z.string(), name: z.string() })),
    modalities: z.array(z.object({ slug: z.string(), name: z.string() })),
    session_types: z.array(z.string()),
    age_groups: z.array(z.string()),
    accepting_new_clients: z.boolean(),
    credentials: z.array(
      z.object({
        title: z.string(),
        issuer: z.string(),
        year: z.number().nullable(),
        verified: z.boolean(),
      }),
    ),
    verification_status: z.string(),
    verified_at: z.string().nullable(),
    offers: z.array(
      z.object({
        offer_id: z.string(),
        title: z.string(),
        session_type: z.string(),
        mode: z.string(),
        duration_minutes: z.number(),
        price_minor: z.number(),
        currency: z.string(),
        price_display: z.string(),
      }),
    ),
    next_available_slot_utc: z.string().nullable(),
    timezone: z.string(),
    cancellation_policy: z.string(),
    cancellation_cutoff_hours: z.number(),
    is_demo: z.boolean(),
  }),
  data_source_note: z.string(),
});

// ------------------------------------------------------------------- FAQ ---

export const getTherapistFaqInput = z.object({
  therapist_id: therapistId,
  question: z
    .string()
    .max(300)
    .optional()
    .describe(
      'Opcjonalne pytanie użytkownika. Służy WYŁĄCZNIE do zawężenia listy zatwierdzonych ' +
        'odpowiedzi. Nie powoduje wygenerowania nowej odpowiedzi.',
    ),
});

export const getTherapistFaqOutput = z.object({
  therapist_id: z.string(),
  items: z.array(
    z.object({
      faq_id: z.string(),
      question: z.string(),
      answer: z.string(),
      category: z.string(),
      updated_at: z.string(),
      approved_at: z.string().nullable(),
      source: z.string(),
    }),
  ),
  no_approved_answer: z.boolean(),
  usage_note: z.string(),
});

// ----------------------------------------------------------------- slots ---

export const listAvailableSlotsInput = z.object({
  therapist_id: therapistId,
  from_date: isoDate.describe('Pierwszy dzień zakresu (YYYY-MM-DD).'),
  to_date: isoDate.describe('Ostatni dzień zakresu (YYYY-MM-DD), maksymalnie 60 dni od from_date.'),
  session_type: SESSION_TYPE.optional(),
  mode: SESSION_MODE.optional(),
  user_timezone: timezone.default('Europe/Warsaw'),
  limit: z.number().int().min(1).max(50).default(20),
});

export const listAvailableSlotsOutput = z.object({
  therapist_id: z.string(),
  therapist_name: z.string(),
  user_timezone: z.string(),
  slots: z.array(
    z.object({
      slot_id: z.string(),
      starts_at_utc: z.string(),
      ends_at_utc: z.string(),
      appointment_timezone: z.string(),
      local_start: z.string(),
      local_timezone_label: z.string(),
      duration_minutes: z.number(),
      session_type: z.string(),
      mode: z.string(),
      price_minor: z.number(),
      currency: z.string(),
      price_display: z.string(),
    }),
  ),
  /** After this moment availability must be re-checked before promising anything. */
  fresh_until_utc: z.string(),
  freshness_note: z.string(),
});

// --------------------------------------------------------------- booking ---

export const previewBookingInput = z.object({
  slot_id: slotId,
  user_timezone: timezone.default('Europe/Warsaw'),
});

const bookingSummarySchema = z.object({
  therapist_id: z.string(),
  therapist_name: z.string(),
  therapist_profile_url: z.string(),
  slot_id: z.string(),
  starts_at_utc: z.string(),
  ends_at_utc: z.string(),
  timezone: z.string(),
  local_start: z.string(),
  local_timezone_label: z.string(),
  duration_minutes: z.number(),
  session_type: z.string(),
  session_type_label: z.string(),
  mode: z.string(),
  mode_label: z.string(),
  price_minor: z.number(),
  currency: z.string(),
  price_display: z.string(),
  cancellation_policy: z.string(),
  cancellation_cutoff_hours: z.number(),
  terms_version: z.string(),
  privacy_version: z.string(),
  terms_url: z.string(),
  privacy_url: z.string(),
});

export const previewBookingOutput = z.object({
  summary: bookingSummarySchema,
  confirmation_token: z.string(),
  confirmation_token_expires_at: z.string(),
  confirmation_prompt: z.string(),
  next_step: z.string(),
});

export const createBookingInput = z.object({
  confirm: z
    .boolean()
    .describe(
      'Ustaw true WYŁĄCZNIE po tym, jak pokazałeś użytkownikowi pełne podsumowanie z preview_booking ' +
        'i użytkownik odpowiedział jednoznaczną zgodą ("tak, rezerwuję"). Nigdy nie ustawiaj tego pola ' +
        'we własnym imieniu ani w tej samej turze, w której wywołałeś preview_booking.',
    ),
  confirmation_token: z
    .string()
    .min(20)
    .max(2048)
    .describe('Token z preview_booking. Wywołaj create_booking dopiero po wyraźnym "tak" użytkownika.'),
  idempotency_key: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._~-]+$/, 'Dozwolone znaki: litery, cyfry, . _ ~ -')
    .describe('Unikalny klucz tej próby rezerwacji. Powtórzenie zwraca ten sam wynik.'),
  contact_name: z.string().max(120).optional(),
  contact_email: z.string().max(254).optional(),
  contact_phone: z.string().max(24).optional(),
  accepted_terms_version: z.string().max(32),
  accepted_privacy_version: z.string().max(32),
});

export const createBookingOutput = z.object({
  booking_id: z.string(),
  public_ref: z.string(),
  status: z.string(),
  summary: bookingSummarySchema,
  manage_url: z.string(),
  cancellation_policy: z.string(),
  replayed: z.boolean(),
  message: z.string(),
});

export const listMyBookingsInput = z.object({
  include_past: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(20),
});

export const listMyBookingsOutput = z.object({
  bookings: z.array(
    z.object({
      booking_id: z.string(),
      public_ref: z.string(),
      status: z.string(),
      therapist_name: z.string(),
      therapist_profile_url: z.string(),
      starts_at_utc: z.string(),
      timezone: z.string(),
      local_start: z.string(),
      session_type_label: z.string(),
      mode_label: z.string(),
      price_display: z.string(),
      can_cancel_free_until_utc: z.string().nullable(),
    }),
  ),
  count: z.number().int(),
});

export const cancelBookingInput = z.object({
  booking_id: bookingId,
  confirm: z
    .literal(true)
    .describe('Musi być true i może zostać ustawione dopiero po wyraźnym potwierdzeniu użytkownika.'),
  reason_code: z
    .enum(['schedule_conflict', 'no_longer_needed', 'found_other_help', 'other'])
    .optional()
    .describe('Opcjonalny powód z zamkniętej listy. Nie przekazuj tu opisu sytuacji osoby.'),
});

export const cancelBookingOutput = z.object({
  booking_id: z.string(),
  public_ref: z.string(),
  status: z.string(),
  cancelled_at: z.string(),
  within_free_cancellation_window: z.boolean(),
  already_cancelled: z.boolean(),
  message: z.string(),
});

// ------------------------------------------------------------ crisis info ---

export const crisisResourcesInput = z.object({
  country: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/)
    .default('PL')
    .describe('Kod kraju ISO 3166-1 alpha-2. Obecnie utrzymywane dane: PL.'),
  audience: z
    .enum(['adult', 'minor'])
    .default('adult')
    .describe('adult dla osób pełnoletnich, minor dla osób poniżej 18 roku życia.'),
});

export const crisisResourcesOutput = z.object({
  country: z.string(),
  audience: z.string(),
  resources: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      phone: z.string().nullable(),
      url: z.string().nullable(),
      hours: z.string().nullable(),
      source_url: z.string(),
      verified_at: z.string(),
      version: z.string(),
    }),
  ),
  important_note: z.string(),
});

// ------------------------------------------------------------------ widget ---

export const renderWidgetInput = z.object({
  view: z
    .enum(['therapist_list', 'therapist_profile', 'faq', 'slots', 'booking_summary', 'booking_confirmed', 'my_bookings'])
    .describe('Widok do wyrenderowania.'),
  payload: z
    .unknown()
    .describe(
      'structuredContent zwrócony przez poprzedzające narzędzie danych. ' +
        'Nie twórz tych danych samodzielnie i nie modyfikuj ich.',
    ),
  title: z.string().max(120).optional(),
});

export const renderWidgetOutput = z.object({
  view: z.string(),
  title: z.string(),
  /** The untouched payload from the preceding data tool. The widget renders it. */
  data: z.unknown(),
  generated_at: z.string(),
  item_count: z.number().int(),
});

