---
baseline_commit: 9c0aa3772cf2d443bbb4e2da74f22c8ef7df1c3a
---

# Story 7.3: Revise Your Availability

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Depends on Story 7.2 (branch story/7-2-mark-availability, currently in review). Start only after 7.2 merges; set baseline_commit to that merge. -->

## Story

As a returning Voter,
I want to change my answers while the Poll is open,
So that a remembered conflict doesn't poison the schedule — without my revision counting as a second Vote.

## Acceptance Criteria

1. **Pre-filled editable row (FR-13):** Given a Voter returning to an open Meeting Poll in the same browser session (revision capability cookie present and its digest matches a stored `meeting_response` for this Poll), when the page renders, their own row is pre-filled and editable — the only editable Vote in the product — while a different device (no matching capability) renders as a new Voter. Pre-fill overrides the `already_voted` read-only path for Meeting Polls only.
2. **ReviseMeetingResponse (AD-20/AR-16):** Given a revision submission, when `ReviseMeetingResponse` runs, it requires the stored revision capability (HMAC digest match, poll-scoped), replaces only that Vote's availability rows, and increments `representation_version` — it never creates new duplicate claims and never redeems a Voter Code again. D1 triggers (already shipped in 0017) enforce effective-open state inside the transaction, so a revision against a just-closed or just-deleted Poll aborts cleanly. Confirmation is the same "**Saved.** Change it any time while the Poll is open."
3. **Closed Poll (AD-11, FR-4):** Given a Poll that has closed, when a returning Voter (capability present) views it, their row renders read-only — submitted glyphs + fills, no radios, no submit — beneath the closed message "**This Poll closed {when}.**" Revision ends at close; a revision racing the close returns 422 with the closed copy and the write aborts in-transaction.

## Tasks / Subtasks

- [x] Task 1: Persistence — readback + revise in `src/adapters/d1/index.ts` (AC: 1, 2)
  - [x] NEW `findMeetingResponseByRevisionDigest(pollId, digest: RevisionCapabilityDigest)` on `createVotePersistence` → `{ voteId, displayName, availability: { meetingSlotId, availability }[] } | null` — join `meeting_response → vote` constrained on `vote.poll_id` (digest is HMAC-poll-scoped, constrain in SQL anyway)
  - [x] NEW `reviseMeetingResponse(batch)`: one `db.batch()` — `DELETE FROM meeting_availability WHERE vote_id = ?` → INSERT one row per slot (0017's `meeting_availability_open_insert_guard` + slot-ownership guard fire here; a full row set is always required, so no unguarded DELETE-only path exists) → `UPDATE meeting_response SET display_name = ?` (update guards fire) → `UPDATE poll SET representation_version = representation_version + 1, updated_at_ms = ?` (AD-24). NO new `vote` row, NO `voter_claim` rows, NO idempotency-ledger row
  - [x] Map failures to existing typed errors: `/poll_closed/` → `PollClosedError`; `/meeting_availability_slot_invalid/` → `PollDefinitionChangedError`; FK / vanished vote (0 rows on `UPDATE meeting_response`, detect via changed-row count or pre-read) → `PollGoneError`
  - [x] NO new migration: 0017 already ships `BEFORE UPDATE` + effective-open guards on both tables (its comment names Story 7.3). Do not touch `db/migrations/0017_meeting_availability.sql` or the manifest
- [x] Task 2: Domain — `reviseVote` command in `src/modules/voting/index.ts` (AC: 2)
  - [x] NEW exported command (imperative name; the app-level `ReviseMeetingResponse`): input `{ pollId, revisionCapability, displayName, availability, submissionId }`; deps `{ findPoll, findMeetingResponseByRevisionDigest, createDigest, reviseMeetingResponse, nowMs }`. Order: find poll (`poll_deleted`) → `effectivePollStatus` closed → `poll_closed` → digest the capability via `createVoteDigest(..., { pollId, checkKind: "revision", token })` → lookup; no match → NEW reason code `revision_capability_invalid` (flag telemetry as capability `authorization_denied`, never `csrf_rejected` — AD-15) → reuse `validateMeetingSubmission` via `votingStrategyFor("meeting").validateSubmission` (same field errors: `display_name_missing`, `availability_missing`, etc.) → persist
  - [x] Idempotency decision (spine gap, resolved here): revision does NOT write the AD-7 `(poll_id, submission_id)` vote ledger — that ledger stores Vote-insert outcomes and a second genuine revision must never `IDEMPOTENCY_CONFLICT`. Revision is idempotent by replacement (last-write-wins; replaying an identical replacement is a harmless no-op re-replacement). The form still carries `submission_id` per AD-7 L185 ("every form"), used only by the client double-submit lock
  - [x] Security decision (spine gap, resolved here): `[ASSUMPTION]` no Turnstile on revision — AD-16 ties CAPTCHA to AD-7 admission, which revision is not; possession of the 128-bit capability is the gate. Rate limiting DOES apply ("Both commands pass best-effort admission throttles", AD-20) keyed as its own operation. No session/IP claim checks — AD-20 forbids new claims
  - [x] New `VOTE_COPY`-adjacent copy: revision failure reuses `VOTE_COPY.retry` idiom; `revision_capability_invalid` renders as the fresh-voter path (grid empty, no error banner — the Voter simply isn't recognized; PRD L311 forbids explaining session mechanics)
- [x] Task 3: Delivery — `src/lib/poll-delivery.ts` + pages (AC: 1, 2, 3)
  - [x] `PollDeliveryInput`: add `revisionCookie: string | null`; read `MEETING_REVISION_COOKIE_NAME` in `src/pages/[reference].astro` (~L22) and `src/pages/index.astro` (~L30) and pass it
  - [x] Cookie scoping fix (7.2 gap): the single root-path cookie is overwritten by a second Meeting Poll. `[ASSUMPTION]` re-issue per-poll: name `oddspark.meeting_revision.{pollId}` (value unchanged, same flags `HttpOnly; SameSite=Lax; Path=/; Max-Age=365d[; Secure]`); on GET read the poll-suffixed name, falling back to the legacy unsuffixed name for capabilities issued by 7.2. Update the 7.2 set-cookie site (~L613) to the suffixed name
  - [x] GET branch: when `pollType === "meeting"` and revision cookie present, digest + `findMeetingResponseByRevisionDigest`. Match + open → seed `meetingAvailability` (slotId→state) + `meetingDisplayName`, force the form to render editable (suppress/override the `already_voted` readOnly at ~L726 — session-claim probe still runs for non-meeting), no outcome banner beyond normal page. Match + closed → `poll_closed_get` outcome as today PLUS pass values to a read-only grid render (AC 3). No match → today's behavior exactly (fresh voter or `already_voted`)
  - [x] POST branch: if revision cookie digest matches a stored response for this poll → route to `ReviseMeetingResponse` instead of `castVote`. Pipeline: parse form (same `availability_{slotId}`/`display_name` fields) → rate limit (429 + `retry-after: 60`) → command → success: same flash-cookie "Saved." + 303; failure: 422 preserving EVERY field. Skip Turnstile and idempotency preflight on the revision path (Task 2 decisions). No match → existing create path unchanged (a cleared-cookie voter votes fresh; duplicate claims then reject per toggles — correct: a different device is a new Voter)
  - [x] Never log or echo the capability or its digest (AD-8/AD-15); one structured completion record for the revise operation
- [x] Task 4: UI — pre-filled + read-only grid states (AC: 1, 3)
  - [x] Pre-filled editable grid: NO component change needed — `availability-grid.astro` already renders `checked` from `values` and fills `display_name` from `displayName`. No banner, badge, or "you already answered" chrome — the only sanctioned visual difference is real glyphs instead of `·` (DESIGN.md L589–592)
  - [x] Submit button: `[ASSUMPTION]` primary button reads `SAVE` when the grid is pre-filled from a stored response (fresh grid keeps `VOTE`, `src/components/poll-voting-surface.astro` ~L246); in-flight swap `SAVING…` — no spinner (DESIGN.md L255/L605 idiom)
  - [x] Closed read-only render (new path — closed meeting pages currently show no grid): submitted glyph+fill cells with NO radios/inputs, `×` stays `dim` never `faint` (DESIGN.md L718), never color alone; timezone line and captions as in the live grid; extend `availability-grid.astro` with a `readOnlyValues`-style mode or a sibling partial — keep 48px cells, 1px rule borders, radius 0
  - [x] `src/scripts/vote-form.ts`: revision form reuses the same lock/offline handling (`data-meeting` path already disables availability inputs in flight); ensure the pre-filled form's `submission_id` regenerates per render as today
  - [x] No confirm dialog, no toast, no modal ("changes without ceremony", EXPERIENCE.md L416; banned list L260)
- [x] Task 5: Tests (all ACs)
  - [x] Unit `tests/unit/meeting-response.test.ts` (extend): revise-command matrix with stubbed deps — capability mismatch → `revision_capability_invalid`, closed → `poll_closed`, field errors passthrough, replacement determinism; no ledger write asserted
  - [x] Integration `tests/integration/meeting-availability.integration.test.ts` (extend, existing `applyD1Migrations`/cleanup pattern): full revise happy path (rows replaced not appended, `representation_version` +1, zero new `voter_claim`/`vote` rows), revise after `closed_at_ms` set → `/poll_closed/` abort with rows intact, cross-poll digest no-match, display-name update, deleted-vote → clean error
  - [x] Integration `tests/integration/vote-route.integration.test.ts` (extend meeting describe): GET with valid revision cookie → 200 with pre-filled radios (`checked` in HTML) and no `already_voted` outcome; GET with foreign/absent cookie → fresh grid; POST revise → 303 + "Saved." flash + single vote row; POST revise after close → 422 closed copy; second revision succeeds (no idempotency conflict)
  - [x] E2E `tests/e2e/meeting-poll.spec.mjs` (extend serial spec): after 7.2's submit, reload → grid pre-filled → flip one slot → `SAVE` → "Saved." → D1 shows one vote, replaced availability, bumped `representation_version`; then close poll → reload → read-only glyph row + closed message
  - [x] Full gate: `pnpm migrations:guard && pnpm test && pnpm check`; `pnpm test:e2e`; `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check`; CHANGELOG entry

### Review Findings

- [x] [Review][Patch] POST revision validation failure overwrites submitted form fields with database values [`src/lib/poll-delivery.ts:767`]
- [x] [Review][Patch] Read-only availability grid omits accessibility markers for submitted choices [`src/components/availability-grid.astro:37`]
- [x] [Review][Patch] Closed Meeting Poll renders empty option list for non-recognized visitors [`src/components/poll-voting-surface.astro:191`]
- [x] [Review][Patch] Unguarded meta.changes access in reviseMeetingResponse batch results [`src/adapters/d1/index.ts:1295`]
- [x] [Review][Patch] Missing closedAtMs when reviseVote catches in-transaction PollClosedError [`src/modules/voting/index.ts:446`]
- [x] [Review][Patch] Version incremented in D1 batch when vote row is concurrently deleted [`src/adapters/d1/index.ts:1291`]

## Dev Notes

### Critical architecture guardrails

- **AD-20 is the whole story (SPINE L415–428):** `ReviseMeetingResponse` "requires that capability, replaces only that Vote's availability rows, increments `representation_version`, and neither creates claims nor redeems a code again. D1 triggers on availability replacement enforce effective-open state inside the transaction, and foreign keys make a concurrent Poll or Vote delete abort the revision. Both commands pass best-effort admission throttles." A separate command from `CastVote` — do NOT thread revision through `castVote` or `insertVote`.
- **AD-6 (L154–158):** Meeting availability is the ONE in-aggregate mutable Vote fact — and only the capability-matched Vote's own rows. Never touch another vote's rows; constrain every statement by `vote_id`.
- **AD-19:** Voting owns availability — the command lives in `src/modules/voting/`; validation policy stays in `polls/types/meeting.ts` via the existing registry port (`validateMeetingSubmission` — reuse, don't duplicate). Only `CastVote` and `ResetDemoPoll` are sanctioned cross-module coordinators; revision must not become a third — the `representation_version` bump happens inside the Voting D1 adapter batch exactly as `insertVote` does (`UPDATE poll SET representation_version = representation_version + 1, updated_at_ms = ?2 WHERE id = ?1`, d1 ~L1583).
- **AD-24 (L495–502):** "Meeting revision" is named explicitly as a version-incrementing change. A denied/failed revision increments NOTHING (moderation precedent L506).
- **AD-8/AD-15:** capability handled like the browser token — compare by recomputed HMAC digest (`createVoteDigest` revision overload, `src/adapters/digest/index.ts:54–57`), raw value only ever in the first-party cookie, never in D1/projections/logs. Denials flag `authorization_denied`, never bare 403 (SPINE L338–342). Telemetry never records tokens, digests, display names, or availability content.
- **AD-9:** the Tally is a SQL projection over raw rows — replacing rows automatically corrects 7.4's tally; no denormalized state to update.
- **AD-2 / conventions L531:** revision works with zero JS — plain form POST → 303; 422 re-renders with all submitted values + field errors. `authorization`/CSRF: anonymous voter POST passes the central middleware Origin/Fetch-Metadata boundary only (AD-22); no session token requirement.
- **AD-11:** closed is `closed_at_ms !== null || deadline_ms <= now` — enforce at read (render read-only) AND rely on 0017's in-transaction guards at write. `effectivePollStatus` in `src/shared/domain/index.ts:59–80` is the single source.

### Existing substrate (verified in working tree; all of 7.2 must be merged first)

| Seam | Current state | 7.3 change |
|---|---|---|
| `db/migrations/0017_meeting_availability.sql` | INSERT **and UPDATE** guards for slot-ownership, meeting-type, and effective-open already exist (comment: "Story 7.3 replaces availability rows and updates response display name") | NONE — no new migration |
| `src/adapters/digest/index.ts` | `createVoteDigest(..., { checkKind: "revision" })` overload + `createRevisionCapability()` (128-bit base64url) | reuse as-is |
| `src/lib/poll-delivery.ts` | `MEETING_REVISION_COOKIE_NAME` L66; capability generated L560, cookie set L613–618 (root path, single-poll value — see Task 3 scoping fix); GET already-voted probe L726 forces readOnly; `PollDeliveryState.meetingAvailability/meetingDisplayName/meetingFieldErrors` exist | revision cookie input + GET pre-fill + POST revise branch |
| `src/modules/voting/index.ts` | meeting arm of `castVote` complete; `MeetingAvailabilityContribution`/`MeetingResponseContribution` L245–246 | NEW revise command; do not modify `castVote` |
| `src/modules/polls/types/meeting.ts` | `validateMeetingSubmission` with stable reason codes L59–78 | reuse via registry; add nothing |
| `src/adapters/d1/index.ts` | insert-only (`insertVote`); NO vote UPDATE/DELETE path, NO meeting readback query | NEW `findMeetingResponseByRevisionDigest` + `reviseMeetingResponse` |
| `src/components/availability-grid.astro` | props `{slots, values, displayName, fieldErrors, locked}` — `values` drives `checked` | pre-fill free; add closed read-only mode |
| `src/components/poll-voting-surface.astro` | meeting branch L216; submit hard-coded `VOTE` L246; `compactCounted` suppresses form post-flash | button label branch; render read-only grid when closed + capability match |

### Previous story intelligence (7.2, in review on `story/7-2-mark-availability`)

- 7.2 deliberately built the capability/digest/UPDATE-guard substrate and NO revision path (AR-21). Everything above is that substrate — extend it, re-implement nothing.
- Review traps that recurred in 7.1/7.2 and WILL recur here: (1) invalid IANA zone from the user-controlled override → `Intl` `RangeError` SSR 500 — the read-only grid must guard zones with `isUsableTimeZone` too; (2) every 422 preserves the whole form; (3) closed/locked views must not leak editable inputs — the closed grid renders NO radios at all; (4) keep `vote-form.ts` field names in sync with server-rendered names; (5) cookie decisions got review-patched in 7.2 (path scoping) — state cookie attributes explicitly in the PR description.
- 7.2 route test already asserts the revision cookie is set and the digest stored (`vote-route.integration.test.ts` L291–309) — build on its `seedMeeting()`/`meetingBody()` helpers.
- Commit convention: one `feat(meeting): revise voter availability` squash on branch `story/7-3-revise-your-availability`, PR to main after 7.2 merges.

### UX literal contracts (no meeting mockup exists — these ARE the spec)

- Pre-filled row: "While the Poll is open, a returning Voter's own row is pre-filled and editable — this is the only Vote in the product that can be changed" (EXPERIENCE.md L159). "She flips one slot to no… it changes without ceremony" (L416). No returning-voter chrome of any kind.
- Confirmation (revision uses the SAME string): "**Saved.** Change it any time while the Poll is open." (EXPERIENCE.md L94). Closed: "**This Poll closed {when}.** The final Tally is below." / "…Nothing further to decide." (L97–98). Raced the close: reuse the existing `poll_closed` 422 idiom.
- Different device / lost cookie: renders as a NEW Voter — no "we didn't recognize you" copy exists and none may be invented; PRD L311 forbids surfacing session mechanics. Their fresh submission then meets the normal duplicate-claim toggles.
- Cell states (DESIGN.md L589–592): Yes `solar-wash` + `✓`; If-need-be `entropy-wash` + `~`; No: no fill, `×` in `dim` — NEVER `faint`, closed view included (L718); unanswered `·` `faint`. Never color alone.
- Banned: toasts, spinners, confirm dialogs on non-destructive actions, modals (only three exist product-wide), required-asterisks (EXPERIENCE.md L260, L67, L470).
- Post-submit focus idiom: outcome line `tabindex="-1"`, first in `<main>`, focused on load; `<title>` leads with "Saved" (already built in 7.2 — revision reuses it).

### Project Structure Notes

- NEW files: none required beyond tests (all changes extend existing modules); optionally a read-only grid partial under `src/components/`
- UPDATE: `src/modules/voting/index.ts`, `src/adapters/d1/index.ts`, `src/lib/poll-delivery.ts`, `src/pages/[reference].astro`, `src/pages/index.astro`, `src/components/poll-voting-surface.astro`, `src/components/availability-grid.astro`, `tests/unit/meeting-response.test.ts`, `tests/integration/meeting-availability.integration.test.ts`, `tests/integration/vote-route.integration.test.ts`, `tests/e2e/meeting-poll.spec.mjs`, `CHANGELOG.md`
- Stack pinned (no new libraries): Astro 7.1.5, Zod 4.4.3, Vitest 4.1.10, Playwright 1.62.0, fast-check 4.9.0, TS 7.0.2, Node 24.18.0, pnpm 11.17.0. No date library — `Intl` + `Date.UTC` only.
- AD-1 layering: pages → lib (delivery) → modules (domain, no Astro/provider imports) → adapters via ports. Vote/revise POST to canonical `src/pages/[reference].astro` — no `/api/*`. All state-changing requests pass the central CSRF middleware chain (AD-22). No environment lookup inside domain modules — the HMAC secret reaches only the digest adapter.

### Decisions resolved in this story (spine/UX gaps — flag in review if contested)

1. Revision skips the AD-7 idempotency ledger (idempotent-by-replacement; second revisions must not conflict).
2. No Turnstile on revision; rate limiting applies as its own operation key.
3. Per-poll revision cookie name `oddspark.meeting_revision.{pollId}` with legacy-name fallback.
4. Submit label `SAVE` (pending `SAVING…`) when pre-filled; `VOTE` unchanged for fresh grids.
5. Capability is not cleared at close — the cookie simply renders the read-only row (harmless; expires in 365d).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-7.3 (L1149–1168); Epic 7 overview (L184–187, L1102–1104)]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md — AD-20 L415–428, AD-6 L148–167, AD-7 L169–195, AD-8 L214–222, AD-11 L271–278, AD-15 L326–342, AD-16 L345–354, AD-19 L383–413, AD-21 L430–460, AD-22 L462–475, AD-24 L490–517, conventions L519–534, capability map L672]
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md — FR-13 L184–188, revisable exception L82, assumption register L381, privacy NFR L311, FR-4 L113–114, SM-C1 L366]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md — L94 (Saved copy), L97–99 (closed copy), L159 (pre-filled contract), L194 (closed render), L260/L67/L470 (bans), L293 (focus), L416 (UJ-3)] and DESIGN.md — L255/L605 (pending label), L589–592 (cell states), L604 (one primary), L718 (faint ban)]
- [Source: _bmad-output/implementation-artifacts/7-2-mark-availability.md — substrate scope L75, AD-6 note L76, review findings L59–69]
- [Source: db/migrations/0017_meeting_availability.sql — UPDATE + effective-open guards L30–132]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-08-11: Focused browser proof exposed disabled Meeting radios being omitted from native form serialization; retained enabled successful controls while locking pointer and keyboard interaction.
- 2026-08-11: Full Playwright run had one transient external Turnstile iframe abort; the complete affected landing spec passed 7/7 on rerun.

### Completion Notes List

- Added poll-scoped Meeting revision readback and atomic replacement persistence with typed closed, definition-changed, and gone error mapping.
- Added the `reviseVote` application command with capability authorization, shared Meeting validation, replacement idempotency, and no new Vote, claim, code, CAPTCHA, or vote-ledger writes.
- Added per-Poll revision cookies with legacy fallback, editable GET prefill, revision POST delivery, independent rate limiting, and closed read-only rendering.
- Added `SAVE` / `SAVING…` behavior and glyph-only closed availability rows without radios or submit controls.
- Added unit, integration, route, and browser regression coverage. Final gates: migrations guard; 124 Vitest files / 1,732 tests; focused Meeting Playwright proof; full Playwright run 183 passed with one transient external failure and four serial skips, followed by affected landing spec 7/7; typecheck; generated binding drift check; production build; diff check.

### File List

- CHANGELOG.md
- _bmad-output/implementation-artifacts/7-3-revise-your-availability.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/adapters/d1/index.ts
- src/adapters/rate-limit/index.ts
- src/components/availability-grid.astro
- src/components/poll-voting-surface.astro
- src/lib/poll-delivery.ts
- src/modules/voting/index.ts
- src/pages/[reference].astro
- src/pages/index.astro
- src/scripts/vote-form.ts
- tests/e2e/meeting-poll.spec.mjs
- tests/integration/meeting-availability.integration.test.ts
- tests/integration/vote-route.integration.test.ts
- tests/unit/demo-delivery-contract.test.mjs
- tests/unit/landing-page.test.mjs
- tests/unit/meeting-response.test.ts

## Change Log

- 2026-08-11: Implemented Story 7.3 Meeting availability revision, closed-row rendering, and complete regression coverage.
