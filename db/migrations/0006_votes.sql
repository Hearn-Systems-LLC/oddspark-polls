-- Voting fact schema for Story 1.5.
-- Accepted votes are immutable, idempotent per Poll/submission pair, and
-- guarded by secret-keyed duplicate claims (AD-6/AD-7/AD-8).

CREATE TABLE vote (
  id TEXT PRIMARY KEY NOT NULL,
  poll_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (poll_id) REFERENCES poll(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX vote_poll_id_submission_id_idx
  ON vote(poll_id, submission_id);
CREATE INDEX vote_poll_id_idx ON vote(poll_id);

CREATE TABLE vote_selection (
  vote_id TEXT NOT NULL,
  poll_option_id TEXT NOT NULL,
  PRIMARY KEY (vote_id, poll_option_id),
  FOREIGN KEY (vote_id) REFERENCES vote(id) ON DELETE CASCADE,
  FOREIGN KEY (poll_option_id) REFERENCES poll_option(id) ON DELETE CASCADE
);

CREATE TABLE voter_claim (
  poll_id TEXT NOT NULL,
  check_kind TEXT NOT NULL,
  digest TEXT NOT NULL,
  vote_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (poll_id, check_kind, digest),
  FOREIGN KEY (poll_id) REFERENCES poll(id) ON DELETE CASCADE,
  FOREIGN KEY (vote_id) REFERENCES vote(id) ON DELETE CASCADE
);

-- Vote-row deletes (via poll cascade) must find claims by vote_id without a
-- table scan per vote row.
CREATE INDEX voter_claim_vote_id_idx ON voter_claim(vote_id);

-- The application open-state check exists for useful copy only. This trigger
-- is the transaction-time correctness boundary: a poll that closes while a
-- voter decides cannot accept a vote.
CREATE TRIGGER vote_poll_open_guard
BEFORE INSERT ON vote
WHEN EXISTS (
  SELECT 1
  FROM poll
  WHERE id = NEW.poll_id
    AND (
      closed_at_ms IS NOT NULL
      OR (
        deadline_ms IS NOT NULL
        AND deadline_ms <= CAST(unixepoch('subsec') * 1000 AS INTEGER)
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'poll_closed');
END;
