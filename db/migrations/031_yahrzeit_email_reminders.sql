ALTER TABLE users ADD COLUMN yahrzeit_ancestor_emails boolean NOT NULL DEFAULT false;
-- An explicit choice takes precedence over the member's ancestor preference.
ALTER TABLE yahrzeit_reminders ADD COLUMN enabled boolean NOT NULL DEFAULT true;

CREATE TABLE yahrzeit_email_deliveries (
  id bigserial PRIMARY KEY,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  yahrzeit_id int NOT NULL REFERENCES yahrzeits(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  family_group_id int NOT NULL REFERENCES family_groups(id),
  recipient text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  provider_id text,
  UNIQUE (user_id, yahrzeit_id, occurrence_date)
);
