/**
 * Napisy katalogu: nazwy języków (z flagą) i wezwanie do wtyczki ChatGPT.
 */
import type { Env } from '../env';
import { escapeHtml } from '../lib/sanitize';

/** Nazwy języków, w których katalog trzyma kody. */
const LANGUAGE_NAMES: Record<string, string> = {
  pl: 'polski', en: 'angielski', uk: 'ukraiński', ru: 'rosyjski', de: 'niemiecki', fr: 'francuski', es: 'hiszpański', be: 'białoruski',
};

/**
 * Flagi rysowane inline: żadnej zewnętrznej biblioteki ani pliku, bo strona ma
 * ścisły CSP i nie wolno jej nic dociągać. Kształty są uproszczone — przy 1em
 * i tak widać tylko układ barw. Flaga oznacza język, nie kraj; to skrót
 * wizualny, więc nazwa języka zostaje obok jako właściwa informacja.
 */
const LANGUAGE_FLAGS: Record<string, string> = {
  pl: '<svg viewBox="0 0 3 2"><rect width="3" height="2" fill="#fff"/><rect y="1" width="3" height="1" fill="#d4213d"/></svg>',
  en: '<svg viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169"/><path d="M0,0 L60,40 M60,0 L0,40" stroke="#fff" stroke-width="8"/><path d="M0,0 L60,40 M60,0 L0,40" stroke="#c8102e" stroke-width="4"/><path d="M30,0 V40 M0,20 H60" stroke="#fff" stroke-width="12"/><path d="M30,0 V40 M0,20 H60" stroke="#c8102e" stroke-width="6"/></svg>',
  uk: '<svg viewBox="0 0 3 2"><rect width="3" height="2" fill="#ffd500"/><rect width="3" height="1" fill="#005bbb"/></svg>',
  ru: '<svg viewBox="0 0 3 3"><rect width="3" height="3" fill="#d52b1e"/><rect width="3" height="2" fill="#0039a6"/><rect width="3" height="1" fill="#fff"/></svg>',
  de: '<svg viewBox="0 0 3 3"><rect width="3" height="3" fill="#ffce00"/><rect width="3" height="2" fill="#dd0000"/><rect width="3" height="1" fill="#000"/></svg>',
  fr: '<svg viewBox="0 0 3 2"><rect width="3" height="2" fill="#ce1126"/><rect width="2" height="2" fill="#fff"/><rect width="1" height="2" fill="#002654"/></svg>',
  es: '<svg viewBox="0 0 12 8"><rect width="12" height="8" fill="#aa151b"/><rect y="2" width="12" height="4" fill="#f1bf00"/></svg>',
  be: '<svg viewBox="0 0 12 8"><rect width="12" height="8" fill="#007c30"/><rect width="12" height="5" fill="#cf0921"/><rect width="2" height="8" fill="#fff"/></svg>',
};

export function languageList(codes: string[]): string {
  if (codes.length === 0) return 'brak danych';
  return codes
    .map((code) => {
      const name = escapeHtml(LANGUAGE_NAMES[code] ?? code);
      const flag = LANGUAGE_FLAGS[code];
      return flag ? `<span class="lang">${flag}${name}</span>` : name;
    })
    .join(', ');
}

export function pluginCta(env: Env): string {
  const url = env.PUBLIC_PLUGIN_URL?.trim();
  if (!url) {
    return `<a class="btn secondary" href="/jak-to-dziala">Zobacz, jak działa w ChatGPT <span aria-hidden="true">→</span></a>`;
  }
  return `<a class="btn secondary" href="${escapeHtml(url)}" rel="noopener">Znajdź terapeutę z pomocą ChatGPT <span aria-hidden="true">↗</span></a>`;
}
