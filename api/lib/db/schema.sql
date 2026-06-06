CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  prefs         JSONB NOT NULL DEFAULT '[]'::jsonb,
  budget_pref   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS guests (
  device_token TEXT PRIMARY KEY,
  prefs        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id           TEXT PRIMARY KEY,
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  device_token TEXT,
  request      TEXT NOT NULL,
  constraints  JSONB NOT NULL,
  routes       JSONB NOT NULL,
  data_sources JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plans_user_idx ON plans (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS plans_device_idx ON plans (device_token, created_at DESC);

CREATE TABLE IF NOT EXISTS poi_cache (
  key        TEXT PRIMARY KEY,
  payload    JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
