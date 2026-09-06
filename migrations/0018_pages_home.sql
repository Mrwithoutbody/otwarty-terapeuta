-- Strony terapeutki wracają do tej bazy (2026-09-06). Usługa stron (x402L) dystrybuuje
-- motywy i skład jak repozytorium motywów, ale stron nie trzyma: JSON po edycji
-- (motyw, kolejność bloków, układ, poprawione pola) jest własnością hosta i idzie
-- do usługi w każdym żądaniu renderu. Treść bloków liczy się zawsze świeżo z bazy.
CREATE TABLE therapist_pages (
  id TEXT PRIMARY KEY,
  therapist_id TEXT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  theme TEXT NOT NULL DEFAULT '',
  variant TEXT NOT NULL DEFAULT '',
  page_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (therapist_id, slug)
);
