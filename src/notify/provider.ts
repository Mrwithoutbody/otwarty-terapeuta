import type { Env } from '../env';
import { log } from '../lib/log';

export interface NotificationMessage {
  to: string;
  subject: string;
  /** Plain text only. No tracking pixels, no remote images, no marketing. */
  text: string;
}

export interface NotificationProvider {
  readonly name: string;
  send(message: NotificationMessage): Promise<void>;
}

/**
 * Local/dev provider. Prints the message instead of sending it and says so, so
 * nobody mistakes a development run for a delivered e-mail.
 */
export class ConsoleNotificationProvider implements NotificationProvider {
  readonly name = 'console';

  async send(message: NotificationMessage): Promise<void> {
    console.warn(
      `[ConsoleNotificationProvider] WIADOMOSC NIE ZOSTALA WYSLANA (tryb lokalny)\n` +
        `  do: ${message.to}\n  temat: ${message.subject}\n---\n${message.text}\n---`,
    );
  }
}

/** Production adapter. Any transactional provider fits behind this interface. */
export class ResendNotificationProvider implements NotificationProvider {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: NotificationMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!res.ok) {
      // The body may echo the recipient address, so it is never logged raw.
      throw new Error(`Dostawca e-mail odrzucił wiadomość (HTTP ${res.status}).`);
    }
  }
}

/** Transactional e-mail adapter for Brevo's HTTP API. */
export class BrevoNotificationProvider implements NotificationProvider {
  readonly name = 'brevo';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: NotificationMessage): Promise<void> {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': this.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: this.from, name: 'Otwarty Terapeuta' },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
      }),
    });
    if (!res.ok) {
      // The response may contain recipient data, so it is never logged raw.
      throw new Error(`Dostawca e-mail odrzucił wiadomość (HTTP ${res.status}).`);
    }
  }
}

/**
 * Resolves the configured provider. Production never silently falls back to
 * the console provider - `assertConfig` refuses to boot instead.
 */
export function createNotificationProvider(env: Env): NotificationProvider {
  const provider = env.EMAIL_PROVIDER ?? 'console';
  if (provider === 'resend') {
    if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) {
      throw new Error('EMAIL_PROVIDER=resend wymaga sekretów EMAIL_API_KEY i EMAIL_FROM.');
    }
    return new ResendNotificationProvider(env.EMAIL_API_KEY, env.EMAIL_FROM);
  }
  if (provider === 'brevo') {
    if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) {
      throw new Error('EMAIL_PROVIDER=brevo wymaga sekretów EMAIL_API_KEY i EMAIL_FROM.');
    }
    return new BrevoNotificationProvider(env.EMAIL_API_KEY, env.EMAIL_FROM);
  }
  if (env.ENVIRONMENT === 'production') {
    throw new Error(`Nieobsługiwany EMAIL_PROVIDER "${provider}" w środowisku produkcyjnym.`);
  }
  log.warn('notify.console_provider', { environment: env.ENVIRONMENT });
  return new ConsoleNotificationProvider();
}
