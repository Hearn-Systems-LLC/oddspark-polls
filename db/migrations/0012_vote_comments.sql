-- Story 4.1: an opt-in Comment is a Vote-owned fact and is committed in the
-- same D1 batch as its accepted Vote. Browser/domain policy counts UTF-16
-- code units; these storage checks remain a defense-in-depth scalar bound.
ALTER TABLE poll
  ADD COLUMN comments_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (comments_enabled IN (0, 1));

CREATE TABLE vote_comment (
  id TEXT PRIMARY KEY NOT NULL,
  vote_id TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  display_name TEXT CHECK (
    display_name IS NULL OR length(display_name) BETWEEN 1 AND 80
  ),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  FOREIGN KEY (vote_id) REFERENCES vote(id) ON DELETE CASCADE
);

CREATE INDEX vote_comment_created_at_idx
  ON vote_comment(created_at_ms DESC, id DESC);

-- The creator may disable Comments between CastVote's snapshot read and its
-- D1 batch. Re-check the authoritative Poll setting inside that same batch so
-- the Vote and Comment either remain legal together or roll back together.
CREATE TRIGGER vote_comment_enabled_guard
BEFORE INSERT ON vote_comment
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM vote
  JOIN poll ON poll.id = vote.poll_id
  WHERE vote.id = NEW.vote_id
    AND poll.comments_enabled = 1
)
BEGIN
  SELECT RAISE(ABORT, 'comments_disabled');
END;
