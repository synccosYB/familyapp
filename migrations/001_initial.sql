CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, name text NOT NULL, login text NOT NULL UNIQUE, password_hash text NOT NULL,
 sides text[] NOT NULL CHECK (cardinality(sides) BETWEEN 1 AND 2 AND sides <@ ARRAY['f','m']::text[]),
 is_admin boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invites (
 id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE, sides text[] NOT NULL,
 created_by uuid REFERENCES users(id), expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS records (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('person','directory','yahrzeit','simcha','learning')),
 side text NOT NULL CHECK (side IN ('f','m','all')), owner_id uuid NOT NULL REFERENCES users(id),
 parent_id uuid REFERENCES records(id) ON DELETE RESTRICT,
 data jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS records_side_kind ON records(side, kind);
CREATE TABLE IF NOT EXISTS claims (
 record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE, unit integer NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id), completed boolean NOT NULL DEFAULT false,
 PRIMARY KEY(record_id, unit)
);
CREATE TABLE IF NOT EXISTS rsvps (
 record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id),
 answer text NOT NULL CHECK(answer IN ('yes','no')), PRIMARY KEY(record_id,user_id)
);
CREATE TABLE IF NOT EXISTS messages (
 id uuid PRIMARY KEY, side text NOT NULL CHECK(side IN ('f','m','all')), user_id uuid NOT NULL REFERENCES users(id),
 body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_side_time ON messages(side,created_at);
CREATE TABLE IF NOT EXISTS attachments (
 record_id uuid PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
 filename text NOT NULL, mime text NOT NULL, content bytea NOT NULL
);
