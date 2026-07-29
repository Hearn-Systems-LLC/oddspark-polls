-- Case-insensitive user email uniqueness (defense in depth).
-- Better Auth 1.6.25 already lowercases provider emails on OAuth lookup and
-- create, so the application layer normalizes casing; this index guards the
-- invariant against any writer that bypasses it, without rebuilding the
-- table (rebuilds are fragile on D1 because PRAGMA foreign_keys is a no-op
-- inside a migration batch).
--
-- Pre-apply check: if any environment somehow holds case-variant duplicate
-- emails (e.g. 'Alice@x.com' + 'alice@x.com'), this index build fails —
-- deduplicate manually first. OAuth-created rows are always lowercase, so
-- this cannot happen through the application.

CREATE UNIQUE INDEX user_email_nocase_unique_idx ON user(email COLLATE NOCASE);
