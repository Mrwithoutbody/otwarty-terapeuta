-- "Pierwsze spotkanie": the block that answers what a person actually wants to
-- know before writing to a stranger about their mental health.
--
-- Three guided questions rather than one free-text box. A blank box gets a
-- biography; a question gets an answer, and the therapist is the one who knows
-- it. Any of the three may stay empty - the block renders what exists.
ALTER TABLE therapists ADD COLUMN first_meeting_course   TEXT NOT NULL DEFAULT '';
ALTER TABLE therapists ADD COLUMN first_meeting_prep     TEXT NOT NULL DEFAULT '';
ALTER TABLE therapists ADD COLUMN first_meeting_decision TEXT NOT NULL DEFAULT '';
