-- Existing spouse links remain the first recorded marriage; admins can correct order.
ALTER TABLE people ADD COLUMN second_spouse_id int REFERENCES people(id);
ALTER TABLE people ADD FOREIGN KEY(second_spouse_id,family_group_id) REFERENCES people(id,family_group_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE people ADD CHECK(second_spouse_id IS NULL OR (second_spouse_id<>id AND second_spouse_id IS DISTINCT FROM spouse_id));
CREATE INDEX people_second_spouse ON people(second_spouse_id);
ALTER TABLE people DROP CONSTRAINT people_spouse_id_key;
CREATE INDEX people_first_spouse ON people(spouse_id);
