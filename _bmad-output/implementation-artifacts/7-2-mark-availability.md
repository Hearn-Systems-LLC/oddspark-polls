---
baseline_commit: 5660da65b5008942329c437b56e5decb0d82baa7
---

# Story 7.2: Mark Availability

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Voter,
I want to answer yes / if-need-be / no per slot in my own local time, under my name,
So that I answer in seconds without doing timezone math (SM-C1).

## Acceptance Criteria

1. **Grid semantics & rendering (FR-13, UX-DR23):** Given a Voter opening a Meeting Poll, when the grid renders, each slot is a `radiogroup` of three named radios — Yes / If need be / No — with `Tab` moving between slots, arrows selecting within one, the slot's local time as the group's accessible name, and 48×48px cells carrying state as glyph plus fill together (`✓` gold on wash, `~` entropy on wash, `×` dim unfilled, `·` faint for unanswered) — never color alone, no cycle-on-tap.
2. **Timezone rendering (FR-13, UX-DR24):** Given a Voter in a different timezone than the Creator, each slot shows the Voter's local time with the Creator's original as a caption subline ("created 15:00–16:00 EST"), a slot landing on a different calendar date is flagged with literal `+1 day` text tinted entropy, and a label-caps-lg line above the grid states the timezone in use with a manual override. FR-13's worked example is the literal contract: a slot created as 15:00 EST renders as 21:00 for a CET Voter, with the source timezone noted.
3. **Submission (AD-20/AR-16):** Given a submission, a display name is required (the grid is attributed), and `CreateMeetingResponse` creates one Vote, establishes duplicate claims, and passes the same Security Toggles as any Vote — returning a random first-party revision capability whose digest is stored with the Vote. The confirmation reads "**Saved.** Change it any time while the Poll is open."

## Tasks / Subtasks

- [x] Task 1: Migration `0017_meeting_availability.sql` (AC: 3)
  - [x] `meeting_availability(vote_id FK→vote ON DELETE CASCADE, meeting_slot_id FK→meeting_slot ON DELETE CASCADE, availability TEXT NOT NULL CHECK (availability IN ('yes','if_need_be','no')), PRIMARY KEY(vote_id, meeting_slot_id))` — cross-row ownership trigger modeled exactly on `ranked_preference_option_guard` in `0013` (slot must belong to the same poll as the vote; poll must be `poll_type='meeting'`)
  - [x] Meeting response fact home for required `display_name` (1–80 UTF-16 units, trimmed) and `revision_capability_digest` — a `meeting_response` child of `vote` (one-to-one, unique FK, cascade) per AD-6/AD-20; never on `vote_comment`
  - [x] Effective-open guard trigger(s) on availability writes in the `vote_poll_open_guard` idiom (AD-20: revisions against just-closed/just-deleted polls abort in-transaction — 7.3 relies on this)
  - [x] Regenerate `db/migrations.manifest.json` via `pnpm migrations:checksum` in the same commit; verify `pnpm migrations:guard`
- [x] Task 2: Domain — meeting submission strategy + castVote arm (AC: 3)
  - [x] `src/shared/domain/index.ts`: availability-state enum (`yes | if_need_be | no`) — shared kernel owns enums (AD-23)
  - [x] `src/modules/polls/types/meeting.ts`: add `validateSubmission` + `persistFacts` ports to `meetingStrategy` (contract stays v5); voter-facing copy + stable snake_case reason codes (e.g. `display_name_missing`, `availability_invalid`, `availability_slot_unknown`)
  - [x] `src/modules/polls/types/registry.ts`: `votingStrategyFor("meeting")` returns the meeting voting adapter (currently `null` → fail-closed `vote_failed`)
  - [x] `src/modules/voting/index.ts`: `kind: "meeting"` arms on `VoteSubmission`/`ValidatedVoteSubmission`/`PersistedVoteFacts`/`CastVoteInput`; `normalizeMeetingVotePayload` canonicalizer (stable slot ordering by position — payload hash must be deterministic for AD-7 replay); new contribution kind(s) for availability rows + meeting response; new `VOTE_COPY` entries. Follow the ranked-choice (Epic 5) precedent, not image (Epic 6)
  - [x] Revision capability: ≥96 random bits base64url (AD-13 idiom), generated in delivery/adapter — never in domain (no `Date.now()`/`crypto` in domain modules; inject); digest via new `VoteDigestPurpose` (e.g. `"revision"`) — widen the union in `src/modules/voting/ip-address.ts` and `isVoteDigestPurpose` + overloads in `src/adapters/digest/index.ts` (AD-8: digest only, HMAC-keyed, never plaintext, never logged)
- [x] Task 3: Persistence — `src/adapters/d1/index.ts` (AC: 3)
  - [x] `insertVote`: accept the new contribution kind(s) → `INSERT INTO meeting_availability` / `meeting_response` rows in the single `db.batch()` (AD-7)
  - [x] Raise the contribution cap (`POLL_CAPS.maxOptions + 3` at ~L1283) to admit one availability row per slot + response + claims + comment
  - [x] Relax the `hasSelections === hasPreferences` invariant (~L1455) — a meeting vote has neither selections nor preferences
  - [x] Map trigger/UNIQUE failures to the existing typed errors (`PollClosedError`, `AlreadyVotedError`, etc.)
- [x] Task 4: Delivery — `src/lib/poll-delivery.ts` + vote surface (AC: 1, 2, 3)
  - [x] Extend `formSchema` + FormData parsing: `availability_{slotId}` radios, required `display_name`, existing `submission_id`/Turnstile fields; build the meeting `CastVoteInput`; extend `outcomeFromVoteError` exhaustive switch
  - [x] Pipeline order unchanged: idempotency preflight → IP digest → rate limit (429 + `retry-after: 60`) → Turnstile only when `captchaEnabled` → flashDigest precomputed → `castVote` → 303 + flash cookie | 422 preserving EVERY field (all grid states + display name)
  - [x] Generate the revision capability pre-batch; return it to the Voter's browser first-party (session-scoped for 7.3 pre-fill — e.g. HttpOnly cookie scoped to the poll, digest stored with the Vote); NEVER in telemetry (AD-15)
  - [x] Confirmation state: outcome line "**Saved.** Change it any time while the Poll is open." — `tabindex="-1"`, first in main landmark, focused on load; `<title>` leads with the outcome
- [x] Task 5: UI — availability grid (AC: 1, 2)
  - [x] NEW `src/components/availability-grid.astro` rendered from `poll.slots` inside `poll-voting-surface.astro`; NEW `src/scripts/availability-grid.ts` for enhancement (hand-written vanilla TS — sanctioned; form must work without JS, AD-2)
  - [x] Semantics: visually-hidden native radios with cell as `<label>`, glyphs via `::before` decorative (never spoken as punctuation); `role`/native `radiogroup` per slot, accessible name = slot's local time; native Tab/arrow model — no JS keyboard reimplementation needed with native radios
  - [x] Tokens (DESIGN.md `availability-cell`, L587): 48×48px, 1px `rule` border collapsed, radius 0; Yes = `solar-wash` fill + `✓` in `solar-ink` (light mode: `solar-ink-on-wash-light` `#6E560B` — one of only three explicit `…Light` exceptions); If-need-be = `entropy-wash` fill + `~` in `entropy`; No = no fill + `×` in `dim` (NEVER faint); unanswered = `·` in `faint`; focus ring 2px/2px offset
  - [x] Timezone: label-caps-lg line `TIMES SHOWN IN {ZONE} · FROM YOUR DEVICE` with manual override (a `<select>` of IANA zones or equivalent no-JS-safe control); per-slot local time + `caption` subline `created 15:00–16:00 EST`; `+1 day` literal text tinted entropy on calendar-date shift; validate EVERY zone with `isUsableTimeZone` before `Intl.DateTimeFormat` (7.1 review finding: invalid zone = SSR `RangeError` 500)
  - [x] Display name: `input` idiom — label-caps label always above (no placeholder-as-label, NO required-asterisk — banned), transparent field, 1px bottom rule → solar-ink on focus, errors as alarm rule + caption directly beneath, validated on submit never on blur
  - [x] Responsive: below `lg` one row per slot with three targets (UX-DR25); primary button pending state label `COUNTING…`-style swap, no spinner. No meeting mockup exists — DESIGN.md/EXPERIENCE.md token+prose contract is authoritative
- [x] Task 6: Tests (all ACs)
  - [x] Unit `tests/unit/meeting-response.test.ts` (Vitest, fixed `NOW`, factories): validateSubmission matrix (missing name, unknown slot, invalid state, partial answers), exact copy literals, canonical payload determinism; fast-check DST property tests for voter-local rendering across DST boundaries (retro Prep-2/AR-19)
  - [x] Integration `tests/integration/meeting-availability.integration.test.ts` (workerd, `applyD1Migrations`, FK-ordered cleanup): schema/trigger contracts (ownership guard, effective-open, cascade), and route coverage modeled on `tests/integration/vote-route.integration.test.ts` (`seedPoll` with toggles): full AD-7 matrix — replay returns stored outcome, different payload → `IDEMPOTENCY_CONFLICT`, session/IP duplicate claims, captcha fail-closed, closed-poll abort, capability digest stored (and digest ≠ plaintext)
  - [x] E2E extend `tests/e2e/meeting-poll.spec.mjs`: vote flow — grid renders local times, answer 3 slots, name required, submit, "Saved." confirmation (serial mode, `hasBetterAuthSecret()` skip)
  - [x] Full gate: `pnpm migrations:guard && pnpm test && pnpm check`; `pnpm test:e2e`; `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check`; CHANGELOG entry

## Dev Notes

### Critical architecture guardrails

- **AD-20/AR-16 (the spine of this story):** `CreateMeetingResponse` creates one Vote + duplicate claims (+ future code redemption) under AD-7, and returns a random first-party revision capability whose **digest** is stored with that Vote. Revision (`ReviseMeetingResponse`) is Story 7.3 — a *different command*; do not branch it into this one. Build the capability + digest + storage now; build no revision path yet (AR-21: nothing speculative). Voter Codes (`voter_code_redemptions`) are Epic 8 — deferred; leave redemption as a future conditional contribution, don't build it.
- **AD-6 exception:** Meeting availability is the ONE in-aggregate mutable vote fact in the product. Schema must allow row replacement by vote_id (7.3) — hence PK `(vote_id, meeting_slot_id)`.
- **AD-19 ownership:** Voting owns availability facts. Command lives in `src/modules/voting/`; only its commands write the new tables. Strategy policy (validation/fact-shaping) stays provider-free in `src/modules/polls/types/meeting.ts`.
- **AD-7 idempotency:** normalized payload hash under unique `(poll_id, submission_id)`; exact replay → stored outcome; same id + different ballot/name → `idempotency_conflict`. Canonical meeting payload must serialize deterministically (order availability rows by slot position).
- **Security toggles are enforced in the domain from the fresh poll snapshot inside `castVote`** (session L652, IP L675, captcha L688 of `src/modules/voting/index.ts`) — the meeting path goes through `castVote`'s existing checks by adding a submission kind, not by re-implementing checks. Claims in stable order: session first, IP second.
- **AD-9 forward-compatibility:** 7.4 tallies by SQL projection — rank by count of `yes`, tie-break by count of `if_need_be`. The three-state TEXT enum values must make that `GROUP BY`/`COUNT` trivial; don't encode states as integers or JSON.
- **AD-24:** the batch already increments `representation_version`; meeting acceptance rides the same increment.
- **AR-19 idioms:** UTC ms in D1 + IANA zone only where civil time matters; no date library exists and none may be added — `Intl` + `Date.UTC` only (`civilToUtcMs`, `isUsableTimeZone` in `src/modules/polls/index.ts:184–234`; delivery formatting helpers in `src/lib/datetime.ts`).
- **Digest discipline (AD-8/AD-15):** capability handled like the browser token — HMAC via `createVoteDigest` with a new purpose; raw value only ever sent first-party to the Voter; never stored, projected, or logged. Note `createVoteDigest` *throws* on unknown purposes — widen `VoteDigestPurpose` (`session | ip | rate_limit` today) and the guard together.

### Existing seams you MUST modify (current state verified in working tree @ `5660da6`)

| Seam | Current state | Change |
|---|---|---|
| `src/modules/polls/types/registry.ts` | `votingStrategyFor("meeting")` → `null` (fail-closed) | return meeting voting adapter |
| `src/modules/voting/index.ts` L449+ | `CastVoteInput` discriminated on `multiple_choice \| ranked_choice` | add `meeting` arm + canonicalizer + copy |
| `src/adapters/d1/index.ts` `insertVote` | throws on `extension:*` kinds (L1444); asserts `hasSelections === hasPreferences` (L1455); cap `maxOptions + 3` (L1283) | accept meeting contributions; relax invariant for meeting; raise cap |
| `src/adapters/digest/index.ts` | `isVoteDigestPurpose` throws on unknown purpose | add revision purpose + overloads |
| `src/lib/poll-delivery.ts` | `formSchema` L208; `outcomeFromVoteError` L223–251 (exhaustive); POST branch L380–649 | meeting fields, input arm, new outcomes |
| `src/components/poll-voting-surface.astro` | renders MC/ranked/image ballots | meeting branch → availability grid |
| `src/modules/polls/types/meeting.ts` | `create` + failing `projectExport` only | add `validateSubmission`/`persistFacts` |

`meeting_slot` (migration 0016) already stores `id/poll_id/position/starts_at_ms/ends_at_ms/time_zone` with position-unique index and poll-type guard triggers — reference `meeting_slot.id` from availability rows; the schema was explicitly shaped for `VOTE ||--o{ MEETING_AVAILABILITY`.

### Previous story intelligence (7.1, status done, merged @ `5660da6`)

- Patterns: strategy modules provider-free, inject `nowMs` (note `create(input, { nowMs })` signature); reason codes stable snake_case mapped once, pages never classify; Zod at boundary + domain re-enforcement; migrations forward-only, manifest regenerated same commit.
- Review traps that WILL recur here: (1) invalid IANA zone → `Intl.DateTimeFormat` `RangeError` → SSR 500 — guard every zone (voter override input is user-controlled!); (2) every 422 branch preserves the whole form — all grid selections + display name; (3) locked/closed views must not leak editable inputs; (4) keep client script in sync with server-rendered field names.
- Commit convention: one `feat(meeting): …` squash on branch `story/7-2-mark-availability`, follow-up `fix(meeting): close review findings` if needed, PR to main.
- Open gate: sprint-status Prep-1 — **AD-20 revisable-vote primitive design review** is scoped to this story; the digest/capability design above (meeting_response child + new digest purpose + ≥96-bit base64url token) is the proposal to review before coding Task 1–2.

### UX literal contracts (no mockup exists — these ARE the spec)

- Copy: confirmation "**Saved.** Change it any time while the Poll is open." (bold lead, no exclamation). Closed poll: existing closed idiom.
- Glyphs never color-alone; `×` in `dim` not `faint` ("No is an answer, not an absence"); `aria-checked="mixed"` explicitly rejected — three plain radios; unanswered reachable only by not answering.
- Anti-survey rules: no required-asterisk, no toast, no spinner, no modal errors; errors inline beneath field in `caption`/`alarm`.
- SM-C1 counter-metric: zero added friction — no extra confirm steps, vote in under a minute.

### Project Structure Notes

- NEW: `db/migrations/0017_meeting_availability.sql`, `src/components/availability-grid.astro`, `src/scripts/availability-grid.ts`, `tests/unit/meeting-response.test.ts`, `tests/integration/meeting-availability.integration.test.ts`
- UPDATE: `src/modules/voting/index.ts`, `src/modules/polls/types/meeting.ts`, `src/modules/polls/types/registry.ts`, `src/modules/voting/ip-address.ts`, `src/adapters/d1/index.ts`, `src/adapters/digest/index.ts`, `src/lib/poll-delivery.ts`, `src/components/poll-voting-surface.astro`, `src/shared/domain/index.ts`, `db/migrations.manifest.json`, `tests/e2e/meeting-poll.spec.mjs`, `CHANGELOG.md`
- Stack pinned (no new libraries): Astro 7.1.5, Zod 4.4.3, Vitest 4.1.10, Playwright 1.62.0, fast-check 4.9.0, TS 7.0.2, Node 24.18.0, pnpm 11.17.0.
- AD-1 layering: pages → lib (delivery) → modules (domain, no Astro/provider imports) → adapters via ports. Vote POSTs to canonical `src/pages/[reference].astro` route — no `/api/*` endpoint. All state-changing requests pass the central CSRF middleware chain (AD-22).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-7.2 (L1128–1150); AR-5/AR-13/AR-16/AR-19/AR-20 (L64–96); UX-DR23/24/25 (L114–116)]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md — AD-3 L74, AD-6 L148, AD-7 L169, AD-8 L214, AD-9 L226, AD-15 L324, AD-16 L344, AD-19 L383, AD-20 L415, AD-22 L462, AD-23 L477, AD-24 L490, conventions L523–533, structural seed L558]
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md#FR-13 (L184–188), FR-14 (L190), SM-C1 (L366)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md#availability-cell (L587–596, tokens L222–236, light exceptions L430/454); EXPERIENCE.md#Timezone-Handling (L368–376), availability-cell behavior (L159), voice-and-tone (L94), accessibility floor (L249–300)]
- [Source: _bmad-output/implementation-artifacts/7-1-propose-time-slots.md — scope boundary L68, structure notes L97–98, review findings]
- [Source: db/migrations/0006_votes.sql, 0013_ranked_ballots.sql (ownership-guard trigger precedent), 0016_meeting_slots.sql]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- Establish normalized Meeting response and availability facts with transaction-time ownership/open guards.
- Extend the existing CastVote strategy and D1 batch rather than creating a parallel security or idempotency path.
- Render a server-first native-radio grid, then enhance timezone display and pending behavior with vanilla TypeScript.
- Prove domain, schema, route, browser, migration, type, and production-build contracts.

### Debug Log References

- RED: the new schema integration suite failed before migration 0017 because the Meeting tables did not exist.
- Browser proof initially found the generic vote enhancer disabling a Meeting form; Meeting is now excluded from Multiple-Choice selection gating.
- Browser proof then exposed duplicate `display_name` controls when Comments were enabled; the attributed Meeting name now also supplies the optional Comment identity.
- The persistent local Playwright D1 required `pnpm migrate:local` to apply migration 0017 before the new route could write its tables.

### Completion Notes List

- Added one-to-one attributed Meeting responses, normalized availability rows, cross-Poll ownership enforcement, effective-open guards, and cascade behavior.
- Added deterministic Meeting payload validation/persistence, purpose-separated HMAC revision digests, and a 128-bit base64url first-party capability.
- Added the responsive accessible availability grid, guarded device/manual timezone rendering, source captions, day-shift disclosure, and exact Saved confirmation.
- Preserved the existing admission pipeline, duplicate claims, CAPTCHA behavior, idempotent replay, field-preserving 422s, and single D1 batch.
- Validation: 124 Vitest files / 1,726 tests pass; 188 Playwright tests pass; focused Meeting E2E passes; migrations guard, TypeScript, generated binding drift, production build, and whitespace checks pass.

### File List

- CHANGELOG.md
- _bmad-output/implementation-artifacts/7-2-mark-availability.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- db/migrations/0017_meeting_availability.sql
- db/migrations.manifest.json
- src/adapters/d1/index.ts
- src/adapters/digest/index.ts
- src/components/availability-grid.astro
- src/components/comment-composer.astro
- src/components/poll-voting-surface.astro
- src/lib/datetime.ts
- src/lib/poll-delivery.ts
- src/modules/polls/types/meeting.ts
- src/modules/polls/types/registry.ts
- src/modules/voting/index.ts
- src/modules/voting/ip-address.ts
- src/scripts/availability-grid.ts
- src/scripts/vote-form.ts
- src/shared/domain/index.ts
- src/styles/tokens.css
- tests/e2e/meeting-poll.spec.mjs
- tests/integration/meeting-availability.integration.test.ts
- tests/integration/vote-route.integration.test.ts
- tests/unit/meeting-response.test.ts

### Change Log

- 2026-08-10: Implemented Story 7.2 Meeting availability submission, revision-capability substrate, accessible local-time grid, and full validation coverage; moved to review.
