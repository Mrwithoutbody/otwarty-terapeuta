import { Hono } from 'hono';
import { pingIndexNow } from '../lib/indexnow';
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
import { escapeHtml, isEmail, sanitizeLine, sanitizeRichText } from '../lib/sanitize';
import { addCivilDays, civilDateIn, DEFAULT_TIMEZONE, formatDateTime, formatPrice, isIsoDate, isoOf, isValidTimezone, nowIso, weekdayOf, zonedTimeToUtc, type CivilDate } from '../lib/time';
import { verifyTurnstile } from '../lib/turnstile';
import { drainOutbox, enqueueNotification } from '../notify/outbox';
import { formValues, htmlResponse, renderPage } from './layout';
import { dictionaries, editorUrl, PagesUnavailable, PROFILE_SLUG } from './lp';
import { getPage, listPages, pagesOrigin, setPageStatus, slugOf, type PageInfo } from './pages-client';
import { getTherapist } from '../db/catalog';
import { profileContext } from './pages';
import { authoredPanel } from '../authored/panel';
import { factsForm, factsFromForm } from './admin-dane';
import { writeProfileData } from './host-write';
import type { SectionCtx } from './host-blocks';

/**
 * Admin panel. Server-rendered, CSRF-protected, least privilege:
 *
 *  - `admin`     - everything;
 *  - `therapist` - only their own pages (content is edited in the page editor),
 *                  availability and bookings;
 *  - `support`   - bookings (minimal fields) and cancellation only. Support
 *                  never sees verification notes or contact details.
 */

export const adminApp = new Hono<{ Bindings: Env }>();

// Strona autorska: osobny dokument z narzędziem i własne trasy zapisu (`src/authored/panel.ts`).
adminApp.route('/terapeuci/:id/strona', authoredPanel);


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
  // Terapeutka ma jedną stronę panelu - swoją - i wchodzi prosto do pisania strony.
  if (user.role === 'therapist' && user.therapist_id) {
    return c.redirect(`/admin/terapeuci/${encodeURIComponent(user.therapist_id)}/strona`, 302);
  }

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

${await bookingsSection(c.env, session, user.role === 'therapist' ? (user.therapist_id ?? '') : null)}

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

// --------------------------------------------------------------- bookings ---

/**
 * Rezerwacje: wszystkie na pulpicie, jej własne w zakładce jej profilu.
 *
 * Dane kontaktowe osoby rezerwującej. Terapeutka musi wiedzieć, kto przyjdzie;
 * odszyfrowujemy je dopiero tutaj, na potrzeby jednego widoku, i tylko dla
 * rezerwacji, które ten widok i tak pokazuje. Po 12 miesiącach retencja zeruje
 * te kolumny i wiersz sam przestaje mieć co pokazać.
 */
async function bookingsSection(env: Env, session: AdminSession, therapistId: string | null): Promise<string> {
  const upcoming = await env.DB.prepare(
    `SELECT b.id, b.public_ref, b.status, b.starts_at_utc, b.timezone, b.price_minor, b.currency,
            b.contact_name_enc, b.contact_email_enc, b.contact_phone_enc,
            t.display_name
       FROM bookings b JOIN therapists t ON t.id = b.therapist_id
      ${therapistId === null ? '' : 'WHERE b.therapist_id = ?'}
      ORDER BY b.starts_at_utc DESC LIMIT 25`,
  )
    .bind(...(therapistId === null ? [] : [therapistId]))
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

  const contacts = new Map<string, string>();
  for (const b of upcoming.results) {
    const parts = await Promise.all(
      [b.contact_name_enc, b.contact_email_enc, b.contact_phone_enc].map((value) =>
        value ? decryptPii(env.PII_ENC_KEY, value) : Promise.resolve(null),
      ),
    );
    const shown = parts.filter((part): part is string => part !== null && part !== '');
    if (shown.length > 0) contacts.set(b.id, shown.join(' · '));
  }

  return `<h2>Rezerwacje</h2>
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
zaszyfrowane, a po 12 miesiącach od terminu usuwa je zadanie retencyjne.</p>`;
}

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

interface EditorContext {
  /** Ile obszarów pracy ma profil - tylko dla listy braków; wybiera się je w edytorze stron. */
  topicCount: number;
  credentials: CredentialInput[];
  offers: OfferRow[];
  pages: PageInfo[];
  /** Why there is no page list: the service is down, or the profile is not saved yet. */
  pagesError: string | null;
  /** Origin of the hosted editor, for the dialog's postMessage check. */
  editorOrigin: string;
  /** Tydzień w kalendarzu zakładki „Dostępność": poniedziałek i terminy od niego. */
  monday: CivilDate;
  weekSlots: WeekSlot[];
  timeOff: Array<TimeOff & { id: string; booked: number }>;
}


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
  const context: EditorContext = {
    topicCount: 0,
    credentials: [],
    offers: [],
    pages: [],
    pagesError: 'Najpierw zapisz profil.',
    editorOrigin: pagesOrigin(env) ?? '',
    monday: mondayOf(DEFAULT_TIMEZONE),
    weekSlots: [],
    timeOff: [],
  };
  if (!therapist) return context;
  // Lista stron leży w tej bazie; usługi stron panel już nie woła.
  context.pages = await listPages(env, therapist.id);
  context.pagesError = null;

  const [topics, offers] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM therapist_specialties WHERE therapist_id = ?`)
      .bind(therapist.id)
      .first<{ n: number }>(),
    env.DB.prepare(
      `SELECT id, title, session_type, mode, duration_minutes, price_minor, currency, active, schedule
         FROM session_offers WHERE therapist_id = ? ORDER BY created_at`,
    )
      .bind(therapist.id)
      .all<OfferRow>(),
  ]);

  context.topicCount = topics?.n ?? 0;
  context.offers = offers.results;

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
    ? `<div class="notice warn"><p>Grafik układasz dla oferty — dodaj ją najpierw w cenniku na swojej stronie („Edytuj swoją stronę” w zakładce „Strony”).</p></div>`
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

/** Nowy profil: tylko imię i adres. Resztę - zdjęcie, opis, cennik - wpisuje się w edytorze strony. */
function newProfileForm(session: AdminSession): string {
  return `
<form method="post" action="/admin/terapeuci/nowy">
  ${csrfField(session)}
  <div class="field-row two">
    <div class="field"><label for="display_name">Imię i nazwisko</label>
      <input id="display_name" name="display_name" required maxlength="120"></div>
    <div class="field"><label for="slug">Adres profilu (slug)</label>
      <input id="slug" name="slug" required maxlength="80" pattern="[a-z0-9-]+"></div>
  </div>
  <p><button class="btn" type="submit">Utwórz profil</button></p>
</form>`;
}

/**
 * To, co należy do administratora, nie do terapeutki: które kwalifikacje sprawdzono,
 * czy profil jest zweryfikowany i czy stoi w katalogu. W edytorze strony tego nie ma,
 * bo edytor otwiera ona sama.
 */
function verificationForm(session: AdminSession, row: TherapistRow, context: EditorContext): string {
  return `
<form method="post" action="/admin/terapeuci/${escapeHtml(row.id)}">
  ${csrfField(session)}
  <fieldset data-repeat>
    <legend>Kwalifikacje i ich weryfikacja</legend>
    <div data-repeat-body>${[...context.credentials, { title: '', issuer: '', year: '', verified: false }]
      .map((entry, index) => credentialRow(entry, index))
      .join('')}</div>
    <template>${credentialRow(null, 0)}</template>
    <p><button type="button" class="btn secondary" data-repeat-add>Dodaj kwalifikację</button></p>
  </fieldset>
  <fieldset>
    <legend>Weryfikacja i publikacja</legend>
    <div class="field"><span class="seg-label">Status weryfikacji</span>
      ${segmented('verification_status', row.verification_status, [
        { slug: 'unverified', name_pl: 'niezweryfikowany' },
        { slug: 'verified', name_pl: 'zweryfikowany' },
        { slug: 'rejected', name_pl: 'odrzucony' },
      ])}</div>
    <div class="field"><label for="verification_notes">Notatki weryfikacyjne (prywatne, nigdy publiczne)</label>
      <textarea id="verification_notes" name="verification_notes" rows="3">${escapeHtml(row.verification_notes ?? '')}</textarea></div>
    <div class="field"><span class="seg-label">Status profilu</span>
      ${segmented('status', row.status, [
        { slug: 'draft', name_pl: 'roboczy' },
        { slug: 'published', name_pl: 'opublikowany' },
        { slug: 'unpublished', name_pl: 'wycofany' },
      ])}
      <p class="hint">Katalog publiczny pokazuje wyłącznie profile opublikowane.</p></div>
  </fieldset>
  <p><button class="btn" type="submit">Zapisz</button></p>
</form>`;
}

interface CredentialInput {
  title: string;
  issuer: string;
  year: string;
  verified: boolean;
}


function credentialRow(entry: CredentialInput | null, index: number): string {
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
  <div class="checkbox">
    <input type="checkbox" value="1" data-name="cred_verified"${nameAttr('cred_verified')}${entry?.verified ? ' checked' : ''}>
    <label data-label-for="cred_verified"${entry ? ` for="cred_verified${suffix}"` : ''}>zweryfikowane</label>
  </div>
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


/** Kwalifikacje z formularza administratora; terapeutka swoje edytuje w edytorze stron. */
function collectCredentials(body: URLSearchParams): string {
  const out: Array<{ title: string; issuer: string; year: number | null; verified: boolean }> = [];
  for (let index = 0; index < 50 && out.length < 20; index++) {
    const title = sanitizeLine(body.get(`cred_title_${index}`) ?? '', 120);
    if (!title) continue;
    const issuer = sanitizeLine(body.get(`cred_issuer_${index}`) ?? '', 120);
    const parsedYear = Number(body.get(`cred_year_${index}`) ?? '');
    const year = Number.isInteger(parsedYear) && parsedYear >= 1950 && parsedYear <= 2100 ? parsedYear : null;
    out.push({ title, issuer, year, verified: body.get(`cred_verified_${index}`) === '1' });
  }
  return JSON.stringify(out);
}


/**
 * Jej jedna strona w panelu. Treść profilu i podstron edytuje się w edytorze strony
 * (dialog nad panelem); tutaj zostaje to, czego strona nie niesie: grafik, rezerwacje
 * i - dla administratora - weryfikacja. Bez JavaScriptu zakładki leżą jedna pod drugą.
 */
function therapistTabs(
  session: AdminSession,
  row: TherapistRow,
  context: EditorContext,
  bookings: string,
  facts: string,
): string {
  const id = escapeHtml(row.id);
  const isAdmin = session.user.role === 'admin';
  const subpages = context.pages.filter((p) => p.slug !== PROFILE_SLUG);

  return `
<div class="panel-bar">
  ${isAdmin ? '<a href="/admin">← Wszystkie profile</a>' : `<span class="meta">${escapeHtml(row.display_name)}</span>`}
  <form method="post" action="/admin/logout" class="inline-form">${csrfField(session)}
    <button class="btn secondary" type="submit">Wyloguj</button></form>
</div>
<div class="tabs" data-tabs="terapeuta-v5">

<section data-tab-panel data-tab-label="Strona" id="panel-strony">
<h2>Strona o mnie</h2>
<p class="panel-lead">Piszesz ją własnymi słowami: odpowiadasz na pytania, które pacjenci naprawdę zadają, a strona składa się sama.
Ceny, terminy i kwalifikacje pokazujemy z Twoich danych.</p>
<p><a class="btn" href="/admin/terapeuci/${id}/strona">Pisz swoją stronę</a>
  <a class="btn secondary" href="/terapeuci/${escapeHtml(row.slug)}" target="_blank" rel="noopener">Zobacz ją jak pacjent</a></p>
${
  // Podstrony założone w dawnym edytorze bloków zostają dostępne; nowych już się w nim nie zakłada.
  subpages.length === 0 || context.pagesError
    ? ''
    : `<details class="more"><summary>Dodatkowe strony z dawnego edytora (${subpages.length})</summary>
<div class="table-wrap"><table class="table"><thead><tr><th>Tytuł</th><th>Adres</th><th>Stan</th></tr></thead><tbody>${subpages
        .map((p) => {
          const href = `/terapeuci/${escapeHtml(row.slug)}/${escapeHtml(p.slug)}`;
          const editor = `/admin/terapeuci/${id}/strony/${escapeHtml(p.id)}`;
          return `<tr><td><button class="link" type="button" data-editor-open data-page-editor="${editor}">${escapeHtml(p.title)}</button></td>
             <td><a href="${href}" target="_blank" rel="noopener">${href}</a></td>
             <td>${p.status === 'published' ? 'opublikowana' : 'szkic — niewidoczna publicznie'}
               <form method="post" action="${editor}/status" class="inline-form">${csrfField(session)}
               <button class="btn secondary" name="status" value="${p.status === 'published' ? 'draft' : 'published'}" type="submit">
                 ${p.status === 'published' ? 'Wycofaj' : 'Opublikuj'}</button></form></td></tr>`;
        })
        .join('')}</tbody></table></div></details>`
}
</section>

<section data-tab-panel data-tab-label="Dane i cennik" id="panel-dane">
${facts}
</section>

${availabilityTab(session, row, context)}

<section data-tab-panel data-tab-label="Rezerwacje" id="panel-rezerwacje">
${bookings}
</section>

${
  isAdmin
    ? `<section data-tab-panel data-tab-label="Weryfikacja" id="panel-weryfikacja">
<h2>Weryfikacja</h2>
${verificationForm(session, row, context)}
</section>`
    : ''
}

</div>
${
  // Poza zakładkami: dialog w ukrytym panelu (display: none) nie pokazałby się mimo showModal().
  context.pagesError
    ? ''
    : `<dialog class="editor-dialog" data-editor-dialog data-editor-origin="${escapeHtml(context.editorOrigin)}" aria-label="Edytor strony">
  <button class="btn secondary editor-close" type="button" data-editor-close>Zamknij</button>
</dialog>`
}`;
}

adminApp.get('/terapeuci/nowy', async (c) => {
  const g = await screen(c, ['admin']);
  if ('response' in g) return g.response;
  // No tabs here: availability and pages need a saved profile first.
  return page(c.env, 'Nowy profil', `<h1>Nowy profil</h1>${newProfileForm(g.session)}`);
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
  const [t, dict] = await Promise.all([getTherapist(c.env, { therapist_id: id }, { drafts: true }), dictionaries(c.env)]);
  const facts = t ? factsForm(t, dict, csrfField(session), c.req.query('zapisano') !== undefined) : '';

  return page(
    c.env,
    row.display_name,
    // Bez nagłówka nad zakładkami: imię i tak stoi w tytule karty, a wąska
    // linijka nad edytorem na całą szerokość okna wyglądała jak pomyłka.
    therapistTabs(session, row, context, await bookingsSection(c.env, session, row.id), facts),
  );
});

/** Fakty profilu (cennik, gabinet, obszary, języki, dyplomy) z zakładki „Dane i cennik”. */
adminApp.post('/terapeuci/:id/dane', async (c) => {
  const body = await formValues(c.req.raw);
  const o = await ownedTherapist(c, body);
  if ('response' in o) return o.response;
  const id = o.therapist.id;
  const written = await writeProfileData(c.env, id, factsFromForm(body, await dictionaries(c.env)));
  if ('error' in written) return page(c.env, 'Błąd', `<h1>Nie zapisano</h1><p>${escapeHtml(written.error)}</p><p><a href="/admin/terapeuci/${escapeHtml(id)}#panel-dane">Wróć</a></p>`, written.status);
  if (written.touched.length > 0) {
    await audit(c.env, { actorType: actorOf(o.session), actorId: o.session.user.id, action: 'therapist.updated', subjectType: 'therapist', subjectId: id, meta: { field: written.touched.slice(0, 8).join(','), count: written.touched.length } });
    // Cena i miasto stoją też na karcie w katalogu.
    c.executionCtx.waitUntil(pingIndexNow(c.env, [`/terapeuci/${o.therapist.slug}`, '/terapeuci']));
  }
  return c.redirect(`/admin/terapeuci/${id}?zapisano#panel-dane`, 302);
});

/**
 * Zakładanie profilu i weryfikacja: oba należą do administratora. Treść - także imię
 * i adres po założeniu - zmienia się w edytorze strony (`host-write.ts`).
 */
adminApp.post('/terapeuci/:id', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin']);
  if ('response' in g) return g.response;
  const { session } = g;
  const id = c.req.param('id');
  const at = nowIso();

  if (id === 'nowy') {
    const slug = slugOf(body.get('slug') ?? '', 80, '');
    const displayName = sanitizeLine(body.get('display_name') ?? '', 120);
    if (!slug || !displayName) return page(c.env, 'Błąd', '<h1>Podaj imię i adres profilu</h1>', 400);
    if (await c.env.DB.prepare(`SELECT 1 FROM therapists WHERE slug = ?`).bind(slug).first()) {
      return page(c.env, 'Adres zajęty', `<h1>Adres „${escapeHtml(slug)}” ma już inny profil</h1>`, 409);
    }
    // Pozostałe kolumny biorą wartości domyślne: roboczy, niezweryfikowany, bez treści.
    const created = randomId('th');
    await c.env.DB.prepare(`INSERT INTO therapists (id, slug, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(created, slug, displayName, at, at)
      .run();
    await audit(c.env, {
      actorType: 'admin',
      actorId: session.user.id,
      action: 'therapist.created',
      subjectType: 'therapist',
      subjectId: created,
      meta: { to_status: 'draft', status: 'unverified' },
    });
    return c.redirect(`/admin/terapeuci/${created}`, 302);
  }

  const existing = await getTherapistRowForAdmin(c.env, id);
  if (!existing) return page(c.env, 'Nie znaleziono', '<h1>Nie znaleziono profilu</h1>', 404);
  const pick = (name: string, allowed: string[], fallback: string): string =>
    allowed.includes(body.get(name) ?? '') ? (body.get(name) as string) : fallback;
  const verification = pick('verification_status', ['unverified', 'verified', 'rejected'], 'unverified');
  const status = pick('status', ['draft', 'published', 'unpublished'], 'draft');
  const verifiedAt = verification === 'verified' ? (existing.verification_status === 'verified' ? existing.verified_at : at) : null;

  await c.env.DB.prepare(
    `UPDATE therapists SET credentials = ?, verification_status = ?, verified_at = ?, verification_notes = ?, status = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(collectCredentials(body), verification, verifiedAt, sanitizeRichText(body.get('verification_notes') ?? '', 2000), status, at, id)
    .run();

  await audit(c.env, {
    actorType: 'admin',
    actorId: session.user.id,
    action: 'therapist.updated',
    subjectType: 'therapist',
    subjectId: id,
    meta: { to_status: status, status: verification },
  });
  // Publikacja albo zdjęcie profilu: nowy adres do pobrania albo 404 do zapomnienia.
  if (status !== existing.status) c.executionCtx.waitUntil(pingIndexNow(c.env, [`/terapeuci/${existing.slug}`, '/terapeuci']));
  return c.redirect(`/admin/terapeuci/${id}#panel-weryfikacja`, 302);
});

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

/** Publish or withdraw a subpage: a draft is served to no one and stays out of the sitemap. */
adminApp.post('/terapeuci/:id/strony/:pid/status', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await ownedTherapist(c, body);
  if ('response' in g) return g.response;
  const id = g.therapist.id;
  const status = body.get('status') === 'published' ? 'published' : 'draft';
  await setPageStatus(c.env, id, c.req.param('pid'), status);
  await audit(c.env, {
    actorType: g.session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: g.session.user.id,
    action: 'therapist.page_status_changed',
    subjectType: 'therapist',
    subjectId: id,
    meta: { page: c.req.param('pid'), status },
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
  // Terapeutka odwołuje ze swojej zakładki i tam wraca; pulpit ma tylko zespół.
  const back = g.session.user.role === 'therapist' ? `/admin/terapeuci/${row.therapist_id}#panel-rezerwacje` : '/admin';
  return new Response(null, { status: 302, headers: { location: back } });
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
