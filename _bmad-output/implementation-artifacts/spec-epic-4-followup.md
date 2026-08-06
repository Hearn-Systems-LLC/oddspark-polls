---
title: 'Epic 4 Follow-up: Vote Recovery Integrity'
type: 'bugfix'
created: '2026-08-06T10:41:36-04:00'
status: 'in-progress'
baseline_revision: '189d8b3ec8f813877a7722fad6c43c68cb99ddfd'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1-comment-with-your-vote.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Two high-severity deferred defects (DW-113, DW-114) let the Vote recovery machinery mint a fresh `submission_id` while the original POST may still commit or has committed: `src/lib/poll-delivery.ts` awaits vote-flash signing after the atomic commit inside the broad retry catch, and `src/scripts/vote-form.ts` replaces the hidden ID on the timed restore. With Session and IP checks both off (FR-15 all-off), a resubmission then commits a second Vote.

**Approach:** Pre-compute the deterministic flash digest before `castVote` so no fallible operation follows the commit, and make the client timed restore retain the original submission ID so the server-side AD-7 idempotency contract adjudicates every retry — replay returns the stored outcome, an edited resubmit conflicts, and no path can double-commit.

## Boundaries & Constraints

**Always:** Preserve the atomic Vote batch, payload-hash replay/conflict adjudication, claim model, and representation-version semantics exactly (AD-7/AD-24); only D1 constraints decide duplicates (AD-16/AR-13/NFR-9); integrity must hold with every Security Toggle off; fresh submission IDs are minted only by the server on renders where rejection is certain and nothing was stored (Story 1.6 ruling); keep ballot/Comment preservation, the 10-second unlock, probe-failure restore, offline messaging, bfcache original-ID restore, and the Turnstile retry reset; keep the flash cosmetic — it governs only the Counted banner, never Vote integrity; telemetry stays voter-blind (AD-15); POST→303 on success and 422-with-preserved-values on rejection unchanged (AR-19).

**Block If:** A safe fix requires changing the replay/hash contract, batch composition, Security Toggle semantics, the idempotency-conflict outcome design, a migration, a dependency, a binding, a new route/endpoint, or a client framework.

**Never:** Mint a submission ID in client code; move or weaken duplicate enforcement into the rate limiter, CAPTCHA, or any client guard; change castVote, the D1 adapter batch, digest construction, or the Turnstile contract; alter the designed conflict/already-voted outcomes; push or deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Flash signing fails | Vote POST passes all preflight but digest signing throws | No commit: zero Vote/selection/Comment/claim rows, no version bump; truthful transient retry outcome with preserved ballot and fresh server-minted ID | 500 retry render; resubmission commits exactly one Vote |
| Committed Vote success path | Valid POST, signing pre-computed | Flash cookie carries the pre-computed proof; 303 to the success redirect is unconditional | No fallible operation remains between commit and response |
| Timed restore, original commits late | POST in flight >10s; original commits | Restored form keeps the ORIGINAL submission ID, ballot, and Comment; identical resubmit returns the stored outcome via replay | Exactly one Vote; edited resubmit gets `IDEMPOTENCY_CONFLICT`, original stands |
| Timed restore, original never commits | Aborted navigation / lost request | Restored form keeps the original ID; resubmit commits cleanly as the only Vote | No error expected |
| Probe-failure and bfcache restores | POST never sent; persisted pageshow | Unchanged existing behavior: original ID retained, challenge reset | No error expected |

</intent-contract>

## Code Map

- `src/lib/poll-delivery.ts` -- Vote POST orchestration; hoist the flash digest ahead of `castVote` so the post-commit success path is non-throwing (DW-113).
- `src/scripts/vote-form.ts` -- timed restore drops the client-side UUID mint and keeps the original ID plus the challenge reset (DW-114).
- `src/modules/voting/index.ts`, `src/adapters/d1/index.ts` -- atomic batch, replay/conflict adjudication (reference only; unchanged).
- `src/adapters/digest/index.ts` -- `createVoteDigest` throw modes (reference only; unchanged).
- `src/components/poll-voting-surface.astro`, `src/scripts/turnstile.ts` -- hidden `submission_id` field and `oddspark:vote-retry-reset` consumer (reference only; unchanged).
- `tests/integration/vote-route.integration.test.ts` -- server regressions for signing failure and post-commit non-throwing ordering.
- `tests/e2e/vote.spec.mjs` -- timed-restore contract flip and exactly-once proof.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-113/DW-114 resolution entries.
- `CHANGELOG.md` -- Unreleased user-facing fix entry.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/poll-delivery.ts` -- pre-compute the flash digest before `castVote` and push that value on success -- after this, no await or fallible call exists between commit and the 303 (DW-113).
- [x] `src/scripts/vote-form.ts` -- delete the fresh-ID mint from the 10s restore; keep `restoreIdleState()` and the `oddspark:vote-retry-reset` dispatch -- the client can never mint an ID while the original POST may commit (DW-114).
- [x] `tests/integration/vote-route.integration.test.ts` -- prove signing failure means zero stored facts plus a truthful retry render with a fresh server ID, and that the success path still sets the flash and replays still bypass preflight.
- [x] `tests/e2e/vote.spec.mjs` -- flip the timed-restore test to assert the original submission ID is retained and a post-restore resubmission still yields exactly one Vote.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark DW-113 and DW-114 done with resolution referencing this spec.
- [x] `CHANGELOG.md` -- record the vote-integrity fix under `## [Unreleased]`.

**Acceptance Criteria:**
- Given a Vote POST whose signing would fail, when the handler runs, then the failure precedes the atomic commit: no rows change, no version increments, and the retry render is safe to resubmit.
- Given a committed Vote, when the success path completes, then the flash cookie uses the pre-computed digest and the 303 cannot be converted into a retry outcome.
- Given an in-flight POST past 10 seconds, when the timed restore fires, then the hidden submission ID is byte-identical to the original and every resubmission is adjudicated by the server as replay or conflict, never a second Vote, with all Security Toggles off.
- Given the bfcache, probe-failure, offline, and CAPTCHA-reset paths, when they run, then their existing contracts hold unchanged.
- Given the fix is complete, when the full local release gate runs, then migration guard, all Vitest projects, type check, Playwright, binding types, production build, and diff checks are green.

## Spec Change Log

## Review Triage Log

## Design Notes

The flash digest is deterministic per Poll (`createVoteDigest(secret, { pollId, checkKind: "session", token: pollId })`), so computing it before `castVote` changes nothing observable except failure ordering: a signing throw now means "not committed" and the existing broad retry path is truthful. The client change generalizes the ratified bfcache rule — the original ID is the recovery identity — to the timed restore; an edited resubmit conflicts only when the original truly committed, which is the truthful "your Vote was already counted" outcome since Votes are final. Fresh IDs remain exactly where Story 1.6 ruled them safe: server re-renders after certain rejection.

## Verification

**Commands:**
- `source /Users/justin/.nvm/nvm.sh && nvm use && pnpm migrations:guard && pnpm test && pnpm check && pnpm test:e2e && pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` -- expected: pinned Node 24.18.0, every repository gate green, no binding drift, production build succeeds, no whitespace errors.

**Implementation evidence (2026-08-06):** Node 24.18.0; migration guard `12/12`; Vitest `100/100` files and `1,502/1,502` tests passed; `pnpm check` clean; Playwright `165/165` passed; generated binding types with no drift; production build succeeded; `git diff --check` clean. The e2e suite's tracked story-4-2 proof PNGs regenerate with nondeterministic pixels on every run and were restored to HEAD as incidental artifacts of gate execution, not of this change.

**Files changed:**
- `src/lib/poll-delivery.ts` -- flash digest pre-computed before `castVote`; success path pushes the pre-computed value (commit `9630bda`).
- `tests/integration/vote-route.integration.test.ts` -- signing-failure regression: zero stored facts, truthful fresh-ID retry, exactly one Vote on resubmission (commit `9630bda`).
- `src/scripts/vote-form.ts` -- timed restore keeps the original submission ID; challenge reset retained; client mint removed (commit `fd736a2`).
- `tests/e2e/vote.spec.mjs` -- timed-restore contract flipped to byte-identical ID plus exactly-one-Vote proof (commit `fd736a2`).
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-113/DW-114 marked done with resolutions.
- `CHANGELOG.md` -- vote-integrity fix entry under `## [Unreleased]`.
