-- Poll domain schema for Story 1.3 (multiple-choice creation).
-- Discrete columns, never a settings JSON blob (AD-3). Domain timestamps are
-- UTC Unix-millisecond INTEGER (the auth-table ISO-TEXT exception in 0002
-- does not extend here). Effective open/closed state is derived from
-- closed_at_ms/deadline_ms at read time (AD-11) — never stored.
-- discovery_state is a poll column initialized to 'unlisted' by CreatePoll;
-- all later listing transitions belong to Discovery-module commands (AD-5/AD-19).
-- Further Security Toggle columns arrive with Epic 2 via expand migrations;
-- multi-select columns arrive with Story 1.7.

CREATE TABLE poll (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL,
  poll_type TEXT NOT NULL,
  question TEXT NOT NULL,
  description TEXT,
  result_visibility TEXT NOT NULL,
  discovery_state TEXT NOT NULL DEFAULT 'unlisted',
  session_checks_enabled INTEGER NOT NULL DEFAULT 1,
  deadline_ms INTEGER,
  closed_at_ms INTEGER,
  representation_version INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES user(id)
);

CREATE INDEX poll_owner_user_id_idx ON poll(owner_user_id);

CREATE TABLE poll_option (
  id TEXT PRIMARY KEY NOT NULL,
  poll_id TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (poll_id) REFERENCES poll(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX poll_option_position_idx ON poll_option(poll_id, position);

-- References live in their own table so Story 1.4 can add a custom slug
-- alongside the generated one without a schema rewrite (AD-13).
CREATE TABLE poll_reference (
  reference TEXT PRIMARY KEY NOT NULL,
  poll_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  is_canonical INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (poll_id) REFERENCES poll(id) ON DELETE CASCADE
);

CREATE INDEX poll_reference_poll_id_idx ON poll_reference(poll_id);
