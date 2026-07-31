---
baseline_commit: 3115c1b6d29257a3ddfe5a9cc8814d8455746473
---

# Story 1.7: Multi-Select Voting

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Prerequisite: Story 1.6 is in `review` on branch `story/1-6-voting-page-states-resilience`. 1.7 modifies 1.6's voting page (`[reference].astro`) and vote-form script directly — start ONLY after 1.6's review closes and merges to main, then re-check `git log` (the baseline above is pre-1.6-merge main). Every `[1.6]`-tagged file reference below describes that branch's state. -->

## Story

As a Creator,
I want to let Voters pick several options with optional min/max bounds,
so that "choose your top three" polls work without becoming a survey.

## Acceptance Criteria

1. **Given** a Creator enabling multi-select at creation, **When** they optionally set min/max bounds, **Then** the bounds default to 1-to-all and are stored with the Poll (FR-7), **And** creation validates `min ≤ max ≤ option count` — a configuration that would make the Poll unvotable is rejected 422 inline, since options lock after a first Vote that could never arrive.
2. **Given** a Voter on a multi-select Poll with a configured max, **When** they reach the max, **Then** unselected rows go non-interactive with the caption line "Pick up to {max}. {n} chosen.", and below a configured min the vote button stays disabled with "Pick at least {min}." (UX-DR2), **And** checkbox rows use the same native-input construction with `[ ]`/`[×]` markers.
3. **Given** a submission outside the configured bounds (client hints bypassed), **When** it reaches the server, **Then** it is rejected with the violated bound named and the ballot returned intact (FR-7, UX-DR19).
4. **Given** a multi-select Poll's accepted Votes, **When** results are projected, **Then** the projection reports per-option counts plus distinct Voter count and total selection count — the data behind the `{n} VOTERS · {m} SELECTIONS` line (UX-DR3). `[SCOPE NOTE: the epics AC has the line rendering "above the bar group" — but the Tally surface, `results` module, and `/results` route are Story 1.8's to build (`src/modules/results/index.ts` is a placeholder; `results-bar.astro` is unwired). 1.7 ships the `projectResults` projection + tests; 1.8 renders the line. Flagged to Justin below.]`

## Tasks / Subtasks

- [x] Task 1: Add expand migration 0008 — bounds columns on `poll` (AC: #1)
  - [x] NEW `db/migrations/0008_multi_select.sql`: `ALTER TABLE poll ADD COLUMN multi_select_enabled INTEGER NOT NULL DEFAULT 0;` + `ALTER TABLE poll ADD COLUMN min_selections INTEGER;` + `ALTER TABLE poll ADD COLUMN max_selections INTEGER;` `[ASSUMPTION: explicit enable flag mirroring `session_checks_enabled` (discrete columns, never a settings blob — AD-3, 0004 header); bounds NULL = unset, meaning effective min 1 / max "all". NULL-for-default keeps "all" from being frozen as a number if options ever grow in a future capability]`. Header comment states: existing rows read as single-select via the defaults; SQLite cannot ALTER a column default (the 1.3-round-3 `is_canonical` lesson) so these defaults are final — and every INSERT sets all three explicitly anyway
  - [x] Do NOT touch 0004 or 0006 — `vote_selection`'s composite PK `(vote_id, poll_option_id)` was deliberately shaped for 1.7 (1.5's recorded decision); it needs no change, and it already aborts a duplicated option ID inside one ballot on UNIQUE
  - [x] `pnpm migrations:checksum` to append 0008 to `db/migrations.manifest.json`; `pnpm migrations:guard` green; `pnpm migrate:local`. The integration harness picks the new file up automatically via `readD1Migrations` → `TEST_MIGRATIONS`
  - [x] Extend `tests/integration/polls-schema.integration.test.ts` ("shapes poll with discrete columns…", :37) with the three columns and their defaults
- [x] Task 2: Creation domain — bounds validated and persisted (AC: #1)
  - [x] `src/modules/polls/types/multiple-choice.ts`: widen `MultipleChoiceCreateInput`/`MultipleChoiceCreationFacts` with `multiSelect: boolean`, `minSelections: number | null`, `maxSelections: number | null` — bounds on `TCreateInput`/`TCreationFacts` are pre-authorized at `docs/design/poll-type-contract-check.md:47-48`; Task 4's `TValidatedSubmission` widening and Task 6's `projectResults` narrowing are NEW sanctioned refinements of the same kind — record all three in that doc, with NO `POLL_TYPE_CONTRACT_VERSION` bump and NO change to `src/shared/application/index.ts` (bumping is a spine violation here — the compile-time consumer `tests/unit/shared-kernel.test.ts` stays put)
  - [x] `src/modules/polls/index.ts`: `CreatePollDraft` gains raw `multiSelect`/`minSelections`/`maxSelections` strings; `validateCreatePoll` (:233-363, the `fail(field, reason, message)` idiom) enforces on multi-select: integers only, `1 ≤ min ≤ max ≤ option count` (blank min → 1, blank max → option count; `min ≥ 1` is implicit in epics' inequality but REQUIRED — min 0 would legalize the empty ballot FR-6/1.5 rejects `[ASSUMPTION]`); bounds supplied while multi-select is off → field error, not silently ignored `[ASSUMPTION: reject beats discard — a Creator who typed bounds meant multi-select]`. New `CREATE_POLL_COPY` entries interpolate live values (the `optionsTooMany` cap-interpolation precedent) `[ASSUMPTION — no Voice-and-Tone rows exist for creator bounds errors; authored in-voice, flag copy to Justin]`: `boundsMinTooLow: "Min is at least 1 — a Poll someone can't vote in isn't a Poll."`, `boundsOrder: "Min can't be more than max."`, `boundsMaxTooHigh: \`Max can't be more than the option count (${count}).\``, `boundsWithoutMultiSelect: "Bounds only apply when multi-select is on."`
  - [x] Persist through the whole D4 chain — miss one and retries silently dedupe wrong: `ValidatedCreatePoll`, `PollPersistenceRows.poll`, `ExistingPollSnapshot`, `matchesExistingPoll` (:463-485), `draftContentForCompare` (:501-528), the `createPoll` rows literal (:641-668)
  - [x] `src/adapters/d1/index.ts`: `insertPoll` SQL + positional binds gain the three columns (set explicitly, never rely on defaults); reads gain them everywhere a snapshot is built. `toPollPage` (:68-79) feeds BOTH `findPollByReference` (voting GET) and `findPollForOwner` (creator detail), so adding the fields to `PollRow`/`PollPage`/`toPollPage` covers both surfaces in one edit — but the voting `findPoll` (:305-329) is a separate hand-rolled row type that must be edited independently
  - [x] Record all three exercised refinements in `docs/design/poll-type-contract-check.md` (it tracks contract-fit per story)
- [x] Task 3: Creator form — multi-select chooser + bounds inputs (AC: #1)
  - [x] `src/pages/creator/new.astro`: a fieldset following the visibility-chooser pattern (:286-305) — two `PollOption` radio rows `[ASSUMPTION: UX GAP — no creator-side multi-select UI exists anywhere in DESIGN/EXPERIENCE/mockups; the `poll-option` single-select chooser is the established creator-choice idiom (visibility, listing). Legend `HOW MANY OPTIONS CAN A VOTER PICK` with rows "One" / "Several" `[flag copy]`; two optional numeric `input`s (MIN, MAX) shown under "Several", validation on submit only, inline `field-error` beneath (UX-DR14) — never a tooltip/modal/summary]`. Zod schema + formData read + `values` round-trip the three fields so 422 re-renders preserve them
  - [x] `src/scripts/create-poll-form.ts`: mirror the bounds rules client-side off `POLL_CAPS`-style constants (put any shared ceiling in `src/modules/polls/caps.ts` — it exists precisely so browser chunks import caps without the domain command). No-JS floor: the form posts and 422s server-side exactly like every other field
- [x] Task 4: Submission domain — server-enforced bounds (AC: #3)
  - [x] `src/modules/polls/types/multiple-choice.ts` `validateSubmission` (:77-115): keep `selection_required` (empty) and `invalid_selection` (unknown option) exactly as-is; single-select polls keep the exactly-one rule; multi-select validates every ID known, no duplicates, then `count < effectiveMin` → code `too_few_selections`, `count > effectiveMax` → code `too_many_selections`. **The strategy composes the final voter-facing sentence with the live number already substituted** — `VOTE_COPY.tooFewSelections`/`tooManySelections` are the templates the STRATEGY interpolates, never strings the page renders raw (this is what keeps the `voting.test.ts:697` exact-catalog pin and the rendered copy from drifting). `MultipleChoiceValidatedSubmission.selectedOptionIds` widens `readonly [PollOptionId]` → `readonly PollOptionId[]`; `MultipleChoiceValidationFacts` gains the bounds (the `Omit<…> & {…}` narrowing precedent at :49-63 — shared interface untouched)
  - [x] `src/modules/voting/index.ts`: widen the DUPLICATE tuple `ValidatedVoteSubmission` and the `VotingPollTypeStrategy` facts `Pick` in the same change (won't compile apart) — `Pick<VotingPollSnapshot, "options">` (:94) becomes `Pick<VotingPollSnapshot, "options" | "multiSelectEnabled" | "minSelections" | "maxSelections">` with the new fields **required, never optional** (optional fields silently disable bounds enforcement while every single-select test stays green — the fake-completion trap), AND the facts literal at the call site (:310-312, currently `{ options: poll.options }`) extends to pass all four from the snapshot in the same edit; `VotingPollSnapshot` gains `multiSelectEnabled`/`minSelections`/`maxSelections`; extend the validation-error passthrough (:316-338) so the two new codes pass `strategyError.message` through **unmodified** — do NOT substitute `VOTE_COPY` the way the `selection_required` branch does (that branch discards the strategy message; here the strategy message carries the interpolated bound). New `VOTE_COPY` entries `[ASSUMPTION — no Voice-and-Tone rows exist for out-of-bounds; authored in-voice ("state facts, don't cheer", ballot-preservation clause from the `retry` idiom), flag copy to Justin]`: `tooFewSelections: "Not enough selections. This Poll asks for at least {min}, and your ballot is still here."`, `tooManySelections: "Too many selections. This Poll takes up to {max}, and your ballot is still here."` — headings split clean at the first `". "` (the `splitCopy` rule)
  - [x] `src/pages/[reference].astro` `[1.6]` POST: map the two codes in `outcomeFromError` exactly as the `invalid_selection` case does (:205-213) — `...splitCopy(error.message)`, tone `rejection`, `titlePrefix: "Vote not counted"`. `outcomeFromError` receives only the error (never the poll) and `VoteOutcomeView` has no numeric slot — which is WHY the strategy message must arrive fully interpolated; the page renders, never composes `[ASSUMPTION: rides the message-passthrough precedent rather than adding a numeric slot to `VoteOutcomeView` — same output, less machinery]`. Everything 1.5/1.6 hardened stays byte-for-byte: fresh `submission_id` on every 422, ballot re-checked from `selectedOptionIds`, outcome line first-in-main `tabindex="-1"` focused, `private, no-store`, replay-before-limiter, the 1.4 lookup/301 chain untouched
  - [x] NO change to `normalizeVotePayload` (already order-invariant over N IDs), NO change to the zod ballot schema (already `z.array(...).max(POLL_CAPS.maxOptions)` "so Story 1.7 multi-select ballots on large polls are never schema-rejected"), NO change to `insertVote` (contribution loop already writes N `vote_selection` rows), NO new claim/idempotency logic — AD-7 semantics are selection-count-blind. A changed checkbox set replayed under the same `submission_id` must return `idempotency_conflict` — that behavior exists; prove it for N>1 in tests
- [x] Task 5: Voter surface — checkbox rows + bounds hints (AC: #2)
  - [x] `src/pages/[reference].astro` `[1.6]` GET: multi-select polls pass `type="checkbox"` to `PollOption` (the prop exists since 1.1, never passed); render the caption bounds line above the option group as a pre-rendered element (empty when no bound applies), `class` on `{typography.caption}` (12px/1.5 `dim`) `[ASSUMPTION: caption per EXPERIENCE.md:139 — the explicit, more specific spec — NOT the 11px label-caps the button-hint rule implies]`
  - [x] `src/components/poll-option.astro`: marker CSS for the checkbox variant — `content: "[ ]"` unchecked in `--poll-option-marker` (faint), `content: "[×]"` checked in `--poll-option-marker-selected` (solar-ink) — keyed off input type on interactive rows, decorative `::before` only (glyphs must stay OUT of accessible names, DESIGN.md:540). **The read-only branch (:30-46) renders NO input at all** — the variant must be carried by a class there: add `type === "checkbox" && "poll-option-checkbox"` to the read-only wrapper's `class:list`, with `.poll-option-checkbox .poll-option-marker::before { content: "[ ]" }` and `.poll-option-checkbox .poll-option-marker.is-cast::before { content: "[×]" }`; `[reference].astro`'s read-only `<PollOption>` (:677-690) passes `type={multiSelect ? "checkbox" : "radio"}` alongside `readOnly` — otherwise a cast 3-of-5 ballot renders `◆ ◆ ◆ · ·`. Uncast rows on a cast multi-select ballot read `[ ]`, not `·`. The marker gutter is `width: 14px` (:109-115); `[ ]`/`[×]` need ~2ch — widen to a `ch`-relative width for the checkbox variant only, leaving the radio gutter at 14px so `·`/`◆` alignment is untouched. Do not touch `·`/`◆`
  - [x] `src/scripts/vote-form.ts` `[1.6]`: replace the boolean `hasSelection` rule (:120-131) with bounds-aware rules from data attributes the server renders (`data-multi-select`, `data-min`, `data-max` `[ASSUMPTION: mechanism]`): button enabled iff `min ≤ checked ≤ max`; caption line text via `textContent` only (`no-raw-html` gate) — below min → `Pick at least {min}.`, at max → `Pick up to {max}. {n} chosen.`, otherwise empty. The two texts CANNOT co-occur (at max ⇒ count = max ≥ min), so there is no precedence question. Selectors: options are already collected via `input[name="option_id"]` (:113-115); give the caption line its own hook (`data-bounds-hint` `[ASSUMPTION]`) alongside the existing `[data-vote-hint]`. Single-select polls keep today's behavior and hint verbatim
  - [x] Max-reached non-interactivity: NEVER the `disabled` attribute (a disabled checked input leaves the form entry list — the exact create-form/1.6 hazard — and `disabled` also ejects rows from tab order); guard in the `change` handler reverting any check past max (the `inFlightSelection` Set-revert pattern already in this file) + a `data-max-reached` styling hook on the form that suppresses the hover fill and sets `cursor: default` on unselected rows so the refusal is predictable BEFORE the tap `[ASSUMPTION: mechanism — visible affordance without opacity or color-as-state]`. No `aria-disabled` — with a revert guard the input genuinely remains operable, so `aria-disabled="true"` would misreport state; the caption line carries the semantics. On a REFUSED check, re-assert the caption line's text so the polite region announces again — otherwise a screen-reader user hears "checked" followed by silence while the check silently reverts. SELECTED rows stay fully toggleable — a Voter at max can always uncheck to change their mind (the spec says only "unselected rows" go non-interactive). No opacity, no `faint`, no color-alone state (UX-DR6 precedent, DESIGN.md:689-690)
  - [x] Make the caption line an `aria-live="polite"` region `[ASSUMPTION: not in the UX docs, but the rank-builder line (EXPERIENCE.md:144) is the exact structural precedent — `{n}` changes on every toggle and max-reached silently disables rows; without announcement a screen-reader user discovers neither]`. It stays OUTSIDE the 1.6 offline/outcome slot — different lifecycle, different region
  - [x] No-JS floor stated: without JS, checkboxes check freely and the button is enabled — bounds enforcement is Task 4's server 422 with the ballot re-checked (AC #3 IS the no-JS path). Client hints are a courtesy, never the check (EXPERIENCE.md:139)
  - [x] Preserve every 1.6 behavior on multi-select polls: `COUNTING…` in-flight lock + Set-revert, offline copy + slot, deadline row, countdown, `pageshow` restore — the in-flight guard and the max-guard share the change handler; keep their conditions independent
- [x] Task 6: Results projection shape (AC: #4)
  - [x] Implement `projectResults` on the multiple-choice strategy: pure function → `{ options: { pollOptionId, count }[]; voterCount; selectionCount }` `[ASSUMPTION: shape — per-option counts + distinct-voter count + total selections, exactly what `{n} VOTERS · {m} SELECTIONS` and per-option bars need]`. **The frozen port types `projectResults` against ONE vote's persisted facts (`MultipleChoicePersistedFacts` is a single submission's selections — see `shared-kernel.test.ts:85`), and cross-vote aggregates are not derivable from one vote.** Narrow the port the same way `validateSubmission` already is: extend the `Omit<…>` at `multiple-choice.ts:49-63` to `Omit<…, "validateSubmission" | "projectResults">` and declare `projectResults: (facts: MultipleChoiceProjectionFacts) => MultipleChoiceResultProjection` where `MultipleChoiceProjectionFacts = { votes: { selections: { pollOptionId: PollOptionId }[] }[]; options: { id: PollOptionId }[] }`. `MultipleChoicePersistedFacts`, `persistFacts`, and `voting/index.ts`'s `persistFacts` signature are UNCHANGED — do NOT widen persisted facts to fix the compile error (that regresses the AD-7 path), and do NOT touch the shared kernel. Same sanctioned-refinement path, still no version bump — record it in the contract-check doc alongside the bounds widening
  - [x] Unit-test single- and multi-select fixtures incl. voterCount < selectionCount, an option with zero selections, and empty votes. The SQL projection (AD-9) and all rendering are 1.8's — build no route, no component wiring, no `results` module content
  - [x] Update the stale one-story-later comments: `multiple-choice.ts` header says `projectResults` "lands with 1.8" — reword to data-in-1.7 / surface-in-1.8; note the early arrival in `poll-type-contract-check.md`. Do NOT touch `src/shared/application/index.ts:51`'s comment — zero shared-kernel diff is a review assertion; the divergence is recorded in the doc instead (the 0004-stale-comment lesson, deferred-work.md:59)
- [x] Task 7: Tests + gates (AC: all)
  - [x] Unit: `polls.test.ts` — bounds validation matrix (defaults, blank→1-to-all, min 0, min>max, max>count, non-integer, bounds-without-multi-select, boundary equalities min=max=count); `voting.test.ts` — multi-select accept at min/max edges, `too_few`/`too_many` codes + interpolated copy, single-select regression untouched, `VOTE_COPY` exact-catalog pin (:696-720) updated in the SAME change, permutation-invariance property extended to N>1 (fast-check), changed-set-same-id → `idempotency_conflict`; `shared-kernel.test.ts` — must NOT move (contract unchanged is itself the assertion)
  - [x] Integration: `polls-schema` 0008 columns/defaults; `polls-adapter` bounds round-trip + D4 dedupe divergence on bounds-only difference (the `matchesExistingPoll` trap); `votes-adapter` — one batch commits vote + N `vote_selection` rows + claim + version increment atomically; duplicate option ID in one ballot aborts the whole batch (composite-PK guard); replay of a committed multi-select vote returns the stored outcome
  - [x] E2E (`vote.spec.mjs` + `create-poll-authed.spec.mjs` patterns, `creator-session.mjs` helpers): create a multi-select poll with bounds via the form (bad bounds → inline 422, fields preserved); voter page renders checkboxes with `[ ]`/`[×]`; below min → button disabled + `Pick at least {min}.`; at max → unselected rows refuse checks, selected rows still uncheck, caption shows `Pick up to {max}. {n} chosen.`; forced out-of-bounds POST (JS-off or scripted) → 422 naming the bound with the real number (never a literal `{min}`), every checkbox re-checked, fresh `submission_id`, outcome focused; happy path counts once and replays clean; POST-vote and already-voted read-only renders show `[×]` on every cast row and `[ ]` on uncast rows (never `◆`/`·`). Keep specs retry-tolerant (`cleanupCreator` in `afterAll` — the 1.4 CI-retry hazard)
  - [x] Gates in the 1.5/1.6 order: `pnpm migrations:guard` → full Vitest → `pnpm check` → Playwright → `pnpm types` → production build — all green before story-done

## Dev Notes

### Decisions resolved at story-creation time (all `[ASSUMPTION]`-marked — flag to Justin if any feel wrong)

| Gap (unspecified or conflicting in sources) | Decision | Rationale |
| --- | --- | --- |
| AC #4 straddles the 1.8 boundary (Tally surface doesn't exist) | **1.7 ships `projectResults` + tests; 1.8 renders `{n} VOTERS · {m} SELECTIONS`** — AC #4 rewritten to projection scope with an explicit handoff note | `results` module is a placeholder, no `/results` route; epics deliberately sequence results-bar work late; shipping data-without-surface keeps 1.7 shippable and 1.8 honest |
| Storage model | `multi_select_enabled` flag + nullable `min_selections`/`max_selections` (NULL = 1-to-all) | Discrete columns never a blob (AD-3, 0004 header); flag mirrors `session_checks_enabled`; NULL-max survives any future option-count change; defaults leave every existing row single-select |
| `min ≥ 1` (epics' inequality omits it) | Enforced — min 0 rejected at creation | Min 0 legalizes the empty ballot that FR-6/1.5's `selection_required` rejects; "default 1 to all" already names 1 as the floor |
| Out-of-bounds rejection copy (absent from Voice and Tone) | Authored: "Not enough selections. This Poll asks for at least {min}, and your ballot is still here." / "Too many selections. This Poll takes up to {max}, and your ballot is still here." | AC #3 requires the violated bound named; voice rules applied (facts not cheer, ballot-preservation clause, layout-neutral, splits clean at first `". "`); needs Voice-and-Tone ratification |
| Bounds line typography — caption (EXPERIENCE:139) vs label-caps button hint (UX-DR8/DESIGN:605) | **One caption line above the option group carries both texts; it IS the multi-select unlock hint** — the single-select `SELECT AN OPTION TO UNLOCK VOTE` label-caps hint is not shown on multi-select polls | EXPERIENCE.md:139 explicitly specifies `{typography.caption}` for this line and puts both strings on "the same line" — sufficient authority on its own; two lines saying the same thing violates the one-affordance instinct. The two texts are mutually exclusive (at max ⇒ min met) |
| Max-reached mechanism | Change-handler revert guard + `data-max-reached` hook (hover fill suppressed, `cursor: default` on unselected rows); NO `disabled`, NO `aria-disabled`, never opacity; refused checks re-announce the caption line | Disabled checked inputs drop out of the form entry list (create-form/1.6 hazard) and out of tab order; `aria-disabled` would misreport a still-operable input; UX-DR6/DESIGN:689 ban opacity-as-state; selected rows must stay toggleable |
| Bounds line as live region | `aria-live="polite"` on the caption line | Rank-builder precedent (EXPERIENCE:144) is structurally identical; not spec'd for multi-select — extension, flag it |
| Creator-side UI (designed nowhere) | `poll-option` two-way chooser ("One"/"Several") + two optional numeric inputs, submit-only validation, inline errors | The chooser idiom is how every creator choice renders (visibility, listing); UX-DR14 governs inputs; heaviest assumption in the story — flag before build if unsure |
| Bounds mutability after first Vote | Bounds lock with question/options/type (AD-17 tighten-only rationale: retroactive bound edits invalidate accepted ballots). NO enforcement code in 1.7 — no edit surface exists until 1.12; record so 1.12 inherits it | AD-17 names question/options/type only; bounds are poll configuration of the same kind |
| New error codes + who interpolates `{min}`/`{max}` | Stable codes `too_few_selections` / `too_many_selections`; **the strategy interpolates the bound into the final sentence from the `VOTE_COPY` templates; `castVote` passes the message through unmodified; the page renders it via `splitCopy` like `invalid_selection`** | AR-19 stable-code discipline; `outcomeFromError` never sees the poll and `VoteOutcomeView` has no numeric slot, so page-side interpolation is impossible without new machinery; review lesson 1.2→1.5: map codes once, pages render never classify |

### Scope boundaries — build none of these

- **Tally/results rendering, `{n} VOTERS · {m} SELECTIONS` line, results-bar wiring, `/results` route, SQL projection** → 1.8 (1.7 ships the pure `projectResults` shape only). **Hand-off: 1.8's story MUST pick up the line's rendering — it is 1.7's AC #4 in epics.md**
- **Live updates / `representation_version` polling** → 1.9 (multi-select votes already bump the version via the shared helper — nothing to add)
- **`YOUR BALLOT` multi-choice rendering + separator on the Tally** → 1.8 `[the UX docs never specify the separator; the system idiom is the middot — note for 1.8]`
- **Bounds editing/locking enforcement UI** → 1.12 (close/edit/delete); decision recorded above
- **Image polls reusing the bounds model** → Epic 6 (keep bounds on `poll` + strategy facts, nothing text-option-specific — FR-11 reuse constraint)
- **Ranked/meeting strategy changes, `ranked_choice` checkboxes** — none; only the `multiple_choice` strategy changes
- **Turnstile, IP checks, rate-limit changes** → Epic 2 / already shipped; bounds validation slots into `validateSubmission` before any of it
- **No new dependency, no contract-version bump, no wrangler/binding change, no service worker**

### Architecture constraints that bind this story

- **AD-3/AR-4 + frozen contract:** multi-select is a flag on the `multiple_choice` strategy, NEVER a fifth `PollType` (the enum and AD-23 shared kernel stay untouched); widening this type's own generics is pre-authorized with no `POLL_TYPE_CONTRACT_VERSION` bump [Source: docs/design/poll-type-contract-check.md:45-53; ARCHITECTURE-SPINE.md#AD-3, #AD-23]
- **AD-7/AR-5:** the vote transaction shape does not change — vote + N selections + claim + version increment in one `db.batch()`; `vote_selection`'s composite PK is the in-ballot dedupe; the D1 trigger stays the close boundary; changed-payload replays conflict permanently [Source: ARCHITECTURE-SPINE.md#AD-7; db/migrations/0006_votes.sql]
- **AD-14:** forward-only 0008; never edit 0004/0006; manifest checksum refreshed; expand-style (existing rows valid under defaults) [Source: ARCHITECTURE-SPINE.md#AD-14]
- **AD-9/NFR-6:** all tallying server-side from accepted facts; voterCount = distinct votes, selectionCount = selection rows — never client math [Source: ARCHITECTURE-SPINE.md#AD-9]
- **AD-2/NFR-5:** server-rendered floor — no-JS multi-select voting works end-to-end with server 422 bounds enforcement; hints are isolated vanilla TS in the existing `vote-form.ts` (multi-select "selection state" is on UX-DR25's sanctioned-JS list) [Source: ARCHITECTURE-SPINE.md#AD-2; epics.md#UX-DR25]
- **AD-15/AR-12:** a selection SET is ballot content — never in logs, telemetry, or error detail [Source: ARCHITECTURE-SPINE.md#AD-15]
- **AR-19:** stable codes mapped once; 422 re-render with preserved values; snake_case columns, kebab-case files [Source: ARCHITECTURE-SPINE.md#Consistency Conventions]
- **review-current-tech H2:** never infer batch failure from `changes: 0` — constraints/triggers are the only in-transaction guards (already the pattern; don't add post-batch inspection for bounds) [Source: reviews/review-current-tech.md#H2]
- **NFR-11 (category-defining):** the poll must still read as a casual poll card — no required-field asterisks on the min bound, no survey furniture [Source: prd.md#NFR-11; EXPERIENCE.md:422]

### Existing code — read before touching (state on the 1.6 branch → change → preserve)

| File `[1.6 branch]` | Today | This story | Must not break |
| --- | --- | --- | --- |
| `src/modules/polls/types/multiple-choice.ts` | Single-select gate: 1-tuple `ValidatedSubmission`, `selection_required`/`invalid_selection`; `persistFacts` already maps N; `create` maps labels→positions | Widen generics with bounds; bounds-aware `validateSubmission`; implement `projectResults` | The `Omit<…> & {…}` narrowing shape; both existing codes and copy verbatim; single-select behavior byte-for-byte |
| `src/modules/voting/index.ts` | `castVote` pipeline; `VOTE_COPY` (pinned exactly by voting.test.ts:697); duplicate 1-tuple + `VotingPollTypeStrategy` Pick; passthrough switch :316-338 | Widen tuple+Pick together; snapshot bounds; 2 new copy lines + passthrough codes | Every existing code/copy line; replay-adjudication order; the throw→Result degradation |
| `src/modules/polls/index.ts` | `validateCreatePoll` + `fail()` idiom; D4 dedupe trio (`ExistingPollSnapshot`/`matchesExistingPoll`/`draftContentForCompare`); rows literal | Bounds through validation + ALL THREE dedupe pieces + rows | Existing field validations, copy, error mapping (`DuplicatePollIdError` precedence) |
| `src/adapters/d1/index.ts` | `insertPoll` positional SQL; voting `findPoll` SELECT; contribution loop (N-ready); regex error mapping | Add 3 columns to writes + every read | Error-text regexes; batch statement order; `findVoteSelectionByClaim` (already array) |
| `src/pages/[reference].astro` | 861 lines; GET/POST; zod ballot schema already N-bounded; `outcomeFromError`/`splitCopy`; fresh-ID 422s; review-hardened 1.4 lookup chain | `type="checkbox"` pass-through, caption line, data attrs, 2 outcome mappings | EVERYTHING 1.5/1.6 hardened: lookup/301 chain, fresh `submission_id`, focus contract, `private, no-store`, flash-on-GET-only, replay-before-limiter |
| `src/scripts/vote-form.ts` | `[1.6]` deadline + offline + in-flight lifecycle + boolean `hasSelection` sync | Bounds-aware sync + max guard + live caption | Deadline/offline/in-flight verbatim; single-select path identical; `data-vote-locked` handling |
| `src/pages/creator/new.astro` + `create-poll-form.ts` | Form with visibility-chooser fieldset pattern; caps-mirroring client script | New chooser fieldset + bounds inputs; client mirror | Every existing field, the no-JS `add-option` round-trip, intent stamp, nonce handling |
| `src/components/poll-option.astro` | `type` prop exists unused; `·`/`◆` CSS only; readOnly `is-cast` | `[ ]`/`[×]` CSS; readOnly checkbox variant | Radio markers untouched; both existing consumers (create-form visibility chooser, vote form) |
| `src/shared/{domain,application}/index.ts` | Enums + frozen contract v1 | **NOTHING** | The point: zero shared-kernel diff is a review assertion |
| `db/migrations/*` + manifest | 0001–0007 checksummed | NEW 0008 only | Immutability (guard enforces) |

### UX contract — exact copy and behavior

| Moment | Copy (verbatim) | Source |
| --- | --- | --- |
| Max reached (caption line) | Pick up to {max}. {n} chosen. | epics.md:415; EXPERIENCE.md:139 |
| Below min (caption line, button disabled) | Pick at least {min}. | epics.md:415; EXPERIENCE.md:139 |
| Server too-few 422 | **Not enough selections.** This Poll asks for at least {min}, and your ballot is still here. | `[ASSUMPTION — authored]` |
| Server too-many 422 | **Too many selections.** This Poll takes up to {max}, and your ballot is still here. | `[ASSUMPTION — authored]` |
| Markers | `[ ]` faint / `[×]` solar-ink; decorative `::before`, never in accessible names | DESIGN.md:540 |
| Tally line (1.8 renders) | {n} VOTERS · {m} SELECTIONS — label-caps-lg, text color not dim | DESIGN.md:556, :491 |

Behavior invariants: tapping anywhere on a row toggles it; nothing submits on selection; checkbox groups get `Tab`+`Space`, NOT arrow-key roving (EXPERIENCE.md:221 scopes arrow keys to single-select); zero selections keeps the button disabled even with no configured min (effective min 1); disabled button = `dim` never `faint`; nothing on option rows animates (five primitives are the Tally's); no exclamation marks, no emoji, layout-neutral copy; hover fill stays the near-no-op `panel`; selection stays the only gold on the voting surface. [Source: EXPERIENCE.md:138-139, :219-226, :251, :257-260; DESIGN.md:538-542, :605]

Accessibility: option accessible names carry state (`[×]` glyph does the visual work, `checked` does the semantic work); post-submit focus contract on the two new 422 outcomes exactly as 1.5 built it; caption live region polite, never assertive, never per-keystroke chatter beyond the toggle-driven text swap; 48px targets; focus ring never removed. [Source: EXPERIENCE.md:244-260]

### Previous story intelligence (1.5/1.6 Dev Agent Records + review lessons)

- 1.6 is in `review` on `story/1-6-voting-page-states-resilience` (345 Vitest / 52 Playwright green at completion). Its scope boundary names this story: "Multi-select hints, checkbox rows, bounds copy → 1.7". It added to `vote-form.ts`: deadline localization/countdown, offline outcome slot (`data-offline-outcome`), in-flight `COUNTING…` with `inFlightSelection` Set-revert — your max-guard shares that change handler; compose, don't replace
- 1.5's decisions this story leans on: `normalizeVotePayload` sorts IDs (permutation-proof exists at voting.test.ts:105); `vote_selection` composite PK recorded as "must hold for 1.7 multi-select without another migration"; the zod ballot bound comment names 1.7; rejected submissions store nothing → fresh `submission_id` every 422 (1.6 hardened); `PollClosedError` re-reads before failing so a recorded vote is never called unrecorded
- Deferred-work items binding here: `is_canonical` default lesson → set every new column explicitly in INSERTs, defaults are unfixable; FK failures in the vote batch all map to `PollGoneError` (D1 error text can't be narrowed) — bounds validation must reject unknown option IDs BEFORE the batch so a bad ballot never rides the FK path; `poll_reference.kind` unchecked-cast pattern — prefer validating new column values at the domain edge, not trusting the row
- Review lessons (1.2→1.6): stable codes mapped once in the command, pages render never classify; `[reference].astro`'s lookup chain burned five rounds in 1.4 — add to it without reordering; the `VOTE_COPY` exact-pin test changes in the same commit as the catalog; `no-raw-html.test.mjs` walks src/ — all dynamic text via `textContent`
- Integration harness: workerd + real D1, migrations via `TEST_MIGRATIONS` (0008 auto-included); route-level 422 pattern in `create-poll-route.integration.test.ts`; e2e `creator-session.mjs` has `seedCreatorSession`/`d1Query`/`setPollDeadline` — seed a multi-select poll by driving the real create form or direct `d1Query` UPDATE of the new columns

### Project Structure Notes

- New files: `db/migrations/0008_multi_select.sql`; tests may be new files or extensions per existing suite boundaries (unit stays out of the workerd pool; `*.integration.test.ts` naming)
- Updated: the nine files in the table above + `db/migrations.manifest.json` + `docs/design/poll-type-contract-check.md` + test suites. NO shared-kernel change, NO new dependency, NO binding/wrangler change
- Latest-tech check: nothing new — native `<input type="checkbox">`, SQLite `ALTER TABLE ... ADD COLUMN` (long-supported in D1), `aria-live` are all stable platform features on the pinned stack (TS 7.0.2, Astro 7.1.5, Vitest 4.1.10, Playwright 1.62.0); no library research required, no version movement since 1.6's check

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.7 (lines 400-424) — story statement + 4 ACs; #UX-DR2 (:93), #UX-DR3 (:94), #UX-DR8 (:99), #UX-DR14, #UX-DR19 (:110), #UX-DR25 (:116); FR-7 restatement]
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md#FR-7 (:131-135), #FR-6, #FR-5 lock rationale, #NFR-11, §10 Assumptions Index (bounds are a flagged assumption); §4.4 Image-poll reuse constraint]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md#AD-3, #AD-7, #AD-9, #AD-14, #AD-15, #AD-17, #AD-23, #Consistency Conventions; reviews/review-adversarial.md#H-3/H-6, reviews/review-current-tech.md#H2, reviews/reconcile-ux.md finding 5]
- [Source: docs/design/poll-type-contract-check.md:45-53 — 1.7's widening pre-authorized, no version bump; §Sanctioned refinements]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md:139 (THE multi-select row), :138, :68 (placeholders), :144 (rank-builder live region), :152, :174-196 (state patterns), :219-226, :234-242, :244-260, :422; DESIGN.md:540 (markers), :556 (VOTERS·SELECTIONS), :491, :538-542, :605, :689-690; review-accessibility.md:45, :51]
- [Source: db/migrations/0004_polls.sql:9 ("multi-select columns arrive with Story 1.7"), 0006_votes.sql (composite PK + trigger); src/pages/[reference].astro:246-250 (1.7-ready zod bound); src/components/poll-option.astro:11 (unused `type` prop)]
- [Source: _bmad-output/implementation-artifacts/1-5-cast-a-vote-that-counts-exactly-once.md (:34 composite-PK decision, :169 scope boundary), 1-6-voting-page-states-resilience.md (:73 scope boundary; decisions table), deferred-work.md (is_canonical lesson :37, FK→PollGone :74, kind unchecked-cast :58)]

## Dev Agent Record

### Agent Model Used

OpenAI Codex (GPT-5)

### Implementation Plan

- Follow the story task order with test-first slices: schema, creation domain and persistence, creator UI, submission policy, voter UI, results projection, then full gates.
- Preserve the frozen shared Poll Type contract and widen only the multiple-choice strategy's own generic facts and projections.
- Keep D1 constraints and the existing one-batch vote transaction as the integrity boundary; add no new dependency, binding, or shared-kernel change.

### Debug Log References

- Task 1 RED: `pnpm test -- tests/integration/polls-schema.integration.test.ts` failed because the three Story 1.7 columns were absent.
- Task 1 GREEN: migration guard passed for 8 checksummed files; local migrations applied; full Vitest passed 23 files / 345 tests.
- Task 2 RED: 13 unit assertions failed until bounds joined validation, strategy facts, persistence rows, and D4 comparison; the adapter round-trip initially exposed the required voting-snapshot assertion update.
- Task 2 GREEN: full Vitest passed 23 files / 356 tests and `pnpm check` passed.
- Task 3 RED: creator E2E exposed the absent multi-select fieldset and undefined form fields on POST.
- Task 3 GREEN: the full creator E2E spec passed 22 tests; full Vitest remained green at 23 files / 356 tests and `pnpm check` passed.
- Task 4 RED: eight focused assertions failed until N-selection validation, bound-specific errors, and application-code passthrough were implemented.
- Task 4 GREEN: focused unit coverage passed 290 tests, full Vitest passed 23 files / 368 tests before the final forwarding assertion, and `pnpm check` passed.
- Task 5 RED: focused voter E2E first found radio-only rendering, then caught the max-state hook's empty attribute value before its CSS could apply.
- Task 5 GREEN: all three multi-select voter scenarios and the complete voting E2E file passed (26 tests), with mobile active/read-only screenshots and zero unexpected browser console errors.
- Task 6 RED: three projection fixtures returned `undefined` before the narrowed pure projector existed.
- Task 6 GREEN: unit coverage passed 293 tests and `pnpm check` passed with the shared kernel untouched.
- Task 7 audit: independent implementation and test reviews found no remaining defects after tightening D4 bounds divergence, effective-default, exact-copy, no-JS 422, live-region, focus-restoration, and checkbox-keyboard coverage. The scoped accessibility review is clear; active, read-only, and creator mobile screenshots were inspected with no unexpected browser console errors.
- Final gate (Node 24.18.0, in order): migration guard passed 8/8 checksums; Vitest passed 23 files / 385 tests; `pnpm check` passed; Playwright passed 59/59; `pnpm types` completed with no tracked drift; `pnpm build:production` completed.

### Completion Notes List

- Added forward-only migration 0008 with single-select-safe defaults and nullable effective bounds; left migrations 0004 and 0006 unchanged.
- Added validated multi-select creation facts and explicit D1 persistence/read mapping, including bounds-sensitive idempotency matching with no shared-kernel version bump.
- Added the creator One/Several chooser, optional numeric bounds, accessible inline validation, value-preserving 422/no-JS behavior, and browser-side bounds constraints.
- Enforced effective selection bounds in the multiple-choice strategy, preserved single-select and idempotency semantics, and carried fully interpolated bound errors through the voting application and page outcome mapping.
- Added accessible checkbox rows, live effective-bound guidance, non-disabling max refusal, no-JS ballot preservation, and `[ ]`/`[×]` active/read-only markers without regressing the 1.6 lifecycle.
- Added the pure multi-select result projection with per-option, distinct-voter, and total-selection counts while deferring SQL and rendering to Story 1.8.
- Added complete unit, real-D1, and browser coverage, resolved the independent accessibility/test audits, and passed all six repository gates in the required order.

### File List

- CHANGELOG.md
- _bmad-output/implementation-artifacts/1-7-multi-select-voting.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- db/migrations/0008_multi_select.sql
- db/migrations.manifest.json
- docs/design/poll-type-contract-check.md
- src/adapters/d1/index.ts
- src/components/poll-option.astro
- src/modules/polls/index.ts
- src/modules/polls/types/multiple-choice.ts
- src/modules/voting/index.ts
- src/pages/[reference].astro
- src/pages/creator/new.astro
- src/scripts/create-poll-form.ts
- src/scripts/vote-form.ts
- tests/e2e/create-poll-authed.spec.mjs
- tests/e2e/vote.spec.mjs
- tests/integration/polls-adapter.integration.test.ts
- tests/integration/polls-schema.integration.test.ts
- tests/integration/votes-adapter.integration.test.ts
- tests/unit/polls.test.ts
- tests/unit/voting.test.ts

## Change Log

- 2026-07-31: Implemented bounded multi-select poll creation, checkbox voting, atomic N-selection persistence, result projection facts, accessibility hardening, and complete Story 1.7 regression coverage; all six repository gates are green.
