import { escapeHtml } from '../lib/sanitize';

/**
 * Kto jest administratorem danych. Jedno miejsce, bo ta sama tożsamość musi
 * wyjść identycznie w polityce prywatności, w regulaminie i w stopce — a trzy
 * kopie rozjeżdżają się przy pierwszej zmianie adresu.
 *
 * Dane rejestrowe są faktem z KRS, nie tekstem marketingowym. Wiersz bez
 * wartości nie powstaje, więc dopóki zarząd nie potwierdzi numerów, strona
 * pokazuje samą nazwę i adres kontaktowy zamiast pustych rubryk albo — co
 * gorsza — wartości zmyślonych. Numer dopisujesz tutaj, jednym polem.
 */
export const CONTROLLER = {
  name: 'Blockbox sp. z o.o.',
  email: 'kontakt@otwartyterapeuta.pl',
  /** Ulica, numer, kod pocztowy i miejscowość — jedną linią, jak na pieczątce. */
  address: '',
  krs: '',
  nip: '',
  regon: '',
  /** Sąd rejestrowy prowadzący akta spółki. */
  court: '',
  /** Inspektor ochrony danych — pusty ciąg, jeżeli nie powołano. */
  dpo: '',
};

export type Controller = typeof CONTROLLER;

/**
 * Tożsamość administratora jako lista par. Pola bez wartości wypadają.
 */
export function controllerDetails(c: Controller = CONTROLLER): string {
  const rows: Array<[string, string]> = (
    [
      ['Nazwa', c.name],
      ['Adres', c.address],
      ['KRS', c.krs],
      ['NIP', c.nip],
      ['REGON', c.regon],
      ['Sąd rejestrowy', c.court],
    ] as Array<[string, string]>
  ).filter(([, value]) => value.trim() !== '');

  return `<dl class="pdata">${rows
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('')}</dl>
<p>Kontakt w sprawach danych osobowych:
<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>.${
    c.dpo.trim() === ''
      ? ' Nie powołaliśmy inspektora ochrony danych — korespondencję w tych sprawach prowadzi zarząd.'
      : ` Inspektor ochrony danych: ${escapeHtml(c.dpo)}.`
  }</p>`;
}
