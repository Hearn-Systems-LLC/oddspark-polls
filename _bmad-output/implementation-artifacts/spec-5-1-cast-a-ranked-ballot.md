---
title: 'Story 5.1: Cast a Ranked Ballot'
type: 'feature'
created: '2026-08-06T17:04:00-04:00'
status: 'done'
baseline_revision: '63e82252d6b1f7b388a3b82ce6e1ce034033e3a0'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Oddspark cannot create Ranked-Choice Polls or accept an ordered partial Ballot, so the normalized source facts required for deterministic IRV do not exist.

**Approach:** Register Ranked Choice through the existing Poll Type strategy boundary, add an accessible server-first rank builder, and persist each accepted ordered preference atomically with the existing Vote, Comment, claims, idempotency, and representation-version facts. Keep Results and export explicitly unavailable until their later Epic 5 stories.

## Boundaries & Constraints

**Always:** Treat a Ballot as a non-empty ordered subset with unique known options and contiguous one-based ranks; validate at browser, domain, delivery, and adapter boundaries; preserve legacy Multiple-Choice payload/idempotency behavior; keep ranked facts normalized and transactional; use the authoritative Poll Type; retain shared lifecycle/security/visibility/Comments rules; provide functional no-JavaScript ranking; use exactly one polite summary announcement per enhanced action; make ranked Results/export private, no-store, and honestly unavailable.

**Block If:** A real Ranked-Choice strategy cannot satisfy the frozen Poll Type contract without changing its version; atomic persistence cannot include every ranked and shared Vote fact; or the story requires selecting IRV/tie-breaking, round-display, manifest, or production export behavior reserved for Stories 5.2–5.3.

**Never:** Store Ballots or rounds as JSON; infer ranking from option or row order; sort ranked payloads by option ID; trust a client Poll Type; use drag as the required interaction; persist an empty, duplicate, skipped, unknown, or partial-invalid Ballot; render first-choice or multi-select pseudo-results; expose ranked export controls before a complete driver exists.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Ranked creation | Valid shared fields and ordered options | Atomic `ranked_choice` Poll with disabled/null multi-select bounds | Preserve safe values and reject invalid fields without partial facts |
| Rank action | Unranked or ranked option, JS on or off | Assign next rank, or remove and compact later ranks | Rank action never invokes Vote admission or persistence |
| Valid Ballot | Any non-empty contiguous ordered subset | One accepted Vote with exact preference order and shared facts | Exact replay is idempotent; reordered replay conflicts |
| Malformed Ballot | Empty, duplicate/unknown option, or invalid/duplicate/skipped rank | No Vote, preference, Comment, claim, or version change | Stable 422 with safe Ballot and Comment preservation |
| Pre-IRV projection | Ranked Results/live/export request | Truthful unavailable state; no Multiple-Choice projection | Private no-store response without Ballot facts |

</intent-contract>

## Code Map

- `src/modules/polls/types/`, `src/modules/polls/{definition,index,poll-lifecycle}.ts` -- Ranked strategy registration, creation validation, idempotency, and shared definition lifecycle.
- `db/migrations/0013_ranked_ballots.sql`, `src/adapters/d1/index.ts` -- normalized preference constraints and one-batch Poll/Vote persistence.
- `src/modules/voting/index.ts`, `src/lib/poll-delivery.ts` -- discriminated submissions, ordered canonical payloads, validation, recovery, and authoritative strategy resolution.
- `src/components/{poll-definition-fields,poll-voting-surface,rank-builder}.astro`, `src/scripts/{poll-definition-form,vote-form,rank-builder}.ts` -- server-first creation/ranking with isolated enhancement.
- `src/modules/results/`, `src/pages/[reference]/results.astro`, `src/pages/[reference]/results/live.ts`, `src/pages/creator/polls/[pollId].astro` -- fail-closed pre-IRV projection/export boundary and owner lifecycle UI.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/polls/types/`, `src/modules/polls/{definition,index,poll-lifecycle}.ts`, `src/pages/creator/{new,polls/[pollId]}.astro`, `src/components/poll-definition-fields.astro` -- register Ranked Choice, persist its explicit type, omit Multiple-Choice bounds, and support shared pre-first-Vote edits with the existing lock/version contract.
- [x] `db/migrations/0013_ranked_ballots.sql`, `db/migrations.manifest.json`, `src/modules/voting/index.ts`, `src/adapters/d1/index.ts` -- add constrained normalized preferences and atomic typed Vote persistence while preserving existing replay, claim, Comment, race, and rollback semantics.
- [x] `src/lib/poll-delivery.ts`, `src/components/{poll-voting-surface,rank-builder}.astro`, `src/scripts/{vote-form,rank-builder}.ts` -- implement explicit option/rank transport, server rank actions, tap/Space enhancement, compaction, accessible names, exact summary, restoration, and zero-rank submit disabling.
- [x] `src/modules/results/`, `src/pages/[reference]/results.astro`, `src/pages/[reference]/results/live.ts`, `src/pages/creator/polls/[pollId].astro` -- reject ranked projection explicitly, render a truthful private unavailable state, and conceal unsupported export actions.
- [x] `tests/{unit,integration,e2e}/` -- prove the matrix, creation/lifecycle, schema defenses, exact order, atomicity, replay/conflict, no-JS and keyboard behavior, one announcement, safe unavailable projections, responsive modes, and clean console.
- [x] `README.md`, `CHANGELOG.md`, `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md`, `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md`, `_bmad-output/implementation-artifacts/spec-5-1-cast-a-ranked-ballot.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml` -- synchronize implementation truth, run the full repository gate, inspect the scoped diff, and commit only Story 5.1 paths.

**Acceptance Criteria:**
- Given valid shared settings and options, when a Creator publishes Ranked Choice, then one atomic creation persists the explicit type and ordinary lifecycle/security/visibility/Comments facts without JSON or Multiple-Choice bounds.
- Given an open Ranked Poll, when a Voter ranks or unranks by tap, Enter, or Space with or without JavaScript, then author order stays fixed, ranks assign/compact correctly, accessible action names update, and the exact `RANKED {n} OF {total} · UNRANKED OPTIONS COUNT AS NO PREFERENCE` summary is the sole polite announcement.
- Given any valid partial ranking, when submitted, then its exact order and all shared Vote facts commit once; malformed rankings and concurrent integrity failures commit nothing, while exact replay counts once and reordered replay conflicts.
- Given the first accepted ranked Vote, when definition editing is attempted, then the existing lock applies while description, lifecycle, listing/visibility, and tighten-only security behavior remain shared.
- Given a ranked Results/live/export request before Stories 5.2–5.3, when projected, then no misleading Multiple-Choice result or private Ballot fact is exposed and unsupported owner export controls are absent.

## Spec Change Log

- 2026-08-06 — Implemented the registered Ranked Choice strategy, normalized
  atomic Ballot facts, server-first rank builder, creator lifecycle, and
  explicit pre-IRV Results/export boundary without expanding into Stories
  5.2–5.3.

## Review Triage Log

- 2026-08-06 — Full-gate compatibility findings were resolved: legacy creation
  POSTs retain their Multiple-Choice default, Poll Type selectors are precise,
  and description-only locked forms validate their authoritative hidden type.
  All affected groups and the complete gates were rerun green.

## Design Notes

Transport explicit option/rank pairs so malformed ranks remain independently testable. The no-JavaScript surface uses ordinary rank-action submits that mutate only the draft; JavaScript intercepts the same controls for immediate local updates. Ranked canonicalization orders pairs by rank, while the legacy Multiple-Choice canonical payload remains unchanged.

## Verification

**Commands:**
- `source /Users/justin/.nvm/nvm.sh && nvm use && pnpm migrations:checksum && pnpm migrations:guard && pnpm test && pnpm check` -- migration, domain, workerd integration, and type gates pass on pinned Node 24.
- `pnpm test:e2e` -- creation, no-JS, tap/keyboard, recovery, accessibility, responsive visual states, and console checks pass.
- `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` -- generated bindings stay stable, the shipping artifact builds, and the patch is clean.

**Evidence:**
- Migration guard: 13 files and 13 checksums.
- Vitest: 103 files and 1,528 tests passed.
- Playwright: 168 tests passed, including the enhanced and no-JavaScript
  Ranked Choice journeys.
- Responsive proof: eight inspected screenshots under
  `test-results/story-5-1-ranked-choice-proof/` cover fresh, full-ranking,
  compacted-partial, and counted-unavailable states at 375px dark and 1280px
  light.
- Binding generation produced no drift; TypeScript, production build, and
  whitespace checks passed.

## Auto Run Result

Status: done

Agent-doable scope is complete in commits `e2679a8` and `909018c`. No domain,
DNS, credential, vendor-console, deployment, or other operator-only action is
part of this story, so `awaiting-operator` and `operator_actions` do not apply.
