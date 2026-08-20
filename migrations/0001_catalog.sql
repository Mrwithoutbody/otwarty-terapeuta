-- Otwarty Terapeuta - catalog, availability, bookings.
-- All timestamps are ISO-8601 UTC strings ("2026-09-01T08:00:00Z").
-- Wall-clock intent of a session is preserved separately in `timezone` (IANA).
-- All money is stored in the smallest currency unit (grosz for PLN).

CREATE TABLE therapists (
  id                    TEXT PRIMARY KEY,          -- "th_" + 24 random hex chars (unguessable)
  slug                  TEXT NOT NULL UNIQUE,      -- public, human readable
  display_name          TEXT NOT NULL,
  headline              TEXT,
  bio                   TEXT NOT NULL DEFAULT '',
  photo_url             TEXT,
  offers_online         INTEGER NOT NULL DEFAULT 0 CHECK (offers_online IN (0,1)),
  offers_in_person      INTEGER NOT NULL DEFAULT 0 CHECK (offers_in_person IN (0,1)),
  accepting_new_clients INTEGER NOT NULL DEFAULT 1 CHECK (accepting_new_clients IN (0,1)),
  age_groups            TEXT NOT NULL DEFAULT '[]',  -- JSON array: adults|teens|children|seniors
  session_types         TEXT NOT NULL DEFAULT '[]',  -- JSON array: individual|couples|family
  credentials           TEXT NOT NULL DEFAULT '[]',  -- JSON array of {title,issuer,year,verified}
  verification_status   TEXT NOT NULL DEFAULT 'unverified'
                          CHECK (verification_status IN ('unverified','verified','rejected')),
  verified_at           TEXT,
  verification_notes    TEXT,                      -- PRIVATE. Never leaves the admin panel.
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','published','unpublished')),
  is_demo               INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  timezone              TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  contact_email_enc     TEXT,                      -- app-level AES-GCM ciphertext
  cancellation_policy   TEXT NOT NULL DEFAULT '',
  cancellation_cutoff_h INTEGER NOT NULL DEFAULT 24,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT
);
CREATE INDEX idx_therapists_status ON therapists (status, deleted_at);
CREATE INDEX idx_therapists_online ON therapists (offers_online, status);

CREATE TABLE therapist_locations (
  id           TEXT PRIMARY KEY,
  therapist_id TEXT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  city         TEXT NOT NULL,
  city_norm    TEXT NOT NULL,                      -- lowercase, diacritics folded
  region       TEXT,
  country      TEXT NOT NULL DEFAULT 'PL',
  address_line TEXT,                               -- office address (public, not personal data)
  postal_code  TEXT,
  is_primary   INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1))
);
CREATE INDEX idx_locations_city ON therapist_locations (city_norm);
CREATE INDEX idx_locations_therapist ON therapist_locations (therapist_id);

CREATE TABLE languages (
  code    TEXT PRIMARY KEY,                        -- ISO 639-1
  name_pl TEXT NOT NULL
);
CREATE TABLE therapist_languages (
  therapist_id  TEXT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  PRIMARY KEY (therapist_id, language_code)
);
CREATE INDEX idx_tl_lang ON therapist_languages (language_code);

CREATE TABLE specialties (
  slug     TEXT PRIMARY KEY,
  name_pl  TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general'
);
CREATE TABLE therapist_specialties (
  therapist_id    TEXT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  specialty_slug  TEXT NOT NULL REFERENCES specialties(slug),
  PRIMARY KEY (therapist_id, specialty_slug)
);
CREATE INDEX idx_ts_spec ON therapist_specialties (specialty_slug);

CREATE TABLE modalities (
  slug    TEXT PRIMARY KEY,
  name_pl TEXT NOT NULL
);
CREATE TABLE therapist_modalities (
  therapist_id   TEXT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  modality_slug  TEXT NOT NULL REFERENCES modalities(slug),
  PRIMARY KEY (therapist_id, modality_slug)
);
CREATE INDEX idx_tm_mod ON therapist_modalities (modality_slug);

CREATE TABLE session_offers (
  id               TEXT PRIMARY KEY,
  therapist_id     TEXT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  session_type     TEXT NOT NULL CHECK (session_type IN ('individual','couples','family')),
  mode             TEXT NOT NULL CHECK (mode IN ('online','in_person')),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 240),
  price_minor      INTEGER NOT NULL CHECK (price_minor >= 0),
  currency         TEXT NOT NULL DEFAULT 'PLN',
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_offers_therapist ON session_offers (therapist_id, active);
CREATE INDEX idx_offers_price ON session_offers (price_minor);

CREATE TABLE faq_items (
  id           TEXT PRIMARY KEY,
  therapist_id TEXT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  question     TEXT NOT NULL,
  answer       TEXT NOT NULL,                     -- written or explicitly approved by the therapist
  category     TEXT NOT NULL DEFAULT 'general',
  position     INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  approved_by  TEXT,                              -- user id of the approving therapist/admin
  approved_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_faq_therapist ON faq_items (therapist_id, status, position);

CREATE TABLE availability_rules (
  id           TEXT PRIMARY KEY,
  therapist_id TEXT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  offer_id     TEXT NOT NULL REFERENCES session_offers(id) ON DELETE CASCADE,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Monday
  start_time   TEXT NOT NULL,                     -- "HH:MM" local to `timezone`
  end_time     TEXT NOT NULL,
  timezone     TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  valid_from   TEXT NOT NULL,                     -- "YYYY-MM-DD"
  valid_to     TEXT,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_rules_therapist ON availability_rules (therapist_id, active);

CREATE TABLE appointment_slots (
  id            TEXT PRIMARY KEY,                 -- "sl_" + 24 random hex chars
  therapist_id  TEXT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  offer_id      TEXT NOT NULL REFERENCES session_offers(id) ON DELETE CASCADE,
  starts_at_utc TEXT NOT NULL,
  ends_at_utc   TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','booked','blocked')),
  block_reason  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (therapist_id, starts_at_utc)
);
CREATE INDEX idx_slots_lookup ON appointment_slots (therapist_id, status, starts_at_utc);
CREATE INDEX idx_slots_time ON appointment_slots (status, starts_at_utc);

CREATE TABLE users (
  id           TEXT PRIMARY KEY,                  -- "usr_" + 24 random hex chars
  email_hash   TEXT NOT NULL UNIQUE,              -- HMAC(email) - lookup key, not reversible
  email_enc    TEXT NOT NULL,                     -- AES-GCM ciphertext
  name_enc     TEXT,
  role         TEXT NOT NULL DEFAULT 'user'
                 CHECK (role IN ('user','support','therapist','admin')),
  therapist_id TEXT REFERENCES therapists(id),    -- set only for role = 'therapist'
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX idx_users_role ON users (role);

CREATE TABLE bookings (
  id                TEXT PRIMARY KEY,             -- "bk_" + 24 random hex chars
  public_ref        TEXT NOT NULL UNIQUE,         -- short human reference, e.g. "OT-7K3QD2"
  slot_id           TEXT NOT NULL REFERENCES appointment_slots(id),
  therapist_id      TEXT NOT NULL REFERENCES therapists(id),
  user_id           TEXT NOT NULL REFERENCES users(id),
  status            TEXT NOT NULL CHECK (status IN ('confirmed','cancelled')),
  session_type      TEXT NOT NULL,
  mode              TEXT NOT NULL,
  starts_at_utc     TEXT NOT NULL,
  ends_at_utc       TEXT NOT NULL,
  timezone          TEXT NOT NULL,
  price_minor       INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  contact_name_enc  TEXT,
  contact_email_enc TEXT,
  contact_phone_enc TEXT,
  terms_version     TEXT NOT NULL,
  privacy_version   TEXT NOT NULL,
  manage_token_hash TEXT NOT NULL,                -- HMAC of the secret in the manage URL
  cancel_reason     TEXT,
  cancelled_by      TEXT,
  cancelled_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
-- The hard guarantee: a slot can carry at most ONE confirmed booking.
CREATE UNIQUE INDEX idx_bookings_one_active_per_slot
  ON bookings (slot_id) WHERE status = 'confirmed';
CREATE INDEX idx_bookings_user ON bookings (user_id, starts_at_utc);
CREATE INDEX idx_bookings_therapist ON bookings (therapist_id, starts_at_utc);

CREATE TABLE booking_idempotency (
  user_id      TEXT NOT NULL,
  idem_key     TEXT NOT NULL,
  request_hash TEXT NOT NULL,                     -- SHA-256 of the normalised request
  booking_id   TEXT REFERENCES bookings(id),
  created_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, idem_key)
);

CREATE TABLE consent_records (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('terms','privacy')),
  version    TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  source     TEXT NOT NULL                        -- 'mcp:create_booking' | 'web:booking' | ...
);
CREATE INDEX idx_consent_user ON consent_records (user_id, kind);

CREATE TABLE crisis_resources (
  id          TEXT PRIMARY KEY,
  country     TEXT NOT NULL DEFAULT 'PL',
  audience    TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','adult','minor')),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  phone       TEXT,
  url         TEXT,
  hours       TEXT,
  priority    INTEGER NOT NULL DEFAULT 100,       -- lower = shown first
  source_url  TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  version     TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
CREATE INDEX idx_crisis_lookup ON crisis_resources (country, active, priority);

-- Minimal write audit. Never contains health data, free text from users,
-- tokens, or contact details.
CREATE TABLE audit_events (
  id           TEXT PRIMARY KEY,
  at           TEXT NOT NULL,
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('user','admin','therapist','support','system','anonymous')),
  actor_id     TEXT,
  action       TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id   TEXT,
  meta_json    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_at ON audit_events (at);
CREATE INDEX idx_audit_subject ON audit_events (subject_type, subject_id);

-- Outbox for notifications. A failed e-mail must never roll back a booking,
-- so delivery is a separate, retried row.
CREATE TABLE notification_outbox (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  booking_id   TEXT REFERENCES bookings(id),
  payload_enc  TEXT NOT NULL,                     -- AES-GCM ciphertext (recipient + details)
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  next_retry_at TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_outbox_pending ON notification_outbox (status, next_retry_at);
