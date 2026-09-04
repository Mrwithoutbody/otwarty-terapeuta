import { Hono } from 'hono';
import { ALL_SCOPES, type Env } from '../env';
import { findOrCreateUserByEmail } from '../db/users';
import { consumeEmailCode, issueEmailCode, verifyEmailCode } from './challenge';
import { audit } from '../lib/audit';
import {
  hmacHex,
  randomId,
  randomSecret,
  timingSafeEqual,
  toBase64Url,
} from '../lib/crypto';
import { log } from '../lib/log';
import { escapeHtml, isEmail } from '../lib/sanitize';
import { isoPlusSeconds, nowIso } from '../lib/time';
import { verifyTurnstile } from '../lib/turnstile';
import { drainOutbox, enqueueNotification } from '../notify/outbox';
import { htmlResponse, renderPage } from '../web/layout';

/**
 * A minimal OAuth 2.1 Authorization Server, scoped to exactly what an MCP
 * client needs:
 *
 *  - dynamic client registration for public clients (PKCE only, no secret);
 *  - authorization code + PKCE S256 (the only supported challenge method);
 *  - the RFC 8707 `resource` parameter, echoed into the token's audience;
 *  - refresh tokens with rotation.
 *
 * Sign-in is passwordless: a one-time code delivered by e-mail. There is no
 * password to leak and no social login to depend on. Turnstile guards the
 * public form.
 */

const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;
const AUTH_CODE_TTL_SECONDS = 300;

export interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  code_challenge: string;
  // Always "S256" - `parseAuthorizeParams` refuses anything else. It is carried
  // in the params (and therefore in every form's hidden fields) because each POST
  // on the consent screens re-parses the request, and a missing method would fail
  // that re-parse even though the original redirect was valid.
  code_challenge_method: 'S256';
  resource: string;
}

interface ClientRow {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  redirect_uris: string;
  token_endpoint_auth_method: string;
  scope: string;
}

function signingKey(env: Env): string {
  if (!env.TOKEN_SIGNING_KEY) throw new Error('Brak TOKEN_SIGNING_KEY.');
  return env.TOKEN_SIGNING_KEY;
}

export function authorizationServerMetadata(env: Env): Record<string, unknown> {
  const base = env.PUBLIC_BASE_URL;
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: ALL_SCOPES,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    // ChatGPT refuses servers whose metadata omits S256. It is also the only
    // method this server accepts.
    code_challenge_methods_supported: ['S256'],
    resource_indicators_supported: true,
  };
}

function jsonError(status: number, error: string, description: string): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

async function loadClient(env: Env, clientId: string): Promise<ClientRow | null> {
  return env.DB.prepare(`SELECT * FROM oauth_clients WHERE client_id = ?`)
    .bind(clientId)
    .first<ClientRow>();
}

function redirectUriAllowed(client: ClientRow, redirectUri: string): boolean {
  try {
    const allowed = JSON.parse(client.redirect_uris) as unknown;
    // Exact string match only. No prefix matching, no wildcards.
    return Array.isArray(allowed) && allowed.includes(redirectUri);
  } catch {
    return false;
  }
}

function normalizeScope(requested: string | null, clientScope: string): string {
  const clientAllowed = new Set(clientScope.split(' ').filter(Boolean));
  const wanted = (requested ?? clientScope).split(' ').filter(Boolean);
  const granted = wanted.filter((s) => ALL_SCOPES.includes(s) && clientAllowed.has(s));
  return granted.length > 0 ? granted.join(' ') : 'catalog:read';
}

/** The audience a token may be used against. Only this server's MCP endpoint. */
function normalizeResource(env: Env, requested: string | null): string | null {
  const expected = new URL(env.PUBLIC_MCP_URL);
  if (!requested) return expected.toString();
  let candidate: URL;
  try {
    candidate = new URL(requested);
  } catch {
    return null;
  }
  candidate.hash = '';
  const same =
    candidate.origin === expected.origin &&
    (candidate.pathname === expected.pathname || candidate.pathname === '/');
  return same ? expected.toString() : null;
}

const SCOPE_LABELS: Record<string, string> = {
  'catalog:read': 'przeglądanie katalogu terapeutów, FAQ i wolnych terminów',
  'booking:read': 'podgląd podsumowania rezerwacji i Twoich własnych rezerwacji',
  'booking:write': 'rezerwowanie i odwoływanie wizyt w Twoim imieniu — po każdorazowym potwierdzeniu',
};

function hiddenFields(params: AuthorizeParams): string {
  return Object.entries(params)
    .map(([key, value]) => `<input type="hidden" name="${key}" value="${escapeHtml(value)}">`)
    .join('\n');
}

function turnstileWidget(env: Env): string {
  return `<div class="cf-turnstile" data-sitekey="${escapeHtml(env.TURNSTILE_SITE_KEY)}" data-theme="auto"></div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`;
}

function loginPage(env: Env, params: AuthorizeParams, client: ClientRow, error?: string): string {
  const scopes = params.scope
    .split(' ')
    .filter(Boolean)
    .map((s) => `<li>${escapeHtml(SCOPE_LABELS[s] ?? s)}</li>`)
    .join('');

  return renderPage(env, {
    title: 'Połącz konto',
    path: '/oauth/authorize',
    noindex: true,
    body: `
<h1>Połącz konto z aplikacją</h1>
<p><strong>${escapeHtml(client.client_name)}</strong> prosi o dostęp do Twojego konta w Otwartym Terapeucie.</p>
<div class="notice">
  <h2>Aplikacja będzie mogła:</h2>
  <ul>${scopes}</ul>
  <p class="hint">Każda rezerwacja i każde odwołanie wizyty wymaga osobnego potwierdzenia z Twojej strony.
  Aplikacja nie otrzymuje Twoich rozmów ani powodów szukania terapii.</p>
</div>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/oauth/authorize/anonymous">
  ${hiddenFields(params)}
  <p><button class="btn" type="submit">Korzystaj bez konta</button></p>
  <p class="hint">Bez podawania adresu e-mail. Dostęp obejmuje wyłącznie publiczny katalog,
  profile, FAQ i wolne terminy. Logowanie pojawi się dopiero, gdy zechcesz zarezerwować
  lub odwołać wizytę.</p>
</form>
<hr>
<h2>Połącz konto do rezerwacji</h2>
<form method="post" action="/oauth/authorize">
  ${hiddenFields(params)}
  <div class="field">
    <label for="email">Adres e-mail</label>
    <input id="email" name="email" type="email" autocomplete="email" required maxlength="254">
    <p class="hint">Wyślemy jednorazowy kod. Nie zakładamy hasła.</p>
  </div>
  <div class="checkbox">
    <input id="consent" name="consent" type="checkbox" value="yes" required>
    <label for="consent">Potwierdzam, że mam ukończone 18 lat, oraz akceptuję
      <a href="/regulamin">regulamin</a> (wersja ${escapeHtml(env.TERMS_VERSION)}) i
      <a href="/polityka-prywatnosci">politykę prywatności</a> (wersja ${escapeHtml(env.PRIVACY_VERSION)}).</label>
  </div>
  ${turnstileWidget(env)}
  <p><button class="btn" type="submit">Wyślij kod na e-mail</button></p>
</form>`,
  });
}

function codePage(env: Env, challengeId: string, params: AuthorizeParams, error?: string): string {
  return renderPage(env, {
    title: 'Wpisz kod',
    path: '/oauth/authorize',
    noindex: true,
    body: `
<h1>Wpisz kod z wiadomości</h1>
<p>Jeżeli podany adres istnieje lub może zostać utworzony, wysłaliśmy na niego sześciocyfrowy kod. Kod jest ważny 15 minut.</p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/oauth/authorize/confirm">
  <input type="hidden" name="challenge_id" value="${escapeHtml(challengeId)}">
  ${hiddenFields(params)}
  <div class="field">
    <label for="code">Kod jednorazowy</label>
    <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" required maxlength="6">
  </div>
  <p><button class="btn" type="submit">Połącz konto</button></p>
</form>`,
  });
}

function errorPage(env: Env, message: string): Response {
  return htmlResponse(
    env,
    renderPage(env, {
      title: 'Nie można kontynuować',
      path: '/oauth/authorize',
      noindex: true,
      body: `<h1>Nie można kontynuować logowania</h1><p class="error" role="alert">${escapeHtml(message)}</p>
             <p><a href="/">Wróć na stronę główną</a></p>`,
    }),
    { status: 400 },
    false,
  );
}

/**
 * Origin the browser will be redirected to after the form posts. It must be named
 * in `form-action`, or the submit is blocked before it leaves the page.
 */
function redirectOrigin(redirectUri: string): string | undefined {
  try {
    return new URL(redirectUri).origin;
  } catch {
    return undefined;
  }
}

/** Parses and validates the authorize request. */
async function parseAuthorizeParams(
  env: Env,
  source: URLSearchParams,
): Promise<{ params: AuthorizeParams; client: ClientRow } | { error: string }> {
  const clientId = source.get('client_id') ?? '';
  const redirectUri = source.get('redirect_uri') ?? '';
  const responseType = source.get('response_type') ?? 'code';
  const challenge = source.get('code_challenge') ?? '';
  const method = source.get('code_challenge_method') ?? '';

  const client = await loadClient(env, clientId);
  if (!client) return { error: 'Nieznany client_id. Zarejestruj aplikację ponownie.' };
  if (!redirectUriAllowed(client, redirectUri)) {
    return { error: 'Adres redirect_uri nie jest zarejestrowany dla tej aplikacji.' };
  }
  if (responseType !== 'code') return { error: 'Obsługiwany jest wyłącznie response_type=code.' };
  if (method !== 'S256') return { error: 'Wymagane jest PKCE z metodą S256.' };
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(challenge)) {
    return { error: 'Nieprawidłowy parametr code_challenge.' };
  }

  const resource = normalizeResource(env, source.get('resource'));
  if (!resource) return { error: 'Parametr resource nie wskazuje na ten serwer MCP.' };

  return {
    client,
    params: {
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: normalizeScope(source.get('scope'), client.scope),
      state: (source.get('state') ?? '').slice(0, 512),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource,
    },
  };
}

/** The columns every token lookup reads out of `oauth_tokens`. */
export interface OAuthTokenRow {
  client_id: string;
  user_id: string;
  scope: string;
  resource: string;
  expires_at: string;
  revoked_at: string | null;
}

export const oauthApp = new Hono<{ Bindings: Env }>();

/** RFC 7591 dynamic client registration. Public (PKCE-only) clients only. */
oauthApp.post('/register', async (c) => {
  const env = c.env;
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  if (!(await env.RL_AUTH.limit({ key: `register:${ip}` })).success) {
    return jsonError(429, 'temporarily_unavailable', 'Zbyt wiele rejestracji. Spróbuj później.');
  }

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_client_metadata', 'Treść żądania nie jest poprawnym JSON-em.');
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const cleaned: string[] = [];
  for (const uri of redirectUris.slice(0, 5)) {
    if (typeof uri !== 'string' || uri.length > 500) continue;
    try {
      const parsed = new URL(uri);
      // https everywhere; http only for a loopback redirect during development.
      const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback)) {
        cleaned.push(parsed.toString());
      }
    } catch {
      /* ignored - invalid URI is simply not registered */
    }
  }
  if (cleaned.length === 0) {
    return jsonError(400, 'invalid_redirect_uri', 'Wymagany jest co najmniej jeden poprawny redirect_uri (https).');
  }

  const clientId = randomId('cli', 16);
  const clientName =
    typeof body.client_name === 'string' ? body.client_name.slice(0, 120) : 'Aplikacja MCP';

  await env.DB.prepare(
    `INSERT INTO oauth_clients (client_id, client_secret_hash, client_name, redirect_uris,
                                grant_types, token_endpoint_auth_method, scope, created_at)
     VALUES (?, NULL, ?, ?, ?, 'none', ?, ?)`,
  )
    .bind(
      clientId,
      clientName,
      JSON.stringify(cleaned),
      JSON.stringify(['authorization_code', 'refresh_token']),
      ALL_SCOPES.join(' '),
      nowIso(),
    )
    .run();

  await audit(env, {
    actorType: 'anonymous',
    action: 'oauth.client_registered',
    subjectType: 'oauth_client',
    subjectId: clientId,
    meta: { count: cleaned.length },
  });

  return Response.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: clientName,
      redirect_uris: cleaned,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: ALL_SCOPES.join(' '),
    },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
});

oauthApp.get('/authorize', async (c) => {
  const parsed = await parseAuthorizeParams(c.env, new URL(c.req.url).searchParams);
  if ('error' in parsed) return errorPage(c.env, parsed.error);
  return htmlResponse(c.env, loginPage(c.env, parsed.params, parsed.client), { status: 200 }, true, redirectOrigin(parsed.params.redirect_uri));
});

/**
 * Completes the connector handshake without collecting personal data.
 *
 * ChatGPT connects a required OAuth app before its first use and may request
 * every registered scope at that point. We deliberately down-scope this
 * anonymous grant to catalog:read. Private tools later return an
 * insufficient_scope challenge, which starts the existing e-mail sign-in only
 * when the user actually asks to read or modify a booking.
 */
oauthApp.post('/authorize/anonymous', async (c) => {
  const env = c.env;
  const form = await c.req.formData();
  const source = new URLSearchParams();
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') source.set(key, value);
  }

  const parsed = await parseAuthorizeParams(env, source);
  if ('error' in parsed) return errorPage(env, parsed.error);

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  if (!(await env.RL_AUTH.limit({ key: `authorize-anonymous:${ip}` })).success) {
    return errorPage(env, 'Zbyt wiele prób. Spróbuj ponownie za minutę.');
  }

  const key = signingKey(env);
  const anonymousId = randomId('usr');
  const authCode = randomSecret(32);
  const at = nowIso();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email_hash, email_enc, name_enc, role, therapist_id, created_at, updated_at)
       VALUES (?, ?, '', NULL, 'user', NULL, ?, ?)`,
    ).bind(anonymousId, `anonymous:${anonymousId}`, at, at),
    env.DB.prepare(
      `INSERT INTO oauth_auth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge,
                                     code_challenge_method, scope, resource, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'S256', 'catalog:read', ?, ?, ?)`,
    ).bind(
      await hmacHex(key, `authcode:${authCode}`),
      parsed.params.client_id,
      anonymousId,
      parsed.params.redirect_uri,
      parsed.params.code_challenge,
      parsed.params.resource,
      isoPlusSeconds(AUTH_CODE_TTL_SECONDS),
      at,
    ),
  ]);

  await audit(env, {
    actorType: 'system',
    actorId: anonymousId,
    action: 'oauth.authorized_anonymous',
    subjectType: 'oauth_client',
    subjectId: parsed.params.client_id,
    meta: { requested_scope: parsed.params.scope, granted_scope: 'catalog:read' },
  });

  const redirect = new URL(parsed.params.redirect_uri);
  redirect.searchParams.set('code', authCode);
  if (parsed.params.state) redirect.searchParams.set('state', parsed.params.state);
  return new Response(null, {
    status: 302,
    headers: { location: redirect.toString(), 'cache-control': 'no-store' },
  });
});

/** Step 1: e-mail address + consent + Turnstile -> one-time code. */
oauthApp.post('/authorize', async (c) => {
  const env = c.env;
  const form = await c.req.formData();
  const source = new URLSearchParams();
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') source.set(key, value);
  }

  const parsed = await parseAuthorizeParams(env, source);
  if ('error' in parsed) return errorPage(env, parsed.error);

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  if (!(await env.RL_AUTH.limit({ key: `authorize:${ip}` })).success) {
    return htmlResponse(
      env,
      loginPage(env, parsed.params, parsed.client, 'Zbyt wiele prób. Spróbuj ponownie za minutę.'),
      { status: 429 },
      true,
      redirectOrigin(parsed.params.redirect_uri),
    );
  }

  if (source.get('consent') !== 'yes') {
    return htmlResponse(
      env,
      loginPage(env, parsed.params, parsed.client, 'Aby kontynuować, potwierdź wiek oraz akceptację dokumentów.'),
      { status: 400 },
      true,
      redirectOrigin(parsed.params.redirect_uri),
    );
  }

  const email = (source.get('email') ?? '').trim().toLowerCase();
  if (!isEmail(email)) {
    return htmlResponse(
      env,
      loginPage(env, parsed.params, parsed.client, 'Podaj poprawny adres e-mail.'),
      { status: 400 },
      true,
      redirectOrigin(parsed.params.redirect_uri),
    );
  }

  const turnstileOk = await verifyTurnstile(env, source.get('cf-turnstile-response'), ip);
  if (!turnstileOk) {
    return htmlResponse(
      env,
      loginPage(env, parsed.params, parsed.client, 'Weryfikacja antyspamowa nie powiodła się. Spróbuj ponownie.'),
      { status: 400 },
      true,
      redirectOrigin(parsed.params.redirect_uri),
    );
  }

  const { challengeId, code } = await issueEmailCode(env, 'oauth', email, parsed.params);

  await enqueueNotification(env, 'login.code', null, {
    to: email,
    subject: 'Kod logowania — Otwarty Terapeuta',
    text:
      `Twój jednorazowy kod logowania: ${code}\n\n` +
      `Kod jest ważny 15 minut. Jeżeli to nie Ty próbowałeś się zalogować, zignoruj tę wiadomość.`,
  });
  c.executionCtx.waitUntil(drainOutbox(env, 5));

  return htmlResponse(env, codePage(env, challengeId, parsed.params), { status: 200 }, false, redirectOrigin(parsed.params.redirect_uri));
});

/** Step 2: one-time code -> authorization code -> redirect back to the client. */
oauthApp.post('/authorize/confirm', async (c) => {
  const env = c.env;
  const form = await c.req.formData();
  const source = new URLSearchParams();
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') source.set(key, value);
  }

  const parsed = await parseAuthorizeParams(env, source);
  if ('error' in parsed) return errorPage(env, parsed.error);

  const challengeId = source.get('challenge_id') ?? '';
  const submitted = (source.get('code') ?? '').trim();
  const key = signingKey(env);

  const invalid = (message: string): Response =>
    htmlResponse(env, codePage(env, challengeId, parsed.params, message), { status: 400 }, false, redirectOrigin(parsed.params.redirect_uri));

  const verdict = await verifyEmailCode(env, 'oauth', challengeId, submitted);
  if (!verdict.ok) {
    return invalid(
      verdict.reason === 'expired'
        ? 'Kod wygasł. Rozpocznij logowanie od nowa.'
        : verdict.reason === 'attempts'
          ? 'Przekroczono liczbę prób. Rozpocznij logowanie od nowa.'
          : verdict.reason === 'unknown'
            ? 'Kod jest nieprawidłowy lub został już użyty.'
            : 'Kod jest nieprawidłowy.',
    );
  }

  // The authorize parameters are taken from the challenge row, not from the
  // form, so a tampered hidden field cannot redirect the code elsewhere.
  const stored = JSON.parse(verdict.context) as AuthorizeParams;

  if (!env.PII_ENC_KEY) return errorPage(env, 'Serwer nie ma skonfigurowanego klucza szyfrowania.');
  const user = await findOrCreateUserByEmail(env, verdict.email);

  const authCode = randomSecret(32);
  await env.DB.batch([
    consumeEmailCode(env, challengeId),
    env.DB.prepare(
      `INSERT INTO oauth_auth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge,
                                     code_challenge_method, scope, resource, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'S256', ?, ?, ?, ?)`,
    ).bind(
      await hmacHex(key, `authcode:${authCode}`),
      stored.client_id,
      user.id,
      stored.redirect_uri,
      stored.code_challenge,
      stored.scope,
      stored.resource,
      isoPlusSeconds(AUTH_CODE_TTL_SECONDS),
      nowIso(),
    ),
    env.DB.prepare(
      `INSERT INTO consent_records (id, user_id, kind, version, granted_at, source) VALUES (?, ?, 'terms', ?, ?, 'oauth:authorize')`,
    ).bind(randomId('cons'), user.id, env.TERMS_VERSION, nowIso()),
    env.DB.prepare(
      `INSERT INTO consent_records (id, user_id, kind, version, granted_at, source) VALUES (?, ?, 'privacy', ?, ?, 'oauth:authorize')`,
    ).bind(randomId('cons'), user.id, env.PRIVACY_VERSION, nowIso()),
  ]);

  await audit(env, {
    actorType: 'user',
    actorId: user.id,
    action: 'oauth.authorized',
    subjectType: 'oauth_client',
    subjectId: stored.client_id,
    meta: { scope: stored.scope },
  });

  const redirect = new URL(stored.redirect_uri);
  redirect.searchParams.set('code', authCode);
  if (stored.state) redirect.searchParams.set('state', stored.state);
  return new Response(null, {
    status: 302,
    headers: { location: redirect.toString(), 'cache-control': 'no-store' },
  });
});

async function issueTokens(
  env: Env,
  input: { clientId: string; userId: string; scope: string; resource: string },
): Promise<Response> {
  const key = signingKey(env);
  const accessToken = `ot_at_${randomSecret(32)}`;
  const refreshToken = `ot_rt_${randomSecret(32)}`;
  const at = nowIso();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, scope, resource, expires_at, created_at)
       VALUES (?, 'access', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      await hmacHex(key, `token:${accessToken}`),
      input.clientId,
      input.userId,
      input.scope,
      input.resource,
      isoPlusSeconds(ACCESS_TOKEN_TTL_SECONDS),
      at,
    ),
    env.DB.prepare(
      `INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, scope, resource, expires_at, created_at)
       VALUES (?, 'refresh', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      await hmacHex(key, `token:${refreshToken}`),
      input.clientId,
      input.userId,
      input.scope,
      input.resource,
      isoPlusSeconds(REFRESH_TOKEN_TTL_SECONDS),
      at,
    ),
  ]);

  return Response.json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: input.scope,
    },
    { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
  );
}

oauthApp.post('/token', async (c) => {
  const env = c.env;
  const key = signingKey(env);
  const form = await c.req.formData();
  const get = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };

  const grantType = get('grant_type');
  const clientId = get('client_id');
  if (!clientId) return jsonError(400, 'invalid_client', 'Brak client_id.');
  const client = await loadClient(env, clientId);
  if (!client) return jsonError(401, 'invalid_client', 'Nieznany client_id.');

  if (grantType === 'authorization_code') {
    const code = get('code');
    const verifier = get('code_verifier');
    const redirectUri = get('redirect_uri');
    if (!code || !verifier) return jsonError(400, 'invalid_request', 'Brak code lub code_verifier.');
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
      return jsonError(400, 'invalid_grant', 'Nieprawidłowy code_verifier.');
    }

    const hash = await hmacHex(key, `authcode:${code}`);
    const row = await env.DB.prepare(
      `SELECT * FROM oauth_auth_codes WHERE code_hash = ?`,
    )
      .bind(hash)
      .first<{
        code_hash: string;
        client_id: string;
        user_id: string;
        redirect_uri: string;
        code_challenge: string;
        scope: string;
        resource: string;
        expires_at: string;
        used_at: string | null;
      }>();

    if (!row) return jsonError(400, 'invalid_grant', 'Kod autoryzacyjny jest nieprawidłowy.');
    if (row.used_at !== null) {
      // Replay: burn every token minted from this code.
      await env.DB.prepare(`UPDATE oauth_tokens SET revoked_at = ? WHERE user_id = ? AND client_id = ?`)
        .bind(nowIso(), row.user_id, row.client_id)
        .run();
      log.warn('oauth.code_replay', { client_id: row.client_id });
      return jsonError(400, 'invalid_grant', 'Kod autoryzacyjny został już użyty.');
    }
    if (Date.parse(row.expires_at) < Date.now()) {
      return jsonError(400, 'invalid_grant', 'Kod autoryzacyjny wygasł.');
    }
    if (row.client_id !== clientId) return jsonError(400, 'invalid_grant', 'Kod należy do innej aplikacji.');
    if (redirectUri && redirectUri !== row.redirect_uri) {
      return jsonError(400, 'invalid_grant', 'Niezgodny redirect_uri.');
    }

    // PKCE: S256(code_verifier) must equal the stored challenge.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const computed = toBase64Url(new Uint8Array(digest));
    if (!timingSafeEqual(computed, row.code_challenge)) {
      return jsonError(400, 'invalid_grant', 'Weryfikacja PKCE nie powiodła się.');
    }

    const requestedResource = get('resource');
    if (requestedResource) {
      const normalized = normalizeResource(env, requestedResource);
      if (!normalized || normalized !== row.resource) {
        return jsonError(400, 'invalid_target', 'Parametr resource nie zgadza się z autoryzacją.');
      }
    }

    await env.DB.prepare(`UPDATE oauth_auth_codes SET used_at = ? WHERE code_hash = ?`)
      .bind(nowIso(), hash)
      .run();

    return issueTokens(env, {
      clientId,
      userId: row.user_id,
      scope: row.scope,
      resource: row.resource,
    });
  }

  if (grantType === 'refresh_token') {
    const token = get('refresh_token');
    if (!token) return jsonError(400, 'invalid_request', 'Brak refresh_token.');
    const hash = await hmacHex(key, `token:${token}`);
    const row = await env.DB.prepare(
      `SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'`,
    )
      .bind(hash)
      .first<OAuthTokenRow>();

    if (!row || row.revoked_at !== null) return jsonError(400, 'invalid_grant', 'Token odświeżania jest nieprawidłowy.');
    if (Date.parse(row.expires_at) < Date.now()) return jsonError(400, 'invalid_grant', 'Token odświeżania wygasł.');
    if (row.client_id !== clientId) return jsonError(400, 'invalid_grant', 'Token należy do innej aplikacji.');

    // Rotation: the presented refresh token is single-use.
    await env.DB.prepare(`UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ?`)
      .bind(nowIso(), hash)
      .run();

    return issueTokens(env, {
      clientId,
      userId: row.user_id,
      scope: row.scope,
      resource: row.resource,
    });
  }

  return jsonError(400, 'unsupported_grant_type', 'Obsługiwane: authorization_code, refresh_token.');
});

oauthApp.post('/revoke', async (c) => {
  const env = c.env;
  const form = await c.req.formData();
  const token = form.get('token');
  if (typeof token === 'string' && token.length > 0) {
    await env.DB.prepare(`UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ?`)
      .bind(nowIso(), await hmacHex(signingKey(env), `token:${token}`))
      .run();
  }
  // RFC 7009: always 200, so the endpoint cannot be used to probe token validity.
  return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
});

/** Housekeeping for the scheduled handler. */
export async function purgeExpiredAuthState(env: Env): Promise<void> {
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM oauth_auth_codes WHERE expires_at < ?`).bind(at),
    env.DB.prepare(`DELETE FROM login_challenges WHERE expires_at < ?`).bind(at),
    env.DB.prepare(`DELETE FROM oauth_tokens WHERE expires_at < ?`).bind(at),
    env.DB.prepare(`DELETE FROM admin_sessions WHERE expires_at < ?`).bind(at),
    env.DB.prepare(
      `DELETE FROM users
         WHERE email_hash LIKE 'anonymous:%'
           AND NOT EXISTS (SELECT 1 FROM oauth_auth_codes WHERE oauth_auth_codes.user_id = users.id)
           AND NOT EXISTS (SELECT 1 FROM oauth_tokens WHERE oauth_tokens.user_id = users.id)
           AND NOT EXISTS (SELECT 1 FROM bookings WHERE bookings.user_id = users.id)`,
    ),
  ]);
}
