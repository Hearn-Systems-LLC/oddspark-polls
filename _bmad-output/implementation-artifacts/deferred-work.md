# Deferred Work

This is the public truth ledger for accepted work that is not complete. Every
open entry has a retrospective taxonomy and a named owner:

- `blocks-3` — must be resolved before an Epic 3 story can proceed.
- `nice` — bounded hardening or polish; does not block Epic 3.
- `3+` — later-epic, platform, or product-policy work.

Story 3.6 triage found no surviving `blocks-3` item. The three Epic 2 harness
carryovers are explicitly retained as `nice`. A duplicate `.astro` type-check
entry from two reviews is consolidated below and cites both origins; no open
item was silently deleted.

## Resolved with evidence

| Origin | Resolved item | Evidence |
| --- | --- | --- |
| Story 1.1 review | Playwright was absent from CI | `.github/workflows/deploy.yml` installs Chromium, migrates local D1, provisions throwaway local values, and runs `pnpm test:e2e` in `test-and-build`. |
| Story 1.1 review | Overlay had no real consumer | Story 1.12 shipped the delete-Poll overlay with enhanced and no-JavaScript behavior in `src/components/overlay.astro`, `src/scripts/overlay.ts`, and `tests/e2e/creator-poll-lifecycle.spec.mjs`. |
| Story 1.1 review | Architecture Structural Seed omitted real source folders | Story 3.6 reconciled `src/lib`, `src/layouts`, `src/styles`, cache, Demo, and the ordered middleware chain in `ARCHITECTURE-SPINE.md`. |
| Story 1.3 review | Slow POST idle restore could re-enable Publish | Story 1.12 removed the unconditional timer; `src/scripts/poll-definition-form.ts` restores controls only after back-forward-cache recovery. |
| Story 1.5 review | Any vote-batch FK failure became `PollGoneError` | Story 1.12 re-reads Poll and option reachability so definition races become `poll_definition_changed` while unrelated failures remain generic. |
| Story 1.5 review | Poll-option marker deferral | Story 1.5 replaced the old span request with the ratified `·` / `◆` glyph contract in `src/components/poll-option.astro`. |
| Story 1.5 review | Deploy gate smoked staging but not production | `.github/workflows/deploy.yml` now runs production preflight, migration, deploy, and the same smoke probe after staging succeeds. The separate deep-health question remains open below. |
| Story 1.7 review | Multi-select bounds could change after the first Vote | Story 1.12 locks definition fields and re-enforces the no-Vote guard in the D1 mutation batch. |
| Story 3.4 review | Landing header markup was duplicated inline | Story 3.5 extracted `src/components/site-header.astro`; `src/pages/index.astro` consumes it. |

## Open ledger

| ID | Origin | Deferred work | Taxonomy | Owner |
| --- | --- | --- | --- | --- |
| DW-001 | Story 3.2 implementation | Introduce a sitemap index before the catalog approaches 49,998 eligible Polls; the current single sitemap correctly fails closed at capacity. `src/modules/discovery/index.ts`, `src/pages/sitemap.xml.ts` | `3+` | Winston (Architect) |
| DW-002 | Story 3.2 implementation | Add a bounded D1 timeout/abort contract to the sequential sitemap build loop. `src/pages/sitemap.xml.ts`, `src/modules/discovery/index.ts` | `nice` | Amelia (Developer) |
| DW-003 | Story 3.2 review | Guard extreme `expiresAtMs` before building the Discovery cache `Expires` header. `src/adapters/cache/discovery.ts` | `nice` | Amelia (Developer) |
| DW-004 | Story 3.1 review | Preserve the Delisted explanation if a second creator-lifecycle read fails after ownership already resolved. `src/pages/creator/polls/[pollId].astro` | `nice` | Amelia (Developer) |
| DW-005 | Story 2.4 review | Replace copy-pasteable template-literal SQL in E2E Poll seeding with one escaped/parameterized harness seam. Existing callers pass generated fixture values, but the helper pattern is unsafe to reuse. `tests/e2e/*`, `tests/e2e/creator-session.mjs` | `nice` | Quinn (QA) |
| DW-006 | Story 2.4 review | Replace brittle walker/source-string assertions in trust-badge and live-indicator tests with structural checks. `tests/unit/trust-badge.test.mjs`, `tests/unit/live-indicator.test.mjs` | `nice` | Quinn (QA) |
| DW-007 | Story 2.4 review | Make every E2E creator-fixture cleanup aggregate failures so one failed deletion cannot skip later fixtures. `tests/e2e/*`, `tests/e2e/creator-session.mjs` | `nice` | Quinn (QA) |
| DW-008 | Story 1.9 review | Pluralize the multi-select `VOTERS` / `SELECTIONS` summary consistently in SSR and live reconciliation. `src/components/results-tally.astro`, `src/scripts/results-live.ts` | `nice` | Sally (UX Designer) |
| DW-009 | Story 1.9 implementation | Measure and revisit the per-viewer D1 read volume from three-second visible-only Results polling; shared caching remains forbidden across authorization boundaries. `src/scripts/results-live.ts`, `src/pages/[reference]/results/live.ts`, `src/adapters/d1/index.ts` | `3+` | Winston (Architect) |
| DW-010 | Story 1.8 review | Clamp multi-select bounds only after explicit row removal or a stable count change, not while an option label is temporarily blank. `src/scripts/create-poll-form.ts` | `nice` | Amelia (Developer) |
| DW-011 | Story 1.1 review | Update the mode-toggle label when the OS preference changes and no manual override is active. `src/scripts/mode-override.ts` | `nice` | Sally (UX Designer) |
| DW-012 | Story 1.1 review | Consume the two light-mode availability exception tokens when the Epic 7 availability cell ships. `src/styles/tokens.css` | `3+` | Sally (UX Designer) |
| DW-013 | Story 1.1 review round 2 | Re-audit the historical Story 1.2 middleware-scope bundle as separate current findings before changing it; several original observations were superseded by the present request-context → telemetry → session → CSRF → creator-guard chain. `src/middleware.ts`, `src/lib/csrf.ts` | `3+` | Winston (Architect) |
| DW-014 | Story 1.1 and Story 1.2 reviews | Restore `.astro` static checking when `@astrojs/check` supports the pinned TypeScript 7 stack. `package.json` | `3+` | Amelia (Developer) |
| DW-015 | Story 1.1 review round 2 | Make the deploy JSONC parser accept block comments and BOM like Wrangler. The parser now lives in `scripts/deploy-config.mjs`. | `nice` | Amelia (Developer) |
| DW-016 | Story 1.2 review | Replace Better Auth's per-isolate/default auth-endpoint limiter with an explicit production-safe policy if abuse evidence warrants it. `src/pages/api/sign-in.ts`, `src/adapters/auth/index.ts` | `3+` | Winston (Architect) |
| DW-017 | Story 1.2 review | Remove duplicate `createAuth()` / session reads on cookie-bearing Better Auth traffic without weakening middleware behavior. `src/middleware.ts`, `src/pages/api/auth/[...all].ts` | `nice` | Amelia (Developer) |
| DW-018 | Story 1.2 review | Decide whether same-origin `text/plain` forms belong in the CSRF body-transport contract; there are no current consumers. `src/lib/csrf.ts` | `3+` | Winston (Architect) |
| DW-019 | Story 1.2 review | Align the masked `.dev.vars` parser with runtime dotenv semantics for comments, whitespace, and `BETTER_AUTH_URL` validation. `scripts/provision-auth-secrets.zsh` | `nice` | Amelia (Developer) |
| DW-020 | Story 1.2 review | Add a bounded TTY/auth preflight so remote masked provisioning cannot wait indefinitely for Wrangler browser login. `scripts/provision-auth-secrets.zsh` | `nice` | Amelia (Developer) |
| DW-021 | Story 1.3 review | Make an explicit product/performance decision about caching canonical public Poll delivery; every unknown root reference currently reads D1. `src/lib/poll-delivery.ts`, `src/pages/[reference].astro` | `3+` | Winston (Architect) |
| DW-022 | Story 1.3 review round 2 | Define corrupt-state handling for an owned Poll with no canonical `poll_reference` row. `src/adapters/d1/index.ts` | `3+` | Winston (Architect) |
| DW-023 | Story 1.3 review round 3 | Rebuild `poll_reference` if a future multi-reference design needs a safe default for `is_canonical`; current writers set it explicitly. `db/migrations/0004_polls.sql`, `src/adapters/d1/index.ts` | `3+` | Winston (Architect) |
| DW-024 | Story 1.3 review round 4 | Establish a request-size policy so creator POST bodies are not fully materialized twice without a cap. `src/lib/csrf.ts`, `src/pages/creator/new.astro` | `3+` | Winston (Architect) |
| DW-025 | Story 1.3 review round 6 | Add `private, no-store` to the reachable signed-out creator-guard redirect consistently, not only moderation. `src/middleware.ts` | `nice` | Amelia (Developer) |
| DW-026 | Story 1.2 review round 2 | Design a distinct transient-auth-lookup outcome instead of presenting D1 failure as signed-out. `src/middleware.ts` | `3+` | Sally (UX Designer) |
| DW-027 | Story 1.2 review round 2 | Clear the non-sensitive creator-session marker when sign-out succeeds after a failed pre-handler session lookup. `src/middleware.ts` | `nice` | Amelia (Developer) |
| DW-028 | Story 1.2 review round 2 | Give provider-email lookup outages truthful retry/account-linking behavior instead of a misleading local-verification denial. `src/adapters/auth/index.ts` | `3+` | Winston (Architect) |
| DW-029 | Story 1.2 review round 2 | Add a remote schema preflight proving migration 0003 is present before auth code depends on its uniqueness guarantee. `db/migrations/0003_user_email_case_insensitive.sql`, `scripts/deploy.mjs` | `3+` | Winston (Architect) |
| DW-030 | Story 1.4 review | Continue monitoring D1's error text used to classify custom-link uniqueness collisions; no structured driver code currently exists. `src/adapters/d1/index.ts` | `3+` | Amelia (Developer) |
| DW-031 | Story 1.4 review | Add a `poll_reference.kind` schema constraint and checked adapter mapping through a forward migration if another writer is introduced. `db/migrations`, `src/adapters/d1/index.ts` | `3+` | Winston (Architect) |
| DW-032 | Story 1.4 review | Keep migration 0004's superseded multi-reference comment as immutable history; the substitution design remains documented in the Story 1.4 decision record. `db/migrations/0004_polls.sql` | `3+` | Winston (Architect) |
| DW-033 | Story 1.4 review round 2 | Revisit the theoretical generated-reference case-fold collision only if the reserved-reference design changes; current probability and guards make it non-actionable. `src/lib/poll-delivery.ts`, `src/adapters/d1/index.ts` | `3+` | Winston (Architect) |
| DW-034 | Story 1.4 review round 2 | Reassess whether exact lookup → bounded case-fold fallback → redirect needs a named application seam. `src/lib/poll-delivery.ts`, `src/adapters/d1/index.ts` | `3+` | Winston (Architect) |
| DW-035 | Story 1.4 review round 2 | Make authenticated create-poll E2E retries generate a fresh slug or clean per attempt. `tests/e2e/create-poll-authed.spec.mjs`, `tests/e2e/creator-session.mjs` | `nice` | Quinn (QA) |
| DW-036 | Story 1.4 review round 2 | Add signed-out seed-based coverage for the case-variant 301/404 contract; CI already provisions auth so present coverage is unconditional there. `tests/e2e/create-poll-authed.spec.mjs` | `nice` | Quinn (QA) |
| DW-037 | Story 1.4 review round 3 | Decide whether corrupt orphan reference rows should recheck reachability before a case-fold redirect; foreign-key cascades prevent the state in normal writes. `src/lib/poll-delivery.ts`, `src/adapters/d1/index.ts` | `3+` | Winston (Architect) |
| DW-038 | Story 1.5 review | Decide whether scripted POSTs to case-variant custom slugs should preserve a ballot across canonicalization; rendered forms always post to canonical paths. `src/lib/poll-delivery.ts` | `3+` | Winston (Architect) |
| DW-039 | Story 1.5 review | Implement adapter rendering for `extension:*` vote contributions only with the first real Comment or Voter-Code consumer. `src/modules/voting/index.ts`, `src/adapters/d1/index.ts` | `3+` | Winston (Architect) |
| DW-040 | Story 1.5 review | Treat `VOTE_DIGEST_SECRET` rotation as a planned integrity incident because prior duplicate claims become incomparable. The operational warning remains in `README.md`. | `3+` | Winston (Architect) |
| DW-041 | Story 1.5 review | Reduce the replay pre-read amplification on throttled Vote floods without weakening replay-before-challenge correctness. `src/lib/poll-delivery.ts`, `src/modules/voting/index.ts` | `3+` | Winston (Architect) |
| DW-042 | Story 1.5 review | Bind the cosmetic vote-flash proof to the voter token if replayed confirmation banners become a real UX problem. `src/lib/poll-delivery.ts` | `nice` | Amelia (Developer) |
| DW-043 | Story 1.5 review | Decide whether `/api/health` should perform deeper D1/rate-limiter checks; its current presence-only contract is intentionally side-effect free and production is now smoked. `src/pages/api/health.ts`, `.github/workflows/deploy.yml` | `3+` | Winston (Architect) |
| DW-044 | Story 1.5 review | Reject or safely encode an unquoted `#` if future provider credential formats can contain one. `scripts/provision-auth-secrets.zsh` | `nice` | Amelia (Developer) |
| DW-045 | Story 1.5 review | Widen or version-pin the staging smoke retry window for first-deploy route propagation. `scripts/smoke.mjs`, `.github/workflows/deploy.yml` | `nice` | Amelia (Developer) |
| DW-046 | Story 3.3 review | Replace `classifyNoChange`'s exhaustiveness throw with a safe outcome if `DISCOVERY_STATES` gains a value. `src/adapters/d1/index.ts` | `3+` | Amelia (Developer) |
| DW-047 | Story 3.3 review | Reject corrupt empty Poll questions in the moderation target mapper. `src/adapters/d1/index.ts` | `nice` | Amelia (Developer) |
| DW-048 | Story 3.3 review | Reject corrupt empty canonical references in the moderation target mapper. `src/adapters/d1/index.ts` | `nice` | Amelia (Developer) |
| DW-049 | Story 3.4 review | Make the no-JavaScript mode-toggle pressed state reflect OS preference or remove the misleading pressed state from the static baseline. `src/components/site-header.astro`, `src/scripts/mode-override.ts` | `nice` | Sally (UX Designer) |

- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-comment-with-your-vote.md`
  summary: Prevent a post-commit vote-flash signing failure from rendering a fresh retry that can duplicate a Vote when duplicate checks are disabled.
  evidence: `src/lib/poll-delivery.ts` persisted the Vote before flash signing at the Story 4.1 baseline; a signing exception falls into the broad retry path and replaces the submission ID.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-comment-with-your-vote.md`
  summary: Replace the timed in-flight Vote-form restore with a completion-aware recovery contract that cannot mint a fresh submission ID while the original POST may still commit.
  evidence: `src/scripts/vote-form.ts` already restored the form after ten seconds at the Story 4.1 baseline; when Session and IP Checks are both off, a slow original request and the fresh-ID retry can both commit Votes.

### DW-50: Follow-up review still recommended for 4-1-comment-with-your-vote after the damping cap was spent
origin: review-budget-followup
location: n/a
source_spec: `spec-4-1-comment-with-your-vote.md`
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20260804-223921-acae; this entry preserves the lingering recommendation for a deliberate later review.
status: open
