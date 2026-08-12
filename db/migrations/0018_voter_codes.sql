-- Voter Code inventory and redemption tables for Story 8.1 (AD-25).
-- Voting owns code inventory and redemptions (AD-19). Codes are stored as
-- recoverable normalized uppercase text under owner-only authorization.
-- Redemption is a unique insert into voter_code_redemptions keyed by code_id
-- with a FK to vote, so one Vote consumes at most one code and an invalid or
-- already-redeemed code aborts the entire batch (AD-7).

CREATE TABLE voter_code (
  id TEXT PRIMARY KEY NOT NULL,
  poll_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  code TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (poll_id) REFERENCES poll(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX voter_code_poll_code_idx
  ON voter_code(poll_id, code);

CREATE UNIQUE INDEX voter_code_poll_batch_position_idx
  ON voter_code(poll_id, batch_id, position);

CREATE INDEX voter_code_poll_idx ON voter_code(poll_id);

CREATE TABLE voter_code_redemptions (
  code_id TEXT PRIMARY KEY NOT NULL,
  vote_id TEXT NOT NULL UNIQUE,
  redeemed_at_ms INTEGER NOT NULL,
  FOREIGN KEY (code_id) REFERENCES voter_code(id) ON DELETE CASCADE,
  FOREIGN KEY (vote_id) REFERENCES vote(id) ON DELETE CASCADE
);

-- Cross-Poll guard: a redemption must join a code and vote from the same Poll.
CREATE TRIGGER voter_code_redemption_cross_poll_guard
BEFORE INSERT ON voter_code_redemptions
WHEN EXISTS (
  SELECT 1
  FROM voter_code vc
  JOIN vote v ON v.id = NEW.vote_id
  WHERE vc.id = NEW.code_id
    AND vc.poll_id != v.poll_id
)
BEGIN
  SELECT RAISE(ABORT, 'voter_code_cross_poll');
END;

-- One-Vote-one-code guard: a single Vote cannot consume multiple codes.
CREATE TRIGGER voter_code_one_per_vote_guard
BEFORE INSERT ON voter_code_redemptions
WHEN EXISTS (
  SELECT 1
  FROM voter_code_redemptions
  WHERE vote_id = NEW.vote_id
)
BEGIN
  SELECT RAISE(ABORT, 'voter_code_already_consumed');
END;

-- Total cap guard: at most 1,000 codes per Poll. Counts committed rows plus
-- earlier rows in the same batch so concurrent novel batches serialize at the
-- boundary and the losing D1 batch rolls back to zero inserted rows.
CREATE TRIGGER voter_code_total_cap_guard
BEFORE INSERT ON voter_code
WHEN (
  SELECT COUNT(*)
  FROM voter_code
  WHERE poll_id = NEW.poll_id
) >= 1000
BEGIN
  SELECT RAISE(ABORT, 'voter_code_total_cap');
END;

-- Effective-open guard: codes can only be generated while the Poll is open.
-- Uses database time via unixepoch('subsec') for correctness (Story 1.5 idiom).
CREATE TRIGGER voter_code_poll_open_guard
BEFORE INSERT ON voter_code
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
  SELECT RAISE(ABORT, 'voter_code_poll_closed');
END;

-- Toggle guard: Voter Codes must be enabled on the Poll.
CREATE TRIGGER voter_code_toggle_guard
BEFORE INSERT ON voter_code
WHEN EXISTS (
  SELECT 1
  FROM poll
  WHERE id = NEW.poll_id
    AND voter_codes_enabled = 0
)
BEGIN
  SELECT RAISE(ABORT, 'voter_code_toggle_disabled');
END;
