-- Replit may apply additive schema changes before the application bootstrap.
-- Re-running the DDL must still allow data backfills and migration tracking.
-- Family affiliation is distinct from the existing record visibility audience.
-- Nothing here broadens account permissions or guesses family names from audiences.
CREATE TABLE IF NOT EXISTS families (
  id serial PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS families_name ON families(lower(name));
CREATE TABLE IF NOT EXISTS person_families (
  person_id int NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  family_id int NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  PRIMARY KEY(person_id,family_id)
);
CREATE INDEX IF NOT EXISTS person_families_family ON person_families(family_id);
ALTER TABLE people ADD COLUMN IF NOT EXISTS lineage_term text NOT NULL DEFAULT '' CHECK (lineage_term IN ('','בן','בת'));
-- Infer only from explicitly recorded father/mother roles; ambiguous roles stay unknown.
UPDATE people p SET lineage_term='בן' WHERE EXISTS(SELECT 1 FROM people c WHERE c.father_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM people c WHERE c.mother_id=p.id);
UPDATE people p SET lineage_term='בת' WHERE EXISTS(SELECT 1 FROM people c WHERE c.mother_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM people c WHERE c.father_id=p.id);
UPDATE yahrzeits y SET father_name=coalesce((SELECT concat_ws(' ',nullif(p.lineage_term,''),nullif(f.title,''),f.name) FROM people f WHERE f.id=p.father_id),'')
  FROM people p WHERE y.person_id=p.id;
