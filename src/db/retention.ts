import type { Env } from '../env';

/**
 * Retencja: to, co polityka prywatności obiecuje publicznie, wykonane w kodzie.
 *
 * Obietnica była na stronie od początku („dane kontaktowe rezerwacji usuwamy po
 * 12 miesiącach, zapisy audytowe po 24"), a robił ją wyłącznie człowiek na
 * żądanie. Dokument, który obiecuje kasowanie, i cron, który nic nie kasuje, to
 * najgorszy możliwy układ: użytkownik ufa terminowi, którego nikt nie pilnuje.
 *
 * Progi pochodzą z `RETENTION_POLICY.md` §5. Trzy rzeczy, których ten kod nie
 * załatwia i które zostają na liście blokerów (`DPIA_CHECKLIST.md` §11 poz. 8-9):
 * zatwierdzenie okresów przez prawnika, procedura kopii zapasowych D1 (usunięcie
 * musi objąć kopie) i test na realistycznym wolumenie.
 */

/**
 * Znaczniki czasu zapisujemy jako ISO z `toISOString()`, więc porównanie musi
 * mieć ten sam kształt. `datetime('now','-12 months')` zwraca „YYYY-MM-DD
 * HH:MM:SS" — ze spacją zamiast „T" i bez „Z" — a porównanie tekstowe z takim
 * napisem nie trafia w nic sensownego. Stąd `strftime` z jawnym formatem.
 */
const CUTOFF = `strftime('%Y-%m-%dT%H:%M:%SZ','now',?)`;

export interface PurgeResult {
  outbox: number;
  bookingContacts: number;
  auditEvents: number;
}

export async function purgeExpiredData(env: Env): Promise<PurgeResult> {
  const [outbox, contacts, audit] = await env.DB.batch([
    // Powiadomienia: wysłane po 30 dniach, nieudane po 90 - treść jest
    // zaszyfrowana, ale zaszyfrowany adres to nadal adres.
    env.DB.prepare(
      `DELETE FROM notification_outbox
        WHERE (status = 'sent'   AND updated_at < ${CUTOFF})
           OR (status = 'failed' AND updated_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-90 days'))`,
    ).bind('-30 days'),

    // Dane kontaktowe rezerwacji: 12 miesięcy od terminu wizyty. Sama rezerwacja
    // zostaje - jest potrzebna do rozliczeń - ale bez danych identyfikujących.
    env.DB.prepare(
      `UPDATE bookings
          SET contact_name_enc = NULL, contact_email_enc = NULL, contact_phone_enc = NULL,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE starts_at_utc < ${CUTOFF}
          AND (contact_name_enc IS NOT NULL OR contact_email_enc IS NOT NULL
               OR contact_phone_enc IS NOT NULL)`,
    ).bind('-12 months'),

    env.DB.prepare(`DELETE FROM audit_events WHERE at < ${CUTOFF}`).bind('-24 months'),
  ]);

  return {
    outbox: outbox?.meta.changes ?? 0,
    bookingContacts: contacts?.meta.changes ?? 0,
    auditEvents: audit?.meta.changes ?? 0,
  };
}
