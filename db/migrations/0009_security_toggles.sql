-- Expand the Poll schema for Story 2.1 Security Toggles (AD-14, AD-3).
-- Discrete columns, never a settings JSON blob. session_checks_enabled already
-- exists (0004, DEFAULT 1). The four new columns default off; a new Poll still
-- opens with Session Checks on because the create path sets every toggle
-- explicitly from the draft.
-- SQLite cannot alter a column default after ADD COLUMN, so every application
-- INSERT sets all five toggle fields explicitly rather than relying on defaults.
ALTER TABLE poll ADD COLUMN ip_checks_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE poll ADD COLUMN voter_codes_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE poll ADD COLUMN captcha_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE poll ADD COLUMN vpn_blocking_enabled INTEGER NOT NULL DEFAULT 0;
