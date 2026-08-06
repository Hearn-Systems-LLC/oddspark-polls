---
title: 'Epic 4 Follow-up Reviews'
type: 'bugfix'
created: '2026-08-06T02:15:08-04:00'
status: 'done'
baseline_revision: '309f1495fb8f1b909228d4e6a7d163dd93126b07'
final_revision: '76b2aac49e27005ac0022da93c001e7679507640'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1-comment-with-your-vote.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-3-csv-export.md'
warnings:
  - multiple-goals
  - oversized
---

<intent-contract>

## Intent

**Problem:** Story 4.1 Comment With Your Vote and Story 4.3 CSV Export were finalized after their configured follow-up-review budget was exhausted, leaving two explicit independent-review recommendations unresolved.

**Approach:** Perform fresh code and security reviews against the current checkout and each shipped intent contract, repair only confirmed current defects, add regression evidence at the narrowest responsible boundary, and run the complete local release gate.

## Boundaries & Constraints

**Always:** Preserve atomic Vote/Comment/replay/version semantics; validate every persistence contribution before any D1 call; keep export owner authorization, one-snapshot projection, positive allowlist, formula defense, private delivery, and telemetry privacy intact; treat a clean independent review with no confirmed defect as valid completion evidence; leave `_bmad-output/implementation-artifacts/deferred-work.md` byte-for-byte unchanged because the orchestrator owns DW-50 and DW-51 resolution.

**Block If:** A safe fix requires a new product contract for request-body size, CSV size, asynchronous export, Poll identity reuse/ownership reassignment, a migration, dependency, binding, credential, or a change to a shipped Story 4.1/4.3 intent boundary.

**Never:** Edit, reopen, resolve, or append ledger entries; duplicate DW-113/DW-114; invent CSV truncation or a size cap; weaken authorization, replay, duplicate-vote, Comment privacy, or export privacy; edit committed migrations; push or deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cross-Poll Vote batch | Vote belongs to Poll A while version increment names Poll B | Reject before preparing or batching D1 statements | Deterministic adapter error; zero mutation |
| Malformed Comment contribution | Invalid Comment ID or unsafe/negative timestamp, including an otherwise matching Vote timestamp | Reject before any D1 call | Generic adapter error; zero mutation |
| Ambiguous display name | Duplicate or File-valued `display_name` on an enabled Comment Vote | No Vote or Comment commits and attacker values are not reflected | Safe validation response with private headers |
| Hostile CSV cells | Formula marker after any leading ASCII whitespace in any exported text column | CSV transport prefixes the cell while canonical data remains unchanged | NUL or malformed facts fail closed before attachment delivery |
| Concealed or malformed export | Foreign/missing Poll or corrupt Vote/Comment/selection/Tally facts | Existing concealment and privacy contracts remain exact | Identical private `404` or safe private `500`; no partial attachment |

</intent-contract>

## Code Map

- `src/adapters/d1/index.ts` -- Vote persistence validation, atomic D1 batch construction, and representation-version ownership guard.
- `src/modules/comments/index.ts` -- canonical Comment ID, timestamp, and length predicates reused at adapter boundaries.
- `src/lib/poll-delivery.ts` -- duplicate/File form-field rejection and bounded safe retry rendering.
- `src/modules/results/export.ts`, `src/adapters/d1/export/multiple-choice.ts` -- canonical dataset invariants and one-statement private fact projection.
- `src/adapters/csv/index.ts` -- NUL rejection, formula neutralization, quoting, and deterministic framing.
- `src/pages/creator/polls/[pollId]/export.csv.ts`, `src/lib/export-delivery.ts` -- owner-only private attachment composition and safe failures.
- `tests/integration/votes-adapter.integration.test.ts`, `tests/integration/vote-route.integration.test.ts` -- Story 4.1 adapter and inbound regressions.
- `tests/unit/csv-export.test.ts`, `tests/integration/csv-export-adapter.integration.test.ts`, `tests/integration/csv-export-route.integration.test.ts` -- Story 4.3 security, integrity, and privacy regressions.

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/d1/index.ts`, `tests/integration/votes-adapter.integration.test.ts` -- reject representation-version Poll mismatches and enforce the Comments-owned ID/timestamp/cap predicates before any D1 call; prove zero prepare/bind/batch activity and zero stored facts.
- [x] `src/lib/poll-delivery.ts`, `tests/integration/vote-route.integration.test.ts` -- independently review ambiguous Comment form parsing and add missing duplicate/File-valued `display_name` symmetry coverage, patching only if current behavior violates the shipped safe-failure contract.
- [x] `src/modules/results/export.ts`, `src/adapters/d1/export/multiple-choice.ts`, `src/lib/export-delivery.ts`, `src/pages/creator/polls/[pollId]/export.csv.ts` -- review current authorization ordering, one-statement projection, canonical validation, no-partial-delivery, cache headers, and telemetry privacy against Story 4.3; patch only confirmed defects.
- [x] `src/adapters/csv/index.ts`, `tests/unit/csv-export.test.ts`, `tests/integration/csv-export-adapter.integration.test.ts`, `tests/integration/csv-export-route.integration.test.ts` -- verify all leading ASCII-whitespace formula cases and hostile text locations, canonical immutability, and safe malformed-export responses; add focused regressions for uncovered cases without changing canonical data.
- [x] `_bmad-output/implementation-artifacts/spec-epic-4-followup-reviews.md` -- record implementation triage, changed files, verification evidence, and residual risks without editing the deferred-work ledger; the workflow review appends final completion evidence.

**Acceptance Criteria:**
- Given either shipped feature is reviewed from its current source and tests, when a finding is triaged, then it is patched with a focused regression, rejected with current-code evidence, or identified as a contract-level blocker without speculative scope expansion.
- Given a malformed Vote persistence batch, when adapter validation runs, then its declared Vote/Poll ownership, required selection, contribution cardinality, runtime shapes, and timestamps are rejected before the first D1 operation and the representation version cannot diverge from the Vote's Poll; the Poll Type strategy remains authoritative for option membership.
- Given hostile or corrupt export data, when CSV delivery runs, then canonical data stays format-neutral, spreadsheet formulas are neutralized only in CSV, private facts and telemetry identifiers do not escape, and no partial attachment is returned.
- Given the review is complete, when repository evidence is inspected, then DW-50/DW-51 have fresh independent-review evidence, DW-113/DW-114 remain out of scope, the ledger is unchanged, and the pinned full local release gate is green.

## Spec Change Log

- 2026-08-06: Hardened the Vote persistence adapter's pre-D1 ownership and timestamp boundary; added missing display-name form symmetry, complete ASCII-whitespace CSV, canonical-immutability, and malformed-export delivery regressions. Full release gate and final workflow review remain pending.
- 2026-08-06: Applied accepted independent-review fixes for runtime batch structure/cardinality, RFC 3339 persistence timestamps, non-reflection evidence, malformed-response headers, and broader CSV transport regressions. The cross-Poll option/schema finding remains outside the migration-blocked bundle boundary.

## Review Triage Log

### 2026-08-06 — Implementation review pass

- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 1, medium 1, low 0)
- defer: 0
- reject: 2: (high 0, medium 1, low 1)
- addressed_findings:
  - `[high]` `[patch]` Bound the representation increment, selections, claims, Comments, and their timestamps to the owning Vote and Poll before the first D1 operation. Malformed cross-Poll, cross-Vote, and unsafe matching-timestamp batches now fail deterministically with zero prepare, bind, or batch activity.
  - `[medium]` `[patch]` Reused the Comments-owned ID, timestamp, and cap predicates at persistence; added duplicate/File-valued `display_name` symmetry proof, all six leading ASCII-whitespace bytes across all four formula markers and every CSV text location, canonical immutability, and route-level malformed-Comment no-partial-delivery proof.
  - `[medium]` `[reject]` `singletonText` already rejects duplicate and File-valued `comment` and `display_name` entries before Vote submission, so no `src/lib/poll-delivery.ts` production change was justified.
  - `[low]` `[reject]` Export authorization already resolves the owner envelope before private fact projection; the type driver prepares one statement; canonical materialization completes before CSV serialization and `Response` construction; the route retains private no-store/nosniff headers and normalized telemetry does not carry a Poll identifier. No export production-code defect was confirmed.

### 2026-08-06 — Independent review fixes

- patch: 5: (high 2, medium 2, low 1)
- defer: 0
- reject: 1: (high 0, medium 1, low 0)
- addressed_findings:
  - `[high]` `[patch]` Added exact runtime-shape and whole-array preflight before D1, including sparse entries, later-invalid contributions, duplicate selections, multiple Comments, duplicate claim check-kinds, and kind tampering.
  - `[high]` `[patch]` Capped Vote, Comment, claim, and representation timestamps at `253402300799999` milliseconds so accepted Vote facts remain exportable as four-digit-year RFC 3339 timestamps while ordinary `Date.now()` behavior remains unchanged.
  - `[medium]` `[patch]` Strengthened duplicate/File-valued display-name regressions to prove attacker content, filename, and `[object File]` are never reflected.
  - `[medium]` `[patch]` Expanded CSV formula tests to mixed leading ASCII whitespace and safe non-formula cases, and proved NUL rejection plus canonical immutability across every table's headers and rows.
  - `[low]` `[patch]` Proved malformed export failures retain `nosniff` and a nonempty request ID in the existing route/middleware harness.
  - `[medium]` `[reject]` Did not address pre-existing cross-Poll option ownership because it requires a schema or product-contract change explicitly blocked by this bundle.

### 2026-08-06 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 4, low 1)
- defer: 0
- reject: 5: (high 0, medium 2, low 3)
- addressed_findings:
  - `[medium]` `[patch]` Snapshotted the complete runtime batch once before validation and D1 binding, tightened exact-record checks to enumerable own string keys only, and proved accessor-backed and inherited-property inputs cannot change after preflight.
  - `[medium]` `[patch]` Bounded the contribution set to the Poll option cap plus legal claim/Comment facts, required at least one unique selection, and preserved submission-replay precedence with a complete collision fixture.
  - `[medium]` `[patch]` Corrected the artifact's overbroad option-membership claim, made the ledger proof compare explicitly to the recorded baseline, and moved the production bugfix onto `fix/epic-4-followup-reviews` before commit.
  - `[medium]` `[patch]` Retained RFC 3339-safe timestamps, deterministic malformed-runtime errors, and whole-set cardinality checks through the convergence pass.
  - `[low]` `[patch]` Added private cache and request-ID assertions to both ambiguous display-name response paths.

### 2026-08-06 — Unattended review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 12: (high 0, medium 4, low 8)
- addressed_findings:
  - none

## Design Notes

This bundle resolves review recommendations, not product scope. A reviewed path that already satisfies its contract needs evidence rather than churn. The only pre-confirmed repair is the Vote adapter's missing representation-version Poll guard; request-size and unbounded-CSV availability questions remain product decisions unless current evidence proves a shipped contract violation.

The strengthened Vote adapter boundary deliberately validates declared relationship coherence rather than reopening ballot policy: the Poll Type strategy still owns legal selection shape and option-to-Poll membership, while D1 supplies foreign-key existence, rollback, and concurrent-state guards. The CSV transport remains the only layer that neutralizes formulas; the format-neutral canonical dataset is cloned in regressions and proven unchanged after serialization.

## Verification

**Commands:**
- `source /Users/justin/.nvm/nvm.sh && nvm use && pnpm migrations:guard && pnpm test && pnpm check && pnpm test:e2e && pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` -- expected: pinned Node 24.18.0, every repository gate green, no binding drift, production build succeeds, and no whitespace errors.
- `git diff --exit-code 309f1495fb8f1b909228d4e6a7d163dd93126b07 -- _bmad-output/implementation-artifacts/deferred-work.md` -- expected: the orchestrator-owned ledger is byte-for-byte unchanged from the recorded baseline.

**Implementation evidence (2026-08-06):** Node 24.18.0; full Vitest `99/99` files and `1,422/1,422` tests passed; `pnpm check`, migration guard `12/12`, `git diff --check`, and the deferred-work ledger diff check passed. The browser, generated-binding, and production-build portions of the complete local release gate remain pending final workflow review.

**Independent-review focused evidence (2026-08-06):** Node 24.18.0; final focused Vitest `4/4` files and `144/144` tests plus `pnpm check` passed after the accepted fixes and convergence hardening.

**Complete local release gate (2026-08-06):** migration guard `12/12`; full Vitest `99/99` files and `1,450/1,450` tests; TypeScript check; clean-state Playwright `164/164`; generated binding types with no drift; production build; `git diff --check`; and the baseline-to-worktree deferred-ledger comparison all passed. The first Playwright attempt exposed five stale UUID-scoped local E2E users and one listed Poll from prior interrupted cleanup (`157` passed, `3` failed, `4` did not run); those exact fixtures were removed through `cleanupCreator`, zero-state was verified, and the complete rerun passed.

**Files changed:**
- `src/adapters/d1/index.ts` -- validate exact runtime shape, contribution cardinality, Vote/Poll/version ownership, RFC 3339-safe timestamps, and Comments-owned predicates before D1.
- `tests/integration/votes-adapter.integration.test.ts`, `tests/integration/vote-route.integration.test.ts` -- prove zero-D1 malformed-batch rejection and symmetric ambiguous display-name safe failures.
- `tests/unit/csv-export.test.ts`, `tests/integration/csv-export-route.integration.test.ts` -- prove complete leading ASCII-whitespace formula defense, canonical immutability, and safe no-partial malformed-Comment delivery.

**Residual risks:** The existing unbounded-CSV/product-size and request-body decisions remain outside this review bundle. A structurally forged internal selection can still name an option from another Poll because option-to-Poll membership is guaranteed by the Poll Type strategy, not a composite D1 constraint; closing that separate pre-existing adapter/schema defense-in-depth gap requires the migration or contract expansion blocked by this bundle. Vote and submission IDs plus payload hashes continue to rely on their typed application producers rather than duplicating producer-format validation in D1. No limit, truncation, asynchronous path, dependency, binding, migration, or credential was introduced. Nothing was pushed or deployed, and the deferred-work ledger remains untouched.

## Auto Run Result

Status: done

### Summary

Completed follow-up review for Story 4.1 Comment With Your Vote and Story 4.3 CSV Export review bundle. Ran Blind Hunter and Edge Case Hunter parallel review subagents on the diff against baseline `309f1495fb8f1b909228d4e6a7d163dd93126b07`. Triaged 12 review findings (0 intent_gap, 0 bad_spec, 0 patch, 0 defer, 12 reject). No further code changes were required.

### Files changed

- `_bmad-output/implementation-artifacts/spec-epic-4-followup-reviews.md` -- recorded unattended review pass triage log, frontmatter status update to `done`, and final auto run result.

### Review

- Patches applied: `0`
- Items deferred: `0`
- Items rejected: `12` (0 high, 4 medium, 8 low)
- Follow-up review recommended: `false`

### Verification

- Pinned Node `24.18.0`; `pnpm migrations:guard` (12/12) ok.
- Vitest `99/99` files and `1,450/1,450` tests passed.
- `pnpm check` passed cleanly.
- Deferred-work ledger remains byte-for-byte unchanged from baseline.

### Residual risks

- None introduced by this review pass. Pre-existing schema and adapter boundaries remain as documented in Residual Risks above. Nothing was pushed or deployed.


