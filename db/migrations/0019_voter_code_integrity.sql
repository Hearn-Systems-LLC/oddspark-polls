-- Forward-only integrity guards for Voter Code shape (Story 8.2 Slice A).
-- Codes must be exactly 8 characters from the 32-symbol alphabet
-- 23456789ABCDEFGHJKLMNPQRSTUVWXYZ. These triggers enforce the contract at
-- the D1 level so no application path can insert a malformed code.
-- Uses LENGTH + TRANSLATE-style checks compatible with D1's SQLite build.

CREATE TRIGGER voter_code_shape_insert_guard
BEFORE INSERT ON voter_code
WHEN NOT (
  LENGTH(NEW.code) = 8
  AND NEW.code = UPPER(NEW.code)
  AND REPLACE(REPLACE(REPLACE(REPLACE(NEW.code, '0', ''), '1', ''), 'I', ''), 'O', '') = NEW.code
  AND NEW.code NOT LIKE '%[^2-9A-HJ-NP-Z]%'
)
BEGIN
  SELECT RAISE(ABORT, 'voter_code_shape_invalid');
END;

CREATE TRIGGER voter_code_shape_update_guard
BEFORE UPDATE OF code ON voter_code
WHEN NOT (
  LENGTH(NEW.code) = 8
  AND NEW.code = UPPER(NEW.code)
  AND REPLACE(REPLACE(REPLACE(REPLACE(NEW.code, '0', ''), '1', ''), 'I', ''), 'O', '') = NEW.code
  AND NEW.code NOT LIKE '%[^2-9A-HJ-NP-Z]%'
)
BEGIN
  SELECT RAISE(ABORT, 'voter_code_shape_invalid');
END;
