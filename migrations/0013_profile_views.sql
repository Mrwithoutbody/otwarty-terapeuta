-- Ile osób oglądało profil. Agregat dzienny, nie zdarzenia: jeden wiersz na
-- (profil, dzień, źródło), licznik rośnie w miejscu. Nie ma tu identyfikatora
-- osoby, adresu IP ani ciasteczka - z tej tabeli nie da się odtworzyć, kto
-- patrzył, tylko ile razy patrzono.
--
-- `source` rozdziela stronę od asystenta, bo to dwie różne odpowiedzi na
-- pytanie „skąd ludzie biorą mój profil".
CREATE TABLE profile_views (
  therapist_id TEXT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  day          TEXT NOT NULL,                       -- YYYY-MM-DD (UTC)
  source       TEXT NOT NULL CHECK (source IN ('web','mcp')),
  views        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (therapist_id, day, source)
);

CREATE INDEX idx_profile_views_day ON profile_views(day);
