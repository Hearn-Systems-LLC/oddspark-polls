# Database recovery

## D1 Time Travel (recovery floor)

Cloudflare D1 Time Travel is the database recovery floor for oddspark-polls.

| Plan | Retention |
| --- | --- |
| Workers Free | 7 days |
| Workers Paid | 30 days |

Restore is point-in-time for the D1 database only. Use Wrangler:

```bash
# List bookmarks / inspect
wrangler d1 time-travel info DB --env production

# Restore to a timestamp (example)
wrangler d1 time-travel restore DB --env production --timestamp "2026-07-29T12:00:00Z"
```

See Cloudflare docs: [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

## Post-restore R2 reconciliation

Image objects live in R2 (`MEDIA` binding). D1 holds ownership / reference records for adopted media (schema lands with Epic 6).

After any D1 restore:

1. Treat D1 as the source of truth for which objects should exist.
2. List R2 keys under the poll/media prefixes.
3. Delete R2 objects that have no matching D1 ownership row (orphans).
4. Flag D1 rows whose R2 object is missing (broken references) for re-upload or cleanup.

Do **not** attempt to reconstruct R2 content from Time Travel — only D1 is restored. Reconcile object storage from ownership records after restore.

## Secrets

Worker secrets are environment-scoped (`wrangler secret put --env staging|production`). Local development uses `.dev.vars` (gitignored). Secrets are never stored in `wrangler.jsonc` or the git history.
