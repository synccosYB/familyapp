-- Invitations select existing audiences; they never bypass administrator approval.
CREATE TABLE IF NOT EXISTS family_invitations (
  token_hash text PRIMARY KEY,
  sides text[] NOT NULL CHECK (cardinality(sides) BETWEEN 1 AND 2 AND sides <@ ARRAY['a','b']::text[]),
  created_by int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days'
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by int REFERENCES users(id) ON DELETE SET NULL;
