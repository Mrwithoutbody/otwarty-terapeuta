import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { topUpDemoSlots } from '../src/db/demo';

const DEMO = 'th_4f1a9c72e5b83d016a7c2e40';

async function openSlots(): Promise<{ n: number; last: string | null }> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n, MAX(starts_at_utc) AS last FROM appointment_slots
      WHERE therapist_id = ? AND status = 'open'`,
  )
    .bind(DEMO)
    .first<{ n: number; last: string | null }>();
  return { n: row?.n ?? 0, last: row?.last ?? null };
}

describe('demo profiles do not run out of slots', () => {
  it('tops up a calendar that has expired, then leaves it alone', async () => {
    await env.DB.prepare(`DELETE FROM appointment_slots WHERE therapist_id = ?`).bind(DEMO).run();
    expect((await openSlots()).n).toBe(0);

    const first = await topUpDemoSlots(env);
    expect(first.added).toBeGreaterThan(0);
    const after = await openSlots();
    // A fortnight of cover at minimum - that is the whole point of the job.
    expect(Date.parse(after.last!)).toBeGreaterThan(Date.now() + 14 * 86_400_000);

    // Second run has nothing to do: the calendar already reaches past the horizon.
    expect((await topUpDemoSlots(env)).added).toBe(0);
    expect((await openSlots()).n).toBe(after.n);
  });

  it('leaves profiles that are not demonstrations alone', async () => {
    await env.DB.prepare(`UPDATE therapists SET is_demo = 0 WHERE id = ?`).bind(DEMO).run();
    await env.DB.prepare(`DELETE FROM appointment_slots WHERE therapist_id = ?`).bind(DEMO).run();

    expect((await topUpDemoSlots(env)).added).toBe(0);
    await env.DB.prepare(`UPDATE therapists SET is_demo = 1 WHERE id = ?`).bind(DEMO).run();
  });
});
