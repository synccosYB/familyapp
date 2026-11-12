CREATE TABLE person_reviews (
  id serial PRIMARY KEY,
  family_group_id int NOT NULL DEFAULT nullif(current_setting('familye.family_group_id',true),'')::int REFERENCES family_groups(id),
  created_by int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id int REFERENCES people(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  previous_hash text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','confirmed','existing','rejected')),
  result_id int REFERENCES people(id) ON DELETE SET NULL,
  reviewed_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX person_reviews_family ON person_reviews(family_group_id,status);
CREATE TABLE person_save_requests (
  family_group_id int NOT NULL DEFAULT nullif(current_setting('familye.family_group_id',true),'')::int REFERENCES family_groups(id),
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(family_group_id,user_id,request_key)
);
