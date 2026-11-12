ALTER TABLE people ADD COLUMN IF NOT EXISTS kever text NOT NULL DEFAULT '';
UPDATE people p SET kever=y.kever FROM yahrzeits y WHERE y.person_id=p.id AND p.kever='' AND y.kever<>'';
