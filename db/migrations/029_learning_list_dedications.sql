-- Keep the first dedication in learn_lists so existing lists and clients retain their IDs.
CREATE TABLE learn_list_dedications (
  list_id int NOT NULL REFERENCES learn_lists(id) ON DELETE CASCADE,
  position int NOT NULL CHECK (position > 1),
  yahrzeit_id int REFERENCES yahrzeits(id) ON DELETE SET NULL,
  niftar text NOT NULL,
  PRIMARY KEY (list_id, position),
  UNIQUE (list_id, yahrzeit_id)
);
CREATE INDEX learn_list_dedications_yahrzeit ON learn_list_dedications(yahrzeit_id);

CREATE VIEW learning_dedications AS
  SELECT id AS list_id, 1 AS position, yahrzeit_id, niftar FROM learn_lists
  UNION ALL
  SELECT list_id, position, yahrzeit_id, niftar FROM learn_list_dedications;

CREATE OR REPLACE FUNCTION validate_person_family_links() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM people p CROSS JOIN LATERAL unnest(ARRAY[p.father_id,p.mother_id,p.parent_id,p.spouse_id,p.second_spouse_id]) r(id)
   JOIN people relative ON relative.id=r.id
   WHERE p.family_group_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM (SELECT p.family_group_id g UNION SELECT a.family_group_id FROM person_family_access a WHERE a.person_id=p.id) a
     JOIN (SELECT relative.family_group_id g UNION SELECT a.family_group_id FROM person_family_access a WHERE a.person_id=relative.id) b USING(g)
   )
 ) THEN RAISE EXCEPTION 'foreign key: linked people must share an assigned family' USING ERRCODE='23503'; END IF;
 IF EXISTS (
   SELECT 1 FROM directory d CROSS JOIN LATERAL unnest(ARRAY[d.husband_person_id,d.wife_person_id]) r(id)
   JOIN people p ON p.id=r.id WHERE d.family_group_id IS NOT NULL AND d.family_group_id IS DISTINCT FROM p.family_group_id
   AND NOT EXISTS(SELECT 1 FROM person_family_access a WHERE a.person_id=p.id AND a.family_group_id=d.family_group_id)
 ) OR EXISTS (
   SELECT 1 FROM yahrzeits y JOIN people p ON p.id=y.person_id WHERE y.family_group_id IS NOT NULL AND y.family_group_id IS DISTINCT FROM p.family_group_id
   AND NOT EXISTS(SELECT 1 FROM person_family_access a WHERE a.person_id=p.id AND a.family_group_id=y.family_group_id)
 ) OR EXISTS (
   SELECT 1 FROM learning_dedications d JOIN learn_lists l ON l.id=d.list_id JOIN yahrzeits y ON y.id=d.yahrzeit_id
   WHERE l.family_group_id IS NOT NULL AND l.family_group_id IS DISTINCT FROM y.family_group_id
   AND NOT EXISTS(SELECT 1 FROM person_family_access a WHERE a.person_id=y.person_id AND a.family_group_id=l.family_group_id)
 ) THEN RAISE EXCEPTION 'foreign key: linked records must share an assigned family' USING ERRCODE='23503'; END IF;
 RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER learning_dedication_family_links
  AFTER INSERT OR UPDATE ON learn_list_dedications DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_person_family_links();
