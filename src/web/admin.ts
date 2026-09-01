import { Hono } from 'hono';
import type { Env } from '../env';
import { getTherapistRowForAdmin } from '../db/catalog';
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
import { escapeHtml, isEmail, normalizeForSearch, safeUrl, sanitizeLine, sanitizeRichText } from '../lib/sanitize';
import {
  addCivilDays,
  civilDateIn,
  DEFAULT_TIMEZONE,
  formatDateTime,
  formatPrice,
  isValidTimezone,
  nowIso,
  weekdayIn,
  zonedTimeToUtc,
} from '../lib/time';
import { verifyTurnstile } from '../lib/turnstile';
import { drainOutbox, enqueueNotification } from '../notify/outbox';
import { assetUrls, htmlResponse, renderPage } from './layout';
import {
  defaultSections,
  LAYOUT_AXES,
  MAX_SECTIONS,
  parseLayout,
  parseSections,
  SECTION_GROUPS,
  SECTIONS_DEF,
  sectionAllFields,
  type SecDef,
  type Section,
  type Values,
} from './sections';
import type { BlockDef, Field as LpField } from 'x402-landings';
import {
  applyPreset,
  blockAllFields,
  BLOCKS,
  getPageById,
  HOST_BLOCKS,
  listPages,
  LP_DOC_CSS,
  LP_LAYOUT_AXES,
  lpParseLayout,
  parseBlocks,
  PRESETS,
  renderTherapistDocument,
  slugify,
  type PageRow,
} from './lp';
import { getTherapist } from '../db/catalog';
import { profileContext } from './pages';

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

function signingKey(env: Env): string {
  if (!env.TOKEN_SIGNING_KEY) throw new Error('Brak TOKEN_SIGNING_KEY.');
  return env.TOKEN_SIGNING_KEY;
}

async function formValues(request: Request): Promise<URLSearchParams> {
  const form = await request.formData();
  const params = new URLSearchParams();
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') params.append(key, value);
  }
  return params;
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
    <p class="hint">Wyślemy jednorazowy kod. Panel nie używa haseł.</p>
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

  const emailHash = await emailLookupHash(signingKey(c.env), email);

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

  /**
   * Odsłony profili z ostatnich 30 dni, jednym zapytaniem dla całej listy -
   * nie po jednym na wiersz. Agregat dobowy, bez identyfikatora osoby: to
   * odpowiedź na „ile razy oglądano", nie na „kto oglądał".
   */
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const viewRows = await c.env.DB.prepare(
    `SELECT therapist_id, source, SUM(views) AS views FROM profile_views
      WHERE day >= ? GROUP BY therapist_id, source`,
  )
    .bind(since)
    .all<{ therapist_id: string; source: 'web' | 'mcp'; views: number }>();
  const views = new Map<string, { web: number; mcp: number }>();
  for (const row of viewRows.results) {
    const entry = views.get(row.therapist_id) ?? { web: 0, mcp: 0 };
    entry[row.source] += row.views;
    views.set(row.therapist_id, entry);
  }

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
  if (c.env.PII_ENC_KEY) {
    for (const b of upcoming.results) {
      const parts = await Promise.all(
        [b.contact_name_enc, b.contact_email_enc, b.contact_phone_enc].map((value) =>
          value ? decryptPii(c.env.PII_ENC_KEY as string, value) : Promise.resolve(null),
        ),
      );
      const shown = parts.filter((part): part is string => part !== null && part !== '');
      if (shown.length > 0) contacts.set(b.id, shown.join(' · '));
    }
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
<form method="post" action="/admin/logout" style="display:inline">${csrfField(session)}
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
}

interface FaqRow {
  id: string;
  question: string;
  status: string;
  position: number;
  updated_at: string;
}

interface CredentialInput {
  title: string;
  issuer: string;
  year: string;
  verified: boolean;
}

/**
 * Everything the editor needs that does not live on the `therapists` row:
 * the controlled vocabularies, what this profile has selected from them, its
 * primary location, its offers and its FAQ.
 *
 * Loading the current selections is what makes the checkbox state truthful.
 * The previous form rendered these inputs empty while the save handler
 * replaced the relations wholesale, so every save silently dropped the
 * therapist's languages, topics and modalities.
 */
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
  links: LinkInput[];
  offers: OfferRow[];
  faq: FaqRow[];
  media: Array<{ id: string; url: string }>;
  pages: PageRow[];
}

/**
 * Two engines, one builder. The profile arranges sections from `sections.ts`;
 * a subpage arranges blocks from x402-landings. Both registries have the same
 * shape - label, hint, fields, family - so the form generator, the reader and
 * the palette are written once and handed the registry.
 */
interface BuilderDef {
  label: string;
  hint: string;
  auto?: boolean;
  resolve?: unknown;
  fields?: LpField[];
  repeatable?: boolean;
  family?: string;
}
interface Builder {
  defs: Record<string, BuilderDef>;
  groups: Array<[boolean, string]>;
  allFields(def: BuilderDef): LpField[];
  parse(raw: unknown): Section[];
}
const PROFILE_BUILDER: Builder = {
  defs: SECTIONS_DEF,
  groups: SECTION_GROUPS,
  allFields: (def) => sectionAllFields(def as SecDef),
  parse: parseSections,
};
const LP_BUILDER: Builder = {
  defs: BLOCKS,
  groups: [[true, 'Twoje dane'], [false, 'Własna treść']],
  allFields: (def) => blockAllFields(def as BlockDef),
  parse: parseBlocks,
};
/** Content from the database rather than from the form: a profile section flagged so, or a host block. */
const isAuto = (def: BuilderDef): boolean => def.auto === true || def.resolve !== undefined;

type Axes = ReadonlyArray<{ name: string; label: string; hint?: string; options: ReadonlyArray<readonly [string, string]> }>;

const SESSION_TYPE_LABELS: RefTag[] = [
  { slug: 'individual', name_pl: 'indywidualne' },
  { slug: 'couples', name_pl: 'dla par' },
  { slug: 'family', name_pl: 'rodzinne' },
];

const AGE_GROUP_LABELS: RefTag[] = [
  { slug: 'adults', name_pl: 'dorośli' },
  { slug: 'teens', name_pl: 'młodzież' },
  { slug: 'children', name_pl: 'dzieci' },
  { slug: 'seniors', name_pl: 'seniorzy' },
];

interface LinkInput {
  label: string;
  url: string;
}

/** Ten sam kształt co kwalifikacje: lista rośnie i kurczy się w formularzu. */
function parseStoredLinks(value: string | null): LinkInput[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object')
      .slice(0, 8)
      .map((entry) => ({
        label: typeof entry.label === 'string' ? entry.label : '',
        url: typeof entry.url === 'string' ? entry.url : '',
      }))
      .filter((entry) => entry.label !== '' && entry.url !== '');
  } catch {
    return [];
  }
}

/** Tolerant: a profile edited through the old free-text JSON field may hold anything. */
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

async function loadEditorContext(env: Env, therapistId: string | null): Promise<EditorContext> {
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
    links: [],
    offers: [],
    faq: [],
    media: [],
    pages: [],
  };
  if (!therapistId) return context;
  context.pages = await listPages(env, therapistId, false);

  const [chosenLanguages, chosenTopics, chosenModalities, location, offers, faq, media] = await Promise.all([
    env.DB.prepare(`SELECT language_code FROM therapist_languages WHERE therapist_id = ?`)
      .bind(therapistId)
      .all<{ language_code: string }>(),
    env.DB.prepare(`SELECT specialty_slug FROM therapist_specialties WHERE therapist_id = ?`)
      .bind(therapistId)
      .all<{ specialty_slug: string }>(),
    env.DB.prepare(`SELECT modality_slug FROM therapist_modalities WHERE therapist_id = ?`)
      .bind(therapistId)
      .all<{ modality_slug: string }>(),
    env.DB.prepare(
      `SELECT city, address_line FROM therapist_locations WHERE therapist_id = ?
        ORDER BY is_primary DESC LIMIT 1`,
    )
      .bind(therapistId)
      .first<{ city: string; address_line: string | null }>(),
    env.DB.prepare(
      `SELECT id, title, session_type, mode, duration_minutes, price_minor, currency, active
         FROM session_offers WHERE therapist_id = ? ORDER BY created_at`,
    )
      .bind(therapistId)
      .all<OfferRow>(),
    env.DB.prepare(
      `SELECT id, question, status, position, updated_at FROM faq_items
        WHERE therapist_id = ? ORDER BY position`,
    )
      .bind(therapistId)
      .all<FaqRow>(),
    env.DB.prepare(
      `SELECT id, url FROM therapist_media WHERE therapist_id = ? ORDER BY created_at DESC`,
    )
      .bind(therapistId)
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
/**
 * How the page is presented, above the list of what is on it. Two selects, not
 * ten: the sections carry the content, this carries the shape.
 */
function layoutChoice(axes: Axes, layout: Record<string, string>): string {
  const field = (axis: Axes[number]): string => `<div class="field">
    <label for="layout_${escapeHtml(axis.name)}">${escapeHtml(axis.label)}</label>
    <select id="layout_${escapeHtml(axis.name)}" name="layout_${escapeHtml(axis.name)}">${axis.options
      .map(([value, label]) =>
        `<option value="${escapeHtml(value)}"${value === layout[axis.name] ? ' selected' : ''}>${escapeHtml(label)}</option>`)
      .join('')}</select>
    ${axis.hint ? `<p class="hint">${escapeHtml(axis.hint)}</p>` : ''}
  </div>`;

  return `<fieldset class="sec-layout">
  <legend>Sposób podania</legend>
  ${axes.map(field).join('')}
</fieldset>`;
}

/** What the selects posted, validated by the same reader the page uses. */
function collectLayout(axes: Axes, parse: (raw: unknown) => Record<string, string>, body: URLSearchParams): string {
  const posted: Record<string, unknown> = {};
  for (const axis of axes) posted[axis.name] = body.get(`layout_${axis.name}`);
  return JSON.stringify(parse(posted));
}

function sectionsEditor(row: TherapistRow | null, context: EditorContext): string {
  const stored = parseSections(row?.sections_json ?? null);
  return editorList(PROFILE_BUILDER, stored.length > 0 ? stored : defaultSections(), autoSummary(row, context));
}

function editorList(
  b: Builder,
  sections: Section[],
  summary: Record<string, { text: string; empty?: true } | undefined>,
): string {
  const rows = sections
    .map((section, index) => {
      const def = b.defs[section.type];
      if (!def) return '';
      // A section with nothing in it is listed but says so, and an auto one says
      // what it holds today - otherwise the screen is ten names and no content.
      const holds = summary[section.type];
      const empty = isAuto(def)
        ? holds?.empty === true
        : filled(def.fields ?? [], section, true) === 0;
      return `<li class="sec-item" data-section draggable="true">
  <div class="sec-head">
    <span class="grip" aria-hidden="true">⠿</span>
    <span class="sec-copy"><strong>${escapeHtml(def.label)}</strong>
      <span>${escapeHtml(isAuto(def) ? (holds?.text ?? def.hint) : def.hint)}${
        empty ? ' · sekcja się nie pokaże' : ''
      }</span></span>
    <input type="hidden" name="sec_${index}_type" value="${escapeHtml(section.type)}">
    <label class="sec-pos"><span class="visually-hidden">Pozycja sekcji ${escapeHtml(def.label)}</span>
      <input type="number" name="sec_${index}_pos" value="${index + 1}" min="1" max="${MAX_SECTIONS}" data-section-pos></label>
    <label class="sec-del"><input type="checkbox" name="sec_${index}_del" value="1"><span>usuń</span></label>
  </div>
  ${sectionFields(b, def, section, index)}
</li>`;
    })
    .join('');

  const families = new Set(
    sections.map((section) => b.defs[section.type]?.family).filter((f): f is string => !!f),
  );
  const palette = b.groups.map(([auto, label]) => {
    const options = Object.entries(b.defs)
      .filter(([type, def]) => isAuto(def) === auto
        && (def.repeatable === true || !sections.some((s) => s.type === type))
        && (def.family === undefined || !families.has(def.family)))
      .map(([type, def]) => `<option value="${escapeHtml(type)}">${escapeHtml(def.label)} — ${escapeHtml(def.hint)}</option>`)
      .join('');
    return options === '' ? '' : `<optgroup label="${escapeHtml(label)}">${options}</optgroup>`;
  }).join('');

  return `<ol class="sec-list">${rows}</ol>
<div class="sec-add">
  <label for="add_section"><span class="visually-hidden">Rodzaj sekcji</span>
    <select id="add_section" name="add_section"><option value="">— wybierz sekcję do dodania —</option>${palette}</select></label>
  <button class="btn secondary" type="submit" name="action" value="add_section">Dodaj sekcję</button>
</div>`;
}

/**
 * How many of a section's fields carry something. `skipTitles` ignores the
 * heading and the lead, which every section has and neither of which counts as
 * content of its own.
 */
function filled(fields: LpField[], values: Values, skipTitles = false): number {
  return fields.filter((field) => {
    if (skipTitles && (field.name === 'heading' || field.name === 'lead')) return false;
    const value = values[field.name];
    return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim() !== '';
  }).length;
}

/**
 * Fields for one section, generated from its definition and folded away.
 * Eight sections with their fields all open is a wall of empty inputs; the
 * summary says whether there is anything inside worth opening.
 */
function sectionFields(b: Builder, def: BuilderDef, section: Section, index: number): string {
  const fields = b.allFields(def)
    .map((field) => sectionField(field, section[field.name], `sec_${index}_${field.name}`))
    .join('');
  if (fields === '') return '';
  // The presentation selects are not content: they never count towards the
  // summary and never force the section open.
  const own = def.fields ?? [];
  const count = filled(own, section);
  const summary = own.length === 0
    ? 'Wygląd sekcji'
    : count > 0 ? `Treść (${count} ${count === 1 ? 'pole' : 'pola'})` : 'Wpisz treść';
  return `<details class="sec-fields"${own.length > 0 && count === 0 ? ' open' : ''}>
  <summary>${escapeHtml(summary)}</summary>
  <div class="sec-fields-body">${fields}</div>
</details>`;
}

function linkRow(entry: LinkInput | null, index: number): string {
  const suffix = entry ? `_${index}` : '';
  const nameAttr = (base: string): string => (entry ? ` name="${base}${suffix}" id="${base}${suffix}"` : '');
  return `<div class="repeat-row" data-repeat-row>
  <div class="field">
    <label data-label-for="link_label"${entry ? ` for="link_label${suffix}"` : ''}>Nazwa</label>
    <input data-name="link_label"${nameAttr('link_label')} maxlength="40" placeholder="Facebook" value="${escapeHtml(entry?.label ?? '')}">
  </div>
  <div class="field">
    <label data-label-for="link_url"${entry ? ` for="link_url${suffix}"` : ''}>Adres (https)</label>
    <input data-name="link_url"${nameAttr('link_url')} type="url" maxlength="500" placeholder="https://" value="${escapeHtml(entry?.url ?? '')}">
  </div>
  <button type="button" class="repeat-remove" data-repeat-remove>Usuń</button>
</div>`;
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

/**
 * Reads the repeatable credential rows. Rows are named `cred_*_<index>`; the
 * scan tolerates gaps so a row removed in the browser needs no renumbering.
 *
 * `verified` is a trust signal shown on the public profile. A therapist must
 * not be able to award it to themselves, so only an administrator may set it,
 * and a therapist's own save preserves whatever the administrator decided.
 */
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

function collectLinks(body: URLSearchParams): string {
  const out: LinkInput[] = [];
  for (let index = 0; index < 20 && out.length < 8; index++) {
    const label = sanitizeLine(body.get(`link_label_${index}`) ?? '', 40);
    const url = safeUrl(sanitizeLine(body.get(`link_url_${index}`) ?? '', 500));
    if (!label || !url) continue;
    out.push({ label, url });
  }
  return JSON.stringify(out);
}

/** Matches a submitted credential against the ones already stored. */
function credentialKey(title: string, issuer: string): string {
  return `${normalizeForSearch(title)}|${normalizeForSearch(issuer)}`;
}

function sectionField(field: LpField, value: unknown, name: string): string {
  const label = `<label for="${name}">${escapeHtml(field.label)}</label>`;
  const hint = field.hint ? `<p class="hint">${escapeHtml(field.hint)}</p>` : '';

  if (field.kind === 'list') {
    const existing = Array.isArray(value) ? (value as Values[]) : [];
    // One spare row so something can always be added without JavaScript.
    const count = Math.min((field.max ?? 6), existing.length + 1);
    const rows = Array.from({ length: count }, (_, i) => {
      const item = existing[i] ?? {};
      const inner = (field.of ?? [])
        .map((sub) => sectionField(sub, item[sub.name], `${name}_${i}_${sub.name}`))
        .join('');
      return `<li class="sec-subrow">${inner}</li>`;
    }).join('');
    return `<fieldset class="sec-list-field"><legend>${escapeHtml(field.label)}</legend>${hint}<ol>${rows}</ol></fieldset>`;
  }

  const text = typeof value === 'string' ? value : '';
  if (field.kind === 'textarea') {
    return `<div class="field">${label}<textarea id="${name}" name="${escapeHtml(name)}" rows="4"
      maxlength="${field.max ?? 2000}">${escapeHtml(text)}</textarea>${hint}</div>`;
  }
  if (field.kind === 'select') {
    return `<div class="field">${label}<select id="${name}" name="${escapeHtml(name)}">${(field.options ?? [])
      .map(([v, l]) => `<option value="${escapeHtml(v)}"${text === v ? ' selected' : ''}>${escapeHtml(l)}</option>`)
      .join('')}</select>${hint}</div>`;
  }
  if (field.kind === 'media') {
    // A picture is an address here: hers from the "Grafiki" tab, or nothing for
    // artwork drawn in the page theme. The engine reads a bare URL as a media ref.
    const media = typeof value === 'object' && value !== null ? String((value as Values).url ?? '') : text;
    return `<div class="field">${label}<input id="${name}" name="${escapeHtml(name)}" type="text"
    maxlength="500" placeholder="/media/… albo https://…" value="${escapeHtml(media)}">${hint}</div>`;
  }
  return `<div class="field">${label}<input id="${name}" name="${escapeHtml(name)}" type="${field.kind === 'url' ? 'url' : 'text'}"
    maxlength="${field.max ?? 120}" value="${escapeHtml(text)}">${hint}</div>`;
}


/**
 * What each auto section will actually put on the page. "Twój opis i nurt pracy"
 * says what the section is for; this says what is in it right now and where it
 * comes from, which is the thing that was missing - a builder listing ten
 * section names and no content reads as an empty screen.
 */
function autoSummary(
  row: TherapistRow | null,
  context: EditorContext,
): Record<string, { text: string; empty?: true }> {
  const count = (n: number, one: string, few: string, many: string): string =>
    `${n} ${n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;

  const bio = (row?.bio ?? '').trim();
  const firstMeeting = [row?.first_meeting_course, row?.first_meeting_prep, row?.first_meeting_decision]
    .filter((x) => (x ?? '').trim() !== '').length;
  const credentials = parseStoredCredentials(row?.credentials ?? null).length;
  const links = parseStoredLinks(row?.links ?? null).length;

  return {
    hero: { text: `imię, zdjęcie i ${links > 0 ? count(links, 'link', 'linki', 'linków') : 'fakty'} — z zakładki O mnie` },
    'hero-obietnica': { text: 'Twoje zdanie w tytule, nazwisko na karcie' },
    'hero-spotlight': { text: 'imię i zdanie na powitanie' },
    'hero-okladka': { text: 'imię, zdjęcie i najbliższy termin' },
    kluczowe: { text: 'cena, długość sesji i najbliższy termin' },
    dane: { text: 'wszystkie fakty z zakładek O mnie, Oferta i Dostępność' },
    intro: bio === ''
      ? { text: 'pusty opis — uzupełnij w zakładce O mnie', empty: true }
      : { text: `${count(bio.length, 'znak', 'znaki', 'znaków')} opisu` },
    first_meeting: firstMeeting === 0
      ? { text: 'trzy pytania bez odpowiedzi — wypełnij w zakładce O mnie', empty: true }
      : { text: count(firstMeeting, 'odpowiedź', 'odpowiedzi', 'odpowiedzi') },
    topics: context.chosenTopics.size === 0
      ? { text: 'brak obszarów — zaznacz w zakładce O mnie', empty: true }
      : { text: count(context.chosenTopics.size, 'obszar', 'obszary', 'obszarów') },
    offers: context.offers.length === 0
      ? { text: 'brak ofert — dodaj w zakładce Oferta', empty: true }
      : { text: count(context.offers.length, 'oferta', 'oferty', 'ofert') },
    'oferta-lista': context.offers.length === 0
      ? { text: 'brak ofert — dodaj w zakładce Oferta', empty: true }
      : { text: count(context.offers.length, 'oferta', 'oferty', 'ofert') },
    zestawienie: { text: 'oferta i najbliższe terminy obok siebie' },
    slots: { text: 'wolne terminy z zakładki Dostępność' },
    faq: context.faq.length === 0
      ? { text: 'brak pytań — dodaj w zakładce FAQ', empty: true }
      : { text: count(context.faq.length, 'pytanie', 'pytania', 'pytań') },
    credentials: credentials === 0
      ? { text: 'brak kwalifikacji — wypełnij w zakładce O mnie', empty: true }
      : { text: count(credentials, 'kwalifikacja', 'kwalifikacje', 'kwalifikacji') },
    policy: { text: 'wyliczone z Twojego wyprzedzenia' },
    zaproszenie: { text: 'zaproszenie zbudowane z Twoich danych' },
  };
}


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

const DEFAULT_SLOT_HOURS = [9, 11, 13, 15];
/** Slots start on the hour, so the whole range fits in 24 chips. */
const SLOT_HOUR_RANGE = Array.from({ length: 24 }, (_, hour) => hour);

function hourGrid(checked: number[]): string {
  return `<div class="hour-grid">${SLOT_HOUR_RANGE.map((hour) => {
    const label = `${String(hour).padStart(2, '0')}:00`;
    return `<input id="hours-${hour}" type="checkbox" name="hours" value="${hour}"${
      checked.includes(hour) ? ' checked' : ''
    }><label for="hours-${hour}">${label}</label>`;
  }).join('')}</div>`;
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
</li>`;
    })
    .join('');
  return `<fieldset class="media-gallery">
  <legend>Grafiki profilu</legend>
  <p class="hint">Każdy wgrany plik zostaje tutaj. Portret to jedna z grafik — podmiana nic nie kasuje.</p>
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
  const credentials = context.credentials;
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

  <div class="field" data-editor data-editor-label="bio-label">
    <label id="bio-label" for="bio">Opis doświadczenia i sposobu pracy</label>
    <textarea id="bio" name="bio" rows="10" maxlength="4000" data-editor-value>${v('bio')}</textarea>
    <p class="hint">Pusty wiersz rozdziela akapity. Zaznacz tekst i użyj „Pogrub” albo Ctrl+B.</p>
  </div>

  ${photoField(session, row)}

  <div class="field-row two">
    <div class="field"><label for="city">Miejscowość (gabinet)</label>
      <input id="city" name="city" maxlength="80" value="${escapeHtml(context.city)}"></div>
    <div class="field"><label for="address_line">Adres gabinetu</label>
      <input id="address_line" name="address_line" maxlength="160" value="${escapeHtml(context.addressLine)}"></div>
  </div>
  <p class="hint">Wyczyszczenie miejscowości usuwa adres gabinetu z profilu publicznego.</p>

  <fieldset>
    <legend>Pierwsze spotkanie</legend>
    <p class="hint">To jest najczęstsze pytanie osoby, która zastanawia się, czy się odezwać.
    Odpowiedz krótko i po swojemu — każde pole możesz zostawić puste, wtedy się nie pokaże.</p>
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
    ${checkboxGrid('session_types', SESSION_TYPE_LABELS, sessionTypes)}</fieldset>
  <fieldset><legend>Grupy wiekowe</legend>
    ${checkboxGrid('age_groups', AGE_GROUP_LABELS, ageGroups)}</fieldset>
  <fieldset><legend>Języki</legend>
    ${checkboxGrid('languages', context.languages, context.chosenLanguages)}</fieldset>
  <fieldset><legend>Obszary pracy</legend>
    ${checkboxGrid('topics', context.specialties, context.chosenTopics)}</fieldset>
  <fieldset><legend>Nurty</legend>
    ${checkboxGrid('modalities', context.modalities, context.chosenModalities)}</fieldset>

  <fieldset data-repeat>
    <legend>Kwalifikacje</legend>
    <!-- One spare row is always rendered, so adding a credential works without JavaScript. -->
    <div data-repeat-body>${[...credentials, { title: '', issuer: '', year: '', verified: false }]
      .map((entry, index) => credentialRow(entry, index, isAdmin))
      .join('')}</div>
    <template>${credentialRow(null, 0, isAdmin)}</template>
    <p><button type="button" class="btn secondary" data-repeat-add>Dodaj kwalifikację</button></p>
    ${
      isAdmin
        ? '<p class="hint">„Zweryfikowane” oznacza, że zespół widział dokument. Terapeuta nie może ustawić tego sam.</p>'
        : '<p class="hint">Oznaczenie „zweryfikowane” nadaje wyłącznie zespół po sprawdzeniu dokumentu.</p>'
    }
  </fieldset>

  <fieldset data-repeat>
    <legend>Linki i wizytówki</legend>
    <div data-repeat-body>${[...context.links, { label: '', url: '' }]
      .map((entry, index) => linkRow(entry, index))
      .join('')}</div>
    <template>${linkRow(null, 0)}</template>
    <p><button type="button" class="btn secondary" data-repeat-add>Dodaj link</button></p>
    <p class="hint">Facebook, Instagram, wizytówka Google, własna strona. Tylko adresy https.
      Wizytówkę Google skopiuj przyciskiem „Udostępnij” z panelu firmy — adres z paska wyszukiwarki
      niesie parametry sesji i po czasie przestaje działać.</p>
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
function therapistTabs(session: AdminSession, row: TherapistRow, context: EditorContext): string {
  const activeOffers = context.offers.filter((offer) => offer.active === 1);
  const id = escapeHtml(row.id);

  return `
<p class="tabs-lead">W zakładkach <strong>O mnie</strong>, <strong>Oferta</strong>,
<strong>Dostępność</strong> i <strong>FAQ</strong> wpisujesz treść — każdą rzecz raz.
W zakładce <strong>Układ strony</strong> decydujesz, co z tego i w jakiej kolejności
zobaczy osoba, która trafi na Twój profil.</p>

<div class="tabs" data-tabs="terapeuta-v3">

<section data-tab-panel data-tab-label="O mnie" id="panel-profil">
<h2 class="visually-hidden">O mnie</h2>
<p class="panel-lead">Kim jesteś i jak pracujesz: opis, zdjęcie, gabinet, obszary, nurty,
kwalifikacje. Po tych danych wyszukiwarka dobiera Cię do osoby, która szuka pomocy.</p>
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
    : `<div class="table-scroll"><table>
<thead><tr><th scope="col">Nazwa</th><th scope="col">Forma</th><th scope="col">Czas</th>
<th scope="col">Cena</th><th scope="col">Aktywna</th></tr></thead>
<tbody>${context.offers
        .map(
          (offer) =>
            `<tr><td>${escapeHtml(offer.title)}</td>
             <td>${escapeHtml(offer.mode)} / ${escapeHtml(offer.session_type)}</td>
             <td>${offer.duration_minutes} min</td>
             <td>${escapeHtml(formatPrice(offer.price_minor, offer.currency))}</td>
             <td>${offer.active ? 'tak' : 'nie'}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
}
</section>

<section data-tab-panel data-tab-label="Dostępność" id="panel-terminy">
<h2>Dostępność</h2>
<p class="panel-lead">Wolne terminy do rezerwacji. Każdy termin należy do konkretnej oferty,
więc najpierw dodaj ofertę.</p>
${
  activeOffers.length === 0
    ? `<div class="notice warn"><p>Terminy powstają dla konkretnej oferty. Dodaj najpierw ofertę
       w zakładce „Oferta”.</p></div>`
    : `<form method="post" action="/admin/terapeuci/${id}/terminy">
  ${csrfField(session)}
  <div class="field"><label for="t_offer">Oferta</label>
    <select id="t_offer" name="offer_id" required>
      ${activeOffers
        .map(
          (offer) =>
            `<option value="${escapeHtml(offer.id)}">${escapeHtml(offer.title)} — ${escapeHtml(offer.mode)}, ${offer.duration_minutes} min, ${escapeHtml(formatPrice(offer.price_minor, offer.currency))}</option>`,
        )
        .join('')}
    </select></div>
  <div class="field"><label for="t_days">Liczba dni do wygenerowania</label>
    <input id="t_days" name="days" type="number" min="1" max="60" value="14"></div>
  <fieldset>
    <legend>Godziny rozpoczęcia</legend>
    ${hourGrid(DEFAULT_SLOT_HOURS)}
    <p class="hint">Terminy powstają w dni robocze, o każdej zaznaczonej godzinie.</p>
  </fieldset>
  <div class="field"><label for="t_tz">Strefa czasowa terapeuty</label>
    <input id="t_tz" name="timezone" value="${escapeHtml(row.timezone ?? 'Europe/Warsaw')}" maxlength="64">
    <p class="hint">Godziny powyżej są godzinami lokalnymi w tej strefie. Zmiana czasu jest uwzględniana automatycznie.</p></div>
  <p><button class="btn" type="submit">Wygeneruj wolne terminy</button></p>
</form>`
}

<h3>Blokowanie terminu</h3>
<form method="post" action="/admin/terapeuci/${id}/blokuj">
  ${csrfField(session)}
  <div class="field-row two">
    <div class="field"><label for="b_slot">Identyfikator terminu (slot_id)</label><input id="b_slot" name="slot_id" required maxlength="64"></div>
    <div class="field"><label for="b_reason">Powód</label><input id="b_reason" name="reason" maxlength="120"></div>
  </div>
  <p><button class="btn secondary" type="submit">Zablokuj termin</button></p>
</form>
</section>

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
             <td><form method="post" action="/admin/faq/${escapeHtml(item.id)}/status" style="display:inline">
               ${csrfField(session)}
               <button class="btn secondary" name="status" value="${item.status === 'published' ? 'draft' : 'published'}" type="submit">
                 ${item.status === 'published' ? 'Wycofaj' : 'Opublikuj'}</button>
             </form></td></tr>`,
        )
        .join('')}</tbody></table></div>`
}
</section>

<section data-tab-panel data-tab-label="Układ strony" id="panel-strona">
<h2>Układ strony</h2>
<p class="panel-lead">Po lewej układasz, po prawej widzisz efekt. Podgląd odświeża się po
każdym zapisie.</p>
<div class="composer-split">
<form method="post" action="/admin/terapeuci/${id}/sekcje" class="composer" data-composer>
  ${csrfField(session)}
  <p class="sec-save"><button class="btn" type="submit">Zapisz układ strony</button></p>
  ${layoutChoice(LAYOUT_AXES, parseLayout(row.layout_json))}
  <p class="hint">Przeciągnij sekcję, żeby zmienić kolejność i dodawaj kolejne.
  Sekcja, w której nic nie ma, nie pokaże się na stronie. Góra profilu (zdjęcie, imię, cena,
  najbliższy termin) jest u wszystkich taka sama, żeby dało się porównywać terapeutów między sobą.</p>
  ${sectionsEditor(row, context)}
  <p class="sec-save"><button class="btn" type="submit">Zapisz układ strony</button></p>
</form>
<aside class="composer-preview">
  <p class="hint">Podgląd — <a href="/terapeuci/${escapeHtml(row.slug)}" target="_blank" rel="noopener">otwórz w nowej karcie ↗</a></p>
  <iframe src="/terapeuci/${escapeHtml(row.slug)}" title="Podgląd Twojej strony profilowej"></iframe>
</aside>
</div>
</section>

<section data-tab-panel data-tab-label="Podstrony" id="panel-strony">
<h2>Podstrony</h2>
<p class="panel-lead">Osobne strony obok profilu: landing pod kampanię, terapia grupowa, warsztat,
wyjazd. Każda ma własny adres pod Twoim profilem i własny układ; kalendarz, oferta i FAQ
wchodzą na nią z Twoich danych.</p>
${
  context.pages.length === 0
    ? '<p class="hint">Nie masz jeszcze żadnej podstrony.</p>'
    : `<div class="table-wrap"><table class="table"><thead><tr><th>Tytuł</th><th>Adres</th><th>Stan</th><th></th></tr></thead><tbody>${context.pages
        .map(
          (p) => `<tr><td>${escapeHtml(p.title)}</td>
             <td><a href="/terapeuci/${escapeHtml(row.slug)}/${escapeHtml(p.slug)}" target="_blank" rel="noopener">/${escapeHtml(p.slug)}</a></td>
             <td>${p.status === 'published' ? 'opublikowana' : 'szkic'}</td>
             <td><a class="btn secondary" href="/admin/terapeuci/${id}/strony/${escapeHtml(p.id)}">Edytuj</a></td></tr>`,
        )
        .join('')}</tbody></table></div>`
}
<form method="post" action="/admin/terapeuci/${id}/strony">
  ${csrfField(session)}
  <div class="field"><label for="page_title">Tytuł nowej podstrony</label>
    <input id="page_title" name="title" required maxlength="140" placeholder="np. Grupa wsparcia dla rodziców"></div>
  <div class="field"><label for="page_preset">Szablon</label>
    <select id="page_preset" name="preset">${Object.entries(PRESETS)
      .map(([key, p]) => `<option value="${escapeHtml(key)}">${escapeHtml(p.label)} — ${escapeHtml(p.hint)}</option>`)
      .join('')}</select>
    <p class="hint">Szablon ustawia motyw, układ i szkielet bloków. Wszystko da się potem zmienić w edytorze.</p></div>
  <button class="btn" type="submit">Utwórz podstronę</button>
</form>
</section>

</div>`;
}

adminApp.get('/terapeuci/nowy', async (c) => {
  const session = await loadAdminSession(c.env, c.req.raw);
  if (!session) return page(c.env, 'Zaloguj się', loginForm(c.env), 401, true);
  if (session.user.role !== 'admin') {
    return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);
  }
  const context = await loadEditorContext(c.env, null);
  // No tabs here: FAQ, offers and availability all need a saved profile first.
  return page(
    c.env,
    'Nowy profil',
    `<h1>Nowy profil</h1>${therapistForm(session, null, context)}`,
  );
});

adminApp.get('/terapeuci/:id', async (c) => {
  const session = await loadAdminSession(c.env, c.req.raw);
  if (!session) return page(c.env, 'Zaloguj się', loginForm(c.env), 401, true);
  const id = c.req.param('id');
  if (!ownsTherapist(session.user, id)) {
    return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1><p>Możesz edytować wyłącznie własny profil.</p>', 403);
  }
  const row = await getTherapistRowForAdmin(c.env, id);
  if (!row) return page(c.env, 'Nie znaleziono', '<h1>Nie znaleziono profilu</h1>', 404);

  const context = await loadEditorContext(c.env, id);
  context.credentials = parseStoredCredentials(row.credentials);
  context.links = parseStoredLinks(row.links);

  return page(
    c.env,
    row.display_name,
    `<h1>Profil: ${escapeHtml(row.display_name)}</h1>${therapistTabs(session, row, context)}`,
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
/**
 * Every section posts its type, its position and its own fields. Positions
 * survive without JavaScript; the drag-and-drop only rewrites them. The result
 * goes through the engine's own parser before it is stored, so an unknown type,
 * an unknown field or an over-long string never reaches the database.
 */
function collectSections(b: Builder, body: URLSearchParams): string {
  const found: Array<{ pos: number; index: number; section: Section }> = [];

  for (const index of postedSections(body)) {
    const type = body.get(`sec_${index}_type`);
    if (!type || body.get(`sec_${index}_del`) === '1') continue;
    const def = b.defs[type];
    if (!def) continue;

    const section: Section = { type };
    for (const field of b.allFields(def)) {
      const value = readField(body, field, `sec_${index}_${field.name}`);
      if (value !== undefined) section[field.name] = value;
    }
    found.push({ pos: Number(body.get(`sec_${index}_pos`) ?? index + 1) || index + 1, index, section });
  }

  found.sort((a, b) => a.pos - b.pos || a.index - b.index);
  const sections = found.map((entry) => entry.section);

  // "Add section" is a submit button, so the profile saves and comes back with
  // the new section appended - one round trip, no JavaScript required.
  const added = body.get('action') === 'add_section' ? (body.get('add_section') ?? '') : '';
  const def = added === '' ? undefined : b.defs[added];
  if (def && sections.length < MAX_SECTIONS) {
    const repeated = sections.some((s) => s.type === added);
    const familyTaken =
      def.family !== undefined && sections.some((s) => b.defs[s.type]?.family === def.family);
    if ((def.repeatable === true || !repeated) && !familyTaken) sections.push({ type: added });
  }

  return JSON.stringify(b.parse(sections));
}

/** Which section indexes the form actually posted, in the order it posted them. */
function postedSections(body: URLSearchParams): number[] {
  const seen = new Set<number>();
  for (const key of body.keys()) {
    const match = /^sec_(\d+)_type$/.exec(key);
    if (match) seen.add(Number(match[1]));
  }
  return [...seen];
}

function readField(body: URLSearchParams, field: LpField, name: string): unknown {
  if (field.kind === 'list') {
    const rows: Values[] = [];
    for (let i = 0; i < (field.max ?? 6); i++) {
      const item: Values = {};
      for (const sub of field.of ?? []) {
        const value = readField(body, sub, `${name}_${i}_${sub.name}`);
        if (value !== undefined) item[sub.name] = value;
      }
      if (Object.keys(item).length > 0) rows.push(item);
    }
    return rows.length > 0 ? rows : undefined;
  }
  const raw = body.get(name);
  if (raw === null) return undefined;
  const value = raw.trim();
  return value === '' ? undefined : value;
}


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
    bio: sanitizeRichText(body.get('bio') ?? '', 4000),
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
    credentials: collectCredentials(body, isAdmin, parseStoredCredentials(existing?.credentials ?? null)),
    links: collectLinks(body),
    first_meeting_course: sanitizeLine(body.get('first_meeting_course') ?? '', 400),
    first_meeting_prep: sanitizeLine(body.get('first_meeting_prep') ?? '', 400),
    first_meeting_decision: sanitizeLine(body.get('first_meeting_decision') ?? '', 400),
  };
  const verifiedAt =
    values.verification_status === 'verified'
      ? (existing?.verification_status === 'verified' ? existing.verified_at : at)
      : null;


  if (isNew) {
    await c.env.DB.prepare(
      `INSERT INTO therapists (id, slug, display_name, headline, bio, photo_url, offers_online, offers_in_person,
                               accepting_new_clients, age_groups, session_types, credentials, links,
                               first_meeting_course, first_meeting_prep, first_meeting_decision,
                               verification_status, verified_at, verification_notes, status, is_demo, timezone,
                               cancellation_policy, cancellation_cutoff_h, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'Europe/Warsaw',?,?,?,?)`,
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
  } else {
    await c.env.DB.prepare(
      `UPDATE therapists SET slug=?, display_name=?, headline=?, bio=?, photo_url=?, offers_online=?,
              offers_in_person=?, accepting_new_clients=?, age_groups=?, session_types=?, credentials=?, links=?,
              first_meeting_course=?, first_meeting_prep=?, first_meeting_decision=?,
              verification_status=?, verified_at=?, verification_notes=?, status=?, cancellation_policy=?,
              cancellation_cutoff_h=?, updated_at=? WHERE id=?`,
    )
      .bind(
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
        therapistIdValue,
      )
      .run();
  }

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

/**
 * The page layout saves on its own, separately from the profile form. Adding a
 * section used to submit the whole profile - relations included, which are
 * replaced wholesale - just to append one empty section.
 */
adminApp.post('/terapeuci/:id/sekcje', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin', 'therapist']);
  if ('response' in g) return g.response;
  const id = c.req.param('id');
  if (!ownsTherapist(g.session.user, id)) return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);

  const sections = collectSections(PROFILE_BUILDER, body);
  await c.env.DB.prepare(`UPDATE therapists SET sections_json=?, layout_json=?, updated_at=? WHERE id=?`)
    .bind(sections, collectLayout(LAYOUT_AXES, parseLayout, body), nowIso(), id)
    .run();

  await audit(c.env, {
    actorType: g.session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: g.session.user.id,
    action: 'therapist.sections_updated',
    subjectType: 'therapist',
    subjectId: id,
    meta: { count: JSON.parse(sections).length },
  });
  return new Response(null, { status: 302, headers: { location: `/admin/terapeuci/${id}#panel-strona` } });
});

// ---------------------------------------------------------------- podstrony ---

/** Session, ownership and the page itself. A posted body means CSRF is checked too. */
async function ownedPage(
  c: { env: Env; req: { raw: Request; param(name: string): string } },
  body: URLSearchParams | null,
): Promise<{ session: AdminSession; row: PageRow; therapist: TherapistRow } | { response: Response }> {
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
  const [therapist, row] = await Promise.all([getTherapistRowForAdmin(c.env, id), getPageById(c.env, id, c.req.param('pid'))]);
  if (!therapist || !row) return { response: page(c.env, 'Nie znaleziono', '<h1>Nie znaleziono podstrony</h1>', 404) };
  return { session, row, therapist };
}

/** A free slug under her profile: the title, and a counter when she reuses one. */
async function freePageSlug(env: Env, therapistId: string, title: string): Promise<string> {
  const base = slugify(title).slice(0, 48) || 'strona';
  const taken = new Set(
    (await env.DB.prepare(`SELECT slug FROM therapist_pages WHERE therapist_id = ?`).bind(therapistId).all<{ slug: string }>())
      .results.map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

adminApp.post('/terapeuci/:id/strony', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin', 'therapist']);
  if ('response' in g) return g.response;
  const id = c.req.param('id');
  if (!ownsTherapist(g.session.user, id)) return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);

  const title = sanitizeLine(body.get('title') ?? '', 140);
  if (title === '') return c.redirect(`/admin/terapeuci/${id}#panel-strony`, 303);
  const pid = randomId('pg');
  const at = nowIso();
  const preset = applyPreset(body.get('preset') ?? '', title);
  await c.env.DB.prepare(
    `INSERT INTO therapist_pages (id, therapist_id, slug, title, status, blocks_json, layout_json, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, 0, ?, ?)`,
  )
    .bind(pid, id, await freePageSlug(c.env, id, title), title, JSON.stringify(preset.blocks), JSON.stringify(preset.layout), at, at)
    .run();
  await audit(c.env, {
    actorType: g.session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: g.session.user.id,
    action: 'therapist.page_created',
    subjectType: 'therapist',
    subjectId: id,
    meta: { page: pid },
  });
  return c.redirect(`/admin/terapeuci/${id}/strony/${pid}`, 303);
});

function pageEditor(session: AdminSession, therapist: TherapistRow, row: PageRow, context: EditorContext): string {
  const id = escapeHtml(therapist.id);
  const pid = escapeHtml(row.id);
  // Host blocks show what the database holds for them today, like the profile's auto sections.
  const profileSummary = autoSummary(therapist, context);
  const summary = Object.fromEntries(Object.entries(HOST_BLOCKS).map(([block, section]) => [block, profileSummary[section]]));
  const preview = `/admin/terapeuci/${id}/strony/${pid}/podglad`;

  return `<p><a href="/admin/terapeuci/${id}#panel-strony">← Profil: ${escapeHtml(therapist.display_name)}</a></p>
<h1>Podstrona: ${escapeHtml(row.title)}</h1>
<div class="composer-split">
<form method="post" action="/admin/terapeuci/${id}/strony/${pid}" class="composer" data-composer>
  ${csrfField(session)}
  <div class="field"><label for="page_title">Tytuł</label>
    <input id="page_title" name="title" required maxlength="140" value="${escapeHtml(row.title)}"></div>
  <div class="field"><label for="page_slug">Adres</label>
    <input id="page_slug" name="slug" required maxlength="64" pattern="[a-z0-9-]{1,64}" value="${escapeHtml(row.slug)}">
    <p class="hint">/terapeuci/${escapeHtml(therapist.slug)}/<strong>${escapeHtml(row.slug)}</strong> — małe litery, cyfry i myślniki.</p></div>
  <div class="field"><label for="page_status">Widoczność</label>
    <select id="page_status" name="status">
      <option value="draft"${row.status === 'draft' ? ' selected' : ''}>Szkic — widzisz tylko Ty</option>
      <option value="published"${row.status === 'published' ? ' selected' : ''}>Opublikowana — link na profilu</option>
    </select></div>
  <p class="sec-save"><button class="btn" type="submit">Zapisz podstronę</button></p>
  ${layoutChoice(LP_LAYOUT_AXES, lpParseLayout(row.layout_json))}
  <p class="hint">Przeciągnij blok, żeby zmienić kolejność, i dodawaj kolejne. Blok, w którym nic nie ma,
  nie pokaże się na stronie. Strona bez nagłówka dostaje nagłówek z tytułu.</p>
  ${editorList(LP_BUILDER, parseBlocks(row.blocks_json), summary)}
  <p class="sec-save"><button class="btn" type="submit">Zapisz podstronę</button></p>
</form>
<aside class="composer-preview">
  <p class="hint">Podgląd — <a href="${preview}" target="_blank" rel="noopener">otwórz w nowej karcie ↗</a></p>
  <iframe src="${preview}" title="Podgląd podstrony"></iframe>
</aside>
</div>
<form method="post" action="/admin/terapeuci/${id}/strony/${pid}/usun" class="inline-form"
      data-confirm="Usunąć podstronę „${escapeHtml(row.title)}"? Tego nie da się cofnąć.">
  ${csrfField(session)}
  <button class="btn secondary" type="submit">Usuń podstronę</button>
</form>`;
}

adminApp.get('/terapeuci/:id/strony/:pid', async (c) => {
  const g = await ownedPage(c, null);
  if ('response' in g) return g.response;
  const context = await loadEditorContext(c.env, g.therapist.id);
  return page(c.env, g.row.title, pageEditor(g.session, g.therapist, g.row, context));
});

adminApp.post('/terapeuci/:id/strony/:pid', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await ownedPage(c, body);
  if ('response' in g) return g.response;
  const { row, therapist } = g;

  const title = sanitizeLine(body.get('title') ?? '', 140) || row.title;
  const slug = (body.get('slug') ?? '').trim().toLowerCase();
  const status = body.get('status') === 'published' ? 'published' : 'draft';
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) {
    return page(c.env, 'Zły adres', '<h1>Zły adres</h1><p>Adres to małe litery, cyfry i myślniki.</p>', 400);
  }
  const blocks = collectSections(LP_BUILDER, body);
  try {
    await c.env.DB.prepare(
      `UPDATE therapist_pages SET title=?, slug=?, status=?, blocks_json=?, layout_json=?, updated_at=? WHERE id=? AND therapist_id=?`,
    )
      .bind(title, slug, status, blocks, collectLayout(LP_LAYOUT_AXES, lpParseLayout, body), nowIso(), row.id, therapist.id)
      .run();
  } catch (err) {
    if (!String(err).includes('UNIQUE')) throw err;
    return page(c.env, 'Adres zajęty', `<h1>Adres zajęty</h1><p>Masz już podstronę pod adresem /${escapeHtml(slug)}. Wybierz inny.</p>`, 409);
  }
  await audit(c.env, {
    actorType: g.session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: g.session.user.id,
    action: 'therapist.page_updated',
    subjectType: 'therapist',
    subjectId: therapist.id,
    meta: { page: row.id, status, count: JSON.parse(blocks).length },
  });
  return c.redirect(`/admin/terapeuci/${therapist.id}/strony/${row.id}`, 303);
});

adminApp.post('/terapeuci/:id/strony/:pid/usun', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await ownedPage(c, body);
  if ('response' in g) return g.response;
  await c.env.DB.prepare(`DELETE FROM therapist_pages WHERE id = ? AND therapist_id = ?`).bind(g.row.id, g.therapist.id).run();
  await audit(c.env, {
    actorType: g.session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: g.session.user.id,
    action: 'therapist.page_deleted',
    subjectType: 'therapist',
    subjectId: g.therapist.id,
    meta: { page: g.row.id },
  });
  return c.redirect(`/admin/terapeuci/${g.therapist.id}#panel-strony`, 303);
});

/** The draft as the public would see it once published. Owner only, so drafts stay private. */
adminApp.get('/terapeuci/:id/strony/:pid/podglad', async (c) => {
  const g = await ownedPage(c, null);
  if ('response' in g) return g.response;
  const t = await getTherapist(c.env, { therapist_id: g.therapist.id });
  if (!t) return page(c.env, 'Podgląd', '<h1>Podgląd</h1><p>Profil nie jest opublikowany, więc podstrony nie da się jeszcze pokazać.</p>', 404);
  const [ctx, pages] = await Promise.all([profileContext(c.env, t), listPages(c.env, t.therapist_id, true)]);
  return htmlResponse(c.env, await renderTherapistDocument(g.row, ctx, t, pages, assetUrls(LP_DOC_CSS)));
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

adminApp.post('/terapeuci/:id/oferta', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin', 'therapist']);
  if ('response' in g) return g.response;
  const id = c.req.param('id');
  if (!ownsTherapist(g.session.user, id)) return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);

  const at = nowIso();
  const offerId = randomId('of');
  const price = Math.round(Math.min(Math.max(Number(body.get('price') ?? 0) || 0, 0), 5000) * 100);
  await c.env.DB.prepare(
    `INSERT INTO session_offers (id, therapist_id, title, session_type, mode, duration_minutes, price_minor, currency, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PLN', 1, ?, ?)`,
  )
    .bind(
      offerId,
      id,
      sanitizeLine(body.get('title') ?? 'Sesja', 120),
      ['individual', 'couples', 'family'].includes(body.get('session_type') ?? '') ? body.get('session_type') : 'individual',
      body.get('mode') === 'in_person' ? 'in_person' : 'online',
      Math.min(Math.max(Number(body.get('duration_minutes') ?? 50) || 50, 15), 240),
      price,
      at,
      at,
    )
    .run();

  await audit(c.env, {
    actorType: g.session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: g.session.user.id,
    action: 'offer.created',
    subjectType: 'session_offer',
    subjectId: offerId,
    meta: { price_minor: price, currency: 'PLN' },
  });
  return new Response(null, { status: 302, headers: { location: `/admin/terapeuci/${id}` } });
});

adminApp.post('/terapeuci/:id/terminy', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin', 'therapist']);
  if ('response' in g) return g.response;
  const id = c.req.param('id');
  if (!ownsTherapist(g.session.user, id)) return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);

  const therapist = await getTherapistRowForAdmin(c.env, id);
  if (!therapist) return page(c.env, 'Nie znaleziono', '<h1>Nie znaleziono profilu</h1>', 404);

  const offerId = sanitizeLine(body.get('offer_id_manual') || body.get('offer_id') || '', 64);
  const offer = await c.env.DB.prepare(
    `SELECT id, duration_minutes FROM session_offers WHERE id = ? AND therapist_id = ? AND active = 1`,
  )
    .bind(offerId, id)
    .first<{ id: string; duration_minutes: number }>();
  if (!offer) return page(c.env, 'Błąd', '<h1>Nie znaleziono aktywnej oferty o tym identyfikatorze</h1>', 400);

  const days = Math.min(Math.max(Number(body.get('days') ?? 14) || 14, 1), 60);
  // The form posts one entry per checked hour; splitting on commas as well keeps
  // the older "9,11,13,15" single-field shape working.
  const hours = [
    ...new Set(
      body
        .getAll('hours')
        .flatMap((entry) => entry.split(','))
        .map((entry) => Number(entry.trim()))
        .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23),
    ),
  ]
    .sort((a, b) => a - b)
    .slice(0, 24);

  if (hours.length === 0) {
    return page(
      c.env,
      'Błąd',
      '<h1>Wybierz co najmniej jedną godzinę</h1><p>Bez godziny rozpoczęcia nie ma czego wygenerować.</p>',
      400,
    );
  }

  // The therapist works in a wall clock, not in UTC. The requested zone is
  // validated against the runtime's own zone data; an unknown zone is refused
  // rather than silently replaced.
  const requestedTz = sanitizeLine(body.get('timezone') ?? '', 64);
  const timezone = requestedTz || therapist.timezone || DEFAULT_TIMEZONE;
  if (!isValidTimezone(timezone)) {
    return page(c.env, 'Błąd', '<h1>Nieznana strefa czasowa</h1><p>Podaj identyfikator IANA, np. Europe/Warsaw.</p>', 400);
  }

  // Slots are built from a LOCAL date and a LOCAL hour, then converted to the
  // UTC instant they denote. "10:00 in Europe/Warsaw" therefore stays 10:00 for
  // the therapist on both sides of a daylight-saving transition, even though the
  // stored UTC instant shifts by an hour.
  const statements = [];
  const today = civilDateIn(timezone, new Date());

  for (let d = 1; d <= days; d++) {
    const day = addCivilDays(today, d);
    const weekday = weekdayIn(timezone, day);
    if (weekday === 0 || weekday === 6) continue;

    for (const hour of hours) {
      const start = zonedTimeToUtc(day, hour, 0, timezone);
      const end = new Date(start.getTime() + offer.duration_minutes * 60_000);
      statements.push(
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO appointment_slots
             (id, therapist_id, offer_id, starts_at_utc, ends_at_utc, timezone, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        ).bind(
          randomId('sl'),
          id,
          offer.id,
          start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          end.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          timezone,
          nowIso(),
          nowIso(),
        ),
      );
    }
  }
  if (statements.length > 0) await c.env.DB.batch(statements);

  await audit(c.env, {
    actorType: g.session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: g.session.user.id,
    action: 'slots.generated',
    subjectType: 'therapist',
    subjectId: id,
    meta: { count: statements.length, field: timezone },
  });
  return new Response(null, { status: 302, headers: { location: `/admin/terapeuci/${id}` } });
});

adminApp.post('/terapeuci/:id/blokuj', async (c) => {
  const body = await formValues(c.req.raw);
  const g = await guard(c, body, ['admin', 'therapist']);
  if ('response' in g) return g.response;
  const id = c.req.param('id');
  if (!ownsTherapist(g.session.user, id)) return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);

  const slotId = sanitizeLine(body.get('slot_id') ?? '', 64);
  // A booked slot can never be silently blocked - the booking must be cancelled first.
  const result = await c.env.DB.prepare(
    `UPDATE appointment_slots SET status = 'blocked', block_reason = ?, updated_at = ?
      WHERE id = ? AND therapist_id = ? AND status = 'open'`,
  )
    .bind(sanitizeLine(body.get('reason') ?? '', 120), nowIso(), slotId, id)
    .run();

  await audit(c.env, {
    actorType: g.session.user.role === 'admin' ? 'admin' : 'therapist',
    actorId: g.session.user.id,
    action: 'slot.blocked',
    subjectType: 'appointment_slot',
    subjectId: slotId,
    meta: { count: result.meta.changes ?? 0 },
  });
  return new Response(null, { status: 302, headers: { location: `/admin/terapeuci/${id}` } });
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
    if (owner && c.env.PII_ENC_KEY) {
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
  const session = await loadAdminSession(c.env, c.req.raw);
  if (!session) return page(c.env, 'Zaloguj się', loginForm(c.env), 401, true);
  if (session.user.role !== 'admin') return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);

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
  const session = await loadAdminSession(c.env, c.req.raw);
  if (!session) return page(c.env, 'Zaloguj się', loginForm(c.env), 401, true);
  if (session.user.role !== 'admin') return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);

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
    .bind(await emailLookupHash(signingKey(env), email.trim().toLowerCase()))
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
  const session = await loadAdminSession(c.env, c.req.raw);
  if (!session) return page(c.env, 'Zaloguj się', loginForm(c.env), 401, true);
  if (session.user.role !== 'admin') return page(c.env, 'Brak uprawnień', '<h1>Brak uprawnień</h1>', 403);

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
