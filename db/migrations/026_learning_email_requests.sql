CREATE TABLE learning_email_requests (
  requested_by int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  list_id int NOT NULL REFERENCES learn_lists(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  sent_count int NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requested_by,request_key)
);
