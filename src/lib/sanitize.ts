/**
 * All therapist- and user-supplied text is untrusted, in three different ways:
 *  1. it may contain HTML  -> escape on every render (web page AND widget);
 *  2. it may contain prompt-injection instructions aimed at the model
 *     -> neutralise the markers a model is most likely to obey;
 *  3. it may contain invisible characters used to smuggle 1. or 2. past a
 *     human reviewer -> strip them at write time.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

// `<`, `>`, `&` end a script block early; U+2028/U+2029 are literal line
// terminators in JS but legal inside a JSON string.
const SCRIPT_UNSAFE = new RegExp('[<>&\\u2028\\u2029]', 'g');

/** Escapes a value for safe interpolation inside an inline <script> block. */
export function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value ?? null).replace(
    SCRIPT_UNSAFE,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

// C0/C1 control characters (tab, LF and CR excluded), soft hyphen, zero-width
// and bidi-override characters, word joiner range, and the BOM.
const INVISIBLE = new RegExp(
  '[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f' +
    '\\u00ad\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\ufeff]',
  'g',
);

const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Markers a language model is disproportionately likely to treat as
 * instructions rather than as content. Neutralised (not deleted) so a human
 * reviewer can still see that something was written there.
 */
const INJECTION_MARKERS: Array<[RegExp, string]> = [
  [/<\s*\/?\s*(system|assistant|user|tool|function)\b[^>]*>/gi, '[usunięty znacznik]'],
  [/\bignore (all|any|the) (previous|prior|above)\b/gi, '[usunięta instrukcja]'],
  [/\bdisregard (all|any|the) (previous|prior|above)\b/gi, '[usunięta instrukcja]'],
  [
    /\bzignoruj (?:\S+\s+){0,3}(?:polecenia|instrukcje|wytyczne)\b/gi,
    '[usunięta instrukcja]',
  ],
  [/^\s*#{1,6}\s*(system|instrukcje systemowe)\b/gim, '[usunięty nagłówek]'],
  [/\bsystem prompt\b/gi, '[usunięty fragment]'],
  [/\byou are (now )?an? [a-z ]{0,40}(assistant|model|ai)\b/gi, '[usunięta instrukcja]'],
];

/**
 * Normalises free text written by a therapist or an administrator before it is
 * persisted. Applied at the write boundary so the database never holds the
 * smuggled variant; HTML escaping at render time still applies on top.
 */
export function sanitizeRichText(value: string, maxLength = 4000): string {
  let out = String(value ?? '')
    .replace(INVISIBLE, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  for (const [pattern, replacement] of INJECTION_MARKERS) out = out.replace(pattern, replacement);
  return out.slice(0, maxLength);
}

export function sanitizeLine(value: string, maxLength = 200): string {
  return sanitizeRichText(value, maxLength)
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
}

/**
 * Renders the plain-text body format the admin editor writes: a blank line
 * starts a new paragraph, `**text**` is bold, and `\*` is a literal asterisk.
 *
 * The text is HTML-escaped FIRST, so the only tags that can ever appear in the
 * result are the `<p>`, `<br>` and `<strong>` added here. Storage stays plain
 * text, which is what the MCP tools and the widget read.
 */
export function renderBodyText(value: string | null | undefined): string {
  return String(value ?? '')
    .split(/\n{2,}/)
    .map((block) => renderInlineMarks(escapeHtml(block).replace(/\n/g, '<br>')))
    .filter((block) => block.trim() !== '')
    .map((block) => `<p>${block}</p>`)
    .join('');
}

function renderInlineMarks(escaped: string): string {
  let out = '';
  let bold = false;
  let index = 0;
  while (index < escaped.length) {
    if (escaped[index] === '\\' && escaped[index + 1] === '*') {
      out += '*';
      index += 2;
      continue;
    }
    if (escaped[index] === '*' && escaped[index + 1] === '*') {
      out += bold ? '</strong>' : '<strong>';
      bold = !bold;
      index += 2;
      continue;
    }
    out += escaped[index];
    index += 1;
  }
  return bold ? `${out}</strong>` : out;
}

/** Lowercase, diacritics folded - used for city matching. */
export function normalizeForSearch(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .toLowerCase()
    .trim();
}

/**
 * Only absolute https URLs survive. Everything else - javascript:, data:,
 * protocol-relative - is dropped. Same-origin absolute paths ("/media/...")
 * pass through unchanged.
 */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw.slice(0, 500);
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

export function isEmail(value: string): boolean {
  const v = String(value ?? '').trim();
  return v.length <= 254 && /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(v);
}

/** Loose but strict-enough phone check: digits, spaces, parentheses, leading +. */
export function isPhone(value: string): boolean {
  return /^\+?[0-9 ()-]{7,20}$/.test(String(value ?? '').trim());
}
