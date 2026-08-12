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
status: done 2026-08-06
resolution: resolved by sweep bundle dw-sitemap-discovery-hardening

### DW-65: Add a bounded D1 timeout/abort contract to the sequential sitemap build loop
origin: Story 3.2 implementation, 2026-07-30
location: src/pages/sitemap.xml.ts, src/modules/discovery/index.ts
severity: low
reason: Add a bounded D1 timeout/abort contract to the sequential sitemap build loop. `src/pages/sitemap.xml.ts`, `src/modules/discovery/index.ts` (Taxonomy: nice, Owner: Amelia (Developer))
status: done 2026-08-06
resolution: resolved by sweep bundle dw-sitemap-discovery-hardening

### DW-66: Guard extreme expiresAtMs before building the Discovery cache Expires header
origin: Story 3.2 review, 2026-07-30
location: src/adapters/cache/discovery.ts
severity: low
reason: Guard extreme `expiresAtMs` before building the Discovery cache `Expires` header. `src/adapters/cache/discovery.ts` (Taxonomy: nice, Owner: Amelia (Developer))
status: done 2026-08-06
resolution: resolved by sweep bundle dw-sitemap-discovery-hardening

### DW-67: Preserve the Delisted explanation if a second creator-lifecycle read fails after ownership already resolved
origin: Story 3.1 review, 2026-07-30
location: src/pages/creator/polls/[pollId].astro
severity: low
reason: Preserve the Delisted explanation if a second creator-lifecycle read fails after ownership already resolved. `src/pages/creator/polls/[pollId].astro` (Taxonomy: nice, Owner: Amelia (Developer))
status: done 2026-08-06
resolution: resolved by sweep bundle dw-d1-moderation-mapper-defense

### DW-68: Replace copy-pasteable template-literal SQL in E2E Poll seeding with one escaped/parameterized harness seam
origin: Story 2.4 review, 2026-07-30
location: tests/e2e/*, tests/e2e/creator-session.mjs
severity: low
reason: Replace copy-pasteable template-literal SQL in E2E Poll seeding with one escaped/parameterized harness seam. Existing callers pass generated fixture values, but the helper pattern is unsafe to reuse. `tests/e2e/*`, `tests/e2e/creator-session.mjs` (Taxonomy: nice, Owner: Quinn (QA))
status: done 2026-08-06
resolution: resolved by sweep bundle dw-e2e-harness-hardening

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
status: done 2026-08-06
resolution: resolved by sweep bundle dw-e2e-harness-hardening

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
status: done 2026-08-06
resolution: resolved by sweep bundle dw-e2e-harness-hardening

### DW-99: Add signed-out seed-based coverage for the case-variant 301/404 contract; CI already provisions auth so present coverage is unconditional there
origin: Story 1.4 review round 2, 2026-07-30
location: tests/e2e/create-poll-authed.spec.mjs
severity: low
reason: Add signed-out seed-based coverage for the case-variant 301/404 contract; CI already provisions auth so present coverage is unconditional there. `tests/e2e/create-poll-authed.spec.mjs` (Taxonomy: nice, Owner: Quinn (QA))
status: done 2026-08-06
resolution: resolved by sweep bundle dw-e2e-harness-hardening

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
status: done 2026-08-06
resolution: resolved by sweep bundle dw-sitemap-discovery-hardening

### DW-110: Reject corrupt empty Poll questions in the moderation target mapper
origin: Story 3.3 review, 2026-07-30
location: src/adapters/d1/index.ts
severity: low
reason: Reject corrupt empty Poll questions in the moderation target mapper. `src/adapters/d1/index.ts` (Taxonomy: nice, Owner: Amelia (Developer))
status: done 2026-08-06
resolution: resolved by sweep bundle dw-d1-moderation-mapper-defense

### DW-111: Reject corrupt empty canonical references in the moderation target mapper
origin: Story 3.3 review, 2026-07-30
location: src/adapters/d1/index.ts
severity: low
reason: Reject corrupt empty canonical references in the moderation target mapper. `src/adapters/d1/index.ts` (Taxonomy: nice, Owner: Amelia (Developer))
status: done 2026-08-06
resolution: resolved by sweep bundle dw-d1-moderation-mapper-defense

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
status: done 2026-08-06
resolution: resolved by epic-4-followup bundle (spec-epic-4-followup.md); the deterministic flash digest is pre-computed before castVote, so a signing failure precedes the atomic commit and no fallible call remains between commit and the 303.

### DW-114: Replace the timed in-flight Vote-form restore with a completion-aware recovery contract that cannot mint a fresh submission ID while the original POST may still commit
origin: code review of spec-4-1-comment-with-your-vote.md, 2026-08-04
location: src/scripts/vote-form.ts
severity: high
reason: src/scripts/vote-form.ts already restored the form after ten seconds at the Story 4.1 baseline; when Session and IP Checks are both off, a slow original request and the fresh-ID retry can both commit Votes.
status: done 2026-08-06
resolution: resolved by epic-4-followup bundle (spec-epic-4-followup.md); the timed restore keeps the original submission ID and the server-side AD-7 idempotency contract adjudicates every retry (replay returns the stored outcome, an edited resubmit conflicts), so the client never mints submission IDs.

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

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-4-followup.md`
  summary: The idempotency-conflict outcome renders an editable form with a fresh server-minted submission ID, so with every Security Toggle off a voter who edits after a committed original can click through the conflict and count a second Vote on the next submit.
  evidence: src/lib/poll-delivery.ts sets readOnly only for already_voted/already_voted_ip/poll_closed and mints a fresh submission ID on every outcome re-render; with toggles off no voter_claim exists, so the fresh-ID resubmission commits. Pre-existing designed Story 1.5/1.6 conflict behavior — FR-15's all-off mode licenses any fresh render, so closing the conflict-render path specifically is a product-contract decision, not an obvious defect.

## Deferred from: code review of spec-5-1-cast-a-ranked-ballot.md (2026-08-06)

- Ranked-unavailable results page hides the Comment list pre-5.2 (src/modules/results/index.ts ranked branch, src/pages/[reference]/results.astro). Comments submitted with ranked ballots are invisible on all surfaces until IRV lands in Story 5.2. Resolved by Justin: keep hidden; revisit comment visibility when the IRV projection ships.

## Deferred from: code review of spec-5-2-deterministic-irv-tabulation.md (2026-08-07)

- `IrvRound.counts` and unresolved `standingCounts` are `ReadonlyMap`s (`src/modules/results/tabulate-irv.ts`). Maps do not JSON-serialize for live payload / results projection. Defer until Results/live wiring maps Round evidence to a stable array/object shape.
- Remaining Story 5.2 product wiring (Results module types, D1 `projectRankedResults`, strategy `projectResults`, results/live/post-vote UI, integration/e2e, CHANGELOG/README) is not in commit `aaa04a5`. Deferred as the next implementation slice — confirmed intentional pure-core intermediate delivery (code review D1=1, 2026-08-07). **Resolved 2026-08-07:** product wiring landed on `story/5-2-deterministic-irv-tabulation` (adapter, ranked_visible surfaces, tests, CHANGELOG/README).

## Deferred from: code review of spec-5-2-deterministic-irv-tabulation.md Group 2 (2026-08-07)

- Spec wording “join poll_option” vs separate options SELECT + `knownOptionIds` guard — behavior correct; non-blocking wording residual.
- Dual-path adapter vs strategy multi-round parity fixtures — pure tabulator already shared; nice-to-have integration depth.
- Ranked live client exact-key validator parity with MC — deferred to Group 3 UI/live surface review.

## Deferred from: code review of spec-5-2-deterministic-irv-tabulation.md Group 3 (2026-08-07)

- Browser live-poller e2e for ranked DOM refresh and ranked 204 visibility journeys — SSR/HTTP coverage exists; full poller e2e is polish.
- Ranked live exact-key validator unit suite parity with MC — shallow client checks sufficient for 5.2 minimal poller.
- Post-vote CSS grid placement for `.ranked-results` under `data-post-vote` — visual polish, not AC fail.
- ~~Round-table / elimination trail / YOUR BALLOT / Comment list on ranked surfaces~~ — resolved by Story 5.3.

## Deferred from: code review of 5-3-per-round-display-ballot-manifest (2026-08-07)

- Unbounded Manifest / in-memory sort for large polls [src/adapters/d1/index.ts:projectBallotManifest, src/pages/[reference]/manifest.astro] — loads all votes+preferences into Map/array and renders one `<li>` per ballot with no LIMIT; 50k ballots OOMs Worker / multi-MB HTML. Spec says “Rounds never collapse or paginate” for completeness, but no memory guard specified. Monitor; consider streaming/size cap if observed.
- Zero-preference / orphan vote undercounts ballotCount [src/adapters/d1/index.ts:projectBallotManifest] — `ballotMap` only from `prefRows`; a vote with zero `ranked_vote_preference` rows is invisible so ballotCount diverges from vote table/exhaustedCount. Requires product decision on manifest exhausted-ballot representation.

## Deferred from: Story 6.1 Upload Image Options (2026-08-07)

- ~~Temp-key sweeper for unadopted R2 objects older than 24h~~ — resolved by Story 6.3 with a bounded, D1-adoption-first scheduled sweep; adopted `tmp/` keys remain live.
- ~~Media replacement/deletion outbox and cron drain~~ — resolved by Story 6.3 with same-batch self-contained cleanup rows, guarded replacement mechanics, and a 15-minute idempotent drain.
- Progressive-enhancement async uploader — explicitly out of scope per AD-2 no-JS mandate.
- Voting/results rendering of image plates — owned by Story 6.2.

## Deferred from: code review of 6-1-upload-image-options (2026-08-07)

- CSRF clone double-buffers multipart bodies (~5 MB × N × 2 Worker memory) — pre-existing trap from spec §Traps-1, accepted as documented and bounded by POLL_CAPS.maxOptions [src/lib/csrf.ts:209, src/pages/creator/new.astro:135] — spec-noted, bounded by maxOptions

## Deferred from: code review of 6-2-vote-on-an-image-poll (2026-08-08)

- Tests assert on source-text patterns rather than runtime behavior — pre-existing pattern in codebase (poll-card.test.mjs precedent), not blocking
- Read-only branch media plumbing test uses fragile regex — test quality issue, not blocking
- No test verifies actual accessible name computation — accessibility testing gap, not blocking
- No verification that lazy loading prevents layout shift — performance testing gap, not blocking
- Live payload contract test checks source text instead of actual payload — test quality issue, not blocking
- Caption color test uses regex that could match incorrect selectors — test quality issue, not blocking

## Deferred from: Story 6.2 Vote on an Image Poll (2026-08-08)

- Results layout: plate + caption as sibling block above each option's bar — needs design review. The UX spine has no Image-Poll Tally spec and the 34/38px bar cannot hold a plate. This is the minimal reading of "images served on results" + "same results-bar Tally". Flagged for design follow-up.
- Desktop plate size: full ballot-column width at every breakpoint. If plates feel oversized at lg breakpoint, that's a design-review follow-up, not a grid change. Spec text says "full column width" and layout forbids breakpoint-only components.
- Caption color: `{colors.text-dark}` via `{typography.caption}` — ruled NOT dim/faint because caption is option-identifying information. Parallel: results-bar count rejected dim for the same reason. DESIGN.md bans faint on must-read text. Accepted as-is, flag for design confirmation.

### DW-115: Deploy gate E2E leg runs fully serial (~15-18 min of a ~23-min job)
origin: Epic 6 retrospective follow-up / PR #39-#40 cycle, 2026-08-08
location: playwright.config.mjs (workers: 1), .github/workflows/deploy.yml
severity: medium
reason: Every PR and main deploy pays a ~23-minute Tests → build job dominated by 181 serially-run Playwright tests. workers: 1 is deliberate (SQLite contention determinism), so speeding up means sharding across CI jobs with isolated D1 databases and ports per shard, not flipping the workers flag. Candidate: --shard=1/4..4/4 across parallel jobs; splitting unit/integration from E2E gives faster feedback but does not shorten the critical path.
status: done 2026-08-08
resolution: E2E moved out of test-and-build into a parallel e2e job with a 4-way shard matrix (--shard=N/4; 52/50/35/45 split of 182 tests); each shard is a separate runner with its own dev server and local-persistence D1, so workers: 1 stays. Deploy jobs now need both legs, and non-main concurrency runs cancel-in-progress while main pushes still queue.

### DW-116: Turnstile human check rejected a vote on polls.oddspark.dev
origin: Justin report with screenshot, 2026-08-08
location: production Turnstile widget configuration; src/components/turnstile.astro
severity: high
reason: A vote on the production Demo Poll re-rendered with "The human check didn't pass." If reproducible, the most likely cause is the production widget's hostname allowlist not including the custom domain polls.oddspark.dev (AGENTS.md still records the domain as "not bound yet", yet it serves live traffic — the docs and the widget config may both lag reality). Verify: reproduce a vote on the custom domain, check the widget's allowed hostnames in the Cloudflare dashboard, confirm which site key the production Worker serves (TURNSTILE_SITE_KEY var vs the widget actually loaded).
status: open

### DW-117: main branch protection requires a PR but no status checks
origin: PR #39 merge cycle, 2026-08-08
location: GitHub repo rules (refs/heads/main)
severity: medium
reason: gh pr merge succeeds while CI is still running — "merge when green" is convention, not enforcement. The main-push deploy gate re-runs the full suite before anything ships, so production is protected, but a red main blocks deploys and violates the repo's own "no commit lands on main with failing tests" rule. Fix is repo settings: add the Tests → build check as a required status check on main (and enable auto-merge while there).
status: open

### DW-118: comment-list-moderation "stale live tab" e2e test is timing-flaky
origin: DW-115 sharded-e2e verification runs, 2026-08-08
location: tests/e2e/comment-list-moderation.spec.mjs:198 (ownerPage.reload())
severity: low
reason: Locally, `pnpm test:e2e --shard=1/4` failed this test 3/3 runs with `page.reload: net::ERR_ABORTED; maybe frame was detached` — the test's explicit reload races the page's own live-poll whole-page reload after the Administrator deletion at line 190. The same test passed standalone, in the full unsharded suite (182/182), and shard 1 passed with `--retries=1` (CI parity, playwright.config.ts sets retries: 1 under CI), so the deploy gate absorbs it. Likely fix: wait for the owner page's live state to settle (or disarm its poller) before the explicit reload instead of relying on timing.
status: open

### DW-119: Landing Create/Browse links should become a full-width footer
origin: Justin report with screenshot, 2026-08-08
location: src/pages/index.astro (landing Create/Browse blocks + lg two-column grid)
severity: low
reason: At ≥1024px the intro column trails off into orphaned "Create / Create a Poll" and "Browse / Discover Polls" blocks separated by rules — reads as scattered text at the bottom of the column (worse in the demo-first variant where the poll occupies the wide left track). Product direction: move them to a full-width footer band below the grid. Scoped as a **feature change for a later cycle, to go through adversarial review protocols when picked up** — per Justin, 2026-08-08. An implementation pass was started on fix/landing-footer-nav (footer `<nav>` with Create left / Discover right, DESIGN.md/EXPERIENCE.md/CHANGELOG edits, geometry assertions in tests/e2e/landing.spec.mjs + tests/unit/landing-page.test.mjs) and deliberately discarded uncommitted; the approach notes above survive as a starting point only, not as approved design.
status: done 2026-08-09
resolution: Story 3.7 (Landing Footer) consolidated Create, Discover, and the repository link into a full-width `landing-footer` with the Hearn byline; the orphaned blocks are retired.

## Deferred from: code review of 3-7-landing-footer (2026-08-09)

- `:global(.public-repository-link.is-landing)` override in `src/components/landing-footer.astro` reaches into the child component's private class — the story's scope fence forbade modifying `public-repository-link.astro`, so this was the sanctioned seam; a rename of `is-landing` silently restores the 16px footer-row misalignment. Revisit if the repository link component changes.
- Story 3.7 demo-first proof PNGs are produced by Story 3.5's `tests/e2e/demo-poll.spec.mjs` — the rejected-vote variant is only reachable from that spec, so the cross-story coupling is structural; splitting or refactoring that spec silently stops producing 3.7 proof artifacts.

## Deferred from: code review of 8-2-vote-with-a-voter-code (2026-08-12)

- Optional `lookupVoterCode` dep + indistinguishable code-gated 422s — `lookupVoterCode` is optional and fail-closes to generic `vote_failed` 500 if wiring forgotten; all three code errors map to 422 with no distinct telemetry `result`/`reasonCode` for `missing` vs `invalid` vs `used` — observability gap for brute-force vs race loss. Location: `src/modules/voting/index.ts:356`, `src/lib/poll-delivery.ts:722`. Deferred as pre-existing pattern from Session/IP ports; not AC-blocking.
- Low cosmetic: duplicate trigger maintenance (`BEFORE INSERT` + `BEFORE UPDATE OF code` duplicating predicate, missing `poll_id` move guard), double `role="alert"` + focused outcome announcing error twice, and unbounded client `value` relying solely on server `boundedInvalidEcho` (`autocomplete="off"` mitigates). Location: `db/migrations/0019_voter_code_integrity.sql:7`, `src/components/input-code.astro:14`, `src/components/poll-voting-surface.astro:220`. Deferred as polish.
