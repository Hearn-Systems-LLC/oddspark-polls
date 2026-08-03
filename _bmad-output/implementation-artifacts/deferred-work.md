# Deferred Work

## Deferred from: code review of 2-4-trust-badge (2026-08-03)

- **SQL injection vector in E2E `seedPoll`** — template-literal SQL with `reference` parameter used across all E2E specs; all callers pass UUID-prefixed literals in practice, but the utility is copy-pasteable. Deferred, pre-existing pattern.
- **Walker test fragility** — source-code string scanning assertions (`not.toContain("background")`, hex regex) in `tests/unit/trust-badge.test.mjs` break on unrelated refactors. Deferred, pre-existing pattern from `live-indicator.test.mjs`.
- **E2E `afterAll` cleanup silently leaks on failure** — `for`-loop over `seededUserIds` calls `cleanupCreator` without try/catch; one failure skips remaining IDs. Deferred, pre-existing pattern in every E2E spec.

## Deferred from: code review of 1-9-live-updating-results (2026-08-02)

- **Multi-select summary never pluralizes** — `1 VOTERS · 1 SELECTIONS` renders verbatim for singular counts on both the SSR summary and the live poller patch path. Deferred, pre-existing: the SSR line shipped in Story 1.8 and the 1.9 poller deliberately mirrors it so the reconciliation diff-check stays in sync; fixing one side without the other breaks that check [src/components/results-tally.astro:77, src/scripts/results-live.ts:323].

## Deferred from: implementation of 1-9-live-updating-results (2026-08-02)

- Visible open Tallies now add one Results-envelope read every three seconds and, after the first response, a cheap `representation_version` read on unchanged snapshots. This multiplies the per-viewer D1 read volume already accepted for public Poll traffic; conditional 304s, visible-only polling, pause/abort on hide, and capped failure backoff are the current cost controls. Shared caching remains deliberately out of scope because entitled Results must never cross authorization boundaries [src/scripts/results-live.ts, src/pages/[reference]/results/live.ts, src/adapters/d1/index.ts].

## Deferred from: code review of 1-8-results-view-with-visibility-settings (2026-08-02)

- **Transient option-label editing can silently clamp multi-select bounds** — with three nonblank options and a maximum of three, clearing one label while replacing its text briefly reduces `nonBlankRows()` to two and immediately clamps the maximum to two; restoring the label does not restore the bound. Deferred, pre-existing on the actual Story 1.8 branch-cut baseline; fix by clamping only on explicit row removal or after a stable count change [src/scripts/create-poll-form.ts:103-120,210-214].

## Deferred from: code review of 1-7-multi-select-voting (2026-07-31)

- ~~**Bounds lock after first Vote (AD-17 handoff to Story 1.12)**~~ — **Resolved in Story 1.12.** Definition (question, options, multi-select bounds, type) is editable only with zero accepted Votes; D1 mutation batch re-enforces the no-Vote guard; after the first Vote the detail surface renders the exact lock line and description remains editable.

## Deferred from: code review of 1-1-project-foundation-deployable-skeleton (2026-07-29)

- Playwright e2e not in CI gate — spec gate requires unit+integration only; add when the e2e suite grows.
- ~~Overlay primitive never demonstrated (rendered `open={false}`)~~ — **Resolved in Story 1.12.** The shared overlay now has a real Poll-delete consumer with enhanced and no-JavaScript open/Cancel/confirm paths plus browser-level focus, dismissal, scroll, and hostile-copy proof [src/components/overlay.astro, src/scripts/overlay.ts, tests/e2e/creator-poll-lifecycle.spec.mjs].
- Mode-toggle label goes stale on OS theme change — no `matchMedia("prefers-color-scheme")` change listener [src/scripts/mode-override.ts:52-69].
- `…Light` exception tokens `availability-yes-glyph-light` / `solar-ink-on-wash-light` defined but unconsumed — canonical DESIGN.md tokens consumed by Epic 7 availability-cell [src/styles/tokens.css:41,48-50].
- Structural Seed deviation — `src/lib/`, `src/layouts/`, `src/styles/` not in the seed tree; update ARCHITECTURE-SPINE seed to match the real layout.

## Deferred from: code review round 2 of 1-1-project-foundation-deployable-skeleton (2026-07-29)

- **Story 1.2 WIP scope** (found in the working tree during re-review; belongs to the active 1.2 session): telemetry middleware is innermost, so creator-guard 303s and session-middleware throws emit no record and carry no `x-request-id`; session middleware has no auth-lookup failure path and drops rotated session cookies on error responses; possible duplicate `set-cookie` on `/api/auth/*` responses; `/admin` counts as a CSRF authenticated-mutation surface but is not covered by the creator guard; `readRequestCsrfToken` buffers entire multipart bodies to read one field; session CSRF token compared with `!==` (non-constant-time) [src/middleware.ts, src/lib/csrf.ts].
- `.astro` files have no type coverage — `check` runs `tsc --noEmit`, which skips `.astro`; restore `astro check` when `@astrojs/check` supports the pinned TS 7 stack.
- `parseJsonc` doesn't handle block comments or BOM — wrangler's own JSONC parser accepts `/* */`; a future block comment in `wrangler.jsonc` fails with an opaque error [scripts/deploy.mjs].

## Deferred from: code review of 1-2-creator-sign-in-with-google-or-github (2026-07-29)

- `.astro` files have no static type coverage — `check` runs `tsc --noEmit`, which skips `.astro`; restore `astro check` when `@astrojs/check` supports the pinned TS stack [package.json:22].
- Rate limiting effectively absent on auth endpoints — Better Auth limiter defaults to per-isolate memory storage, enablement derived from `NODE_ENV` (undefined in the esbuild deploy bundle); SESSION KV not wired as `secondaryStorage`. Not bound to Story 1.2 by the spine's capability map [src/pages/api/sign-in.ts, src/adapters/auth/index.ts].
- Duplicate `createAuth()` instantiation and a D1 `getSession` lookup on every cookie-bearing request including `/api/auth/*` — auth-handler traffic performs the session lookup twice; perf/cost tuning for later stories [src/middleware.ts:115, src/pages/api/auth/[...all].ts:8].
- CSRF body transport only readable for `application/x-www-form-urlencoded` and `multipart/form-data` — a no-JS `text/plain` form carrying a valid token is rejected `csrf_token_mismatch`; no current consumers [src/lib/csrf.ts:200-206].
- Provisioning `.dev.vars` parser accepts values the runtime rejects: inline `#` comments pass the non-empty gate, `read -r -s` strips leading/trailing whitespace from pasted secrets, and `BETTER_AUTH_URL` format is not validated at provisioning time [scripts/provision-auth-secrets.zsh:66-91].
- Remote provisioning can hang indefinitely on wrangler's browser OAuth login — no timeout, TTY check, or auth preflight before `wrangler secret bulk` [scripts/provision-auth-secrets.zsh:149,196].

## Deferred from: code review of 1-3-create-a-multiple-choice-poll (2026-07-29)

- Public poll page does a per-request D1 read with no caching decision — every bot scan and link preview of `/{anything}` hits `findPollByReference`; the page sets no `cache-control` (AD-21 governs creator surfaces only). Deferred: caching the public surface is a product/perf decision outside Story 1.3's ACs [src/pages/[reference].astro].

## Deferred from: code review round 2 of 1-3-create-a-multiple-choice-poll (2026-07-29)

- Owner can get "This Poll doesn't exist" on their own poll if it has zero canonical `poll_reference` rows — the 0005 partial unique index enforces at-most-one canonical, not exactly-one; `findPollForOwner`'s inner join then yields null → 404. Deferred: latent corrupt-state handling, relevant when Story 1.4 starts writing custom references [src/adapters/d1/index.ts:123-132].

## Deferred from: code review round 3 of 1-3-create-a-multiple-choice-poll (2026-07-29)

- `poll_reference.is_canonical INTEGER NOT NULL DEFAULT 1` is the wrong default for a multi-reference table — a Story 1.4 custom-link insert that omits `is_canonical` defaults to 1 and explodes on the 0005 partial unique index. Deferred: SQLite can't ALTER a column default (needs a table rebuild); Story 1.4 must set `is_canonical` explicitly on every insert — call this out in its story spec [db/migrations/0004_polls.sql:43-50].

## Deferred from: code review round 4 of 1-3-create-a-multiple-choice-poll (2026-07-29)

- Every creator POST pays a double full-body parse — `readRequestCsrfToken` parses a cloned body in middleware and the page parses again; a large crafted multipart is fully materialized twice with no size cap anywhere in the chain. Deferred: request-size policy is a platform decision above this story (the mechanism predates 1.3; `/creator/new` is just the first route to exercise it) [src/lib/csrf.ts:194-213, src/pages/creator/new.astro].

## Deferred from: code review round 6 of 1-3-create-a-multiple-choice-poll (2026-07-30)

- The reachable sign-in redirect has no `cache-control` — `creatorGuardMiddleware` 303s every unauthenticated `/creator/*` request bare; the page-level defense-in-depth redirects patched in review round 5 are dead code by comparison. Deferred: pre-existing middleware behavior from Story 1.2; fix belongs to the middleware layer, not this story's diff [src/middleware.ts:237-242].
- ~~The 10s idle-restore can re-enable PUBLISH while a legitimately slow POST is still in flight~~ — **Resolved in Story 1.12.** The shared definition-form enhancer no longer uses an unconditional timer and restores controls only when a document is actually recovered from the back-forward cache [src/scripts/poll-definition-form.ts].

## Deferred from: code review round 2 of 1-2-creator-sign-in-with-google-or-github (2026-07-29)

- Signed-in users are bounced to `/sign-in` during transient D1 errors, indistinguishable from being signed out — retrying OAuth then returns 502 until D1 recovers. Accepted degradation of the session-lookup failure path; a distinct "transient error" outcome would need new UX copy [src/middleware.ts].
- Session-lookup failure during a sign-out POST that later succeeds leaves the `oddspark.creator_session_seen` marker stale — a later anonymous `/creator` visit can show a spurious "You've been signed out". Self-heals on the next authenticated response [src/middleware.ts].
- GitHub `/user/emails` outage during sign-in stores `email_verified=false`; the `requireLocalEmailVerified` gate then blocks a later same-email Google sign-in from linking, landing on the misleading denial — narrow residual of the account-linking patch [src/adapters/auth/index.ts].
- No gate verifies migration 0003 (`user_email_nocase_unique_idx`) is applied to staging/production D1 before the code deploys; the failure mode is latent because the index is preventive [db/migrations/0003_user_email_case_insensitive.sql, scripts/deploy.mjs].

## Deferred from: code review of 1-4-custom-links (2026-07-30)

- Taken-collision detection substring-matches D1 driver error text (`/UNIQUE constraint failed: poll_reference\.reference/`) — if remote D1 ever phrases batch constraint errors differently, a taken Custom Link degrades from the designed 422 field error to a generic 500. Deferred: D1 exposes no structured error code, message text is the only signal; same accepted pattern as `DuplicatePollIdError` from Story 1.3 [src/adapters/d1/index.ts:131-138].
- `poll_reference.kind` has no CHECK constraint and `canonicalReferenceKind` is an unchecked cast — an out-of-union value (manual SQL, future writer, botched migration) makes `matchesExistingPoll` classify every idempotent retry of that poll as divergent, silently turning retries into "That Poll already published" errors. Deferred: schema shipped in Story 1.3; Story 1.4's no-new-migration constraint forbids the fix here [db/migrations/0004_polls.sql, src/adapters/d1/index.ts:166-170].
- Migration 0004's comment permanently describes the superseded "add a custom slug alongside the generated one" design — the shipped design is substitution (custom slug is the only reference row). Deferred: migrations are immutable by policy (AD-14); the supersession is recorded in Story 1.4's decisions table instead [db/migrations/0004_polls.sql:40-41].

## Deferred from: code review round 2 of 1-4-custom-links (2026-07-30)

- A case-mangled *generated* reference whose lowercase fold collides with a registered custom slug redirects to the wrong poll instead of 404ing. Deferred: inherent to the ratified case-insensitive custom-link design; collision needs a 128-bit random fold to equal a chosen slug (~2⁻⁷⁷ per pair), and the all-lowercase short-circuit plus canonical guards bound the reachable surface [src/pages/[reference].astro, src/adapters/d1/index.ts].
- Canonical-resolution composition (exact lookup → case-folded fallback → 301) lives in the `[reference].astro` frontmatter — arguably FR-28 domain policy inside an inbound adapter (AD-1). Deferred: the composition is two adapter calls and a branch; the case-fold rule itself is encoded in the port method and its test; extracting a domain function would add a port for one conditional [src/pages/[reference].astro].
- CI retry converts a partial e2e failure into a guaranteed one — a retry after the 303 publish re-submits the same slug and dies on "taken" because `cleanupCreator` runs in `afterAll`, not `afterEach`. Deferred, pre-existing: harness design predates this round and applies to the whole authed file [tests/e2e/create-poll-authed.spec.mjs, tests/e2e/creator-session.mjs].
- The 301/404 case-variant contract is covered only by the authed e2e, which `test.skip`s when `BETTER_AUTH_SECRET` isn't provisioned locally. Deferred: the deploy gate provisions the secret, so CI coverage is unconditional; a signed-out seed-based test is a nice-to-have [tests/e2e/create-poll-authed.spec.mjs].

## Deferred from: code review round 3 of 1-4-custom-links (2026-07-30)

- A mixed-case request to an orphan reference row (poll deleted out-of-band, bypassing the FK cascade) 301s into a 404 instead of 404ing directly — the exact lookup misses and no reachability re-check runs before the 301. Deferred: corrupt-state-only reachability (D1 enforces the cascade), the redirect chain terminates at the designed 404, and a reachability re-check would tax every legitimate case-variant hit [src/pages/[reference].astro].

## Deferred from: code review of 1-5-cast-a-vote-that-counts-exactly-once (2026-07-31)

- ~~Any FK failure in the vote batch maps to `PollGoneError` ("This Poll no longer exists")~~ — **Resolved in Story 1.12 for the now-reachable option-edit race.** After an FK failure the adapter re-reads Poll and selected-option reachability: a missing Poll keeps the ordinary 404, missing replaced options map to `poll_definition_changed`, and unrelated malformed-state failures remain generic [src/adapters/d1/index.ts, src/modules/voting/index.ts].
- POST to a case-variant custom slug receives a bare 301 that browsers rewrite to GET, silently discarding the ballot. Deferred, pre-existing: the redirect predates this story (1.4) and is effectively unreachable in browser flow — the vote form is only ever served at the canonical reference, so only scripted POSTs hit it [src/pages/[reference].astro:70-91].
- The `extension:*` vote-contribution seam is a domain-only contract: `castVote` accepts `deps.contributors`, but the D1 adapter throws `Unsupported vote contribution kind` on any extension contribution, and the unit test proves the seam only against a mock. Deferred (Justin, 2026-07-31): adapter rendering is owned by the first real consumer — Story 4.1 (comment port) or Epic 8 (code-redemption slot); until then the seam must not be wired in production deps [src/modules/voting/index.ts:331-345, src/adapters/d1/index.ts:259].
- Rotating `VOTE_DIGEST_SECRET` silently resets exactly-once protection: claims key on `HMAC(secret, pollId, checkKind, token)`, so post-rotation every prior voter's digest changes and the same browser can vote again. Deferred (Justin, 2026-07-31): accepted ops trade-off, same class as `BETTER_AUTH_SECRET` rotation — a planned incident, never a routine step; documented in README [src/adapters/digest/index.ts].
- The poll-option `<span>`-marker deferral from Story 1.1 ("real `<span>` marker instead of decorative `::before`") is resolved by rewrite: Story 1.5 replaced the marker structure with the UX-DR2 `·`/`◆` glyph contract, superseding the original entry. Recorded per review decision (Justin, 2026-07-31) — the ledger deletion was intentional, not silent [src/components/poll-option.astro].
- The replay pre-read runs a D1 `findVoteBySubmission` on every vote POST — including throttled floods — and `castVote` repeats the lookup after the limiter admits. Deferred: inherent to the ratified replay-before-limiter decision (review round 1); verified non-exploitable — forged submission ids yield only a stored outcome or `idempotency_conflict`, never extra votes — but the read amplification is unmitigated [src/pages/[reference].astro].
- The vote-flash digest is deterministic per poll (HMAC of the poll id), so a copied cookie value can re-fire the cosmetic "Counted." banner on another visit. Deferred: no tally impact; binding the flash to the voter token is polish for a later story [src/pages/[reference].astro].
- `/api/health` checks binding presence only (no D1 query, no `VOTE_RATE_LIMITER` check), and the deploy gate smokes staging but not production. Accepted as-is (Justin, 2026-07-31): presence-only + staging smoke is Story 1.5's bar; a production-leg smoke and a deepened probe are candidates for the ops hardening track [src/pages/api/health.ts, .github/workflows/deploy.yml].
- A `#` inside an unquoted pasted secret would be silently truncated by dotenv while the provisioning helper reports success. Deferred: GitHub secrets are hex and Google's are `[A-Za-z0-9-_]`, so no real provider credential hits this; the script's `binding_key` comment documents the unmodeled dotenv forms [scripts/provision-auth-secrets.zsh].
- The staging smoke races Workers version propagation: the PR #3 deploy gate failed on `/api/health` 404s because the smoke's five retries over ~20s all hit the pre-deploy version when a brand-new route shipped; the endpoint was live moments later and the re-run passed. Deferred: widen the smoke's retry/backoff window (or poll until the new version marker appears) so first-deploy-of-a-route doesn't need a manual `gh run rerun` [scripts/smoke.mjs, .github/workflows/deploy.yml].
