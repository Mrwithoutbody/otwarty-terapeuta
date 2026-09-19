import { Hono } from 'hono';
import type { Env } from '../env';
import { getTherapistRowForAdmin } from '../db/catalog';
import { cleanHours, closeSlots, dayKey, emptyWeek, fillFromSchedules, listTimeOff, localSlot, parseDay, parseWeek, saveSchedules, SCHEDULE_HOURS, WEEKDAYS, weekJson, type TimeOff } from '../db/slots';
import { viewsByTherapist } from '../db/views';
import type { TherapistRow } from '../db/types';
import { eraseUserData, exportUserData, findOrCreateUserByEmail, type UserRow } from '../db/users';
import {
  createAdminSession,
  destroyAdminSession,
  loadAdminSession,
  ownsTherapist,
  verifyCsrf,
  type AdminSession,
} from '../auth/session';
import { consumeEmailCode, issueEmailCode, verifyEmailCode } from '../auth/challenge';
import { audit } from '../lib/audit';
import { decryptPii, emailLookupHash, randomId } from '../lib/crypto';
import { escapeHtml, isEmail, normalizeForSearch, sanitizeLine, sanitizeRichText } from '../lib/sanitize';
import { addCivilDays, civilDateIn, DEFAULT_TIMEZONE, formatDateTime, formatPrice, isIsoDate, isoOf, isValidTimezone, nowIso, weekdayOf, zonedTimeToUtc, type CivilDate } from '../lib/time';
import { verifyTurnstile } from '../lib/turnstile';
import { drainOutbox, enqueueNotification } from '../notify/outbox';
import { formValues, htmlResponse, renderPage } from './layout';
import { editorUrl, ensureProfilePage, PagesUnavailable, PROFILE_SLUG } from './lp';
import { createPage, getPage, listPages, listThemeChoices, pagesOrigin, slugOf, type PageInfo, type ThemeChoice } from './pages-client';
import { getTherapist } from '../db/catalog';
import { profileContext } from './pages';
import type { SectionCtx } from './host-blocks';
import { AGE_GROUP_OPTIONS, SESSION_TYPE_OPTIONS } from './data-fields';

/**
 * Admin panel. Server-rendered, CSRF-protected, least privilege:
 *
 *  - `admin`     - everything;
 *  - `therapist` - only their own profile, FAQ, offer and availability;
 *  - `support`   - bookings (minimal fields) and cancellation only. Support
 *                  never sees verification notes or contact details.
 */

export const adminApp = new Hono<{ Bindings: Env }>();


function page(env: Env, title: string, body: string, status = 200, turnstile = false): Response {
  return htmlResponse(
    env,
    renderPage(env, { title, path: '/admin', noindex: true, body, adminAssets: true }),
    { status },
    turnstile,
  );
}

function csrfField(session: AdminSession): string {
  return `<input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}">`;
}

/**
 * Ekran panelu: sesja i rola. Trasy GET niczego nie zmieniają, więc CSRF ich
 * nie dotyczy - dla nich to cała bramka. `roles` puste = każda rola panelu.
 */
async function screen(
  c: { env: Env; req: { raw: Request } },
  roles?: Array<UserRow['role']>,
): Promise<{ session: AdminSession } | { response: Response }> {
  const session = await loadAdminSession(c.env, c.req.raw);
  if (!session) return { response: page(c.env, 'Zaloguj się', loginForm(c.env), 401, true) };
  if (roles && !roles.includes(session.user.role)) {
    return { response: page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403) };
  }
  return { session };
}

/** Every mutating admin route starts here: session + CSRF + role. */
async function guard(
  c: { env: Env; req: { raw: Request } },
  body: URLSearchParams,
  roles: Array<UserRow['role']>,
): Promise<{ session: AdminSession } | { response: Response }> {
  const session = await loadAdminSession(c.env, c.req.raw);
  if (!session) return { response: page(c.env, 'Zaloguj się', loginForm(c.env), 401, true) };
  if (!(await verifyCsrf(c.env, c.req.raw, body.get('csrf') ?? ''))) {
    return { response: page(c.env, 'Błąd', '<h1>Nieprawidłowy token formularza</h1><p>Odśwież stronę i spróbuj ponownie.</p>', 403) };
  }
  if (!roles.includes(session.user.role)) {
    return { response: page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1><p>Twoja rola nie pozwala na tę operację.</p>', 403) };
  }
  return { session };
}

// ------------------------------------------------------------------ login ---

function loginForm(env: Env, error?: string): string {
  return `
<h1>Panel administracyjny</h1>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/admin/login">
  <div class="field">
    <label for="email">Adres e-mail</label>
    <input id="email" name="email" type="email" autocomplete="email" required maxlength="254">
    <p class="hint">Wyślemy jednorazowy kod. Panel nie używa haseł. Wiadomość może czasem dotrzeć z opóźnieniem — sprawdź też folder Spam.</p>
  </div>
  <div class="cf-turnstile" data-sitekey="${escapeHtml(env.TURNSTILE_SITE_KEY)}" data-theme="auto"></div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <p><button class="btn" type="submit">Wyślij kod</button></p>
</form>`;
}

function codeForm(challengeId: string, error?: string): string {
  return `
<h1>Wpisz kod</h1>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/admin/login/confirm">
  <input type="hidden" name="challenge_id" value="${escapeHtml(challengeId)}">
  <div class="field">
    <label for="code">Kod jednorazowy</label>
    <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" required maxlength="6"
           autocomplete="one-time-code">
  </div>
  <p><button class="btn" type="submit">Zaloguj</button></p>
</form>`;
}

adminApp.post('/login', async (c) => {
  const body = await formValues(c.req.raw);
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  if (!(await c.env.RL_AUTH.limit({ key: `admin-login:${ip}` })).success) {
    return page(c.env, 'Zaloguj się', loginForm(c.env, 'Zbyt wiele prób. Spróbuj za minutę.'), 429, true);
  }

  const email = (body.get('email') ?? '').trim().toLowerCase();
  if (!isEmail(email)) return page(c.env, 'Zaloguj się', loginForm(c.env, 'Podaj poprawny adres e-mail.'), 400, true);
  if (!(await verifyTurnstile(c.env, body.get('cf-turnstile-response'), ip))) {
    return page(c.env, 'Zaloguj się', loginForm(c.env, 'Weryfikacja antyspamowa nie powiodła się.'), 400, true);
  }

  const emailHash = await emailLookupHash(c.env.TOKEN_SIGNING_KEY, email);

  // Only an existing account may receive a panel code. The response is
  // identical either way, so the form cannot be used to enumerate staff.
  const existing = await c.env.DB.prepare(
    `SELECT id, role FROM users WHERE email_hash = ? AND deleted_at IS NULL`,
  )
    .bind(emailHash)
    .first<{ id: string; role: string }>();

  const bootstrap = (c.env.ADMIN_BOOTSTRAP_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email);

  // A challenge id is minted either way so the code form looks identical to a
  // stranger; only a real staff account gets a row and an e-mail.
  let challengeId = randomId('lc');
  if ((existing && existing.role !== 'user') || bootstrap) {
    const issued = await issueEmailCode(c.env, 'admin', email);
    challengeId = issued.challengeId;
    await enqueueNotification(c.env, 'admin.login_code', null, {
      to: email,
      subject: 'Kod logowania do panelu — Otwarty Terapeuta',
      text: `Kod logowania do panelu: ${issued.code}\nKod jest ważny 15 minut.`,
    });
    c.executionCtx.waitUntil(drainOutbox(c.env, 5));
  }

  return page(c.env, 'Wpisz kod', codeForm(challengeId));
});

adminApp.post('/login/confirm', async (c) => {
  const body = await formValues(c.req.raw);
  const challengeId = body.get('challenge_id') ?? '';
  const submitted = (body.get('code') ?? '').trim();

  const fail = (message: string): Response => page(c.env, 'Wpisz kod', codeForm(challengeId, message), 400);
  const verdict = await verifyEmailCode(c.env, 'admin', challengeId, submitted);
  if (!verdict.ok) {
    return fail(
      verdict.reason === 'expired'
        ? 'Kod wygasł.'
        : verdict.reason === 'attempts'
          ? 'Przekroczono liczbę prób.'
          : verdict.reason === 'unknown'
            ? 'Kod jest nieprawidłowy lub został użyty.'
            : 'Kod jest nieprawidłowy.',
    );
  }

  const user = await findOrCreateUserByEmail(c.env, verdict.email);
  if (user.role === 'user') {
    return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1><p>To konto nie ma dostępu do panelu.</p>', 403);
  }

  await consumeEmailCode(c.env, challengeId).run();
  const { cookie } = await createAdminSession(c.env, user.id);
  await audit(c.env, {
    actorType: user.role === 'admin' ? 'admin' : user.role === 'support' ? 'support' : 'therapist',
    actorId: user.id,
    action: 'admin.login',
    subjectType: 'user',
    subjectId: user.id,
    meta: { role: user.role },
  });

  return new Response(null, { status: 302, headers: { location: '/admin', 'set-cookie': cookie } });
});

adminApp.post('/logout', async (c) => {
  const cookie = await destroyAdminSession(c.env, c.req.raw);
  return new Response(null, { status: 302, headers: { location: '/admin', 'set-cookie': cookie } });
});

// -------------------------------------------------------------- dashboard ---

adminApp.get('/', async (c) => {
  const session = await loadAdminSession(c.env, c.req.raw);
  if (!session) return page(c.env, 'Zaloguj się', loginForm(c.env), 200, true);
  const { user } = session;

  const scopeClause = user.role === 'therapist' ? `WHERE id = ?` : '';
  const therapistsQuery = c.env.DB.prepare(
    `SELECT id, slug, display_name, status, verification_status, is_demo, accepting_new_clients
       FROM therapists ${scopeClause} ${scopeClause ? '' : 'WHERE deleted_at IS NULL'} ORDER BY display_name`,
  );
  const therapists = await (user.role === 'therapist'
    ? therapistsQuery.bind(user.therapist_id ?? '')
    : therapistsQuery
  ).all<{
    id: string;
    slug: string;
    display_name: string;
    status: string;
    verification_status: string;
    is_demo: number;
    accepting_new_clients: number;
  }>();

  // Odsłony profili z ostatnich 30 dni, jednym zapytaniem dla całej listy -
  // nie po jednym na wiersz. Agregat dobowy, bez identyfikatora osoby: to
  // odpowiedź na „ile razy oglądano", nie na „kto oglądał".
  const views = await viewsByTherapist(c.env);

  const upcoming = await c.env.DB.prepare(
    `SELECT b.id, b.public_ref, b.status, b.starts_at_utc, b.timezone, b.price_minor, b.currency,
            b.contact_name_enc, b.contact_email_enc, b.contact_phone_enc,
            t.display_name
       FROM bookings b JOIN therapists t ON t.id = b.therapist_id
      ${user.role === 'therapist' ? 'WHERE b.therapist_id = ?' : ''}
      ORDER BY b.starts_at_utc DESC LIMIT 25`,
  )
    .bind(...(user.role === 'therapist' ? [user.therapist_id ?? ''] : []))
    .all<{
      id: string;
      public_ref: string;
      status: string;
      starts_at_utc: string;
      timezone: string;
      price_minor: number;
      currency: string;
      contact_name_enc: string | null;
      contact_email_enc: string | null;
      contact_phone_enc: string | null;
      display_name: string;
    }>();

  /**
   * Dane kontaktowe osoby rezerwującej. Terapeutka musi wiedzieć, kto przyjdzie;
   * odszyfrowujemy je dopiero tutaj, na potrzeby jednego widoku, i tylko dla
   * rezerwacji, które ten widok i tak pokazuje. Po 12 miesiącach retencja zeruje
   * te kolumny i wiersz sam przestaje mieć co pokazać.
   */
  const contacts = new Map<string, string>();
  for (const b of upcoming.results) {
    const parts = await Promise.all(
      [b.contact_name_enc, b.contact_email_enc, b.contact_phone_enc].map((value) =>
        value ? decryptPii(c.env.PII_ENC_KEY, value) : Promise.resolve(null),
      ),
    );
    const shown = parts.filter((part): part is string => part !== null && part !== '');
    if (shown.length > 0) contacts.set(b.id, shown.join(' · '));
  }

  const pendingProfiles = therapists.results.filter(
    (t) => t.status === 'draft' && t.verification_status === 'unverified' && !t.is_demo,
  ).length;

  return page(
    c.env,
    'Panel',
    `
<h1>Panel administracyjny</h1>
<p class="meta">Zalogowano jako <strong>${escapeHtml(user.role)}</strong>.
<form method="post" action="/admin/logout" class="inline-form">${csrfField(session)}
<button class="btn secondary" type="submit">Wyloguj</button></form></p>

${
  user.role === 'admin' && pendingProfiles > 0
    ? `<div class="notice"><p><strong>Nowe zgłoszenia:</strong> ${pendingProfiles}. Profile są robocze i niezweryfikowane; przejrzyj je przed publikacją.</p></div>`
    : ''
}

<h2>Profile terapeutów</h2>
<div class="table-scroll">
<table>
  <thead><tr><th scope="col">Nazwa</th><th scope="col">Status</th><th scope="col">Weryfikacja</th>
  <th scope="col">Nowe osoby</th><th scope="col">Odsłony (30 dni)</th>
  <th scope="col">Akcje</th></tr></thead>
  <tbody>
  ${therapists.results
    .map(
      (t) => `<tr>
      <td>${escapeHtml(t.display_name)}${t.is_demo ? ' <span class="tag demo">DEMO</span>' : ''}</td>
      <td>${escapeHtml(t.status)}</td>
      <td>${escapeHtml(t.verification_status)}</td>
      <td>${t.accepting_new_clients ? 'tak' : 'nie'}</td>
      <td>${((entry) =>
        entry === undefined
          ? '—'
          : `<strong>${entry.web + entry.mcp}</strong> <span class="meta">(strona ${entry.web} · ChatGPT ${entry.mcp})</span>`)(
        views.get(t.id),
      )}</td>
      <td><a href="/admin/terapeuci/${escapeHtml(t.id)}">Edytuj</a></td>
    </tr>`,
    )
    .join('')}
  </tbody>
</table>
</div>
${user.role === 'admin' ? `<p><a class="btn" href="/admin/terapeuci/nowy">Dodaj profil</a></p>` : ''}

<h2>Rezerwacje</h2>
<div class="table-scroll">
<table>
  <thead><tr><th scope="col">Numer</th><th scope="col">Terapeuta</th><th scope="col">Termin</th>
  <th scope="col">Cena</th><th scope="col">Kontakt</th><th scope="col">Status</th>
  <th scope="col">Akcje</th></tr></thead>
  <tbody>
  ${upcoming.results
    .map(
      (b) => `<tr>
      <td>${escapeHtml(b.public_ref)}</td>
      <td>${escapeHtml(b.display_name)}</td>
      <td>${escapeHtml(formatDateTime(b.starts_at_utc, b.timezone))}</td>
      <td>${escapeHtml(formatPrice(b.price_minor, b.currency))}</td>
      <td>${contacts.has(b.id) ? escapeHtml(contacts.get(b.id) ?? '') : '—'}</td>
      <td>${b.status === 'cancelled' ? 'odwołana' : 'potwierdzona'}</td>
      <td>${
        b.status === 'confirmed'
          ? `<form method="post" action="/admin/rezerwacje/${escapeHtml(b.id)}/anuluj">
               ${csrfField(session)}
               <label class="visually-hidden" for="r-${escapeHtml(b.id)}">Powód odwołania</label>
               <input id="r-${escapeHtml(b.id)}" name="reason" required maxlength="120" placeholder="powód (audyt)">
               <button class="btn secondary" type="submit">Odwołaj</button>
             </form>`
          : '—'
      }</td>
    </tr>`,
    )
    .join('')}
  </tbody>
</table>
</div>
<p class="hint">Dane kontaktowe służą wyłącznie do kontaktu w sprawie tej wizyty. W bazie są
zaszyfrowane, a po 12 miesiącach od terminu usuwa je zadanie retencyjne.</p>

${
  user.role === 'admin'
    ? `<h2>Administracja</h2>
<ul>
  <li><a href="/admin/kryzys">Zasoby kryzysowe i data weryfikacji</a></li>
  <li><a href="/admin/uzytkownicy">Eksport i usunięcie danych użytkownika</a></li>
  <li><a href="/admin/audyt">Historia operacji</a></li>
</ul>`
    : ''
}`,
  );
});

// -------------------------------------------------------- therapist editor ---

interface RefTag {
  slug: string;
  name_pl: string;
}

interface OfferRow {
  id: string;
  title: string;
  session_type: string;
  mode: string;
  duration_minutes: number;
  price_minor: number;
  currency: string;
  active: number;
  schedule: string;
}

interface WeekSlot {
  id: string;
  offer_id: string;
  starts_at_utc: string;
  status: 'open' | 'booked' | 'blocked';
  title: string;
}

interface FaqRow {
  id: string;
  question: string;
  status: string;
  position: number;
  updated_at: string;
}

interface EditorContext {
  languages: RefTag[];
  specialties: RefTag[];
  modalities: RefTag[];
  chosenLanguages: Set<string>;
  chosenTopics: Set<string>;
  chosenModalities: Set<string>;
  city: string;
  addressLine: string;
  credentials: CredentialInput[];
  offers: OfferRow[];
  faq: FaqRow[];
  media: Array<{ id: string; url: string }>;
  pages: PageInfo[];
  looks: ThemeChoice[];
  /** Why there is no page list: the service is down, or the profile is not saved yet. */
  pagesError: string | null;
  /** Origin of the hosted editor, for the dialog's postMessage check. */
  editorOrigin: string;
  /** Tydzień w kalendarzu zakładki „Dostępność": poniedziałek i terminy od niego. */
  monday: CivilDate;
  weekSlots: WeekSlot[];
  timeOff: Array<TimeOff & { id: string; booked: number }>;
}

const refTags = (options: Array<[string, string]>): RefTag[] => options.map(([slug, name_pl]) => ({ slug, name_pl }));

const PAGES_DOWN = 'Edytor stron jest chwilowo niedostępny. Twoje dane i strona publiczna działają; spróbuj za chwilę.';

/** Her data as the editor's preview needs it; null before the profile is published. */
async function previewContext(env: Env, therapistId: string): Promise<SectionCtx | null> {
  // Szkic też: bez tego edytor nieopublikowanego profilu dostaje pustą treść
  // i pokazuje stronę bez ani jednego bloku.
  const t = await getTherapist(env, { therapist_id: therapistId }, { drafts: true });
  return t ? profileContext(env, t) : null;
}

/** Poniedziałek tygodnia, w którym leży `key` (albo dziś), w kalendarzu terapeutki. */
function mondayOf(timezone: string, key?: string): CivilDate {
  const day = key && isIsoDate(key) ? parseDay(key) : civilDateIn(timezone, new Date());
  return addCivilDays(day, -((weekdayOf(day) + 6) % 7));
}

/** Granice lokalnych dni jako instanty UTC: od północy `from` do północy po `to`. */
function localRange(timezone: string, from: CivilDate, to: CivilDate): [string, string] {
  return [isoOf(zonedTimeToUtc(from, 0, 0, timezone)), isoOf(zonedTimeToUtc(addCivilDays(to, 1), 0, 0, timezone))];
}

async function loadEditorContext(env: Env, therapist: TherapistRow | null, week?: string): Promise<EditorContext> {
  const [languages, specialties, modalities] = await Promise.all([
    env.DB.prepare(`SELECT code AS slug, name_pl FROM languages ORDER BY name_pl`).all<RefTag>(),
    env.DB.prepare(`SELECT slug, name_pl FROM specialties ORDER BY category, name_pl`).all<RefTag>(),
    env.DB.prepare(`SELECT slug, name_pl FROM modalities ORDER BY name_pl`).all<RefTag>(),
  ]);

  const context: EditorContext = {
    languages: languages.results,
    specialties: specialties.results,
    modalities: modalities.results,
    chosenLanguages: new Set(),
    chosenTopics: new Set(),
    chosenModalities: new Set(),
    city: '',
    addressLine: '',
    credentials: [],
    offers: [],
    faq: [],
    media: [],
    pages: [],
    looks: [],
    pagesError: 'Najpierw zapisz profil.',
    editorOrigin: pagesOrigin(env) ?? '',
    monday: mondayOf(DEFAULT_TIMEZONE),
    weekSlots: [],
    timeOff: [],
  };
  if (!therapist) return context;
  try {
    const [profile, pages, looks] = await Promise.all([
      ensureProfilePage(env, therapist.id, therapist.display_name),
      listPages(env, therapist.id),
      listThemeChoices(env),
    ]);
    context.pages = [profile, ...pages.filter((p) => p.slug !== PROFILE_SLUG)];
    context.looks = looks;
    context.pagesError = null;
  } catch (err) {
    if (!(err instanceof PagesUnavailable)) throw err;
    context.pagesError = PAGES_DOWN;
  }

  const [chosenLanguages, chosenTopics, chosenModalities, location, offers, faq, media] = await Promise.all([
    env.DB.prepare(`SELECT language_code FROM therapist_languages WHERE therapist_id = ?`)
      .bind(therapist.id)
      .all<{ language_code: string }>(),
    env.DB.prepare(`SELECT specialty_slug FROM therapist_specialties WHERE therapist_id = ?`)
      .bind(therapist.id)
      .all<{ specialty_slug: string }>(),
    env.DB.prepare(`SELECT modality_slug FROM therapist_modalities WHERE therapist_id = ?`)
      .bind(therapist.id)
      .all<{ modality_slug: string }>(),
    env.DB.prepare(
      `SELECT city, address_line FROM therapist_locations WHERE therapist_id = ?
        ORDER BY is_primary DESC LIMIT 1`,
    )
      .bind(therapist.id)
      .first<{ city: string; address_line: string | null }>(),
    env.DB.prepare(
      `SELECT id, title, session_type, mode, duration_minutes, price_minor, currency, active, schedule
         FROM session_offers WHERE therapist_id = ? ORDER BY created_at`,
    )
      .bind(therapist.id)
      .all<OfferRow>(),
    env.DB.prepare(
      `SELECT id, question, status, position, updated_at FROM faq_items
        WHERE therapist_id = ? ORDER BY position`,
    )
      .bind(therapist.id)
      .all<FaqRow>(),
    env.DB.prepare(
      `SELECT id, url FROM therapist_media WHERE therapist_id = ? ORDER BY created_at DESC`,
    )
      .bind(therapist.id)
      .all<{ id: string; url: string }>(),
  ]);

  context.chosenLanguages = new Set(chosenLanguages.results.map((row) => row.language_code));
  context.chosenTopics = new Set(chosenTopics.results.map((row) => row.specialty_slug));
  context.chosenModalities = new Set(chosenModalities.results.map((row) => row.modality_slug));
  context.city = location?.city ?? '';
  context.addressLine = location?.address_line ?? '';
  context.offers = offers.results;
  context.faq = faq.results;
  context.media = media.results;

  const timezone = therapist.timezone || DEFAULT_TIMEZONE;
  context.monday = mondayOf(timezone, week);
  const [from, to] = localRange(timezone, context.monday, addCivilDays(context.monday, 6));
  const [weekSlots, timeOff] = await Promise.all([
    env.DB.prepare(
      `SELECT s.id, s.offer_id, s.starts_at_utc, s.status, o.title
         FROM appointment_slots s JOIN session_offers o ON o.id = s.offer_id
        WHERE s.therapist_id = ? AND s.starts_at_utc >= ? AND s.starts_at_utc < ? ORDER BY s.starts_at_utc`,
    )
      .bind(therapist.id, from, to)
      .all<WeekSlot>(),
    listTimeOff(env, therapist.id),
  ]);
  context.weekSlots = weekSlots.results;
  // Rezerwacje w czasie urlopu zostają - lista mówi, ile ich jest do odwołania.
  context.timeOff = await Promise.all(
    timeOff.map(async (off) => {
      const [a, b] = localRange(timezone, parseDay(off.starts_on), parseDay(off.ends_on));
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM appointment_slots WHERE therapist_id = ? AND status = 'booked' AND starts_at_utc >= ? AND starts_at_utc < ?`,
      )
        .bind(therapist.id, a, b)
        .first<{ n: number }>();
      return { ...off, booked: row?.n ?? 0 };
    }),
  );
  return context;
}

/**
 * The section builder.
 *
 * The therapist arranges her profile out of sections: some render data she
 * keeps elsewhere in the panel (her offer, her calendar, her FAQ), some carry
 * text she writes here. Every form field on this screen is generated from
 * `SECTIONS_DEF`, so a new section type or field is added there and shows up
 * here without touching this file.
 *
 * It works with JavaScript switched off. Adding a section is a submit button:
 * the profile saves and comes back with the new section appended. Order is
 * carried by numeric position inputs; the drag-and-drop in `admin.js` only
 * rewrites those numbers, so both paths post the same thing.
 */



function checkboxGrid(name: string, options: RefTag[], chosen: Set<string>): string {
  return `<div class="choice-grid">${options
    .map((option) => {
      const id = `${name}-${option.slug}`;
      return `<div class="checkbox">
        <input id="${escapeHtml(id)}" type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(option.slug)}"${
          chosen.has(option.slug) ? ' checked' : ''
        }>
        <label for="${escapeHtml(id)}">${escapeHtml(option.name_pl)}</label>
      </div>`;
    })
    .join('')}</div>`;
}

const DAY_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
const hh = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;
const shortDate = (d: CivilDate): string => `${d.day}.${String(d.month).padStart(2, '0')}`;

/** Kolor oferty w grafiku i w kalendarzu: cztery tokeny serwisu po kolei, numer rozróżnia resztę. */
const offerColor = (index: number): number => index % 4;
const modeShort = (mode: string): string => (mode === 'online' ? 'online' : 'gabinet');

/**
 * Jeden widok dostępności: tydzień z datami, a w kratce wszystko naraz.
 * Oferta (pędzel) to grafik - powtarza się co tydzień; kłódka i rezerwacja
 * dotyczą terminu z tej konkretnej daty. Pod spodem zwykłe pola: każda oferta
 * ma swoje na kratkę (`g_<oferta>` = "dzień-godzina"), termin ma `lock` =
 * jego id, więc bez JavaScriptu kratka to kilka małych pól; ze skryptem jedna
 * kratka malowana wybranym narzędziem.
 *
 * Elementy idą dzień po dniu, a kierunek ustawia CSS: na szerokim panelu
 * godziny w poziomie, na telefonie ta sama siatka wypełniana kolumnami.
 * Nagłówki są przyciskami superkliku (wiersz, kolumna, całość).
 */
function availabilityGrid(row: TherapistRow, context: EditorContext, offers: OfferRow[]): string {
  const timezone = row.timezone || DEFAULT_TIMEZONE;
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addCivilDays(context.monday, i));
  const now = nowIso();
  const weeks = offers.map((offer) => parseWeek(offer.schedule));
  const multi = offers.length > 1;
  const at = new Map(
    context.weekSlots.map((s) => {
      const day = dayKey(civilDateIn(timezone, new Date(s.starts_at_utc)));
      return [`${days.findIndex((d) => dayKey(d) === day)}-${localSlot(s.starts_at_utc, timezone).hour}`, s];
    }),
  );

  const cell = (r: number, hour: number): string => {
    const [day, label] = WEEKDAYS[r]!;
    const slot = at.get(`${r}-${hour}`);
    const scheduled = weeks.findIndex((week) => week[day]!.includes(hour));
    // Termin spoza grafiku (np. sprzed jego zmiany) też ma kolor swojej oferty.
    const owner = scheduled >= 0 ? scheduled : slot ? offers.findIndex((o) => o.id === slot.offer_id) : -1;
    const boxes = offers
      .map((offer, i) => {
        const oid = escapeHtml(offer.id);
        const id = `g-${oid}-${day}-${hour}`;
        return `<input type="checkbox" id="${id}" name="g_${oid}" value="${day}-${hour}" data-o="${i}"${
          weeks[i]![day]!.includes(hour) ? ' checked' : ''
        }><label for="${id}" data-c="${offerColor(i)}"><span class="visually-hidden">${label} ${hh(hour)}${
          multi ? `, ${escapeHtml(offer.title)}` : ''
        }</span>${multi ? i + 1 : ''}</label>`;
      })
      .join('');
    // Kłódka tylko tam, gdzie jest co zamknąć: przyszły termin, wolny albo zablokowany.
    const lockable = slot && slot.status !== 'booked' && slot.starts_at_utc > now;
    const sid = slot ? escapeHtml(slot.id) : '';
    const lock = lockable
      ? `<input type="hidden" name="slot" value="${sid}"><input type="checkbox" id="l-${sid}" name="lock" value="${sid}" data-lock${
          slot.status === 'blocked' ? ' checked' : ''
        }><label for="l-${sid}" class="lock"><span class="visually-hidden">${label} ${shortDate(days[r]!)} ${hh(hour)}, blokada</span><span class="ico-lock" aria-hidden="true"></span></label>`
      : '';
    const booked = slot?.status === 'booked';
    const locked = !booked && slot?.status === 'blocked';
    const mark = booked ? '•' : locked ? '' : multi && owner >= 0 ? String(owner + 1) : '';
    return `<div class="cell${dayKey(days[r]!) < now.slice(0, 10) ? ' is-past' : ''}" data-cell data-r="${r}" data-h="${hour}"${booked ? ' data-booked' : ''}>${boxes}${lock}<span class="face${locked ? ' is-locked' : ''}" aria-hidden="true"${
      owner >= 0 ? ` data-c="${offerColor(owner)}"` : ''
    }${booked ? ` title="Rezerwacja — ${escapeHtml(slot.title)}"` : ''}>${mark}</span></div>`;
  };

  return `<div class="week-wrap"><div class="week-grid" data-schedule-grid${multi ? ' data-multi' : ''} role="group" aria-label="Grafik i terminy tygodnia">
<button type="button" class="axis" data-all title="Cała siatka">wszystko</button>${SCHEDULE_HOURS.map((hour) => `<button type="button" class="axis hour" data-col="${hour}" title="Cała kolumna ${hh(hour)}">${hh(hour)}</button>`).join('')}
${days
  .map(
    (d, r) =>
      `<button type="button" class="axis day" data-row="${r}" title="Cały dzień: ${WEEKDAYS[r]![1]} ${shortDate(d)}">${DAY_SHORT[WEEKDAYS[r]![0]]} ${shortDate(d)}</button>${SCHEDULE_HOURS.map((hour) => cell(r, hour)).join('')}`,
  )
  .join('\n')}
</div></div>`;
}

function availabilityTab(session: AdminSession, row: TherapistRow, context: EditorContext): string {
  const id = escapeHtml(row.id);
  const activeOffers = context.offers.filter((offer) => offer.active === 1);
  const today = nowIso().slice(0, 10);
  const timezone = row.timezone || DEFAULT_TIMEZONE;
  const monday = context.monday;
  const sunday = addCivilDays(monday, 6);
  const utc = (d: CivilDate): Date => new Date(Date.UTC(d.year, d.month - 1, d.day));
  const weekRange = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).formatRange(utc(monday), utc(sunday));
  const link = (d: CivilDate, label: string): string =>
    `<a href="/admin/terapeuci/${id}?tydzien=${dayKey(d)}#panel-terminy">${label}</a>`;
  const range = (off: TimeOff): string => {
    const [a, b] = [parseDay(off.starts_on), parseDay(off.ends_on)];
    return off.starts_on === off.ends_on ? `${shortDate(a)}.${a.year}` : `${shortDate(a)}.${a.year} – ${shortDate(b)}.${b.year}`;
  };

  return `<section data-tab-panel data-tab-label="Dostępność" id="panel-terminy">
<h2>Dostępność</h2>
<p class="panel-lead">Grafik powtarza się co tydzień: zaznacz godziny, w których przyjmujesz, a wolne terminy
powstaną same na osiem tygodni do przodu. Pojedynczy termin zamkniesz kłódką, urlop — jednym zakresem dat.</p>

${
  activeOffers.length === 0
    ? `<div class="notice warn"><p>Grafik układasz dla oferty — dodaj ją najpierw w zakładce „Oferta”.</p></div>`
    : `<form method="post" action="/admin/terapeuci/${id}/grafik">
  ${csrfField(session)}
  <input type="hidden" name="tydzien" value="${dayKey(monday)}">
  ${activeOffers.map((offer) => `<input type="hidden" name="offer" value="${escapeHtml(offer.id)}">`).join('')}
  <fieldset class="brush" data-brush><legend class="seg-label">Narzędzie</legend>
    ${activeOffers
      .map(
        (offer, i) => `<label class="brush-opt"><input type="radio" name="brush" value="${i}"${i === 0 ? ' checked' : ''}><span class="swatch" data-c="${offerColor(i)}">${activeOffers.length > 1 ? i + 1 : ''}</span><span><strong>${escapeHtml(offer.title)}</strong> <span class="meta">${modeShort(offer.mode)}, ${offer.duration_minutes} min</span></span></label>`,
      )
      .join('')}
    <label class="brush-opt"><input type="radio" name="brush" value="erase"><span class="swatch is-erase" aria-hidden="true"></span><span>Gumka <span class="meta">zdejmuje godzinę z grafiku</span></span></label>
    <label class="brush-opt"><input type="radio" name="brush" value="lock"><span class="swatch is-erase" aria-hidden="true"><span class="ico-lock"></span></span><span>Kłódka <span class="meta">blokuje termin tylko w tym dniu</span></span></label>
  </fieldset>
  <div class="week-nav">${link(addCivilDays(monday, -7), '← Poprzedni')}<strong>${weekRange}</strong>${link(addCivilDays(monday, 7), 'Następny →')}${
    dayKey(mondayOf(timezone)) === dayKey(monday) ? '' : link(mondayOf(timezone), 'Ten tydzień')
  }</div>
  ${availabilityGrid(row, context, activeOffers)}
  <p class="hint">Oferta maluje grafik — godzina powtarza się co tydzień. Kłódka zamyka jeden termin w tym tygodniu, „•” to rezerwacja (odwołasz ją w panelu rezerwacji, osoba dostaje powiadomienie). Kliknij kratkę albo przeciągnij po kilku; klik w dzień, godzinę albo „wszystko” obejmuje cały wiersz, kolumnę albo siatkę — drugi klik odznacza. Zapisz przed zmianą tygodnia.</p>
  <div class="field"><label for="t_tz">Strefa czasowa</label>
    <input id="t_tz" name="timezone" value="${escapeHtml(row.timezone || DEFAULT_TIMEZONE)}" maxlength="64">
    <p class="hint">Godziny grafiku są godzinami lokalnymi w tej strefie; zmiana czasu jest uwzględniana sama.</p></div>
  <p><button class="btn" type="submit">Zapisz</button></p>
</form>`
}

<h3>Urlop i wolne dni</h3>
<form method="post" action="/admin/terapeuci/${id}/urlop">
  ${csrfField(session)}
  <div class="field-row two">
    <div class="field"><label for="u_od">Od</label><input id="u_od" name="od" type="date" min="${today}" required></div>
    <div class="field"><label for="u_do">Do (włącznie)</label><input id="u_do" name="do" type="date" min="${today}" required></div>
  </div>
  <p class="hint">Wolne terminy w tych dniach znikają, a grafik ich nie odtworzy, dopóki wpis tu jest. Rezerwacje zostają.</p>
  <p><button class="btn secondary" type="submit">Dodaj wolne</button></p>
</form>
${
  context.timeOff.length === 0
    ? ''
    : `<ul class="time-off">${context.timeOff
        .map(
          (off) => `<li><strong>${range(off)}</strong> ${
            off.booked > 0
              ? `<span class="notice-inline">${off.booked} ${off.booked === 1 ? 'rezerwacja zostaje' : 'rezerwacje zostają'} — odwołaj w panelu rezerwacji</span>`
              : '<span class="meta">bez rezerwacji</span>'
          }
  <form method="post" action="/admin/terapeuci/${id}/urlop/${escapeHtml(off.id)}/usun" class="inline-form">${csrfField(session)}<button class="link" type="submit">Usuń</button></form></li>`,
        )
        .join('')}</ul>`
}
</section>`;
}

function segmented(name: string, current: string, options: RefTag[]): string {
  return `<div class="seg">${options
    .map((option) => {
      const id = `${name}-${option.slug}`;
      return `<input id="${escapeHtml(id)}" type="radio" name="${escapeHtml(name)}" value="${escapeHtml(option.slug)}"${
        current === option.slug ? ' checked' : ''
      }><label for="${escapeHtml(id)}">${escapeHtml(option.name_pl)}</label>`;
    })
    .join('')}</div>`;
}

function jsonListToSet(value: string | null | undefined, fallback: string[]): Set<string> {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    if (Array.isArray(parsed) && parsed.length > 0) {
      return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
    }
  } catch {
    /* fall through to the default */
  }
  return new Set(fallback);
}



/**
 * Every file ever uploaded for this profile, as its own row in the media
 * relation. The portrait is one of them; the rest wait for the gallery. Forms
 * live outside the profile form, one per action.
 */
function mediaGallery(
  session: AdminSession,
  row: TherapistRow,
  media: Array<{ id: string; url: string }>,
): string {
  if (media.length === 0) return '';
  const items = media
    .map((m) => {
      const isPortrait = row.photo_url === m.url;
      return `<li class="media-item${isPortrait ? ' is-portrait' : ''}">
  <img src="${escapeHtml(m.url)}" alt="" loading="lazy">
  ${isPortrait ? '<span class="media-tag">portret</span>' : `<form method="post" action="/admin/terapeuci/${escapeHtml(row.id)}/media/${escapeHtml(m.id)}/portret">
    <input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}">
    <button class="btn secondary" type="submit">Ustaw jako portret</button>
  </form>`}
  <form method="post" action="/admin/terapeuci/${escapeHtml(row.id)}/media/${escapeHtml(m.id)}/usun"
        data-confirm="Usunąć tę grafikę? Plik zniknie bezpowrotnie.">
    <input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}">
    <button class="btn secondary danger" type="submit">Usuń</button>
  </form>
  <label class="media-address"><span class="visually-hidden">Adres tej grafiki</span>
    <input value="${escapeHtml(m.url)}" readonly onfocus="this.select()"></label>
</li>`;
    })
    .join('');
  return `<fieldset class="media-gallery">
  <legend>Grafiki profilu</legend>
  <p class="hint">Każdy wgrany plik zostaje tutaj. Portret to jedna z grafik — podmiana nic nie kasuje.
  Adres pod zdjęciem wklejasz w edytorze strony, w polu „Zdjęcie” bloku.</p>
  <ul>${items}</ul>
</fieldset>`;
}

function photoField(session: AdminSession, row: TherapistRow | null): string {
  const current = escapeHtml(row?.photo_url ?? '');
  if (!row) {
    return `<div class="field">
  <label for="photo_url">Adres zdjęcia</label>
  <input id="photo_url" name="photo_url" maxlength="500" value="">
  <p class="hint">Wgrywanie i kadrowanie pliku będzie dostępne po zapisaniu profilu.</p>
</div>`;
  }
  return `<div class="field">
  <label for="photo_url">Zdjęcie profilowe</label>
  <div class="photo-row" data-crop data-crop-field="photo_url"
       data-crop-action="/admin/terapeuci/${escapeHtml(row.id)}/zdjecie"
       data-crop-csrf="${escapeHtml(session.csrfToken)}">
    <img class="photo-preview" data-crop-preview alt="Podgląd zdjęcia profilowego"${
      current ? ` src="${current}"` : ' hidden'
    }>
    <div class="photo-actions">
      <input type="file" accept="image/png,image/jpeg,image/webp" class="visually-hidden" data-crop-file>
      <p><button type="button" class="btn secondary" data-crop-pick>Wybierz zdjęcie i wykadruj…</button></p>
      <input id="photo_url" name="photo_url" maxlength="500" value="${current}">
      <p class="hint">Kadr jest kwadratowy, zapisywany w 512×512. Adres możesz też wpisać ręcznie.</p>
    </div>
    <dialog class="crop-dialog" aria-labelledby="crop-title">
      <h2 id="crop-title">Wykadruj zdjęcie</h2>
      <canvas class="crop-canvas" width="320" height="320" tabindex="0" data-crop-canvas
              aria-label="Podgląd kadru. Przeciągnij myszą lub przesuń strzałkami."></canvas>
      <div class="field">
        <label for="crop-zoom">Powiększenie</label>
        <input id="crop-zoom" type="range" min="1" max="4" step="0.01" value="1" data-crop-zoom>
      </div>
      <p class="crop-status" role="status" data-crop-status></p>
      <div class="crop-actions">
        <button type="button" class="btn secondary" data-crop-cancel>Anuluj</button>
        <button type="button" class="btn" data-crop-save>Zapisz zdjęcie</button>
      </div>
    </dialog>
  </div>
</div>`;
}

function therapistForm(session: AdminSession, row: TherapistRow | null, context: EditorContext): string {
  const v = <K extends keyof TherapistRow>(key: K, fallback = ''): string =>
    escapeHtml(row ? String(row[key] ?? fallback) : fallback);
  const isAdmin = session.user.role === 'admin';
  const sessionTypes = jsonListToSet(row?.session_types, ['individual']);
  const ageGroups = jsonListToSet(row?.age_groups, ['adults']);

  return `
<form method="post" action="/admin/terapeuci/${row ? escapeHtml(row.id) : 'nowy'}">
  ${csrfField(session)}
  <div class="field-row two">
    <div class="field"><label for="display_name">Imię i nazwisko</label>
      <input id="display_name" name="display_name" required maxlength="120" value="${v('display_name')}"></div>
    <div class="field"><label for="slug">Adres profilu (slug)</label>
      <input id="slug" name="slug" required maxlength="80" pattern="[a-z0-9-]+" value="${v('slug')}"></div>
  </div>
  <div class="field"><label for="headline">Nagłówek</label>
    <input id="headline" name="headline" maxlength="200" value="${v('headline')}"></div>

  ${photoField(session, row)}

  <div class="field-row two">
    <div class="field"><label for="city">Miejscowość (gabinet)</label>
      <input id="city" name="city" maxlength="80" value="${escapeHtml(context.city)}"></div>
    <div class="field"><label for="address_line">Adres gabinetu</label>
      <input id="address_line" name="address_line" maxlength="160" value="${escapeHtml(context.addressLine)}"></div>
  </div>
  <p class="hint">Wyczyszczenie miejscowości usuwa adres gabinetu z profilu publicznego.</p>

  <fieldset>
    <legend>Forma spotkań</legend>
    <div class="checkbox"><input id="offers_online" name="offers_online" type="checkbox" value="1"${row?.offers_online ? ' checked' : ''}>
      <label for="offers_online">online</label></div>
    <div class="checkbox"><input id="offers_in_person" name="offers_in_person" type="checkbox" value="1"${row?.offers_in_person ? ' checked' : ''}>
      <label for="offers_in_person">stacjonarnie</label></div>
    <div class="checkbox"><input id="accepting" name="accepting_new_clients" type="checkbox" value="1"${row?.accepting_new_clients ? ' checked' : ''}>
      <label for="accepting">przyjmuje nowe osoby</label></div>
  </fieldset>

  <fieldset><legend>Typy spotkań</legend>
    ${checkboxGrid('session_types', refTags(SESSION_TYPE_OPTIONS), sessionTypes)}</fieldset>
  <fieldset><legend>Grupy wiekowe</legend>
    ${checkboxGrid('age_groups', refTags(AGE_GROUP_OPTIONS), ageGroups)}</fieldset>
  <fieldset><legend>Języki</legend>
    ${checkboxGrid('languages', context.languages, context.chosenLanguages)}</fieldset>
  <fieldset><legend>Obszary pracy</legend>
    ${checkboxGrid('topics', context.specialties, context.chosenTopics)}</fieldset>
  <fieldset><legend>Nurty</legend>
    ${checkboxGrid('modalities', context.modalities, context.chosenModalities)}</fieldset>

  <div class="field" data-editor data-editor-label="bio-label">
    <label id="bio-label" for="bio">Opis doświadczenia i sposobu pracy</label>
    <textarea id="bio" name="bio" rows="10" maxlength="4000" data-editor-value>${v('bio')}</textarea>
    <p class="hint">Blok „Jak pracuję” na Twojej stronie. Pusta linia zaczyna nowy akapit.</p>
  </div>

  <fieldset>
    <legend>Pierwsze spotkanie</legend>
    <div class="field">
      <label for="first_meeting_course">Jak wygląda pierwsze spotkanie?</label>
      <textarea id="first_meeting_course" name="first_meeting_course" rows="2" maxlength="400"
        placeholder="np. Rozmawiamy o tym, z czym przychodzisz. Opowiadam, jak pracuję.">${escapeHtml(row?.first_meeting_course ?? '')}</textarea>
    </div>
    <div class="field">
      <label for="first_meeting_prep">Czy trzeba się przygotować?</label>
      <textarea id="first_meeting_prep" name="first_meeting_prep" rows="2" maxlength="400"
        placeholder="np. Nie. Nie musisz wiedzieć, czego potrzebujesz — to jest materiał na pierwsze spotkania.">${escapeHtml(row?.first_meeting_prep ?? '')}</textarea>
    </div>
    <div class="field">
      <label for="first_meeting_decision">Kiedy decydujecie o dalszej pracy?</label>
      <textarea id="first_meeting_decision" name="first_meeting_decision" rows="2" maxlength="400"
        placeholder="np. Po dwóch–trzech spotkaniach decydujemy oboje, czy zaczynamy regularną terapię.">${escapeHtml(row?.first_meeting_decision ?? '')}</textarea>
    </div>
  </fieldset>

  <fieldset data-repeat>
    <legend>Kwalifikacje</legend>
    <div data-repeat-body>${[...context.credentials, { title: '', issuer: '', year: '', verified: false }]
      .map((entry, index) => credentialRow(entry, index, isAdmin))
      .join('')}</div>
    <template>${credentialRow(null, 0, isAdmin)}</template>
    <p><button type="button" class="btn secondary" data-repeat-add>Dodaj kwalifikację</button></p>
    ${isAdmin
      ? ''
      : '<p class="hint">Oznaczenie „zweryfikowane” nadaje wyłącznie zespół po sprawdzeniu dokumentu.</p>'}
  </fieldset>

  <div class="field-row two">
    <div class="field"><label for="cancellation_policy">Zasady odwołania</label>
      <input id="cancellation_policy" name="cancellation_policy" maxlength="500" value="${v('cancellation_policy')}"></div>
    <div class="field"><label for="cutoff">Bezpłatne odwołanie (godziny przed sesją)</label>
      <input id="cutoff" name="cancellation_cutoff_h" type="number" min="0" max="168" value="${v('cancellation_cutoff_h', '24')}"></div>
  </div>
  ${
    isAdmin
      ? `<fieldset>
    <legend>Weryfikacja i publikacja (tylko administrator)</legend>
    <div class="field"><span class="seg-label">Status weryfikacji</span>
      ${segmented(
        'verification_status',
        row?.verification_status ?? 'unverified',
        [
          { slug: 'unverified', name_pl: 'niezweryfikowany' },
          { slug: 'verified', name_pl: 'zweryfikowany' },
          { slug: 'rejected', name_pl: 'odrzucony' },
        ],
      )}</div>
    <div class="field"><label for="verification_notes">Notatki weryfikacyjne (prywatne, nigdy publiczne)</label>
      <textarea id="verification_notes" name="verification_notes" rows="3">${v('verification_notes')}</textarea></div>
    <div class="field"><span class="seg-label">Status profilu</span>
      ${segmented('status', row?.status ?? 'draft', [
        { slug: 'draft', name_pl: 'roboczy' },
        { slug: 'published', name_pl: 'opublikowany' },
        { slug: 'unpublished', name_pl: 'wycofany' },
      ])}
      <p class="hint">Katalog publiczny pokazuje wyłącznie profile opublikowane.</p></div>
  </fieldset>`
      : ''
  }
  <p><button class="btn" type="submit">Zapisz</button></p>
</form>`;
}

/**
 * Profile, FAQ, offers and availability, one tab each. Without JavaScript the
 * four sections render stacked, in this order.
 */
interface CredentialInput {
  title: string;
  issuer: string;
  year: string;
  verified: boolean;
}


function credentialKey(title: string, issuer: string): string {
  return `${normalizeForSearch(title)}|${normalizeForSearch(issuer)}`;
}


function credentialRow(entry: CredentialInput | null, index: number, isAdmin: boolean): string {
  const suffix = entry ? `_${index}` : '';
  const nameAttr = (base: string): string => (entry ? ` name="${base}${suffix}" id="${base}${suffix}"` : '');
  return `<div class="repeat-row" data-repeat-row>
  <div class="field">
    <label data-label-for="cred_title"${entry ? ` for="cred_title${suffix}"` : ''}>Nazwa</label>
    <input data-name="cred_title"${nameAttr('cred_title')} maxlength="120" value="${escapeHtml(entry?.title ?? '')}">
  </div>
  <div class="field">
    <label data-label-for="cred_issuer"${entry ? ` for="cred_issuer${suffix}"` : ''}>Wydający</label>
    <input data-name="cred_issuer"${nameAttr('cred_issuer')} maxlength="120" value="${escapeHtml(entry?.issuer ?? '')}">
  </div>
  <div class="field">
    <label data-label-for="cred_year"${entry ? ` for="cred_year${suffix}"` : ''}>Rok</label>
    <input data-name="cred_year"${nameAttr('cred_year')} type="number" min="1950" max="2100" value="${escapeHtml(entry?.year ?? '')}">
  </div>
  ${
    isAdmin
      ? `<div class="checkbox">
    <input type="checkbox" value="1" data-name="cred_verified"${nameAttr('cred_verified')}${entry?.verified ? ' checked' : ''}>
    <label data-label-for="cred_verified"${entry ? ` for="cred_verified${suffix}"` : ''}>zweryfikowane</label>
  </div>`
      : `<p class="hint">${entry?.verified ? 'zweryfikowane przez zespół' : 'deklarowane'}</p>`
  }
  <button type="button" class="repeat-remove" data-repeat-remove>Usuń</button>
</div>`;
}


function parseStoredCredentials(value: string | null): CredentialInput[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object')
      .slice(0, 20)
      .map((entry) => ({
        title: typeof entry.title === 'string' ? entry.title : '',
        issuer: typeof entry.issuer === 'string' ? entry.issuer : '',
        year:
          typeof entry.year === 'number' && Number.isFinite(entry.year)
            ? String(Math.trunc(entry.year))
            : typeof entry.year === 'string'
              ? entry.year
              : '',
        verified: entry.verified === true,
      }))
      .filter((entry) => entry.title !== '');
  } catch {
    return [];
  }
}


function collectCredentials(body: URLSearchParams, isAdmin: boolean, previous: CredentialInput[]): string {
  const alreadyVerified = new Set(
    previous.filter((entry) => entry.verified).map((entry) => credentialKey(entry.title, entry.issuer)),
  );
  const out: Array<{ title: string; issuer: string; year: number | null; verified: boolean }> = [];

  for (let index = 0; index < 50 && out.length < 20; index++) {
    const title = sanitizeLine(body.get(`cred_title_${index}`) ?? '', 120);
    if (!title) continue;
    const issuer = sanitizeLine(body.get(`cred_issuer_${index}`) ?? '', 120);
    const parsedYear = Number(body.get(`cred_year_${index}`) ?? '');
    const year = Number.isInteger(parsedYear) && parsedYear >= 1950 && parsedYear <= 2100 ? parsedYear : null;
    const verified = isAdmin
      ? body.get(`cred_verified_${index}`) === '1'
      : alreadyVerified.has(credentialKey(title, issuer));
    out.push({ title, issuer, year, verified });
  }
  return JSON.stringify(out);
}


/**
 * Istniejąca oferta do poprawienia. Cena i czas z pierwszej oferty stoją
 * w nagłówku profilu, więc bez tego formularza „150 zł · 50 min" dawało się
 * zmienić tylko przez dodanie drugiej oferty.
 */
function offerForm(session: AdminSession, therapistId: string, offer: OfferRow): string {
  const oid = escapeHtml(offer.id);
  const option = (value: string, label: string, current: string): string =>
    `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`;
  return `<form class="offer-row" method="post" action="/admin/terapeuci/${therapistId}/oferta/${oid}">
  ${csrfField(session)}
  <div class="field-row two">
    <div class="field"><label for="o_${oid}_title">Nazwa</label>
      <input id="o_${oid}_title" name="title" required maxlength="120" value="${escapeHtml(offer.title)}"></div>
    <div class="field"><label for="o_${oid}_type">Typ</label>
      <select id="o_${oid}_type" name="session_type">
        ${option('individual', 'indywidualna', offer.session_type)}${option('couples', 'para', offer.session_type)}${option('family', 'rodzina', offer.session_type)}
      </select></div>
  </div>
  <div class="field-row two">
    <div class="field"><label for="o_${oid}_mode">Forma</label>
      <select id="o_${oid}_mode" name="mode">
        ${option('online', 'online', offer.mode)}${option('in_person', 'stacjonarnie', offer.mode)}
      </select></div>
    <div class="field"><label for="o_${oid}_dur">Czas (min)</label>
      <input id="o_${oid}_dur" name="duration_minutes" type="number" min="15" max="240" value="${offer.duration_minutes}"></div>
  </div>
  <div class="field-row two">
    <div class="field"><label for="o_${oid}_price">Cena (zł)</label>
      <input id="o_${oid}_price" name="price" type="number" min="0" max="5000" step="10" value="${offer.price_minor / 100}"></div>
    <div class="field">
      <div class="checkbox"><input id="o_${oid}_active" name="active" type="checkbox" value="1"${offer.active ? ' checked' : ''}>
        <label for="o_${oid}_active">aktywna</label></div>
      <p class="hint">Wyłączona znika z profilu i z wyszukiwarki; jej terminy zostają w bazie.</p></div>
  </div>
  <p><button class="btn secondary" type="submit">Zapisz ofertę</button></p>
</form>`;
}

// ponytail: zakładki „Dane/Oferta/FAQ/Dostępność" piszą do tych samych kolumn co
// edytor stron (`data-fields.ts` + `host-write.ts`) — dwa formularze nad jedną bazą,
// ~750 wierszy. Osobne zostają tylko pola administracyjne: slug, timezone, status,
// verification_status, is_demo, links. Zwinąć do tej szóstki, gdy padnie decyzja,
// czy zakładki treści mają zostać drogą awaryjną na czas awarii usługi stron.
/**
 * Czego brakuje, żeby profil miał z czego złożyć stronę.
 *
 * Wejście strony ma nieść twarz, obietnicę, cenę i pierwszy krok. Dotąd nikt tego nie pilnował:
 * profil bez zdjęcia i bez ceny renderował się jako nagłówek nad pustą połową ekranu i nikomu
 * nie zapalała się lampka. Lista jest ostrzeżeniem w panelu, nie blokadą publikacji — profile,
 * które już są w katalogu, zostają widoczne.
 */
function profileGapsAdmin(row: TherapistRow, context: EditorContext): string[] {
  const gaps: string[] = [];
  const paid = context.offers.filter((offer) => offer.active === 1 && offer.price_minor !== null);
  if (!row.photo_url) gaps.push('zdjęcie — bez portretu wejście strony zostaje samym tekstem');
  if (paid.length === 0) gaps.push('cena w ofercie — pas liczb pod nagłówkiem nie ma czego pokazać');
  if ((row.headline ?? '').trim().split(/\s+/).filter(Boolean).length < 4 && context.chosenTopics.size === 0)
    gaps.push('obszary pracy albo jedno zdanie o tym, z czym do Ciebie przyjść — inaczej nagłówkiem zostaje samo nazwisko');
  if ((row.bio ?? '').trim() === '') gaps.push('opis — sekcja „Tak wygląda praca ze mną" wtedy nie powstaje');
  return gaps;
}

function therapistTabs(session: AdminSession, row: TherapistRow, context: EditorContext): string {
  const id = escapeHtml(row.id);

  return `
<div class="tabs" data-tabs="terapeuta-v3">

<section data-tab-panel data-tab-label="Dane" id="panel-profil">
<h2 class="visually-hidden">O mnie</h2>
<p class="panel-lead">Kim jesteś i jak pracujesz: opis, zdjęcie, gabinet, obszary, nurty,
kwalifikacje. Po tych danych wyszukiwarka dobiera Cię do osoby, która szuka pomocy.</p>
${
  (() => {
    const gaps = profileGapsAdmin(row, context);
    return gaps.length === 0
      ? ''
      : `<div class="notice" role="status"><p><strong>Twoja strona ma ${gaps.length} ${
          gaps.length === 1 ? 'brak' : 'braki'
        }:</strong></p><ul>${gaps.map((gap) => `<li>${escapeHtml(gap)}</li>`).join('')}</ul></div>`;
  })()
}
${therapistForm(session, row, context)}
${row ? mediaGallery(session, row, context.media) : ''}
</section>

<section data-tab-panel data-tab-label="Oferta" id="panel-oferta">
<h2>Oferta</h2>
<p class="panel-lead">Rodzaje sesji, czas trwania i ceny. Z tego bierze się cena widoczna
u góry profilu i w wynikach wyszukiwania.</p>
<form method="post" action="/admin/terapeuci/${id}/oferta">
  ${csrfField(session)}
  <div class="field-row two">
    <div class="field"><label for="o_title">Nazwa</label><input id="o_title" name="title" required maxlength="120"></div>
    <div class="field"><label for="o_type">Typ</label>
      <select id="o_type" name="session_type">
        <option value="individual">indywidualna</option><option value="couples">para</option><option value="family">rodzina</option>
      </select></div>
  </div>
  <div class="field-row two">
    <div class="field"><label for="o_mode">Forma</label>
      <select id="o_mode" name="mode"><option value="online">online</option><option value="in_person">stacjonarnie</option></select></div>
    <div class="field"><label for="o_dur">Czas (min)</label><input id="o_dur" name="duration_minutes" type="number" min="15" max="240" value="50"></div>
  </div>
  <div class="field"><label for="o_price">Cena (zł)</label><input id="o_price" name="price" type="number" min="0" max="5000" step="10" value="200"></div>
  <p><button class="btn" type="submit">Dodaj ofertę</button></p>
</form>

<h3>Istniejące oferty</h3>
${
  context.offers.length === 0
    ? '<p class="hint">Ten profil nie ma jeszcze żadnej oferty.</p>'
    : context.offers.map((offer) => offerForm(session, id, offer)).join('')
}
</section>

${availabilityTab(session, row, context)}

<section data-tab-panel data-tab-label="FAQ" id="panel-faq">
<h2>FAQ</h2>
<p class="panel-lead">Pytania, które słyszysz najczęściej, i Twoje odpowiedzi. Trafiają na stronę
i do asystenta ChatGPT — dosłownie tak, jak je napiszesz.</p>
<form method="post" action="/admin/terapeuci/${id}/faq">
  ${csrfField(session)}
  <div class="field"><label for="q">Pytanie</label><input id="q" name="question" required maxlength="200"></div>
  <div class="field"><label for="a">Odpowiedź (treść terapeuty)</label><textarea id="a" name="answer" required maxlength="2000" rows="5"></textarea></div>
  <div class="field-row two">
    <div class="field"><label for="cat">Kategoria</label>
      <select id="cat" name="category">
        <option value="first_session">pierwsze spotkanie</option>
        <option value="modality">nurt pracy</option>
        <option value="cancellation">odwoływanie wizyt</option>
        <option value="online">sesje online</option>
        <option value="payment">płatności</option>
        <option value="confidentiality">poufność</option>
        <option value="accessibility">dostępność gabinetu</option>
        <option value="scope">zakres pracy</option>
        <option value="general">inne</option>
      </select></div>
    <div class="field"><label for="pos">Kolejność</label><input id="pos" name="position" type="number" min="0" max="99" value="0"></div>
  </div>
  <div class="checkbox"><input id="approved" name="approved" type="checkbox" value="1" required>
    <label for="approved">Potwierdzam, że tę odpowiedź napisał lub zatwierdził terapeuta</label></div>
  <p><button class="btn" type="submit">Dodaj i opublikuj</button></p>
</form>

<h3>Istniejące pytania</h3>
${
  context.faq.length === 0
    ? '<p class="hint">Ten profil nie ma jeszcze żadnego pytania.</p>'
    : `<div class="table-scroll"><table>
<thead><tr><th scope="col">Pytanie</th><th scope="col">Status</th><th scope="col">Akcje</th></tr></thead>
<tbody>${context.faq
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.question)}</td><td>${escapeHtml(item.status)}</td>
             <td><form method="post" action="/admin/faq/${escapeHtml(item.id)}/status" class="inline-form">
               ${csrfField(session)}
               <button class="btn secondary" name="status" value="${item.status === 'published' ? 'draft' : 'published'}" type="submit">
                 ${item.status === 'published' ? 'Wycofaj' : 'Opublikuj'}</button>
             </form></td></tr>`,
        )
        .join('')}</tbody></table></div>`
}
</section>

<section data-tab-panel data-tab-label="Strony" id="panel-strony">
<h2>Strony</h2>
<p class="panel-lead">Profil i strony obok niego: landing pod kampanię, terapia grupowa, warsztat,
wyjazd. Każda ma własny adres i własny układ; kalendarz, oferta i FAQ wchodzą na nią z Twoich danych.
Kliknij tytuł albo adres, żeby otworzyć edytor.</p>
${
  context.pagesError
    ? `<p class="notice">${escapeHtml(context.pagesError)}</p>`
    : `<div class="table-wrap"><table class="table"><thead><tr><th>Tytuł</th><th>Adres</th><th>Stan</th></tr></thead><tbody>${context.pages
        .map((p) => {
          const profile = p.slug === PROFILE_SLUG;
          const href = `/terapeuci/${escapeHtml(row.slug)}${profile ? '' : `/${escapeHtml(p.slug)}`}`;
          const editor = `/admin/terapeuci/${id}/strony/${escapeHtml(p.id)}`;
          return `<tr><td><button class="link" type="button" data-editor-open data-page-editor="${editor}">${profile ? 'Profil' : escapeHtml(p.title)}</button></td>
             <td><button class="link" type="button" data-editor-open data-page-editor="${editor}">${href}</button></td>
             <td>${p.status === 'published' ? 'opublikowana' : 'szkic'}</td></tr>`;
        })
        .join('')}</tbody></table></div>
<form method="post" action="/admin/terapeuci/${id}/strony" class="form-row">
  ${csrfField(session)}
  <div class="field"><label for="page_title">Tytuł nowej strony</label>
    <input id="page_title" name="title" required maxlength="140" placeholder="np. Grupa wsparcia dla rodziców"></div>
  <div class="field"><label for="page_look">Motyw</label>
    <select id="page_look" name="look">${context.looks
      .map((l) => `<option value="${escapeHtml(l.theme)}">${escapeHtml(l.label)} — ${escapeHtml(l.hint)}</option>`)
      .join('')}</select></div>
  <button class="btn" type="submit">Utwórz stronę</button>
</form>
<p class="hint">Motyw ustawia wygląd i szkielet bloków; wszystko da się potem zmienić w edytorze, który otwiera się na tej stronie i zamyka klawiszem Esc.</p>
<dialog class="editor-dialog" data-editor-dialog data-editor-origin="${escapeHtml(context.editorOrigin)}" aria-label="Edytor strony">
  <button class="btn secondary editor-close" type="button" data-editor-close>Zamknij</button>
</dialog>`
}
</section>

</div>`;
}

adminApp.get('/terapeuci/nowy', async (c) => {
  const g = await screen(c, ['admin']);
  if ('response' in g) return g.response;
  const session = g.session;
  const context = await loadEditorContext(c.env, null);
  // No tabs here: FAQ, offers and availability all need a saved profile first.
  return page(
    c.env,
    'Nowy profil',
    `<h1>Nowy profil</h1>${therapistForm(session, null, context)}`,
  );
});

adminApp.get('/terapeuci/:id', async (c) => {
  const g = await screen(c);
  if ('response' in g) return g.response;
  const session = g.session;
  const id = c.req.param('id');
  if (!ownsTherapist(session.user, id)) {
    return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1><p>Możesz edytować wyłącznie własny profil.</p>', 403);
  }
  const row = await getTherapistRowForAdmin(c.env, id);
  if (!row) return page(c.env, 'Nie znaleziono', '<h1>Nie znaleziono profilu</h1>', 404);

  const context = await loadEditorContext(c.env, row, c.req.query('tydzien'));
  context.credentials = parseStoredCredentials(row.credentials);

  return page(
    c.env,
    row.display_name,
    // Bez nagłówka nad zakładkami: imię i tak stoi w tytule karty, a wąska
    // linijka nad edytorem na całą szerokość okna wyglądała jak pomyłka.
    therapistTabs(session, row, context),
  );
});

/**
 * A checkbox group posts one entry per checked box and nothing at all for the
 * unchecked ones, so the submitted set IS the new set - no free-text parsing,
 * no way to submit a value that was never on screen.
 */
function checkedValues(body: URLSearchParams, name: string, allowed: string[] | null, max: number): string[] {
  const chosen = new Set<string>();
  for (const raw of body.getAll(name)) {
    const slug = raw.trim().toLowerCase();
    if (!/^[a-z0-9-]{1,64}$/.test(slug)) continue;
    if (allowed && !allowed.includes(slug)) continue;
    chosen.add(slug);
    if (chosen.size >= max) break;
  }
  return [...chosen];
}



/**
 * Linki do wizytówek w innych serwisach. `safeUrl` przepuszcza wyłącznie https,
 * więc `javascript:` albo `//evil` odpada zanim trafi do bazy i na profil.
 */
adminApp.post('/terapeuci/:id', async (c) => {
  const body = await formValues(c.req.raw);
  const id = c.req.param('id');
  const isNew = id === 'nowy';
  const g = await guard(c, body, isNew ? ['admin'] : ['admin', 'therapist']);
  if ('response' in g) return g.response;
  const { session } = g;

  if (!isNew && !ownsTherapist(session.user, id)) {
    return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);
  }

  const therapistIdValue = isNew ? randomId('th') : id;
  const at = nowIso();
  const slug = sanitizeLine(body.get('slug') ?? '', 80)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  if (!slug) return page(c.env, 'Błąd', '<h1>Nieprawidłowy slug</h1>', 400);

  const isAdmin = session.user.role === 'admin';
  const existing = isNew ? null : await getTherapistRowForAdmin(c.env, id);

  const values = {
    slug,
    display_name: sanitizeLine(body.get('display_name') ?? '', 120),
    headline: sanitizeLine(body.get('headline') ?? '', 200),
    photo_url: sanitizeLine(body.get('photo_url') ?? '', 500),
    offers_online: body.get('offers_online') === '1' ? 1 : 0,
    offers_in_person: body.get('offers_in_person') === '1' ? 1 : 0,
    accepting_new_clients: body.get('accepting_new_clients') === '1' ? 1 : 0,
    session_types: JSON.stringify(
      checkedValues(body, 'session_types', ['individual', 'couples', 'family'], 3),
    ),
    age_groups: JSON.stringify(
      checkedValues(body, 'age_groups', ['adults', 'teens', 'children', 'seniors'], 4),
    ),
    cancellation_policy: sanitizeLine(body.get('cancellation_policy') ?? '', 500),
    cancellation_cutoff_h: Math.min(Math.max(Number(body.get('cancellation_cutoff_h') ?? 24) || 24, 0), 168),
    // Verification and publication remain admin-only, whatever the form posts.
    verification_status: isAdmin
      ? (['unverified', 'verified', 'rejected'].includes(body.get('verification_status') ?? '')
          ? (body.get('verification_status') as string)
          : 'unverified')
      : (existing?.verification_status ?? 'unverified'),
    verification_notes: isAdmin
      ? sanitizeRichText(body.get('verification_notes') ?? '', 2000)
      : (existing?.verification_notes ?? null),
    status: isAdmin
      ? (['draft', 'published', 'unpublished'].includes(body.get('status') ?? '')
          ? (body.get('status') as string)
          : 'draft')
      : (existing?.status ?? 'draft'),
    // Opis, pierwsze spotkanie i kwalifikacje wróciły do formularza (2026-09-04);
    // przedtem kolumny przepisywały się w kółko, bo pól nie było gdzie wpisać.
    bio: sanitizeRichText(body.get('bio') ?? '', 4000),
    credentials: collectCredentials(body, session.user.role === 'admin', parseStoredCredentials(existing?.credentials ?? null)),
    links: existing?.links ?? '[]',
    first_meeting_course: sanitizeLine(body.get('first_meeting_course') ?? '', 400),
    first_meeting_prep: sanitizeLine(body.get('first_meeting_prep') ?? '', 400),
    first_meeting_decision: sanitizeLine(body.get('first_meeting_decision') ?? '', 400),
  };
  const verifiedAt =
    values.verification_status === 'verified'
      ? (existing?.verification_status === 'verified' ? existing.verified_at : at)
      : null;


  // Jeden zapis dla obu przypadków: SQLite scala po kluczu głównym. `is_demo`,
  // `timezone` i `created_at` należą do wiersza, nie do formularza, więc przy
  // aktualizacji nie ma ich w `DO UPDATE` i zostają takie, jakie były.
  await c.env.DB.prepare(
    `INSERT INTO therapists (id, slug, display_name, headline, bio, photo_url, offers_online, offers_in_person,
                             accepting_new_clients, age_groups, session_types, credentials, links,
                             first_meeting_course, first_meeting_prep, first_meeting_decision,
                             verification_status, verified_at, verification_notes, status, is_demo, timezone,
                             cancellation_policy, cancellation_cutoff_h, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'Europe/Warsaw',?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       slug=excluded.slug, display_name=excluded.display_name, headline=excluded.headline, bio=excluded.bio,
       photo_url=excluded.photo_url, offers_online=excluded.offers_online, offers_in_person=excluded.offers_in_person,
       accepting_new_clients=excluded.accepting_new_clients, age_groups=excluded.age_groups,
       session_types=excluded.session_types, credentials=excluded.credentials, links=excluded.links,
       first_meeting_course=excluded.first_meeting_course, first_meeting_prep=excluded.first_meeting_prep,
       first_meeting_decision=excluded.first_meeting_decision, verification_status=excluded.verification_status,
       verified_at=excluded.verified_at, verification_notes=excluded.verification_notes, status=excluded.status,
       cancellation_policy=excluded.cancellation_policy, cancellation_cutoff_h=excluded.cancellation_cutoff_h,
       updated_at=excluded.updated_at`,
  )
    .bind(
      therapistIdValue,
      values.slug,
      values.display_name,
      values.headline,
      values.bio,
      values.photo_url || null,
      values.offers_online,
      values.offers_in_person,
      values.accepting_new_clients,
      values.age_groups,
      values.session_types,
      values.credentials,
      values.links,
      values.first_meeting_course,
      values.first_meeting_prep,
      values.first_meeting_decision,
      values.verification_status,
      verifiedAt,
      values.verification_notes,
      values.status,
      values.cancellation_policy,
      values.cancellation_cutoff_h,
      at,
      at,
    )
    .run();

  // Relations are replaced wholesale - simpler and always consistent. The form
  // renders the current selection as checked boxes, so "replaced wholesale"
  // means what the administrator sees, not an empty set.
  const languages = checkedValues(body, 'languages', null, 8);
  const topics = checkedValues(body, 'topics', null, 12);
  const modalities = checkedValues(body, 'modalities', null, 8);
  const city = sanitizeLine(body.get('city') ?? '', 80);

  const statements = [
    c.env.DB.prepare(`DELETE FROM therapist_languages WHERE therapist_id = ?`).bind(therapistIdValue),
    c.env.DB.prepare(`DELETE FROM therapist_specialties WHERE therapist_id = ?`).bind(therapistIdValue),
    c.env.DB.prepare(`DELETE FROM therapist_modalities WHERE therapist_id = ?`).bind(therapistIdValue),
    // Clearing the city field removes the office address, which is the only
    // way to take a location off a published profile.
    c.env.DB.prepare(`DELETE FROM therapist_locations WHERE therapist_id = ?`).bind(therapistIdValue),
  ];
  for (const code of languages) {
    statements.push(
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO therapist_languages (therapist_id, language_code)
         SELECT ?, code FROM languages WHERE code = ?`,
      ).bind(therapistIdValue, code),
    );
  }
  for (const s of topics) {
    statements.push(
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO therapist_specialties (therapist_id, specialty_slug)
         SELECT ?, slug FROM specialties WHERE slug = ?`,
      ).bind(therapistIdValue, s),
    );
  }
  for (const m of modalities) {
    statements.push(
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO therapist_modalities (therapist_id, modality_slug)
         SELECT ?, slug FROM modalities WHERE slug = ?`,
      ).bind(therapistIdValue, m),
    );
  }
  if (city) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO therapist_locations (id, therapist_id, city, city_norm, country, address_line, is_primary)
         VALUES (?, ?, ?, ?, 'PL', ?, 1)`,
      ).bind(
        randomId('loc'),
        therapistIdValue,
        city,
        normalizeForSearch(city),
        sanitizeLine(body.get('address_line') ?? '', 160) || null,
      ),
    );
  }
  await c.env.DB.batch(statements);

  await audit(c.env, {
    actorType: session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: session.user.id,
    action: isNew ? 'therapist.created' : 'therapist.updated',
    subjectType: 'therapist',
    subjectId: therapistIdValue,
    meta: { to_status: values.status, status: values.verification_status },
  });

  return new Response(null, { status: 302, headers: { location: `/admin/terapeuci/${therapistIdValue}` } });
});

// ----------------------------------------------------------- profile photo ---

/**
 * Magic bytes, not the declared `Content-Type`. The browser sends whatever it
 * likes and `/media/:key` serves the stored type straight back, so the type is
 * decided here, from the file itself.
 */
function sniffImageType(bytes: Uint8Array): { mime: string; extension: string } | null {
  const startsWith = (...signature: number[]): boolean =>
    signature.every((byte, index) => bytes[index] === byte);

  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: 'image/png', extension: 'png' };
  if (startsWith(0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', extension: 'jpg' };
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: 'image/webp', extension: 'webp' };
  }
  return null;
}

const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
/** Thumbnail side, and the suffix that pairs it with its master key. */
const PHOTO_THUMB_SUFFIX = '160';

// ---------------------------------------------------------------- podstrony ---

/** Session and ownership. A posted body means CSRF is checked too. */
async function ownedTherapist(
  c: { env: Env; req: { raw: Request; param(name: string): string } },
  body: URLSearchParams | null,
): Promise<{ session: AdminSession; therapist: TherapistRow } | { response: Response }> {
  let session: AdminSession;
  if (body) {
    const g = await guard(c, body, ['admin', 'therapist']);
    if ('response' in g) return g;
    session = g.session;
  } else {
    const loaded = await loadAdminSession(c.env, c.req.raw);
    if (!loaded) return { response: page(c.env, 'Zaloguj się', loginForm(c.env), 401, true) };
    session = loaded;
  }
  const id = c.req.param('id');
  if (!ownsTherapist(session.user, id)) {
    return { response: page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403) };
  }
  const therapist = await getTherapistRowForAdmin(c.env, id);
  if (!therapist) return { response: page(c.env, 'Nie znaleziono', '<h1>Nie znaleziono profilu</h1>', 404) };
  return { session, therapist };
}

/** A new subpage in the service, from a template; the editor opens on it. */
adminApp.post('/terapeuci/:id/strony', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await ownedTherapist(c, body);
  if ('response' in g) return g.response;
  const id = g.therapist.id;

  const title = sanitizeLine(body.get('title') ?? '', 140);
  if (title === '') return c.redirect(`/admin/terapeuci/${id}#panel-strony`, 303);
  const theme = (body.get('look') ?? '').replace(/[^a-z0-9-]/g, '');
  let made: PageInfo | 'slug_taken';
  try {
    made = await createPage(c.env, { owner: id, title, theme });
    // The title's slug is hers already: number it rather than refuse a second workshop.
    for (let n = 2; made === 'slug_taken' && n < 50; n++) {
      made = await createPage(c.env, { owner: id, title, slug: `${slugOf(title)}-${n}`, theme });
    }
  } catch (err) {
    if (!(err instanceof PagesUnavailable)) throw err;
    return page(c.env, 'Edytor niedostępny', `<h1>Edytor niedostępny</h1><p>${PAGES_DOWN}</p>`, 503);
  }
  if (made === 'slug_taken') return page(c.env, 'Adres zajęty', '<h1>Adres zajęty</h1><p>Masz już wiele podstron o tym tytule.</p>', 409);
  await audit(c.env, {
    actorType: g.session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: g.session.user.id,
    action: 'therapist.page_created',
    subjectType: 'therapist',
    subjectId: id,
    meta: { page: made.id },
  });
  return c.redirect(`/admin/terapeuci/${id}#panel-strony`, 303);
});

/** Straight into the hosted editor for one of her pages. Owner only, so drafts stay private. */
adminApp.get('/terapeuci/:id/strony/:pid', async (c) => {
  const g = await ownedTherapist(c, null);
  if ('response' in g) return g.response;
  const id = g.therapist.id;
  try {
    const row = await getPage(c.env, c.req.param('pid'));
    if (!row || row.owner !== id) return page(c.env, 'Nie znaleziono', '<h1>Nie znaleziono strony</h1>', 404);
    return c.redirect(await editorUrl(c.env, row, await previewContext(c.env, id)), 303);
  } catch (err) {
    if (!(err instanceof PagesUnavailable)) throw err;
    return page(c.env, 'Edytor niedostępny', `<h1>Edytor niedostępny</h1><p>${PAGES_DOWN}</p>`, 503);
  }
});

adminApp.post('/terapeuci/:id/zdjecie', async (c) => {
  const fail = (message: string, status: number): Response =>
    Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });

  const session = await loadAdminSession(c.env, c.req.raw);
  if (!session) return fail('Sesja wygasła. Odśwież stronę i zaloguj się ponownie.', 401);

  // Multipart, so `formValues` (which drops File entries) cannot be used here.
  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    return fail('Nieprawidłowe dane formularza.', 400);
  }

  if (!(await verifyCsrf(c.env, c.req.raw, String(form.get('csrf') ?? '')))) {
    return fail('Nieprawidłowy token formularza. Odśwież stronę.', 403);
  }

  const id = c.req.param('id');
  if (!['admin', 'therapist'].includes(session.user.role) || !ownsTherapist(session.user, id)) {
    return fail('Brak uprawnień do tego profilu.', 403);
  }
  if (!c.env.MEDIA) {
    return fail('Magazyn plików (R2) nie jest włączony w tym środowisku. Użyj pola z adresem zdjęcia.', 503);
  }

  const existing = await getTherapistRowForAdmin(c.env, id);
  if (!existing) return fail('Nie znaleziono profilu.', 404);

  /** Same checks for both renditions: a thumbnail is a file the browser sent too. */
  const readImage = async (
    field: string,
  ): Promise<{ bytes: Uint8Array; kind: { mime: string; extension: string } } | Response> => {
    const value = form.get(field);
    if (!(value instanceof File)) return fail('Brak pliku.', 400);
    if (value.size === 0 || value.size > PHOTO_MAX_BYTES) {
      return fail('Plik musi mieć od 1 bajta do 2 MB.', 413);
    }
    const bytes = new Uint8Array(await value.arrayBuffer());
    const kind = sniffImageType(bytes);
    if (!kind) return fail('Obsługiwane formaty to PNG, JPEG i WebP.', 415);
    return { bytes, kind };
  };

  const master = await readImage('photo');
  if (master instanceof Response) return master;
  // The thumbnail is optional only in the sense that an older client may omit it.
  const thumbnail = form.has('photo_thumb') ? await readImage('photo_thumb') : null;
  if (thumbnail instanceof Response) return thumbnail;

  // Both renditions share one base key: the catalogue derives the thumbnail's
  // address from the master's, so nothing extra is stored about it.
  const base = `therapists/${id}/${randomId('img')}`;
  const key = `${base}.${master.kind.extension}`;
  await c.env.MEDIA.put(key, master.bytes, { httpMetadata: { contentType: master.kind.mime } });
  if (thumbnail) {
    await c.env.MEDIA.put(`${base}-${PHOTO_THUMB_SUFFIX}.${thumbnail.kind.extension}`, thumbnail.bytes, {
      httpMetadata: { contentType: thumbnail.kind.mime },
    });
  }

  const url = `/media/${key}`;
  const at = nowIso();
  await c.env.DB.prepare(`UPDATE therapists SET photo_url = ?, updated_at = ? WHERE id = ?`)
    .bind(url, at, id)
    .run();

  // Every upload is a row in the media relation. The previous file is NOT
  // deleted any more: it stays in the gallery and can be made the portrait
  // again from the panel. Files leave the bucket only via the delete action.
  await c.env.DB.prepare(
    `INSERT INTO therapist_media (id, therapist_id, url, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(randomId('med'), id, url, at)
    .run();

  await audit(c.env, {
    actorType: session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: session.user.id,
    action: 'therapist.photo_updated',
    subjectType: 'therapist',
    subjectId: id,
    meta: { field: master.kind.mime, count: master.bytes.length },
  });

  // The key carries fresh randomness, so the URL alone busts any cache.
  return Response.json({ url }, { headers: { 'cache-control': 'no-store' } });
});

adminApp.post('/terapeuci/:id/faq', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin', 'therapist']);
  if ('response' in g) return g.response;
  const id = c.req.param('id');
  if (!ownsTherapist(g.session.user, id)) return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);
  if (body.get('approved') !== '1') {
    return page(c.env, 'Błąd', '<h1>Wymagane potwierdzenie autorstwa</h1>', 400);
  }

  const at = nowIso();
  const faqId = randomId('faq');
  await c.env.DB.prepare(
    `INSERT INTO faq_items (id, therapist_id, question, answer, category, position, status, approved_by, approved_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)`,
  )
    .bind(
      faqId,
      id,
      sanitizeLine(body.get('question') ?? '', 200),
      sanitizeRichText(body.get('answer') ?? '', 2000),
      sanitizeLine(body.get('category') ?? 'general', 40),
      Math.min(Math.max(Number(body.get('position') ?? 0) || 0, 0), 99),
      g.session.user.id,
      at,
      at,
      at,
    )
    .run();

  await audit(c.env, {
    actorType: g.session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: g.session.user.id,
    action: 'faq.published',
    subjectType: 'faq_item',
    subjectId: faqId,
    meta: { status: 'published' },
  });
  return new Response(null, { status: 302, headers: { location: `/admin/terapeuci/${id}` } });
});

/**
 * The media relation's two verbs share one preamble: session, ownership and
 * the row itself. Setting the portrait only repoints therapists.photo_url;
 * deleting removes the row and - only for files this app uploaded - both
 * renditions from the bucket.
 */
async function mediaTarget(
  c: { env: Env; req: { raw: Request; param(name: string): string } },
): Promise<Response | { session: AdminSession; id: string; row: { id: string; url: string } | null }> {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin', 'therapist']);
  if ('response' in g) return g.response;
  const id = c.req.param('id');
  if (!ownsTherapist(g.session.user, id)) {
    return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);
  }
  const row = await c.env.DB.prepare(`SELECT id, url FROM therapist_media WHERE id = ? AND therapist_id = ?`)
    .bind(c.req.param('mid'), id)
    .first<{ id: string; url: string }>();
  return { session: g.session, id, row };
}

adminApp.post('/terapeuci/:id/media/:mid/portret', async (c) => {
  const t = await mediaTarget(c);
  if (t instanceof Response) return t;
  if (t.row) {
    await c.env.DB.prepare(`UPDATE therapists SET photo_url = ?, updated_at = ? WHERE id = ?`)
      .bind(t.row.url, nowIso(), t.id)
      .run();
  }
  return c.redirect(`/admin/terapeuci/${t.id}`, 303);
});

adminApp.post('/terapeuci/:id/media/:mid/usun', async (c) => {
  const t = await mediaTarget(c);
  if (t instanceof Response) return t;
  const { id, row } = t;
  const mid = row?.id ?? '';
  if (row) {
    await c.env.DB.prepare(`DELETE FROM therapist_media WHERE id = ?`).bind(mid).run();
    // Portret wskazujący na usuwaną grafikę wraca do placeholdera.
    await c.env.DB.prepare(`UPDATE therapists SET photo_url = NULL, updated_at = ? WHERE id = ? AND photo_url = ?`)
      .bind(nowIso(), id, row.url)
      .run();
    if (c.env.MEDIA && row.url.startsWith(`/media/therapists/${id}/`)) {
      const key = row.url.slice('/media/'.length);
      const thumb = key.replace(/(\.[a-z]+)$/, `-${PHOTO_THUMB_SUFFIX}$1`);
      await Promise.all([key, thumb].map((k) => c.env.MEDIA!.delete(k).catch(() => undefined)));
    }
    await audit(c.env, {
      actorType: t.session.user.role === 'admin' ? 'admin' : 'therapist',
      actorId: t.session.user.id,
      action: 'therapist.media_deleted',
      subjectType: 'therapist',
      subjectId: id,
      meta: { url: row.url },
    });
  }
  return c.redirect(`/admin/terapeuci/${id}`, 303);
});

adminApp.post('/faq/:id/status', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin', 'therapist']);
  if ('response' in g) return g.response;
  const faqId = c.req.param('id');
  const status = body.get('status') === 'published' ? 'published' : 'draft';

  const row = await c.env.DB.prepare(`SELECT therapist_id FROM faq_items WHERE id = ?`)
    .bind(faqId)
    .first<{ therapist_id: string }>();
  if (!row || !ownsTherapist(g.session.user, row.therapist_id)) {
    return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);
  }

  await c.env.DB.prepare(
    `UPDATE faq_items SET status = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(status, status === 'published' ? g.session.user.id : null, status === 'published' ? nowIso() : null, nowIso(), faqId)
    .run();
  await audit(c.env, {
    actorType: g.session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: g.session.user.id,
    action: 'faq.status_changed',
    subjectType: 'faq_item',
    subjectId: faqId,
    meta: { to_status: status },
  });
  return new Response(null, { status: 302, headers: { location: `/admin/terapeuci/${row.therapist_id}` } });
});

/** Pola oferty z formularza - te same przy dodawaniu i przy poprawianiu. */
function offerValues(body: URLSearchParams): {
  title: string;
  session_type: string;
  mode: string;
  duration_minutes: number;
  price_minor: number;
} {
  const type = body.get('session_type') ?? '';
  return {
    title: sanitizeLine(body.get('title') ?? 'Sesja', 120),
    session_type: ['individual', 'couples', 'family'].includes(type) ? type : 'individual',
    mode: body.get('mode') === 'in_person' ? 'in_person' : 'online',
    duration_minutes: Math.min(Math.max(Number(body.get('duration_minutes') ?? 50) || 50, 15), 240),
    price_minor: Math.round(Math.min(Math.max(Number(body.get('price') ?? 0) || 0, 0), 5000) * 100),
  };
}

adminApp.post('/terapeuci/:id/oferta', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin', 'therapist']);
  if ('response' in g) return g.response;
  const id = c.req.param('id');
  if (!ownsTherapist(g.session.user, id)) return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);

  const at = nowIso();
  const offerId = randomId('of');
  const values = offerValues(body);
  await c.env.DB.prepare(
    `INSERT INTO session_offers (id, therapist_id, title, session_type, mode, duration_minutes, price_minor, currency, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PLN', 1, ?, ?)`,
  )
    .bind(offerId, id, values.title, values.session_type, values.mode, values.duration_minutes, values.price_minor, at, at)
    .run();

  await audit(c.env, {
    actorType: g.session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: g.session.user.id,
    action: 'offer.created',
    subjectType: 'session_offer',
    subjectId: offerId,
    meta: { price_minor: values.price_minor, currency: 'PLN' },
  });
  return new Response(null, { status: 302, headers: { location: `/admin/terapeuci/${id}` } });
});

adminApp.post('/terapeuci/:id/oferta/:offerId', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin', 'therapist']);
  if ('response' in g) return g.response;
  const id = c.req.param('id');
  if (!ownsTherapist(g.session.user, id)) return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);

  const offerId = c.req.param('offerId');
  const values = offerValues(body);
  const active = body.get('active') === '1' ? 1 : 0;
  const changed = await c.env.DB.prepare(
    `UPDATE session_offers SET title=?, session_type=?, mode=?, duration_minutes=?, price_minor=?, active=?, updated_at=?
       WHERE id = ? AND therapist_id = ?`,
  )
    .bind(values.title, values.session_type, values.mode, values.duration_minutes, values.price_minor, active, nowIso(), offerId, id)
    .run();
  if (changed.meta.changes === 0) return page(c.env, 'Nie znaleziono', '<h1>Nie znaleziono oferty</h1>', 404);

  await audit(c.env, {
    actorType: g.session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: g.session.user.id,
    action: 'offer.updated',
    subjectType: 'session_offer',
    subjectId: offerId,
    meta: { price_minor: values.price_minor, currency: 'PLN', status: active ? 'active' : 'inactive' },
  });
  return new Response(null, { status: 302, headers: { location: `/admin/terapeuci/${id}#panel-oferta` } });
});

/** Wspólny początek zapisów zakładki „Dostępność": CSRF, rola, własny profil. */
async function availabilityGuard(c: { env: Env; req: { raw: Request; param(name: string): string | undefined } }): Promise<
  { response: Response } | { session: AdminSession; body: URLSearchParams; therapist: TherapistRow; timezone: string; back: string }
> {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin', 'therapist']);
  if ('response' in g) return g;
  const id = c.req.param('id') ?? '';
  if (!ownsTherapist(g.session.user, id)) return { response: page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403) };
  const therapist = await getTherapistRowForAdmin(c.env, id);
  if (!therapist) return { response: page(c.env, 'Nie znaleziono', '<h1>Nie znaleziono profilu</h1>', 404) };
  const week = body.get('tydzien') ?? '';
  const back = `/admin/terapeuci/${id}${isIsoDate(week) ? `?tydzien=${week}` : ''}#panel-terminy`;
  return { session: g.session, body, therapist, timezone: therapist.timezone || DEFAULT_TIMEZONE, back };
}

const actorOf = (session: AdminSession): 'admin' | 'therapist' => (session.user.role === 'admin' ? 'admin' : 'therapist');
const seeOther = (location: string): Response => new Response(null, { status: 302, headers: { location } });

adminApp.post('/terapeuci/:id/grafik', async (c) => {
  const g = await availabilityGuard(c);
  if ('response' in g) return g.response;
  const { body, therapist } = g;

  // Strefa jest godzinami grafiku: nieznana odpada, zamiast cicho zostać Warszawą.
  const timezone = sanitizeLine(body.get('timezone') ?? '', 64) || g.timezone;
  if (!isValidTimezone(timezone)) {
    return page(c.env, 'Błąd', '<h1>Nieznana strefa czasowa</h1><p>Podaj identyfikator IANA, np. Europe/Warsaw.</p>', 400);
  }

  const { results: offers } = await c.env.DB.prepare(
    `SELECT id, duration_minutes, schedule FROM session_offers WHERE therapist_id = ? AND active = 1 ORDER BY created_at`,
  )
    .bind(therapist.id)
    .all<{ id: string; duration_minutes: number; schedule: string }>();
  const posted = new Set(body.getAll('offer'));
  // Formularz przysyła jedno pole na zaznaczoną kratkę: "dzień-godzina". Kratka ma
  // jedną ofertę; bez skryptu da się zaznaczyć dwie - wtedy zostaje pierwsza.
  const taken = new Set<string>();
  const schedules = offers
    .filter((offer) => posted.has(offer.id))
    .map((offer) => {
      const week = emptyWeek();
      for (const cell of body.getAll(`g_${offer.id}`)) {
        const [day, hour] = cell.split('-').map(Number);
        if (!Number.isInteger(day) || day! < 0 || day! > 6 || taken.has(cell)) continue;
        taken.add(cell);
        week[day!]!.push(hour!);
      }
      return { ...offer, week: week.map(cleanHours) };
    });

  if (timezone !== therapist.timezone) {
    await c.env.DB.prepare(`UPDATE therapists SET timezone = ?, updated_at = ? WHERE id = ?`).bind(timezone, nowIso(), therapist.id).run();
  }
  // Oferta, której grafik się nie zmienił, zostaje nietknięta - także jej stare
  // terminy sprzed grafiku. Zmiana strefy przelicza wszystkie.
  await saveSchedules(
    c.env,
    therapist.id,
    timezone,
    schedules.filter((s) => timezone !== therapist.timezone || weekJson(s.week) !== s.schedule),
  );

  // Kłódki: formularz przysyła terminy tygodnia (`slot`) i zaznaczone (`lock`).
  // Po grafiku - termin, który właśnie zszedł z grafiku, po prostu nie pasuje.
  const seen = body.getAll('slot').slice(0, 200);
  const locked = new Set(body.getAll('lock'));
  const at = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE appointment_slots SET status = 'blocked', block_reason = 'zablokowany w panelu', updated_at = ?
        WHERE therapist_id = ? AND status = 'open' AND starts_at_utc > ? AND id IN (SELECT value FROM json_each(?))`,
    ).bind(at, therapist.id, at, JSON.stringify(seen.filter((sid) => locked.has(sid)))),
    c.env.DB.prepare(
      `UPDATE appointment_slots SET status = 'open', block_reason = NULL, updated_at = ?
        WHERE therapist_id = ? AND status = 'blocked' AND starts_at_utc > ? AND id IN (SELECT value FROM json_each(?))`,
    ).bind(at, therapist.id, at, JSON.stringify(seen.filter((sid) => !locked.has(sid)))),
  ]);

  await audit(c.env, {
    actorType: actorOf(g.session),
    actorId: g.session.user.id,
    action: 'schedule.saved',
    subjectType: 'therapist',
    subjectId: therapist.id,
    meta: { count: schedules.reduce((n, s) => n + s.week.flat().length, 0), field: timezone },
  });
  return seeOther(g.back);
});

adminApp.post('/terapeuci/:id/urlop', async (c) => {
  const g = await availabilityGuard(c);
  if ('response' in g) return g.response;
  const from = g.body.get('od') ?? '';
  const to = g.body.get('do') ?? '';
  if (!isIsoDate(from) || !isIsoDate(to) || to < from || Date.parse(to) - Date.parse(from) > 366 * 86_400_000) {
    return page(c.env, 'Błąd', '<h1>Sprawdź daty urlopu</h1><p>„Do” nie może być przed „Od”, a jeden wpis obejmuje najwyżej rok.</p>', 400);
  }

  const [start, end] = localRange(g.timezone, parseDay(from), parseDay(to));
  const { results: open } = await c.env.DB.prepare(
    `SELECT id FROM appointment_slots WHERE therapist_id = ? AND status = 'open' AND starts_at_utc >= ? AND starts_at_utc < ?`,
  )
    .bind(g.therapist.id, start, end)
    .all<{ id: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO therapist_time_off (id, therapist_id, starts_on, ends_on, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(randomId('off'), g.therapist.id, from, to, nowIso()),
    ...closeSlots(c.env, open.map((s) => s.id), 'urlop'),
  ]);

  await audit(c.env, {
    actorType: actorOf(g.session),
    actorId: g.session.user.id,
    action: 'time_off.added',
    subjectType: 'therapist',
    subjectId: g.therapist.id,
    meta: { count: open.length },
  });
  return seeOther(g.back);
});

/** Urlop zdjęty: dni wracają do grafiku, więc terminy dokładają się od razu, nie przy cronie. */
adminApp.post('/terapeuci/:id/urlop/:off/usun', async (c) => {
  const g = await availabilityGuard(c);
  if ('response' in g) return g.response;
  const result = await c.env.DB.prepare(`DELETE FROM therapist_time_off WHERE id = ? AND therapist_id = ?`)
    .bind(c.req.param('off'), g.therapist.id)
    .run();
  const added = (result.meta.changes ?? 0) > 0 ? await fillFromSchedules(c.env, g.therapist.id) : 0;

  await audit(c.env, {
    actorType: actorOf(g.session),
    actorId: g.session.user.id,
    action: 'time_off.removed',
    subjectType: 'therapist',
    subjectId: g.therapist.id,
    meta: { count: added },
  });
  return seeOther(g.back);
});

// ------------------------------------------------------- booking cancelling ---

adminApp.post('/rezerwacje/:id/anuluj', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin', 'support', 'therapist']);
  if ('response' in g) return g.response;
  const bookingIdValue = c.req.param('id');
  const reason = sanitizeLine(body.get('reason') ?? '', 120);
  if (!reason) return page(c.env, 'Błąd', '<h1>Powód odwołania jest wymagany</h1>', 400);

  const row = await c.env.DB.prepare(
    `SELECT id, slot_id, therapist_id, user_id, status, public_ref FROM bookings WHERE id = ?`,
  )
    .bind(bookingIdValue)
    .first<{
      id: string;
      slot_id: string;
      therapist_id: string;
      user_id: string;
      status: string;
      public_ref: string;
    }>();
  if (!row) return page(c.env, 'Nie znaleziono', '<h1>Nie znaleziono rezerwacji</h1>', 404);
  if (g.session.user.role === 'therapist' && !ownsTherapist(g.session.user, row.therapist_id)) {
    return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);
  }

  if (row.status === 'confirmed') {
    const at = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE bookings SET status='cancelled', cancelled_at=?, cancelled_by=?, cancel_reason=?, updated_at=?
          WHERE id=? AND status='confirmed'`,
      ).bind(at, g.session.user.role, reason, at, row.id),
      c.env.DB.prepare(
        `UPDATE appointment_slots SET status='open', updated_at=? WHERE id=? AND status='booked'`,
      ).bind(at, row.slot_id),
    ]);

    const owner = await c.env.DB.prepare(`SELECT email_enc FROM users WHERE id = ?`)
      .bind(row.user_id)
      .first<{ email_enc: string }>();
    if (owner) {
      await enqueueNotification(c.env, 'booking.cancelled_by_staff', row.id, {
        to: await decryptPii(c.env.PII_ENC_KEY, owner.email_enc),
        subject: `Rezerwacja ${row.public_ref} została odwołana`,
        text: `Rezerwacja ${row.public_ref} została odwołana przez zespół lub terapeutę.\nPowód: ${reason}`,
      });
      c.executionCtx.waitUntil(drainOutbox(c.env, 5));
    }
  }

  await audit(c.env, {
    actorType: g.session.user.role === 'admin' ? 'admin' : g.session.user.role === 'support' ? 'support' : 'therapist',
    actorId: g.session.user.id,
    action: 'booking.cancelled_by_staff',
    subjectType: 'booking',
    subjectId: row.id,
    meta: { reason_code: 'staff', to_status: 'cancelled' },
  });
  return new Response(null, { status: 302, headers: { location: '/admin' } });
});

// ------------------------------------------------------------ crisis data ---

adminApp.get('/kryzys', async (c) => {
  const g = await screen(c, ['admin']);
  if ('response' in g) return g.response;
  const session = g.session;

  const { results } = await c.env.DB.prepare(
    `SELECT id, audience, title, phone, url, verified_at, version, active FROM crisis_resources
      WHERE country = 'PL' ORDER BY priority`,
  ).all<{
    id: string;
    audience: string;
    title: string;
    phone: string | null;
    url: string | null;
    verified_at: string;
    version: string;
    active: number;
  }>();

  return page(
    c.env,
    'Zasoby kryzysowe',
    `
<h1>Zasoby kryzysowe (PL)</h1>
<p>Dane są utrzymywane ręcznie. Zweryfikuj je względem oficjalnych źródeł co najmniej raz na 90 dni.</p>
<div class="table-scroll"><table>
<thead><tr><th scope="col">Tytuł</th><th scope="col">Odbiorca</th><th scope="col">Telefon</th>
<th scope="col">Zweryfikowano</th><th scope="col">Aktywne</th><th scope="col">Akcje</th></tr></thead>
<tbody>
${results
  .map(
    (r) => `<tr>
  <td>${escapeHtml(r.title)}</td>
  <td>${escapeHtml(r.audience)}</td>
  <td>${escapeHtml(r.phone ?? '—')}</td>
  <td>${escapeHtml(r.verified_at)}</td>
  <td>${r.active ? 'tak' : 'nie'}</td>
  <td>
    <form method="post" action="/admin/kryzys/${escapeHtml(r.id)}">
      ${csrfField(session)}
      <label class="visually-hidden" for="p-${escapeHtml(r.id)}">Telefon</label>
      <input id="p-${escapeHtml(r.id)}" name="phone" value="${escapeHtml(r.phone ?? '')}" maxlength="40">
      <label class="visually-hidden" for="u-${escapeHtml(r.id)}">Adres</label>
      <input id="u-${escapeHtml(r.id)}" name="url" value="${escapeHtml(r.url ?? '')}" maxlength="300">
      <button class="btn secondary" name="action" value="verify" type="submit">Potwierdź weryfikację</button>
      <button class="btn secondary" name="action" value="${r.active ? 'disable' : 'enable'}" type="submit">
        ${r.active ? 'Wyłącz' : 'Włącz'}</button>
    </form>
  </td>
</tr>`,
  )
  .join('')}
</tbody></table></div>`,
  );
});

adminApp.post('/kryzys/:id', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin']);
  if ('response' in g) return g.response;
  const id = c.req.param('id');
  const action = body.get('action');
  const at = nowIso();

  if (action === 'verify') {
    await c.env.DB.prepare(
      `UPDATE crisis_resources SET phone = ?, url = ?, verified_at = ?, version = ? WHERE id = ?`,
    )
      .bind(
        sanitizeLine(body.get('phone') ?? '', 40) || null,
        sanitizeLine(body.get('url') ?? '', 300) || null,
        at.slice(0, 10),
        at.slice(0, 10),
        id,
      )
      .run();
  } else if (action === 'disable' || action === 'enable') {
    await c.env.DB.prepare(`UPDATE crisis_resources SET active = ? WHERE id = ?`)
      .bind(action === 'enable' ? 1 : 0, id)
      .run();
  }

  await audit(c.env, {
    actorType: 'admin',
    actorId: g.session.user.id,
    action: 'crisis_resource.updated',
    subjectType: 'crisis_resource',
    subjectId: id,
    meta: { to_status: String(action) },
  });
  return new Response(null, { status: 302, headers: { location: '/admin/kryzys' } });
});

// ------------------------------------------------------------- user rights ---

adminApp.get('/uzytkownicy', async (c) => {
  const g = await screen(c, ['admin']);
  if ('response' in g) return g.response;
  const session = g.session;

  return page(
    c.env,
    'Dane użytkownika',
    `
<h1>Realizacja praw użytkownika</h1>
<p>Wyszukiwanie po adresie e-mail działa na nieodwracalnym skrócie — baza nie przechowuje adresu w formie
umożliwiającej przeszukiwanie.</p>

<h2>Eksport danych</h2>
<form method="post" action="/admin/uzytkownicy/eksport">
  ${csrfField(session)}
  <div class="field"><label for="e_email">Adres e-mail</label><input id="e_email" name="email" type="email" required maxlength="254"></div>
  <p><button class="btn" type="submit">Pobierz dane (JSON)</button></p>
</form>

<h2>Usunięcie danych</h2>
<div class="notice warn"><p>Operacja nieodwracalna. Usuwa dane kontaktowe i konto; sam fakt odbytej wizyty
pozostaje w formie pozbawionej danych identyfikujących, ponieważ jest potrzebny do rozliczeń.</p></div>
<form method="post" action="/admin/uzytkownicy/usun">
  ${csrfField(session)}
  <div class="field"><label for="d_email">Adres e-mail</label><input id="d_email" name="email" type="email" required maxlength="254"></div>
  <div class="checkbox"><input id="d_conf" name="confirm" type="checkbox" value="yes" required>
    <label for="d_conf">Potwierdzam żądanie usunięcia danych</label></div>
  <p><button class="btn" type="submit">Usuń dane</button></p>
</form>`,
  );
});

async function findUserIdByEmail(env: Env, email: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT id FROM users WHERE email_hash = ? AND deleted_at IS NULL`)
    .bind(await emailLookupHash(env.TOKEN_SIGNING_KEY, email.trim().toLowerCase()))
    .first<{ id: string }>();
  return row?.id ?? null;
}

adminApp.post('/uzytkownicy/eksport', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin']);
  if ('response' in g) return g.response;

  const userId = await findUserIdByEmail(c.env, body.get('email') ?? '');
  if (!userId) return page(c.env, 'Nie znaleziono', '<h1>Nie znaleziono konta o tym adresie</h1>', 404);

  const data = await exportUserData(c.env, userId);
  await audit(c.env, {
    actorType: 'admin',
    actorId: g.session.user.id,
    action: 'user.exported',
    subjectType: 'user',
    subjectId: userId,
  });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="eksport-${userId}.json"`,
      'cache-control': 'no-store',
    },
  });
});

adminApp.post('/uzytkownicy/usun', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin']);
  if ('response' in g) return g.response;
  if (body.get('confirm') !== 'yes') return page(c.env, 'Błąd', '<h1>Wymagane potwierdzenie</h1>', 400);

  const userId = await findUserIdByEmail(c.env, body.get('email') ?? '');
  if (!userId) return page(c.env, 'Nie znaleziono', '<h1>Nie znaleziono konta o tym adresie</h1>', 404);

  await eraseUserData(c.env, userId);
  await audit(c.env, {
    actorType: 'admin',
    actorId: g.session.user.id,
    action: 'user.erased',
    subjectType: 'user',
    subjectId: userId,
  });
  return page(c.env, 'Usunięto', '<h1>Dane zostały usunięte</h1><p><a href="/admin">Wróć do panelu</a></p>');
});

// ------------------------------------------------------------------ audit ---

adminApp.get('/audyt', async (c) => {
  const g = await screen(c, ['admin']);
  if ('response' in g) return g.response;

  const { results } = await c.env.DB.prepare(
    `SELECT at, actor_type, actor_id, action, subject_type, subject_id, meta_json
       FROM audit_events ORDER BY at DESC LIMIT 200`,
  ).all<{
    at: string;
    actor_type: string;
    actor_id: string | null;
    action: string;
    subject_type: string;
    subject_id: string | null;
    meta_json: string;
  }>();

  return page(
    c.env,
    'Audyt',
    `
<h1>Historia operacji</h1>
<p class="hint">Audyt nie zawiera treści zdrowotnych, danych kontaktowych ani tokenów.</p>
<div class="table-scroll"><table>
<thead><tr><th scope="col">Kiedy</th><th scope="col">Kto</th><th scope="col">Operacja</th>
<th scope="col">Obiekt</th><th scope="col">Szczegóły</th></tr></thead>
<tbody>${results
      .map(
        (e) =>
          `<tr><td>${escapeHtml(e.at)}</td><td>${escapeHtml(e.actor_type)}${e.actor_id ? ` (${escapeHtml(e.actor_id)})` : ''}</td>
           <td>${escapeHtml(e.action)}</td><td>${escapeHtml(e.subject_type)} ${escapeHtml(e.subject_id ?? '')}</td>
           <td><code>${escapeHtml(e.meta_json)}</code></td></tr>`,
      )
      .join('')}</tbody></table></div>`,
  );
});
