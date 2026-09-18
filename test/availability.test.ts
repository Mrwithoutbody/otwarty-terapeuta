import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAdminSession, loadAdminSession } from '../src/auth/session';
import { cancelBooking, createBooking, previewBooking } from '../src/booking/service';
import { dayKey, fillFromSchedules, HORIZON_DAYS, localSlot, parseWeek } from '../src/db/slots';
import { findOrCreateUserByEmail } from '../src/db/users';
import { addCivilDays, civilDateIn, weekdayIn } from '../src/lib/time';

const ANNA = 'th_4f1a9c72e5b83d016a7c2e40';
const MAREK = 'th_8b2d6e10f4a97c53d1e08b26';
const WAW = 'Europe/Warsaw';

interface Actor {
  cookie: string;
  csrf: string;
}

async function actor(email: string): Promise<Actor> {
  const user = await findOrCreateUserByEmail(env, email);
  await env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).bind(user.id).run();
  const { cookie } = await createAdminSession(env, user.id);
  const session = await loadAdminSession(env, new Request('https://localhost/admin', { headers: { cookie } }));
  return { cookie, csrf: session!.csrfToken };
}

function post(who: Actor, path: string, pairs: Array<[string, string]>): Promise<Response> {
  const body = new URLSearchParams([['csrf', who.csrf], ...pairs]);
  return SELF.fetch(`https://localhost${path}`, {
    method: 'POST',
    headers: { cookie: who.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'manual',
  });
}

interface Slot {
  id: string;
  offer_id: string;
  starts_at_utc: string;
  status: string;
}

async function future(where: string, value: string): Promise<Slot[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, offer_id, starts_at_utc, status FROM appointment_slots
      WHERE ${where} = ? AND starts_at_utc > ? ORDER BY starts_at_utc`,
  )
    .bind(value, new Date().toISOString())
    .all<Slot>();
  return results;
}

const cell = (s: Slot, tz = WAW): string => {
  const l = localSlot(s.starts_at_utc, tz);
  return `${l.weekday}-${l.hour}`;
};

async function schedule(offerId: string): Promise<number[][]> {
  const row = await env.DB.prepare(`SELECT schedule FROM session_offers WHERE id = ?`).bind(offerId).first<{ schedule: string }>();
  return parseWeek(row?.schedule);
}

/** Grafik z seeda: pierwsza oferta pn-pt 9-17 co dwie godziny, druga bez grafiku. Testy w pliku dzielą bazę. */
const SEED_WEEK = '[[],[9,11,13,15,17],[9,11,13,15,17],[9,11,13,15,17],[9,11,13,15,17],[9,11,13,15,17],[]]';
async function seedSchedule(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`UPDATE session_offers SET schedule = ? WHERE id = 'of_01'`).bind(SEED_WEEK),
    env.DB.prepare(`UPDATE session_offers SET schedule = '' WHERE id = 'of_02'`),
  ]);
  await fillFromSchedules(env, ANNA);
}

let admin: Actor;
beforeAll(async () => {
  admin = await actor('grafik-admin@example.invalid');
});

describe('grafik tygodniowy', () => {
  it('kratka to terminy w ten dzień o tej LOKALNEJ godzinie, na osiem tygodni; śmieci z formularza odpadają', async () => {
    const res = await post(admin, `/admin/terapeuci/${ANNA}/grafik`, [
      ['offer', 'of_01'],
      ['g_of_01', '1-7'],
      ['g_of_01', '3-20'],
      ['g_of_01', '9-9'],
      ['g_of_01', '1-99'],
      ['timezone', WAW],
    ]);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('#panel-terminy');
    expect(await schedule('of_01')).toEqual([[], [7], [], [20], [], [], []]);

    const open = (await future('offer_id', 'of_01')).filter((s) => s.status === 'open');
    // Terminy spoza grafiku (seed) zniknęły, zostały tylko pn 7:00 i śr 20:00.
    expect(new Set(open.map((s) => cell(s)))).toEqual(new Set(['1-7', '3-20']));
    expect(open.length).toBe(16);
    expect(Date.parse(open.at(-1)!.starts_at_utc)).toBeGreaterThan(Date.now() + (HORIZON_DAYS - 8) * 86_400_000);
  });

  it('strefa spoza Polski: wtorek 9:00 w Kalkucie to 03:30 UTC, a strefa zostaje zapisana', async () => {
    const res = await post(admin, `/admin/terapeuci/${MAREK}/grafik`, [
      ['offer', 'of_03'],
      ['g_of_03', '2-9'],
      ['timezone', 'Asia/Kolkata'],
    ]);
    expect(res.status).toBe(302);
    const slots = (await future('offer_id', 'of_03')).filter((s) => s.status === 'open');
    expect(slots.length).toBe(8);
    for (const s of slots) {
      expect(cell(s, 'Asia/Kolkata')).toBe('2-9');
      expect(s.starts_at_utc.slice(11, 16)).toBe('03:30');
    }
    const t = await env.DB.prepare(`SELECT timezone FROM therapists WHERE id = ?`).bind(MAREK).first<{ timezone: string }>();
    expect(t?.timezone).toBe('Asia/Kolkata');
  });

  it('nieznana strefa odpada, zamiast cicho zostać Warszawą', async () => {
    const before = await schedule('of_01');
    const res = await post(admin, `/admin/terapeuci/${ANNA}/grafik`, [
      ['offer', 'of_01'],
      ['g_of_01', '1-8'],
      ['timezone', 'Mars/Olympus'],
    ]);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Nieznana strefa czasowa');
    expect(await schedule('of_01')).toEqual(before);
  });

  it('ta sama godzina w dwóch ofertach to błąd, nie cicha loteria', async () => {
    const res = await post(admin, `/admin/terapeuci/${ANNA}/grafik`, [
      ['offer', 'of_01'],
      ['offer', 'of_02'],
      ['g_of_01', '2-10'],
      ['g_of_02', '2-10'],
      ['timezone', WAW],
    ]);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Wtorek, 10:00');
  });

  it('zarezerwowany termin zostaje, a wolny z odwołaną rezerwacją jest blokowany zamiast usunięty', async () => {
    const user = await findOrCreateUserByEmail(env, 'grafik-klient@example.invalid');
    const acceptance = { accepted_terms_version: env.TERMS_VERSION, accepted_privacy_version: env.PRIVACY_VERSION, confirm: true };
    const [kept, released] = (await future('offer_id', 'of_01')).filter((s) => s.status === 'open');
    const book = async (slotId: string, key: string) => {
      const preview = await previewBooking(env, user, { slot_id: slotId });
      return createBooking(env, user, { confirmation_token: preview.confirmation_token, idempotency_key: key, ...acceptance });
    };
    await book(kept!.id, 'grafik-kept');
    const second = await book(released!.id, 'grafik-released');
    await cancelBooking(env, user, { booking_id: second.booking_id, confirm: true });

    // Pusty grafik: wszystkie wolne terminy oferty schodzą.
    const res = await post(admin, `/admin/terapeuci/${ANNA}/grafik`, [['offer', 'of_01'], ['timezone', WAW]]);
    expect(res.status).toBe(302);
    const left = await future('offer_id', 'of_01');
    expect(left.find((s) => s.id === kept!.id)?.status).toBe('booked');
    expect(left.find((s) => s.id === released!.id)?.status).toBe('blocked');
    expect(left.filter((s) => s.status === 'open')).toEqual([]);
    expect(await schedule('of_01')).toEqual([[], [], [], [], [], [], []]);
  });

  it('cron dokłada terminy z grafiku, a przy pełnym kalendarzu nic nie robi', async () => {
    await seedSchedule();
    // Terminy z rezerwacjami (także odwołanymi) trzyma klucz obcy; reszta znika.
    await env.DB.prepare(`DELETE FROM appointment_slots WHERE therapist_id = ? AND id NOT IN (SELECT slot_id FROM bookings)`)
      .bind(ANNA)
      .run();
    expect(await fillFromSchedules(env)).toBeGreaterThan(0);

    const first = (await future('therapist_id', ANNA)).filter((s) => s.status === 'open');
    expect(new Set(first.map((s) => s.offer_id))).toEqual(new Set(['of_01']));
    expect(new Set(first.map((s) => cell(s).split('-')[1]))).toEqual(new Set(['9', '11', '13', '15', '17']));
    expect(Date.parse(first.at(-1)!.starts_at_utc)).toBeGreaterThan(Date.now() + (HORIZON_DAYS - 8) * 86_400_000);

    expect(await fillFromSchedules(env)).toBe(0);
    expect((await future('therapist_id', ANNA)).filter((s) => s.status === 'open').length).toBe(first.length);
  });
});

describe('urlop', () => {
  it('zdejmuje wolne terminy z zakresu, grafik ich nie odtwarza, a usunięcie wpisu je przywraca', async () => {
    await seedSchedule();
    const today = civilDateIn(WAW, new Date());
    const from = dayKey(addCivilDays(today, 8));
    const to = dayKey(addCivilDays(today, 14));
    const inRange = async () =>
      (await future('therapist_id', ANNA)).filter((s) => {
        const day = dayKey(civilDateIn(WAW, new Date(s.starts_at_utc)));
        return s.status === 'open' && from <= day && day <= to;
      }).length;
    expect(await inRange()).toBeGreaterThan(0);

    expect((await post(admin, `/admin/terapeuci/${ANNA}/urlop`, [['od', from], ['do', to]])).status).toBe(302);
    expect(await inRange()).toBe(0);
    await fillFromSchedules(env, ANNA);
    expect(await inRange()).toBe(0);

    const off = await env.DB.prepare(`SELECT id FROM therapist_time_off WHERE therapist_id = ?`).bind(ANNA).first<{ id: string }>();
    expect((await post(admin, `/admin/terapeuci/${ANNA}/urlop/${off!.id}/usun`, [])).status).toBe(302);
    expect(await inRange()).toBeGreaterThan(0);
  });

  it('„do” przed „od” odpada', async () => {
    const res = await post(admin, `/admin/terapeuci/${ANNA}/urlop`, [['od', '2030-05-10'], ['do', '2030-05-01']]);
    expect(res.status).toBe(400);
  });
});

describe('kalendarz tygodnia w panelu', () => {
  it('klik blokuje wolny termin i przywraca zablokowany; rezerwacji nie rusza', async () => {
    await seedSchedule();
    const [open, other] = (await future('therapist_id', ANNA)).filter((s) => s.status === 'open');
    const toggle = (id: string, stan: string) =>
      post(admin, `/admin/terapeuci/${ANNA}/terminy/${id}`, [['stan', stan], ['tydzien', '2030-01-07']]);
    const status = async (id: string) =>
      (await env.DB.prepare(`SELECT status FROM appointment_slots WHERE id = ?`).bind(id).first<{ status: string }>())?.status;

    const res = await toggle(open!.id, 'blocked');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/terapeuci/${ANNA}?tydzien=2030-01-07#panel-terminy`);
    expect(await status(open!.id)).toBe('blocked');
    await toggle(open!.id, 'open');
    expect(await status(open!.id)).toBe('open');

    await env.DB.prepare(`UPDATE appointment_slots SET status = 'booked' WHERE id = ?`).bind(other!.id).run();
    await toggle(other!.id, 'blocked');
    expect(await status(other!.id)).toBe('booked');
  });

  it('panel pokazuje tydzień z terminami i grafik z zaznaczonymi kratkami', async () => {
    await seedSchedule();
    const today = civilDateIn(WAW, new Date());
    const nextMonday = dayKey(addCivilDays(today, 7 - ((weekdayIn(WAW, today) + 6) % 7)));
    const html = await (
      await SELF.fetch(`https://localhost/admin/terapeuci/${ANNA}?tydzien=${nextMonday}`, { headers: { cookie: admin.cookie } })
    ).text();
    expect(html).toContain('class="slot is-open"');
    // Jeden grafik na osobę, nie jeden na ofertę: kratka ma pole każdej oferty, pędzel wybiera.
    expect(html.match(/data-schedule-grid/g)).toHaveLength(1);
    expect(html).toContain('data-brush');
    expect(html).toContain('id="g-of_01-1-9" name="g_of_01" value="1-9" data-o="0" checked');
    expect(html).toContain('id="g-of_02-1-9" name="g_of_02" value="1-9" data-o="1">');
    expect(html).not.toContain('value="1-10" data-o="0" checked');
    expect(html).toContain('Ten tydzień');
    expect(html).toContain('Pn–Pt 9, 11, 13, 15, 17');
    expect(html).not.toContain('slot_id');
  });
});
