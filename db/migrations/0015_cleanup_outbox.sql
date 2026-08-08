-- Story 6.3: self-contained R2 cleanup work. Rows deliberately carry no Poll
-- foreign key so they survive the same batch that hard-deletes the Poll and
-- all D1-owned children (AD-12, AD-19).

CREATE TABLE cleanup_outbox (
  id TEXT NOT NULL PRIMARY KEY,
  r2_key TEXT NOT NULL,
  enqueued_at_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX cleanup_outbox_enqueued_at_ms_idx
ON cleanup_outbox(enqueued_at_ms);
