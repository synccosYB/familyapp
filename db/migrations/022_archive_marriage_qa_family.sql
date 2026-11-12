ALTER TABLE family_groups ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Retire the isolated marriage QA fixture and keep its test profiles recoverable.
WITH archived AS (
  UPDATE family_groups g SET archived_at=now()
  WHERE g.name='QA זיווגים 2026-11-12' AND NOT g.is_quarantine AND g.archived_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM users u WHERE g.id=ANY(u.family_group_ids))
  RETURNING g.id
)
INSERT INTO family_assignment_audit(family_group_id,assignments)
SELECT id,jsonb_build_object('kind','archive_qa_family') FROM archived;
