-- The therapist composes her profile from sections, not from a fixed list of
-- blocks in a chosen order. A section carries a type (which layout), an
-- optional background variant, and - for the free ones - its own text.
--
-- `profile_blocks` stays: an untouched profile has no sections yet and falls
-- back to the spine that column describes, so nothing re-renders until she
-- actually arranges something. Unknown types and unknown fields are dropped at
-- read time, so a hand-edited value can never break a profile.
ALTER TABLE therapists ADD COLUMN sections_json TEXT NOT NULL DEFAULT '[]';
