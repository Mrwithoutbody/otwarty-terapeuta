-- Grafiki profilu jako relacja: terapeutka może mieć wiele obrazów, a portret
-- (therapists.photo_url) jest jednym z nich. Każdy wgrany plik dostaje wiersz,
-- więc żaden klucz R2 nie ginie z ewidencji — reseed czy podmiana portretu nie
-- odbiera dostępu do wcześniej dodanych grafik.
CREATE TABLE therapist_media (
  id TEXT PRIMARY KEY,
  therapist_id TEXT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_therapist_media_owner ON therapist_media(therapist_id, position, created_at);

-- Istniejące portrety wchodzą do relacji, żeby ewidencja była kompletna od dnia
-- pierwszego.
INSERT INTO therapist_media (id, therapist_id, url, alt, position, created_at)
  SELECT 'med_' || lower(hex(randomblob(12))), id, photo_url, '', 0, updated_at
  FROM therapists
  WHERE photo_url LIKE '/media/%';
