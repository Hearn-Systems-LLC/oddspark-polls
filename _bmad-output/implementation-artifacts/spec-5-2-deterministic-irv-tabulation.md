---
title: 'Story 5.2: Deterministic IRV Tabulation'
type: 'feature'
created: '2026-08-06T18:00:00-04:00'
status: 'ready-for-dev'
baseline_revision: '58b9e0d'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-1-cast-a-ranked-ballot.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Ranked-Choice Polls persist normalized Ballots (Story 5.1) but expose no Tally. The Results surface returns `ranked_unavailable` for every viewer, live polling returns 204, and the export port throws `export_projection_unavailable`. Without a deterministic tabulator there is no winner, no per-Round evidence, and no way to defend the outcome (FR-9, SM-4).

**Approach:** Implement one pure, provider-free IRV tabulator in `src/modules/results/tabulate-irv.ts` that consumes normalized Ballot facts and produces a complete Round sequence with elimination reasons, exhaustion counts, and an honest unresolved terminal state. Wire it through the existing `ResultsPorts.projectResults` adapter so the live view, closed result, post-vote surface, and tests all consume the same function (AD-9/AR-7). Replace the `ranked_unavailable` branch with a real projection; keep Comments hidden on ranked surfaces until Story 5.3 ships the round-table display. Leave the Manifest route and the ranked export projector explicitly unavailable — those belong to Stories 5.3 and a later export story respectively.

## Boundaries & Constraints

**Always:** Use exactly one pure tabulator function for every consumer (live, closed, post-vote, test); compute Tallies server-side from accepted raw Ballots only (AD-9); authorize visibility before reading any Ballot fact (AD-21/AR-17); preserve the existing `ViewerContext` → envelope → projection order; return `private, no-store` on every ranked response; treat an unresolved tie as a terminal result, never an error; apply safe batch elimination exactly as FR-9 specifies (combined tied votes < next-lowest remaining); break unsafe ties backward through earlier Rounds; halt with named tied options when no earlier Round distinguishes them; track exhausted Ballots per Round; keep the tabulator free of D1, Astro, cookies, request context, or randomness; use `fast-check` property tests for determinism, strict-majority termination, safe batch elimination, backward tie-breaking, unresolved ties, and exhaustion; keep Comment lists hidden on ranked surfaces until Story 5.3; preserve the existing `ranked_unavailable` copy string for any pre-tabulation fallback path that must remain.

**Block If:** The tabulator requires mutating Vote or Ballot facts; the implementation stores aggregated Rounds instead of computing them on demand; the tabulator imports D1, Astro, or provider APIs; the live endpoint leaks Ballot-level data; the unresolved state picks a winner; Comments are exposed on ranked surfaces before Story 5.3; the Manifest route or ranked export projector is implemented here; the `representation_version` increment contract changes; the existing Multiple-Choice projection path is altered.

**Never:** Use randomness or arbitrary tie-breaking; store Rounds as JSON or materialized aggregates; read Ballot rows before authorizing visibility; expose voter identifiers, timestamps, submission IDs, or internal option IDs in any projection; return a misleading Multiple-Choice Tally for a ranked Poll; change the `ranked_unavailable` copy string (it remains the truthful pre-tabulation fallback for any code path that still needs it); emit telemetry containing Ballot content; modify the AD-7 Vote transaction; alter the `ranked_vote_preference` schema; implement the Ballot Manifest route or ranked export projector.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Strict majority | One option holds >50% of active Ballots in a Round | Tabulation stops; that option wins; final Round records the majority count | N/A — normal termination |
| Safe batch elimination | Tied-last group's combined votes < next-lowest remaining option's votes | Entire group eliminated in one Round; elimination reason states "safe batch" | N/A — rule fires correctly |
| Unsafe tie, backward break | Tied-last group not safely batchable; earlier Round distinguishes them | Option(s) with fewer votes in the most recent distinguishing Round eliminated; reason states "backward tie-break" | N/A — rule fires correctly |
| Unresolved tie | Tied options identical in every completed Round | Tabulation halts; terminal state names tied options and standing counts; styled as a result, not an error | No winner declared; Round sequence ends honestly |
| Exhausted Ballot | All ranked options on a Ballot have been eliminated | Ballot leaves active count; exhaustion tracked per Round; subsequent Rounds exclude it | N/A — normal accounting |
| Determinism | Same Ballot set tabulated N times | Identical Round sequence and outcome every time; no randomness anywhere | Property test asserts equality across runs |
| Empty Poll | Zero accepted Ballots | Zero Rounds; empty-state copy preserved; no crash | Existing empty-state handling in results module |
| Single option | One option, any number of Ballots | First Round: option holds 100%; wins immediately | N/A — degenerate but valid |
| Partial Ballots | Ballots ranking subsets of options | Unranked options never receive transfers; exhaustion occurs when all ranked options eliminated | N/A — partial ranking is valid per FR-8 |
| Visibility denied | Viewer not authorized for results | Existing `after_close_hidden` or `creator_only_hidden` returned before any Ballot read | No Ballot rows touched (AD-21) |
| Live conditional poll | Open ranked Poll, authorized viewer, version match | 304 Not Modified with validator; no re-tabulation | Existing live-results contract preserved |
| Post-vote surface | Voter just cast a ranked Ballot | Authorized Tally rendered via same tabulator; Comments hidden; YOUR BALLOT line absent until Story 5.3 | Existing post-vote composition contract preserved |

</intent-contract>

## Code Map

- `src/modules/results/tabulate-irv.ts` (NEW) — pure IRV tabulator: consumes normalized Ballot facts, returns Round sequence with per-option counts, elimination reasons, exhaustion counts, winner or unresolved state. Zero imports from D1, Astro, or providers. This is the single source of truth for ranked-choice outcomes (AD-9/AR-7).
- `src/modules/results/index.ts` (UPDATE) — add `RankedTallyProjection` and `RankedResultsView` types; replace the `ranked_unavailable` early-return in `queryResults` and `queryLiveResults` with a call to the new ranked projection port; keep Comments empty on ranked views until Story 5.3; preserve `RESULTS_COPY.rankedUnavailable` for any residual fallback path.
- `src/adapters/d1/index.ts` (UPDATE) — add `projectRankedResults` to `createResultsPersistence`; reads `ranked_vote_preference` joined to `vote` and `poll_option` in one snapshot; maps rows into the tabulator's input shape; calls the pure tabulator; returns the ranked projection with `representationVersion`. Must NOT read Ballot rows before the Results module authorizes visibility (AD-21).
- `src/modules/polls/types/ranked-choice.ts` (UPDATE) — widen `RankedChoiceStrategy` to include `projectResults` port typed against the new `RankedTallyProjection`; the port delegates to the same pure tabulator used by the Results adapter (one function, four consumers). Keep `projectExport` returning `export_projection_unavailable` — ranked export belongs to a later story.
- `src/pages/[reference]/results.astro` (UPDATE) — render the ranked Tally when `view.kind === "ranked_visible"`; keep CommentList absent on ranked surfaces; preserve the existing `ranked_unavailable` branch as a defensive fallback only.
- `src/pages/[reference]/results/live.ts` (UPDATE) — serve the ranked live payload when authorized; preserve 204 for hidden/unauthorized states; the live payload shape extends `LiveResultsPayload` with ranked-specific fields (Round sequence, exhaustion, unresolved state).
- `src/lib/poll-delivery.ts` (UPDATE) — extend `PostVoteResultsView` with a `ranked_visible` kind carrying the ranked tally; map `queryResults` ranked output through `postVoteResultsFrom`; keep Comments empty on ranked post-vote surfaces.
- `src/components/poll-voting-surface.astro` (UPDATE) — render the ranked Tally region when `postVoteResults.kind === "ranked_visible"`; keep CommentList absent; reuse the existing `showTally` gate.
- `tests/unit/tabulate-irv.test.ts` (NEW) — fast-check property tests covering determinism, strict-majority termination, safe batch elimination, backward tie-breaking, unresolved ties, exhaustion, empty/single-option degeneracies, and partial Ballots. Unit tests run on Node, not workerd.
- `tests/integration/ranked-results-adapter.integration.test.ts` (NEW) — workerd + D1 integration tests proving the adapter reads Ballots correctly, calls the tabulator, respects visibility authorization, and returns the correct projection shape.
- `tests/e2e/ranked-results.spec.mjs` (NEW) — Playwright journeys for open/closed ranked Polls verifying the Tally renders, live polling works, unresolved state displays correctly, and Comments remain hidden.
- `_bmad-output/implementation-artifacts/spec-5-2-deterministic-irv-tabulation.md` (THIS FILE) — story spec and running record.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATE) — transition `5-2-deterministic-irv-tabulation` from `backlog` to `ready-for-dev`.
- `CHANGELOG.md` (UPDATE) — add user-facing entry under `[Unreleased]` describing ranked-choice results availability.
- `README.md` (UPDATE) — note ranked-choice results are now computed and displayed.

## Tasks & Acceptance

**Execution:**
- [ ] `src/modules/results/tabulate-irv.ts` — implement the pure IRV tabulator with safe batch elimination, backward tie-breaking, unresolved halt, and exhaustion tracking; export typed input/output shapes; zero provider imports.
- [ ] `src/modules/results/index.ts` — add `RankedTallyProjection`, `RankedResultsView`, and `RankedLiveResultsView` types; replace `ranked_unavailable` early-returns with ranked projection calls; keep Comments empty on ranked views; preserve `RESULTS_COPY.rankedUnavailable` for residual fallback.
- [ ] `src/adapters/d1/index.ts` — add `projectRankedResults` to `createResultsPersistence`; one-snapshot SQL joining `ranked_vote_preference`, `vote`, and `poll_option`; map to tabulator input; call pure tabulator; return versioned projection. Authorization check remains in the Results module, not the adapter.
- [ ] `src/modules/polls/types/ranked-choice.ts` — widen strategy to include `projectResults` delegating to the shared tabulator; keep `projectExport` returning unavailable.
- [ ] `src/pages/[reference]/results.astro` — render ranked Tally for `ranked_visible`; keep CommentList absent; preserve `ranked_unavailable` as defensive fallback.
- [ ] `src/pages/[reference]/results/live.ts` — serve ranked live payload when authorized; preserve 204 for hidden states.
- [ ] `src/lib/poll-delivery.ts` — extend `PostVoteResultsView` with `ranked_visible`; map through `postVoteResultsFrom`; keep Comments empty.
- [ ] `src/components/poll-voting-surface.astro` — render ranked Tally region for `ranked_visible`; keep CommentList absent.
- [ ] `tests/unit/tabulate-irv.test.ts` — fast-check property tests for all six invariants plus edge cases.
- [ ] `tests/integration/ranked-results-adapter.integration.test.ts` — workerd + D1 tests for adapter correctness and authorization.
- [ ] `tests/e2e/ranked-results.spec.mjs` — Playwright journeys for ranked results surfaces.
- [ ] `CHANGELOG.md`, `README.md`, `spec-5-2-deterministic-irv-tabulation.md`, `sprint-status.yaml` — synchronize documentation and status.

**Acceptance Criteria:**
- Given a set of accepted Ballots, when the tabulator runs, then each Round counts every active Ballot toward its highest-ranked non-eliminated option; an option holding more than 50% of active Ballots wins and tabulation stops; otherwise the fewest-votes option is eliminated (FR-9).
- Given a group of options tied for fewest, when elimination is decided, then the group is batch-eliminated only when its combined votes are less than the next-lowest remaining option's votes; the worked check holds: with A=40, B=30, C=30, B and C are not batch-eliminated.
- Given an unsafe tie, when backward tie-breaking applies, then the tied options' counts are compared in the most recent earlier Round where they differed, and the option(s) with fewer votes there are eliminated.
- Given tied options identical in every completed Round, when no backward tie-break resolves them, then tabulation halts and reports the Poll unresolved at that Round with standing counts and tied options named — a terminal result styled as a result, never an arbitrary elimination and never an error (FR-9, UX-DR19).
- Given a Ballot whose ranked options are all eliminated, when subsequent Rounds run, then it becomes exhausted and leaves the active count, tracked per Round.
- Given the same set of Ballots, when tabulated any number of times, then the sequence of Rounds and the outcome are identical — no randomness anywhere; fast-check property tests cover determinism, safe batch elimination, and the majority invariant.
- Given exactly one pure tabulator, when invoked by the live view, closed result, post-vote surface, or tests, then all four consumers use the same function (AD-9/AR-7).
- Given a ranked Results request before Story 5.3, when projected, then Comments are hidden and the round-table display is absent; only the Tally summary is shown.
- Given a ranked Poll with visibility denied, when queried, then the existing `after_close_hidden` or `creator_only_hidden` response is returned before any Ballot row is read (AD-21).
- Given the Manifest route or ranked export projector, when requested, then both remain explicitly unavailable — neither is implemented in this story.

## Spec Change Log

- 2026-08-06 — Initial story spec created from epics, architecture spine, PRD FR-9, UX-DR19/22, and Story 5.1 implementation intelligence.

## Review Triage Log

(Entries added during code review.)

## Design Notes

The tabulator is a pure function with no side effects. Its input is a flat array of Ballots (each an ordered list of option IDs) plus the option set; its output is a discriminated union of either a winner with Round sequence or an unresolved state with standing counts. The adapter owns the SQL-to-tabulator-input mapping; the Results module owns authorization; the delivery layer owns HTTP shaping. This separation means the tabulator can be tested exhaustively without workerd, D1, or any provider.

Comments remain hidden on ranked surfaces because Story 5.3 owns the round-table display and the Comment-list integration with it. Exposing Comments before the round-table lands would create a visual inconsistency where Comments appear without their surrounding Round context. The deferred-work entry from Story 5.1's review ("keep hidden until IRV lands") is resolved by this story's decision to keep Comments hidden until Story 5.3.

The `ranked_unavailable` copy string is preserved even though the primary path now returns a real Tally. It serves as a defensive fallback for any code path that encounters a ranked Poll before the tabulator is wired (e.g., a stale cache, a partially deployed environment, or a future regression). Removing it would risk a misleading empty state.

The live endpoint extends `LiveResultsPayload` rather than replacing it. The existing conditional-polling contract (AD-10/AR-8) applies unchanged: version-based ETag, 3-second cadence, visibility-gated, coalesced updates. The ranked payload adds Round-sequence and exhaustion fields; the client enhancer ignores fields it doesn't understand, so the existing `results-live-core.ts` validator must be extended to accept the new shape without breaking the old one.

## Verification

**Commands:**
- `source /Users/justin/.nvm/nvm.sh && nvm use && pnpm migrations:guard && pnpm test && pnpm check` — migration guard, domain/unit/integration tests, and type check pass on pinned Node 24.
- `pnpm test:e2e` — ranked-results Playwright journeys pass alongside existing ranked-choice voting journeys.
- `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` — generated bindings stable, shipping artifact builds, patch clean.

**Evidence:**
(To be filled after implementation.)

## Dev Agent Record

### Agent Model Used

(Populated by dev agent.)

### Debug Log References

(Populated by dev agent.)

### Completion Notes List

(Populated by dev agent.)

### File List

(Populated by dev agent.)
