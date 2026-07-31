-- Expand the Poll schema for Story 1.7 multi-select bounds (AD-14).
-- Existing rows remain single-select through the permanent flag default.
-- NULL bounds mean the effective defaults: minimum 1 and maximum all options.
-- SQLite cannot alter a column default after ADD COLUMN, so every application
-- INSERT sets all three fields explicitly rather than relying on these defaults.
ALTER TABLE poll ADD COLUMN multi_select_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE poll ADD COLUMN min_selections INTEGER;
ALTER TABLE poll ADD COLUMN max_selections INTEGER;
