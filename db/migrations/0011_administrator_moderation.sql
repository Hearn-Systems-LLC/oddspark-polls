-- Story 3.3 Administrator capability and reversible Discovery moderation.
-- Better Auth owns user creation; role is server-owned and defaults closed.
ALTER TABLE user
  ADD COLUMN role TEXT NOT NULL DEFAULT 'creator'
  CHECK (role IN ('creator', 'administrator'));

-- This demonstration build deliberately permits a single Administrator.
CREATE UNIQUE INDEX user_single_administrator_idx
  ON user(role)
  WHERE role = 'administrator';

-- Append-only, ordered moderation facts. The Poll is the aggregate being
-- moderated, so deleting it removes its history. Actor deletion is restricted
-- so an action can never become unattributed.
CREATE TABLE moderation_action (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('delist', 'clear_delisted')),
  prior_state TEXT NOT NULL
    CHECK (prior_state IN ('unlisted', 'listed', 'delisted')),
  next_state TEXT NOT NULL
    CHECK (next_state IN ('unlisted', 'listed', 'delisted')),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  FOREIGN KEY (poll_id) REFERENCES poll(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES user(id) ON DELETE NO ACTION,
  CHECK (
    (action = 'delist'
      AND prior_state IN ('unlisted', 'listed')
      AND next_state = 'delisted')
    OR
    (action = 'clear_delisted'
      AND prior_state = 'delisted'
      AND next_state IN ('unlisted', 'listed'))
  )
);

CREATE INDEX moderation_action_poll_sequence_idx
  ON moderation_action(poll_id, sequence DESC);
