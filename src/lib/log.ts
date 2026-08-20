/**
 * Logging in a mental-health product is a data-protection surface, not a
 * convenience. This logger accepts only a fixed set of low-cardinality fields
 * and redacts anything that looks like a token, an e-mail address or a phone
 * number before it reaches the log sink.
 */

const REDACTIONS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\+?\d[\d ()-]{7,}\d/g, '[phone]'],
  [/\b(Bearer|bearer)\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [redacted]'],
  [/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted-token]'],
];

export function redact(value: string): string {
  let out = String(value ?? '');
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out.slice(0, 500);
}

/** Only these keys may be logged. Anything else is dropped, not redacted. */
const ALLOWED_FIELDS = new Set([
  'event',
  'route',
  'method',
  'status',
  'tool',
  'scope',
  'reason',
  'code',
  'therapist_id',
  'slot_id',
  'booking_id',
  'client_id',
  'duration_ms',
  'count',
  'environment',
]);

export type LogFields = Record<string, string | number | boolean | undefined>;

function project(fields: LogFields): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!ALLOWED_FIELDS.has(key)) continue;
    out[key] = typeof value === 'string' ? redact(value) : value;
  }
  return out;
}

export const log = {
  info(event: string, fields: LogFields = {}): void {
    console.warn(JSON.stringify({ level: 'info', ...project({ ...fields, event }) }));
  },
  warn(event: string, fields: LogFields = {}): void {
    console.warn(JSON.stringify({ level: 'warn', ...project({ ...fields, event }) }));
  },
  /**
   * Errors log the message only after redaction, and never the stack of a
   * user-facing validation failure - stacks routinely embed input values.
   */
  error(event: string, error: unknown, fields: LogFields = {}): void {
    const message = error instanceof Error ? redact(error.message) : 'unknown';
    console.error(JSON.stringify({ level: 'error', message, ...project({ ...fields, event }) }));
  },
};
