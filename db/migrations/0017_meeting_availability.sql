-- Story 7.2: attributed Meeting responses and their normalized availability
-- facts. The revision capability itself remains first-party; only its keyed
-- digest crosses the persistence boundary.

CREATE TABLE meeting_response (
  vote_id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL CHECK (
    length(display_name) BETWEEN 1 AND 80
    AND display_name = trim(display_name)
  ),
  revision_capability_digest TEXT NOT NULL CHECK (
    length(revision_capability_digest) > 0
  ),
  FOREIGN KEY (vote_id) REFERENCES vote(id) ON DELETE CASCADE
);

CREATE TABLE meeting_availability (
  vote_id TEXT NOT NULL,
  meeting_slot_id TEXT NOT NULL,
  availability TEXT NOT NULL CHECK (
    availability IN ('yes', 'if_need_be', 'no')
  ),
  PRIMARY KEY (vote_id, meeting_slot_id),
  FOREIGN KEY (vote_id) REFERENCES vote(id) ON DELETE CASCADE,
  FOREIGN KEY (meeting_slot_id) REFERENCES meeting_slot(id) ON DELETE CASCADE
);

-- Foreign keys cannot express that the Slot and Vote belong to the same
-- authoritative Meeting Poll.
CREATE TRIGGER meeting_availability_slot_guard
BEFORE INSERT ON meeting_availability
WHEN NOT EXISTS (
  SELECT 1
  FROM vote AS v
  JOIN poll AS p ON p.id = v.poll_id
  JOIN meeting_slot AS ms
    ON ms.id = NEW.meeting_slot_id
   AND ms.poll_id = v.poll_id
  WHERE v.id = NEW.vote_id
    AND p.poll_type = 'meeting'
)
BEGIN
  SELECT RAISE(ABORT, 'meeting_availability_slot_invalid');
END;

CREATE TRIGGER meeting_response_vote_guard
BEFORE INSERT ON meeting_response
WHEN NOT EXISTS (
  SELECT 1 FROM vote AS v
  JOIN poll AS p ON p.id = v.poll_id
  WHERE v.id = NEW.vote_id AND p.poll_type = 'meeting'
)
BEGIN
  SELECT RAISE(ABORT, 'meeting_response_vote_invalid');
END;

-- Story 7.3 replaces availability rows. Re-check effective-open state for
-- both inserts and updates inside the transaction that writes those facts.
CREATE TRIGGER meeting_availability_open_insert_guard
BEFORE INSERT ON meeting_availability
WHEN EXISTS (
  SELECT 1 FROM vote AS v JOIN poll AS p ON p.id = v.poll_id
  WHERE v.id = NEW.vote_id
    AND (p.closed_at_ms IS NOT NULL OR
      (p.deadline_ms IS NOT NULL AND p.deadline_ms <= CAST(unixepoch('subsec') * 1000 AS INTEGER)))
)
BEGIN
  SELECT RAISE(ABORT, 'poll_closed');
END;

CREATE TRIGGER meeting_availability_open_update_guard
BEFORE UPDATE ON meeting_availability
WHEN EXISTS (
  SELECT 1 FROM vote AS v JOIN poll AS p ON p.id = v.poll_id
  WHERE v.id = NEW.vote_id
    AND (p.closed_at_ms IS NOT NULL OR
      (p.deadline_ms IS NOT NULL AND p.deadline_ms <= CAST(unixepoch('subsec') * 1000 AS INTEGER)))
)
BEGIN
  SELECT RAISE(ABORT, 'poll_closed');
END;
