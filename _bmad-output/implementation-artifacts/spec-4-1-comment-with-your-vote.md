---
title: 'Story 4.1: Comment With Your Vote'
type: 'feature'
created: '2026-08-04T22:44:33-04:00'
status: 'done'
baseline_revision: '4313dbc6a199064f4b75b171ae83fdaf1173e567'
final_revision: '4483792a3dd24c371cc32469a548a1fb59be16c6'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** A voter can submit only ballot selections, so known-group polls cannot collect the short context and display name that make a vote understandable. Comments must not weaken the vote transaction, replay, privacy, or failure-recovery contracts.

**Approach:** Add an opt-in poll setting and a typed Comment contribution to the voting application command, persist it atomically with an accepted vote, and extend the server-rendered voter form so safe values survive every retryable failure.

## Boundaries & Constraints

**Always:** Keep Comment policy in the domain/application layer; accept at most one trimmed plain-text Comment of 500 UTF-16 code units and one trimmed display name of 80 UTF-16 code units; treat a blank Comment as no Comment and discard a name submitted without a Comment; include canonical Comment/name in new idempotency hashes while preserving the legacy no-Comment hash; write Comment, Vote facts, claims, and one representation-version increment in one D1 batch; escape echoed values and exclude both fields from telemetry and discovery; render the composer only for enabled Polls; preserve values and selections through safe failures.

**Block If:** Implementing the accepted behavior would require exposing enforcement data, weakening duplicate/replay checks, editing a committed migration, or adding an off-repo service or credential.

**Never:** Display Comment lists or add moderation/export behavior reserved for Stories 4.2–4.4; persist a standalone or name-only Comment; add avatars, replies, reactions, rich text, a client framework, or raw Comment/name data to logs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Enabled acceptance | Valid ballot plus Comment and optional name | One Vote and one Comment commit; version increments once | No error expected |
| No Comment | Valid ballot with blank Comment or name-only input | Vote commits with no Comment row; legacy hash remains compatible | Name is ignored |
| Disabled forgery | Non-empty Comment fields on a disabled Poll | Nothing commits | Safe `422`; values are not echoed |
| Invalid Comment | Over-limit body/name or invalid ballot | Nothing commits; safe selections and fields remain visible | Field-level `422` with fresh submission ID |
| Exact replay | Same submission ID and canonical ballot/Comment/name | Existing accepted result; no limiter, CAPTCHA, Vote, or Comment duplication | `303` success flow |
| Divergent replay | Same submission ID with changed ballot, Comment, or name | Winner remains unchanged | Safe idempotency-conflict `422` |
| Operational/security rejection | CAPTCHA, limiter, duplicate claim, closed Poll, or D1 failure | Zero orphan Comments and no spurious version bump | Preserve safe fields where an HTML retry is possible |

</intent-contract>

## Code Map

- `src/modules/voting/index.ts` -- vote command, normalized replay payload, contribution batch, and atomicity boundary.
- `src/modules/comments/index.ts` -- new provider-free Comment normalization and contribution policy.
- `src/adapters/d1/index.ts` -- Poll snapshots and the single D1 Vote batch.
- `src/lib/poll-delivery.ts` -- inbound form parsing, replay preflight, safe failure mapping, and re-render state.
- `src/components/poll-definition-fields.astro` -- shared creator create/edit configuration surface.
- `src/components/poll-voting-surface.astro` -- SSR voter form and canonical field order.
- `src/scripts/vote-form.ts` -- in-flight state, retry restoration, and Comment counter.
- `db/migrations/` -- forward-only Poll flag and Vote-owned Comment storage.

## Tasks & Acceptance

**Execution:**
- [x] `db/migrations/0012_vote_comments.sql`, `db/migrations.manifest.json` -- add `poll.comments_enabled` plus a Vote-owned Comment table with stable ID, unique `vote_id`, cascade FK, bounded checks, timestamp, and newest-first index; refresh checksums.
- [x] `src/modules/comments/index.ts`, `src/modules/voting/index.ts`, `src/modules/polls/definition.ts`, `src/modules/polls/poll-lifecycle.ts` -- implement canonical Comment policy, opt-in definition state, typed contribution, replay-compatible hashing, and application-layer validation.
- [x] `src/adapters/d1/index.ts`, `src/adapters/d1/demo-poll.ts` -- project the setting and map only the typed Comment contribution into the existing atomic batch; keep the demo explicitly disabled.
- [x] `src/lib/creator-lifecycle-form.ts`, `src/pages/creator/new.astro`, `src/pages/creator/polls/[pollId].astro`, `src/components/poll-definition-fields.astro` -- accept and preserve the opt-in setting through creator create/edit under existing definition-edit authorization and locking rules.
- [x] `src/lib/poll-delivery.ts`, `src/components/poll-voting-surface.astro`, `src/components/comment-composer.astro`, `src/scripts/vote-form.ts` -- render composer between options and Turnstile, validate/echo safe fields, count down the final 50 characters, and keep controls visible/read-only during `COUNTING…` then editable after retry.
- [x] `tests/unit/comments.test.ts`, `tests/unit/voting.test.ts`, `tests/unit/telemetry.test.ts` -- cover normalization boundaries, legacy/exact/divergent replay, disabled policy, and telemetry exclusion.
- [x] `tests/integration/votes-adapter.integration.test.ts`, `tests/integration/vote-route.integration.test.ts`, `tests/integration/creator-poll-lifecycle-route.integration.test.ts` -- prove configuration persistence, HTML contracts, atomic rollback, collision behavior, and exactly one version increment.
- [x] `tests/e2e/vote.spec.mjs`, `tests/e2e/captcha.spec.mjs`, `tests/e2e/creator-poll-lifecycle.spec.mjs` -- prove no-JS submission, counter, DOM order, preservation, accessibility, CAPTCHA retry, and creator configuration with screenshot/console evidence.
- [x] `CHANGELOG.md`, `README.md`, `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` -- record the shipped capability and new Comment module/storage seam.

**Acceptance Criteria:**
- Given a creator is defining an eligible Poll, when Comments are enabled and saved, then its voting page exposes one optional Comment and display-name composer; when disabled, no composer or placeholder copy exists.
- Given an enabled open Poll, when a voter submits a valid ballot and Comment, then the accepted Vote and escaped plain-text Comment commit atomically and the Poll representation version advances exactly once.
- Given any rejected or replayed submission, when the request completes, then no orphan or duplicate Comment exists, divergent content conflicts safely, and retryable HTML retains every safe ballot field.
- Given JavaScript is unavailable or a keyboard/screen-reader user operates the form, when they vote or recover from failure, then native submission works, focus and labeling remain coherent, the final-50 counter is understandable, and no console error occurs.
- Given telemetry, discovery, or any pre-Story-4.2 public projection is inspected, when a Comment vote is processed, then Comment bodies and display names are absent.

## Spec Change Log

## Review Triage Log

### 2026-08-04 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 1, medium 4, low 1)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` Added an in-transaction D1 guard so a concurrent Creator disable cannot commit a Comment on a disabled Poll.
  - `[medium]` `[patch]` Reloaded the authoritative Poll on `comments_disabled` so the retry hides the composer and never echoes disabled fields.
  - `[medium]` `[patch]` Discarded name-only input before display-name bounds validation so an irrelevant long name cannot block a Vote.
  - `[medium]` `[patch]` Re-rendered safe ballot and Comment values on post-parse operational failures instead of returning a body-only 500.
  - `[medium]` `[patch]` Rejected Comment contributions whose `voteId` does not match the Vote batch owner.
  - `[low]` `[patch]` Applied the required `body-lg` reading typography to the Comment textarea.

### 2026-08-04 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 1, medium 4, low 1)
- defer: 1: (high 1, medium 0, low 0)
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[high]` `[patch]` Classified the D1 `comments_disabled` trigger abort and refreshed the authoritative Poll so a disable race returns a safe `422` without echoing stale Comment fields; corrected the route test to reach the trigger boundary.
  - `[medium]` `[patch]` Canonicalized browser-expanded CRLF textarea line endings to LF before UTF-16 validation, replay hashing, and persistence.
  - `[medium]` `[patch]` Rejected NUL characters at the Comment policy and adapter boundaries before SQLite text-length checks can turn them into a generic failure.
  - `[medium]` `[patch]` Rejected empty Comment IDs at the D1 adapter boundary so every persisted Comment keeps a stable non-empty identity.
  - `[medium]` `[patch]` Rechecked trimmed and line-ending-normalized canonical Comment content before D1 writes instead of trusting structurally constructible strings.
  - `[low]` `[patch]` Reused `COMMENT_CAPS.body` in the browser counter instead of duplicating the `500` limit.

### 2026-08-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 2, medium 6, low 2)
- defer: 1: (high 1, medium 0, low 0)
- reject: 6: (high 1, medium 2, low 3)
- addressed_findings:
  - `[high]` `[patch]` Bounded attacker-sized Comment and display-name echoes while retaining a deterministic field-error surface.
  - `[high]` `[patch]` Cleared Comment values and hid the stale composer before an authoritative disabled-state refresh so a failed re-read cannot expose disabled fields.
  - `[medium]` `[patch]` Rejected duplicate Comment/display-name fields instead of accepting an ambiguous first value.
  - `[medium]` `[patch]` Rejected multipart File values in Comment/display-name fields instead of coercing them into a no-Comment Vote.
  - `[medium]` `[patch]` Rechecked authoritative Comment enablement before returning validation errors so a concurrent disable stays privacy-safe.
  - `[medium]` `[patch]` Rejected embedded line breaks in forged display names at the domain and adapter boundaries.
  - `[medium]` `[patch]` Rejected tampered creator Comment-setting values instead of silently mapping them to disabled.
  - `[medium]` `[patch]` Made authoritative Comment-setting projections required so incomplete adapters and fixtures fail type checking.
  - `[low]` `[patch]` Counted server-rendered retry text after CRLF-to-LF normalization so the fallback counter matches browser semantics.
  - `[low]` `[patch]` Required Comment and owning Vote timestamps to match at the D1 adapter boundary.

## Design Notes

The no-Comment hash must remain byte-for-byte compatible with accepted pre-deploy submissions. Only submissions with a canonical non-blank Comment use the extended payload. Comment configuration follows the existing poll-definition edit boundary so authorization and post-vote locking are not reopened.

## Verification

**Commands:**
- `pnpm migrations:guard` -- migration ordering and committed-history integrity pass.
- `pnpm test && pnpm check && pnpm test:e2e` -- unit, workerd integration, types, browser behavior, and screenshots pass.
- `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` -- generated bindings remain stable and the production artifact builds cleanly.

## Auto Run Result

Status: done

### Summary

Completed a fresh full-diff adversarial follow-up review of Story 4.1 and hardened the Comment boundary without changing the accepted intent. Ambiguous, file-valued, multiline, tampered, and attacker-sized input now fails safely; concurrent Comment disablement stays privacy-safe even when its authoritative refresh fails; and authoritative types plus D1 timestamp checks prevent incomplete or inconsistent Comment facts.

### Files Changed

- `src/lib/poll-delivery.ts`, `src/modules/comments/index.ts`, `src/modules/voting/index.ts` -- harden inbound Comment parsing, canonical policy, validation-order races, and privacy-safe disabled outcomes.
- `src/modules/polls/definition.ts`, `src/modules/polls/index.ts`, `src/modules/polls/poll-lifecycle.ts`, `src/lib/creator-lifecycle-form.ts`, `src/pages/creator/new.astro` -- reject tampered configuration and require authoritative Comment-setting projections.
- `src/adapters/d1/index.ts`, `src/components/comment-composer.astro` -- enforce timestamp/display-name invariants and align SSR counter length with browser newline normalization.
- `tests/unit/*`, `tests/integration/*` -- add regression coverage and update authoritative fixtures for the strengthened contracts.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- append only the new pre-existing slow-POST/fresh-submission risk; leave every existing ledger entry unchanged.

### Review Findings

- Applied 10 patches: 2 high, 6 medium, and 2 low.
- Deferred 1 new pre-existing high-consequence timed Vote-recovery issue as a new append-only ledger entry.
- Rejected 6 duplicate, workflow-transient, speculative future-story, or non-actionable observations after deduplication and baseline comparison.
- Follow-up review remains recommended because this pass changed request parsing, race/privacy behavior, domain validation, authoritative types, and adapter data-integrity checks across multiple layers.

### Verification

- `pnpm migrations:guard` -- passed for 12 checksummed migrations under Node 24.18.0.
- `pnpm test` -- 86 files and 1,287 tests passed.
- `pnpm check` -- passed.
- `pnpm test:e2e` -- all 159 Chromium tests passed in 13.3 minutes, including Comment composition, no-JavaScript retry, in-flight recovery, creator configuration, race, privacy, and visual-proof paths.
- `pnpm types` plus `git diff --exit-code worker-configuration.d.ts` -- passed with no binding drift.
- `pnpm build:production` and `git diff --check` -- passed; unrelated regenerated historical screenshots were restored exactly before final diff review.

### Residual Risks

- The existing deferred post-commit flash-signing risk remains open and unchanged under orchestrator ownership.
- A pre-existing timed browser restore can still mint a fresh submission ID while the original Vote POST may commit when duplicate checks are disabled; this review appended it as a new ledger entry without altering the current recovery contract.
- The Story 4.1 implementation and review fixes are local only; nothing was pushed, deployed, or applied to remote D1 environments.
