-- Keep one primary family for ownership/admin role, with up to four explicit access families.
ALTER TABLE users ADD COLUMN family_group_ids int[];
UPDATE users SET family_group_ids=ARRAY[family_group_id];
ALTER TABLE users ALTER COLUMN family_group_ids SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_family_count CHECK(cardinality(family_group_ids) BETWEEN 1 AND 4 AND family_group_id=ANY(family_group_ids));
CREATE INDEX users_family_groups ON users USING gin(family_group_ids);
CREATE FUNCTION validate_user_families() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE found_count int;
BEGIN
  IF NEW.family_group_ids IS NULL THEN NEW.family_group_ids=ARRAY[NEW.family_group_id]; END IF;
  -- Older administrative clients can still replace the single assignment safely.
  IF TG_OP='UPDATE' AND NEW.family_group_id IS DISTINCT FROM OLD.family_group_id AND NEW.family_group_ids=OLD.family_group_ids THEN
    NEW.family_group_ids=ARRAY[NEW.family_group_id];
  END IF;
  IF cardinality(NEW.family_group_ids) NOT BETWEEN 1 AND 4 OR array_ndims(NEW.family_group_ids)<>1 OR array_position(NEW.family_group_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Assign one to four families' USING ERRCODE='23514';
  END IF;
  PERFORM id FROM family_groups WHERE id=ANY(NEW.family_group_ids) FOR KEY SHARE;
  GET DIAGNOSTICS found_count = ROW_COUNT;
  IF found_count<>cardinality(NEW.family_group_ids) THEN
    RAISE EXCEPTION 'Family assignments must be distinct existing families' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_validate_families BEFORE INSERT OR UPDATE OF family_group_id,family_group_ids ON users FOR EACH ROW EXECUTE FUNCTION validate_user_families();
-- Array references must also protect secondary families against deletion.
CREATE FUNCTION protect_assigned_family() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM users WHERE OLD.id=ANY(family_group_ids)) THEN
    RAISE EXCEPTION 'Family still has assigned members' USING ERRCODE='23503';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER families_protect_members BEFORE DELETE OR UPDATE OF id ON family_groups FOR EACH ROW EXECUTE FUNCTION protect_assigned_family();
