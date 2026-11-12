ALTER TABLE people ADD COLUMN calendar_dates jsonb NOT NULL DEFAULT '{}';
ALTER TABLE people ADD CONSTRAINT person_calendar_dates_object CHECK (jsonb_typeof(calendar_dates) = 'object');

CREATE TABLE person_photos (
  person_id int PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 1048576)
);

ALTER TABLE person_reviews ADD COLUMN kind text NOT NULL DEFAULT 'duplicate' CHECK (kind IN ('duplicate', 'suggestion'));

ALTER TABLE users ADD COLUMN yahrzeit_whatsapp_phone text;
ALTER TABLE users ADD CONSTRAINT reminder_whatsapp_current_phone CHECK (yahrzeit_whatsapp_phone = phone);

CREATE TABLE yahrzeit_whatsapp_deliveries (
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  yahrzeit_id int NOT NULL REFERENCES yahrzeits(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  provider_id text,
  PRIMARY KEY (user_id, yahrzeit_id, occurrence_date)
);
