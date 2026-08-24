-- The therapist composes her own public profile from blocks: which ones appear
-- and in what order. Stored as a JSON array of block ids.
--
-- This is presentation only. Every block renders data that already exists
-- elsewhere in the schema (bio, topics, offers, slots, FAQ, credentials,
-- links), so hiding a block never deletes anything and the MCP tools keep
-- returning the full profile regardless of what the page shows.
--
-- Unknown ids are ignored at render time and a block whose data is empty is
-- skipped, so a stale or hand-edited value can never break a profile.
ALTER TABLE therapists ADD COLUMN profile_blocks TEXT NOT NULL
  DEFAULT '["intro","topics","offers","slots","faq","credentials","links","policy"]';
