-- Exactly one canonical reference per poll. `findPollForOwner` joins on
-- `is_canonical = 1` and relies on this uniqueness; the partial index enforces
-- it while leaving room for non-canonical references (Story 1.4 custom links).
CREATE UNIQUE INDEX poll_reference_canonical_idx
  ON poll_reference(poll_id)
  WHERE is_canonical = 1;
