import type { Env } from '../env';
import { escapeHtml } from '../lib/sanitize';
import { ADMIN_CSS, ADMIN_JS } from './admin-ui';
import { CONTROLLER } from './controller';
import { LP_CSS } from './lp';
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
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

const assetVersion = (...parts: string[]): string => fnv1a(parts.join('\u0000'));

const APP_CSS_VERSION = assetVersion(APP_CSS);
const ADMIN_ASSET_VERSION = assetVersion(ADMIN_CSS, ADMIN_JS);
const LP_CSS_VERSION = assetVersion(LP_CSS);

/**
 * Content-Security-Policy for the website. No inline scripts anywhere, which
 * is why the stylesheet is a separate file and every form is server rendered.
 * The only third-party origin is Turnstile, and only where a form needs it.
 */
function contentSecurityPolicy(withTurnstile: boolean, formActionOrigin?: string): string {
  const script = withTurnstile
    ? `script-src 'self' https://challenges.cloudflare.com`
    : `script-src 'self'`;
  const frame = withTurnstile
    ? `frame-src 'self' https://challenges.cloudflare.com`
    : `frame-src 'self'`;
  return [
    `default-src 'none'`,
    script,
    `style-src 'self'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
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
    'content-security-policy': contentSecurityPolicy(withTurnstile, formActionOrigin),
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

export interface NavItem {
  href: string;
  label: string;
}

const NAV: NavItem[] = [
  { href: '/terapeuci', label: 'Terapeuci' },
  { href: '/dla-terapeutow', label: 'Dla terapeutów' },
  { href: '/jak-to-dziala', label: 'Jak to działa' },
  { href: '/bezpieczenstwo', label: 'Bezpieczeństwo' },
  { href: '/pomoc-w-kryzysie', label: 'Pomoc w kryzysie' },
];

export interface PageOptions {
  title: string;
  description?: string;
  path: string;
  /** Rendered inside <main>. Must already be escaped. */
  body: string;
  noindex?: boolean;
  /**
   * Loads the admin stylesheet and the admin enhancement script. Both are
   * same-origin files, so the `script-src 'self'` policy stays untouched.
   */
  adminAssets?: boolean;
  /** Loads the engine stylesheet: the profile is an engine page inside the catalogue. */
  lp?: boolean;
}

/** Versioned stylesheet URL for a subpage document rendered outside `renderPage`. */
export function assetUrls(lpDocCss: string): { lpDocCss: string } {
  return { lpDocCss: `/assets/lp-doc.css?v=${assetVersion(lpDocCss)}` };
}

export function renderPage(env: Env, options: PageOptions): string {
  const nav = NAV.map(
    (item) =>
      `<li><a href="${item.href}"${options.path === item.href ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</a></li>`,
  ).join('');

  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)} — Otwarty Terapeuta</title>
<meta name="description" content="${escapeHtml(options.description ?? 'Katalog psychoterapeutów i rezerwacja wizyt.')}">
${options.noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
<link rel="stylesheet" href="/assets/app.css?v=${APP_CSS_VERSION}">
${options.lp ? `<link rel="stylesheet" href="/assets/lp.css?v=${LP_CSS_VERSION}">\n` : ''}${
  options.adminAssets
    ? `<link rel="stylesheet" href="/assets/admin.css?v=${ADMIN_ASSET_VERSION}">\n` +
      `<script src="/assets/admin.js?v=${ADMIN_ASSET_VERSION}" defer></script>`
    : ''
}
<link rel="icon" href="data:,">
</head>
<body>
<a class="skip-link" href="#tresc">Przejdź do treści</a>
<header class="site">
  <div class="wrap">
    <a class="brand" href="/" aria-label="Otwarty Terapeuta — strona główna">
      <img src="/logo.svg" alt="" width="34" height="34">
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
      <a class="brand" href="/"><img src="/logo.svg" alt="" width="36" height="36"><span>Otwarty Terapeuta</span></a>
      <p>Przejrzysty katalog psychoterapeutów i prosta rezerwacja wizyt — bez ukrytego rankingu.</p>
    </div>
    <div class="footer-links">
      <div><h2>Serwis</h2><ul>
        <li><a href="/terapeuci">Terapeuci</a></li>
        <li><a href="/jak-to-dziala">Jak to działa</a></li>
        <li><a href="/dla-terapeutow">Dla terapeutów</a></li>
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
        CONTROLLER.city.trim() === '' ? '' : `, ${escapeHtml(CONTROLLER.city)}`
      }</p>
    </div>
  </div>
</footer>
</body>
</html>`;
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
