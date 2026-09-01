-- Podstrony terapeutki: landing pod kampanię, terapia grupowa, warsztat, camp.
-- Osobny byt obok profilu (therapists.sections_json zostaje profilem). Treść to
-- bloki silnika x402-landings (blocks_json) plus osie układu (layout_json);
-- źródłem prawdy jest JSON, HTML renderuje się przy każdym żądaniu z bazy.
CREATE TABLE therapist_pages (
  id TEXT PRIMARY KEY,
  therapist_id TEXT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  blocks_json TEXT NOT NULL DEFAULT '[]',
  layout_json TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (therapist_id, slug)
);
CREATE INDEX idx_therapist_pages_owner ON therapist_pages(therapist_id, status, position, created_at);
