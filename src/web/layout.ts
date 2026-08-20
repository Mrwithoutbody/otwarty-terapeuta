import type { Env } from '../env';
import { escapeHtml } from '../lib/sanitize';
import { ADMIN_ASSET_VERSION } from './admin-ui';

/**
 * Content-Security-Policy for the website. No inline scripts anywhere, which
 * is why the stylesheet is a separate file and every form is server rendered.
 * The only third-party origin is Turnstile, and only where a form needs it.
 */
export function contentSecurityPolicy(withTurnstile: boolean): string {
  const script = withTurnstile
    ? `script-src 'self' https://challenges.cloudflare.com`
    : `script-src 'self'`;
  const frame = withTurnstile ? `frame-src https://challenges.cloudflare.com` : `frame-src 'none'`;
  return [
    `default-src 'none'`,
    script,
    `style-src 'self'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    frame,
    `form-action 'self'`,
    `base-uri 'none'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
  ].join('; ');
}

export function securityHeaders(env: Env, withTurnstile = false): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': contentSecurityPolicy(withTurnstile),
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
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
<link rel="stylesheet" href="/assets/app.css?v=20260820-7">
${
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
      <p>Otwarty Terapeuta nie jest usługą terapeutyczną, nie diagnozuje i nie zastępuje pomocy w nagłym zagrożeniu życia lub zdrowia. W takiej sytuacji zadzwoń pod <strong>112</strong>, a po wsparcie emocjonalne pod <strong>116 123</strong>.</p>
      <p>Serwis dla osób pełnoletnich.</p>
    </div>
  </div>
</footer>
</body>
</html>`;
}

export function htmlResponse(env: Env, html: string, init: ResponseInit = {}, withTurnstile = false): Response {
  return new Response(html, {
    ...init,
    headers: { ...securityHeaders(env, withTurnstile), ...(init.headers ?? {}) },
  });
}
