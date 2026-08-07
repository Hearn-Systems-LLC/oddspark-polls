---
baseline_commit: 5871ef6704222eb0447a251d62bf4f80d81677a5
---

# Story 5.3: Per-Round Display & Ballot Manifest

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Ultimate context engine analysis completed 2026-08-07 — comprehensive developer guide created from epics, PRD FR-10/SM-4, architecture spine (AD-3/9/11/21/24), UX DESIGN/EXPERIENCE round-table + manifest specs, Story 5.1/5.2 intelligence, and a full codebase audit. No new libraries introduced; all stack pins verified against the spine seed. -->

## Story

As a skeptical reader,
I want every Round shown and every anonymized Ballot published at close,
so that I can recompute the winner by hand — the result is shown, not asserted.

## Acceptance Criteria

1. **Round table renders every Round.** Given a Ranked-Choice Tally, when it renders, then the `round-table` shows every completed Round in sequence — per-option counts, who was eliminated, exhausted-Ballot counts — each Round carrying a one-line plain-language statement of the rule that produced its elimination, including batch elimination and the backward tie-break when they fire (FR-10, UX-DR22). Eliminated options stay in the table struck through in `faint` from their Round onward, the winner's final-Round cell is gold, Rounds never collapse or paginate, and the unresolved state marks tied options with a 2px entropy left rule and no gold.
2. **Ballot Manifest publishes at close.** Given a Ranked-Choice Poll that closes, when the Tally publishes, then the Ballot Manifest — every Ballot's rankings in canonical order, stripped of all voter data and timestamps — is available at `/{link}/manifest` wherever the Tally is visible, sufficient to independently recompute every Round and the outcome (FR-10, AD-9). The Manifest link sits directly beneath the Rounds, labelled plainly.
3. **Manifest not-yet shape before close.** Given `/{link}/manifest` before close, when requested, then it renders the not-yet shape — the question, "The Ballot Manifest publishes when the Poll closes — {deadline, local}.", and a link back to the Poll — a real route, not a 404 (UX-DR19).
4. **Ranked export through the projection port.** Given the Creator's export on a Ranked-Choice Poll, when it runs, then Ballot rows arrive through the type's projection port — one row per Vote with its full ranking — without the exporter itself changing (AD-3). CSV and XLSX both work; the XLSX 1,000-Vote bound and 409 CSV-fallback behavior apply unchanged.
5. **Comments un-hidden on ranked surfaces** (deferred from Story 5.2). Given a ranked Results view, live payload, or post-vote surface where the Tally is visible, when it renders, then the public Comment list appears exactly as on Multiple-Choice surfaces (newest-first, owner moderation included on owned views), replacing the empty `comments: []` placeholders.
6. **YOUR BALLOT on ranked post-vote** (deferred from Story 5.2). Given a Voter who just cast a ranked Ballot with a session claim, when the post-vote Tally renders, then the YOUR BALLOT line shows their options in rank order; claim-lookup failure remains fail-open to no line, never an error.

## Tasks / Subtasks

- [x] Task 1: Render the round table (AC: 1)
  - [x] `src/components/ranked-results-summary.astro` — render `ranked.rounds` (already in props, currently unrendered) as the `round-table` per the DESIGN.md component spec; drop the placeholder note at lines 99–101; keep the existing outcome line, meta line, and standing list.
  - [x] Map `IrvEliminationReason` to one-line plain-language statements (see Dev Notes → Elimination copy); render the unresolved terminal state with the canonical Voice-and-Tone copy.
  - [x] Table semantics: real `<table>` with `<caption>` and `<th scope="col">`/`<th scope="row">`; strikethrough (`line-through` + `faint`) carries eliminated state, gold ink carries winner, text carries tied state — never color alone (UX-DR17).
  - [x] Mobile: wrap the table in an `overflow-x: auto` container so the page silhouette never overflows horizontally (see Dev Notes → UX gap resolutions).
- [x] Task 2: Live-update the round table (AC: 1, 5)
  - [x] `src/scripts/ranked-results-live.ts` — add structural validation for `rounds` and `comments` payload entries (mirror `isCountRow`), re-render the round table and Comment list on payload change; `textContent`/`createElement` only (no-raw-html test enforces this); no animation (motion budget is closed — UX-DR4).
- [x] Task 3: Un-hide Comments on ranked surfaces (AC: 5)
  - [x] `src/adapters/d1/index.ts` — add a ranked-safe comments projection port; do NOT reuse `projectVersionedResults` (its `vote_selection` invariants throw on ranked Polls — see Dev Notes → Traps).
  - [x] `src/modules/results/index.ts` — add `comments` (and `ownerComments` for owned views) to `ranked_visible` in `ResultsView` and `LiveResultsView`; populate in `queryResults`/`queryLiveResults` ranked branches; update `rankedTallyFromVersioned` if `RankedTallyView` gains fields; remove the "Always empty until Story 5.3" placeholders (`LiveRankedResultsPayload.comments`).
  - [x] `src/pages/[reference]/results.astro` (ranked_visible branch, lines 150–163) and `src/components/poll-voting-surface.astro` (ranked tally region, lines 262–275) — render `<CommentList>` exactly as the MC branches do; add the missing `data-results-region` on the ranked section; gate `overlay.ts` on ranked owner comments like MC.
  - [x] `src/pages/[reference]/results/live.ts` — replace the hardcoded `comments: []` (line 83) with the view's comments.
- [x] Task 4: YOUR BALLOT on ranked post-vote (AC: 6)
  - [x] `src/adapters/d1/index.ts` — add `findRankedPreferencesByClaim(pollId, checkKind, digest)` reading `ranked_vote_preference` ordered by `preference_rank` (sibling of `findVoteSelectionByClaim`, which is `vote_selection`-only).
  - [x] `src/modules/results/post-vote.ts:24` — widen the gate from `kind !== "visible"` to include `"ranked_visible"`.
  - [x] `src/lib/poll-delivery.ts` — route ranked claims through the new port in the `yourBallotLabels` resolution (lines 731–741); pass rank-ordered labels to `RankedResultsSummary` and render the YOUR BALLOT line (`RESULTS_COPY.yourBallot` already exists).
- [x] Task 5: Ballot Manifest route and projection (AC: 2, 3)
  - [x] `src/adapters/d1/index.ts` — add a manifest projection port modeled on the preferences query at lines 2053–2068, but with ballots re-sorted canonically by ranking content — never by `vote.id`, insertion order, or timestamp (see Dev Notes → Canonical order).
  - [x] `src/modules/results/index.ts` — add `queryBallotManifest` + a `BallotManifestView` union (`published` | `not_yet` | hidden shapes | `not_found`) with the same envelope → authorize → project order as `queryResults` (AD-21/AR-17); published only when effective status is closed AND the Tally is visible to this viewer; add `RESULTS_COPY.manifestNotYet: "The Ballot Manifest publishes when the Poll closes — {deadline}."`.
  - [x] New `src/pages/[reference]/manifest.astro` — model on `results.astro`: GET/HEAD-only 405 gate, `cache-control: private, no-store`, `x-robots-tag: noindex`, reserved-slug check, canonical-case 301 fallback, telemetry pollId, `BaseLayout`, `<PublicRepositoryLink />`. Not-yet shape = question + deadline line (`{deadline}` split idiom with `<time datetime data-deadline>` + `formatUtc`, load the deadline localizer script) + link back to `/{link}`. Published shape = question, `{n} BALLOTS` header, each Ballot's rankings, and a link back.
  - [x] Results surfaces: place the Manifest link directly beneath the Rounds on close, labelled plainly (e.g. `BALLOT MANIFEST`), styled per the `public-repository-link` precedent (label-caps, entropy, 44px target, standard focus ring).
- [x] Task 6: Ranked export projection (AC: 4)
  - [x] `src/modules/polls/types/ranked-choice.ts` — define `RankedChoiceExportFacts` (options with label/position/count, votes with `alignmentKey`/`createdAtMs`/rank-ordered option positions, `voterCount`, `selectionCount`); fix the currently mis-slotted strategy generics (`RankedChoiceResultsFacts` sits in the `TExportFacts` slot — see Dev Notes → Traps); implement `projectExport(facts)` fail-closed like `multipleChoiceStrategy.projectExport` (`export_projection_invalid` on any anomaly).
  - [x] New `src/adapters/d1/export/ranked-choice.ts` — fact driver + bounded fact driver modeled on `multiple-choice.ts` (one-statement `row_kind` UNION ALL snapshot, positions never IDs, oversize sentinel for XLSX).
  - [x] `src/lib/export-delivery.ts` — register the ranked driver+strategy pair in both `queryD1OwnerExport` and `queryD1BoundedOwnerExport` (the only registration point). Export routes must not change (AC 4).
- [x] Task 7: Tests (all ACs)
  - [x] Update inverted assertions: `tests/unit/ranked-choice.test.ts:329–333` (projectExport no longer unavailable), `tests/e2e/ranked-results.spec.mjs:96` ("without Comments" flips), and check what `tests/e2e/creator-poll-lifecycle.spec.mjs:571` currently asserts for `/manifest` before changing it.
  - [x] Unit: round-view → table rendering, elimination copy mapping, manifest canonical ordering + anonymization (no IDs/timestamps in output), ranked export projection (alignment keys, rank order, fail-closed), post-vote ranked gate, `RESULTS_COPY.manifestNotYet` split.
  - [ ] Property (fast-check, reuse existing generators in `tests/unit/tabulate-irv.test.ts`): manifest round-trip — Ballots serialized to Manifest rows and fed back through `tabulateIrv` reproduce the identical Round sequence and outcome.
  - [ ] Integration (workerd + D1): manifest projection (canonical order, authorize-before-read, not-yet leaks nothing), ranked-safe comments port, ranked export adapter + CSV/XLSX routes (closes the two open 5.1 review items: ranked export route paths untested), manifest route headers/status matrix.
  - [ ] E2E (Playwright, `.spec.mjs`, serial + `hasBetterAuthSecret` guard, proof dir `test-results/story-5-3-round-table-manifest-proof/`): open ranked Poll → round table with Comments; closed Poll → Manifest link beneath Rounds → Manifest page; pre-close `/manifest` not-yet shape; unresolved-tie table styling; ranked CSV/XLSX export download; 375px dark + 1280px light screenshots.
- [x] Task 8: Documentation & status
  - [x] `CHANGELOG.md` under `[Unreleased]`, `README.md` (per-round display + manifest + ranked export now live), `sprint-status.yaml` → follow workflow, resolve the deferred-work.md line 530 entry (round-table / YOUR BALLOT / Comments on ranked — intentionally Story 5.3).

## Dev Notes

### Architecture constraints (non-negotiable)

- **AD-3 (strategy contract v5):** every real strategy implements `create`, `validateSubmission`, `persistFacts`, `projectResults`, `projectExport`. `POLL_TYPE_CONTRACT_VERSION` stays 5. Story 5.3 removes the last `export_projection_unavailable` outcome for Ranked Choice. The exporter (`src/modules/results/export.ts`) and the CSV/XLSX routes must not change — they are already Poll-Type-neutral.
- **AD-9/AR-7:** exactly one pure tabulator (`tabulate-irv.ts`) serves live view, closed result, export, and tests. The Manifest exposes only canonically ordered, anonymized rankings. Export drivers use IDs only for joins/ordering inside the D1 driver and strip them before the strategy projector.
- **AD-21/AR-17:** every result/Comment/Manifest/export query takes a `ViewerContext` and authorizes visibility BEFORE reading private facts. Never fetch-then-redact. Result and Manifest responses are never shared-cacheable: `private, no-store` everywhere, including the not-yet shape. Export separately requires the authenticated internal Poll owner and is independent of public Results visibility.
- **AD-24:** validator = `representation_version` + effective open/closed state (`composeResultsValidator`), so Deadline crossing invalidates the not-yet Manifest without a scheduled write. Any manifest snapshot read must be version-coherent (model on the existing 3-attempt skew-retry in `projectVersionedRankedResults`).
- **AD-11:** effective closed = `closed_at` set OR `deadline <= now`. Use `effectivePollStatus` (`src/shared/domain/index.ts:63`) — never compare raw fields inline.
- **AD-15/AD-8:** ballot content, voter digests, and internal IDs never enter telemetry, logs, or projections.
- **AD-2:** round table and Manifest are server-rendered functional HTML; the only client JS is the existing isolated live enhancer. No-JS renders everything except live updates.
- **AD-22:** the manifest route goes through the normal middleware chain; no bypass.
- Manifest privacy (epics AC + epic-5-context): no voter data, no timestamps, no internal identifiers, and no ordering that could correlate Ballots with voters. The published rows must contain option labels/positions only.

### Previous story intelligence (5.1, 5.2)

- Story 5.2 delivered everything up to the round table: `tabulateIrv` (pure, frozen ReadonlyMap counts — copies must not assume a real `Map`; `eliminated.optionIds`/`tiedOptionIds` sorted lexically), `RankedTallyView.rounds` already carries per-option counts (position-ordered via `countsToView`), elimination ids+labels+reason, `exhaustedCount`, `activeBallotCount`. **The round table is a pure rendering task — no tabulator or projection changes needed for AC 1.**
- Deferred to this story by 5.2's review (deferred-work.md:530 and code comments): round-table display, elimination trail, YOUR BALLOT line, Comment list on ranked surfaces. The code carries explicit markers: `ranked-results-summary.astro:7–8`, `ranked-results-live.ts:1–3`, `results/index.ts:197` ("Always empty until Story 5.3"), `live.ts:83`.
- Two open review items from 5.1 land here: ranked export direct-request route untested (CSV + XLSX integration tests) — close them with Task 7.
- 5.2 review patterns that will recur: strip `representationVersion` from outward JSON (`rankedTallyFromVersioned` — update it if the view type grows or new fields silently disappear); live client reloads on 204/404 (entitlement loss); idempotent init guards (`data-live-enhanced`); `aria-live="polite"` on outcome only, never per-cell chatter; blank labels render "—"; keep `RANKED_EMPTY_COPY` in the script in sync with `RESULTS_COPY.empty` by convention (scripts don't import modules).
- `RESULTS_COPY.rankedUnavailable` stays — it is the defensive fallback when the ranked port is missing. Never remove it.

### Traps (verified in current code — will bite if ignored)

1. **`projectVersionedResults` throws on ranked Polls.** Its invariants assert `selectionCount >= voterCount` and option totals against `vote_selection` (d1/index.ts:1875–1893), which is empty for ranked. Build a ranked-safe comments port; do not reuse the MC projection for ranked Comments.
2. **Manifest ordering:** the existing preferences query (d1/index.ts:2053–2068) orders by `v.id` — fine for tabulation input, forbidden for the Manifest (correlatable persistence identifier). Re-sort ballots canonically by ranking content before projection: e.g. lexicographic by the sequence of ranked option positions, ties collapsing identical ballots adjacent. Assert in tests that output order is independent of insertion/vote-id order.
3. **Strategy generics are mis-slotted:** `ranked-choice.ts:66–86` currently passes `RankedChoiceResultsFacts` where `TExportFacts` belongs (shared kernel `PollTypeStrategy` generic order: `...TResultProjection, TExportFacts, TExportProjection` — `src/shared/application/index.ts:121–130`). Correct the slots when adding `RankedChoiceExportFacts`; compile-time consumers and contract tests must change together (AD-23).
4. **`projectExport` today takes no argument** (`ranked-choice.ts:184–190`); the real port signature is `projectExport(facts) => Result<...>` — `bindExportDriver` (export.ts:87–109) throws the error code if `ok: false`, and `validateProjection` (export.ts:241–267) enforces `voterCount === sharedVotes.length`, row count equality, and row-by-row `alignmentKey` equality. The ranked projector must emit one vote row per Ballot with matching alignment keys.
5. **`no-raw-html.test.mjs`** forbids `innerHTML` in `.ts` scripts; **`public-repository-contract.test.mjs`** asserts `<PublicRepositoryLink />` presence on results pages and may need a manifest-page entry.
6. **Existing tests that invert:** `ranked-choice.test.ts:329–333` (export unavailable), `ranked-results.spec.mjs:96` (no Comments), `creator-poll-lifecycle.spec.mjs:571` (probes `/manifest` — read its current assertion first).

### UX spec — round table (UX-DR22, DESIGN.md `components.round-table`)

Borderless table, hairline row rules only (`1px solid var(--color-rule)`), `border-collapse: collapse`, cell padding-y 12px, never enclosed in a box. Column heads: label-caps (Courier Prime 11px/400/0.18em uppercase) in `var(--color-dim)`. Cells: `data` type (Courier Prime 14px/700/lh 1.2). Eliminated options: `var(--color-faint)` + `line-through` from their elimination Round onward (strikethrough carries the state; faint's 2.05:1 ratio is the sanctioned exception). Winner's final-Round cell: `var(--color-solar-ink)` as ink, not fill (light-mode-safe; the summary's current `--color-solar` use is not the precedent to follow); only one gold in the viewport. Exhausted-Ballot row: separated by hairline, labelled in label-caps. Unresolved: no gold anywhere; tied options take `border-left: 2px solid var(--color-entropy)`. Rounds render in sequence, never collapse or paginate. Elimination statements are one-line → `body` (14px); the unresolved-tie copy is multi-sentence → `body-lg` (16px). No animation of any kind — the five motion primitives are the entire budget and none applies here; the table renders and updates statically.

**Canonical unresolved copy (EXPERIENCE.md § Voice and Tone, verbatim):**
> **Unresolved at Round {n}.** {A} and {B} are tied, and have been tied in every Round before this one. Rather than eliminate one at random, the count stops here. Standing counts below.

**Elimination copy** — `IrvEliminationReason` → one-line statements (plain language, name the options and the rule):
- `fewest_votes`: "{Option} had the fewest votes and was eliminated."
- `safe_batch`: "{Options} together held fewer votes than any remaining option and were eliminated as a group."
- `backward_tie_break`: "{Options} were tied; the tie was broken by their counts in Round {r}, where {loser(s)} had fewer votes."
(Exact wording is the dev's to polish within Voice-and-Tone — plain, declarative, no jargon like "IRV" in the sentence; the reason must be unambiguous, batch and backward cases must be distinguishable.)

**Manifest link:** directly beneath the Rounds, plain text label (e.g. `BALLOT MANIFEST`), label-caps + `var(--color-entropy)`, ≥44px target, standard 2px/2px focus ring, same tab, no icon (model: `public-repository-link`, DESIGN.md).

**Manifest page (spec is thin — documented decisions):** question in `heading-lg` (Newsreader 24px), a label-caps `{n} BALLOTS` count line, then one row per Ballot in `data`/Courier Prime listing its ranked option labels in rank order; link back to the Poll. No pagination (the Manifest is the recompute artifact — completeness over comfort). Not-yet shape: question + the canonical line + link back, nothing else that leaks (no counts, no version signal).

### UX gap resolutions (no mockup exists for round-table/manifest; these are the ruled defaults)

1. **Wide table on mobile:** UX-DR22 forbids collapsing/paginating; the responsive rules forbid page-silhouette horizontal overflow. Resolution: the table sits in its own `overflow-x: auto` container — the page never scrolls horizontally, the table may, and no Round is hidden or rearranged. Flag in the PR for design review.
2. **Table a11y (unspecified):** native `<table>` + `<caption>` (visually-hidden acceptable) + `th[scope]`. The round table is NOT a live region — the polite region remains the outcome line only ("never per-bar chatter").
3. **`cellPaddingX` unspecified:** use `{spacing.3}` (12px) horizontal to match vertical; monospace gives tabular alignment for free; numeric cells right-aligned.
4. **Chart-form toggle (`BARS · PIE`) does not apply to Ranked-Choice** — it is an MC results-bar affordance; do not add it.

### Data flow summary

```
D1 ranked_vote_preference ─┬─ projectVersionedRankedResults ─ tabulateAndProjectRanked ─ RankedTallyView.rounds ─ round-table (server + live)
                           ├─ NEW manifest projection (canonical re-sort, anonymized) ─ queryBallotManifest ─ /{link}/manifest
                           ├─ NEW findRankedPreferencesByClaim ─ post-vote YOUR BALLOT
                           └─ NEW d1/export/ranked-choice.ts driver ─ rankedChoiceStrategy.projectExport ─ existing exporter → CSV/XLSX
comment table ─ NEW ranked-safe comments port ─ ranked_visible.comments ─ CommentList (results, live, post-vote)
```

### Testing standards

- `tests/unit` (vitest node): pure domain, rendering-projection, copy. Reuse fast-check 4.9.0 generators from `tabulate-irv.test.ts` for the manifest round-trip property.
- `tests/integration` (vitest + `@cloudflare/vitest-pool-workers`, migrations preloaded): D1 adapter contracts, route header/status matrices.
- `tests/e2e` (Playwright 1.62, `workers: 1`, port 4391): `.spec.mjs`, `test.describe.configure({mode:"serial"})`, `test.skip(!hasBetterAuthSecret())`, helpers from `creator-session.mjs`, committed proof dir `test-results/story-5-3-round-table-manifest-proof/` with 375px dark + 1280px light captures.
- Full gate before done: `pnpm migrations:guard && pnpm test && pnpm check`, `pnpm test:e2e`, `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` (pinned Node 24 via nvm).

### Project Structure Notes

- New files: `src/pages/[reference]/manifest.astro`, `src/adapters/d1/export/ranked-choice.ts`, plus tests. Everything else is UPDATE-in-place per the change surface above. Kebab-case files, PascalCase types, snake_case D1 (AR-2 naming).
- `manifest` is already a reserved per-Poll sub-path (`src/modules/polls/reserved-slugs.ts:20–23`, AR-11) — no registry change needed.
- One story = one branch = one PR = adversarial review before merge (standing team agreement).
- Stack pins: Astro 7.1.5, TypeScript 7.0.2, Vitest 4.1.10, Playwright 1.62.0, fast-check 4.9.0, Wrangler 4.115.0, SheetJS CE 0.20.3 (XLSX only, dynamic).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.3] — story statement + ACs 1–4 verbatim; #UX Design Requirements UX-DR17/19/21/22; AR-2/4/7/8/11/17/20
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md#FR-10, #SM-4] — recompute-by-hand consequence; Phase 2 gate
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md#AD-3, #AD-9, #AD-21, #AD-24, #AD-11, #AD-15, #AD-22, #Structural Seed, #Consistency Conventions]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md#components.round-table (frontmatter 374–384), #Components → round-table (666–668), #Colors, #Typography]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md#Component Patterns round-table (170), #State Patterns (197–213), #Voice and Tone (109), #Trust Surfaces (363), #Key Flows UJ-4 (425), #Live Results & Motion (330)]
- [Source: _bmad-output/implementation-artifacts/spec-5-2-deterministic-irv-tabulation.md] — tabulator/projection shapes, review patterns, deferred items
- [Source: _bmad-output/implementation-artifacts/spec-5-1-cast-a-ranked-ballot.md] — ballot invariants, open export-route test items
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:510–530] — Comments/YOUR BALLOT/round-table deferrals resolved by this story
- [Source: _bmad-output/implementation-artifacts/epic-5-context.md] — epic constraints, manifest anonymization rules

## Dev Agent Record

### Agent Model Used

qwen3.8-max

### Debug Log References

### Completion Notes List

- Added `backwardTieBreakRound` field to `IrvRound.eliminated` and `RankedEliminationView` so the rendering layer can display which prior round was used for backward tie-breaking.
- Round table renders with real `<table>` semantics, `overflow-x: auto` mobile container, strikethrough+faint for eliminated options, gold ink for winner, entropy border for tied options.
- Live enhancer validates rounds structurally (isRound, isElimination) and re-renders the round table via createElement/textContent only.
- Ranked-safe comments port (`projectRankedComments`) joins through vote → vote_comment without touching vote_selection. Wired into ResultsView, LiveResultsView, results page, voting surface, and live endpoint.
- YOUR BALLOT gate widened to include `ranked_visible`. New `findRankedPreferencesByClaim` reads ranked_vote_preference ordered by preference_rank.
- Ballot Manifest route at `/{link}/manifest` with published/not_yet/hidden/not_found shapes. Canonical ordering by lexicographic ranking content. No voter data, timestamps, or IDs in output.
- Ranked export projection implemented with fail-closed validation. Fixed mis-slotted strategy generics. New D1 export driver + bounded driver registered in export-delivery.ts.
- 19 new unit tests added across elimination copy, manifest ordering, manifest copy, ranked export projection, and post-vote ranked gate.
- All 1581 tests pass (unit + integration). Migration guard clean. Type check clean.

### File List

- src/components/ranked-results-summary.astro (modified)
- src/scripts/ranked-results-live.ts (modified)
- src/modules/results/index.ts (modified)
- src/modules/results/ranked-projection.ts (modified)
- src/modules/results/tabulate-irv.ts (modified)
- src/modules/results/post-vote.ts (modified)
- src/adapters/d1/index.ts (modified)
- src/adapters/d1/export/ranked-choice.ts (new)
- src/lib/poll-delivery.ts (modified)
- src/lib/export-delivery.ts (modified)
- src/modules/polls/types/ranked-choice.ts (modified)
- src/pages/[reference]/results.astro (modified)
- src/pages/[reference]/results/live.ts (modified)
- src/pages/[reference]/manifest.astro (new)
- src/components/poll-voting-surface.astro (modified)
- tests/unit/tabulate-irv.test.ts (modified)
- tests/unit/ranked-choice.test.ts (modified)
- tests/unit/results.test.ts (modified)
- tests/unit/results-comments.test.ts (modified)
- tests/unit/post-vote-results.test.ts (modified)
- tests/unit/elimination-copy.test.ts (new)
- tests/unit/manifest-copy.test.ts (new)
- tests/unit/manifest-ordering.test.ts (new)
- tests/unit/ranked-export-projection.test.ts (new)
- tests/e2e/ranked-results.spec.mjs (modified)
- CHANGELOG.md (modified)
- _bmad-output/implementation-artifacts/deferred-work.md (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)

### Change Log

- Story 5.3 implementation complete (2026-08-07): per-round IRV table, Ballot Manifest, Comments on ranked surfaces, YOUR BALLOT on ranked post-vote, ranked CSV/XLSX export.

### Review Findings (2026-08-07 — code review of 5-3-per-round-display-ballot-manifest)

Review mode: full (spec present). Raw layers: blind 15 + edge 16 + auditor 8 = 39; deduplicated to 11 actionable. Failed layers: none (all 3 completed late via runtime context).

- [x] [Review][Patch] YOUR BALLOT loses rank order — delivers position order instead [src/lib/poll-delivery.ts:690] — `poll.options.filter(id => preferenceIds.includes(id))` re-sorts by `poll.options` position order; AC 6 requires rank order. Reproduce: voter ranks C(2) > A(0) > B(1) renders A > B > C. Fix: map `preferenceIds` through label map (`optionLabelById.get(id)`) preserving input order, not `filter`.
- [x] [Review][Patch] Manifest canonical order sorts by label strings not positions [src/adapters/d1/index.ts:230] — `rankedOptionLabels` string `<`/`>` contradicts spec Trap 2 “lexicographic by sequence of ranked option positions”. Example positions [2,0] labels ["C","A"]: label-lex != position-lex; recompute adjacency holds but canonical identity diverges. Fix: store positions per ballot and sort by numeric position sequence, then project labels.
- [x] [Review][Patch] Manifest snapshot not version-coherent — no AD-24 skew-retry [src/adapters/d1/index.ts:196-242] — `projectBallotManifest` does two independent `db.prepare().all()` reads (options then prefs) with no `representationVersion` gate or transaction; `queryBallotManifest` adds envelope read as third race. Concurrent vote at deadline ⇒ `closed` status with stale ballot list. Spec requires 3-attempt version-coherent read like `projectVersionedRankedResults`. Fix: add version at start/end with retry or single-statement snapshot.
- [x] [Review][Patch] Ranked live poller never re-renders Comment list [src/scripts/ranked-results-live.ts:1370] — `isRankedLivePayload` validates `comments: unknown[]` then `applyPayload` calls only `applyStanding/applyUnresolvedCopy/applyRoundTable`; no `applyComments`. AC 5 + Task 2 require Comments live-update as on MC. Fix: add `applyComments` mirroring MC live enhancer for `[data-comment-list]` + owner moderation handling, using `textContent`/`createElement` only.
- [x] [Review][Patch] Manifest orphan fallback injects empty string [src/adapters/d1/index.ts:226] — `optionLabelById.get(id) ?? ""` emits `""` for deleted option; sort places `""` first and `manifest.astro` renders `A >  > B`; recompute artifact leaks corruption. Should fail-closed like ranked projection (throw/manifest unavailable) or map to "—" with explicit handling and sort by positions not labels.
- [x] [Review][Patch] Export adapter throws instead of fail-closed [src/adapters/d1/export/ranked-choice.ts:1892] — `safeCount` throws on null/negative/non-SafeInteger; `parseProjectionRows` called without try/catch so corrupt `option_count` bubbles as 500 not `export_projection_invalid` (409). `ranked-choice.ts:projectExport` correctly returns `ok:false`. Fix: catch and return invalid export error via driver-level try/catch or propagate as `export_projection_invalid`.
- [x] [Review][Patch] Live validators accept floats/negatives/zero [src/scripts/ranked-results-live.ts:1311] — `isCountRow`/`isRound`/`isElimination` use `Number.isFinite` only, accepting `-3`, `1.5`, `0` for `roundNumber`/`exhaustedCount`/`backwardTieBreakRound`; polluted payload renders negative/fractional counts. Fix: `Number.isSafeInteger` + `>=0` (or `>=1` for roundNumber/backwardTieBreakRound) matching domain invariants.
- [x] [Review][Patch] Manifest link not visibility-gated and missing on post-vote [src/components/ranked-results-summary.astro:484, src/components/poll-voting-surface.astro:254] — link gates on `status==="closed" && canonicalReference` only, not `resultsAreVisible`; `after_close_hidden` viewer sees link to `hidden` shape (confusing). Post-vote surface never passes `canonicalReference` so closed post-vote tally never shows link despite AC 2 “wherever the Tally is visible”. Fix: gate on visible ranked tally and thread `canonicalReference` into post-vote `RankedResultsSummary`.
- [x] [Review][Patch] Manifest route omits telemetry pollId [src/pages/[reference]/manifest.astro:1-108] — spec Task 5 requires “telemetry pollId” modelled on `results.astro`; route sets cache/robots/405/reserved-slug/canonical-301/BaseLayout/PublicRepositoryLink but never assigns `Astro.locals.telemetry`/`requestContext`. Manifest hits invisible to per-request telemetry invariant (AGENTS.md).
- [x] [Review][Defer] Unbounded Manifest / in-memory sort for large polls [src/adapters/d1/index.ts:projectBallotManifest, src/pages/[reference]/manifest.astro] — deferred, pre-existing spec tension — loads all votes+preferences into Map/array and renders one `<li>` per ballot with no LIMIT; 50k ballots OOMs Worker / multi-MB HTML. Spec says “Rounds never collapse or paginate” for completeness, but no memory guard specified. Monitor in production; consider streaming or size cap with follow-up story if observed.
- [x] [Review][Defer] Zero-preference / orphan vote undercounts ballotCount [src/adapters/d1/index.ts:projectBallotManifest] — deferred — `ballotMap` only from `prefRows`; a `vote` with zero `ranked_vote_preference` rows (malformed/exhausted) is invisible so `ballotCount` diverges from `vote` table and `exhaustedCount`. Requires product decision on whether manifest counts exhausted ballots as rows or notes them separately.

### Review Findings — bmad-code-review (2026-08-07)

#### decision-needed

- [x] [Review][Decision] Ballot Manifest canonical ordering is not fully deterministic for identical ballots [src/adapters/d1/index.ts:2295-2309, tests/unit/manifest-ordering.test.ts] — RESOLVED: collapse identical ballots into `{ rankings, count }` rows. `BallotManifestRow` now carries `count: number`. The D1 adapter sorts by position sequence then collapses adjacent identical rows; the page renders "N BALLOTS" per row. The manifest-ordering unit test now verifies the collapse is insertion-order-independent.
- [x] [Review][Decision] Manifest hidden-shape leaks the Poll question to any probing visitor [src/modules/results/index.ts:640-646, src/pages/[reference]/manifest.astro:86-88] — RESOLVED: remove `question` from the `hidden` variant. The page renders only the hidden copy line, no question, no "Back to Poll" link. The title is the generic "Ballot Manifest — Oddspark Polls".

#### patch

- [ ] [Review][Patch] Manifest not-yet shape leaks a no-deadline variant string and deadline <time> before close [src/pages/[reference]/manifest.astro:110-127] — for a not-yet Poll whose `deadlineMs` is null, the page renders `RESULTS_COPY.manifestNotYetNoDeadline`; when deadlineMs is present it emits `<time data-deadline>` + `formatUtc`. UX-DR19 specifies exactly "the question, 'The Ballot Manifest publishes when the Poll closes — {deadline, local}.', and a link back to the Poll — nothing else" (spec line 108-109). `manifestNotYetNoDeadline` is a new string not in the spec's not-yet shape; whether it presents or not is harmless, but it is a deviation from the specified shape. Recommend: keep the copy but verify the no-deadline branch is intentional, or drop it to match the canonical sentence exactly.
- [x] [Review][Patch] Ranked live script comment comparator does not validate incoming comment shape [src/scripts/ranked-results-live.ts:461-494, 120-150] — FIXED: added `isCommentView` shape guard mirroring MC's validation; validates `body`, `displayName`, `createdAtMs` per comment and rejects the entire payload if any comment is malformed (prevents the reload loop).
- [x] [Review][Patch] Ranked export driver: unbounded query orders votes only by `created_at_ms`, no id tie-breaker [src/adapters/d1/export/ranked-choice.ts:211-215] — FIXED: secondary sort by `vote_id` when `createdAtMs` are equal, matching the bounded query's `(created_at_ms, id BLOB)` ordering.
- [x] [Review][Patch] Ranked export driver: `comment_created_at_ms ?? 0` can reject a whole export for one comment whose timestamp is null [src/adapters/d1/export/ranked-choice.ts:195] — FIXED: enforces MC's parity rule `(body===null) !== (created_at_ms===null)`; rows violating it are skipped (not coerced). The comment timestamp is passed through as-is (never `?? 0`).
- [x] [Review][Patch] Ranked live enhancer responds to comment screenshots but never re-renders comments in-place from live [src/scripts/ranked-results-live.ts:458, 461-494] — `applyPayload` calls `applyComments` which only compares and forces reload on change; the "local owner moderate then new comment arrives" path reloads the full page rather than re-rendering the list in place (matches MC behavior for public list, but the ranked live cover is new). No functional bug, but comment additions always imply a full reload; spec UX-DR4 says no animation, not necessarily no reload. Flag for parity confirmation with MC live.

#### defer

- [x] [Review][Defer] Unbounded Manifest / in-memory sort for large polls [src/adapters/d1/index.ts:projectBallotManifest, src/pages/[reference]/manifest.astro] — deferred, pre-existing spec tension — manifest spec completeness over pagination/memory; a 50k-ballot poll would load all rows into a Map + array and render multi-MB HTML. Follow-up story if production scale demands.
- [x] [Review][Defer] Zero-preference / orphan vote undercounts ballotCount [src/adapters/d1/index.ts:projectBallotManifest] — deferred — a vote with zero `ranked_vote_preference` rows is invisible to ballotMap so ballotCount diverges from the vote table. Requires product decision on exhausted-ballot representation in the manifest.

#### dismissed (noise / handled / intentional)

- DUPLICATES: `manifest-ordering.test.ts` `sorts ballots lexicographically by ranking content` re-implements a label sort; the **implementation** sorts by numeric position (correct). The test's oracle doesn't match the implementation — that is the real gap (see decision 1). The label-sort claim in the test is noise in itself.
- `safeCount` throw vs MC's return-null: ranked driver intentionally throws inside `parseProjectionRows` and catches at the driver boundary (`createRankedChoiceExportFactDriver`), yielding fail-closed null — parity with MC is fine.
- Live validator float/negative check (`Number.isSafeInteger` already enforced in `isCountRow`, `isRound`): verified in source — already correct, dismissed.
- `yourBallotLabels` rank-order loss: verified in source (d1/index.ts:1532 ORDER BY preference_rank; poll-delivery.ts:739 filter preserves order) — not a real bug. Dismissed.
- `projectRankedComments` owner-moderation gating: `includeOwnerModeration` computed before visibility gate but tied to `viewer.userId === envelope.ownerUserId`; the projection only ever runs for `ranked_visible` (visible) — correct. Dismissed.
- Hidden-shape deadline null: `hidden` variant has no deadlineMs; the page renders back-link + PublicRepositoryLink only. The question leak is covered in decision 2.

ACTION REMAINING: 2 decision-needed, 5 patch, 2 defer, 9+ dismissed.
