
-- Familye schema. Side codes: 'a' = father's side, 'b' = mother's side. Names live in settings.
CREATE TABLE IF NOT EXISTS settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  family_yi text NOT NULL DEFAULT 'אונדזער משפחה',
  family_en text NOT NULL DEFAULT 'Our Family',
  side_a_yi text NOT NULL DEFAULT 'טאטעס סייד',
  side_a_en text NOT NULL DEFAULT 'Father''s side',
  side_a_family_yi text NOT NULL DEFAULT '',
  side_a_family_en text NOT NULL DEFAULT '',
  side_b_yi text NOT NULL DEFAULT 'מאמעס סייד',
  side_b_en text NOT NULL DEFAULT 'Mother''s side',
  side_b_family_yi text NOT NULL DEFAULT '',
  side_b_family_en text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL UNIQUE,            -- digits only, with country code (1 for US)
  email text,
  password_hash text,
  sides text[] NOT NULL DEFAULT '{}',    -- subset of {a,b}
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected')),
  is_admin boolean NOT NULL DEFAULT false,
  is_qa boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  last_seen_at timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_tokens (
  token_hash text PRIMARY KEY,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS yahrzeits (
  id serial PRIMARY KEY,
  name text NOT NULL,
  father_name text NOT NULL DEFAULT '',
  relation text NOT NULL DEFAULT '',
  side text NOT NULL CHECK (side IN ('a','b','both')),
  hday int NOT NULL CHECK (hday BETWEEN 1 AND 30),
  hmonth text NOT NULL,                  -- TISHREI..ELUL, ADAR, ADAR_I, ADAR_II
  death_year int,                        -- optional Hebrew year (e.g. 5770)
  kever text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  created_by int REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yahrzeit_reminders (
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  yahrzeit_id int NOT NULL REFERENCES yahrzeits(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, yahrzeit_id)
);

CREATE TABLE IF NOT EXISTS people (
  id serial PRIMARY KEY,
  side text NOT NULL CHECK (side IN ('a','b')),
  name text NOT NULL,
  spouse text NOT NULL DEFAULT '',
  parent_id int REFERENCES people(id) ON DELETE CASCADE,
  niftar boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  created_by int REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS people_parent ON people(parent_id);

CREATE TABLE IF NOT EXISTS learn_lists (
  id serial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('tehillim','mishnayos')),
  niftar text NOT NULL,
  side text NOT NULL CHECK (side IN ('a','b','both')),
  yahrzeit_id int REFERENCES yahrzeits(id) ON DELETE SET NULL,
  target_date date,
  note text NOT NULL DEFAULT '',
  created_by int REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learn_items (
  list_id int NOT NULL REFERENCES learn_lists(id) ON DELETE CASCADE,
  idx int NOT NULL,                      -- tehillim: 1..150, mishnayos: 0..62
  taken_by int REFERENCES users(id) ON DELETE SET NULL,
  taken_at timestamptz,
  done boolean NOT NULL DEFAULT false,
  PRIMARY KEY (list_id, idx)
);

CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY,
  filename text NOT NULL,
  mime text NOT NULL,
  size int NOT NULL,
  uploaded_by int REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS simchas (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  whose text NOT NULL,
  gdate date NOT NULL,
  time_text text NOT NULL DEFAULT '',
  hdate_text text NOT NULL DEFAULT '',
  hall text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  audience text NOT NULL CHECK (audience IN ('a','b','all')),
  note text NOT NULL DEFAULT '',
  file_id text REFERENCES files(id) ON DELETE SET NULL,
  created_by int REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rsvps (
  simcha_id int NOT NULL REFERENCES simchas(id) ON DELETE CASCADE,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer text NOT NULL CHECK (answer IN ('yes','no')),
  people int NOT NULL DEFAULT 1 CHECK (people BETWEEN 0 AND 50),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (simcha_id, user_id)
);

CREATE TABLE IF NOT EXISTS directory (
  id serial PRIMARY KEY,
  husband text NOT NULL DEFAULT '',
  wife text NOT NULL DEFAULT '',
  parents text NOT NULL DEFAULT '',      -- whose child (e.g. "זון פון ר׳ משה באכנער")
  side text NOT NULL CHECK (side IN ('a','b','both')),
  address text NOT NULL DEFAULT '',
  phone_h text NOT NULL DEFAULT '',
  phone_w text NOT NULL DEFAULT '',
  owner_id int REFERENCES users(id) ON DELETE SET NULL,   -- the member whose own family this is
  created_by int REFERENCES users(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  room text NOT NULL CHECK (room IN ('all','a','b')),
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_room ON messages(room, id);

CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
