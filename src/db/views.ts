import type { Env } from '../env';

/**
 * Licznik odsłon profilu — jedyna statystyka, jaką serwis prowadzi.
 *
 * Agregat, nie zdarzenia: jeden wiersz na (profil, dzień, źródło), licznik
 * rośnie w miejscu. Nie zapisujemy adresu IP, nagłówka przeglądarki ani
 * ciasteczka, więc z tej tabeli nie da się odtworzyć, kto oglądał — tylko ile
 * razy oglądano. To odpowiedź na pytanie terapeutki „ile osób widziało mój
 * profil", nie na pytanie „kto".
 *
 * ponytail: zapis idzie prosto do D1, jeden UPSERT na odsłonę. Przy katalogu
 * rzędu kilkuset profili to nic; gdyby ruch urósł do tysięcy odsłon na minutę,
 * właściwym miejscem jest Analytics Engine (`writeDataPoint`) i odpytywanie go
 * po SQL API, a ta tabela zostaje jako agregat dobowy.
 */

export type ViewSource = 'web' | 'mcp';

/**
 * Nie blokuje odpowiedzi i nie może jej wywrócić: licznik odsłon jest mniej
 * ważny niż strona, którą ktoś właśnie otwiera.
 */
export async function recordProfileView(
  env: Env,
  therapistId: string,
  source: ViewSource,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    await env.DB.prepare(
      `INSERT INTO profile_views (therapist_id, day, source, views)
       VALUES (?, ?, ?, 1)
       ON CONFLICT (therapist_id, day, source)
       DO UPDATE SET views = views + 1`,
    )
      .bind(therapistId, day, source)
      .run();
  } catch {
    // Profil mógł właśnie zostać usunięty (klucz obcy) albo baza odrzuciła
    // zapis. Odsłona przepada, strona nie.
  }
}

export interface ViewStats {
  last30: number;
  last7: number;
  web: number;
  mcp: number;
}

/** Podsumowanie dla panelu: ostatnie 30 dni, z podziałem na źródło. */
export async function profileViewStats(env: Env, therapistId: string): Promise<ViewStats> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  const { results } = await env.DB.prepare(
    `SELECT day, source, views FROM profile_views
      WHERE therapist_id = ? AND day >= ?`,
  )
    .bind(therapistId, since)
    .all<{ day: string; source: ViewSource; views: number }>();

  const stats: ViewStats = { last30: 0, last7: 0, web: 0, mcp: 0 };
  for (const row of results) {
    stats.last30 += row.views;
    if (row.day >= since7) stats.last7 += row.views;
    stats[row.source] += row.views;
  }
  return stats;
}
