CREATE TABLE IF NOT EXISTS learn_portions (
  list_id int NOT NULL,
  idx int NOT NULL,
  chapter int NOT NULL CHECK (chapter>0),
  mishnah int NOT NULL CHECK (mishnah>0),
  taken_by int REFERENCES users(id) ON DELETE SET NULL,
  taken_at timestamptz,
  done boolean NOT NULL DEFAULT false,
  PRIMARY KEY(list_id,idx,chapter,mishnah),
  FOREIGN KEY(list_id,idx) REFERENCES learn_items(list_id,idx) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS learn_help_requests (
  id serial PRIMARY KEY,
  list_id int NOT NULL,
  idx int NOT NULL,
  chapter int NOT NULL DEFAULT 0 CHECK (chapter>=0),
  mishnah int NOT NULL DEFAULT 0 CHECK (mishnah>=0 AND (mishnah=0 OR chapter>0)),
  requested_by int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note text NOT NULL DEFAULT '',
  helper_id int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  FOREIGN KEY(list_id,idx) REFERENCES learn_items(list_id,idx) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS learn_help_open ON learn_help_requests(list_id,idx,chapter,mishnah,requested_by) WHERE resolved_at IS NULL;
