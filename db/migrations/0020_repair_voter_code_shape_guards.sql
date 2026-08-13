-- Repair Story 8.2's voter-code alphabet checks using SQLite GLOB syntax.
-- Migration 0019 is immutable; replace only its two trigger definitions.

DROP TRIGGER IF EXISTS voter_code_shape_insert_guard;
DROP TRIGGER IF EXISTS voter_code_shape_update_guard;

CREATE TRIGGER voter_code_shape_insert_guard
BEFORE INSERT ON voter_code
WHEN NOT (
  LENGTH(NEW.code) = 8
  AND NEW.code = UPPER(NEW.code)
  AND NEW.code NOT GLOB '*[^2-9A-HJ-NP-Z]*'
)
BEGIN
  SELECT RAISE(ABORT, 'voter_code_shape_invalid');
END;

CREATE TRIGGER voter_code_shape_update_guard
BEFORE UPDATE OF code ON voter_code
WHEN NOT (
  LENGTH(NEW.code) = 8
  AND NEW.code = UPPER(NEW.code)
  AND NEW.code NOT GLOB '*[^2-9A-HJ-NP-Z]*'
)
BEGIN
  SELECT RAISE(ABORT, 'voter_code_shape_invalid');
END;
