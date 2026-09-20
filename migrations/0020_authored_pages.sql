-- Strony autorskie (2026-09-21). Terapeutka odpowiada własnymi słowami na pytania
-- pacjentów, a strona składa się z odpowiedzi (`src/authored/core.ts`). Zastępuje
-- edytor blokowy usługi stron: tamten składał te same klocki u każdego i nikt
-- z realnych osób nie chciał go używać.
--
-- Szkic i wersja opublikowana leżą obok siebie: pacjent widzi `published_json`,
-- dopóki ona nie kliknie „Opublikuj”. Fakty (cennik, terminy, kwalifikacje) nie są
-- częścią strony - renderer bierze je z tabel przy każdym żądaniu.
CREATE TABLE authored_pages (
  id             TEXT PRIMARY KEY,
  therapist_id   TEXT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  type           TEXT NOT NULL DEFAULT 'profil',
  draft_json     TEXT NOT NULL,
  published_json TEXT,              -- NULL = jeszcze nieopublikowana; stronę dalej niesie usługa stron
  published_at   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
-- Jedna strona „o mnie” na osobę; kolejne rodzaje (wydarzenie, gabinet) będą mogły się powtarzać.
CREATE UNIQUE INDEX idx_authored_profile ON authored_pages (therapist_id) WHERE type = 'profil';
