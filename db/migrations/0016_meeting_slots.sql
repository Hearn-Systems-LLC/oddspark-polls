-- Story 7.1: Meeting Poll candidate slots are normalized civil-time facts.
-- Instants are stored as UTC Unix milliseconds while the Creator's IANA time
-- zone is retained for faithful rendering across daylight-saving boundaries.

CREATE TABLE meeting_slot (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  starts_at_ms INTEGER NOT NULL,
  ends_at_ms INTEGER NOT NULL,
  time_zone TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  CHECK (ends_at_ms > starts_at_ms),
  FOREIGN KEY (poll_id) REFERENCES poll(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX meeting_slot_position_idx
ON meeting_slot(poll_id, position);

-- Meeting Polls never carry Multiple-Choice selection bounds. Keep the fact
-- families disjoint even when an out-of-band writer bypasses the domain.
CREATE TRIGGER meeting_poll_bounds_insert_guard
BEFORE INSERT ON poll
WHEN NEW.poll_type = 'meeting'
  AND (
    NEW.multi_select_enabled != 0
    OR NEW.min_selections IS NOT NULL
    OR NEW.max_selections IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'meeting_poll_bounds_invalid');
END;

CREATE TRIGGER meeting_poll_bounds_update_guard
BEFORE UPDATE OF poll_type, multi_select_enabled, min_selections, max_selections
ON poll
WHEN NEW.poll_type = 'meeting'
  AND (
    NEW.multi_select_enabled != 0
    OR NEW.min_selections IS NOT NULL
    OR NEW.max_selections IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'meeting_poll_bounds_invalid');
END;

-- Slot rows belong only to the dedicated Meeting Poll fact family.
CREATE TRIGGER meeting_slot_poll_type_guard
BEFORE INSERT ON meeting_slot
WHEN NOT EXISTS (
  SELECT 1
  FROM poll AS p
  WHERE p.id = NEW.poll_id
    AND p.poll_type = 'meeting'
)
BEGIN
  SELECT RAISE(ABORT, 'meeting_slot_poll_type_invalid');
END;
