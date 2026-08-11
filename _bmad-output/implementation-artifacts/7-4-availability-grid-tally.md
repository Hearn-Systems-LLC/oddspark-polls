---
baseline_commit: 009dae2ee24a6ca612ca43f23e19a189d669f379
---

# Story 7.4: Availability Grid Tally

Status: review

## Story

As the Creator,
I want a Voters × slots grid with ranked totals,
so that the best slot appears from the answers — and I make the final call, not the system.

## Acceptance Criteria

1. **Given** a Meeting Poll Tally, **when** it renders, **then** it shows the Voters × slots grid — Voter display names down the side, slots across the top, every cell a glyph and wash — with per-slot totals beneath in `data` type, computed server-side by SQL projection (FR-14, AD-9), **and** below `lg` the grid renders one row per slot with three targets; at `lg` and up it becomes the true matrix (UX-DR25).
2. **Given** the slot ranking, **when** totals are computed, **then** slots rank by count of *yes*, ties break by count of *if-need-be* (tie-break weight only, never a fraction of a yes), and slots still tied all take the 2px gold top rule together (FR-14).
3. **Given** any final state, **when** the grid presents the best slot(s), **then** the system never auto-commits a meeting time — the grid informs, the Creator picks (FR-14), **and** the Creator's own grid view always renders in the Creator's timezone, labelled, matching the slots as written (UX-DR24).

## Tasks / Subtasks

- [x] Task 1 — Meeting tally SQL projection in the D1 adapter (AC: 1, 2)
  - [x] Add a port method beside `projectVersionedResults` (`src/adapters/d1/index.ts:2120`) / `projectRankedResults` (`:2409`) — e.g. `projectMeetingResults(pollId)` — that in one D1 snapshot reads: slots (reuse `loadMeetingSlots` idiom, `:367-378`, ordered by `position`), one row per response (`meeting_response` joined to `vote`, ordered deterministically by vote `created_at_ms` then bytewise vote id), the `vote_id × meeting_slot_id → availability` cells, and per-slot `SUM(availability='yes')` / `SUM(availability='if_need_be')` / `SUM(availability='no')` totals plus `representation_version` and effective open/closed state.
  - [x] Unanswered = **missing row**, not a state — the matrix assembly must treat absent `(vote_id, slot_id)` pairs as unanswered (`·`), never LEFT-JOIN into a fake state.
  - [x] Strip vote/slot IDs before handing rows to the projection (AD-9/AD-21): the outward view carries display names, slot instants + zone, states, and totals only.
- [x] Task 2 — Pure projection module `src/modules/results/meeting-projection.ts` (NEW) (AC: 2, 3)
  - [x] Model on `src/modules/results/ranked-projection.ts`: serializable, provider-free `MeetingTallyView` with `readonly` fields, no Maps, no voter identifiers beyond display names.
  - [x] Ranking: sort by `yesCount` DESC, then `ifNeedBeCount` DESC, then `position` ASC for deterministic render order — but **display order stays slot `position` order** (slots across the top as written); ranking only marks which slot(s) are best. Never combine yes and if-need-be into one score.
  - [x] Best-slot marking: all slots tied on `(yesCount, ifNeedBeCount)` at the top take `isBest: true` together (FR-14 "highlighted together"). Decision (sources silent): when the top `yesCount` is 0, mark **no** slot best — gold means "this one is winning" and must never lie (DESIGN.md § Colors gold rule).
- [x] Task 3 — Wire the results module (AC: 1)
  - [x] `src/modules/results/index.ts`: add `projectMeetingResults` to `ResultsPorts` (L114-134) and `LiveResultsPorts` (L144-155); add a `meeting_visible` arm to the `ResultsView` union mirroring `ranked_visible` (L245-258); branch `queryResults` on `envelope.pollType === "meeting"` **before** the generic MC fallthrough at L465 (today meeting falls through and renders an empty MC tally — that fallthrough must become unreachable for meeting); add meeting copy to `RESULTS_COPY` (L157-171; `empty` and `TIED` exist).
  - [x] Visibility/authorization unchanged: `ViewerContext` authorizes before any private read; creator-only / not-yet-visible states return the existing hidden arms with `private, no-store` (AD-21). Reuse `composeResultsValidator` (L379-391) unchanged — cast and revise both bump `representation_version` (AD-24), so ETag revalidation works for free.
  - [x] Live endpoint: extend `queryLiveResults` (L497-596) and `src/pages/[reference]/results/live.ts` with a meeting payload carrying an explicit `pollType: "meeting"` discriminant, exactly as `LiveRankedResultsPayload` (L211) does to protect the MC exact-key validator.
- [x] Task 4 — Tally grid component `src/components/availability-tally.astro` (NEW) (AC: 1, 2, 3)
  - [x] Voters down the side (display names, plain text, Astro-escaped), slots across the top in `position` order; every cell glyph + wash per the `availability-cell` spec: `✓` solar-ink on solar-wash, `~` entropy on entropy-wash, `×` in `dim` (never `faint` — No is an answer) with no fill, `·` in `faint` for unanswered. Reuse the cell class names/CSS from `src/components/availability-grid.astro:61-88` (48px cells, `-1px` border collapse, zero radius) rather than re-authoring tokens.
  - [x] Per-slot totals beneath the grid in `{typography.data}` showing yes and if-need-be counts distinctly; best slot(s) take a `2px solid var(--color-solar-ink)` top rule spanning the column ("bestColumnRule"). This is a *rule*, not the `◆` leader marker — the results-bar "no gold on tie" convention does not apply; tied-best columns all carry the rule.
  - [x] Responsive: below `lg` (1024px) one row per slot (slot label + that slot's cells/total); at `lg`+ the true Voters × slots matrix (UX-DR25). Nothing appears only at one breakpoint.
  - [x] Timezone: a `{typography.label-caps-lg}` line above the grid states the timezone in use; rows emit the same `data-slot` / `data-starts-at` / `data-ends-at` / `data-source-zone` attributes so `src/scripts/availability-grid.ts` (device-zone detection, `[data-timezone-select]` override, `+1 day` entropy-tinted flags via `meetingSlotDayKey`) enhances it unchanged. Server-rendered default: the slot's stored zone. On `src/pages/creator/polls/[pollId].astro`, render in the Creator's zone, labelled, with **no** device-zone rewrite (UX-DR24: the Creator's grid matches the slots as written — see `:665-681` for the existing creator slot formatting).
  - [x] Zero responses → `RESULTS_COPY.empty` state, no grid skeleton lies. Guard every zone with `isUsableTimeZone` (`src/modules/polls/index.ts:184-234`) before `Intl` (SSR 500 trap from 7.1).
- [x] Task 5 — Page wiring + live updates (AC: 1)
  - [x] `src/pages/[reference]/results.astro`: add a `view.kind === "meeting_visible"` block parallel to `ranked_visible` (`:150-172`) and conditionally include a meeting live script parallel to `:227-229`.
  - [x] Live client: new `src/scripts/meeting-results-live.ts` on `src/scripts/results-live-core.ts` (3s visible-only conditional polling, coalescing, `RECONNECTING` preserved-tally state, capped backoff, stop on close — AD-10), following `src/scripts/ranked-results-live.ts`.
  - [x] Post-vote surface: `src/lib/poll-delivery.ts:860` currently excludes meeting from the counted-tally path (`pollType !== "meeting"`). If the poll's visibility settings permit, lift that guard to show the meeting tally on the post-vote surface (the UJ-3 climax: "the grid fills in as the other three answer"); otherwise the confirmation stands alone. Follow whatever `src/modules/results/post-vote.ts` needs to carry the meeting view.
- [x] Task 6 — Tests + gate (all ACs)
  - [x] Unit: ranking/tie/zero-yes/unanswered-cell properties in a new `tests/unit/meeting-projection.test.ts` (fixed `NOW`, factory helpers; fast-check available for tie/DST properties per retro action AR-19). Markup assertions (glyphs, wash classes, top rule, escaped names, breakpoint classes) as string-render `.mjs` test per `tests/unit/results-bar-motion.test.mjs` pattern.
  - [x] Integration: new projection queries in `tests/integration/` beside `results-adapter.integration.test.ts` / `ranked-results-adapter.integration.test.ts` (vitest-pool-workers, `applyD1Migrations`, FK-ordered cleanup); extend `live-results-route.integration.test.ts` for the meeting live payload; reuse `seedMeeting()` / `meetingBody()` helpers from `tests/integration/vote-route.integration.test.ts`.
  - [x] E2E: extend `tests/e2e/meeting-poll.spec.mjs` (serial mode, 120s timeout, creator-session auth, skip without better-auth secret): vote as two voters → results grid shows both rows, totals, gold rule on best; revise availability → tally re-projects (no denormalized state, per 7.3 note).
  - [x] Gate: `pnpm migrations:guard && pnpm test && pnpm check`; `pnpm test:e2e`; `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check`; CHANGELOG entry.

## Dev Notes

### The core gap (read this first)

There is **no meeting results path today**. `queryResults` (`src/modules/results/index.ts:397-486`) branches only on `ranked_choice`; a meeting poll falls through to the generic MC `projectResults` path (L465-486), and since meeting polls have zero `poll_option` rows, `projectVersionedResults` returns an empty options array with a nonzero voter count — the results page renders an empty MC tally. That is the placeholder you are replacing. `grep -r meeting src/modules/results/` returns nothing.

### Architecture guardrails

- **AD-9:** Tally computed server-side by SQL projection over accepted raw Vote facts. IDs used only for joins and stable ordering, stripped before the projection. No client tabulation.
- **AD-20/AR-16 (already built, 7.2/7.3):** revision replaces availability rows and increments `representation_version` — "the Tally is a SQL projection over raw rows — replacing rows automatically corrects 7.4's tally; no denormalized state to update" (7.3 Dev Notes). Do not add any reconciliation.
- **AD-21/AD-24:** authorize `ViewerContext` before reading private facts; hidden states `private, no-store`; one monotonic `representation_version` + effective state drives the validator — reuse `composeResultsValidator` unchanged.
- **AD-10:** live polling contract — 3s cadence while visible, coalesce versions, `RECONNECTING` non-blocking with last tally preserved, capped 30s backoff, stop on close, never present stale as live.
- **AD-2/UX-DR25:** server-rendered HTML works without JS; `meeting-results-live.ts` and the timezone script are isolated progressive enhancements.
- **AR-19 conventions:** UTC ms in D1; IANA zone only where civil time matters; snake_case SQL, kebab-case files; stable error codes mapped once; no `Date` math for civil time — `Intl` + `Date.UTC` only, no date libraries.
- **7.2's forward-declaration honored by schema:** availability is a three-state TEXT enum (`'yes','if_need_be','no'` — `db/migrations/0017_meeting_availability.sql`) precisely so this story's `GROUP BY`/`COUNT` is trivial. No new migration is expected; add `0018_*.sql` + `pnpm migrations:checksum` manifest in the same commit only if an index proves necessary.

### UX contract (DESIGN.md / EXPERIENCE.md — binding)

- `availability-cell`: 48×48px, 1px rule border collapsed with neighbors, zero radius. Yes = solar-wash fill + `✓` solar-ink (light mode uses `solar-ink-on-wash-light` `#6E560B` — the one deepened gold glyph, already in `src/styles/tokens.css`). If-need-be = entropy-wash + `~` entropy. No = no fill, `×` in `dim` — **never faint**. Unanswered = `·` in `faint`. State always glyph + fill together, never color alone.
- Totals in `{typography.data}` (bold Courier Prime 14px — the ramp reserved for "availability totals"); timezone line in `{typography.label-caps-lg}`.
- Best column(s): `bestColumnRule: 2px solid solar-ink` top rule spanning the column width; ties all carry it together. **This differs deliberately from results-bar** (where a tie means no gold and a `TIED` line): FR-14 says "highlighted together," and a rule is not the `◆` leader marker. Do not port the one-gold-bar convention here.
- Gold rarity still applies within the surface: the top rule(s) are the gold on this tally; don't add gold buttons/markers alongside.
- `+1 day` date-shift flags are literal text tinted entropy — words carry it, color decorates.
- The grid informs; nothing in the UI selects, commits, or "confirms" a slot. No auto-commit affordance of any kind.
- Banned (standing 7.x decisions): toasts, spinners, modals, confirm dialogs; closed views render no inputs; `faint` never on text a user must read.

### What exists to reuse (do not reinvent)

- `src/components/availability-grid.astro` — voting-side grid; its CSS (L61-88) carries every cell token. Its `readOnly` mode (7.3) is the closest thing to a tally cell. Build `availability-tally.astro` as a sibling reusing the class names; don't fork the token values.
- `src/scripts/availability-grid.ts` — timezone override + `+1 day` logic keyed on `data-*` attributes; emit the same attributes and it works unchanged.
- `src/lib/datetime.ts` — `formatMeetingSlotLocal`, `meetingSlotDayKey`; `isUsableTimeZone` in `src/modules/polls/index.ts`.
- `src/modules/results/ranked-projection.ts` + `src/components/ranked-results-summary.astro` + `src/scripts/ranked-results-live.ts` — the complete second-poll-type results pipeline; copy its shape, not MC's.
- `src/shared/domain/index.ts:21-24` — `AVAILABILITY_STATES`, `AvailabilityState`, `isAvailabilityState`.
- D1 idioms: `loadMeetingSlots` (`src/adapters/d1/index.ts:367`), `findMeetingResponseByRevisionDigest` (`:1253`) for the response→vote→availability join shape.

### Previous-story intelligence (7.1–7.3)

- **SSR 500 trap:** an invalid IANA zone reaching `Intl` throws `RangeError`. Guard every zone with `isUsableTimeZone` (bit 7.1; patched at `meeting.ts:74`).
- **7.3 review fixes to not regress:** read-only cells need a11y markers (`aria-selected` + visually-hidden "(submitted)" — `availability-grid.astro:37`); closed meeting polls must not render an empty option list (`poll-voting-surface.astro:191`); guard `meta.changes` on D1 batch results.
- Reason codes are stable snake_case mapped once — pages never classify errors.
- Display names are plain text (D1 CHECK: 1–80 chars, trimmed); Astro escaping stays on — names go straight into cells, no HTML.
- One story = one branch (`story/7-4-availability-grid-tally`) = one PR = adversarial review before merge; tracker honesty — done requires a merge path on main.

### Project Structure Notes

- NEW: `src/modules/results/meeting-projection.ts`, `src/components/availability-tally.astro`, `src/scripts/meeting-results-live.ts`, `tests/unit/meeting-projection.test.ts` (+ a markup `.mjs` test), new integration spec.
- UPDATE: `src/modules/results/index.ts`, `src/adapters/d1/index.ts`, `src/pages/[reference]/results.astro`, `src/pages/[reference]/results/live.ts`, `src/lib/poll-delivery.ts` (post-vote guard at `:860`), `src/modules/results/post-vote.ts`, `src/pages/creator/polls/[pollId].astro`, `tests/e2e/meeting-poll.spec.mjs`, `CHANGELOG.md`.
- `src/modules/polls/types/meeting.ts` gains `projectResults` only if the registry contract requires it; the ranked precedent routes projection through the results module + D1 driver, not the strategy — follow the ranked path. `projectExport` stays `poll_type_export_unsupported` (export is not 7.4 scope).
- The system must remain working end-to-end: MC/ranked results, live endpoints, and the MC exact-key live validator must be untouched by the meeting discriminant.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-7.4 (L1170-1190); Epic 7 notes L186-187]
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md#FR-12–FR-14 (§4.5); assumption register: "if-need-be is tie-break weight only"]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md#AD-2, AD-3, AD-6, AD-9, AD-10, AD-20, AD-21, AD-23, AD-24; Consistency Conventions; Structural Seed]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md#availability-cell (L222-236, 587-596), results-bar, Typography, Colors; EXPERIENCE.md#UX-DR23/24/25, timezone rules (L370-376), UJ-3 climax (L417)]
- [Source: _bmad-output/implementation-artifacts/7-2-mark-availability.md#L80 (tally forward-declaration); 7-3-revise-your-availability.md#L73 (projection corrects tally), review fixes]

## Dev Agent Record

### Agent Model Used

GPT-5.6 Codex (implementation; story context generated by claude-fable-5)

### Implementation Plan

- Follow the story's six tasks in order with a red-green-refactor cycle for each: establish the one-snapshot D1 fact projection, add the provider-free Meeting view/ranking, wire results/live contracts, build the responsive tally, connect delivery surfaces, then close with all prescribed gates.

### Debug Log References

- 2026-08-11: Task 1 RED confirmed all five new Meeting adapter cases failed before `projectMeetingResults` existed. Restricted workerd execution hit the expected Wrangler log/loopback `EPERM`; the permitted rerun produced the product-test failure evidence.
- 2026-08-11: Task 1 GREEN/full regression — `pnpm test -- tests/integration/meeting-results-adapter.integration.test.ts` completed 125 files / 1,737 tests; `pnpm check` passed.
- 2026-08-11: Task 2 RED failed on the absent `meeting-projection` module; GREEN passed 6 focused unit/property tests. Full regression passed 126 files / 1,743 tests and `pnpm check` stayed green.
- 2026-08-11: Task 3 RED proved Meeting still fell through the MC full/live projections. GREEN passed 65 focused Results tests and 13 live-route tests; full regression passed 126 files / 1,749 tests and `pnpm check` passed.
- 2026-08-11: Task 4 RED proved the Creator page lacked the Meeting tally and malformed stored zones reached `Intl`. GREEN passed 7 component-markup checks and 31 real creator-route integration checks; full regression passed 127 files / 1,757 tests and `pnpm check` passed.
- 2026-08-11: Task 5 RED proved the public/Creator page hooks and live client were absent and the returning Meeting surface omitted its authorized tally. GREEN passed 23 focused unit contracts plus the real Meeting delivery route. An adversarial audit then caught hidden Results replacing the Meeting revision reminder; its focused regression failed before the fix and passed after it. Final Task 5 regression passed 130 files / 1,766 tests and `pnpm check` passed.
- 2026-08-11: Task 6's two-voter Playwright flow passed, but inspection of its desktop proof exposed table headers and then totals stacking vertically. Bounding-box assertions failed on both defects before the table-cell CSS fixes and passed afterward. Final gates: migration guard 17/17; Vitest 130 files / 1,768 tests; Playwright 188/188; TypeScript, regenerated binding drift, production build, and diff checks all passed. Story 7.4 mobile-dark and desktop-light proofs were inspected with no console/page errors.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Open design decision resolved in-spec: a 0-yes "best" slot takes no gold rule (gold must never lie); ties on (yes, if-need-be) all take the rule together per FR-14.
- Task 1: added a single-statement D1 Meeting projection with deterministic response order, sparse unanswered cells, SQL state totals, same-snapshot version/status, malformed-fact shields, and an identifier-free outward shape.
- Task 2: added the provider-free, readonly, JSON-safe Meeting tally projection with authored display order, strict yes/if-need-be ranking, tied-best marking, zero-yes suppression, and copied sparse voter cells.
- Task 3: added authorized Meeting full/live Results arms, same-snapshot status/version validators, public comments, explicit `pollType: meeting` payloads, and regression protection for the unchanged MC exact-key contract.
- Task 4: added the responsive slot/mobile and Voter×slot/desktop tally, exact availability glyph/wash semantics, distinct totals, tied-best rules, safe timezone enhancement attributes, empty state, and a fixed labelled Creator-zone view with malformed-zone fallback.
- Task 5: wired the public Results, Creator, and authorized post-vote surfaces; added safe exact-payload DOM rebuilding with visible-only ETag polling, monotonic adoption, coalescing/abort, preserved-tally reconnect/backoff, bounded recovery, and close-stop behavior; hidden Results retain the Meeting revision confirmation without leaking the tally.
- Task 6: proved two isolated voters, exact totals/best-slot movement after revision, live adoption without reload, normalized persistence, closure, responsive matrix geometry, and both visual modes; completed every prescribed repository gate and documented the user-facing tally.

### File List

- `CHANGELOG.md`
- `_bmad-output/implementation-artifacts/7-4-availability-grid-tally.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `src/adapters/d1/index.ts`
- `src/components/availability-tally.astro`
- `src/components/poll-voting-surface.astro`
- `src/lib/poll-delivery.ts`
- `src/modules/results/index.ts`
- `src/modules/results/meeting-projection.ts`
- `src/pages/[reference]/results.astro`
- `src/pages/[reference]/results/live.ts`
- `src/pages/creator/polls/[pollId].astro`
- `src/scripts/meeting-results-live.ts`
- `tests/e2e/meeting-poll.spec.mjs`
- `tests/integration/creator-poll-lifecycle-route.integration.test.ts`
- `tests/integration/meeting-results-adapter.integration.test.ts`
- `tests/integration/live-results-route.integration.test.ts`
- `tests/integration/vote-route.integration.test.ts`
- `tests/unit/availability-tally-markup.test.mjs`
- `tests/unit/meeting-projection.test.ts`
- `tests/unit/meeting-results-live-contract.test.mjs`
- `tests/unit/meeting-results-live.test.ts`
- `tests/unit/meeting-results-page-contract.test.mjs`
- `tests/unit/post-vote-results.test.ts`
- `tests/unit/results-comments.test.ts`
- `tests/unit/results-live-payload.test.ts`
- `tests/unit/results.test.ts`

### Change Log

- 2026-08-11: Implemented Story 7.4 Availability Grid Tally across the one-snapshot Meeting projection, authorized full/live/post-vote delivery, responsive timezone-aware UI, safe live reconciliation, and complete unit/integration/E2E verification.
