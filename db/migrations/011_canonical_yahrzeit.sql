-- Old standalone entries stay intact as archived provenance after an explicit user link.
ALTER TABLE yahrzeits ADD COLUMN IF NOT EXISTS canonical_id int REFERENCES yahrzeits(id) ON DELETE SET NULL;
ALTER TABLE yahrzeits ADD COLUMN IF NOT EXISTS archived_at timestamptz;
