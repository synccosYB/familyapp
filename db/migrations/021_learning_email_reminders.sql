-- Members explicitly enable daily mail after verifying their address.
ALTER TABLE users ADD COLUMN learning_email_reminders boolean NOT NULL DEFAULT false;
CREATE TABLE learning_email_deliveries (
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id int NOT NULL REFERENCES learn_lists(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  recipient text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  provider_id text,
  PRIMARY KEY(user_id,list_id,local_date)
);
