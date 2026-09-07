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

/** Odsłony per profil za ostatnie `days` dni — jedno zapytanie dla całej listy w panelu. */
export async function viewsByTherapist(
  env: Env,
  days = 30,
): Promise<Map<string, { web: number; mcp: number }>> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    `SELECT therapist_id, source, SUM(views) AS views FROM profile_views
      WHERE day >= ? GROUP BY therapist_id, source`,
  )
    .bind(since)
    .all<{ therapist_id: string; source: ViewSource; views: number }>();

  const byTherapist = new Map<string, { web: number; mcp: number }>();
  for (const row of results) {
    const entry = byTherapist.get(row.therapist_id) ?? { web: 0, mcp: 0 };
    entry[row.source] += row.views;
    byTherapist.set(row.therapist_id, entry);
  }
  return byTherapist;
}
