-- Story 5.1: Ranked-Choice Ballots are normalized ordered facts. One accepted
-- Vote owns a non-empty contiguous preference sequence; no Ballot JSON or
-- implicit option-row ordering enters the source of truth.

CREATE TABLE ranked_vote_preference (
  vote_id TEXT NOT NULL,
  poll_option_id TEXT NOT NULL,
  preference_rank INTEGER NOT NULL CHECK (preference_rank >= 1),
  PRIMARY KEY (vote_id, poll_option_id),
  UNIQUE (vote_id, preference_rank),
  FOREIGN KEY (vote_id) REFERENCES vote(id) ON DELETE CASCADE,
  FOREIGN KEY (poll_option_id) REFERENCES poll_option(id) ON DELETE CASCADE
);

-- Ranked Polls never carry the Multiple-Choice bounds contract. Keep this
-- invariant at storage even if an out-of-band writer bypasses the domain.
CREATE TRIGGER ranked_poll_bounds_insert_guard
BEFORE INSERT ON poll
WHEN NEW.poll_type = 'ranked_choice'
  AND (
    NEW.multi_select_enabled != 0
    OR NEW.min_selections IS NOT NULL
    OR NEW.max_selections IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'ranked_poll_bounds_invalid');
END;

CREATE TRIGGER ranked_poll_bounds_update_guard
BEFORE UPDATE OF poll_type, multi_select_enabled, min_selections, max_selections
ON poll
WHEN NEW.poll_type = 'ranked_choice'
  AND (
    NEW.multi_select_enabled != 0
    OR NEW.min_selections IS NOT NULL
    OR NEW.max_selections IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'ranked_poll_bounds_invalid');
END;

-- A preference must name an option on the same authoritative Ranked Poll as
-- its Vote. The ordinary foreign keys alone cannot express this cross-row
-- ownership constraint.
CREATE TRIGGER ranked_preference_option_guard
BEFORE INSERT ON ranked_vote_preference
WHEN NOT EXISTS (
  SELECT 1
  FROM vote AS v
  JOIN poll AS p ON p.id = v.poll_id
  JOIN poll_option AS po
    ON po.id = NEW.poll_option_id
   AND po.poll_id = v.poll_id
  WHERE v.id = NEW.vote_id
    AND p.poll_type = 'ranked_choice'
)
BEGIN
  SELECT RAISE(ABORT, 'ranked_preference_option_invalid');
END;

-- The adapter inserts canonical rank order. Enforcing next-rank-only here
-- makes skipped positions impossible even for an out-of-band batch writer.
CREATE TRIGGER ranked_preference_contiguous_guard
BEFORE INSERT ON ranked_vote_preference
WHEN NEW.preference_rank != (
  SELECT COUNT(*) + 1
  FROM ranked_vote_preference
  WHERE vote_id = NEW.vote_id
)
BEGIN
  SELECT RAISE(ABORT, 'ranked_preference_rank_invalid');
END;

-- Fact families are disjoint: Ranked Votes cannot masquerade as ordinary
-- selections, and Multiple-Choice Votes cannot acquire ranked preferences.
CREATE TRIGGER ranked_vote_selection_guard
BEFORE INSERT ON vote_selection
WHEN EXISTS (
  SELECT 1
  FROM vote AS v
  JOIN poll AS p ON p.id = v.poll_id
  WHERE v.id = NEW.vote_id
    AND p.poll_type = 'ranked_choice'
)
BEGIN
  SELECT RAISE(ABORT, 'ranked_preference_required');
END;
