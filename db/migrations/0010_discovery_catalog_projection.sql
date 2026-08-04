-- Story 3.2 public Discovery projection support.
--
-- Effective closure remains request-derived (AD-11). Split partial indexes
-- avoid accumulating an expired Deadline prefix in the creation-order stream:
-- no-Deadline rows are already in catalog order, while Deadline-bearing rows
-- range-seek by deadline before an explicitly accepted active-set sort.
CREATE INDEX poll_discovery_no_deadline_idx
  ON poll(created_at_ms DESC, id DESC)
  WHERE discovery_state = 'listed'
    AND closed_at_ms IS NULL
    AND deadline_ms IS NULL;

CREATE INDEX poll_discovery_active_deadline_idx
  ON poll(deadline_ms, created_at_ms DESC, id DESC)
  WHERE discovery_state = 'listed'
    AND closed_at_ms IS NULL
    AND deadline_ms IS NOT NULL;

-- This singleton is cache-generation metadata, not a Poll domain fact and not
-- a second representation version. Existing databases begin at generation 1.
CREATE TABLE discovery_catalog_revision (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  revision INTEGER NOT NULL CHECK (revision >= 1)
);

INSERT INTO discovery_catalog_revision (singleton, revision) VALUES (1, 1);

CREATE TRIGGER discovery_catalog_revision_poll_insert
AFTER INSERT ON poll
BEGIN
  UPDATE discovery_catalog_revision
  SET revision = revision + 1
  WHERE singleton = 1;
END;

CREATE TRIGGER discovery_catalog_revision_poll_delete
AFTER DELETE ON poll
BEGIN
  UPDATE discovery_catalog_revision
  SET revision = revision + 1
  WHERE singleton = 1;
END;

CREATE TRIGGER discovery_catalog_revision_poll_update
AFTER UPDATE OF discovery_state, closed_at_ms, deadline_ms, question, poll_type
ON poll
WHEN OLD.discovery_state IS NOT NEW.discovery_state
  OR OLD.closed_at_ms IS NOT NEW.closed_at_ms
  OR OLD.deadline_ms IS NOT NEW.deadline_ms
  OR OLD.question IS NOT NEW.question
  OR OLD.poll_type IS NOT NEW.poll_type
BEGIN
  UPDATE discovery_catalog_revision
  SET revision = revision + 1
  WHERE singleton = 1;
END;
