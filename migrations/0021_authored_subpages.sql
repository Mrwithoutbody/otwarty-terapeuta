-- Podstrony autorskie (2026-09-22): grupa, warsztat, jedna specjalizacja, pisane tak
-- samo jak profil (`TYPES.podstrona` w `src/authored/core.ts`). Adres podstrony to
-- `/terapeuci/<jej adres>/<slug>`; opublikowana ma pierwszeństwo przed dawną usługą stron.
-- Profil nie ma własnego adresu, więc `slug` zostaje dla niego NULL.
ALTER TABLE authored_pages ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX idx_authored_slug ON authored_pages (therapist_id, slug) WHERE slug IS NOT NULL;
