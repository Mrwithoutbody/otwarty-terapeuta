import { createHash } from 'node:crypto';
import type { Env } from '../env';
import { fnv1a } from '../lib/crypto';
import { escapeHtml } from '../lib/sanitize';
import { ADMIN_CSS, ADMIN_JS } from './admin-ui';
import { CONTROLLER } from './controller';
import { pagesOrigin } from './pages-client';
import { APP_CSS } from './styles';

/**
 * Cache-busting suffix derived from the asset's own bytes, so editing a
 * stylesheet or the panel script invalidates the browser cache without anyone
 * having to remember to bump a hand-written version number.
 *
 * This hashes the content, not its length. Length alone silently fails on any
 * edit that keeps the byte count - `68rem` to `46rem` is the same size, so the
 * URL never changed and browsers kept serving the old stylesheet for an hour.
 */
const assetVersion = (...parts: string[]): string => fnv1a(parts.join('\u0000')).toString(36);

const APP_CSS_VERSION = assetVersion(APP_CSS);
const ADMIN_ASSET_VERSION = assetVersion(ADMIN_CSS, ADMIN_JS);

/**
 * Public pages carry the stylesheet inline: a linked one blocks the first paint
 * for a round trip, and a visitor rarely sees more than two of these pages, so
 * the shared cache bought little. The CSP allows exactly these bytes by hash -
 * no 'unsafe-inline', no nonce. The panel keeps the linked file.
 */
const APP_CSS_CSP_HASH = `'sha256-${createHash('sha256').update(APP_CSS).digest('base64')}'`;

/**
 * Content-Security-Policy for the website. No inline scripts anywhere and every
 * form is server rendered; the one inline stylesheet is allowed by its hash.
 * Two other origins: Turnstile, only where a form needs it, and the pages
 * service - its editor is framed in the panel, its stylesheet and fonts are
 * linked from every therapist page.
 */
function contentSecurityPolicy(withTurnstile: boolean, formActionOrigin: string | undefined, pages: string | null): string {
  const script = withTurnstile
    ? `script-src 'self' https://challenges.cloudflare.com`
    : `script-src 'self'`;
  // Edytor usługi wraca do ramki - tym razem w oknie dialogowym na niemal całe
  // okno, nie w kolumnie panelu.
  const frame = [`frame-src 'self'`, withTurnstile ? 'https://challenges.cloudflare.com' : '', pages ?? '']
    .filter(Boolean)
    .join(' ');
  const own = pages ? `'self' ${pages}` : `'self'`;
  return [
    `default-src 'none'`,
    script,
    // Kroje motywów usługi idą z Google Fonts: arkusz z googleapis, pliki z gstatic.
    `style-src ${own} ${APP_CSS_CSP_HASH}${pages ? ' https://fonts.googleapis.com' : ''}`,
    // The service's themes bring their own photographs, served from its origin.
    `img-src ${own} data:`,
    `font-src ${own}${pages ? ' https://fonts.gstatic.com' : ''}`,
    `connect-src 'self'`,
    frame,
    // Browsers apply form-action to the WHOLE redirect chain, not just the action
    // URL. The OAuth consent form posts to us and we then 302 the browser to the
    // client's redirect_uri, so that origin has to be allowed here or the submit is
    // blocked outright - with a misleading message naming our own URL.
    formActionOrigin ? `form-action 'self' ${formActionOrigin}` : `form-action 'self'`,
    `base-uri 'none'`,
    `frame-ancestors 'self'`,
    `object-src 'none'`,
  ].join('; ');
}

export function securityHeaders(
  env: Env,
  withTurnstile = false,
  formActionOrigin?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': contentSecurityPolicy(withTurnstile, formActionOrigin, pagesOrigin(env)),
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    // SAMEORIGIN, not DENY: the layout builder frames the profile being edited.
    // The header is the legacy twin of frame-ancestors above.
    'x-frame-options': 'SAMEORIGIN',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    'cross-origin-opener-policy': 'same-origin',
  };
  if (env.ENVIRONMENT === 'production') {
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

interface NavItem {
  href: string;
  label: string;
}

const NAV: NavItem[] = [
  { href: '/terapeuci', label: 'Terapeuci' },
  { href: '/jak-to-dziala', label: 'Jak to działa' },
  { href: '/bezpieczenstwo', label: 'Bezpieczeństwo' },
  { href: '/pomoc-w-kryzysie', label: 'Pomoc w kryzysie' },
];

interface PageOptions {
  title: string;
  description?: string;
  path: string;
  /** Rendered inside <main>. Must already be escaped. */
  body: string;
  noindex?: boolean;
  /** Extra markup for <head>, already escaped - structured data of a page. */
  head?: string;
  /**
   * Loads the admin stylesheet and the admin enhancement script. Both are
   * same-origin files, so the `script-src 'self'` policy stays untouched.
   */
  adminAssets?: boolean;
}


export function renderPage(env: Env, options: PageOptions): string {
  const nav = NAV.map(
    (item) =>
      `<li><a href="${item.href}"${options.path === item.href ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</a></li>`,
  ).join('');
  const description = options.description ?? 'Katalog psychoterapeutów i rezerwacja wizyt.';
  const fullTitle = `${options.title} — Otwarty Terapeuta`;
  const url = `${env.PUBLIC_BASE_URL}${options.path}`;
  // Indexable pages only: a canonical or a share card on a booking receipt would be a lie.
  const share = options.noindex
    ? ''
    : `<link rel="canonical" href="${escapeHtml(url)}">
<meta name="robots" content="max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Otwarty Terapeuta">
<meta property="og:locale" content="pl_PL">
<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(env.PUBLIC_BASE_URL)}/og-image.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">`;

  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
${options.noindex ? '<meta name="robots" content="noindex, nofollow">' : share}
${options.head ?? ''}
<link rel="preload" href="/fonts/inter-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/inter-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/lora-latin-variable.woff2" as="font" type="font/woff2" crossorigin>
${
  options.adminAssets
    ? `<link rel="stylesheet" href="/assets/app.css?v=${APP_CSS_VERSION}">\n` +
      `<link rel="stylesheet" href="/assets/admin.css?v=${ADMIN_ASSET_VERSION}">\n` +
      `<script src="/assets/admin.js?v=${ADMIN_ASSET_VERSION}" defer></script>`
    : `<style>${APP_CSS}</style>`
}
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#f7f8f1">
</head>
<body>
<a class="skip-link" href="#tresc">Przejdź do treści</a>
<header class="site">
  <div class="wrap">
    <a class="brand" href="/" aria-label="Otwarty Terapeuta — strona główna">
      <img src="/logo.svg?v=2" alt="" width="34" height="34">
      <span>Otwarty Terapeuta</span>
    </a>
    <nav class="site desktop-nav" aria-label="Nawigacja główna"><ul>${nav}</ul></nav>
    <a class="header-cta" href="/terapeuci">Znajdź terapeutę</a>
    <details class="mobile-nav">
      <summary>Menu</summary>
      <nav aria-label="Nawigacja mobilna"><ul>${nav}</ul></nav>
    </details>
  </div>
</header>
<main id="tresc">
  <div class="wrap">
${options.body}
  </div>
</main>
<footer class="site">
  <div class="wrap">
    <!-- The crisis numbers used to be a box repeated on three subpages and a
         sentence in the legal small print. In the footer they are on every page
         instead, which is where someone scrolling to the end of a bad day gets
         to them. -->
    <aside class="footer-crisis" aria-labelledby="kryzys-naglowek">
      <h2 id="kryzys-naglowek">Potrzebujesz pomocy natychmiast?</h2>
      <ul>
        <li><a href="tel:112"><b>112</b><span>bezpośrednie zagrożenie życia</span></a></li>
        <li><a href="tel:116123"><b>116 123</b><span>wsparcie emocjonalne, całą dobę</span></a></li>
        <li><a href="tel:116111"><b>116 111</b><span>telefon zaufania dla młodzieży</span></a></li>
      </ul>
      <p><a href="/pomoc-w-kryzysie">Pełna lista miejsc pomocy <span aria-hidden="true">→</span></a></p>
    </aside>
    <div class="footer-brand">
      <a class="brand" href="/"><img src="/logo.svg?v=2" alt="" width="36" height="36"><span>Otwarty Terapeuta</span></a>
      <p>Przejrzysty katalog psychoterapeutów i prosta rezerwacja wizyt — bez ukrytego rankingu.</p>
    </div>
    <div class="footer-links">
      <div><h2>Serwis</h2><ul>
        <li><a href="/terapeuci">Terapeuci</a></li>
        <li><a href="/jak-to-dziala">Jak to działa</a></li>
        <li><a href="/dla-terapeutow">Dla terapeutów</a></li>
        <li><a href="https://otwartyterapeuta.pl/admin">Logowanie</a></li>
      </ul></div>
      <div><h2>Informacje</h2><ul>
        <li><a href="/regulamin">Regulamin</a></li>
        <li><a href="/polityka-prywatnosci">Prywatność</a></li>
        <li><a href="/bezpieczenstwo">Bezpieczeństwo</a></li>
        <li><a href="mailto:${escapeHtml(env.SUPPORT_EMAIL)}">Kontakt</a></li>
      </ul></div>
    </div>
    <div class="footer-legal">
      <p>Otwarty Terapeuta nie jest usługą terapeutyczną, nie diagnozuje i nie zastępuje pomocy w nagłym zagrożeniu życia lub zdrowia.</p>
      <p>Serwis dla osób pełnoletnich.</p>
      <!-- Bez kropki na końcu: nazwa spółki kończy się skrótem "o.o." i druga
           kropka wygląda jak literówka. -->
      <p>Operator serwisu i administrator danych: ${escapeHtml(CONTROLLER.name)}${
        CONTROLLER.address.trim() === '' ? '' : `, ${escapeHtml(CONTROLLER.address)}`
      }</p>
    </div>
  </div>
</footer>
</body>
</html>`;
}

/**
 * Pola formularza jako `URLSearchParams`. Wysyłki paneli są tekstowe; plik
 * (upload zdjęcia) czytany jest osobno z `formData`, więc tutaj odpada.
 */
export async function formValues(request: Request): Promise<URLSearchParams> {
  const form = await request.formData();
  return new URLSearchParams([...form].filter((e): e is [string, string] => typeof e[1] === 'string'));
}

export function htmlResponse(
  env: Env,
  html: string,
  init: ResponseInit = {},
  withTurnstile = false,
  formActionOrigin?: string,
): Response {
  return new Response(html, {
    ...init,
    headers: { ...securityHeaders(env, withTurnstile, formActionOrigin), ...(init.headers ?? {}) },
  });
}
