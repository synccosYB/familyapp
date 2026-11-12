-- Preserve existing free-text addresses; new edits store each part separately.
ALTER TABLE directory ADD COLUMN IF NOT EXISTS address_line1 text;
ALTER TABLE directory ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE directory ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE directory ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE directory ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE directory ADD COLUMN IF NOT EXISTS country text;
