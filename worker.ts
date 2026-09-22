import { Hono } from 'hono';
import { assertConfig, ConfigError, type Env } from './shared/env';
import { mcpApp, mcpFetch } from './apps/mcp/index';
import { panelApp } from './apps/panel/index';
import { portalApp } from './apps/portal/index';
import { htmlResponse, renderPage, securityHeaders } from './shared/web/layout';
import { fillFromSchedules } from './apps/panel/db/slots';
import { log } from './shared/lib/log';
import { purgeExpiredAuthState, purgeExpiredData } from './shared/db/retention';
import { drainOutbox } from './shared/notify/outbox';


export { TherapistBookingCoordinator } from './apps/mcp/booking/coordinator';

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

// -------------------------------------------------------------- sub-apps ---

// The route sets are disjoint, so the mount order only documents ownership.
app.route('/', mcpApp);
app.route('/', panelApp);
app.route('/', portalApp);

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

// ---------------------------------------------------------------- export ---

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      assertConfig(env);
    } catch (error) {
      log.error('config.invalid', error, { environment: env.ENVIRONMENT });
      return new Response(
        error instanceof ConfigError ? error.message : 'Serwis jest niepoprawnie skonfigurowany.',
        { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    }

    const early = await mcpFetch(request, env);
    if (early) return early;

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
          // Cron też przechodzi przez `assertConfig`: reszta kodu traktuje
          // sekrety jako obecne, a zadanie w tle nie ma jak o to zapytać.
          assertConfig(env);
          const result = await drainOutbox(env, 50);
          await purgeExpiredAuthState(env);
          const purged = await purgeExpiredData(env);
          const slots = await fillFromSchedules(env);
          log.info('scheduled.done', {
            count: result.sent,
            // Liczby, nie treści: ile wierszy przeszło retencję.
            reason: `purge:${purged.outbox}/${purged.bookingContacts}/${purged.auditEvents} slots:${slots}`,
          });
        } catch (error) {
          log.error('scheduled.failed', error);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
