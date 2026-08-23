-- Consolidation pass. Nothing here changes behaviour; it removes schema that no
-- code path reads or writes.

-- 1. Therapist self-signup stored its pending profile in a table that duplicated
--    login_challenges column for column. login_challenges already has `purpose`
--    and a JSON `context` built for exactly this, so the signup flow now uses it.
--    SQLite cannot alter a CHECK constraint, so the table is rebuilt. Rows are
--    one-time codes with a 15-minute lifetime; in-flight ones are copied over.
CREATE TABLE login_challenges_new (
  id          TEXT PRIMARY KEY,
  email_hash  TEXT NOT NULL,
  email_enc   TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('oauth','admin','therapist_signup')),
  context     TEXT NOT NULL DEFAULT '{}',        -- JSON: pending OAuth request, pending profile
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL
);
INSERT INTO login_challenges_new
  (id, email_hash, email_enc, code_hash, purpose, context, attempts, expires_at, consumed_at, created_at)
  SELECT id, email_hash, email_enc, code_hash, purpose, context, attempts, expires_at, consumed_at, created_at
    FROM login_challenges;
DROP TABLE login_challenges;
ALTER TABLE login_challenges_new RENAME TO login_challenges;
CREATE INDEX idx_login_email ON login_challenges (email_hash, created_at);
CREATE INDEX idx_login_expiry ON login_challenges (expires_at);

DROP TABLE therapist_signup_challenges;

-- 2. Recurrence rules for generating slots. No code has ever read or written
--    this table; slots are created directly. Reintroduce it with the generator
--    that needs it, not before.
DROP TABLE availability_rules;

-- 3. Columns nothing reads. `csrf_hash` in particular was always written as ''
--    - the CSRF token is derived from the session secret by HMAC, never stored.
ALTER TABLE admin_sessions DROP COLUMN csrf_hash;
ALTER TABLE oauth_tokens DROP COLUMN parent_hash;
ALTER TABLE therapist_locations DROP COLUMN postal_code;
