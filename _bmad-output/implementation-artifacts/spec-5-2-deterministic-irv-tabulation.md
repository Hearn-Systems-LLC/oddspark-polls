---
title: 'Story 5.2: Deterministic IRV Tabulation'
type: 'feature'
created: '2026-08-06T18:00:00-04:00'
status: 'done'
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
- [x] `src/modules/results/tabulate-irv.ts` — implement the pure IRV tabulator with safe batch elimination, backward tie-breaking, unresolved halt, and exhaustion tracking; export typed input/output shapes; zero provider imports.
- [x] `src/modules/results/index.ts` — add `RankedTallyProjection`, `RankedResultsView`, and `RankedLiveResultsView` types; replace `ranked_unavailable` early-returns with ranked projection calls; keep Comments empty on ranked views; preserve `RESULTS_COPY.rankedUnavailable` for residual fallback.
- [x] `src/adapters/d1/index.ts` — add `projectRankedResults` to `createResultsPersistence`; one-snapshot SQL joining `ranked_vote_preference`, `vote`, and `poll_option`; map to tabulator input; call pure tabulator; return versioned projection. Authorization check remains in the Results module, not the adapter.
- [x] `src/modules/polls/types/ranked-choice.ts` — widen strategy to include `projectResults` delegating to the shared tabulator; keep `projectExport` returning unavailable.
- [x] `src/pages/[reference]/results.astro` — render ranked Tally for `ranked_visible`; keep CommentList absent; preserve `ranked_unavailable` as defensive fallback.
- [x] `src/pages/[reference]/results/live.ts` — serve ranked live payload when authorized; preserve 204 for hidden states.
- [x] `src/lib/poll-delivery.ts` — extend `PostVoteResultsView` with `ranked_visible`; map through `postVoteResultsFrom`; keep Comments empty.
- [x] `src/components/poll-voting-surface.astro` — render ranked Tally region for `ranked_visible`; keep CommentList absent.
- [x] `tests/unit/tabulate-irv.test.ts` — fast-check property tests for all six invariants plus edge cases.
- [x] `tests/integration/ranked-results-adapter.integration.test.ts` — workerd + D1 tests for adapter correctness and authorization.
- [x] `tests/e2e/ranked-results.spec.mjs` — Playwright journeys for ranked results surfaces.
- [x] `CHANGELOG.md`, `README.md`, `spec-5-2-deterministic-irv-tabulation.md`, `sprint-status.yaml` — synchronize documentation and status.

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

- 2026-08-07 — Code review of branch `story/5-2-deterministic-irv-tabulation` (`aaa04a5` vs `main`/`58b9e0d`). Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor. Suite fails to load (`Cannot find module '../../../src/...'`). Core pure algorithm largely FR-9-aligned; tests and remaining Code Map wiring incomplete.
- 2026-08-07 — Group 1 chunk review (`58b9e0d..HEAD`, tabulator + unit tests only). Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor. **AC pass** on pure tabulator; 0 decision-needed, 7 patch (test strength + Map freeze), ~18 dismissed (null guards under TS contract, MAX_SAFE_INTEGER, unreachable fallthrough, double-majority impossible, empty-options vs empty-ballots shape intentional, ghost-only vs zero-ballot intentional, auditor property-naming residual). All 7 patches applied same day; suite 26/26.
- 2026-08-07 — Group 2 chunk review (Results + D1 ranked ports + strategy + wiring tests). Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor. **AC pass** (AD-9/AD-21, ranked_visible, empty Comments, residual copy, live 304). 0 decision-needed, 5 patch (version strip, AD-24 snapshot, orphan vote fail-closed, residual tests), 3 defer, ~12 dismissed (export deferred to later story, YOUR BALLOT until 5.3, null-throw matches MC, typeof residual untested not product path). All 5 patches applied same day.
- 2026-08-07 — Group 3 chunk review (UI/live/post-vote/e2e). Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor. **AC pass** (ranked_visible render, Comments hidden, no-store, 204 hidden, unresolved as result, no Manifest/export). 0 decision-needed, 5 patch (standing reconcile, 204 reload, init guard, empty labels, aria-live), 4 defer, ~8 dismissed (rounds in JSON intentional until 5.3 table, YOUR BALLOT data path 5.3). All 5 patches applied; story → done.

### Review Findings

#### Decision-needed

- [x] [Review][Decision] Intentional pure-core slice vs full Story 5.2 delivery — **Resolved 2026-08-07 (D1=1):** intentional pure-tabulator intermediate slice; remaining Code Map is next work, not defects in this commit. → defer (product wiring)
- [x] [Review][Decision] Zero-ballot multi-option empty contract — **Resolved 2026-08-07 (D2=1):** early-return zero rounds when `ballots.length === 0`. → patch
- [x] [Review][Decision] Last-remaining winner with zero active ballots — **Resolved 2026-08-07 (D3=1):** keep last-remaining win; relax majority property to allow sole-survivor terminal path. → patch

#### Patch

- [x] [Review][Patch] Fix unit import path (`../../../src` → `../../src`) so the suite loads [tests/unit/tabulate-irv.test.ts:3-9]
- [x] [Review][Patch] A=40/B=30/C=30 must expect unresolved halt naming B+C, not a single non-batch elimination [tests/unit/tabulate-irv.test.ts:82-98]
- [x] [Review][Patch] Safe-batch “fires” fixture currently has majority (4/7 for A); replace with a fixture that actually batch-eliminates [tests/unit/tabulate-irv.test.ts:60-80]
- [x] [Review][Patch] Backward-tie unit test never hits multi-way last-place; rebuild fixture and assert `reason === "backward_tie_break"` + eliminated IDs [tests/unit/tabulate-irv.test.ts:101-113]
- [x] [Review][Patch] Add fast-check property tests for backward tie-break, unresolved halt, and exhaustion (Always + Code Map require all six) [tests/unit/tabulate-irv.test.ts]
- [x] [Review][Patch] Strengthen determinism property to compare full Round evidence (counts, eliminated optionIds/reason, tiedOptionIds, standingCounts) [tests/unit/tabulate-irv.test.ts:208-254]
- [x] [Review][Patch] Sort `eliminated.optionIds` for stable presentation determinism (tiedOptionIds already sorted) [src/modules/results/tabulate-irv.ts:298-301]
- [x] [Review][Patch] Generate non-monotonic rankings in property generators (`fc.subarray` preserves ascending indices) [tests/unit/tabulate-irv.test.ts:216-219]
- [x] [Review][Patch] Deepen exhaustion assertions (`sum(counts) === activeBallotCount`, exhausted leave later Rounds) [tests/unit/tabulate-irv.test.ts:147-163]
- [x] [Review][Patch] Lock multi-round unit cases to expected winner and elimination sequence, not only `resolved`/`rounds.length` [tests/unit/tabulate-irv.test.ts:42-56]
- [x] [Review][Patch] Document input contract: preferences are highest-rank-first; callers must supply rank-ordered IDs [src/modules/results/tabulate-irv.ts:9-10]
- [x] [Review][Patch] Synchronize story bookkeeping: check completed pure-tabulator task, fill Dev Agent Record / evidence as appropriate [spec-5-2-deterministic-irv-tabulation.md]
- [x] [Review][Patch] Zero ballots early-return empty rounds (D2) [src/modules/results/tabulate-irv.ts:177-187]
- [x] [Review][Patch] Relax majority property for last-remaining sole-survivor wins; document both terminal paths (D3) [tests/unit/tabulate-irv.test.ts:257-286] [src/modules/results/tabulate-irv.ts:222-238]

#### Defer

- [x] [Review][Defer] `ReadonlyMap` counts are not JSON-serializable for live/results payloads [src/modules/results/tabulate-irv.ts:26,46] — deferred, wiring will map to arrays/objects
- [x] [Review][Defer] Remaining product wiring (adapter, Results types, live/post-vote UI, integration/e2e, CHANGELOG/README) — **resolved 2026-08-07** by product-wiring pass on this branch

### Review Findings — Group 1 chunk (tabulator + unit tests, 2026-08-07)

Post-merge review of `58b9e0d..HEAD` scoped to `src/modules/results/tabulate-irv.ts` and `tests/unit/tabulate-irv.test.ts`. Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor. Auditor: Group 1 meets tabulator-scoped AC; residuals are test strength only.

#### Decision-needed

_(none)_

#### Patch

- [x] [Review][Patch] Strengthen `backward_tie_break` property to assert FR-9 semantics (eliminated IDs had strictly fewer votes than at least one other member of the same lowest group in the distinguishing prior Round) [tests/unit/tabulate-irv.test.ts] — applied 2026-08-07
- [x] [Review][Patch] Add unit cases for Vote-boundary regressions the pure module documents but does not validate: empty `preferences`, duplicate ranks on one ballot, mixed unknown+real option IDs [tests/unit/tabulate-irv.test.ts] — applied 2026-08-07
- [x] [Review][Patch] Assert `IrvOptionSet.position` never affects elimination/winner (same ballots, permuted positions → identical outcome) [tests/unit/tabulate-irv.test.ts] — applied 2026-08-07
- [x] [Review][Patch] Add a fixed safe-batch fixture with three-or-more options tied for last place [tests/unit/tabulate-irv.test.ts] — applied 2026-08-07
- [x] [Review][Patch] Expand property generators to include partial rankings so exhaustion/partial-majority paths enter the generative surface [tests/unit/tabulate-irv.test.ts] — applied 2026-08-07
- [x] [Review][Patch] Assert round integrity invariants: contiguous `roundNumber` from 1; terminal rounds have `eliminated: null`; `fewest_votes` eliminates exactly one option [tests/unit/tabulate-irv.test.ts] — applied 2026-08-07
- [x] [Review][Patch] Freeze returned `counts` / `standingCounts` Maps (immutable ReadonlyMap wrapper; mutation methods throw) [src/modules/results/tabulate-irv.ts] — applied 2026-08-07

#### Defer

_(none for this chunk)_

**Group 1 outcome:** all 7 patches applied; `pnpm exec vitest run tests/unit/tabulate-irv.test.ts` → 26/26. Story remains `review` until Groups 2–3 (wiring / UI+e2e) are reviewed.

### Review Findings — Group 2 chunk (wiring, 2026-08-07)

Post-merge review of Results module + `ranked-projection` + D1 `projectRanked*` + ranked-choice strategy + integration/unit wiring tests. Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor. Auditor: **Group 2 AC pass**; residuals are snapshot fidelity, version stripping, and tests.

#### Decision-needed

_(none)_

#### Patch

- [x] [Review][Patch] Strip `representationVersion` from the outward `ranked` object in `queryResults` / `queryLiveResults` so live `...view.ranked` JSON cannot leak version (module contract: version lives in ETag/validator only) [src/modules/results/index.ts] — applied 2026-08-07 (`rankedTallyFromVersioned`)
- [x] [Review][Patch] Harden ranked D1 projection snapshot coherence (AD-24): re-read version after prefs; retry up to 3 times on skew [src/adapters/d1/index.ts] — applied 2026-08-07
- [x] [Review][Patch] Fail closed when `vote` rows exist without any `ranked_vote_preference` (orphan Votes) [src/adapters/d1/index.ts] — applied 2026-08-07
- [x] [Review][Patch] Unit-test residual `ranked_unavailable` when ranked port is missing; assert `rankedChoiceStrategy.projectResults` / `projectExport` wiring [tests/unit] — applied 2026-08-07
- [x] [Review][Patch] Assert `view.ranked` has no `representationVersion` on ranked_visible unit paths [tests/unit/results.test.ts] — applied 2026-08-07

**Group 2 outcome:** all 5 patches applied; unit+integration ranked suite green (106 tests across results/ranked-choice/IRV/adapter). Story remains `review` until Group 3.

#### Defer

- [x] [Review][Defer] Spec wording “join poll_option” vs separate options SELECT + knownOptionIds set — behavior correct; wording residual — deferred, non-blocking
- [x] [Review][Defer] Dual-path adapter vs strategy multi-round parity fixtures — deferred, pure tabulator already shared; nice-to-have
- [x] [Review][Defer] Ranked live client exact-key validator parity with MC — deferred to Group 3 UI/live surface

### Review Findings — Group 3 chunk (UI + live + e2e, 2026-08-07)

Post-merge review of RankedResultsSummary, ranked-results-live, results/live delivery, post-vote surface, e2e. Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor. Auditor: **Group 3 AC pass**; residuals include live standing refresh and terminal-status UX.

#### Decision-needed

_(none)_

#### Patch

- [x] [Review][Patch] Live poller reconciles standing list when `finalCounts`/winner/ties change [src/scripts/ranked-results-live.ts] — applied 2026-08-07
- [x] [Review][Patch] On live `204`/`404`, reload like MC so entitlement loss does not leave IRV on screen [src/scripts/ranked-results-live.ts] — applied 2026-08-07
- [x] [Review][Patch] Idempotent live init (`data-live-enhanced` guard) [src/scripts/ranked-results-live.ts] — applied 2026-08-07
- [x] [Review][Patch] Blank winner/tie labels use "—"; empty copy shared with RESULTS_COPY.empty string [src/components/ranked-results-summary.astro, src/scripts/ranked-results-live.ts] — applied 2026-08-07
- [x] [Review][Patch] `aria-live="polite"` on ranked outcome + section aria-label [src/components/ranked-results-summary.astro] — applied 2026-08-07

**Group 3 outcome:** all 5 patches applied. Full story review (Groups 1–3) complete.

#### Defer

- [x] [Review][Defer] Browser live-poller e2e for ranked DOM refresh + ranked 204 visibility journeys — deferred, AC HTTP/e2e SSR coverage exists; full poller e2e is polish
- [x] [Review][Defer] Ranked live exact-key validator parity with MC unit tests — deferred (payload validation strengthened in live client; full suite later)
- [x] [Review][Defer] Post-vote CSS grid placement for `.ranked-results` under `data-post-vote` — deferred visual polish, not AC fail
- [x] [Review][Defer] Round-table / elimination trail / YOUR BALLOT / Comment list on ranked — intentionally Story 5.3

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
- 2026-08-07 — `pnpm exec vitest run tests/unit/tabulate-irv.test.ts` — 19/19 passed after review patches.
- 2026-08-07 — Group 1 review patches: `pnpm exec vitest run tests/unit/tabulate-irv.test.ts` — 26/26; `tsc --noEmit` clean.
- 2026-08-07 — unit: results + comments + ranked-choice + IRV; integration: ranked-results-adapter (4/4); `pnpm check` clean.
- 2026-08-07 — product wiring: adapter → queryResults/queryLiveResults → results.astro / live.ts / post-vote / RankedResultsSummary; Comments empty on ranked; export still unavailable.

## Dev Agent Record

### Agent Model Used

Grok (code review patch pass + product wiring, 2026-08-07)

### Debug Log References

- Pre-patch: suite failed to load (`Cannot find module '../../../src/...'`).
- Fixtures re-derived for safe batch, backward tie-break, A=40/B=30/C=30 unresolved.
- Live payload union split: MC enhancer keeps `LiveMultipleChoicePayload`; ranked uses `pollType: "ranked_choice"` discriminant.

### Completion Notes List

- Pure IRV tabulator + six property invariants + review patches (D2 empty ballots, D3 last-remaining).
- D1 `projectRankedResults` / `projectVersionedRankedResults` snapshot SQL → `tabulateAndProjectRanked`.
- Results authorize then project `ranked_visible`; residual `ranked_unavailable` if port missing.
- Surfaces: RankedResultsSummary, ranked-results-live.ts, post-vote `ranked_visible`, no Comments / no YOUR BALLOT until 5.3.
- Strategy `projectResults` delegates to the same pure path; `projectExport` still unavailable.
- CHANGELOG + README updated; story status `review`.

### File List

- `src/modules/results/tabulate-irv.ts`
- `src/modules/results/ranked-projection.ts`
- `src/modules/results/index.ts`
- `src/modules/polls/types/ranked-choice.ts`
- `src/adapters/d1/index.ts`
- `src/pages/[reference]/results.astro`
- `src/pages/[reference]/results/live.ts`
- `src/lib/poll-delivery.ts`
- `src/components/ranked-results-summary.astro`
- `src/components/poll-voting-surface.astro`
- `src/scripts/ranked-results-live.ts`
- `src/scripts/results-live.ts`
- `src/scripts/results-live-core.ts`
- `tests/unit/tabulate-irv.test.ts`
- `tests/unit/results.test.ts`
- `tests/unit/results-comments.test.ts`
- `tests/integration/ranked-results-adapter.integration.test.ts`
- `tests/e2e/ranked-results.spec.mjs`
- `CHANGELOG.md`
- `README.md`
- `_bmad-output/implementation-artifacts/spec-5-2-deterministic-irv-tabulation.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/deferred-work.md`
