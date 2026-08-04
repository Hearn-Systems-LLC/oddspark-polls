# Administration

Oddspark Polls has one narrowly scoped `administrator` role for public-Discovery
moderation. It grants access to the fixed moderation desk; it does not grant
Poll ownership, voting privileges, or a general user-management surface.

Role assignment is deliberately out of band. Use the Better Auth `user.id`
stored in D1 as the only assignment key. An email address, OAuth provider name,
provider account ID, display name, or Poll owner ID is not an authorization key.
Never put a real internal user ID in source, Git history, chat, CI output, or a
command argument.

## Environment inventory

Open the D1 console for the environment you intend to change. Each environment
is independent; a role change in one does not propagate to another.

| Environment | D1 database |
| --- | --- |
| Local | `oddspark-polls-local` |
| Staging | `oddspark-polls-staging` |
| Production | `oddspark-polls` |

Use the Cloudflare dashboard D1 console for staging and production. For local
rehearsal, use the local D1 console or a local Wrangler D1 session. Do not place
the internal ID in a shell command: enter the SQL interactively after the
console is open.

## Assign the first Administrator

1. In the trusted D1 console, identify the intended Better Auth `user` row and
   copy only its opaque `id` into the placeholder below.
2. Verify the target and the current singleton role state before writing:

   ```sql
   SELECT id, role FROM user WHERE id = '<INTERNAL_USER_ID>';
   SELECT id, role FROM user WHERE role = 'administrator';
   ```

   The first query must return exactly one `creator` row. The second must return
   zero rows. Stop if either result differs.
3. Assign the role with a guarded write:

   ```sql
   UPDATE user
   SET role = 'administrator'
   WHERE id = '<INTERNAL_USER_ID>' AND role = 'creator';
   ```

   The console must report exactly one changed row.
4. Repeat both verification queries. They must each return exactly one row, and
   both must show the same opaque `id` with role `administrator`.
5. Sign out and sign back in before using the moderation desk so the session is
   re-read from the current user record.

Repeat the complete procedure separately for local, staging, and production as
needed. Never infer that matching OAuth accounts make the environment roles
equivalent.

## Transfer or revoke the role

The D1 dashboard console commits each submitted write independently. Do not use
`BEGIN TRANSACTION`, `COMMIT`, or `ROLLBACK` across separate console executions:
they do not make this operator procedure atomic. A transfer therefore includes
a deliberate short interval with no Administrator. Keep the console open,
prepare both opaque internal IDs before the first write, and complete the
verification and assignment without unrelated changes in between.

First verify the current Administrator and the new target separately:

```sql
SELECT id, role FROM user WHERE id = '<CURRENT_INTERNAL_USER_ID>';
SELECT id, role FROM user WHERE id = '<NEW_INTERNAL_USER_ID>';
SELECT id, role FROM user WHERE role = 'administrator';
```

The first and third queries must identify the same single Administrator row,
and the second must identify exactly one different `creator` row. Stop if they
do not. Then revoke only the verified current Administrator with one guarded,
independently committed write:

```sql
UPDATE user
SET role = 'creator'
WHERE id = '<CURRENT_INTERNAL_USER_ID>' AND role = 'administrator';
```

The console must report exactly one changed row. Verify the deliberate
unassigned interval before continuing:

```sql
SELECT id, role FROM user WHERE id = '<CURRENT_INTERNAL_USER_ID>';
SELECT id, role FROM user WHERE role = 'administrator';
```

The first query must now return one `creator` row and the second must return
zero rows. Assign the previously verified new target with a guarded write:

```sql
UPDATE user
SET role = 'administrator'
WHERE id = '<NEW_INTERNAL_USER_ID>'
  AND role = 'creator'
  AND NOT EXISTS (
    SELECT 1 FROM user WHERE role = 'administrator'
  );
```

The console must report exactly one changed row. Then verify:

```sql
SELECT id, role FROM user WHERE id = '<NEW_INTERNAL_USER_ID>';
SELECT id, role FROM user WHERE role = 'administrator';
```

Both queries must return the same single new Administrator row. If assignment
reports zero changed rows or either verification differs, stop. If no
Administrator exists, restore the prior verified internal ID immediately:

```sql
UPDATE user
SET role = 'administrator'
WHERE id = '<CURRENT_INTERNAL_USER_ID>'
  AND role = 'creator'
  AND NOT EXISTS (
    SELECT 1 FROM user WHERE role = 'administrator'
  );
```

That recovery write must report exactly one changed row. Re-run the current-ID
and singleton verification queries and confirm they identify the restored prior
Administrator. If an Administrator exists unexpectedly, or the restore changes
anything other than exactly one row, make no further role writes and follow the
recovery procedure below. The unique partial index prevents two Administrator
rows but cannot choose the correct human for you.

To revoke without replacing, first verify that the current Administrator query
returns exactly one expected row, then run the same current-ID-guarded revoke
by itself. Confirm that it changed exactly one row and that
`SELECT id, role FROM user WHERE role = 'administrator';` returns zero rows.

## Recovery

If the role is accidentally left unassigned, repeat **Assign the first
Administrator** in the affected environment. If it is assigned to the wrong
row, use the guarded transfer sequence. If the row counts, schema, or identity are
uncertain, stop: take a D1 Time Travel bookmark and follow
[the recovery runbook](recovery.md) before another write. Never bypass the
unique index, change a role to an undocumented value, or edit a committed
migration to repair production data.
