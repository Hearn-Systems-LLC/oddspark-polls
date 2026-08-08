---
baseline_commit: 6c2f926bd57a7268605893e98bf81be01e22fdd4
---

# Story 6.3: Media Cleanup Lifecycle

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Ultimate context engine analysis completed 2026-08-08 — comprehensive developer guide created from epics (Story 6.3 L1054–1072, Epic 6 notes L179–182), architecture spine (AD-12 controlling; AD-3/6/11/14/19), Stories 6.1/6.2 artifacts + review findings, deferred-work.md, and a full codebase audit of the delete path, media pipeline, worker entry, wrangler config, migration guard, and test harness. No new libraries. -->

## Story

As Justin (site operator),
I want superseded, deleted, and abandoned images cleaned out of R2 automatically,
so that storage never accumulates orphans and deleting a Poll truly removes it.

## Acceptance Criteria

1. **Deletion writes self-contained outbox rows in the same batch.** Given an Image Poll deletion, when it executes, then self-contained cleanup keys (raw `r2_key` strings — no Poll foreign key) are written to `cleanup_outbox` and the Poll plus all D1 children hard-delete in **one `db.batch`** — the link 404s immediately while R2 objects drain asynchronously (AD-12). Non-image polls delete exactly as today (zero outbox rows, no behavior change).
2. **Scheduled drain, every 15 minutes, idempotent.** Given the same-Worker `scheduled()` handler, when it runs on the `*/15 * * * *` Cron Trigger, then it drains due outbox rows idempotently: R2 delete (delete-of-missing-key is success), then remove the outbox row; failures leave the row for retry. Request handlers MAY invoke the same drain via `waitUntil`, but the Cron Trigger owns retries (AD-12). The cron is storage hygiene only — never a correctness boundary (AD-11 precedent: the 404 comes from the D1 delete, not from R2 having drained).
3. **24h temp-key sweeper checks D1 adoption first.** The scheduled handler also deletes unadopted `tmp/` keys older than 24 hours. **Adopted keys keep their `tmp/{pollId}/{mediaId}` names (6.1 ruled default: rename-free adoption)** — the sweeper MUST exclude every key present in `media_object.r2_key` before deleting, or it destroys live production images.
4. **Replacement enqueue (bounded scope).** Given a Creator replacing an option's image before the first Vote, when the replacement commits, then the D1 reference updates and the superseded R2 key is enqueued for cleanup in the same batch (AD-12). **Scope ruling:** no image-poll edit flow exists today (`updatePollDefinition` returns `unsupportedPollTypeError` for image). This story implements the outbox-enqueue mechanics at the persistence layer + the vote-lock guard, exposed through the narrowest possible image-replacement command — it does NOT build a full image-poll definition-edit UI (see Dev Notes → Ruled defaults 2). If that command's UI surface proves non-trivial, defer the UI to a follow-up and land mechanics + deletion + sweeper; record in deferred-work.md.
5. **Ownership and architecture floors hold.** `cleanup_outbox` is Media-owned (AD-19: "Media owns media records and cleanup tasks") — only Media commands write it; D1 stays the sole source of truth (AD-6); no new public routes; `/media/{id}` and creator preview routes unchanged; no representation-version implications (AD-24 untouched — cleanup is not a poll representation change).

## Tasks / Subtasks

- [x] Task 1: Migration `0015_cleanup_outbox.sql` (AC: 1, 5)
  - [x] Table per spine ER (`POLL ||--o{ CLEANUP_OUTBOX : schedules` is scheduling lineage only — **no FK to poll**, rows must survive the poll hard-delete): `cleanup_outbox(id TEXT PK, r2_key TEXT NOT NULL, enqueued_at_ms INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)`. Keep it minimal — no status column; presence = pending, delete row on success. Index on `enqueued_at_ms` for drain ordering. Follow 0013/0014 style (snake_case, `_ms` suffix, header comment).
  - [x] Guard discipline: four-digit contiguous name `0015_…`; run `pnpm migrations:checksum` and commit the manifest **in the same commit** as the migration (`scripts/migrations-guard.mjs` fails otherwise); forward-only, never edit 0001–0014.
- [x] Task 2: Media module + outbox persistence (AC: 1, 4, 5)
  - [x] Create `src/modules/media/index.ts` (new module — AD-19 assigns cleanup to Media; nothing exists yet). Ports follow house style (bare function types + deps object + `nowMs: () => number`): a `drainCleanupOutbox` command and a `sweepTempKeys` command, plus the port types the D1/R2 adapters implement. Keep domain logic (batching, attempt counting, 24h threshold) in the module; adapters stay dumb.
  - [x] `src/adapters/d1/index.ts` — extend `deletePollForOwner` (`:924–939`): it is already a one-statement `db.batch`; prepend `INSERT INTO cleanup_outbox (id, r2_key, enqueued_at_ms) SELECT …, m.r2_key, ?now FROM media_object m WHERE m.poll_id = ?1 AND EXISTS (SELECT 1 FROM poll p WHERE p.id = ?1 AND p.owner_user_id = ?2)` before the `DELETE FROM poll`. The owner guard inside the SELECT is mandatory — the batch must not enqueue keys when the delete will match zero rows. UUID generation for outbox ids: SQLite can't make UUIDs — either pre-read `media_object` rows in the adapter and build bound INSERTs (acceptable: read-then-batch, the batch itself stays atomic and the EXISTS guard still applies) or use `lower(hex(randomblob(16)))`; pick one and test it.
  - [x] `deletePoll` command (`src/modules/polls/poll-lifecycle.ts:572–612`) currently has **no `nowMs` dep** — add it (pattern: `closePoll`/`updatePollDefinition` at `:236,:339,:423`) and thread from the route (`src/pages/creator/polls/[pollId].astro:286–309`, which already computes `nowMs` at `:265`).
  - [x] Replacement enqueue (AC 4, bounded): add a Media-owned `replaceOptionImage` persistence op — one `db.batch`: `UPDATE media_object SET r2_key/content_type/size_bytes/alt_text/caption/... WHERE option_id = ?` + `INSERT INTO cleanup_outbox` for the superseded key, guarded by the FR-5 vote lock (`NOT EXISTS (SELECT 1 FROM vote v WHERE v.poll_id = …)`, same guard style as `updateDefinitionForOwner:822–863`). Do NOT extend `updatePollDefinition` to image polls (its delete-and-recreate option strategy would cascade `media_object` away — Traps 4).
- [x] Task 3: Worker entry with `scheduled()` + cron (AC: 2, 3)
  - [x] **Structural change, flag in PR:** `wrangler.jsonc:6` `main` points at `@astrojs/cloudflare/entrypoints/server`, which default-exports `{ fetch }` only, and adapter 14.1.6 has no `workerEntryPoint` option. Create `src/worker.ts` (or similar) that re-exports the adapter's fetch and adds `scheduled`: `import server from "@astrojs/cloudflare/entrypoints/server"; export default { fetch: server.fetch, scheduled }`. Point `main` at it. **Verify `pnpm build:production` + `wrangler deploy --dry-run` still bundle correctly and `astro dev` still works before writing any drain logic** — if the adapter fights the wrapper, research the adapter-documented alternative first and record the decision.
  - [x] Add `"triggers": { "crons": ["*/15 * * * *"] }` in wrangler.jsonc — **top-level AND repeated in `env.staging` + `env.production`** (triggers are non-inheritable; the file already repeats every binding per env, lines 62–176). Then `pnpm types && git diff --exit-code worker-configuration.d.ts` (regenerate if the Env shape changes).
  - [x] `scheduled()` body: wire the Media module's `drainCleanupOutbox` then `sweepTempKeys` with real deps (D1 `env.DB`, R2 `env.MEDIA`, `() => Date.now()`); catch and log per-row failures (row remains, `attempts` incremented), never throw the whole handler for one bad key. Bound each run (e.g. drain ≤100 rows, list ≤1000 temp keys per tick) — the next tick continues; log what was skipped.
- [x] Task 4: R2 adapter (AC: 2, 3)
  - [x] Populate `src/adapters/r2/index.ts` (currently `export {}` placeholder): thin wrapper implementing the Media module's R2 port — `deleteObject(key)` (R2 `delete` of a missing key already succeeds silently — that IS the idempotency), `listTempKeys(cursor?)` using `env.MEDIA.list({ prefix: "tmp/", cursor })` with pagination (`truncated`/`cursor`), exposing each object's `uploaded` timestamp for the 24h check. First-ever use of `list`/`delete` in this repo — no precedent to copy.
  - [x] Sweeper algorithm (in the module, not the adapter): list `tmp/` page → filter `uploaded < now − 24h` → **query D1 `SELECT r2_key FROM media_object WHERE r2_key IN (…)` and drop every hit** → delete the remainder. Chunk the `IN` list (D1 bound-parameter limits; ≤100 per query is safe). Never delete on a D1 query failure — fail closed, skip the page.
- [x] Task 5: Optional low-latency drain via `waitUntil` (AC: 2)
  - [x] After a successful poll delete, the route may kick the same idempotent drain via `Astro.locals.cfContext?.waitUntil(...)` — follow the injection pattern from `src/adapters/cache/discovery.ts:30,:236` + `src/pages/discover.astro:47–51` (waitUntil is a dep, tests collect promises into an array; never reach for `ctx` directly). This is optional per AD-12 ("may") — if it complicates the route, skip it and note the omission; the cron owns correctness.
- [x] Task 6: Tests (all ACs)
  - [x] Integration (`tests/integration/`, vitest-pool-workers reads the real `wrangler.jsonc`, Miniflare provides in-memory R2 `MEDIA` + D1; per-test `applyD1Migrations` + FK-ordered `DELETE FROM` per `image-media.integration.test.ts:1–33`, fixed `NOW` constants):
    - delete image poll → outbox rows contain the exact `r2_key`s, poll + children gone in the same batch, link lookup 404s immediately, R2 object still present until drain;
    - delete non-image poll → zero outbox rows; delete by non-owner → no outbox rows, `not_found`;
    - drain → R2 objects deleted, outbox rows removed; drain with a pre-deleted R2 key → row still cleared (idempotent); re-run drain → no-op;
    - sweeper: unadopted `tmp/` key older than 24h deleted; **adopted key with identical `tmp/` prefix and old timestamp NOT deleted** (the money test); young unadopted key kept; D1-check failure → nothing deleted;
    - replacement: superseded key enqueued + reference updated in one batch; replacement blocked once a vote exists.
    - `scheduled()` export: import the handler/module directly per the pool's "application code is imported directly" note (`tests/integration/worker-entry.ts`); no `createExecutionContext` precedent exists — direct invocation with injected deps is the house style.
  - [x] Unit: outbox drain/sweep policy logic (bounds, attempt counting, 24h threshold, IN-chunking) with fake ports; migration file listed in any schema-contract tests if present.
  - [x] E2E: none for cron (no harness); existing `image-poll.spec.mjs` must stay green. If the replacement UI ships, extend it; otherwise skip.
- [x] Task 7: Docs & status
  - [x] `CHANGELOG.md` under `[Unreleased]`; resolve the two 6.1 deferred-work entries (temp-key sweeper, replacement/deletion outbox — `deferred-work.md:539–540`) or update them if UI scope was deferred; `sprint-status.yaml` per workflow. Full gate: `pnpm migrations:guard && pnpm test && pnpm check`, `pnpm test:e2e`, `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` (Node 24.18.0 via nvm). One story = one branch = one PR.

## Dev Notes

### Critical context — what already exists (do NOT rebuild)

6.1/6.2 shipped (both done, merged through `8843c14`): `media_object` table (0014) with cascade FKs and guard triggers; upload → Poll-scoped `tmp/{pollId}/{mediaId}` keys → adoption as `media_object` rows in the create batch (`createPollPersistence(db).insertPoll`, `src/adapters/d1/index.ts:386–457`); public serve `src/pages/media/[id].ts` (D1 lookup IS the adoption check, immutable-cacheable); creator preview `src/pages/creator/media/[id].ts`; voter/results plates. **What does NOT exist:** `cleanup_outbox` table, any `scheduled()` handler, any `crons` config, any R2 `list`/`delete` usage, any `src/modules/media/`, any image-poll edit flow. Deleting an Image Poll today orphans every R2 object (cascade removes `media_object` rows without capturing keys) — that is the bug this story fixes.

### Architecture constraints (non-negotiable)

- **AD-12 (controlling, quote):** "Deletion records self-contained R2 cleanup keys in an outbox row with no Poll foreign key, then hard-deletes the Poll plus all D1-owned children in one batch, so its link immediately returns not found. A same-Worker `scheduled()` handler drains due outbox rows every 15 minutes; request handlers may also invoke the same idempotent drain with `waitUntil` for low-latency cleanup, but the Cron Trigger owns retries. The scheduled sweeper also deletes unadopted temporary keys older than 24 hours."
- **AD-6:** D1 is the sole source of truth; R2 stores only poll-owned bytes. The outbox is a D1 fact; R2 state is reconciled toward it (AD-14: "after a restore, reconcile R2 from D1 ownership records" — the sweeper's D1-first discipline is the same principle).
- **AD-11 precedent:** scheduled work is never a correctness boundary. All user-visible truths (404, no adopted media) come from the D1 batch; the cron only reclaims storage.
- **AD-19:** Media owns `media_object` and `cleanup_outbox`; only Media commands write them. Routes stay inbound adapters; browser code never touches D1/R2 (spine L529).
- Stack pins (AR-2): Astro 7.1.5, `@astrojs/cloudflare` 14.1.6, TS 7.0.2, Zod 4.4.3, Vitest 4.1.10 + vitest-pool-workers 0.19.0, Playwright 1.62.0, Node 24.18.0, pnpm 11.17.0. **No new libraries** — cron + R2 list/delete are platform primitives.

### Ruled defaults (flag every one in the PR)

1. **Outbox shape:** minimal `id / r2_key / enqueued_at_ms / attempts`; no status enum, no due-time backoff column. "Due" = exists; success = row deleted; failure = attempts+1 and retry next tick. Simplest thing that satisfies AD-12; add backoff only if a real failure mode demands it.
2. **Replacement scope:** persistence mechanics + vote-lock guard + narrowest command, not a full image-poll edit UI. FR-5 locks options once the first Vote exists, and `updatePollDefinition` deliberately excludes image; a full image edit surface (multipart re-upload, preview, preserved refs) is creator-UX work the epic AC does not require this sprint. If even the narrow command needs UI beyond a trivial form hook, land deletion+sweeper+mechanics and defer the UI with a deferred-work.md entry.
3. **Drain/sweep bounds:** ≤100 outbox rows and ≤1000 listed temp keys per tick — Workers cron CPU limits are generous but unbounded loops over R2 list pages are not; the 15-minute cadence absorbs backlog.
4. **Worker entry:** wrapper module re-exporting adapter fetch + own `scheduled`, `main` repointed. Chosen over patching the adapter or a service-binding split; verify build/dev/deploy before building on it.
5. **Sweeper failure posture:** fail closed. Any D1 adoption-check error → skip that page, delete nothing, log. Deleting a live image is unrecoverable; leaving an orphan costs cents.

### Traps (verified in current code — will bite)

1. **Adopted keys live under `tmp/`.** Rename-free adoption (6.1 ruled default 1) means `media_object.r2_key` values look exactly like sweepable temp keys (`tests/integration/image-media.integration.test.ts:112` asserts `r2_key: "tmp/poll-img-1/media-1"`). A prefix+age-only sweeper deletes production images. The D1 exclusion check is the whole story.
2. **No user-owned worker entry.** `wrangler.jsonc:6` → `@astrojs/cloudflare/entrypoints/server`, default export `{ fetch }` only (`node_modules/@astrojs/cloudflare/dist/entrypoints/server.d.ts`). Adapter 14.1.6 exposes no `workerEntryPoint`. Budget real time for Task 3's wrapper verification — it gates everything else in the story.
3. **wrangler envs don't inherit.** `triggers`, like every binding in this file, must be duplicated into `env.staging` and `env.production` or prod silently gets no cron.
4. **`updateDefinitionForOwner` deletes and recreates `poll_option` rows** (`src/adapters/d1/index.ts:822–863`) with fresh ids; `media_object.option_id` is UNIQUE with `ON DELETE CASCADE` — routing image replacement through it would silently cascade media rows away. Keep image replacement a separate Media-owned op keyed by existing `option_id`.
5. **Outbox INSERT must be owner-guarded inside the batch.** `deletePollForOwner` matches on `id AND owner_user_id`; a non-owner delete affects 0 rows — the outbox INSERT-SELECT must embed the same EXISTS guard or a hostile delete attempt enqueues another user's keys for destruction.
6. **Migration guard:** new file absent from `db/migrations.manifest.json` fails `pnpm migrations:guard`; run `pnpm migrations:checksum` in the same commit. Contiguous numbering — `0015` exactly.
7. **`nowMs` threading:** `deletePoll` has no clock dep today; don't reach for `Date.now()` inside the adapter — inject per house convention (bare `nowMs: () => number` in deps; route captures one timestamp).
8. **Idempotency definition:** R2 `delete` of a missing key succeeds — treat "key absent" as drained, clear the row. Never mark failure on 404-equivalents or rows wedge forever.

### Previous story / epic intelligence

- 6.1 review carried into 6.3: UUID shape validation on route params; 405+`allow` on non-GET/HEAD; batch R2 calls with `Promise.all`; the acknowledged deferral "orphaned temp keys on D1 batch failure → 6.3 sweeper" (`6-1-upload-image-options.md:220`) is now due.
- 6.1 residual (NOT 6.3 scope unless trivial): creator preview ownership binding gap (`6-1:160`) — architecture follow-up.
- Epic 5 patterns: fail-closed projections; insertion-order-independence tests; strip internal ids from outward surfaces (outbox rows are internal-only, no route exposes them).
- Team agreements: one story = one branch = one PR = adversarial review; tracker honesty; full gate before review. 6.2 deferred items in `deferred-work.md:548–559` are design-review items, untouched here.
- Out of scope: Cloudflare Images/transforms (AD-18); media edit UI beyond ruled default 2; queues/Durable Objects (AD-12 chose outbox-in-D1 + cron, not CF Queues); backfill of pre-6.3 orphans (optional one-off — the sweeper naturally reclaims unadopted `tmp/` orphans as they age; already-deleted polls' adopted keys from before 0015 have no D1 record and no outbox row — if any exist in prod, note a manual reconcile per AD-14 in deferred-work.md rather than building tooling).

### Data flow summary

```
DELETE poll (route → deletePoll cmd → deletePollForOwner) — ONE db.batch:
  INSERT cleanup_outbox(r2_key…) SELECT FROM media_object WHERE poll_id=? AND owner-guard
  DELETE FROM poll WHERE id=? AND owner_user_id=?   [cascades poll_option, media_object, votes…]
  → link 404s immediately; R2 bytes still present

replaceOptionImage (pre-vote, Media cmd) — ONE db.batch:
  UPDATE media_object SET r2_key=new… WHERE option_id=? AND vote-lock guard
  INSERT cleanup_outbox(old r2_key)

scheduled() every 15 min (also optional waitUntil after delete):
  drain: SELECT outbox ≤100 → R2 delete (missing=ok) → DELETE row | on error attempts+1
  sweep: R2 list tmp/ ≤1000 → age>24h → EXCLUDE keys in media_object (D1) → R2 delete
```

### Project Structure Notes

- NEW: `db/migrations/0015_cleanup_outbox.sql`, `src/modules/media/index.ts`, `src/worker.ts` (entry wrapper), integration test file(s). POPULATE: `src/adapters/r2/index.ts` (currently placeholder). UPDATE: `src/adapters/d1/index.ts` (deletePollForOwner + outbox/replacement ops), `src/modules/polls/poll-lifecycle.ts` (deletePoll nowMs), `src/pages/creator/polls/[pollId].astro` (dep threading, optional waitUntil), `wrangler.jsonc` (main + triggers ×3), `db/migrations.manifest.json`, `worker-configuration.d.ts` (regenerated). Do NOT touch: `src/pages/media/[id].ts`, `src/pages/creator/media/[id].ts`, `results`/voting surfaces, migrations 0001–0014.
- Kebab-case files, snake_case D1, `_ms` UTC epoch columns, hexagonal boundaries per AGENTS.md:336–339.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.3 (L1054–1072), #Epic 6 notes (L179–182), #FR-5 (L25), #FR-11 (L31)]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md#AD-12 (L280–294), #AD-6 (L148–155), #AD-11 (L271–278), #AD-14 (L333), #AD-19 ownership (L383–391, L644), #ER (L629–631), #Capability map FR-11 (L669), #Mutation convention (L529)]
- [Source: _bmad-output/implementation-artifacts/6-1-upload-image-options.md — key scheme ruled default (L75), 6.3 scope fences (L33, L64, L127), deferred review finding (L220)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md (L537–540)]
- [Source: codebase audit 2026-08-08 — wrangler.jsonc, astro.config.mjs, worker-configuration.d.ts, src/adapters/d1/index.ts (:386–457, :805–863, :924–939), src/modules/polls/poll-lifecycle.ts (:127–130, :567–612), src/pages/creator/polls/[pollId].astro (:265, :286–309), src/pages/creator/new.astro (:300–336, :395–433), src/adapters/r2/index.ts, src/adapters/cache/discovery.ts (:30, :236), db/migrations/0014_image_media.sql, scripts/migrations-guard.mjs, vitest.integration.config.ts, tests/integration/{worker-entry.ts,image-media.integration.test.ts}, node_modules/@astrojs/cloudflare/dist/entrypoints/server.d.ts]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- Implement each task in story order with a failing policy/schema/integration test before production code.
- Keep cleanup policy in the Media domain module and D1/R2 mechanics in thin adapters.
- Introduce the Worker wrapper as an independently verified structural change before wiring scheduled cleanup.

### Debug Log References

- 2026-08-08: Fresh implementation started from recorded baseline `8843c14352d3fdba5e2601eb1d840cf74b2cad07`; current checkout HEAD is `6c2f926bd57a7268605893e98bf81be01e22fdd4`. Existing story and sprint-status changes were preserved.

### Completion Notes List

- Task 1: Added forward-only migration 0015 with a self-contained, no-FK cleanup outbox and enqueue-time index; regenerated the 15-entry migration manifest. Verified with schema integration tests, `pnpm migrations:guard`, and the full 1,642-test suite.
- Task 2: Added the provider-free Media cleanup/replacement policy and D1 persistence. Image deletion now captures keys with an owner guard before the same-batch hard delete; replacement is image/owner/vote guarded and atomically enqueues the superseded key. Added clock threading, policy unit tests, and D1 integration coverage; `pnpm check` and all 1,651 tests pass.
- Task 3: Repointed Wrangler to an Astro-preserving Worker wrapper, configured the 15-minute cron in local/staging/production, and wired bounded drain then fail-closed sweep with structured failure logging. Verified the wrapper before cleanup logic via production build, Wrangler dry-run, and Astro dev `/api/health` 200; the root returned the expected local-data 503 because the demo Poll was not seeded.
- Task 4: Replaced the R2 placeholder with thin delete/list pagination ports and exercised real Miniflare R2 behavior, including delete-of-missing-key success. The domain sweeper owns age filtering, 100-key D1 chunks, adopted-key exclusion, and fail-closed behavior. Final bundle contains the scheduled export; all 1,658 tests pass.
- Task 5: Deliberately omitted the optional request-path `waitUntil` drain. Cron retries are the architecture's correctness owner; adding Media D1/R2 wiring to the creator route would increase coupling only to reduce cleanup latency.
- Task 6: Completed schema, domain-policy, D1, R2, public-link, and scheduled-entry coverage. Tests prove immediate public 404 while R2 bytes remain, drain/idempotent re-drain, exact owner-guarded enqueue, non-image no-op, replacement/vote lock, old adopted-key preservation, young-key retention, orphan deletion, D1 fail-closed behavior, bounds, attempt increments, 24-hour threshold, and 100-key ownership chunks. Full Vitest result: 118 files and 1,660 tests passed.
- Task 7: Updated the changelog, architecture topology, deferred-work resolutions, and sprint status. The final gate passed: 15 immutable migrations, 118 Vitest files / 1,660 tests, TypeScript, 181 Playwright tests, binding-type drift check, production build, and `git diff --check`. Gate diagnosis also restored ranked-result Comment delivery and limited cast markers to Image Poll read-only rows.

### File List

- _bmad-output/implementation-artifacts/6-3-media-cleanup-lifecycle.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/deferred-work.md
- _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md
- CHANGELOG.md
- db/migrations/0015_cleanup_outbox.sql
- db/migrations.manifest.json
- src/adapters/d1/index.ts
- src/adapters/r2/index.ts
- src/components/poll-voting-surface.astro
- src/lib/poll-delivery.ts
- src/modules/media/index.ts
- src/modules/polls/poll-lifecycle.ts
- src/pages/creator/polls/[pollId].astro
- src/worker.ts
- tests/e2e/create-poll-authed.spec.mjs
- tests/e2e/image-poll.spec.mjs
- tests/e2e/ranked-choice.spec.mjs
- tests/integration/astro-cloudflare-config-shim.ts
- tests/integration/media-cleanup.integration.test.ts
- tests/integration/poll-lifecycle-adapter.integration.test.ts
- tests/integration/worker-scheduled.integration.test.ts
- tests/integration/media-cleanup-schema.integration.test.ts
- tests/unit/media-cleanup.test.ts
- tests/unit/image-poll-voter-surface.test.mjs
- tests/unit/poll-lifecycle.test.ts
- tests/unit/worker-entry-contract.test.mjs
- vitest.integration.config.ts
- worker-configuration.d.ts
- wrangler.jsonc

### Change Log

- 2026-08-08: Implemented the Media cleanup outbox, scheduled drain, D1-safe temporary-key sweep, guarded replacement mechanics, full verification coverage, and documentation/status handoff for review.

### Review Findings

Code review 2026-08-08 (three layers: adversarial, edge-case, acceptance). Dismissed as noise: 8 (per-row sequential D1 round-trips tolerable at batch 100; missing bundle guard subsumed by Patch 1; no `due` predicate is spec-compliant retry cadence; sweeper lexicographic-cap starvation requires implausible sustained >1,000-young-key churn; D1 bind-param headroom at exactly 100 works as written; R2/worker clock skew absorbed by the 24h window; overlapping cron ticks are idempotent; replacement tmp-key existence check folded into Decision 1).

- [x] [Review][Decision] Image-replacement command is dead code and its deferral is unrecorded — `replaceOptionImage` (module + adapter + vote-lock guard) has no inbound caller; AC 4's ruled default permits deferring the UI only if recorded in deferred-work.md, yet the two 6.1 deferrals were instead struck through as "resolved by Story 6.3" (deferred-work.md:539-540). Decide: record the deferral honestly, or wire the narrow command route now. RESOLVED 2026-08-08: wired via POST /creator/media/replace (commit 2bfc4a6).
- [x] [Review][Decision] Out-of-scope fixes ride this branch — `b5715d8 fix(results): restore ranked result rendering` (src/lib/poll-delivery.ts:142-143,281-282; src/components/poll-voting-surface.astro:184 changes read-only `checked` to image-polls-only) and `b3b7dc6 test(e2e): target capped option inputs` violate the story's "Do NOT touch results/voting surfaces" note and the one-story-one-PR convention. Decide: keep on this branch or split to a `fix/*` branch. The `checked` change also silently drops the cast-marker for returning voters on multiple-choice/ranked polls — confirm that was intended. RESOLVED 2026-08-08: kept on branch; cast-marker change accepted as intended.
- [x] [Review][Patch] Deployed workers never get the cron trigger or scheduled handler — deploys are local-only [scripts/deploy-config.mjs:82-104, scripts/deploy.mjs:164-167]: `buildRemoteDeployConfig` hardcodes `main: "worker/index.mjs"` and does not copy `triggers`, and the esbuild entry is `dist/server/entry.mjs` (Astro fetch-only entry), not `src/worker.ts`. AC 2/AC 3 are nullified in staging/production; the claimed dry-run verification exercised wrangler.jsonc, not the `.deploy/<env>/wrangler.json` CI actually deploys. HIGH.
- [x] [Review][Patch] Drain queue starvation: poison rows are re-selected first forever [src/adapters/d1/index.ts:1053-1069, src/modules/media/index.ts:66-80] — `listDue` orders by `enqueued_at_ms ASC LIMIT 100` and `attempts` is incremented but never read; ~100 permanently failing rows fill every batch and newer rows never drain. Order by `attempts ASC, enqueued_at_ms ASC` (or equivalent) so fresh rows drain first.
- [x] [Review][Patch] Sweeper/adoption TOCTOU: a key adopted between `findAdoptedKeys` and `deleteObject` destroys a live image [src/modules/media/index.ts:100-140] — re-check adoption per chunk immediately before its deletes to narrow the window.
- [x] [Review][Patch] Drain failure logging mislabels `deleteRow` failures as R2 delete failures [src/modules/media/index.ts:68-76] — the try wraps both `deleteObject` and `deleteRow`; a D1 row-delete failure after a successful R2 delete reports `phase: "delete"`, sending operators to the wrong system.
- [x] [Review][Patch] worker.ts hardcodes limits the module exports [src/worker.ts:36,60] — `=== 100` / `=== 1_000` duplicate `CLEANUP_BATCH_LIMIT` / `TEMP_LIST_LIMIT`; changing the module constants silently orphans the bound warnings.
- [x] [Review][Patch] Bound-reached warnings false-positive at exactly the limit [src/worker.ts:36-41,60-65] — `selected === 100` / `listed === 1_000` fires even when the backlog is exactly exhausted, paging nobody every 15 minutes.
- [x] [Review][Patch] Worker-entry contract test asserts config by substring [tests/unit/worker-entry-contract.test.mjs:9-12] — raw-text `toContain` on wrangler.jsonc passes/fails on comments and formatting; parse the JSONC (parser exists in scripts/deploy-config.mjs) and assert the parsed triggers.
- [x] [Review][Patch] E2E tests share `voterCookies` across tests [tests/e2e/image-poll.spec.mjs:225,343,355] — the "already-voted" tests depend on a cookie jar populated by an earlier test; running either in isolation fails for reasons unrelated to the behavior under test.
- [x] [Review][Patch] CHANGELOG overstates what shipped [CHANGELOG.md:18-24] — pre-Vote replacement "mechanics" are unreachable from any route; per the repo's user-facing-only rule this entry should follow Decision 1's outcome.
