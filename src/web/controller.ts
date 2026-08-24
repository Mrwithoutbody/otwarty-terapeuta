import { escapeHtml } from '../lib/sanitize';

/**
 * Kto jest administratorem danych. Jedno miejsce, bo ta sama tożsamość musi
 * wyjść identycznie w polityce prywatności, w regulaminie i w stopce — a trzy
 * kopie rozjeżdżają się przy pierwszej zmianie adresu.
 *
 * Dane rejestrowe są faktem z KRS, nie tekstem marketingowym: pola zostają
 * puste, dopóki nie zostaną potwierdzone przez zarząd spółki. Pusta wartość
 * nie renderuje wiersza, więc strona nigdy nie pokazuje wymyślonego numeru.
 */
export interface Controller {
  /** Pełna nazwa z rejestru. */
  name: string;
  /** Ulica i numer. */
  street: string;
  /** Kod pocztowy i miejscowość. */
  city: string;
  krs: string;
  nip: string;
  regon: string;
  /** Sąd rejestrowy prowadzący akta spółki. */
  court: string;
  /** Adres do spraw danych osobowych. */
  email: string;
  /** Inspektor ochrony danych — pusty ciąg, jeżeli nie powołano. */
  dpo: string;
}

export const CONTROLLER: Controller = {
  name: 'Blockbox sp. z o.o.',
  street: '',
  city: '',
  krs: '',
  nip: '',
  regon: '',
  court: '',
  email: 'kontakt@otwartyterapeuta.pl',
  dpo: '',
};

/** Czy mamy komplet danych rejestrowych, czy tylko samą nazwę. */
export function controllerIsComplete(c: Controller = CONTROLLER): boolean {
  return [c.street, c.city, c.krs, c.nip, c.regon].every((value) => value.trim() !== '');
}

/**
 * Tożsamość administratora jako lista par. Wiersz bez wartości nie powstaje,
 * więc dopóki zarząd nie potwierdzi numerów, strona pokazuje samą nazwę i adres
 * kontaktowy zamiast pustych rubryk albo — co gorsza — wartości zmyślonych.
 */
export function controllerDetails(c: Controller = CONTROLLER): string {
  const rows: Array<[string, string]> = ([
    ['Nazwa', c.name],
    ['Adres', [c.street, c.city].filter((part) => part.trim() !== '').join(', ')],
    ['KRS', c.krs],
    ['NIP', c.nip],
    ['REGON', c.regon],
    ['Sąd rejestrowy', c.court],
  ] as Array<[string, string]>).filter(([, value]) => value.trim() !== '');

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
