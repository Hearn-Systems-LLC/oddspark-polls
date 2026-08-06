# Deferred Work

### DW-52: Taxonomy classification: blocks-3
origin: migrated from legacy ledger ("Taxonomy"), 2026-07-30
location: n/a
severity: critical
reason: must be resolved before an Epic 3 story can proceed.
status: open

### DW-53: Taxonomy classification: nice
origin: migrated from legacy ledger ("Taxonomy"), 2026-07-30
location: n/a
severity: low
reason: nice — bounded hardening or polish; does not block Epic 3.
status: open

### DW-54: Taxonomy classification: 3+
origin: migrated from legacy ledger ("Taxonomy"), 2026-07-30
location: n/a
severity: medium
reason: later-epic, platform, or product-policy work.
status: open

### DW-55: Playwright was absent from CI
origin: Story 1.1 review, 2026-07-30
location: .github/workflows/deploy.yml
severity: high
reason: E2E testing harness missing from continuous integration pipeline.
status: done 2026-07-30
resolution: .github/workflows/deploy.yml installs Chromium, migrates local D1, provisions throwaway local values, and runs pnpm test:e2e in test-and-build.

### DW-56: Overlay had no real consumer
origin: Story 1.1 review, 2026-07-30
location: src/components/overlay.astro, src/scripts/overlay.ts
severity: medium
reason: Component created without active page consumption.
status: done 2026-07-30
resolution: Story 1.12 shipped the delete-Poll overlay with enhanced and no-JavaScript behavior in src/components/overlay.astro, src/scripts/overlay.ts, and tests/e2e/creator-poll-lifecycle.spec.mjs.

### DW-57: Architecture Structural Seed omitted real source folders
origin: Story 1.1 review, 2026-07-30
location: ARCHITECTURE-SPINE.md
severity: medium
reason: Structural documentation omitted active source directory tree layout.
status: done 2026-07-30
resolution: Story 3.6 reconciled src/lib, src/layouts, src/styles, cache, Demo, and the ordered middleware chain in ARCHITECTURE-SPINE.md.

### DW-58: Slow POST idle restore could re-enable Publish
origin: Story 1.3 review, 2026-07-30
location: src/scripts/poll-definition-form.ts
severity: high
reason: Unconditional timer-based control restoration allowed form resubmission during slow network POST.
status: done 2026-07-30
resolution: Story 1.12 removed the unconditional timer; src/scripts/poll-definition-form.ts restores controls only after back-forward-cache recovery.

### DW-59: Any vote-batch FK failure became PollGoneError
origin: Story 1.5 review, 2026-07-30
location: src/modules/voting/index.ts
severity: medium
reason: Overly broad exception classification masked distinct race conditions.
status: done 2026-07-30
resolution: Story 1.12 re-reads Poll and option reachability so definition races become poll_definition_changed while unrelated failures remain generic.

### DW-60: Poll-option marker deferral
origin: Story 1.5 review, 2026-07-30
location: src/components/poll-option.astro
severity: low
reason: Temporary span request replacement deferred until UI glyph standardization.
status: done 2026-07-30
resolution: Story 1.5 replaced the old span request with the ratified · / ◆ glyph contract in src/components/poll-option.astro.

### DW-61: Deploy gate smoked staging but not production
origin: Story 1.5 review, 2026-07-30
location: .github/workflows/deploy.yml
severity: high
reason: CI pipeline lack of production environment verification post-deployment.
status: done 2026-07-30
resolution: .github/workflows/deploy.yml now runs production preflight, migration, deploy, and the same smoke probe after staging succeeds.

### DW-62: Multi-select bounds could change after the first Vote
origin: Story 1.7 review, 2026-07-30
location: src/adapters/d1/index.ts
severity: high
reason: Unlocked poll definition fields allowed post-voting schema mutations.
status: done 2026-07-30
resolution: Story 1.12 locks definition fields and re-enforces the no-Vote guard in the D1 mutation batch.

### DW-63: Landing header markup was duplicated inline
origin: Story 3.4 review, 2026-07-30
location: src/components/site-header.astro, src/pages/index.astro
severity: low
reason: Code duplication across landing page header instances.
status: done 2026-07-30
resolution: Story 3.5 extracted src/components/site-header.astro; src/pages/index.astro consumes it.

### DW-64: Introduce a sitemap index before the catalog approaches 49,998 eligible Polls; the current single sitemap correctly fails closed at capacity
origin: Story 3.2 implementation, 2026-07-30
location: src/modules/discovery/index.ts, src/pages/sitemap.xml.ts
severity: medium
reason: Introduce a sitemap index before the catalog approaches 49,998 eligible Polls; the current single sitemap correctly fails closed at capacity. `src/modules/discovery/index.ts`, `src/pages/sitemap.xml.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: open

### DW-65: Add a bounded D1 timeout/abort contract to the sequential sitemap build loop
origin: Story 3.2 implementation, 2026-07-30
location: src/pages/sitemap.xml.ts, src/modules/discovery/index.ts
severity: low
reason: Add a bounded D1 timeout/abort contract to the sequential sitemap build loop. `src/pages/sitemap.xml.ts`, `src/modules/discovery/index.ts` (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-66: Guard extreme expiresAtMs before building the Discovery cache Expires header
origin: Story 3.2 review, 2026-07-30
location: src/adapters/cache/discovery.ts
severity: low
reason: Guard extreme `expiresAtMs` before building the Discovery cache `Expires` header. `src/adapters/cache/discovery.ts` (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-67: Preserve the Delisted explanation if a second creator-lifecycle read fails after ownership already resolved
origin: Story 3.1 review, 2026-07-30
location: src/pages/creator/polls/[pollId].astro
severity: low
reason: Preserve the Delisted explanation if a second creator-lifecycle read fails after ownership already resolved. `src/pages/creator/polls/[pollId].astro` (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-68: Replace copy-pasteable template-literal SQL in E2E Poll seeding with one escaped/parameterized harness seam
origin: Story 2.4 review, 2026-07-30
location: tests/e2e/*, tests/e2e/creator-session.mjs
severity: low
reason: Replace copy-pasteable template-literal SQL in E2E Poll seeding with one escaped/parameterized harness seam. Existing callers pass generated fixture values, but the helper pattern is unsafe to reuse. `tests/e2e/*`, `tests/e2e/creator-session.mjs` (Taxonomy: nice, Owner: Quinn (QA))
status: open

### DW-69: Replace brittle walker/source-string assertions in trust-badge and live-indicator tests with structural checks
origin: Story 2.4 review, 2026-07-30
location: tests/unit/trust-badge.test.mjs, tests/unit/live-indicator.test.mjs
severity: low
reason: Replace brittle walker/source-string assertions in trust-badge and live-indicator tests with structural checks. `tests/unit/trust-badge.test.mjs`, `tests/unit/live-indicator.test.mjs` (Taxonomy: nice, Owner: Quinn (QA))
status: open

### DW-70: Make every E2E creator-fixture cleanup aggregate failures so one failed deletion cannot skip later fixtures
origin: Story 2.4 review, 2026-07-30
location: tests/e2e/*, tests/e2e/creator-session.mjs
severity: low
reason: Make every E2E creator-fixture cleanup aggregate failures so one failed deletion cannot skip later fixtures. `tests/e2e/*`, `tests/e2e/creator-session.mjs` (Taxonomy: nice, Owner: Quinn (QA))
status: open

### DW-71: Pluralize the multi-select VOTERS / SELECTIONS summary consistently in SSR and live reconciliation
origin: Story 1.9 review, 2026-07-30
location: src/components/results-tally.astro, src/scripts/results-live.ts
severity: low
reason: Pluralize the multi-select `VOTERS` / `SELECTIONS` summary consistently in SSR and live reconciliation. `src/components/results-tally.astro`, `src/scripts/results-live.ts` (Taxonomy: nice, Owner: Sally (UX Designer))
status: open

### DW-72: Measure and revisit the per-viewer D1 read volume from three-second visible-only Results polling; shared caching remains forbidden across authorization boundaries
origin: Story 1.9 implementation, 2026-07-30
location: src/scripts/results-live.ts, src/pages/[reference]/results/live.ts, src/adapters/d1/index.ts
severity: medium
reason: Measure and revisit the per-viewer D1 read volume from three-second visible-only Results polling; shared caching remains forbidden across authorization boundaries. `src/scripts/results-live.ts`, `src/pages/[reference]/results/live.ts`, `src/adapters/d1/index.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: open
decision: 2026-08-06 Implement dynamic backoff poll intervals — Implement exponential or adaptive backoff intervals in src/scripts/results-live.ts when poll results remain unchanged.

### DW-73: Clamp multi-select bounds only after explicit row removal or a stable count change, not while an option label is temporarily blank
origin: Story 1.8 review, 2026-07-30
location: src/scripts/create-poll-form.ts
severity: low
reason: Clamp multi-select bounds only after explicit row removal or a stable count change, not while an option label is temporarily blank. `src/scripts/create-poll-form.ts` (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-74: Update the mode-toggle label when the OS preference changes and no manual override is active
origin: Story 1.1 review, 2026-07-30
location: src/scripts/mode-override.ts
severity: low
reason: Update the mode-toggle label when the OS preference changes and no manual override is active. `src/scripts/mode-override.ts` (Taxonomy: nice, Owner: Sally (UX Designer))
status: open

### DW-75: Consume the two light-mode availability exception tokens when the Epic 7 availability cell ships
origin: Story 1.1 review, 2026-07-30
location: src/styles/tokens.css
severity: medium
reason: Consume the two light-mode availability exception tokens when the Epic 7 availability cell ships. `src/styles/tokens.css` (Taxonomy: 3+, Owner: Sally (UX Designer))
status: open

### DW-76: Re-audit the historical Story 1.2 middleware-scope bundle as separate current findings before changing it; several original observations were superseded by the present request-context → telemetry → session → CSRF → creator-guard chain
origin: Story 1.1 review round 2, 2026-07-30
location: src/middleware.ts, src/lib/csrf.ts
severity: medium
reason: Re-audit the historical Story 1.2 middleware-scope bundle as separate current findings before changing it; several original observations were superseded by the present request-context → telemetry → session → CSRF → creator-guard chain. `src/middleware.ts`, `src/lib/csrf.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: open
decision: 2026-08-06 Perform architectural re-audit of middleware findings — Review src/middleware.ts and src/lib/csrf.ts against AD-22 and file individual actionable findings.

### DW-77: Restore .astro static checking when @astrojs/check supports the pinned TypeScript 7 stack
origin: Story 1.1 and Story 1.2 reviews, 2026-07-30
location: .astro, @astrojs/check, package.json
severity: medium
reason: Restore `.astro` static checking when `@astrojs/check` supports the pinned TypeScript 7 stack. `package.json` (Taxonomy: 3+, Owner: Amelia (Developer))
status: open

### DW-78: Make the deploy JSONC parser accept block comments and BOM like Wrangler
origin: Story 1.1 review round 2, 2026-07-30
location: scripts/deploy-config.mjs
severity: low
reason: Make the deploy JSONC parser accept block comments and BOM like Wrangler. The parser now lives in `scripts/deploy-config.mjs`. (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-79: Replace Better Auth's per-isolate/default auth-endpoint limiter with an explicit production-safe policy if abuse evidence warrants it
origin: Story 1.2 review, 2026-07-30
location: src/pages/api/sign-in.ts, src/adapters/auth/index.ts
severity: medium
reason: Replace Better Auth's per-isolate/default auth-endpoint limiter with an explicit production-safe policy if abuse evidence warrants it. `src/pages/api/sign-in.ts`, `src/adapters/auth/index.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: open
decision: 2026-08-06 Keep current default auth rate limiting

### DW-80: Remove duplicate createAuth() / session reads on cookie-bearing Better Auth traffic without weakening middleware behavior
origin: Story 1.2 review, 2026-07-30
location: src/middleware.ts, src/pages/api/auth/[...all].ts
severity: low
reason: Remove duplicate `createAuth()` / session reads on cookie-bearing Better Auth traffic without weakening middleware behavior. `src/middleware.ts`, `src/pages/api/auth/[...all].ts` (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-81: Decide whether same-origin text/plain forms belong in the CSRF body-transport contract; there are no current consumers
origin: Story 1.2 review, 2026-07-30
location: text/plain, src/lib/csrf.ts
severity: medium
reason: Decide whether same-origin `text/plain` forms belong in the CSRF body-transport contract; there are no current consumers. `src/lib/csrf.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: open
decision: 2026-08-06 Explicitly reject text/plain POST requests in CSRF middleware — Update src/lib/csrf.ts to reject text/plain content-types on mutation routes.

### DW-82: Align the masked .dev.vars parser with runtime dotenv semantics for comments, whitespace, and BETTER_AUTH_URL validation
origin: Story 1.2 review, 2026-07-30
location: .dev.vars, scripts/provision-auth-secrets.zsh
severity: low
reason: Align the masked `.dev.vars` parser with runtime dotenv semantics for comments, whitespace, and `BETTER_AUTH_URL` validation. `scripts/provision-auth-secrets.zsh` (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-83: Add a bounded TTY/auth preflight so remote masked provisioning cannot wait indefinitely for Wrangler browser login
origin: Story 1.2 review, 2026-07-30
location: scripts/provision-auth-secrets.zsh
severity: low
reason: Add a bounded TTY/auth preflight so remote masked provisioning cannot wait indefinitely for Wrangler browser login. `scripts/provision-auth-secrets.zsh` (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-84: Make an explicit product/performance decision about caching canonical public Poll delivery; every unknown root reference currently reads D1
origin: Story 1.3 review, 2026-07-30
location: src/lib/poll-delivery.ts, src/pages/[reference].astro
severity: medium
reason: Make an explicit product/performance decision about caching canonical public Poll delivery; every unknown root reference currently reads D1. `src/lib/poll-delivery.ts`, `src/pages/[reference].astro` (Taxonomy: 3+, Owner: Winston (Architect))
status: open
decision: 2026-08-06 Maintain direct D1 reads for public poll delivery

### DW-85: Define corrupt-state handling for an owned Poll with no canonical poll_reference row
origin: Story 1.3 review round 2, 2026-07-30
location: src/adapters/d1/index.ts
severity: medium
reason: Define corrupt-state handling for an owned Poll with no canonical `poll_reference` row. `src/adapters/d1/index.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: done 2026-08-06
resolution: closed by human decision: Foreign key constraints and transaction integrity prevent orphan poll rows.
decision: 2026-08-06 Rely on foreign key constraint invariants — Foreign key constraints and transaction integrity prevent orphan poll rows.

### DW-86: Rebuild poll_reference if a future multi-reference design needs a safe default for is_canonical; current writers set it explicitly
origin: Story 1.3 review round 3, 2026-07-30
location: db/migrations/0004_polls.sql, src/adapters/d1/index.ts
severity: medium
reason: Rebuild `poll_reference` if a future multi-reference design needs a safe default for `is_canonical`; current writers set it explicitly. `db/migrations/0004_polls.sql`, `src/adapters/d1/index.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: open
decision: 2026-08-06 Keep explicit writer requirement without schema change

### DW-87: Establish a request-size policy so creator POST bodies are not fully materialized twice without a cap
origin: Story 1.3 review round 4, 2026-07-30
location: src/lib/csrf.ts, src/pages/creator/new.astro
severity: medium
reason: Establish a request-size policy so creator POST bodies are not fully materialized twice without a cap. `src/lib/csrf.ts`, `src/pages/creator/new.astro` (Taxonomy: 3+, Owner: Winston (Architect))
status: open

### DW-88: Add private, no-store to the reachable signed-out creator-guard redirect consistently, not only moderation
origin: Story 1.3 review round 6, 2026-07-30
location: src/middleware.ts
severity: low
reason: Add `private, no-store` to the reachable signed-out creator-guard redirect consistently, not only moderation. `src/middleware.ts` (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-89: Design a distinct transient-auth-lookup outcome instead of presenting D1 failure as signed-out
origin: Story 1.2 review round 2, 2026-07-30
location: src/middleware.ts
severity: medium
reason: Design a distinct transient-auth-lookup outcome instead of presenting D1 failure as signed-out. `src/middleware.ts` (Taxonomy: 3+, Owner: Sally (UX Designer))
status: open
decision: 2026-08-06 Maintain current graceful degradation to anonymous state

### DW-90: Clear the non-sensitive creator-session marker when sign-out succeeds after a failed pre-handler session lookup
origin: Story 1.2 review round 2, 2026-07-30
location: src/middleware.ts
severity: low
reason: Clear the non-sensitive creator-session marker when sign-out succeeds after a failed pre-handler session lookup. `src/middleware.ts` (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-91: Give provider-email lookup outages truthful retry/account-linking behavior instead of a misleading local-verification denial
origin: Story 1.2 review round 2, 2026-07-30
location: src/adapters/auth/index.ts
severity: medium
reason: Give provider-email lookup outages truthful retry/account-linking behavior instead of a misleading local-verification denial. `src/adapters/auth/index.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: open
decision: 2026-08-06 Improve OAuth email lookup failure error mapping — Update src/adapters/auth/index.ts to return a distinct provider_outage error on email fetch failure.

### DW-92: Add a remote schema preflight proving migration 0003 is present before auth code depends on its uniqueness guarantee
origin: Story 1.2 review round 2, 2026-07-30
location: db/migrations/0003_user_email_case_insensitive.sql, scripts/deploy.mjs
severity: medium
reason: Add a remote schema preflight proving migration 0003 is present before auth code depends on its uniqueness guarantee. `db/migrations/0003_user_email_case_insensitive.sql`, `scripts/deploy.mjs` (Taxonomy: 3+, Owner: Winston (Architect))
status: open

### DW-93: Continue monitoring D1's error text used to classify custom-link uniqueness collisions; no structured driver code currently exists
origin: Story 1.4 review, 2026-07-30
location: src/adapters/d1/index.ts
severity: medium
reason: Continue monitoring D1's error text used to classify custom-link uniqueness collisions; no structured driver code currently exists. `src/adapters/d1/index.ts` (Taxonomy: 3+, Owner: Amelia (Developer))
status: open

### DW-94: Add a poll_reference.kind schema constraint and checked adapter mapping through a forward migration if another writer is introduced
origin: Story 1.4 review, 2026-07-30
location: poll_reference.kind, db/migrations, src/adapters/d1/index.ts
severity: medium
reason: Add a `poll_reference.kind` schema constraint and checked adapter mapping through a forward migration if another writer is introduced. `db/migrations`, `src/adapters/d1/index.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: open

### DW-95: Keep migration 0004's superseded multi-reference comment as immutable history; the substitution design remains documented in the Story 1.4 decision record
origin: Story 1.4 review, 2026-07-30
location: db/migrations/0004_polls.sql
severity: medium
reason: Keep migration 0004's superseded multi-reference comment as immutable history; the substitution design remains documented in the Story 1.4 decision record. `db/migrations/0004_polls.sql` (Taxonomy: 3+, Owner: Winston (Architect))
status: open

### DW-96: Revisit the theoretical generated-reference case-fold collision only if the reserved-reference design changes; current probability and guards make it non-actionable
origin: Story 1.4 review round 2, 2026-07-30
location: src/lib/poll-delivery.ts, src/adapters/d1/index.ts
severity: medium
reason: Revisit the theoretical generated-reference case-fold collision only if the reserved-reference design changes; current probability and guards make it non-actionable. `src/lib/poll-delivery.ts`, `src/adapters/d1/index.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: done 2026-08-06
resolution: closed by human decision: Current reference generation algorithms and collision guards make case-fold collisions non-actionable.
decision: 2026-08-06 Close as non-actionable under current reference generation design — Current reference generation algorithms and collision guards make case-fold collisions non-actionable.

### DW-97: Reassess whether exact lookup → bounded case-fold fallback → redirect needs a named application seam
origin: Story 1.4 review round 2, 2026-07-30
location: src/lib/poll-delivery.ts, src/adapters/d1/index.ts
severity: medium
reason: Reassess whether exact lookup → bounded case-fold fallback → redirect needs a named application seam. `src/lib/poll-delivery.ts`, `src/adapters/d1/index.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: open
decision: 2026-08-06 Keep current route and adapter reference resolution

### DW-98: Make authenticated create-poll E2E retries generate a fresh slug or clean per attempt
origin: Story 1.4 review round 2, 2026-07-30
location: tests/e2e/create-poll-authed.spec.mjs, tests/e2e/creator-session.mjs
severity: low
reason: Make authenticated create-poll E2E retries generate a fresh slug or clean per attempt. `tests/e2e/create-poll-authed.spec.mjs`, `tests/e2e/creator-session.mjs` (Taxonomy: nice, Owner: Quinn (QA))
status: open

### DW-99: Add signed-out seed-based coverage for the case-variant 301/404 contract; CI already provisions auth so present coverage is unconditional there
origin: Story 1.4 review round 2, 2026-07-30
location: tests/e2e/create-poll-authed.spec.mjs
severity: low
reason: Add signed-out seed-based coverage for the case-variant 301/404 contract; CI already provisions auth so present coverage is unconditional there. `tests/e2e/create-poll-authed.spec.mjs` (Taxonomy: nice, Owner: Quinn (QA))
status: open

### DW-100: Decide whether corrupt orphan reference rows should recheck reachability before a case-fold redirect; foreign-key cascades prevent the state in normal writes
origin: Story 1.4 review round 3, 2026-07-30
location: src/lib/poll-delivery.ts, src/adapters/d1/index.ts
severity: medium
reason: Decide whether corrupt orphan reference rows should recheck reachability before a case-fold redirect; foreign-key cascades prevent the state in normal writes. `src/lib/poll-delivery.ts`, `src/adapters/d1/index.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: done 2026-08-06
resolution: closed by human decision: Foreign key constraints prevent corrupt orphan reference rows in normal operations.
decision: 2026-08-06 Close as unnecessary due to database foreign key invariants — Foreign key constraints prevent corrupt orphan reference rows in normal operations.

### DW-101: Decide whether scripted POSTs to case-variant custom slugs should preserve a ballot across canonicalization; rendered forms always post to canonical paths
origin: Story 1.5 review, 2026-07-30
location: src/lib/poll-delivery.ts
severity: medium
reason: Decide whether scripted POSTs to case-variant custom slugs should preserve a ballot across canonicalization; rendered forms always post to canonical paths. `src/lib/poll-delivery.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: done 2026-08-06
resolution: closed by human decision: Rendered forms post to canonical URLs; non-canonical POST APIs should fail or require canonical URLs.
decision: 2026-08-06 Enforce canonical URL submission without 307 body-preserving redirect — Rendered forms post to canonical URLs; non-canonical POST APIs should fail or require canonical URLs.

### DW-102: Implement adapter rendering for extension:* vote contributions only with the first real Comment or Voter-Code consumer
origin: Story 1.5 review, 2026-07-30
location: src/modules/voting/index.ts, src/adapters/d1/index.ts
severity: medium
reason: Implement adapter rendering for `extension:*` vote contributions only with the first real Comment or Voter-Code consumer. `src/modules/voting/index.ts`, `src/adapters/d1/index.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: open
decision: 2026-08-06 Keep extension adapter rendering deferred until new consumer lands

### DW-103: Treat VOTE_DIGEST_SECRET rotation as a planned integrity incident because prior duplicate claims become incomparable
origin: Story 1.5 review, 2026-07-30
location: README.md
severity: medium
reason: Treat `VOTE_DIGEST_SECRET` rotation as a planned integrity incident because prior duplicate claims become incomparable. The operational warning remains in `README.md`. (Taxonomy: 3+, Owner: Winston (Architect))
status: done 2026-08-06
resolution: closed by human decision: VOTE_DIGEST_SECRET operational constraints are documented in README.md and AGENTS.md.
decision: 2026-08-06 Close entry as fully documented operational policy in README.md — VOTE_DIGEST_SECRET operational constraints are documented in README.md and AGENTS.md.

### DW-104: Reduce the replay pre-read amplification on throttled Vote floods without weakening replay-before-challenge correctness
origin: Story 1.5 review, 2026-07-30
location: src/lib/poll-delivery.ts, src/modules/voting/index.ts
severity: medium
reason: Reduce the replay pre-read amplification on throttled Vote floods without weakening replay-before-challenge correctness. `src/lib/poll-delivery.ts`, `src/modules/voting/index.ts` (Taxonomy: 3+, Owner: Winston (Architect))
status: open

### DW-105: Bind the cosmetic vote-flash proof to the voter token if replayed confirmation banners become a real UX problem
origin: Story 1.5 review, 2026-07-30
location: src/lib/poll-delivery.ts
severity: low
reason: Bind the cosmetic vote-flash proof to the voter token if replayed confirmation banners become a real UX problem. `src/lib/poll-delivery.ts` (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-106: Decide whether /api/health should perform deeper D1/rate-limiter checks; its current presence-only contract is intentionally side-effect free and production is now smoked
origin: Story 1.5 review, 2026-07-30
location: /api/health, src/pages/api/health.ts, .github/workflows/deploy.yml
severity: medium
reason: Decide whether `/api/health` should perform deeper D1/rate-limiter checks; its current presence-only contract is intentionally side-effect free and production is now smoked. `src/pages/api/health.ts`, `.github/workflows/deploy.yml` (Taxonomy: 3+, Owner: Winston (Architect))
status: done 2026-08-06
resolution: closed by human decision: /api/health presence-only contract is an architectural invariant specified in AGENTS.md.
decision: 2026-08-06 Preserve presence-only /api/health contract per AGENTS.md — /api/health presence-only contract is an architectural invariant specified in AGENTS.md.

### DW-107: Reject or safely encode an unquoted # if future provider credential formats can contain one
origin: Story 1.5 review, 2026-07-30
location: scripts/provision-auth-secrets.zsh
severity: low
reason: Reject or safely encode an unquoted `#` if future provider credential formats can contain one. `scripts/provision-auth-secrets.zsh` (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-108: Widen or version-pin the staging smoke retry window for first-deploy route propagation
origin: Story 1.5 review, 2026-07-30
location: scripts/smoke.mjs, .github/workflows/deploy.yml
severity: low
reason: Widen or version-pin the staging smoke retry window for first-deploy route propagation. `scripts/smoke.mjs`, `.github/workflows/deploy.yml` (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-109: Replace classifyNoChange's exhaustiveness throw with a safe outcome if DISCOVERY_STATES gains a value
origin: Story 3.3 review, 2026-07-30
location: src/adapters/d1/index.ts
severity: medium
reason: Replace `classifyNoChange`'s exhaustiveness throw with a safe outcome if `DISCOVERY_STATES` gains a value. `src/adapters/d1/index.ts` (Taxonomy: 3+, Owner: Amelia (Developer))
status: open

### DW-110: Reject corrupt empty Poll questions in the moderation target mapper
origin: Story 3.3 review, 2026-07-30
location: src/adapters/d1/index.ts
severity: low
reason: Reject corrupt empty Poll questions in the moderation target mapper. `src/adapters/d1/index.ts` (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-111: Reject corrupt empty canonical references in the moderation target mapper
origin: Story 3.3 review, 2026-07-30
location: src/adapters/d1/index.ts
severity: low
reason: Reject corrupt empty canonical references in the moderation target mapper. `src/adapters/d1/index.ts` (Taxonomy: nice, Owner: Amelia (Developer))
status: open

### DW-112: Make the no-JavaScript mode-toggle pressed state reflect OS preference or remove the misleading pressed state from the static baseline
origin: Story 3.4 review, 2026-07-30
location: src/components/site-header.astro, src/scripts/mode-override.ts
severity: low
reason: Make the no-JavaScript mode-toggle pressed state reflect OS preference or remove the misleading pressed state from the static baseline. `src/components/site-header.astro`, `src/scripts/mode-override.ts` (Taxonomy: nice, Owner: Sally (UX Designer))
status: open

### DW-113: Prevent a post-commit vote-flash signing failure from rendering a fresh retry that can duplicate a Vote when duplicate checks are disabled
origin: code review of spec-4-1-comment-with-your-vote.md, 2026-08-04
location: src/lib/poll-delivery.ts
severity: high
reason: src/lib/poll-delivery.ts persisted the Vote before flash signing at the Story 4.1 baseline; a signing exception falls into the broad retry path and replaces the submission ID.
status: open

### DW-114: Replace the timed in-flight Vote-form restore with a completion-aware recovery contract that cannot mint a fresh submission ID while the original POST may still commit
origin: code review of spec-4-1-comment-with-your-vote.md, 2026-08-04
location: src/scripts/vote-form.ts
severity: high
reason: src/scripts/vote-form.ts already restored the form after ten seconds at the Story 4.1 baseline; when Session and IP Checks are both off, a slow original request and the fresh-ID retry can both commit Votes.
status: open

### DW-50: Follow-up review still recommended for 4-1-comment-with-your-vote after the damping cap was spent
origin: review-budget-followup
location: n/a
source_spec: `spec-4-1-comment-with-your-vote.md`
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20260804-223921-acae; this entry preserves the lingering recommendation for a deliberate later review.
status: done 2026-08-06
resolution: resolved by sweep bundle dw-epic-4-followup-reviews

### DW-51: Follow-up review still recommended for 4-3-csv-export after the damping cap was spent
origin: review-budget-followup
location: n/a
source_spec: `spec-4-3-csv-export.md`
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20260805-100403-00fa; this entry preserves the lingering recommendation for a deliberate later review.
status: done 2026-08-06
resolution: resolved by sweep bundle dw-epic-4-followup-reviews
