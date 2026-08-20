-- Public therapist onboarding. Profile data waits here only until the e-mail
-- owner enters the one-time code; expired rows are removed by housekeeping.
CREATE TABLE therapist_signup_challenges (
  id           TEXT PRIMARY KEY,
  email_hash   TEXT NOT NULL,
  email_enc    TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_therapist_signup_email
  ON therapist_signup_challenges (email_hash, created_at);
CREATE INDEX idx_therapist_signup_expiry
  ON therapist_signup_challenges (expires_at);
