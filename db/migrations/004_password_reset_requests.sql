-- One pending request per account; public responses never disclose membership.
CREATE TABLE IF NOT EXISTS password_reset_requests (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
