ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_room_check;
ALTER TABLE messages ADD CONSTRAINT messages_room_check CHECK (room IN ('all','a','b') OR room ~ '^dm:[1-9][0-9]*:[1-9][0-9]*$');
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to bigint REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_id text REFERENCES files(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS messages_attachment ON messages(file_id) WHERE file_id IS NOT NULL;
ALTER TABLE files ADD COLUMN IF NOT EXISTS chat_room text;
CREATE TABLE IF NOT EXISTS message_mentions (
  message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(message_id,user_id)
);
CREATE TABLE IF NOT EXISTS chat_presence (
  user_id int PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  room text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  active_at timestamptz NOT NULL DEFAULT now()
);
