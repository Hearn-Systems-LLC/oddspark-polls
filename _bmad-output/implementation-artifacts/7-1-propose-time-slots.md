---
baseline_commit: 66b08fb3f8c1adbadff4a94cf69a7f0088fd2add
---

# Story 7.1: Propose Time Slots

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Ultimate context engine analysis completed 2026-08-10 — comprehensive developer guide created from epics (Story 7.1 L1105–1127, Epic 7 header L184–187, UX-DR23/24 L115–116), ARCHITECTURE-SPINE (AD-3/6/9/17/20/23/24, Consistency Conventions L519–534, ER L622–637), PRD FR-12/FR-5, EXPERIENCE.md/DESIGN.md, Story 6.x artifacts + epic-6 retro Prep-2, and a full codebase audit of the create-poll path, poll-type strategies, D1 migrations/triggers, and test harness. No new libraries. -->

## Story

As a Creator,
I want to propose candidate time slots in my own timezone,
So that my group can react to concrete times instead of debating in the abstract.

## Acceptance Criteria

1. **Slot builder on `/creator/new`.** Given a Creator building a Meeting Poll, when they add slots in the slot builder, then each row takes a date, start, and end in the Creator's timezone with that timezone stated explicitly, rows added one at a time (FR-12, UX-DR24).
2. **Heterogeneous slots, minimum two.** Slots may fall on different dates and carry different durations within one Poll — with a minimum of two slots, since slots are the Poll's options (FR-12 via FR-5's rule), rejected 422 in the same idiom as the options minimum.
3. **Absolute-instant persistence.** Slots persist as absolute instants (UTC ms) plus the Creator's IANA timezone, so daylight-saving transitions resolve at render (AR-19).
4. **End-before-start 422.** Given a slot whose end precedes its start, when the form is submitted, then it re-renders 422 with "This slot ends before it starts. Check the times." inline and the rest of the form preserved.
5. **Locked after first Vote.** Given a Meeting Poll with at least one Vote, when the Creator views the slots, then they are locked entirely — slots are the Poll's options under FR-5's rule (FR-12).

## Tasks / Subtasks

- [x] Task 1: Migration `db/migrations/0016_meeting_slots.sql` (AC: 3, 5)
  - [x] Create `meeting_slot`: `id TEXT PRIMARY KEY, poll_id TEXT NOT NULL, position INTEGER NOT NULL, starts_at_ms INTEGER NOT NULL, ends_at_ms INTEGER NOT NULL, time_zone TEXT NOT NULL, created_at_ms INTEGER NOT NULL`, `CHECK (ends_at_ms > starts_at_ms)`, `FOREIGN KEY (poll_id) REFERENCES poll(id) ON DELETE CASCADE`, `CREATE UNIQUE INDEX meeting_slot_position_idx ON meeting_slot(poll_id, position)` — mirror `poll_option` in `0004_polls.sql`.
  - [x] Type-disjointness triggers in the `0013`/`0014` idiom: BEFORE INSERT/UPDATE `meeting_poll_bounds_*` (`RAISE(ABORT, 'meeting_poll_bounds_invalid')` when `poll_type='meeting'` carries multi-select bounds) and a `meeting_slot_poll_type_guard` (slot rows only on `poll_type='meeting'` polls). Do NOT add a meeting_availability table (Story 7.2's).
  - [x] `pnpm migrations:checksum` — commit regenerated `db/migrations.manifest.json` in the same commit; verify with `pnpm migrations:guard`.
- [x] Task 2: Meeting strategy `src/modules/polls/types/meeting.ts` (AC: 2, 3, 4)
  - [x] Model on `types/image.ts` (closest: widens create input with per-row facts, ships own copy, returns `poll_validation_failed` with `fieldErrors` + `reasonCodes`). `create` returns slot facts `{ startsAtMs, endsAtMs, timeZone, position }` — sanctioned by `docs/design/poll-type-contract-check.md:87–99` (contract v5, no version bump needed).
  - [x] `MEETING_DEFINITION_COPY`: `slotsMissing: "A Poll needs options. Add at least two."` idiom → decide exact meeting phrasing (see Ruled Defaults #3); `slotEndsBeforeStart: "This slot ends before it starts. Check the times."` (AC literal); reason codes `slots_missing` / `slots_insufficient` / `slot_ends_before_start` (stable snake_case, mapped once — pages never classify).
  - [x] Validation: min 2 complete slot rows (blank rows dropped like blank options); per-row end > start after civil→UTC conversion; per-row field keys `slots[{i}]` following the `media[{i}]` convention; reject multi-select bounds like `image.ts` does ("Meeting Polls…" branch in `definition.ts` L143–166 pattern).
  - [x] Reuse `civilToUtcMs(civil, timeZone)` from `src/modules/polls/index.ts:184–234` verbatim (compose `"${date}T${start}"`); surface `CIVIL_TIME_NONEXISTENT` (spring-forward gap) as a per-row field error.
- [x] Task 3: Register + wire into createPoll (AC: 2, 3)
  - [x] `src/modules/polls/types/registry.ts`: add `meeting` to `pollTypeStrategies` (L16–20). Voting (`votingStrategyFor`) is Story 7.2 — leave meeting unhandled/fail-closed there.
  - [x] `src/modules/polls/definition.ts`: `meeting` branch in `validatePollDefinition` (L143–166 area) + strategy dispatch (L266–277).
  - [x] `src/modules/polls/index.ts`: extend `CreatePollDraft` (slot row strings + already-present `timeZone`), `ValidatedCreatePoll`, `PollPersistenceRows` with optional `slots[]` (precedent: `media[]` from 6.1). CRITICAL: add slots to BOTH `matchesExistingPoll` (L545–586) and `draftContentForCompare` (L602–653) or retry-dedupe adjudicates wrongly.
  - [x] `src/adapters/d1/index.ts` `createPollPersistence.insertPoll` (L392–482): append `meeting_slot` INSERTs to the one `db.batch` (AD-3: poll + type facts + options **or slots** + slug reservation commit atomically; failed batch leaves no reachable Poll).
- [x] Task 4: Slot builder UI on `/creator/new` (AC: 1, 2, 4)
  - [x] `src/components/poll-definition-fields.astro`: add `meeting` to `POLL_TYPE_CHOICES` (L67–83); `const meeting = pollType === "meeting"` (L84–86); slot-row group mirroring the image per-row group precedent (L223–292): `hidden`/`disabled` + conditional `name` when not meeting so inert fields never post.
  - [x] Slot rows: date + start + end inputs per row using the shared `Input` bottom-rule idiom (`DESIGN.md:610–616` — no box, 1px rule, zero radius, 44px min height, label-caps label above; date/time input chrome is an open spec gap — see Ruled Defaults #1). Always render ≥2 rows (precedent `new.astro:479–482`).
  - [x] `intent="add-slot"` server-driven row append modeled exactly on `add-option` (`new.astro:375–392`): appends one blank row, validates nothing, informational note on a 200 — "rows added one at a time" without JS (AD-2).
  - [x] Timezone stated explicitly: visible `label-caps-lg` line (e.g. `TIMES IN {zone}` — DESIGN.md:494 mandates label-caps-lg for "the timezone line") surfacing the value the hidden `input[name="timezone"]` already carries (`new.astro:492`, stamped by `poll-definition-form.ts:26–39`; empty ⇒ server treats as UTC and the line must say so).
  - [x] `src/scripts/poll-definition-form.ts` `syncPollTypeFields` (L62–107): add the meeting branch for show/hide + disabled/name juggling; update the visible timezone text when stamping.
  - [x] `src/pages/creator/new.astro`: extend Zod `formSchema` (L79–100) with slot fields (indexed `slot_date_{i}`/`slot_start_{i}`/`slot_end_{i}` regex extraction like `media_*_{i}` L159–193, or repeated-name `getAll`; pick indexed — three correlated sub-fields per row). 422 re-render preserves every submitted slot value (L459–461 idiom); success stays POST → 303 (manually built Response, L441–457).
- [x] Task 5: Locked view (AC: 5)
  - [x] `src/pages/creator/polls/[pollId].astro`: meeting polls render slots read-only when `voterCount > 0` (L657–659, L853–866 `locked`/`lockMessage` path) — locked message is `LIFECYCLE_COPY.definitionLocked` ("Locked — the first Vote has been cast. The description is still yours to edit.").
  - [x] `src/modules/polls/poll-lifecycle.ts` `updatePollDefinition` rejects non-MC/non-ranked types (L457–462) — meeting stays excluded from the edit path like image (description-only edits still work); confirm the detail page renders slot rows in the locked `<ol data-locked-options>` style, formatted in the Creator's stored timezone (UX-DR24: "the Creator's grid renders in the Creator's timezone").
  - [x] Do NOT route slots through `updateDefinitionForOwner` (`d1/index.ts:809–922`) — it deletes/recreates option rows with fresh ids (6.3 trap).
- [x] Task 6: Tests + gate
  - [x] Unit `tests/unit/meeting-strategy.test.ts`: min-2 422, end-before-start copy literal, DST correctness — fast-check property tests around DST boundaries (epic-6 retro Prep-2, `sprint-status.yaml:290`), `CIVIL_TIME_NONEXISTENT` rejection, blank-row dropping. Fixed `NOW` constant, `draft()` factory pattern from `polls.test.ts:33–53`.
  - [x] Update `tests/unit/ranked-choice.test.ts:109–117` (currently asserts `pollType: "meeting"` is rejected — now registered) and `tests/unit/polls.test.ts`.
  - [x] Integration: `meeting-slots.integration.test.ts` — schema/trigger contracts (CHECK, disjointness guards, cascade delete) per `image-media.integration.test.ts` pattern (`applyD1Migrations`, FK-ordered `DELETE FROM`); create-route coverage via `create-poll-route.integration.test.ts` helpers (`runRealRoute`, `postCreate`).
  - [x] E2E `tests/e2e/meeting-poll.spec.mjs` modeled on `image-poll.spec.mjs`/`ranked-choice.spec.mjs`, using `tests/e2e/creator-session.mjs` helpers; no shared cookie jars across tests.
  - [x] Full gate: `pnpm migrations:guard && pnpm test && pnpm check`, `pnpm test:e2e`, `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check`. CHANGELOG entry (user-reachable behavior).

## Dev Notes

### Critical context

- **Poll-type enum already includes `meeting`** — `src/shared/domain/index.ts:13–19` `POLL_TYPES = ["multiple_choice","ranked_choice","image","meeting"]` (AD-23: shared kernel owns it). What's missing is the registry entry; today `pollType=meeting` 422s with `pollTypeInvalid: "Pick a supported Poll Type."` (`polls/index.ts:116`, asserted in `ranked-choice.test.ts:110`).
- **Slots are a separate table, not `poll_option`.** AD-3 ("options **or** slots" in one create batch) + spine ER `POLL ||--o{ MEETING_SLOT : proposes` (SPINE L627). `poll.poll_type` is plain TEXT, no CHECK — type validity is registry-enforced.
- **Time rules (AR-19 / SPINE L526):** persist UTC Unix ms in D1; RFC 3339 on the wire; IANA timezone only where civil time matters — "especially Meeting Poll creation." The canonical converter `civilToUtcMs` (with two-pass offset convergence and DST-gap rejection) already exists in `polls/index.ts:184–234`. No date library exists or may be added — everything is `Intl` + `Date.UTC`.
- **Lock mechanism is application-level, not a trigger.** No D1 trigger locks options after first vote; the authoritative guard is the `NOT EXISTS (SELECT 1 FROM vote …)` predicate embedded in every statement of the edit batch (`d1/index.ts:826–898`), with advisory early return in `poll-lifecycle.ts:500–502`. For 7.1, "locked entirely" is satisfied by meeting being excluded from the edit path (like image) + locked read-only rendering; don't invent a trigger.
- **Scope boundary:** this story is creation + locked display only. `CreateMeetingResponse`/`ReviseMeetingResponse` (AD-20/AR-16), the availability grid (UX-DR23), voting strategy in `votingStrategyFor`, and `meeting_availability` are Stories 7.2–7.4. Note `sprint-status.yaml:286` Prep-1 flags an AD-20 design review "before Story 7.1" — it concerns the revisable-vote primitive (7.2/7.3); nothing in 7.1 depends on it, but don't design the slot schema in a way that blocks `VOTE ||--o{ MEETING_AVAILABILITY` referencing `meeting_slot.id`.

### Architecture constraints

- AD-1/AD-2: strategy module is provider-free; form must work without JS (server-driven add-slot round-trip). No `Date.now()` in domain/adapters — inject `nowMs` (route captures once, `new.astro:403`).
- AD-3: one `db.batch` commits poll + slots + reference (+ media); UNIQUE-constraint → typed error mapping stays (`d1/index.ts:462–481`).
- AD-24: `representation_version` starts at 1; pre-Vote type/option edits increment it (existing path).
- Consistency (SPINE L519–534): POST → 303; 422 re-render with preserved values + inline field errors; Zod at delivery, invariants re-enforced in domain; snake_case D1, kebab-case files; migrations `NNNN_description.sql` forward-only, **next is 0016**; one structured log record per operation.

### Ruled defaults (decisions made for you — deviate only with reason)

1. **Date/time inputs:** DESIGN.md:616 explicitly defers the Phase-3 date/time input spec. Default ruling: use native `<input type="date">` / `<input type="time">` inside the shared bottom-rule `Input` treatment, accepting native picker chrome as a pragmatic exception (precedent: Turnstile is the one sanctioned chrome exception, DESIGN.md:531). Strip box/radius via CSS where the platform allows; do not build a custom picker.
2. **Row removal:** docs only say "rows added one at a time." Follow the options convention — a fully blank row is dropped on save, with the "Blank … dropped when you save." helper note adapted for slots. A row with some-but-not-all sub-fields filled is a per-row 422, not silently dropped. (`.option-remove` CSS exists unused; do not wire it in this story.)
3. **Slots-minimum copy:** the AC says "same idiom as the options minimum" (`"A Poll needs options. Add at least two."` / `"One option isn't a Poll. Add at least one more."`). Since slots ARE the options, reuse those exact strings keyed to the `slots` field unless the reviewer prefers slot-specific phrasing.
4. **Field naming:** indexed `slot_date_{i}` / `slot_start_{i}` / `slot_end_{i}` extracted by regex over `formData.entries()` — the `media_*_{i}` idiom (`new.astro:159–193`) — because each row has three correlated sub-fields.
5. **Empty timezone:** the hidden `timezone` field is empty with JS off; server already treats empty as UTC. The visible timezone line must then state UTC honestly (e.g. `TIMES IN UTC`).

### Traps

1. `matchesExistingPoll`/`draftContentForCompare` must learn slots, or a retried create with edited slots dedupes to the wrong poll.
2. `updateDefinitionForOwner` deletes + recreates `poll_option` with fresh ids — never route `meeting_slot` through it.
3. Multipart form: every field is `FormDataEntryValue`; use the `text()` helper (`new.astro:197`) so `File` parts never stringify.
4. `ranked-choice.test.ts:109–117` will fail the moment `meeting` is registered — update it in the same change.
5. Migration checksum manifest regenerated in the same commit; never edit 0001–0015.
6. Divergent-nonce and media-preservation re-render paths (`new.astro:153–165, 462–468`) must also carry slot values — every 422 branch preserves the whole form.
7. E2E: serial mode, no shared cookie jars, skip without `hasBetterAuthSecret()`.

### Project Structure Notes

- NEW: `src/modules/polls/types/meeting.ts`, `db/migrations/0016_meeting_slots.sql`, `tests/unit/meeting-strategy.test.ts`, `tests/integration/meeting-slots.integration.test.ts`, `tests/e2e/meeting-poll.spec.mjs`.
- UPDATE: `src/modules/polls/types/registry.ts`, `src/modules/polls/definition.ts`, `src/modules/polls/index.ts`, `src/adapters/d1/index.ts`, `src/pages/creator/new.astro`, `src/components/poll-definition-fields.astro`, `src/scripts/poll-definition-form.ts`, `src/pages/creator/polls/[pollId].astro`, `db/migrations.manifest.json`, `tests/unit/ranked-choice.test.ts`, `tests/unit/polls.test.ts`, `CHANGELOG.md`.
- Stack pins (no new libraries): Astro 7.1.5, `@astrojs/cloudflare` 14.1.6, TS 7.0.2, Zod 4.4.3, Vitest 4.1.10 + vitest-pool-workers 0.19.0, Playwright 1.62.0, Node 24.18.0, pnpm 11.17.0.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-7.1 L1105–1127; Epic 7 L184–187; UX-DR23/24 L115–116; AR-19 L86; AR-16 L83]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md — AD-3 L72–92, AD-6 L148–167, AD-20 L415–428, Consistency L519–534, Structural Seed L558–600, ER L622–637, capability map L672]
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md — FR-12 §4.5, FR-5 §4.1]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md — L53, L117–124, L165, L173, L224, L372, L375; DESIGN.md — L494, L502–531, L610–616]
- [Source: docs/design/poll-type-contract-check.md L87–118]
- [Source: _bmad-output/implementation-artifacts/6-3-media-cleanup-lifecycle.md — Dev Notes/Traps/Review; epic-6-retro-2026-08-08.md L86/L124 (Prep-2 DST property tests)]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- Implement each task in story order using red-green-refactor: migration contracts, provider-free meeting strategy, create persistence wiring, server-rendered slot builder, locked owner view, then complete unit/integration/E2E coverage and the full repository gate.

### Debug Log References

- Task 1 RED: `pnpm exec vitest run --project integration tests/integration/meeting-slots.integration.test.ts` failed all five tests before migration 0016 existed.
- Task 1 GREEN: migration guard passed for 16 checksummed migrations; focused meeting-slot plus CSV/XLSX regression set passed 21/21.
- Task 2 RED/GREEN: missing strategy module failed first; focused strategy tests passed 7/7, `pnpm check` passed, and full regression passed 122 files / 1705 tests.
- Task 3 RED/GREEN: Meeting create command initially returned validation failure; focused unit passed 195/195, schema/adapter passed 6/6, typecheck passed, and full regression passed 122 files / 1707 tests after preserving non-Meeting projection shape.
- Task 4: route-level slot-builder tests passed 10/10, typecheck passed, and full regression passed 122 files / 1710 tests.
- Task 5: locked Meeting lifecycle route suite passed 30/30, typecheck passed, and full regression passed 122 files / 1711 tests.
- Task 6 final gate: migration guard 16/16; Vitest 122 files / 1712 tests; Playwright 188/188; binding types drift-free; production build and `git diff --check` passed. Browser proof inspected at 375px dark with no horizontal overflow.

### Completion Notes List

- Task 1: Added normalized Meeting slot persistence with absolute UTC-millisecond bounds, retained IANA timezone, stable unique positions, cascade deletion, Meeting-only type guard, and fail-closed multi-select bounds guards. Updated export tests to use an actually unsupported sentinel now that `meeting` has storage semantics.
- Task 2: Added the provider-free Meeting creation strategy with exact minimum/end-order copy, stable reason codes, blank-row semantics, per-row errors, UTC conversion using the canonical civil-time converter, and DST-gap rejection.
- Task 3: Registered Meeting creation without enabling Meeting voting; wired definition validation, exact slot persistence, owner projection, and retry-dedupe comparison while keeping option rows empty and committing slots atomically with Poll/reference facts.
- Task 4: Added the accessible native slot builder, explicit UTC/IANA timezone line, inert field switching, indexed server parsing, no-JS add-slot round-trip, full 422 value preservation, and POST-to-303 publishing.
- Task 5: Added ordered read-only owner slot rendering after the first Vote, formatted from absolute instants in the Creator's stored timezone, while leaving Meeting definitions outside the option-replacement edit path.
- Task 6: Added focused unit, property, integration, route, lifecycle, and authenticated E2E coverage plus the Unreleased changelog entry; all acceptance criteria and the complete repository gate pass.

### File List

- `_bmad-output/implementation-artifacts/7-1-propose-time-slots.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `db/migrations/0016_meeting_slots.sql`
- `db/migrations.manifest.json`
- `tests/integration/meeting-slots.integration.test.ts`
- `tests/integration/csv-export-route.integration.test.ts`
- `tests/integration/xlsx-export-route.integration.test.ts`
- `src/modules/polls/types/meeting.ts`
- `tests/unit/meeting-strategy.test.ts`
- `src/modules/polls/types/registry.ts`
- `src/modules/polls/definition.ts`
- `src/modules/polls/index.ts`
- `src/adapters/d1/index.ts`
- `tests/unit/polls.test.ts`
- `tests/unit/ranked-choice.test.ts`
- `src/components/poll-definition-fields.astro`
- `src/pages/creator/new.astro`
- `src/scripts/poll-definition-form.ts`
- `tests/integration/create-poll-route.integration.test.ts`
- `src/pages/creator/polls/[pollId].astro`
- `tests/integration/creator-poll-lifecycle-route.integration.test.ts`
- `tests/e2e/meeting-poll.spec.mjs`
- `CHANGELOG.md`

### Change Log

- 2026-08-10: Implemented Story 7.1 Meeting Poll slot proposal, absolute-instant persistence, explicit timezone UI, locked owner rendering, and complete automated/browser coverage; moved to review.
