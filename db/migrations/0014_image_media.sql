-- Story 6.1: Image Poll media records. Each adopted image is a D1 fact that
-- singly owns an immutable R2 key (AD-12). Adoption happens in the same D1
-- batch as the Poll creation (AD-3); unadopted temp keys are cleaned up by
-- the Story 6.3 sweeper.

CREATE TABLE media_object (
  id TEXT NOT NULL PRIMARY KEY,
  poll_id TEXT NOT NULL,
  option_id TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  alt_text TEXT NOT NULL CHECK (length(trim(alt_text)) > 0),
  caption TEXT,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (poll_id) REFERENCES poll(id) ON DELETE CASCADE,
  FOREIGN KEY (option_id) REFERENCES poll_option(id) ON DELETE CASCADE
);

-- Image Polls never carry multi-select bounds. Mirror the ranked_choice
-- guard precedent so the invariant holds at storage even for out-of-band
-- writers.
CREATE TRIGGER image_poll_bounds_insert_guard
BEFORE INSERT ON poll
WHEN NEW.poll_type = 'image'
  AND (
    NEW.multi_select_enabled != 0
    OR NEW.min_selections IS NOT NULL
    OR NEW.max_selections IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'image_poll_bounds_invalid');
END;

CREATE TRIGGER image_poll_bounds_update_guard
BEFORE UPDATE OF poll_type, multi_select_enabled, min_selections, max_selections
ON poll
WHEN NEW.poll_type = 'image'
  AND (
    NEW.multi_select_enabled != 0
    OR NEW.min_selections IS NOT NULL
    OR NEW.max_selections IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'image_poll_bounds_invalid');
END;

-- A media record must reference an option on the same Image Poll as its
-- poll_id. The ordinary foreign keys alone cannot express this cross-row
-- ownership constraint.
CREATE TRIGGER media_object_option_guard
BEFORE INSERT ON media_object
WHEN NOT EXISTS (
  SELECT 1
  FROM poll_option AS po
  JOIN poll AS p ON p.id = po.poll_id
  WHERE po.id = NEW.option_id
    AND po.poll_id = NEW.poll_id
    AND p.poll_type = 'image'
)
BEGIN
  SELECT RAISE(ABORT, 'media_object_option_invalid');
END;
