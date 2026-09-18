-- Grafik tygodniowy i urlop (2026-09-18). Dotąd terminy powstawały raz, na N dni
-- (najwyżej 60), i po tym czasie kalendarz realnej terapeutki pustoszał - cron
-- dopełniał tylko profile demonstracyjne. Teraz grafik oferty zostaje w bazie,
-- a cron dokłada z niego terminy na osiem tygodni do przodu.

-- JSON siedmiu list godzin rozpoczęcia, indeks = dzień tygodnia (0 = niedziela),
-- godziny lokalne w strefie terapeutki. Pusty napis = oferta bez grafiku.
ALTER TABLE session_offers ADD COLUMN schedule TEXT NOT NULL DEFAULT '';

-- Wolne od-do, daty lokalne włącznie. Generator pomija te dni.
CREATE TABLE therapist_time_off (
  id           TEXT PRIMARY KEY,
  therapist_id TEXT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  starts_on    TEXT NOT NULL,   -- "YYYY-MM-DD"
  ends_on      TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_time_off_therapist ON therapist_time_off (therapist_id, ends_on);

-- Grafik z terminów, które już są: to, co terapeutka wygenerowała w ostatnich
-- czterech tygodniach i na przód, staje się jej grafikiem, więc kalendarz nie
-- urywa się po dniu, na który go wygenerowała. SQLite nie zna stref czasowych,
-- dlatego tylko Europe/Warsaw i tylko terminy przed zmianą czasu 2026-10-25:
-- w tym oknie Warszawa to stale UTC+2. Godziny 7-21, jak w panelu.
UPDATE session_offers SET schedule = (
  SELECT json_group_array(json(hours)) FROM (
    SELECT wd.value AS n,
           COALESCE((
             SELECT json_group_array(h) FROM (
               SELECT DISTINCT CAST(strftime('%H', s.starts_at_utc, '+2 hours') AS INTEGER) AS h
                 FROM appointment_slots s
                WHERE s.offer_id = session_offers.id
                  AND s.timezone = 'Europe/Warsaw'
                  AND s.starts_at_utc >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-28 days')
                  AND s.starts_at_utc < '2026-10-25T01:00:00Z'
                  AND CAST(strftime('%w', s.starts_at_utc, '+2 hours') AS INTEGER) = wd.value
                ORDER BY h
             ) WHERE h BETWEEN 7 AND 21
           ), '[]') AS hours
      FROM json_each('[0,1,2,3,4,5,6]') wd
     ORDER BY wd.value
  )
)
WHERE active = 1
  AND EXISTS (
    SELECT 1 FROM appointment_slots s
     WHERE s.offer_id = session_offers.id
       AND s.timezone = 'Europe/Warsaw'
       AND s.starts_at_utc >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-28 days')
       AND s.starts_at_utc < '2026-10-25T01:00:00Z'
       AND CAST(strftime('%H', s.starts_at_utc, '+2 hours') AS INTEGER) BETWEEN 7 AND 21
  );

-- Ta sama godzina w dwóch ofertach jednej osoby (generator puszczany kilka razy
-- dla różnych ofert) zostaje w ofercie o mniejszym id - w jednym czasie jest
-- jeden termin, a panel inaczej odmówiłby zapisu grafiku.
UPDATE session_offers SET schedule = (
  SELECT json_group_array(json(hours)) FROM (
    SELECT wd.key AS n, (
      SELECT json_group_array(h.value) FROM json_each(wd.value) h
       WHERE NOT EXISTS (
         SELECT 1 FROM session_offers o2, json_each(o2.schedule, '$[' || wd.key || ']') h2
          WHERE o2.therapist_id = session_offers.therapist_id AND o2.id < session_offers.id
            AND o2.active = 1 AND o2.schedule != '' AND h2.value = h.value
       )
    ) AS hours
      FROM json_each(session_offers.schedule) wd
     ORDER BY wd.key
  )
)
WHERE schedule != '';

-- Profile demonstracyjne: czysty grafik pierwszej oferty, jak w seedzie, zamiast
-- sumy godzin, które nazbierały się z seeda i dawnego crona.
UPDATE session_offers SET schedule = ''
 WHERE therapist_id IN (SELECT id FROM therapists WHERE is_demo = 1);
UPDATE session_offers SET schedule = '[[],[9,11,13,15,17],[9,11,13,15,17],[9,11,13,15,17],[9,11,13,15,17],[9,11,13,15,17],[]]'
 WHERE id IN (SELECT MIN(o.id) FROM session_offers o JOIN therapists t ON t.id = o.therapist_id
               WHERE t.is_demo = 1 AND o.active = 1 GROUP BY o.therapist_id);

UPDATE session_offers SET schedule = '' WHERE schedule = '[[],[],[],[],[],[],[]]';
