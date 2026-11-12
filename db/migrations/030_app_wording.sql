CREATE TABLE app_wording (
  id integer PRIMARY KEY CHECK (id = 1),
  revision bigint NOT NULL DEFAULT 0,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO app_wording (id) VALUES (1);

ALTER TABLE learning_email_requests
  ADD COLUMN message jsonb,
  ADD COLUMN audience_fingerprint text;
