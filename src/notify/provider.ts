import type { Env } from '../env';
import { log } from '../lib/log';

export interface NotificationMessage {
  to: string;
  subject: string;
  /** Plain text only. No tracking pixels, no remote images, no marketing. */
  text: string;
}

export type SendNotification = (message: NotificationMessage) => Promise<void>;

/**
 * Local/dev sender. Prints the message instead of sending it and says so, so
 * nobody mistakes a development run for a delivered e-mail.
 */
const sendToConsole: SendNotification = async (message) => {
  console.warn(
    `[console] WIADOMOSC NIE ZOSTALA WYSLANA (tryb lokalny)\n` +
      `  do: ${message.to}\n  temat: ${message.subject}\n---\n${message.text}\n---`,
  );
};

/** The body may echo the recipient address, so it is never logged raw. */
async function postEmail(url: string, headers: HeadersInit, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Dostawca e-mail odrzucił wiadomość (HTTP ${res.status}).`);
}

export const sendViaResend =
  (apiKey: string, from: string): SendNotification =>
  (message) =>
    postEmail(
      'https://api.resend.com/emails',
      { authorization: `Bearer ${apiKey}` },
      { from, to: [message.to], subject: message.subject, text: message.text },
    );

export const sendViaBrevo =
  (apiKey: string, from: string): SendNotification =>
  (message) =>
    postEmail(
      'https://api.brevo.com/v3/smtp/email',
      { accept: 'application/json', 'api-key': apiKey },
      {
        sender: { email: from, name: 'Otwarty Terapeuta' },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
      },
    );

/**
 * Resolves the configured sender. Production never silently falls back to the
 * console sender - `assertConfig` refuses to boot instead. Resolved once per
 * drain so a misconfiguration fails fast rather than burning a retry on every
 * queued row.
 */
export function createNotificationSender(env: Env): SendNotification {
  const provider = env.EMAIL_PROVIDER ?? 'console';
  if (provider === 'resend' || provider === 'brevo') {
    const { EMAIL_API_KEY: apiKey, EMAIL_FROM: from } = env;
    if (!apiKey || !from) {
      throw new Error(`EMAIL_PROVIDER=${provider} wymaga sekretów EMAIL_API_KEY i EMAIL_FROM.`);
    }
    return provider === 'brevo' ? sendViaBrevo(apiKey, from) : sendViaResend(apiKey, from);
  }
  if (env.ENVIRONMENT === 'production') {
    throw new Error(`Nieobsługiwany EMAIL_PROVIDER "${provider}" w środowisku produkcyjnym.`);
  }
  log.warn('notify.console_provider', { environment: env.ENVIRONMENT });
  return sendToConsole;
}
