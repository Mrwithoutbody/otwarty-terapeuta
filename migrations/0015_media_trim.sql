-- Relacja mediów bez kolumn, których nic nie pisze ani nie czyta: `alt`
-- i `position` wrócą razem z publiczną galerią, która ich faktycznie użyje.
-- Indeks najpierw, bo trzyma kolumnę position.
DROP INDEX idx_therapist_media_owner;
ALTER TABLE therapist_media DROP COLUMN alt;
ALTER TABLE therapist_media DROP COLUMN position;
CREATE INDEX idx_therapist_media_owner ON therapist_media(therapist_id, created_at);
