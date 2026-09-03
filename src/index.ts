import { Hono } from 'hono';
import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  oauthMetadataResponse,
  originValidationResponse,
  verifyBearerToken,
  type AuthInfo,
  type AuthMetadataOptions,
} from '@modelcontextprotocol/server';
import { ALL_SCOPES, assertConfig, ConfigError, type Env } from './env';
import { authorizationServerMetadata, oauthApp, purgeExpiredAuthState } from './auth/oauth';
import { D1TokenVerifier } from './auth/verifier';
import { createServerFactory } from './mcp/server';
import { addToolSecuritySchemes, isOAuthToolName } from './mcp/security';
import { adminApp } from './web/admin';
import { therapistSignupApp } from './web/therapist-signup';
import { siteApp } from './web/pages';
import { htmlResponse, renderPage, securityHeaders } from './web/layout';
import { APP_CSS } from './web/styles';
import { ADMIN_CSS, ADMIN_JS } from './web/admin-ui';
import { LP_HOST_CSS } from './web/lp';
import { topUpDemoSlots } from './db/demo';
import { log } from './lib/log';
import { purgeExpiredData } from './db/retention';
import { drainOutbox } from './notify/outbox';


export { TherapistBookingCoordinator } from './booking/coordinator';

/**
 * Single Worker serving three surfaces:
 *
 *  - the public website and the admin panel (HTML, strict CSP);
 *  - the OAuth 2.1 Authorization Server;
 *  - the MCP endpoint at /mcp (Streamable HTTP, stateless transport).
 *
 * Stateless means transport-stateless: all business state lives in D1, and
 * booking concurrency is serialised by the TherapistBookingCoordinator
 * Durable Object.
 */

const app = new Hono<{ Bindings: Env }>();

// ------------------------------------------------------------ static bits ---

app.get('/assets/app.css', () =>
  new Response(APP_CSS, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  }),
);

// Reguły hosta dla stron terapeutek (kalendarz, przyciski) jako plik: arkusz
// silnika przychodzi z usługi stron, ten dokłada to, czego usługa nie zna.
app.get('/assets/lp-host.css', () =>
  new Response(LP_HOST_CSS, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  }),
);

// Admin-only assets. The panel is noindex and behind a session, but these two
// files carry no data, so they are served like any other static asset.
app.get('/assets/admin.css', () =>
  new Response(ADMIN_CSS, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  }),
);

app.get('/assets/admin.js', () =>
  new Response(ADMIN_JS, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  }),
);

app.get('/robots.txt', () =>
  new Response(
    // No Sitemap line: there is no sitemap yet, and pointing at a 404 is worse
    // than pointing at nothing.
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /oauth\nDisallow: /rezerwacja\n`,
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  ),
);

/**
 * Domain-control proof for the OpenAI public plugin submission. The portal
 * requires the response body to contain only its exact token. Keep the route
 * unavailable until the portal has generated a token for this plugin.
 */
app.get('/.well-known/openai-apps-challenge', (c) => {
  const token = c.env.OPENAI_APPS_CHALLENGE?.trim();
  if (!token) return new Response('Not found', { status: 404 });
  return new Response(token, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
});

/**
 * Placeholder avatar for the demo profiles: a neutral abstract shape, no stock
 * photography, nothing that could be mistaken for a real person. `currentColor`
 * lets the stylesheet tint it per card instead of the server baking in a palette.
 *
 * The filename is matched whole and parsed here: a Hono param with a regex
 * followed by a literal suffix in the same segment does not match.
 */
/**
 * The stand-in for a therapist who has not uploaded a photograph yet.
 *
 * Drawn at 4:5 because that is the crop every profile block uses - the previous
 * one was square, and stretching it to portrait produced a giant forehead. A
 * neutral figure: this stands in for anyone, so no hair, no clothing detail and
 * no colour that reads as a gender.
 */
/** Therapist photos uploaded by an administrator live in R2, when it is bound. */
app.get('/media/:key{.+}', async (c) => {
  if (!c.env.MEDIA) return new Response('Not found', { status: 404 });
  const key = c.req.param('key');
  let object = await c.env.MEDIA.get(key);
  // Thumbnails are written beside their master as `<base>-160.<ext>`, and the
  // catalogue derives that address rather than storing it. A photo uploaded
  // before thumbnails existed has no such object, so serve the master instead
  // of a broken image.
  if (!object) {
    const master = key.replace(/-160(\.[a-z]+)$/, '$1');
    if (master !== key) object = await c.env.MEDIA.get(master);
  }
  if (!object) return new Response('Not found', { status: 404 });
  const type = object.httpMetadata?.contentType ?? 'application/octet-stream';
  // Only image types are ever served back, whatever was stored.
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(type)) return new Response('Not found', { status: 404 });
  return new Response(object.body, {
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
});

// -------------------------------------------------------------- sub-apps ---

app.route('/oauth', oauthApp);
app.route('/admin', adminApp);
app.route('/dla-terapeutow', therapistSignupApp);
app.route('/', siteApp);

app.notFound((c) =>
  htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Nie znaleziono strony',
      path: '/',
      body: `<h1>Nie znaleziono strony</h1><p>Ten adres nie istnieje.</p><p><a href="/">Strona główna</a></p>`,
    }),
    { status: 404 },
  ),
);

app.onError((error, c) => {
  if (error instanceof ConfigError) {
    log.error('config.invalid', error, { environment: c.env.ENVIRONMENT });
    return new Response('Serwis jest niepoprawnie skonfigurowany.', { status: 503 });
  }
  log.error('request.failed', error, { route: new URL(c.req.url).pathname });
  return htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Błąd',
      path: '/',
      body: `<h1>Coś poszło nie tak</h1><p>Spróbuj ponownie za chwilę.</p>`,
    }),
    { status: 500 },
  );
});

// ------------------------------------------------------------------- MCP ---

function authMetadataOptions(env: Env): AuthMetadataOptions {
  return {
    oauthMetadata: authorizationServerMetadata(env) as AuthMetadataOptions['oauthMetadata'],
    resourceServerUrl: new URL(env.PUBLIC_MCP_URL),
    serviceDocumentationUrl: new URL(`${env.PUBLIC_BASE_URL}/jak-to-dziala`),
    scopesSupported: ALL_SCOPES,
    resourceName: 'Otwarty Terapeuta',
    dangerouslyAllowInsecureIssuerUrl: env.ENVIRONMENT === 'local',
  };
}

const MCP_CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers':
    'content-type, authorization, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version, www-authenticate',
  'access-control-max-age': '86400',
};

function allowedHostnames(env: Env): string[] {
  const hosts = new Set<string>(['localhost', '127.0.0.1', '[::1]']);
  for (const value of [env.PUBLIC_BASE_URL, env.PUBLIC_MCP_URL]) {
    try {
      hosts.add(new URL(value).hostname);
    } catch {
      /* a malformed var is caught by assertConfig-adjacent checks, not here */
    }
  }
  return [...hosts];
}

/**
 * Verifies a Bearer token when one is present. A missing token is NOT an
 * error: the catalogue tools are public, and the private tools answer with
 * their own `mcp/www_authenticate` challenge.
 */
async function resolveAuth(env: Env, request: Request): Promise<AuthInfo | Response | undefined> {
  const header = request.headers.get('authorization');
  if (!header) return undefined;
  try {
    return await verifyBearerToken(header, {
      verifier: new D1TokenVerifier(env),
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(env.PUBLIC_MCP_URL)),
    });
  } catch (error) {
    const response = bearerAuthChallengeResponse(error, {
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(env.PUBLIC_MCP_URL)),
    });
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(MCP_CORS_HEADERS)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  }
}

async function handleMcp(request: Request, env: Env, anonymousOnly = false): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
  }

  const rejected =
    hostHeaderValidationResponse(request, allowedHostnames(env)) ??
    originValidationResponse(request, allowedHostnames(env));
  if (rejected) return rejected;

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (!(await env.RL_PUBLIC.limit({ key: `mcp:${ip}` })).success) {
    return Response.json(
      { jsonrpc: '2.0', error: { code: -32000, message: 'Zbyt wiele żądań. Spróbuj ponownie za chwilę.' } },
      { status: 429, headers: MCP_CORS_HEADERS },
    );
  }

  let isToolsList = false;
  let blockedCall: { id?: unknown; name: unknown } | undefined;
  if (request.method === 'POST') {
    try {
      const message = (await request.clone().json()) as {
        id?: unknown;
        method?: unknown;
        params?: { name?: unknown };
      };
      isToolsList = message.method === 'tools/list';
      if (anonymousOnly && message.method === 'tools/call' && isOAuthToolName(message.params?.name)) {
        blockedCall = { id: message.id, name: message.params?.name };
      }
    } catch {
      // The MCP handler returns the protocol-level parse error.
    }
  }

  if (blockedCall) {
    return Response.json(
      {
        jsonrpc: '2.0',
        id: blockedCall.id ?? null,
        error: {
          code: -32601,
          message: `Narzędzie ${String(blockedCall.name)} nie jest dostępne w publicznym trybie testowym.`,
        },
      },
      { status: 200, headers: MCP_CORS_HEADERS },
    );
  }

  // The public testing endpoint deliberately ignores Authorization headers.
  // That keeps it entirely outside OAuth, including when a client reuses a
  // stale header left over from a previously configured connection.
  const auth = anonymousOnly ? undefined : await resolveAuth(env, request);
  if (auth instanceof Response) return auth;

  const handler = createMcpHandler(createServerFactory(env), {
    onerror: (error) => log.error('mcp.transport_error', error),
  });

  let response = await handler.fetch(request, auth ? { authInfo: auth } : undefined);
  if (isToolsList && response.ok) {
    response = await addToolSecuritySchemes(response, { anonymousOnly });
  }
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(MCP_CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

// ---------------------------------------------------------------- export ---

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      assertConfig(env);
    } catch (error) {
      log.error('config.invalid', error, { environment: env.ENVIRONMENT });
      return new Response(
        error instanceof ConfigError ? error.message : 'Serwis jest niepoprawnie skonfigurowany.',
        { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    }

    // Do not publish fallback resource metadata at the hostname root. Clients
    // probing /public/mcp commonly fall back to this URL and would otherwise
    // misclassify the deliberately anonymous endpoint as OAuth-protected.
    // The full /mcp endpoint keeps its path-specific RFC 9728 document.
    if (url.pathname === '/.well-known/oauth-protected-resource') {
      return new Response('Not found', { status: 404 });
    }

    // RFC 9728 / RFC 8414 discovery documents, served by the SDK so the shape
    // always matches what MCP clients expect.
    const metadata = oauthMetadataResponse(request, authMetadataOptions(env));
    if (metadata) return metadata;

    if (url.pathname === '/mcp') return handleMcp(request, env);
    if (url.pathname === '/public/mcp') return handleMcp(request, env, true);

    // The MCP subdomain serves nothing but the protocol surface.
    if (url.hostname.startsWith('mcp.') && url.pathname !== '/') {
      return new Response('Not found', { status: 404 });
    }

    const response = await app.fetch(request, env, ctx);
    if (response.headers.get('content-type')?.includes('text/html')) return response;

    // Non-HTML responses (JSON exports, media) still get the baseline headers.
    const headers = new Headers(response.headers);
    const baseline = securityHeaders(env);
    for (const key of ['referrer-policy', 'x-content-type-options', 'strict-transport-security']) {
      const value = baseline[key];
      if (value && !headers.has(key)) headers.set(key, value);
    }
    return new Response(response.body, { status: response.status, headers });
  },

  /**
   * Housekeeping: retry queued notifications, purge expired auth state and run
   * the retention the privacy policy promises.
   * Notification delivery is deliberately outside the booking transaction.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const result = await drainOutbox(env, 50);
          await purgeExpiredAuthState(env);
          const purged = await purgeExpiredData(env);
          const demo = await topUpDemoSlots(env);
          log.info('scheduled.done', {
            count: result.sent,
            demoSlots: demo.added,
            // Liczby, nie treści: ile wierszy przeszło retencję.
            reason: `purge:${purged.outbox}/${purged.bookingContacts}/${purged.auditEvents}`,
          });
        } catch (error) {
          log.error('scheduled.failed', error);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
