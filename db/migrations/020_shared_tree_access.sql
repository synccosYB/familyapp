-- A person is canonical; family access is many-to-many and never clones the person.
CREATE TABLE person_family_access (
  person_id int NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  family_group_id int NOT NULL REFERENCES family_groups(id),
  PRIMARY KEY(person_id,family_group_id)
);
CREATE INDEX person_family_access_group ON person_family_access(family_group_id,person_id);
-- Keep ordinary ID foreign keys. Relationships may cross storage owners only when
-- both people explicitly share at least one family. Validate at transaction end.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,conrelid::regclass tbl FROM pg_constraint
 WHERE contype='f' AND (confrelid='people'::regclass OR (conrelid='learn_lists'::regclass AND confrelid='yahrzeits'::regclass)) AND array_length(conkey,1)>1
 LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.tbl,c.conname); END LOOP;
END $$;
CREATE FUNCTION validate_person_family_links() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
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
   SELECT 1 FROM learn_lists l JOIN yahrzeits y ON y.id=l.yahrzeit_id WHERE l.family_group_id IS NOT NULL AND l.family_group_id IS DISTINCT FROM y.family_group_id
   AND NOT EXISTS(SELECT 1 FROM person_family_access a WHERE a.person_id=y.person_id AND a.family_group_id=l.family_group_id)
 ) THEN RAISE EXCEPTION 'foreign key: linked records must share an assigned family' USING ERRCODE='23503'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER people_family_links AFTER INSERT OR UPDATE ON people DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_person_family_links();
CREATE CONSTRAINT TRIGGER access_family_links AFTER INSERT OR UPDATE OR DELETE ON person_family_access DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_person_family_links();
CREATE CONSTRAINT TRIGGER directory_family_links AFTER INSERT OR UPDATE ON directory DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_person_family_links();
CREATE CONSTRAINT TRIGGER yahrzeit_family_links AFTER INSERT OR UPDATE ON yahrzeits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_person_family_links();
CREATE CONSTRAINT TRIGGER learning_family_links AFTER INSERT OR UPDATE ON learn_lists DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_person_family_links();
