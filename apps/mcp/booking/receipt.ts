import type { Context } from 'hono';
import type { Env } from '../../../shared/env';
import { hmacHex, timingSafeEqual } from '../../../shared/lib/crypto';
import { escapeHtml } from '../../../shared/lib/sanitize';
import { formatDateTime, formatPrice } from '../../../shared/lib/time';
import { htmlResponse, renderPage } from '../../../shared/web/layout';

/**
 * The page a client reaches from the link in the confirmation e-mail. It is
 * the only reader of `manage_token_hash`, which booking/service.ts writes, so
 * the token format has one owner.
 */
export async function receiptPage(c: Context<{ Bindings: Env }>): Promise<Response> {
  const ref = c.req.param('ref');
  const secret = new URL(c.req.url).searchParams.get('k') ?? '';
  const notFound = renderPage(c.env, {
    title: 'Rezerwacja',
    path: '/',
    noindex: true,
    body: `<h1>Nie znaleziono rezerwacji</h1>
           <p>Link jest nieprawidłowy lub wygasł. Sprawdź adres z wiadomości potwierdzającej.</p>`,
  });

  if (!c.env.TOKEN_SIGNING_KEY || !secret) return htmlResponse(c.env, notFound, { status: 404 });

  const row = await c.env.DB.prepare(
    `SELECT b.public_ref, b.status, b.starts_at_utc, b.timezone, b.price_minor, b.currency,
            b.manage_token_hash, b.session_type, b.mode, t.display_name, t.cancellation_policy
       FROM bookings b JOIN therapists t ON t.id = b.therapist_id WHERE b.public_ref = ?`,
  )
    .bind(ref)
    .first<{
      public_ref: string;
      status: string;
      starts_at_utc: string;
      timezone: string;
      price_minor: number;
      currency: string;
      manage_token_hash: string;
      session_type: string;
      mode: string;
      display_name: string;
      cancellation_policy: string;
    }>();

  if (!row) return htmlResponse(c.env, notFound, { status: 404 });
  const expected = await hmacHex(c.env.TOKEN_SIGNING_KEY, `manage:${secret}`);
  if (!timingSafeEqual(expected, row.manage_token_hash)) {
    return htmlResponse(c.env, notFound, { status: 404 });
  }

  return htmlResponse(
    c.env,
    renderPage(c.env, {
      title: `Rezerwacja ${row.public_ref}`,
      path: '/',
      noindex: true,
      body: `
<h1>Rezerwacja ${escapeHtml(row.public_ref)}</h1>
<p class="meta">Status: ${row.status === 'cancelled' ? 'odwołana' : 'potwierdzona'}</p>
<div class="card">
  <dl>
    <dt>Terapeuta</dt><dd>${escapeHtml(row.display_name)}</dd>
    <dt>Termin</dt><dd>${escapeHtml(formatDateTime(row.starts_at_utc, row.timezone))} (${escapeHtml(row.timezone)})</dd>
    <dt>Forma</dt><dd>${escapeHtml(row.session_type)}, ${row.mode === 'online' ? 'online' : 'stacjonarnie'}</dd>
    <dt>Cena</dt><dd>${escapeHtml(formatPrice(row.price_minor, row.currency))}</dd>
  </dl>
</div>
<h2>Zasady odwołania</h2>
<p>${escapeHtml(row.cancellation_policy || 'Zgodnie z regulaminem terapeuty.')}</p>
<p>Aby odwołać wizytę, poproś asystenta ChatGPT o odwołanie tej rezerwacji albo napisz na
<a href="mailto:${escapeHtml(c.env.SUPPORT_EMAIL)}">${escapeHtml(c.env.SUPPORT_EMAIL)}</a>.</p>`,
    }),
  );
}
