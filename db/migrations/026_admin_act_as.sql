ALTER TABLE sessions ADD COLUMN admin_session_hash text REFERENCES sessions(token_hash) ON DELETE CASCADE;
CREATE UNIQUE INDEX sessions_acting_admin ON sessions(admin_session_hash) WHERE admin_session_hash IS NOT NULL;

CREATE TABLE admin_act_as_audit (
  id bigserial PRIMARY KEY,
  admin_id int NOT NULL,
  member_id int NOT NULL,
  event text NOT NULL CHECK (event IN ('start','request','stop')),
  method text,
  route text,
  created_at timestamptz NOT NULL DEFAULT now()
);
