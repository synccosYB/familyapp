-- Match the existing Replit persistence path; retain legacy filesystem reads.
ALTER TABLE files ADD COLUMN IF NOT EXISTS content bytea;
