-- OAuth 2.1 Authorization Server + admin session storage.
-- Tokens are opaque; only HMAC hashes are persisted, never the raw value.

CREATE TABLE oauth_clients (
  client_id                  TEXT PRIMARY KEY,
  client_secret_hash         TEXT,               -- NULL for public (PKCE-only) clients
  client_name                TEXT NOT NULL,
  redirect_uris              TEXT NOT NULL,      -- JSON array of exact URIs
  grant_types                TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  scope                      TEXT NOT NULL DEFAULT 'catalog:read booking:read booking:write',
  created_at                 TEXT NOT NULL
);

CREATE TABLE oauth_auth_codes (
  code_hash             TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri          TEXT NOT NULL,
  code_challenge        TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
  scope                 TEXT NOT NULL,
  resource              TEXT NOT NULL,           -- RFC 8707 audience
  expires_at            TEXT NOT NULL,
  used_at               TEXT,
  created_at            TEXT NOT NULL
);
CREATE INDEX idx_codes_expiry ON oauth_auth_codes (expires_at);

CREATE TABLE oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('access','refresh')),
  client_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope      TEXT NOT NULL,
  resource   TEXT NOT NULL,
  parent_hash TEXT,                              -- refresh token that minted this access token
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tokens_user ON oauth_tokens (user_id, kind);
CREATE INDEX idx_tokens_expiry ON oauth_tokens (expires_at);

-- Passwordless login: a one-time 8-character code delivered by e-mail.
CREATE TABLE login_challenges (
  id          TEXT PRIMARY KEY,
  email_hash  TEXT NOT NULL,
  email_enc   TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('oauth','admin')),
  context     TEXT NOT NULL DEFAULT '{}',        -- JSON, e.g. the pending OAuth request
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_login_email ON login_challenges (email_hash, created_at);

CREATE TABLE admin_sessions (
  session_hash TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_hash    TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON admin_sessions (user_id);
