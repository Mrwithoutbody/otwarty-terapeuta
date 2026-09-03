-- Therapist pages moved to the pages service (x402landings.space) on 2026-09-03;
-- the data was copied there with scripts/pages-migrate.mjs before this ran.
DROP TABLE IF EXISTS therapist_pages;
ALTER TABLE therapists DROP COLUMN sections_json;
ALTER TABLE therapists DROP COLUMN layout_json;
