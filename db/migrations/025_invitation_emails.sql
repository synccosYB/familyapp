CREATE TABLE invitation_email_deliveries (
  simcha_id int NOT NULL REFERENCES simchas(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  queued_by int NOT NULL REFERENCES users(id),
  all_families boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  sent_at timestamptz,
  provider_id text,
  last_error text,
  PRIMARY KEY(simcha_id,recipient)
);
