-- Access groups are distinct from genealogical family/surname labels.
-- Fail closed: no inference from surnames, creator identity, or A/B side codes.
CREATE TABLE family_groups (
  id serial PRIMARY KEY,
  is_quarantine boolean NOT NULL DEFAULT false,
  name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX family_groups_name ON family_groups(lower(name));
ALTER TABLE users ADD COLUMN is_family_admin boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN family_group_id int REFERENCES family_groups(id);
-- Preserve existing accounts, but give unclassified accounts no content access.
INSERT INTO family_groups(name,is_quarantine) VALUES ('ווארט אויף משפחה צוטיילונג',true);
UPDATE users SET family_group_id=(SELECT id FROM family_groups WHERE is_quarantine);
ALTER TABLE users ALTER COLUMN family_group_id SET NOT NULL;
CREATE INDEX users_family_group ON users(family_group_id);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['people','yahrzeits','learn_lists','directory','simchas','files','messages','families','family_invitations','chat_presence'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN family_group_id int REFERENCES family_groups(id)',t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN family_group_id SET DEFAULT nullif(current_setting(''familye.family_group_id'',true),'''')::int',t);
    EXECUTE format('CREATE INDEX ON %I(family_group_id)',t);
  END LOOP;
END $$;
DROP INDEX families_name;
CREATE UNIQUE INDEX families_group_name ON families(family_group_id,lower(name));
-- Composite foreign keys prevent cross-family graph links, even in a race.
ALTER TABLE people ADD UNIQUE(id,family_group_id);
ALTER TABLE yahrzeits ADD UNIQUE(id,family_group_id);
ALTER TABLE files ADD UNIQUE(id,family_group_id);
ALTER TABLE messages ADD UNIQUE(id,family_group_id);
ALTER TABLE people ADD FOREIGN KEY(father_id,family_group_id) REFERENCES people(id,family_group_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE people ADD FOREIGN KEY(mother_id,family_group_id) REFERENCES people(id,family_group_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE people ADD FOREIGN KEY(parent_id,family_group_id) REFERENCES people(id,family_group_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE people ADD FOREIGN KEY(spouse_id,family_group_id) REFERENCES people(id,family_group_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE yahrzeits ADD FOREIGN KEY(person_id,family_group_id) REFERENCES people(id,family_group_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE yahrzeits ADD FOREIGN KEY(canonical_id,family_group_id) REFERENCES yahrzeits(id,family_group_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE learn_lists ADD FOREIGN KEY(yahrzeit_id,family_group_id) REFERENCES yahrzeits(id,family_group_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE directory ADD FOREIGN KEY(husband_person_id,family_group_id) REFERENCES people(id,family_group_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE directory ADD FOREIGN KEY(wife_person_id,family_group_id) REFERENCES people(id,family_group_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE simchas ADD FOREIGN KEY(file_id,family_group_id) REFERENCES files(id,family_group_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE messages ADD FOREIGN KEY(file_id,family_group_id) REFERENCES files(id,family_group_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE messages ADD FOREIGN KEY(reply_to,family_group_id) REFERENCES messages(id,family_group_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE family_assignment_audit (
  id bigserial PRIMARY KEY, admin_id int REFERENCES users(id) ON DELETE SET NULL,
  family_group_id int REFERENCES family_groups(id), assignments jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
