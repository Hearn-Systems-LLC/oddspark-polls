---
baseline_commit: ea8fa1bafe971e849e6627043d0103ada18a116c
---

# Story 8.2: Vote With a Voter Code

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Ultimate context engine analysis completed 2026-08-12 — implementation guide reconciled against the complete Epic 8, PRD, architecture, UX, current main code, Story 8.1 dependency state, current Cloudflare D1 documentation, tests, and recent Git history. -->

## Story

As an invited Voter,
I want my code to admit exactly my one vote,
so that the invite list is the electorate — no more, no less (SM-3).

## Acceptance Criteria

1. **Keep the Poll readable and gate only submission.** **Given** an effectively open Poll whose authoritative Voter Codes Toggle is on, **when** an invited Voter opens an editable initial ballot, **then** the complete question, description, and Poll-Type ballot remain readable, and one persistently labelled `VOTER CODE` `input-code` appears inside the Vote form immediately above the options, image plates, rank builder, or Meeting availability grid. It is blank on a fresh load, never autofocused, has no client/native validity gate, and follows the ruled transparent input treatment: 44px minimum height, data-lg/Courier Prime at 20px, `0.3em` tracking, uppercase, focus outline plus focus rule, and inline alarm state. Progressive enhancement trims and uppercases the actual value as typed; the server independently repeats normalization and remains authoritative (FR-17, UX-DR14/19).
2. **Redeem one valid code atomically with one Vote.** **Given** a valid unused code for that Poll and a valid initial ballot, **when** the Vote commits, **then** exactly one `voter_code_redemptions` row keyed by `code_id` is inserted in the same AD-7 D1 batch as the Vote, Poll-Type facts, optional Comment/display name, every enabled voter claim, and the single `representation_version` increment. The code is not reserved or mutated beforehand. Concurrent submissions of one code produce exactly one complete accepted Vote and one complete rollback with the used-code outcome; N generated codes permit at most N later code-gated Votes. Exact committed `submission_id` replay returns the stored outcome before code/rate/CAPTCHA revalidation and creates no second redemption; a divergent ballot/comment payload remains `idempotency_conflict`.
3. **Reject safely and preserve the entire decision.** **Given** all earlier admission prerequisites pass but the code is missing, malformed, wrong-Poll, nonexistent, already redeemed, or lost to a concurrent submission, **when** the final Vote action is submitted, **then** no Vote fact or redemption from that attempt persists, the response is `private, no-store`, and the matching centralized 422 outcome renders first in `<main>`, receives focus, leads the document title, and marks the field invalid with an inline caption:
   - missing — `This Poll needs a Voter Code. The Creator hands them out; we can't issue one.`
   - malformed, wrong-Poll, or nonexistent — `That code doesn't work on this Poll. Check for a typo — codes are short and unforgiving.`
   - used or concurrent race loss — `That code has already been used. Each one works exactly once. Either someone got there first, or you did.`

   The retry render preserves the canonical typed code, single/multi/Image selections, complete or partial ranking, all Meeting availability, Meeting display name, Comment body, and Comment display name. Validation occurs only on final server submission, never on blur, lookup-as-you-type, a rank-draft action, or a client “looks valid” check. Operational lookup/persistence failures remain the generic safe 500 outcome and never masquerade as an invalid code.
4. **Compose truthfully with every Poll mode and protection.** **Given** Voter Codes are enforced, **when** the voting surface or authorized Tally renders, **then** the existing trust badge includes `INVITE CODE REQUIRED` in canonical Toggle order, stacked without truncation and without “secure”/“verified” claims. With the Toggle off, the code field is absent, one structurally readable forged value has no policy effect or lookup, and earlier Votes remain valid; duplicate/File values still make the form structurally unreadable. An initial Meeting response requires and redeems one code. Every recognized Meeting revision renders `SAVE` with no code input, performs no code lookup, and creates no second redemption. Its form-owned badge is suppressed: an authorized Tally owns the one current protection list, and if no Tally is authorized the revision surface omits `INVITE CODE REQUIRED` rather than placing a false admission claim above `SAVE`. Successful/read-only/count-confirmation surfaces never echo the code.

## Tasks / Subtasks

- [x] Slice A / Task 1 — Repair and prove the merged Story 8.1 foundation before enabling admission (prerequisite to AC: 2–4)
  - [x] Treat this as a distinct Story 8.1 remediation slice, not optional review polish or hidden 8.2 feature work. Baseline `main @ ea8fa1b` had no pre-existing worktree changes before this story artifact and Story 8.1 is recorded `done`, but its owner adapter queries nonexistent `poll.owner_id`, its committed migration omits the promised code-shape guards, its panel places bearer codes in `data-copy-text`, its route collapses ruled failures to 422 and cannot preserve malformed form state, exact concurrent generation replay can fall into collision exhaustion, the overlay description ID is duplicated, and the recorded D1/route/Playwright evidence does not exist. Finish and validate Slice A before Slice B; keep its remediation in separately scoped logical commit(s). If any item lands independently before development starts, re-verify it on the new baseline rather than duplicating work.
  - [x] Fix both owner-qualified queries in `src/adapters/d1/voter-codes.ts` to use the real schema column `poll.owner_user_id`; preserve ownership concealment and the purpose-shaped projection.
  - [x] Never edit committed migration `0018`. Add forward-only `db/migrations/0019_voter_code_integrity.sql` with insert/update guards that reject any code whose length is not exactly eight or whose characters fall outside `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, using one stable internal abort identifier and no raw value. Regenerate `db/migrations.manifest.json` with `pnpm migrations:checksum`, then run `pnpm migrations:guard`.
  - [x] Remove raw codes from every HTML `data-*` attribute in `src/components/voter-code-panel.astro`. The clipboard enhancer may derive its explicit payload from the authorized visible code text nodes at activation time. Give Overlay and slotted description content one unique accessible-description relationship, not duplicate IDs.
  - [x] Restore Story 8.1's ruled generation response behavior: preserve safe submitted `count` and `batch_id` on parse errors; retain 422/409/503/500 mappings; after a concurrent exact-batch unique race, reload and adjudicate the winning `(poll_id, batch_id)` before treating it as a random-code collision. Raw codes never enter an error, log, URL, or HTML attribute; the opaque `batch_id` remains only in its required hidden form field and stays out of URLs, telemetry, logs, and `data-*` attributes.
  - [x] Backfill real workerd/D1, route-integration, and Playwright coverage for generation/inventory before using it as 8.2 setup: migration guards/FKs/triggers, owner route and status/state rules, generation retry concurrency, overlay/copy behavior, no bearer-secret leakage, and redeemed projection. Do not preserve checked boxes as a substitute for executable evidence.

- [x] Slice B / Task 2 — Add provider-free Voter Code admission policy to Voting (AC: 1–4)
  - [x] Extend `src/modules/voting/voter-codes.ts` rather than duplicating constants. Normalize with `trim().toUpperCase()` and validate exactly `VOTER_CODE_LENGTH = 8` characters from `VOTER_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"`. Return discriminated missing/invalid/canonical outcomes; no error contains submitted text.
  - [x] Centralize the three exact Voice-and-Tone strings with `VOTE_COPY` and stable application codes `voter_code_missing`, `voter_code_invalid`, and `voter_code_used`. Add a narrow persistence error such as `VoterCodeAlreadyUsedError`; infrastructure failures stay `vote_failed`.
  - [x] Add `voterCodesEnabled` to `VotingPollSnapshot`, `voterCode: string` to initial `CastVoteInput`, and an injected lookup port that resolves only `(pollId, canonicalCode)` to `{ codeId, redeemed } | null`. Do not expose D1, Astro, environment access, or raw code outside the command/adapter boundary.
  - [x] Preserve and pin precedence. Delivery retains committed-replay bypass → limiter → Turnstile preparation before `castVote`. The command performs canonical ballot/Comment payload → exact replay → fresh Poll/open/Comment/Poll-Type validation → existing Session-token prerequisite → IP-digest prerequisite → CAPTCHA proof → Voter Code normalization/lookup → fact construction. Thus rate limiting, unavailable required identity, or failed CAPTCHA surfaces before a code error; once those prerequisites pass, missing/invalid/used code surfaces before any D1 claim collision. Empty canonical input is missing; bad shape, wrong-Poll, and absent rows are invalid; a pre-read redeemed row is used. A lookup throw is a safe transient failure. With the Toggle off, a single readable supplied value has no policy effect and causes no lookup.
  - [x] Keep the code out of `normalizeVotePayload`, the payload hash, stored Vote rows, result manifests, and replay comparison. It is an admission challenge analogous to consumed Turnstile proof: an exact accepted retry must succeed even though the code is now redeemed. Divergent ballot/Comment/name content still conflicts.
  - [x] A friendly unused/read check never decides acceptance. Build exactly one typed `voter_code_redemption` contribution `{ codeId, voteId, redeemedAtMs }` only for a new code-gated Vote; place it after Poll-Type/Comment facts and before Session/IP claims so a same-request concurrent code collision has deterministic used-code precedence. Do not send this contribution through `reviseVote`.
  - [x] Retain the ratified Story 2.2 linearization rule: the fresh `CastVote.findPoll` snapshot decides whether this submission is before or after Toggle enablement. Do not add an ad-hoc commit-time Toggle reread, mutable `used` flag, reservation, or zero-row update without a new architecture decision.

- [x] Slice B / Task 3 — Extend the D1 vote adapter without weakening the transaction (AC: 2–4)
  - [x] Update `createVotePersistence.findPoll`'s handwritten SELECT, row contract, and mapping with `voter_codes_enabled`. Add a scoped lookup that binds canonical code only to D1, selects by both `poll_id` and `code`, and returns only branded/internal code ID plus redeemed boolean. It never logs/bubbles SQL, bind values, or raw exception text.
  - [x] Extend `VotePersistenceContribution` and `insertVote`'s exact-record validation for at most one redemption matching the batch `voteId` and timestamp; raise the contribution-count ceiling by exactly one. Reject forged duplicates, mismatched Vote/timestamp, empty IDs, or unsupported shapes before preparing/binding D1.
  - [x] Append `INSERT INTO voter_code_redemptions (code_id, vote_id, redeemed_at_ms)` inside the existing `db.batch()` after Vote/type/Comment statements and before voter claims/version increment. Preserve the existing Vote-open trigger, Poll/code/Vote FKs, cross-Poll trigger, primary key on `code_id`, unique `vote_id`, and one version increment. Do not modify `0018`, add a second transaction, or persist a second source-of-truth “used” bit.
  - [x] Narrowly classify `UNIQUE constraint failed: voter_code_redemptions.code_id` (and the stable one-per-Vote guard only if reachable from an otherwise valid batch) after rollback as used. Adjudicate submitted code candidates before the adapter's generic FK fallback: a living Poll whose resolved code disappeared must become invalid or a generic safe failure, never a false Poll-deleted/definition-changed result. If classification read fails or no candidate is confirmed, do not guess.
  - [x] Preserve existing precedence for exact submission replay, Poll close, Comment disable, definition changes, Session/IP collisions, and Poll deletion. Prove any failing statement rolls back Vote, selections/ranks/availability, Meeting response, Comment, all claims, redemption, timestamp/version changes, and owner redeemed count.
  - [x] Current Cloudflare D1 documentation confirms `D1Database::batch()` executes prepared statements sequentially in one transaction and rolls the batch back on failure. Continue the repository's established prepared-statement pattern and prove the exact constraint/error behavior in real workerd rather than relying on mocks or undocumented message assumptions.

- [x] Slice B / Task 4 — Parse, preserve, render, and enhance one accessible code field (AC: 1, 3, 4)
  - [x] In `src/lib/poll-delivery.ts`, structurally parse `voter_code` through the existing singleton boundary before policy: zero or one text value is readable; duplicates or any `File` value make the multipart form unreadable and receive the existing generic 422 even when the Toggle is off or the request is a Meeting revision. “Ignored while off” never waives strict form-shape validation. Bound hostile echo size without truncating an ordinary whitespace-padded code before server normalization. Carry canonical `voterCode` and its field error through `PollDeliveryState`.
  - [x] Rank-builder draft POSTs preserve one readable submitted code and the ranking but neither validate nor redeem the code. The recognized Meeting revision branch accepts/ignores one readable forged value, bypasses admission, and never passes a code to `reviseVote`; duplicates/Files already failed the structural boundary. Only the final new-Vote branch passes code to `castVote`.
  - [x] Map the three stable domain errors to HTTP 422, exact catalog copy, `fieldErrors.voterCode`, and title prefixes `Voter Code required`, `Voter Code invalid`, and `Voter Code used`. Preserve the standard first-in-main focused outcome. On a code-policy race, refresh the public Poll projection before re-render so a fresh CastVote snapshot that saw Toggle-on cannot return “code required” beside a stale form with no field; suppress echoed code if the authoritative refresh is now off.
  - [x] Add `src/components/input-code.astro` (or extend the existing `Input` primitive with an explicit code variant) using only design tokens: persistent label, transparent field, 44px target, Courier Prime/data-lg 20px, `0.3em` tracking, actual uppercase value, focus outline/rule, alarm rule, `aria-invalid`, and inline caption wired by a unique `aria-describedby`. `[ASSUMPTION]` The unspecified field label is `VOTER CODE`, the established glossary term.
  - [x] Render it in `src/components/poll-voting-surface.astro` immediately after `submission_id` and before every Poll-Type ballot control when `poll.voterCodesEnabled && !meetingRevisionRecognized`. Do not render it on read-only, already-voted, closed, counted, or recognized Meeting-revision surfaces. Keep question → code → ballot → Comment → trust badge → Turnstile → Vote source/focus order. For a recognized revision, set badge ownership to the authorized Tally (`tallyOwnsBadge = readOnly || meetingRevisionRecognized`) and suppress the form badge; if no Tally renders, render no invite-code claim beside `SAVE`.
  - [x] Do **not** add `required`, `pattern`, `minlength`, `maxlength`, autofocus, on-blur validation, AJAX lookup, or an affirmative client validity state. `maxlength=8` is specifically unsafe because it can truncate a whitespace-padded valid paste before trim. Placeholder-as-label is forbidden.
  - [x] Extend `src/scripts/vote-form.ts` with an `input` enhancer that mutates the real field value to trimmed uppercase while preserving sensible selection. During in-flight submission set it `readOnly` and lock interaction with existing form state/CSS — never `disabled`, because disabled controls are omitted from native serialization. Restore it on validation abort, offline failure, timeout/reset, and `pageshow` alongside existing controls.
  - [x] The rejected raw/canonical code may appear only as Astro-escaped text in that ordinary input's `value` so the Voter can correct it. It must never appear in `data-*`, outcome copy, title, URL/query, header, request context, telemetry, console, export, test snapshot, public projection, or proof artifact/filename. Successful PRG and every read-only state drop it.

- [x] Slice B / Task 5 — Make the trust claim true and preserve protection composition (AC: 2, 4)
  - [x] Add `voterCodes` to `ENFORCED_TOGGLES` in `src/components/trust-badge.ts` only when admission/redemption ships. Reuse the existing copy map and `SECURITY_TOGGLES` order: browser, network, invite code, human check, then future VPN. Do not fork badge rendering or claim “secure”/“verified”.
  - [x] Verify every surface that already renders a voting form or Tally — including Ranked, Image, Meeting, Results, and an embedded Demo on owner-facing pages — keeps exactly one badge at the established owning surface. Do not add a badge to unrelated creator-management pages. On a recognized Meeting revision, the form owns no badge; the authorized Tally may show `INVITE CODE REQUIRED` as the current protection list. If result visibility withholds the Tally, omit the badge rather than make the false suggestion that `SAVE` consumes a code.
  - [x] Prove all Toggle matrices compose: code-only; Session+code; IP+code; CAPTCHA+code; all currently enforced protections; Toggle enabled after earlier Votes; and forged code while off. Existing rate limiting remains the independent best-effort floor, and Turnstile remains outside the mutation batch.
  - [x] Keep `src/adapters/telemetry/index.ts` at its exact six allowlisted fields and retain its existing `voterCode`/`voter_code`/`voterCodes` denylist. No route-local or domain log is added; failure objects carry stable codes only.
  - [x] After a successful voter redemption, the existing owner projection shows exactly that code struck through and increments `{redeemed} OF {total} REDEEMED`, with no Vote ID, ballot, identity, display name, Comment, or redemption timestamp exposed.

- [x] Slice B / Task 6 — Prove policy, rollback, privacy, accessibility, and every Poll Type (AC: all)
  - [x] Unit — canonicalization and exact alphabet/length; missing/invalid/wrong-Poll/used mapping; lookup throw; Toggle-off ignore; authoritative before/after-enable snapshots; exact replay before lookup; code omitted from payload hash; typed contribution; all failure paths create no batch; trust badge inclusion/order/ownership; Meeting revision omission. Pin combined precedence for rate-limit, missing required Session/IP material, failed CAPTCHA, code errors, and persistence collisions. Test static errors never contain fixture codes.
  - [x] Component/script — field precedes each ballot shape; exact label/tokens/20px/0.3em; no autofocus/native/client validity gate; inline ARIA; typed uppercase/trim; ranked draft preservation; in-flight readOnly serialization and every restore path; 375px wrapping/no overflow; no code-bearing `data-*`; badge stacks without truncation.
  - [x] Workerd/D1 foundation — exercise `0018` plus forward `0019`: exact code guards, FKs/cascades, cross-Poll and one-code-per-Vote guards, owner lookup, all-or-none generation, exact generation replay race, and owner projection. Use FK-ordered cleanup and `applyD1Migrations`; never edit an applied migration.
  - [x] Workerd/D1 voting — valid code across single/multi, Ranked, Image, and initial Meeting facts; missing/malformed/wrong-Poll/nonexistent/used; code-only and full Toggle matrix; Comments/names; Poll close/delete/definition and Comment-disable races; exact retry; mid-Poll enablement; Toggle off; code deletion/FK classification; one version bump. Force two real batches to race on one code and assert one success, one `voter_code_used`, one redemption, one Vote, and zero losing facts/version movement.
  - [x] Route integration — real middleware/D1 POSTs for single/duplicate/File/oversized code fields with Toggle on, Toggle off, and a recognized Meeting revision; exact 422 copy/status/title/focus/ARIA; complete safe form preservation; refresh after Toggle race; private/no-store; combined rate-limit, Session/IP prerequisite, CAPTCHA, and code-failure precedence; operational 500; exact replay bypass; raw code absent from URL, headers, request context, telemetry, console, error/title copy, and non-code storage. Meeting revisions never look up/redeem.
  - [x] Playwright — add `tests/e2e/voter-code-voting.spec.mjs` (or equally focused coverage) for owner generate → voter redeem → owner `1 OF N REDEEMED`; multiple-choice, UJ-4 Ranked partial/full ranking, Image, initial Meeting, and repeated Meeting revision; invalid→correct→used flows; no-JS ranked draft and final submission; offline/in-flight/pageshow; CAPTCHA and rate-limit composition; clean console/page errors. Include a Meeting response created before Voter Codes are enabled and revised afterward: `SAVE` asks for no code, redemption count stays unchanged, and badge ownership is Tally-only or omitted when the Tally is unauthorized.
  - [x] Browser proof — capture 375×812 dark and 1280px light fresh forms, preserved invalid/used outcomes, counted/Tally state, and Meeting revision. Filenames remain generic and contain no code. Verify keyboard order, outcome focus/title, no overflow, badge stacking, code absence after success/revision, and identical light/dark silhouette.

- [x] Slice B / Task 7 — Reconcile architecture, public record, and the full local gate (AC: all)
  - [x] Update `ARCHITECTURE-SPINE.md` only at the affected capability/deferred record: close Story 8.2 Voter Code enforcement under AD-7/AD-19 while preserving AD-25's approved storage boundary; leave Story 8.3 VPN enforcement deferred **within that row** and preserve every unrelated deferred item. No new storage-design approval is required — recoverable normalized plaintext was explicitly approved in AD-25 for Story 8.1.
  - [x] Update `CHANGELOG.md` under `## [Unreleased]` with invite-code-gated voting and one-time redemption. Update README only if its current public capability wording becomes false; no setup, binding, secret, environment, or deployment topology change is expected.
  - [x] Run the pinned local gate: `pnpm migrations:checksum` → `pnpm migrations:guard` → `pnpm test` → `pnpm check` → `pnpm test:e2e` → `pnpm types` → `git diff --exit-code worker-configuration.d.ts` → `pnpm build:production` → `git diff --check`. Also inspect browser console and required visual proof; automated tests do not establish visual fidelity by themselves.
  - [x] Complete this story's Dev Agent Record/File List and transition only Story 8.2 through the BMad workflow. Development belongs on `story/8-2-vote-with-a-voter-code`; make scoped Conventional Commits per the repository's logical-change rules only after the relevant checks pass. Do not push, merge, deploy, or begin Story 8.3 without separate user authority.

## Dev Notes

### Critical dependency audit — verified on current `main`

Story 8.1 supplied the intended table shape and approved AD-25 storage decision, but its checked completion record overstates the executable baseline. Story 8.2 must complete the distinct prerequisite remediation slice in Task 1 before relying on generated codes:

| Confirmed current state | Why 8.2 cannot ignore it | Ruled correction |
| --- | --- | --- |
| `src/adapters/d1/voter-codes.ts` queries `poll.owner_id`; migration `0004` defines `owner_user_id`. | Owner generation/inventory fails at runtime, so no usable invite can reach the voter flow. | Correct both owner-qualified queries and prove them against real D1. |
| `0018_voter_codes.sql` has no length/alphabet constraint despite Story 8.1's checked requirement. | D1 does not currently preserve the canonical bearer-code fact contract. | Add forward `0019` guards; never edit checksummed `0018`. |
| `voter-code-panel.astro` serializes every code in `data-copy-text`. | It violates AD-15/AD-25's explicit bearer-secret browser boundary. | Read authorized visible text only at copy activation; keep codes out of attributes. |
| Codes route maps all command failures to 422 and malformed form errors cannot retain safe count/batch state. | The management setup path contradicts its stable retry/status contract. | Restore ruled 422/409/503/500 mapping and preservation. |
| Concurrent exact generation replay can be treated as random collision/exhaustion; panel description IDs duplicate. | Retry correctness and accessible overlay naming are not proven. | Re-adjudicate the winning batch; make description ownership unique. |
| The Story 8.1 file claims workerd, route, and Playwright proof, but merged tests are unit-only. | SQL/schema/privacy defects passed because the asserted layers never ran. | Backfill executable evidence before/alongside 8.2's end-to-end flow. |

This is not a new architecture gate. AD-25 already ratifies recoverable normalized plaintext because the owner must reopen/copy inventory. Task 1 preserves that decision and repairs its implementation/evidence.

### Binding implementation decisions

| # | Ambiguity | Decision |
| --- | --- | --- |
| D1 | Which code shapes are distinct errors? | `trim().toUpperCase()` empty is missing. Any non-eight/non-alphabet shape, wrong-Poll code, or absent code is invalid. A confirmed redemption or unique-race loss is used. Never reveal whether a code exists on another Poll. |
| D2 | Is the code part of idempotent payload identity? | No. Ballot/Comment/display-name facts remain the payload. Admission challenges are deliberately excluded so an exact committed retry returns the stored outcome after code consumption; changed payload still conflicts. |
| D3 | What linearizes a concurrent Toggle enable? | The fresh `CastVote.findPoll` read, matching Story 2.2. A snapshot that sees off is pre-enable and ignores a forged code; a snapshot that sees on enforces lookup/redemption. Do not invent commit-time Toggle policy. |
| D4 | What decides and classifies concurrency? | The `voter_code_redemptions.code_id` uniqueness inside the existing batch decides. An unused pre-read is only friendly validation. After rollback, narrowly map the submitted code collision; if adjudication is unavailable, use generic safe failure. |
| D5 | Which duplicate protection wins? | Exact submission replay wins first. For a new code-gated submission, emit the redemption statement before Session/IP claims so a concurrent used-code collision is deterministic; existing Session-before-IP priority remains unchanged when the code does not collide. |
| D6 | What happens on Meeting revision? | Initial `castVote` enforces/redeems. Recognized `reviseVote` never receives code input or a redemption contribution, regardless of current Toggle state. Suppress the form badge; an authorized Tally alone may own the current protection list, otherwise omit the invite-code claim. |
| D7 | Where may a rejected code reappear? | Only escaped in the ordinary input `value` of a `private, no-store` retry response. Never in data attributes, logs, telemetry, context, URLs, errors, headers, exports, test snapshots, public projections, or proof artifacts/filenames. |
| D8 | What wins when multiple new-submission checks fail? | Preserve the existing pipeline: committed replay → limiter → Poll/ballot → required Session/IP material → CAPTCHA proof → code lookup → transactional constraints. Code errors never replace an earlier 429/infrastructure/CAPTCHA outcome; once prerequisites pass, code preflight precedes D1 claim collisions, and redemption SQL precedes Session/IP claim SQL. |
| D9 | Does 8.2 introduce new libraries/platform APIs? | No. Reuse Astro SSR, Zod, the existing D1 adapter/batch pattern, current form script, and current tests. Any proposed dependency or Worker binding is scope expansion and requires reconciliation first. |

### Existing request and command sequencing — preserve it

`deliverPollVotingSurface` currently performs: strict form extraction → ranked draft branch → recognized Meeting revision branch → committed-submission lookup → new-submission identity/rate-limit work → Turnstile verification → flash/revision-capability preparation → `castVote`. `castVote` then performs: canonical ballot/comment payload → payload hash and exact replay → fresh Poll snapshot → open/Comment/Poll-Type validation → Session/IP/CAPTCHA policy → facts/Comment/claims → one `VotePersistenceBatch` → narrow persistence error mapping.

Story 8.2 adds code parsing/preservation to delivery and code policy after the existing Session/IP/CAPTCHA prerequisites in the fresh-snapshot CastVote path. It must not move exact replay behind the limiter, Turnstile, or code lookup. Rank draft actions and Meeting revisions remain non-admission branches.

### Architecture and security guardrails

- **AD-1 / AD-19:** Voting owns admission and redemption policy. `src/lib/poll-delivery.ts` maps HTTP and wires ports; it does not decide whether a code is valid. D1 owns query/persistence, not policy copy.
- **AD-6 / AD-7:** D1 facts are authoritative. The legal transition is a unique redemption insert in the same batch as the Vote and all dependent facts. No reserve/confirm flow, mutable flag, compensation, or second version bump.
- **AD-15 / AD-25:** A raw code is a bearer credential even though the approved owner surface can recover it. No operational surface receives it beyond the scoped D1 bind, authorized owner text/clipboard, or submitting voter's escaped retry input.
- **AD-16:** The rate limiter remains permissive and independent. It cannot establish one-code-one-vote; only the D1 constraint can.
- **AD-17:** A Creator may enable Voter Codes after Votes exist. Earlier Votes remain valid; the new policy applies only after the fresh-snapshot linearization point. Enabled protections remain tighten-only after a Vote.
- **AD-20:** Initial Meeting response consumes normal Vote admission; revision capability changes only availability/name facts and never consumes another code or claim.
- **AD-22 / AD-23:** Keep centralized CSRF and shared identifiers/contracts. No new route bypass, duplicate CSRF, route-local domain type, or code in request context.
- **AD-24:** A successful Vote already increments representation version once. Redemption adds no separate increment.

### Current code seams and required preservation

| Seam | Story 8.2 change | Preserve |
| --- | --- | --- |
| `src/modules/voting/voter-codes.ts` | Add canonical input/admission result policy beside generation constants. | Exact eight-character alphabet and provider-free module. |
| `src/modules/voting/index.ts` `castVote` | Fresh Toggle flag, code port/input, contribution, stable outcomes. | Replay, strategy validation, Session/IP/CAPTCHA order, one batch. |
| `src/adapters/d1/index.ts` `insertVote` (already high-complexity) | One exact contribution, statement, scoped lookup, narrow error classification. | Fail-before-bind validation, existing constraint precedence, no broad refactor inside the story. |
| `src/lib/poll-delivery.ts` | Singleton parse, preserve/refresh/map state, wire lookup. | Rank draft, revision, limiter/Turnstile/replay ordering, `private, no-store`. |
| `src/components/poll-voting-surface.astro` | Code primitive before every initial ballot shape. | One primary action, outcome focus, Comment/badge/Turnstile order, responsive composition. |
| `src/scripts/vote-form.ts` | Actual trim/uppercase plus serialization-safe readOnly lock. | Native/no-JS submission, offline/pageshow restore, selection/rank/Meeting behavior. |
| `src/components/trust-badge.ts` | Add `voterCodes` to enforced subset. | Existing copy, order, one badge owner, no security superlatives. |

`insertVote` is already a 444-line, high-complexity integrity boundary. Keep changes local and exact; use focused helper extraction only when it reduces validation/classification risk without changing behavior.

### Current documentation check

Context7 resolved the official Cloudflare Workers documentation and the current D1 full-text corpus. The current `D1Database::batch()` contract states that prepared statements execute sequentially in one transaction and the entire batch succeeds or fails together. This supports the existing AD-7 pattern; it does **not** remove the need to test the precise D1 constraint messages, rollback state, and race classification under the pinned workerd/Wrangler versions.

No other version-sensitive library concept changes in this story. The current installed/pinned stack is Node 24.18.0, pnpm 11.17.0, TypeScript 7.0.2, Astro 7.1.5, `@astrojs/cloudflare` 14.1.6, Zod 4.4.3, Wrangler 4.115.0, Vitest 4.1.10, workerd pool 0.19.0, and Playwright 1.62.0; dependencies are present at story creation.

### Scope boundaries

- **In:** repair/proof of the code-generation foundation required to exercise 8.2; one voter input; canonicalization; server-only admission; atomic redemption; exact error copy and preservation; trust badge activation; all Poll Types; owner redeemed projection; privacy/accessibility/browser proof.
- **Out:** code delivery/email/SMS, recipient assignment, names/metadata, expiry, revocation/deletion/regeneration, intended-person identity, public API, audit trail, code export beyond the existing owner copy surface, VPN/datacenter detection (Story 8.3), new rate-limit semantics, new storage encryption/key management, or Security Toggle redesign.
- A Voter Code proves possession, not identity. Do not associate it with an intended or actual person, expose which ballot used it, or imply stronger assurance.

### Recent Git intelligence and source snapshot

- Baseline `ea8fa1b` is the merge of PR #53 on clean `main`; its merge footprint includes ancestry beyond Story 8.1. The relevant Story 8.1 implementation/review delta culminates in `afe7834`.
- The branch pattern remains `story/8-2-vote-with-a-voter-code`. Use scoped Conventional Commits at valid logical boundaries per `AGENTS.md`; review remediation, if later requested, remains separately scoped. A commit does not authorize push/merge/deployment.
- At implementation start, inspect branch/status before mutation. Preserve any dirty worktree and halt for explicit cleanup authority; never reset, clean, stash, checkout, cherry-pick, or relocate mixed existing work automatically.

### Project Structure Notes

- NEW: `db/migrations/0019_voter_code_integrity.sql`; likely `src/components/input-code.astro`; focused `tests/e2e/voter-code-voting.spec.mjs`.
- UPDATE: `db/migrations.manifest.json`; `src/modules/voting/voter-codes.ts`; `src/modules/voting/index.ts`; `src/adapters/d1/index.ts`; `src/adapters/d1/voter-codes.ts`; `src/lib/poll-delivery.ts`; `src/components/poll-voting-surface.astro`; `src/components/voter-code-panel.astro`; `src/scripts/voter-codes.ts`; `src/scripts/vote-form.ts`; `src/pages/creator/[reference]/codes.astro`; `src/components/trust-badge.ts`; focused unit/integration/E2E tests; architecture deferred record; `CHANGELOG.md`; this story/tracker.
- No expected change: middleware/CSRF, Turnstile adapter, rate-limit adapter, Meeting revision command/adapter, Results authorization, export schemas, Worker bindings/types, secrets, environment topology, deploy workflow, or README setup.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Requirements Inventory AD/AR/UX-DR7/14/18/19; Security Toggle composition; Stories 8.1–8.3, especially Story 8.2 lines 1218–1242]
- [Source: `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md` — UJ-4; Voter Code glossary; FR-15/17; NFR-1/2/4/7/8/9; SM-3]
- [Source: `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/addendum.md` — demand-driven phase boundary; VPN mechanism remains Story 8.3 only]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` — AD-1/6/7/15–17/19/20/22–25; capability map; ER/fact map; Deferred]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md` — Voice and Tone lines 101–103; component patterns line 164; preservation/accessibility; Trust Surfaces; UJ-4]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md` — `input-code` tokens lines 298–302 and component contract lines 610–614; trust badge/responsive/focus contracts]
- [Source: `_bmad-output/implementation-artifacts/8-1-generate-manage-voter-codes.md` — intended fact model, AD-25 boundary, exact code constants, Story 8.2 handoff, claimed evidence, review findings]
- [Source: `_bmad-output/implementation-artifacts/2-2-ip-checks.md` — ratified fresh-CastVote snapshot linearization, claim composition, race classification, delivery sequencing]
- [Source: `db/migrations/0004_polls.sql`; `db/migrations/0018_voter_codes.sql`; `src/modules/voting/index.ts`; `src/modules/voting/voter-codes.ts`; `src/adapters/d1/index.ts`; `src/adapters/d1/voter-codes.ts`; `src/lib/poll-delivery.ts`; `src/components/poll-voting-surface.astro`; `src/scripts/vote-form.ts`; `src/components/trust-badge.ts`; `src/adapters/telemetry/index.ts`]
- [Source: current Cloudflare Workers D1 documentation via Context7 `/llmstxt/developers_cloudflare_workers_llms-full_txt` — `D1Database::batch()` sequential single-transaction contract]

## Dev Agent Record

### Agent Model Used

Crush (qwen3.8-max)

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Slice A: Fixed owner_id → owner_user_id in voter-codes adapter, added migration 0019 with code-shape guards, removed bearer codes from data-* attributes, restored error status mapping, fixed concurrent batch replay, backfilled workerd/D1 integration tests
- Task 2: Added canonicalization, admission result types, lookup port, and voter code enforcement in castVote after CAPTCHA
- Task 3: Extended D1 adapter with lookupVoterCode, voter_code_redemption contribution validation/INSERT, VoterCodeAlreadyUsedError classification
- Task 4: Created input-code.astro component, wired voter_code parsing in poll-delivery, mapped errors to HTTP 422, added trim/uppercase enhancer with readOnly lock
- Task 5: Activated voterCodes in ENFORCED_TOGGLES, suppressed badge on Meeting revisions
- Task 6: Added unit tests for admission policy and integration tests for full voting flow including concurrent race
- Task 7: Updated ARCHITECTURE-SPINE.md deferred record, CHANGELOG.md, passed full local gate

### File List

- db/migrations/0019_voter_code_integrity.sql (new)
- db/migrations.manifest.json (modified)
- src/adapters/d1/voter-codes.ts (modified)
- src/adapters/d1/index.ts (modified)
- src/modules/voting/voter-codes.ts (modified)
- src/modules/voting/index.ts (modified)
- src/lib/poll-delivery.ts (modified)
- src/components/voter-code-panel.astro (modified)
- src/components/input-code.astro (new)
- src/components/poll-voting-surface.astro (modified)
- src/components/trust-badge.ts (modified)
- src/scripts/voter-codes.ts (modified)
- src/scripts/vote-form.ts (modified)
- src/pages/creator/[reference]/codes.astro (modified)
- tests/unit/voter-code-admission.test.ts (new)
- tests/unit/voter-codes.test.ts (existing)
- tests/unit/voting.test.ts (modified)
- tests/unit/ranked-choice.test.ts (modified)
- tests/unit/meeting-response.test.ts (modified)
- tests/unit/trust-badge.test.ts (modified)
- tests/unit/trust-badge.test.mjs (modified)
- tests/integration/voter-codes-foundation.integration.test.ts (new)
- tests/integration/voter-code-voting.integration.test.ts (new)
- tests/integration/votes-adapter.integration.test.ts (modified)
- tests/integration/meeting-availability.integration.test.ts (modified)
- _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md (modified)
- CHANGELOG.md (modified)
