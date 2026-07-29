-- Baseline migration for oddspark-polls.
-- Full domain schema lands in later stories; this establishes the forward-only pipeline.
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

INSERT INTO schema_meta (key, value, updated_at_ms)
VALUES ('baseline', '1.1', unixepoch() * 1000);
