ALTER TABLE people ADD COLUMN known_as text NOT NULL DEFAULT '' CHECK (char_length(known_as) <= 160);
