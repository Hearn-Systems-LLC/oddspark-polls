---
baseline_commit: ad8c74a60ef3773b74b31580b80e061365b1cb46
context_commit: ad8c74a
baseline: main @ ad8c74a (post Story 1.13, Epic 1 complete)
dependency_story: 1-12-close-edit-delete (lifecycle forms, lock enforcement pattern)
epic: 2 — Vote Security & Trust Surfaces
---

# Story 2.1: Per-Poll Security Toggles

Status: done

## Story

As a Creator,
I want to enable or disable each protection independently on my Poll,
So that a friends poll stays frictionless while a public poll resists abuse — my choice, per Poll.

## Acceptance Criteria

1. **Given** the creation form and the Poll detail, **When** the Security Toggles render, **Then** each is a `security-toggle` row — 40×20px square track and knob, name in label-caps, a one-line body-size description of what the Toggle costs the Voter, the whole row the hit area with name and description inside the `<label>` (UX-DR6), **And** a new Poll opens with Session Checks on and every other Toggle off (FR-15).

2. **Given** a Poll with all Toggles off, **When** a Voter submits, **Then** the Vote submits with no challenge, no code, and no duplicate check (FR-15), **And** enabled Toggles compose — any combination enforces all enabled checks.

3. **Given** a Poll with at least one accepted Vote, **When** the Creator attempts to change Toggles, **Then** an off Toggle can still be enabled but an on Toggle cannot be disabled — enforced server-side, with the UI reflecting it (FR-15, AD-17), **And** the locked row keeps its full-strength on-track color, drops the knob to `dim`, and shows `LOCKED` beside the name — never opacity as the state mechanism (UX-DR6), **And** the surface explains: "Votes are in. Protections can tighten from here, not loosen."

4. **Given** a Toggle enabled mid-Poll, **When** subsequent Votes arrive, **Then** the new check applies to them only — no Vote already cast is invalidated.

## Tasks / Subtasks

- [x] Task 1: Migration 0009 — four new toggle columns (AC: #1, #2)
  - [x] NEW `db/migrations/0009_security_toggles.sql`: `ALTER TABLE poll ADD COLUMN ip_checks_enabled INTEGER NOT NULL DEFAULT 0`, same for `voter_codes_enabled`, `captcha_enabled`, `vpn_blocking_enabled`. Expand-only; discrete columns never a settings JSON blob (AD-3). Follow the `0008_multi_select.sql` precedent: comment in the file header that SQLite cannot alter a column default after ADD COLUMN, so every application INSERT sets all five toggle fields explicitly rather than relying on defaults.
  - [x] Run `pnpm migrations:checksum` in the same commit; `pnpm migrations:guard` must stay green. Never edit 0001–0008.
  - [x] UPDATE `tests/integration/polls-schema.integration.test.ts` — `PRAGMA table_info('poll')` assertions for the four new columns (name, type INTEGER, notnull, dflt_value 0), matching the existing `session_checks_enabled` assertion style.
- [x] Task 2: Shared toggle contract + create-flow domain wiring (AC: #1, #2)
  - [x] UPDATE `src/shared/domain/index.ts` — add the toggle key set as a const-array + union following the `RESULT_VISIBILITIES` precedent (e.g. `SECURITY_TOGGLES` = `["sessionChecks","ipChecks","voterCodes","captcha","vpnBlocking"]` as const, `SecurityToggle` union, and a `PollSecurityToggles` record type). AD-23: shared contracts consumed by polls, voting, and adapters live here.
  - [x] UPDATE `src/modules/polls/index.ts` — extend `CreatePollDraft` with the five toggle fields as raw strings (`=== "true"` semantics, the `multiSelect` precedent: checkbox absent = off). Replace the hard-coded `sessionChecksEnabled: true` in `createPoll` (currently line ~664) with draft-derived values for all five toggles.
  - [x] UPDATE `ExistingPollSnapshot`, `matchesExistingPoll`, and `draftContentForCompare` in `src/modules/polls/index.ts` to include all five toggles — the retry-dedupe adjudication must not drift from persisted truth.
  - [x] No new validation interdependencies: FR-15 makes the toggles independent; `validateCreatePoll` accepts any combination. Do not invent cross-toggle rules.
- [x] Task 3: Tighten-only command in the polls module (AC: #3, #4)
  - [x] NEW `src/modules/polls/poll-security.ts` — `updatePollSecurityToggles(deps, ownerUserId, pollId, requested)` command + pure policy helper, re-exported from `src/modules/polls/index.ts` alongside the other lifecycle commands. Follow the `poll-lifecycle.ts` shape exactly: injectable ports, no env lookups, `ApplicationError` results with stable codes, `console.error(code, { pollId, cause })` on persistence failure (IDs only — AD-15).
  - [x] Policy (pure, unit-tested): given current toggle states, `voterCount`, and requested states — when `voterCount === 0` any combination is allowed; when `voterCount > 0` enabling any off Toggle is allowed but disabling any on Toggle returns a locked error with code `poll_security_locked` and the exact copy "Votes are in. Protections can tighten from here, not loosen." This is the advisory pre-check only; the adapter re-enforces (Task 4).
  - [x] No-op (requested equals current) is an idempotent success with **no** version bump — the `updatePollDescription` precedent. A real change contributes `incrementRepresentationVersion(pollId, nowMs)` from `src/shared/application` (AD-24: toggle state alters the voter-surface representation — trust badge in 2.4, Turnstile in 2.3) plus `updated_at_ms` in the same write. Never hand-roll version bumps.
  - [x] Ownership comes from the principal + route PollId, never form fields (AD-4/NFR-3).
- [x] Task 4: D1 adapter — columns everywhere + guarded toggle update (AC: #2, #3)
  - [x] UPDATE `src/adapters/d1/index.ts`: `PollRow`, `toPollPage`, and the SELECT column lists of `findPollByReference`, `findPollForOwner`, `loadLifecycleForOwner` (incl. its anonymous row type and mapping) — each query has its own hand-written SELECT list; adding a column is a multi-site mechanical edit, do not miss one. Map with `row.x === 1`.
  - [x] UPDATE `insertPoll` — the explicit column list takes all five toggle values from `PollPersistenceRows`.
  - [x] UPDATE `loadLifecycleForOwner` / `PollLifecycleSnapshot` (`src/modules/polls/poll-lifecycle.ts`) — the snapshot must carry the five current toggle states so the detail page renders lock state from one consistent read.
  - [x] NEW `updateSecurityTogglesForOwner` port implementation following the `updateDefinitionForOwner` guarded-batch pattern: one UPDATE with owner guard, version/updated_at set, and a WHERE clause that aborts the statement when votes exist **and** any column would go 1→0, e.g. `AND (NOT EXISTS (SELECT 1 FROM vote v WHERE v.poll_id = poll.id) OR (session_checks_enabled <= ? AND ip_checks_enabled <= ? AND …))` (current <= requested for every column = no disable requested). Zero rows changed → re-load → classify `not_found` / `locked`; otherwise `updated`. This makes the tighten-only invariant race-free: a Vote landing between the advisory pre-check and the write cannot loosen a protection.
- [x] Task 5: `security-toggle` component + tokens (AC: #1, #3)
  - [x] UPDATE `src/styles/tokens.css` — `--security-toggle-*` tokens in the shared unsuffixed `:root` block (the `--poll-option-*` / `--chart-form-toggle-*` precedent), binding to collapsed color vars. Token contract from DESIGN.md frontmatter: trackWidth 40px, trackHeight 20px, knobSize 16px, radius 0 (square, no pill), trackOff `rule`, trackOn `solar-wash`, knobOff `text`, knobOn `solar-ink`, trackLocked `solar-wash` (full strength), knobLocked `dim`, LOCKED label + name in label-caps, description in body/dim. Light mode resolves purely by the `-dark`→`-light` suffix swap — do **not** add a fourth `…Light` exception. Do not touch `--color-solar-dark` (the smoke test reads it).
  - [x] NEW `src/components/security-toggle.astro` — mirror the `poll-option.astro` construction: `<label>` row wrapping a visually-hidden native `<input type="checkbox">`, name in label-caps, one-line description in body/dim, whole row is the hit area, `:focus-within` outline bound to `focus-ring-*` (2px outline, 2px offset — the component token block has no focusOutline of its own; UX-DR1 binds every focus outline to focus-ring). No `role="switch"` / hand-built ARIA — the native checkbox carries semantics. **No transition or animation on the knob** — the motion system is closed at five primitives; idle is still (UX-DR4). State is never color alone: knob position + `LOCKED` text carry it (state-never-color-alone).
  - [x] Locked render (`locked` prop, only ever `checked && voterCount > 0`): track keeps full-strength on appearance, knob drops to `dim`, the word `LOCKED` appears beside the name in label-caps/dim, and the checkbox is `disabled`. **No opacity anywhere** (UX-DR6/DESIGN.md don't-list). A disabled checkbox does not submit — render a hidden input with the same name/value so a locked-on Toggle still round-trips as on in the POST body; the server rejects disables regardless, but the form must never silently flip truth.
  - [x] NEW unit/source-contract test for the component if the existing walker pattern covers components (`tests/unit/overlay.test.mjs` precedent) — assert token bindings, no opacity, no inline hex (the `no-raw-html.test.mjs` guard will walk it).
- [x] Task 6: Create form section (AC: #1)
  - [x] UPDATE `src/pages/creator/new.astro` — add the five toggle fields to the zod `formSchema` (all `z.string().default("")`-style, the existing field pattern), carry into `values` so 422 re-renders preserve checked states, wire into the `createPoll` draft. Render the Security Toggles section per the IA form order: **Question, options, Poll Type, Security Toggles, Visibility Setting, …** — a `<fieldset>` with `<legend class="group-label">` following the visibility-fieldset precedent (the closest existing analog), five `SecurityToggle` rows, Session Checks `checked` by default on a fresh GET (the default lives in the render, not as a silent POST fallback — tampered/absent checkbox = off, matching `multiSelect` semantics).
  - [x] No enhancer changes expected — a checkbox group inside the existing publish form works without JavaScript (AD-2 no-JS floor). If any JS behavior proves necessary, extend `enhanceDefinitionForm` via `src/scripts/create-poll-form.ts`, never a one-off inline script.
- [x] Task 7: Poll detail section + `update-security` intent (AC: #1, #3)
  - [x] UPDATE `src/lib/creator-lifecycle-form.ts` — add the `update-security` intent to `LifecycleIntent`/`INTENTS` and the five toggle keys to the allowlist (forged/unknown keys currently 422 "Unreadable form submission." — keep that strictness). Toggle forms carry no other mutable fields.
  - [x] UPDATE `src/pages/creator/polls/[pollId].astro` — render the Security Toggles section (own `<form>`, five rows + one save control with `intent=update-security`) from the lifecycle snapshot: when `voterCount > 0`, on-Toggles render locked and the section shows the exact line "Votes are in. Protections can tighten from here, not loosen." POST dispatch mirrors the existing intents: success → hand-built 303 `?outcome=security-updated` with `cache-control: private, no-store`; `poll_not_found` → 404; `poll_security_locked` → 422 re-render from re-loaded persisted state (never echo the rejected draft as truth — the `poll_definition_locked` handling at ~[pollId].astro:290-303 is the pattern); persistence failure → 500 (telemetry folds ≥500 as `result: "error"`; never map a 5xx to 422).
  - [x] Post-submit render follows the creator outcome contract ratified in Story 1.12: outcome line first in main, `tabindex="-1"`, focused on load, document `<title>` leads with the outcome.
- [x] Task 8: Vote-path composition verification (AC: #2, #4)
  - [x] No vote-transaction changes in this story. Verify by test that `castVote` already implements "all off = no challenge/code/duplicate check": with `sessionChecksEnabled` now settable to 0, the digest/claim block (`src/modules/voting/index.ts` ~384-428) is skipped and the Vote commits with no claim row; with it on, behavior is unchanged from Epic 1. `submission_id` idempotency applies regardless of toggle state (AD-7). Do not touch the transaction shape (Epics: "Epics 2 and 3 extend policy and surface; they never reshape this transaction").
  - [x] UPDATE `tests/unit/voting.test.ts` only if coverage of the toggle-off path is missing; the GET-side already-voted probe (`src/pages/[reference].astro` ~576-590) is session-digest based and simply never matches when no claim rows exist — correct as-is, do not re-plumb.
- [x] Task 9: Tests across all three layers (AC: all)
  - [x] Unit (`tests/unit/`, prose-sentence `it(...)` names): tighten-only policy matrix (zero-vote free change, post-vote enable allowed, post-vote disable rejected per-toggle, compose), no-op detection, `createPoll` draft→rows toggle mapping incl. dedupe-compare drift guard, `creator-lifecycle-form` new intent/keys (unknown key still 422).
  - [x] Integration (`tests/integration/`, workerd + real D1): schema assertions (Task 1); `insertPoll` round-trip persists all five toggle states; `updateSecurityTogglesForOwner` — pre-vote disable succeeds, post-vote enable succeeds, post-vote disable classifies `locked` and leaves columns + tally untouched, version bump on real change / none on no-op; create route persists form-driven toggles; detail route `update-security` intent matrix (ownership 404, locked 422 re-render, success 303).
  - [x] E2E (`tests/e2e/`, Playwright): create poll with UJ-1's combination (Session Checks + IP Checks + CAPTCHA on) and verify persistence on the detail page; all-off create then a successful vote with no duplicate check; post-vote locked UI proof. Screenshot proof per convention: `test-results/story-2-1-*-proof/*-{375-dark,1280-light}.png`, both modes, locked and unlocked states.
- [x] Task 10: Docs in the same commit
  - [x] UPDATE `CHANGELOG.md` — user-facing entry under `## [Unreleased]` (per-poll Security Toggles on create + detail, tighten-only after first Vote).
  - [x] UPDATE this story file's Dev Agent Record (File List, completion notes) and `sprint-status.yaml` per workflow. No README/AGENTS.md changes expected — no binding, env, or topology change.

### Review Findings

- [x] [Review][Patch] HIGH: Failed persistence renders the rejected security draft as locked truth [src/pages/creator/polls/[pollId].astro:385]
- [x] [Review][Patch] LOW: The locked-knob override loses to the checked-state selector [src/components/security-toggle.astro:121]
- [x] [Review][Patch] MEDIUM: The security route rejection matrix is claimed but not actually tested [tests/e2e/security-toggles.spec.mjs:157]
- [x] [Review][Patch] MEDIUM: The Story 2.1 E2E suite skips instead of failing when auth setup is missing [tests/e2e/security-toggles.spec.mjs:14]
- [x] [Review][Patch] LOW: The D1 adapter duplicates the shared `PollSecurityToggles` contract [src/adapters/d1/index.ts:619]
- [x] [Review][Patch] LOW: Locked security copy has two independent sources of truth [src/modules/polls/poll-security.ts:25]
- [x] [Review][Patch] LOW: The completed Epic 2 first-story action remains marked open [sprint-status.yaml:132]

## Dev Notes

### Decisions resolved at story-creation time (Justin to ratify before dev-story)

| # | Gap | Decision |
|---|---|---|
| D1 | **Voter Codes / VPN Blocking toggles render but are inert.** FR-17/FR-19 implementation is deferred to Epic 8 (AR-21, spine Deferred table), yet UX-DR6/EXPERIENCE.md specify the UI for all five Toggles and the AC renders five rows. Decision: all five rows render, persist, and round-trip in 2.1; Session Checks is the only enforced check today (IP Checks land in 2.2, CAPTCHA in 2.3). **An enabled-but-unimplemented Toggle currently has no vote-path effect.** Risk accepted: a Creator can enable Voter Codes before redemption exists. If this is unacceptable, the alternative is hiding the two rows until Epic 8 — but that contradicts the five-row UX spec; do not invent a third "unavailable" state (UX-DR6 defines none, and the Epic-1 retro forbids freehand toggle UI). |
| D2 | **Per-toggle description copy is unwritten.** DESIGN.md constrains form (one line, body/dim, "explains its own cost to the Voter") but no verbatim copy exists anywhere — same class of gap Story 1.7 flagged for multi-select. Proposed copy (voice rules: no exclamation marks, clarity outranks the joke, name the Creator's choices, layout-neutral): Session Checks — "One Vote per browser. A Voter who switches browsers can Vote again." · IP Checks — "One Vote per network. People sharing a connection can't each Vote." · Voter Codes — "Voters need a code from you. Anyone without one is turned away." · CAPTCHA — "A human check on submit. Scripts fail; people barely notice." · VPN Blocking — "Votes from VPNs and datacenters are turned away." Ratify or amend at implementation; whichever copy ships belongs in a copy catalog (the `LIFECYCLE_COPY` precedent), keyed by code never by rendered text. |
| D3 | **Module placement:** toggle storage + the tighten-only write command live in `src/modules/polls/` (AD-19: Polls owns Poll configuration; only Polls commands write `poll`). Vote-time enforcement reads toggles through the Voting snapshot — that is Stories 2.2/2.3's surface, unchanged here. This mirrors what Epic 1 already shipped (`session_checks_enabled` written by polls, read by `castVote`). |
| D4 | **`representation_version` bumps on real toggle change** (AD-24 safe reading: toggle state alters what the voting surface presents). No-op writes do not bump. |
| D5 | **Locked-on Toggles submit their on-state via hidden input** so the strict form parser and the command see full truth; the server remains the only enforcement (UI reflects, never implements — EXPERIENCE.md Component Patterns). |

### Architecture guardrails (binding invariants)

- **AD-17 tighten-only** (spine): "After the first accepted Vote, question, options, and Poll Type are immutable… Security Toggles may be enabled but not disabled." Enforced server-side in the command + adapter guard, keyed on first accepted Vote (`voterCount > 0` re-checked at mutation time), not on close or deadline.
- **AD-19 one owner, one write path:** only Polls-module commands write `poll`. Do not write toggle columns from voting or routes.
- **AD-7 transaction shape is untouchable:** "all off" is implemented by CastVote skipping claim contributions — already true today; never weaken the transaction.
- **AD-1 hexagonal:** the command is provider-free with injectable ports; routes only parse FormData and map Results. No business rules in route frontmatter (recurring HIGH review finding).
- **AD-22 CSRF:** both forms post to existing creator routes already behind the middleware; include `csrf_token`; the strict parser must allowlist the new keys or parsing throws.
- **AD-14 migrations:** forward-only expand; checksum manifest in the same commit; never edit history to fix a guard failure.
- **AD-15 telemetry:** one structured record per operation, IDs only — never voter digests or toggle-affecting voter data.
- **AD-23 shared kernel:** the toggle key contract goes in `shared/domain`; extending it means updating `tests/unit/shared-kernel.test.ts` if the contract is asserted there.
- **AR-19 conventions:** POST→303 on success; 422 re-render with preserved values; stable snake_case error codes; Zod at the delivery boundary with domain invariants re-enforced; no environment lookup in domain modules.
- **NFR-7:** "all off" does **not** disable the baseline `VOTE_RATE_LIMITER` abuse floor — it means no challenge/code/duplicate check only.

### Existing code this story touches (verified on main @ ad8c74a)

- `db/migrations/0004_polls.sql:19` — `session_checks_enabled INTEGER NOT NULL DEFAULT 1` already exists; header comment reserves Epic 2 toggle columns. `0008_multi_select.sql` is the expand-migration precedent. Next number: **0009**.
- `src/modules/polls/index.ts` — `CreatePollDraft` (~43-60), `validateCreatePoll` (~248-348), `ExistingPollSnapshot` (~408-420), `matchesExistingPoll` (~454-487), `draftContentForCompare` (~503-542), `PollPersistenceRows` (~352-382), `createPoll` with hard-coded `sessionChecksEnabled: true` (~664). Dedupe compare must gain all five toggles.
- `src/modules/polls/poll-lifecycle.ts` — `PollLifecycleSnapshot` (~43-58, gains toggle states), port shapes (~92-124), error helpers (`lockedError` at ~130-169), two-layer lock enforcement: advisory `voterCount > 0` pre-check (~473-475) + adapter batch re-enforcement. `LIFECYCLE_COPY` (~27) is the copy-catalog precedent.
- `src/modules/voting/index.ts` — `VotingPollSnapshot.sessionChecksEnabled` (~85-99); conditional digest/claim block (~384-428): toggle off → no digest, no claim, no duplicate check (already correct). `VoterClaimContribution.checkKind` is `"session"`-only today; the digest adapter already types `"session" | "ip"` — Story 2.2's seam, do not build it here.
- `src/adapters/d1/index.ts` — `PollRow`/`toPollPage` (~69-111); per-query hand-written SELECT lists: `findPollByReference` (~202), `findPollForOwner` (~239), `loadLifecycleForOwner` (~314-378), `createVotePersistence.findPoll` (~731-757); `insertPoll` explicit column list (~133); `updateDefinitionForOwner` guarded batch (~460-566) and `updateDescriptionForOwner` no-op classification (~417-455) — the two patterns Task 4 combines.
- `src/pages/creator/new.astro` — zod `formSchema` (~64-77), POST flow (~103-224), visibility `<fieldset>` precedent (~263-283); every response `cache-control: private, no-store`, hand-built 303s never `Astro.redirect`.
- `src/pages/creator/polls/[pollId].astro` — intent dispatch (~106-335), `poll_definition_locked` → `forceLockedView` + reload + 422 (~290-303), lock detection from snapshot `voterCount` (~385-394).
- `src/lib/creator-lifecycle-form.ts` — strict per-intent key allowlists; unknown keys 422.
- `src/components/poll-option.astro` — the label-row construction to mirror (visually-hidden native input, whole-row `<label>`, `:focus-within` ring).
- `src/styles/tokens.css` — shared component-token block (~128-182); `--color-solar-dark` is load-bearing for the deploy smoke — never touch.

### UX contract (exact, from DESIGN.md / EXPERIENCE.md)

- `security-toggle` (DESIGN.md Components): 40×20px square track, 16px square knob, radius 0. Off — `rule` track, `text` knob left. On — `solar-wash` track, `solar-ink` knob right. Name in label-caps; one-line description in body/`dim` ("Every Toggle explains its own cost to the Voter"). Whole row is the hit area; name and description inside the `<label>`. Locked: full-strength on-track, `dim` knob, `LOCKED` beside the name in label-caps/`dim` — "There is no opacity mechanism."
- Toggle names are fixed vocabulary (they feed the Story 2.4 trust badge): **Session Checks, IP Checks, Voter Codes, CAPTCHA, VPN Blocking** — plural, uniform.
- Behavior (EXPERIENCE.md Component Patterns): "Before the first Vote, freely on and off. After the first Vote, tighten-only… Locking is enforced server-side; the UI reflects it rather than implementing it. A new Poll opens with Session Checks on and everything else off. Turning a Toggle on mid-Poll takes effect for subsequent Votes only and never invalidates a Vote already cast."
- Locked line, verbatim (Voice and Tone): "**Votes are in.** Protections can tighten from here, not loosen."
- Motion: none. The five primitives are closed; the knob flips instantly; idle is still.
- Accessibility: native checkbox under the visual track (no hand-rolled switch ARIA); 2px/2px `focus-ring` outline; state never color alone; 44px target floor on creator surfaces (whole row exceeds it); post-submit outcome line `tabindex="-1"`, first in main, focused, `<title>` leads with the outcome.
- Form order (EXPERIENCE.md IA): Question, options, Poll Type, **Security Toggles**, Visibility Setting, Discovery Setting, Deadline, Custom Link.

### Scope fences — do NOT build in this story

- IP-claim writing, IP rejection copy, IPv6 /64 normalization → **Story 2.2** (schema and digest adapter already support `check_kind: "ip"`; leave them).
- Turnstile validation, widget render → **Story 2.3** (`src/adapters/turnstile/index.ts` stays a stub).
- Trust badge → **Story 2.4** (this story persists the state the badge will read; it renders no badge).
- Voter code generation/redemption, `input-code`, code overlay, VPN heuristics → **Epic 8** (AR-21 deferred).
- No changes to the vote transaction, the rate limiter, or the already-voted GET probe.

### Previous-story intelligence (Epic 1 patterns that bind)

- Lock enforcement is always two-layer: advisory domain pre-check + D1 re-enforcement inside the guarded write (Story 1.12 review). Never trust the snapshot at write time.
- A lock race re-renders **persisted** state, never the rejected draft (1.12 Chunk 2 HIGH).
- Persistence failure is 500, not 422; telemetry folds ≥500 as `result: "error"`.
- Policy branches key off `reasonCodes`/stable codes, never rendered copy (1.3 round 5).
- No silent defaults for tampered/missing fields; checkbox absence = off is the ratified `multiSelect` semantics.
- Every creator POST response carries `cache-control: private, no-store`, including 303s; hand-built Responses, never `Astro.redirect`.
- Deferred-work triage (retro action item 3): nothing in `deferred-work.md` blocks this story; the only adjacent item is the accepted `VOTE_DIGEST_SECRET` rotation trade-off, which this story does not touch.

### Testing requirements

- Same-commit rule: every new behavior lands with its test. Unit for pure policy (Node), integration for D1/adapter/route behavior (workerd), e2e for creator journeys + visual proof. Never move pure-logic tests into integration.
- Gate order before merge: `pnpm migrations:guard` → `pnpm test` → `pnpm check` → `pnpm test:e2e` → `pnpm types` → `git diff --exit-code worker-configuration.d.ts` → `pnpm build:production`.
- Screenshot proof in both modes at 375 and 1280 under `test-results/story-2-1-*-proof/` — locked and unlocked toggle states on the detail surface, and the create-form section.

### References

- [Source: _bmad-output/planning-artifacts/epics.md:587-617 — Epic 2 intro + Story 2.1 ACs, verbatim]
- [Source: _bmad-output/planning-artifacts/epics.md:35 — FR-15 five toggles, default, tighten-only]
- [Source: _bmad-output/planning-artifacts/epics.md:97 — UX-DR6 security-toggle contract]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md — AD-1, AD-3, AD-7, AD-14, AD-15, AD-17, AD-19, AD-22, AD-23, AD-24]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md:204-220, 576-582 — security-toggle tokens + anatomy/locked state]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md:48, 118, 146 — form order, locked line, toggle behavior contract]
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md:200-206 — FR-15]
- [Source: _bmad-output/implementation-artifacts/1-12-close-edit-delete.md — lifecycle/lock patterns, binding-scope handoff of security to Epic 2]
- [Source: _bmad-output/implementation-artifacts/1-3-create-a-multiple-choice-poll.md — create flow, dedupe adjudication, "this story persists only session_checks_enabled=1" handoff]
- [Source: _bmad-output/implementation-artifacts/epic-1-retro-2026-08-03.md — Epic 2 prep: create-story from spine, no freehand toggle UI]

## Dev Agent Record

### Agent Model Used

Grok 4.5 (dev-story workflow)

### Debug Log References

- Local D1 needed `pnpm migrate:local` for 0009 before e2e (dev server shared DB).
- E2E vote path uses custom link + `label.poll-option` click (share-URL scrape was flaky).

### Completion Notes List

- Migration 0009 adds `ip_checks_enabled`, `voter_codes_enabled`, `captcha_enabled`, `vpn_blocking_enabled` (session already in 0004). Checksum + guard green.
- Shared `SECURITY_TOGGLES` / `PollSecurityToggles` contract; createPoll maps five draft checkbox fields (`=== "true"`); dedupe compare includes all five.
- `updatePollSecurityToggles` pure policy + command: free pre-vote, enable-only post-vote (`poll_security_locked` + exact Voice line), no-op without version bump.
- D1 `updateSecurityTogglesForOwner` race-free tighten-only guard (`column <= requested` when votes exist); columns on PollPage / lifecycle snapshot / insert.
- `security-toggle` component + tokens (square track/knob, LOCKED without opacity, hidden input for locked-on).
- Create form + detail `update-security` intent; locked re-render uses persisted state only.
- Vote path unchanged; existing unit coverage for session-off omits claims; e2e all-off proves zero claim rows.
- Tests: unit (policy, form, component, kernel), integration (schema, adapter matrix), e2e (UJ-1, all-off vote, lock + tighten) with screenshot proof under `test-results/story-2-1-*-proof/`.
- Code review resolved all seven findings: persistence failures now reload committed security truth; locked-knob styling wins in both modes; real create/detail route matrices and computed-style browser proof cover success, ownership, lock, and write-failure paths; Story 2.1 E2E fails closed when auth setup is absent; shared contracts and locked copy are single-sourced.
- Full local deploy gate passed on Node 24.18.0 / pnpm 11.17.0: migration guard; 48 Vitest files / 784 tests; TypeScript; 128 Playwright tests; generated binding-types drift check; production build.

### File List

- db/migrations/0009_security_toggles.sql
- db/migrations.manifest.json
- src/shared/domain/index.ts
- src/modules/polls/index.ts
- src/modules/polls/poll-lifecycle.ts
- src/modules/polls/poll-security.ts
- src/adapters/d1/index.ts
- src/lib/creator-lifecycle-form.ts
- src/components/security-toggle.astro
- src/styles/tokens.css
- src/pages/creator/new.astro
- src/pages/creator/polls/[pollId].astro
- CHANGELOG.md
- tests/unit/poll-security.test.ts
- tests/unit/security-toggle.test.mjs
- tests/unit/shared-kernel.test.ts
- tests/unit/creator-lifecycle-form.test.ts
- tests/unit/polls.test.ts
- tests/unit/poll-lifecycle.test.ts
- tests/unit/poll-card.test.mjs
- tests/integration/polls-schema.integration.test.ts
- tests/integration/polls-adapter.integration.test.ts
- tests/integration/poll-lifecycle-adapter.integration.test.ts
- tests/integration/creator-dashboard-adapter.integration.test.ts
- tests/integration/create-poll-route.integration.test.ts
- tests/integration/creator-poll-lifecycle-route.integration.test.ts
- tests/e2e/security-toggles.spec.mjs
- _bmad-output/implementation-artifacts/2-1-per-poll-security-toggles.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

### Change Log

- 2026-08-03 — Story created via create-story from architecture spine (Epic 1 retro action item 5). Status: ready-for-dev.
- 2026-08-03 — Implemented per-poll Security Toggles (migration, domain, adapter, UI, tests). Status: review.
- 2026-08-03 — Adversarial code review resolved seven findings and passed the full local deploy gate. Status: done.
