-- Keep the configured owner's identity stable when their login phone changes.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS bootstrap_admin_id integer REFERENCES users(id) ON DELETE RESTRICT;
