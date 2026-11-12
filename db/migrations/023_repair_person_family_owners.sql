-- Older saves could use the viewing family as owner despite a single checked family.
-- Explicit access grants from legacy tree recovery take precedence over label-based repair.
SELECT pg_advisory_xact_lock(68427301);
LOCK TABLE people, person_families, person_family_access, directory, yahrzeits, learn_lists IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE person_owner_repairs ON COMMIT DROP AS
WITH checked AS (
  SELECT pf.person_id, min(f.family_group_id) AS intended_group
  FROM person_families pf
  JOIN families f ON f.id=pf.family_id
  LEFT JOIN family_groups g ON g.id=f.family_group_id
  GROUP BY pf.person_id
  HAVING count(DISTINCT f.family_group_id)=1 AND bool_and(g.is_quarantine IS FALSE AND g.archived_at IS NULL)
)
SELECT p.id AS person_id, p.family_group_id AS previous_group, checked.intended_group
FROM checked
JOIN people p ON p.id=checked.person_id
JOIN family_groups owner ON owner.id=p.family_group_id AND owner.archived_at IS NULL
WHERE p.family_group_id<>checked.intended_group
  AND NOT EXISTS (SELECT 1 FROM person_family_access a WHERE a.person_id=p.id)
  -- Keep existing relationships and private family records valid after the move.
  AND NOT EXISTS (
    SELECT 1 FROM people relative
    WHERE (relative.id IN (p.father_id,p.mother_id,p.parent_id,p.spouse_id,p.second_spouse_id)
      OR p.id IN (relative.father_id,relative.mother_id,relative.parent_id,relative.spouse_id,relative.second_spouse_id))
      AND relative.family_group_id IS DISTINCT FROM checked.intended_group
      AND NOT EXISTS (SELECT 1 FROM person_family_access a WHERE a.person_id=relative.id AND a.family_group_id=checked.intended_group)
  )
  AND NOT EXISTS (
    SELECT 1 FROM directory d WHERE p.id IN (d.husband_person_id,d.wife_person_id)
      AND d.family_group_id<>checked.intended_group
  )
  AND NOT EXISTS (
    SELECT 1 FROM learn_lists l JOIN yahrzeits y ON y.id=l.yahrzeit_id
    LEFT JOIN yahrzeits canonical ON canonical.id=y.canonical_id
    WHERE p.id IN (y.person_id,canonical.person_id) AND l.family_group_id<>checked.intended_group
  );

UPDATE people p SET family_group_id=r.intended_group FROM person_owner_repairs r WHERE p.id=r.person_id;

WITH memorials AS (
  SELECT y.id, r.previous_group, r.intended_group
  FROM yahrzeits y JOIN person_owner_repairs r ON r.person_id=y.person_id AND r.previous_group=y.family_group_id
)
UPDATE yahrzeits y SET family_group_id=m.intended_group FROM memorials m
WHERE y.id=m.id OR (y.canonical_id=m.id AND y.family_group_id=m.previous_group);

INSERT INTO family_assignment_audit(family_group_id,assignments)
SELECT intended_group, jsonb_build_object('kind','person_owner_repair','people',
  jsonb_agg(jsonb_build_object('id',person_id,'previous_group',previous_group) ORDER BY person_id))
FROM person_owner_repairs GROUP BY intended_group;
