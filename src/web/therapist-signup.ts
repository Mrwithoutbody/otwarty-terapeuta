import { Hono } from 'hono';
import type { Env } from '../env';
import { createAdminSession } from '../auth/session';
import { findOrCreateUserByEmail } from '../db/users';
import { consumeEmailCode, issueEmailCode, verifyEmailCode } from '../auth/challenge';
import { audit } from '../lib/audit';
import { encryptPii, randomId } from '../lib/crypto';
import { escapeHtml, isEmail, normalizeForSearch, sanitizeLine, sanitizeRichText } from '../lib/sanitize';
import { nowIso } from '../lib/time';
import { verifyTurnstile } from '../lib/turnstile';
import { drainOutbox, enqueueNotification } from '../notify/outbox';
import { htmlResponse, renderPage } from './layout';
import { pageHead } from './pages';

export const therapistSignupApp = new Hono<{ Bindings: Env }>();


interface PendingProfile {
  displayName: string;
  headline: string;
  bio: string;
  city: string;
  offersOnline: boolean;
  offersInPerson: boolean;
}

function page(env: Env, title: string, body: string, status = 200, turnstile = false): Response {
  return htmlResponse(
    env,
    renderPage(env, { title, path: '/dla-terapeutow', noindex: true, body }),
    { status, headers: { 'cache-control': 'no-store' } },
    turnstile,
  );
}

async function formValues(request: Request): Promise<URLSearchParams> {
  const form = await request.formData();
  const params = new URLSearchParams();
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') params.append(key, value);
  }
  return params;
}

function signupForm(env: Env, error?: string): string {
  return `
<div class="signup-page">
${pageHead('Dołącz jako terapeuta')}

<!-- Co terapeutka z tego ma. Do tej pory ta strona pokazywała wyłącznie
     formularz, czyli koszt bez powodu. -->
<ul class="pillars">
  <li><h3>Własna strona, nie wiersz w katalogu</h3>
    <p>Układasz profil z sekcji: własne teksty, filary, cytat, zdjęcie obok słów.
    Wybierasz motyw, skalę nagłówków i rytm strony — profil ma wyglądać jak Twój,
    a nie jak formularz.</p></li>
  <li><h3>Terminy i rezerwacje bez telefonowania</h3>
    <p>Wolne godziny wpisujesz w panelu. Osoba szukająca pomocy widzi je na profilu
    i rezerwuje przez asystenta ChatGPT. Logowanie jest potrzebne dopiero przy
    rezerwacji, nigdy do samego przeglądania.</p></li>
  <li><h3>Bez prowizji i płatnego pozycjonowania</h3>
    <p>Rozliczasz się bezpośrednio z osobą, która przychodzi. W wynikach nie ma
    pola „promowany” — kolejność zależy od dopasowania, nie od opłaty.</p></li>
</ul>
<p class="hint">Chcesz zobaczyć, jak to wygląda?
<a href="/terapeuci/katarzyna-wrona-demo">Otwórz przykładowy profil</a> — to profil
demonstracyjny, osoba fikcyjna, złożony z tych samych sekcji, które dostajesz w panelu.</p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/dla-terapeutow/start">
  <div class="field-row two">
    <div class="field"><label for="display_name">Imię i nazwisko</label>
      <input id="display_name" name="display_name" required maxlength="120" autocomplete="name"></div>
    <div class="field"><label for="email">Adres e-mail do logowania</label>
      <input id="email" name="email" type="email" required maxlength="254" autocomplete="email"></div>
  </div>
  <div class="field"><label for="headline">Krótki nagłówek zawodowy</label>
    <input id="headline" name="headline" maxlength="200" placeholder="np. psychoterapeutka w trakcie certyfikacji"></div>
  <div class="field"><label for="bio">Kilka słów o doświadczeniu i sposobie pracy</label>
    <textarea id="bio" name="bio" maxlength="4000"></textarea></div>
  <div class="field"><label for="city">Miejscowość gabinetu (jeśli dotyczy)</label>
    <input id="city" name="city" maxlength="80"></div>
  <fieldset>
    <legend>Forma spotkań</legend>
    <div class="checkbox"><input id="online" name="offers_online" type="checkbox" value="1">
      <label for="online">online</label></div>
    <div class="checkbox"><input id="in_person" name="offers_in_person" type="checkbox" value="1">
      <label for="in_person">stacjonarnie</label></div>
  </fieldset>
  <div class="notice"><p><strong>Status początkowy:</strong> profil roboczy, niezweryfikowany.
  Administrator może poprosić o dokumenty przed publikacją.</p></div>
  <div class="checkbox"><input id="terms" name="terms" type="checkbox" value="yes" required>
    <label for="terms">Akceptuję <a href="/regulamin" target="_blank" rel="noopener">regulamin</a>.</label></div>
  <div class="checkbox"><input id="privacy" name="privacy" type="checkbox" value="yes" required>
    <label for="privacy">Zapoznałem(-am) się z <a href="/polityka-prywatnosci" target="_blank" rel="noopener">polityką prywatności</a>.</label></div>
  <div class="cf-turnstile" data-sitekey="${escapeHtml(env.TURNSTILE_SITE_KEY)}" data-theme="auto"></div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <p><button class="btn" type="submit">Wyślij kod i utwórz zgłoszenie</button></p>
</form>
<p class="hint">Masz już profil? <a href="/admin">Zaloguj się do panelu</a>.</p></div>`;
}

function codeForm(challengeId: string, error?: string): string {
  return `
<div class="signup-page">${pageHead('Potwierdź adres e-mail')}
<p>Wysłaliśmy sześciocyfrowy kod. Jest ważny 15 minut.</p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/dla-terapeutow/potwierdz">
  <input type="hidden" name="challenge_id" value="${escapeHtml(challengeId)}">
  <div class="field"><label for="code">Kod jednorazowy</label>
    <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}"
           autocomplete="one-time-code" required maxlength="6"></div>
  <p><button class="btn" type="submit">Potwierdź i przejdź do profilu</button></p>
</form></div>`;
}

function slugFor(name: string, therapistId: string): string {
  const base = normalizeForSearch(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'terapeuta';
  return `${base}-${therapistId.slice(-8)}`;
}

therapistSignupApp.get('/', (c) => page(c.env, 'Dołącz jako terapeuta', signupForm(c.env), 200, true));

therapistSignupApp.post('/start', async (c) => {
  const body = await formValues(c.req.raw);
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  if (!(await c.env.RL_AUTH.limit({ key: `therapist-signup:${ip}` })).success) {
    return page(c.env, 'Dołącz jako terapeuta', signupForm(c.env, 'Zbyt wiele prób. Spróbuj za minutę.'), 429, true);
  }

  const email = (body.get('email') ?? '').trim().toLowerCase();
  const displayName = sanitizeLine(body.get('display_name') ?? '', 120);
  const offersOnline = body.get('offers_online') === '1';
  const offersInPerson = body.get('offers_in_person') === '1';
  if (!isEmail(email) || displayName.length < 3) {
    return page(c.env, 'Dołącz jako terapeuta', signupForm(c.env, 'Podaj poprawne imię, nazwisko i adres e-mail.'), 400, true);
  }
  if (!offersOnline && !offersInPerson) {
    return page(c.env, 'Dołącz jako terapeuta', signupForm(c.env, 'Wybierz co najmniej jedną formę spotkań.'), 400, true);
  }
  if (body.get('terms') !== 'yes' || body.get('privacy') !== 'yes') {
    return page(c.env, 'Dołącz jako terapeuta', signupForm(c.env, 'Wymagana jest akceptacja regulaminu i polityki prywatności.'), 400, true);
  }
  if (!(await verifyTurnstile(c.env, body.get('cf-turnstile-response'), ip))) {
    return page(c.env, 'Dołącz jako terapeuta', signupForm(c.env, 'Weryfikacja antyspamowa nie powiodła się.'), 400, true);
  }

  const pending: PendingProfile = {
    displayName,
    headline: sanitizeLine(body.get('headline') ?? '', 200),
    bio: sanitizeRichText(body.get('bio') ?? '', 4000),
    city: sanitizeLine(body.get('city') ?? '', 80),
    offersOnline,
    offersInPerson,
  };

  const { challengeId, code } = await issueEmailCode(c.env, 'therapist_signup', email, pending);

  await enqueueNotification(c.env, 'therapist.signup_code', null, {
    to: email,
    subject: 'Potwierdź zgłoszenie terapeuty — Otwarty Terapeuta',
    text: `Kod potwierdzający zgłoszenie: ${code}\nKod jest ważny 15 minut.`,
  });
  c.executionCtx.waitUntil(drainOutbox(c.env, 5));
  return page(c.env, 'Potwierdź adres e-mail', codeForm(challengeId));
});

therapistSignupApp.post('/potwierdz', async (c) => {
  const body = await formValues(c.req.raw);
  const challengeId = body.get('challenge_id') ?? '';
  const submitted = (body.get('code') ?? '').trim();

  const fail = (message: string): Response => page(c.env, 'Potwierdź adres e-mail', codeForm(challengeId, message), 400);
  const verdict = await verifyEmailCode(c.env, 'therapist_signup', challengeId, submitted);
  if (!verdict.ok) {
    return fail(
      verdict.reason === 'expired'
        ? 'Kod wygasł. Rozpocznij zgłoszenie ponownie.'
        : verdict.reason === 'attempts'
          ? 'Przekroczono liczbę prób. Rozpocznij zgłoszenie ponownie.'
          : verdict.reason === 'unknown'
            ? 'Kod jest nieprawidłowy lub został użyty.'
            : 'Kod jest nieprawidłowy.',
    );
  }

  const email = verdict.email;
  const user = await findOrCreateUserByEmail(c.env, email);
  if (user.role === 'therapist' && user.therapist_id) {
    await consumeEmailCode(c.env, challengeId).run();
    const { cookie } = await createAdminSession(c.env, user.id);
    return new Response(null, { status: 302, headers: { location: '/admin', 'set-cookie': cookie } });
  }
  if (user.role !== 'user') {
    return fail('To konto ma już inną rolę w serwisie. Skontaktuj się z administratorem.');
  }

  let pending: PendingProfile;
  try {
    pending = JSON.parse(verdict.context) as PendingProfile;
  } catch {
    return fail('Zgłoszenie jest uszkodzone. Rozpocznij je ponownie.');
  }
  const at = nowIso();
  const therapistId = randomId('th');
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO therapists
         (id, slug, display_name, headline, bio, offers_online, offers_in_person,
          accepting_new_clients, age_groups, session_types, credentials, verification_status,
          status, is_demo, timezone, contact_email_enc, cancellation_policy,
          cancellation_cutoff_h, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, '["adults"]', '["individual"]', '[]',
               'unverified', 'draft', 0, 'Europe/Warsaw', ?, '', 24, ?, ?)`,
    ).bind(
      therapistId,
      slugFor(pending.displayName, therapistId),
      pending.displayName,
      pending.headline,
      pending.bio,
      pending.offersOnline ? 1 : 0,
      pending.offersInPerson ? 1 : 0,
      await encryptPii(c.env.PII_ENC_KEY ?? '', email),
      at,
      at,
    ),
    c.env.DB.prepare(`UPDATE users SET role = 'therapist', therapist_id = ?, name_enc = ?, updated_at = ? WHERE id = ?`)
      .bind(therapistId, await encryptPii(c.env.PII_ENC_KEY ?? '', pending.displayName), at, user.id),
    c.env.DB.prepare(
      `INSERT INTO consent_records (id, user_id, kind, version, granted_at, source)
       VALUES (?, ?, 'terms', ?, ?, 'web:therapist_signup')`,
    ).bind(randomId('cons'), user.id, c.env.TERMS_VERSION, at),
    c.env.DB.prepare(
      `INSERT INTO consent_records (id, user_id, kind, version, granted_at, source)
       VALUES (?, ?, 'privacy', ?, ?, 'web:therapist_signup')`,
    ).bind(randomId('cons'), user.id, c.env.PRIVACY_VERSION, at),
    consumeEmailCode(c.env, challengeId),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO therapist_languages (therapist_id, language_code)
       SELECT ?, code FROM languages WHERE code = 'pl'`,
    ).bind(therapistId),
  ];
  if (pending.city) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO therapist_locations (id, therapist_id, city, city_norm, country, is_primary)
         VALUES (?, ?, ?, ?, 'PL', 1)`,
      ).bind(randomId('loc'), therapistId, pending.city, normalizeForSearch(pending.city)),
    );
  }
  await c.env.DB.batch(statements);
  await audit(c.env, {
    actorType: 'therapist',
    actorId: user.id,
    action: 'therapist.self_registered',
    subjectType: 'therapist',
    subjectId: therapistId,
    meta: { to_status: 'draft', status: 'unverified' },
  });

  const { cookie } = await createAdminSession(c.env, user.id);
  return new Response(null, {
    status: 302,
    headers: { location: `/admin/terapeuci/${therapistId}`, 'set-cookie': cookie },
  });
});
