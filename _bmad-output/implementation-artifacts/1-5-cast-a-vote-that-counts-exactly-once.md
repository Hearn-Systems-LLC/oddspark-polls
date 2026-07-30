---
baseline_commit: a41016a83996705ff9b2b357801e7972e236dc3f
---

# Story 1.5: Cast a Vote That Counts Exactly Once

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Voter,
I want to open a Poll link, pick an option, and submit — once,
so that my vote counts and nobody's duplicate attempt (including mine) changes the Tally.

## Acceptance Criteria

1. **Given** a Voter opening `/{link}` on a phone, **When** the page loads, **Then** the question and options render server-side with no client framework payload (NFR-5), each option a 48px `poll-option` row — a visually-hidden native radio with the row as its label and the `·`/`◆` marker decorative (UX-DR2) — and the vote button disabled with a label-caps hint until a selection exists (UX-DR8).
2. **Given** a selected option and an idle Poll, **When** the Voter submits, **Then** the server commits the Vote, its selection, the session duplicate claim, and the `representation_version` increment in one constrained D1 batch (AD-7), **And** the confirmation renders "Counted." with the post-submit focus contract (outcome line focused, `<title>` leading with the outcome).
3. **Given** a submission with zero selections (or a forged multi-selection on a single-select Poll), **When** it reaches the server, **Then** it is rejected server-side regardless of client hints (FR-6), with the ballot preserved.
4. **Given** the same browser attempting a second Vote, **When** it submits, **Then** the session claim's unique constraint rejects it, the Voter sees "You've already voted here. Enthusiasm noted; the Tally is unchanged.", the Poll stays readable with options rendered read-only, and the Tally is unchanged (FR-16 session path).
5. **Given** a browser retry replaying the same `submission_id` with an identical payload, **When** it arrives, **Then** the stored outcome is returned without re-validation; a reused `submission_id` with a different payload returns `IDEMPOTENCY_CONFLICT` (AD-7).
6. **Given** any accepted or rejected Vote, **When** duplicate identities are persisted, **Then** only secret-keyed HMAC digests scoped to (Poll, check kind) are stored — never raw session tokens or IPs — with keys in Worker secrets, and no digest appears in logs or projections (AD-8/AR-6), **And** the first-party browser token is issued as a cookie on voting-page render; a submission arriving without one on a Session-Checks Poll is rejected with the retry idiom and the ballot preserved — never accepted unclaimed.
7. **Given** a Poll whose Deadline has passed (or that was closed), **When** a Vote is submitted, **Then** the D1 trigger aborts the insert because effective state is closed at transaction time (AD-11), and the Voter sees "This Poll closed while you were deciding — {when}. Your Vote wasn't recorded."
8. **Given** a Poll deleted while a Vote is in flight, **When** the transaction runs, **Then** foreign keys abort the entire batch — no partial Vote facts survive — and the Voter lands on the plain 404, because the Poll no longer exists (AD-7).
9. **Given** vote submissions arriving from one client at abusive rates, **When** the baseline rate-limit bindings engage, **Then** submissions are throttled per client without any human Voter ever encountering the limit (NFR-7, AR-13).

## Tasks / Subtasks

- [x] Task 1: Migration `db/migrations/0006_votes.sql` — vote schema + closed-poll trigger (AC: #2, #4, #5, #7, #8)
  - [x] Tables (snake_case, `*_ms` UTC Unix-millisecond INTEGERs, `ON DELETE CASCADE` child FKs, index naming `<table>_<cols>_idx` — the 0004 conventions):
    - `vote`: `id TEXT PK`, `poll_id` FK→`poll` CASCADE, `submission_id TEXT NOT NULL`, `payload_hash TEXT NOT NULL` (normalized-payload hash, AD-7 §6), `created_at_ms`. `CREATE UNIQUE INDEX vote_poll_id_submission_id_idx ON vote(poll_id, submission_id)` — the idempotency key. Plus `vote_poll_id_idx` for the 1.8 projections.
    - `vote_selection`: `vote_id` FK→`vote` CASCADE, `poll_option_id` FK→`poll_option` CASCADE, `PRIMARY KEY (vote_id, poll_option_id)` `[ASSUMPTION: composite PK; a single-select story writes one row per vote, but the shape must hold for 1.7 multi-select without another migration]`
    - `voter_claim`: `poll_id` FK→`poll` CASCADE, `check_kind TEXT NOT NULL` (`'session'` now; `'ip'` arrives Epic 2 with zero schema change), `digest TEXT NOT NULL`, `vote_id` FK→`vote` CASCADE, `created_at_ms`, `PRIMARY KEY (poll_id, check_kind, digest)` — THE exactly-once constraint (AD-7/AD-8; only D1 constraints decide, AD-16)
  - [x] Trigger `vote_poll_open_guard BEFORE INSERT ON vote`: `RAISE(ABORT, 'poll_closed')` when the target poll's `closed_at_ms IS NOT NULL OR (deadline_ms IS NOT NULL AND deadline_ms <= <now-ms>)` — now from SQLite (`CAST(unixepoch('subsec') * 1000 AS INTEGER)` `[ASSUMPTION: exact now-expression is the dev's to verify against workerd D1; the requirement is millisecond effective-state check inside the transaction]`). This trigger — not an application pre-check — is the correctness boundary: a zero-row conditional UPDATE *succeeds* and would NOT roll back a `batch()` (review-current-tech H2), and close/delete vs. vote must linearize inside one atomic mutation (review-adversarial C-1)
  - [x] NO `voter_code_redemptions` or `comment` tables — see the decisions table below. NO change to `poll` (`representation_version` and `session_checks_enabled` already exist in 0004)
  - [x] `pnpm migrations:checksum` to refresh the manifest; `pnpm migrations:guard` green. Migrations are forward-only and immutable once committed (AD-14) — get the schema right in review before merge
- [x] Task 2: Fill the Poll Type contract slots for multiple choice (AC: #3)
  - [x] `src/modules/polls/types/multiple-choice.ts`: implement `validateSubmission` (selected option IDs vs. persisted options + single/multi mode — exactly one selection for `multiple_choice` v1; unknown option ID, zero, or >1 selections are rejections) and `persistFacts` (validated selection → vote-selection rows), typed via the existing `PollTypeStrategy` generics
  - [x] These fill the OPTIONAL members already declared in `src/shared/application/index.ts:66-72` — the frozen shapes match `docs/design/poll-type-contract-check.md:51-53` exactly, so NO `POLL_TYPE_CONTRACT_VERSION` bump; still update the compile-time consumer test `tests/unit/shared-kernel.test.ts` per that doc's rule
- [x] Task 3: `CastVote` command in `src/modules/voting/index.ts` (AC: #2–#8)
  - [x] Replace the `export {}` placeholder. Provider-free (AD-1): no Astro, no Cloudflare, no adapter imports. The command is the sole cross-module transaction coordinator (AD-19): it composes ports — poll read, Poll Type strategy (`validateSubmission`/`persistFacts`), digest port, persistence port — and owns the AD-7 ordering:
    1. Normalize the ballot (sorted selected option IDs + poll ID `[ASSUMPTION: normalization = canonical JSON of sorted selection]`), compute `payload_hash` (SHA-256 hex via `crypto.subtle` passed in as a dep, or a pure sync hash injected — keep the module provider-free)
    2. Check `submission_id` first: an exact committed replay (hash matches) returns the stored outcome WITHOUT re-validation; hash mismatch → stable code `idempotency_conflict` (AC #5). The replay check happens both as a pre-read AND as the unique-constraint catch (two concurrent first-submissions race — the loser re-reads and adjudicates by hash), mirroring the 1.3/1.4 `DuplicatePollIdError` re-read pattern
    3. Effective-state pre-check via the existing `effectivePollStatus` (`src/shared/domain/index.ts:40`) for the friendly closed message — but the TRIGGER is the enforcement (AD-11); treat the pre-check as UX only
    4. Session Checks (on by default, FR-15): require the browser-token digest; a missing token on a `session_checks_enabled` poll → stable code `session_token_missing`, retry-idiom copy, ballot preserved — never accepted unclaimed (AC #6)
    5. Persist in ONE batch: vote row + selection rows + `voter_claim ('session', digest)` + `representation_version` increment
  - [x] `representation_version` increment goes through ONE shared-kernel helper called by every future command (epic de-risk rule; consumed by 1.9): add it to `src/shared/application/index.ts` (or a sibling shared-kernel file) as the provider-free contract the adapter maps to `UPDATE poll SET representation_version = representation_version + 1, updated_at_ms = ?` `[ASSUMPTION: helper shape — a typed statement descriptor the adapter renders; exact form is the dev's, the rule is "never hand-rolled per command"]`
  - [x] Error mapping (stable codes, never SQL detail): `voter_claim` PK collision → `already_voted` (AC #4 copy); trigger abort → `poll_closed` (AC #7 copy with `{when}`); FK failure (poll vanished mid-flight) → `poll_deleted` → the page 404s (AC #8); vote unique-index collision → the idempotency re-read (step 2); anything else → generic `vote_failed` with the retry idiom
  - [x] `VOTE_COPY` catalog (verbatim strings — see UX contract table below); reason codes distinct from copy (`reasonCodes` convention from `ApplicationError`)
  - [x] Extend the AD-7 batch assembly so contribution ports can add statements (the Comment port slot, Story 4.1; code-redemption slot, Epic 8) — an ordered-statements array the strategy/security/comment contributors append to, not hardcoded five statements `[ASSUMPTION: the "complete transaction shape" epic mandate is satisfied by the extensible assembly + claim schema, not by dead tables — see decisions]`
- [x] Task 4: Digest adapter + first-party browser token (AC: #6)
  - [x] New Worker secret `VOTE_DIGEST_SECRET` `[ASSUMPTION: name unspecified]`: add to `.dev.vars.example`, `scripts/provision-auth-secrets.zsh` (same flow as `BETTER_AUTH_SECRET`), and the README secret docs. NO fallback value — a missing secret fails vote submission loudly, never silently unkeyed
  - [x] Digest adapter (`src/adapters/digest/index.ts` NEW `[ASSUMPTION: location — sibling of d1/telemetry adapters]`): HMAC-SHA256 via WebCrypto, message scoped to `(pollId, checkKind, token)` so one browser token yields uncorrelatable digests across polls and check kinds (AD-8/AR-6). Digests NEVER appear in logs, telemetry, projections, or error messages (AD-15)
  - [x] Browser token: random 128-bit value issued as a cookie on voting-page GET render when absent — `oddspark.voter` `[ASSUMPTION: name]`, `HttpOnly; SameSite=Lax; Path=/; Max-Age=` 1 year `[ASSUMPTION: duration]`, `Secure` on https (match the middleware's marker-cookie pattern `src/middleware.ts:54-64`). Raw token lives only in the cookie; only its digest is ever persisted
- [x] Task 5: Vote persistence in the D1 adapter (AC: #2, #4, #5, #7, #8)
  - [x] Extend `src/adapters/d1/index.ts` (or NEW sibling `src/adapters/d1/votes.ts` if `index.ts` gets crowded): `insertVote(batch rows)` as one `db.batch()`; `findVoteBySubmission(pollId, submissionId)` returning stored outcome + `payload_hash`; `findClaim(pollId, checkKind, digest)` for the GET-render already-voted state
  - [x] Constraint-failure mapping by message match, the established 1.3/1.4 pattern (`src/adapters/d1/index.ts:121-140`): `UNIQUE constraint failed: voter_claim.` → typed `AlreadyVotedError`; `UNIQUE constraint failed: vote.poll_id, vote.submission_id`-shape → typed `SubmissionReplayError`; trigger's `poll_closed` abort message → typed `PollClosedError`; `FOREIGN KEY constraint failed` → typed `PollGoneError`. Typed error classes live in the voting module (domain-owned, like `ReferenceTakenError`)
  - [x] Batch statement order matters for error precedence `[ASSUMPTION: vote insert first so trigger/idempotency fire before claim collision on a mixed replay]` — pin the precedence with integration tests
- [x] Task 6: Voting page — form, POST handling, states (AC: #1, #2, #3, #4, #6, #7)
  - [x] `src/pages/[reference].astro` GET: replace the "Voting opens in a coming release" note and the hand-rolled option rows with the REAL vote form built on the `poll-option` primitive (`src/components/poll-option.astro` — visually-hidden native radio, row as label, decorative marker; this reuse is a ratified decision, Justin 2026-07-29, recorded in deferred-work.md). Vertical order: question → option rows → vote button (comment composer/Turnstile/trust badge are later stories). Issue the browser-token cookie when absent. Mint a `submission_id` UUID into a hidden field per render (the `poll_id` nonce precedent, `src/pages/creator/new.astro:76`)
  - [x] Closed poll on GET (`effectivePollStatus` — the page finally calls it; closes the 1.3 deferred item): options read-only with NO markers, NO vote button, "This Poll closed {when}." `[ASSUMPTION: {when} renders as an absolute UTC-labelled datetime server-side; local-time display and countdown are 1.6]`
  - [x] Already-voted on GET (browser token's session claim exists): options read-only, rejection line replaces the vote button, Poll stays readable — never a blank page
  - [x] POST on the same route (drop GET/HEAD-only 405 guard for this one route; keep 405 for other methods): parse via Zod over `formData` coercing non-strings to `""` (the `new.astro:63-121` pattern); middleware already gives the anonymous origin/Fetch-Metadata CSRF check free (`requireSessionToken` stays false — vote POSTs are not creator-surface); run `CastVote`
  - [x] Outcomes: success → 303 to `/{reference}` with a one-time confirmation signal `[ASSUMPTION: short-lived HttpOnly flash cookie consumed on the next GET — keeps the URL canonical and PRG-safe; a refresh after consumption shows the already-voted state]`; validation/claim/closed failures → 422 re-render on the same route with the ballot preserved exactly (selection re-checked) and the message above the vote button; `poll_deleted` → plain 404; replayed identical submission → the same 303/confirmation as the stored outcome
  - [x] Confirmation render ("Counted." + visibility-dependent second sentence — copy table below): outcome line is a `tabindex="-1"` element, FIRST content in the main landmark, focused on load (the existing 404 heading pattern in this file); `<title>` leads with the outcome: `Counted — {question}`, `Already voted — {question}` (UX-DR17 post-submit contract — an `aria-live` region does NOT satisfy this). Confirmation/rejection responses set `cache-control: private, no-store` (AR-17/AD-21)
  - [x] Vote button = `button-primary` idiom (gold fill, `{typography.button}`, 48px, zero radius — the STRIKE button verbatim); disabled state uses `dim` (never `faint`) with a label-caps hint above it saying what unlocks it; enabled-on-selection via a small `src/scripts/` vanilla enhancement `[ASSUMPTION: with JS off the button renders enabled — server-side AC #3 rejection is the no-JS floor (AD-2); the disabled-until-selection affordance is progressive enhancement]`. `COUNTING…`/in-flight lock is Story 1.6 — do NOT build it here
  - [x] Multi-sentence rejection/explanation copy renders at `body-lg` (16px), not `body` (a11y ruling); rejection headings use `alarm` tokens (a duplicate rejection is the product working, not an error — never loud); every state keeps 48px tap targets, no gesture, no toast, no spinner, no confirm dialog
- [x] Task 7: Baseline rate limiting (AC: #9)
  - [x] `wrangler.jsonc` currently has NO rate-limit binding — the epic assumed it landed with the foundation; it didn't. Add the Workers Rate Limiting binding (`unsafe.bindings` type `ratelimit`) per environment `[ASSUMPTION: generous limit, e.g. 30 vote POSTs / 60s per client key — "no human Voter ever encounters it"]`, keyed per client `[ASSUMPTION: CF-Connecting-IP as the limiter key — this is an ephemeral throttle key, NOT a stored identity; AD-8's no-raw-IP rule governs persistence, and the binding stores nothing]`
  - [x] Applied in the vote POST path BEFORE any mutation; 429 → rate-limited state: selection preserved, vote button disabled, the rate-limited copy. Best-effort/permissive ONLY (AD-16) — never an integrity control; a limiter outage must not block voting `[ASSUMPTION: fail-open on binding errors]`
  - [x] Verify local dev + `@cloudflare/vitest-pool-workers` tolerate the unsafe binding; if the test pool can't provide it, inject a no-op limiter port in tests and cover the 429 path at unit level `[ASSUMPTION]`
- [x] Task 8: Telemetry + logging discipline (AC: #6)
  - [x] One structured completion record per vote operation with request ID + internal poll ID (AD-15) — the existing middleware telemetry already emits per-request; add the vote-specific fields only if the existing record shape demands it. NEVER log tokens, digests, ballot selections, or copy bodies
- [x] Task 9: Tests + gates (AC: all)
  - [x] Unit (`tests/unit/voting.test.ts` NEW, extend `polls.test.ts`/`shared-kernel.test.ts`): `validateSubmission` matrix (valid single, zero, multi, unknown option ID, duplicate option ID); normalization/hash stability (property test with fast-check: hash invariant under selection-order permutation); idempotency adjudication (same hash → stored outcome, different → conflict); digest scoping (same token, different poll/kind → different digests; no raw token in output); copy catalog exactness; `effectivePollStatus` boundary reuse (deadline == now is closed)
  - [x] Integration (`tests/integration/votes-schema.integration.test.ts`, `votes-adapter.integration.test.ts` NEW — model on `polls-schema`/`polls-adapter`): schema constraints (claim PK, submission unique index, FKs); trigger aborts insert on `closed_at_ms` set AND on past deadline, whole batch rolls back (zero vote/selection/claim rows, `representation_version` unchanged); happy-path batch commits all rows + increments version by exactly 1; second vote same digest → `AlreadyVotedError`, tally row-count unchanged; identical replay → stored outcome, NO new rows, version NOT re-incremented; divergent replay → conflict; poll deleted between read and batch → `PollGoneError`, no partial rows. Harness rules from 1.3/1.4: idempotent seeds (`INSERT OR IGNORE`), per-file cleanup, D1 state persists across tests within a file
  - [x] E2E (`tests/e2e/vote.spec.mjs` NEW): create a poll via the seeded-session harness (`tests/e2e/creator-session.mjs` — proven in 1.4), then vote signed-out in a fresh context: radio rows selectable by row-click, submit → "Counted." with focus on the outcome line and `<title>` leading with it; reload → already-voted read-only state; second submit attempt (fresh page, same cookies) → already-voted copy; cleared cookies + vote on a session-checks poll without token → server re-render with retry idiom (token cookie present on first GET, so simulate by deleting it before POST); closed poll (seed with past deadline) → no vote button. Note the 1.4 harness caveats: `cleanupCreator` in `afterAll`, CI-retry re-submission hazard
  - [x] Gates in order: `pnpm migrations:guard` → full Vitest → `pnpm check` → Playwright → `pnpm types` → production build — all green before story-done

## Dev Notes

### Decisions resolved at story-creation time (all `[ASSUMPTION]`-marked — flag to Justin if any feel wrong)

| Gap (unspecified or conflicting in sources) | Decision | Rationale |
| --- | --- | --- |
| Epic note says 1.5 ships "the duplicate-claim and code-redemption schema" and "the Comment contribution port" | **Ship `voter_claim` physically; ship code-redemption and Comment as batch-assembly SLOTS (extensible ordered-statements contract), not tables** | `voter_code_redemptions` FKs a `voter_code` table Epic 8 owns; `comment` belongs to 4.1 — dead tables now mean guessing their shape without their stories' context, and migrations are immutable (AD-14). What must never be reshaped is the transaction (one batch, constraint-decided, contribution ports) — that lands complete |
| Where the stored idempotency outcome lives | **The committed `vote` row + its `payload_hash` IS the stored outcome** (unique `(poll_id, submission_id)`) | AD-7 §6 stores "normalized payload hash and the accepted outcome"; a separate outcomes table duplicates the vote row. Rejected submissions store nothing — idempotency covers committed outcomes only |
| PRG mechanism for the "Counted." confirmation | **303 to `/{reference}` + one-time flash cookie; the GET consumes it** | Post-submit state is the same route (EXPERIENCE IA); a query param would mint a second shareable URL variant against FR-28's one-canonical-URL rule |
| Disabled-until-selection vs. no-JS (AD-2) | **Server renders the button enabled; a small script disables it until selection** | AD-2 forbids requiring JS to vote; AC #3's server-side rejection is the real gate. UX-DR8's hint + disabled state is affordance, and EXPERIENCE explicitly budgets "selection state" JS |
| Zero-selection rejection copy | **"Nothing's selected. Pick an option, then vote."** `[ASSUMPTION: new line]` | No line exists in EXPERIENCE for it; flat, layout-neutral, no exclamation, names the fix |
| `{when}` rendering in closed copy | **Absolute server-rendered datetime, UTC-labelled** | Local-time display/countdown is 1.6's deadline work; a wrong guessed timezone is worse than an honest UTC |
| Browser-token cookie name/duration | `oddspark.voter`, 1 year, HttpOnly/SameSite=Lax/Path=// Secure-on-https | Matches the middleware marker-cookie idiom; long-lived because the claim, not the cookie, is the enforcement |
| Digest secret name | `VOTE_DIGEST_SECRET` | Parallel to `BETTER_AUTH_SECRET`; provisioning script extends, not forks |
| Rate-limiter key | Per-connecting-IP via the binding, ephemeral only | AD-8 bans STORED raw IPs; the Rate Limiting binding persists nothing and AR-13 wants a per-client throttle. Epic 2's IP Checks (stored digests) are unrelated to this key |
| Signed-in Creator voting on their own poll | **No special-casing — a Creator's browser votes like any other** | No FR restricts it; session claims are per-browser-token, not per-account |

### Scope boundaries — build none of these

- **`COUNTING…` in-flight lock, failure-state re-enable, offline handling, deadline countdown/local display** → Story 1.6 (the states exist in EXPERIENCE; 1.5 ships only the retry-idiom copy on its own 422s)
- **Multi-select bounds, checkbox rows, `{n} VOTERS · {m} SELECTIONS`** → 1.7 (1.5 rejects forged multi-selection on single-select, nothing more)
- **Tally rendering, results-bar, `YOUR BALLOT` line, visibility-gated projections, `/{link}/results`** → 1.8 (the "Counted." confirmation renders NO counts — not even for Live visibility; the second sentence just names where results stand)
- **Live updates / version polling endpoint** → 1.9 (1.5 only increments `representation_version` via the shared helper)
- **IP Checks, CAPTCHA/Turnstile, security-toggle UI, trust badge, tighten-only locking, IP-rejection copy** → Epic 2 ("Epics 2 and 3 extend policy and surface; they never reshape this transaction")
- **Comment composer + comment/name fields** → 4.1 (the batch slot exists; the UI does not)
- **Voter Codes, VPN blocking** → Epic 8
- **Share action on the voting surface** → 1.13
- **Vote-arrival motion/spark** → 1.10 (nothing on the voting form animates, ever)

### The architecture rule that shapes this story

AD-7: normalize → check `submission_id` first (exact replay returns the stored outcome; divergent replay is a stable conflict) → commit Vote + selections + duplicate claims + `representation_version` in ONE `db.batch()` guarded by unique constraints and the closed-poll trigger. Two hard sub-rules: (a) `batch()` only rolls back when a statement FAILS — a zero-row conditional UPDATE succeeds, so enforcement must live in SQLite (unique constraints, `RAISE(ABORT)` trigger), never in post-hoc `changes` inspection (review-current-tech H2); (b) closure/deletion vs. acceptance must be ordered by the D1 guard inside the same atomic mutation — an application-level open-check is UX, not correctness (review-adversarial C-1). [Source: ARCHITECTURE-SPINE.md#AD-7, reviews/review-current-tech.md#H2, reviews/review-adversarial.md#C-1]

### Architecture constraints that bind this story

- **AD-8/AR-6:** anonymous voters; duplicate identity = random first-party browser token → secret-keyed HMAC digest scoped to (Poll, check kind); keys in Worker secrets; digests never in projections, exports, telemetry, or logs (AD-15). A submission without the token on a Session-Checks poll is rejected, never accepted unclaimed.
- **AD-11:** effective open/closed is derived at request/transaction time — never stored, no scheduler. `effectivePollStatus` already exists (`src/shared/domain/index.ts:40`); the trigger re-derives it in SQL.
- **AD-16:** Rate Limiting is permissive/best-effort, never integrity; only D1 constraints decide duplicates.
- **AD-19:** Voting module owns votes/selections/claims/redemptions; `CastVote` is the sole cross-module transaction coordinator; only Voting-module commands write these tables.
- **AD-24:** every representation-changing mutation increments `representation_version` in the same transaction, through the one shared-kernel helper.
- **AD-6:** accepted Vote facts are immutable. **AD-17:** the first accepted Vote locks question/options/type (enforcement lands with 1.12's edit path — nothing to build here, but don't design against it).
- **AD-1/AD-2:** provider-free domain; server-rendered HTML; the whole flow works with JavaScript off. **AD-22:** the central CSRF middleware covers the anonymous vote POST via origin/Fetch-Metadata only — `requireSessionToken` remains creator-surface-only; no route bypasses the middleware.
- **Consistency Conventions:** POST → 303; failure → 422 same-route re-render with preserved values; stable codes + safe messages, never SQL detail; kebab-case files, snake_case SQL; commands are imperative verbs.

### Existing code — read before touching (current state → change → preserve)

| File | Today | This story | Must not break |
| --- | --- | --- | --- |
| `src/pages/[reference].astro` | GET/HEAD only (405 else); reserved-check → exact lookup → case-variant 301 fallback; hand-rolled read-only option rows; "Voting opens in a coming release" | Accept POST; real vote form on `poll-option`; token cookie issue; closed/voted/confirmation states; keep 404 heading focus pattern | The reserved-slug check order, the case-variant 301 chain (incl. `no-store`), the 404 rendering, `x-request-id` via middleware |
| `src/modules/voting/index.ts` | `export {}` placeholder | The entire `CastVote` command + copy + typed errors | — |
| `src/modules/polls/types/multiple-choice.ts` | `create` only | Add `validateSubmission` + `persistFacts` | `create`'s exact behavior (1.3 tests pin it) |
| `src/shared/application/index.ts` | `PollTypeStrategy` with optional 1.5 slots; `ApplicationError`/`Result` | Consume the slots; add the `representation_version` helper | Contract version 1 — no bump (shapes match the design check); update `shared-kernel.test.ts` |
| `src/adapters/d1/index.ts` | `createPollPersistence` (insert/find/owner/case-variant) | Add vote persistence + typed constraint mapping | All four existing methods byte-for-byte; the error-precedence catch order |
| `src/components/poll-option.astro` | Radio/checkbox row primitive, used by the create form's visibility chooser | Consume for votable rows (radio, no description) | The create-form consumer |
| `src/middleware.ts` | CSRF origin check on ALL unsafe methods; session token only for creator/admin paths | Nothing `[expected: zero changes — verify the vote POST passes with requireSessionToken=false]` | Everything — 1.2/1.3 pinned it hard |
| `db/migrations/0004_polls.sql` | `poll.session_checks_enabled` default 1, `representation_version` default 1 | Nothing — 0006 is additive | Immutable (AD-14) |
| `src/pages/creator/new.astro` | The Zod-formData / nonce / 303-vs-422 patterns | Nothing — pattern source only | — |

### UX contract — exact copy and behavior

Verbatim strings (EXPERIENCE.md#Voice and Tone). `{when}`/`{deadline}` are render-time placeholders. Voice: flat, wry, no exclamation, no emoji, never at the Voter's expense; duplicate blocking is the product working, not an error.

| Moment | Copy |
| --- | --- |
| Counted, Live visibility | **Counted.** Results are live, updating as they arrive. |
| Counted, After Close | **Counted.** Results open when the Poll closes — {deadline, local}. You'll find out when everyone else does. |
| Counted, Creator-Only | **Counted.** These results go to the Creator only. |
| Already voted (session) | **You've already voted here.** Enthusiasm noted; the Tally is unchanged. |
| Submitted after close | **This Poll closed while you were deciding** — {when}. Your Vote wasn't recorded. |
| Closed poll on GET | **This Poll closed {when}.** |
| Submission failed / retry idiom (also missing-token, idempotency-conflict) | **That didn't land.** The Vote wasn't recorded and your ballot is still here, exactly as you left it. Try again — and if it keeps failing, the Poll will still be here in a minute. |
| Rate-limited | **Too many Votes from here, too quickly.** Give it a minute. If you're a person, this shouldn't have happened, and we're sorry it did. |
| Zero selections `[ASSUMPTION: new line]` | **Nothing's selected.** Pick an option, then vote. |

Behavior invariants: whole row is the tap target edge-to-edge, 48px minimum; selection never submits — the Vote is a separate deliberate action; arrow keys move within the radio group, `Space` selects, `Enter` on the button submits; selected state is `◆` + gold ink (never color alone); focus outline `2px focus-ring` offset 2px, never removed, never `solar-*`; failure messages sit above the vote button; the rejection replaces the vote button while options stay readable read-only; After-Close confirmation leaks NOTHING about counts; multi-sentence blocks at `body-lg`; rejection headings in `alarm` tokens (calm, not loud); no interstitial between opening the link and reading the question; no toast, spinner, carousel, gesture, or are-you-sure on vote. [Source: EXPERIENCE.md#State Patterns, #Accessibility Floor, #Interaction; DESIGN.md#Components → poll-option/button-primary, #Do's and Don'ts]

Post-submit focus + announcement contract (highest-severity a11y ruling): EVERY post-submit render — Counted, already-voted, closed, rate-limited, failed — focuses a `tabindex="-1"` outcome line that is the first content in the main landmark, and `<title>` leads with the outcome (`Counted — {question}`). An `aria-live` region does not satisfy this — it's a new document, not a region change. [Source: EXPERIENCE.md#Accessibility Floor; review-accessibility.md]

### Previous story intelligence (1.3/1.4 records)

- The D1 constraint-error mapping pattern (message-regex → typed domain error → command maps to stable code once) is proven twice (`DuplicatePollIdError`, `ReferenceTakenError`) and its brittleness is an ACCEPTED deferred item — reuse it verbatim for the three new vote errors, don't invent a new mechanism.
- The concurrent-collision re-read pattern (constraint fires → re-read → adjudicate identical-vs-divergent by comparing content) is exactly the AD-7 idempotency shape — `createPoll`'s D4 dedupe (`src/modules/polls/index.ts:670-700`) is the template, including the "lookup failed → honest unconfirmable copy" branch.
- Batch atomicity has a forced-failure integration test precedent (1.3) — replicate for the vote batch (trigger abort AND FK abort both leave zero rows).
- 1.4's review burned five rounds on the public-route redirect chain — `[reference].astro` is now sensitive: the reserved → exact → case-variant-301 order and its `no-store` headers are review-hardened; slot the POST handling and state rendering in WITHOUT reordering that chain.
- E2E: the seeded-session harness (`creator-session.mjs`) can create real polls; voting itself needs no auth. Known caveats: `cleanupCreator` runs in `afterAll` (CI retry re-submits and can collide), authed specs `test.skip` without `BETTER_AUTH_SECRET` locally but run unconditionally in the deploy gate.
- Integration harness: real workerd + local D1, migrations injected via `TEST_MIGRATIONS` (`readD1Migrations`) — the new 0006 file is picked up automatically; seeds idempotent, cleanup per file; cascades fire without pragmas.
- Env access via `env` from `cloudflare:workers`; canonical URLs render from request origin — never hardcode the domain.
- `pnpm types` may show a pre-existing generated-file delta from local binding discovery; adding the rate-limit binding SHOULD change generated types — commit that delta deliberately this time.
- Review lesson (1.2, reaffirmed 1.4): map provider errors to stable codes once, in the command's single envelope — never in the page.

### Project Structure Notes

- New files: `db/migrations/0006_votes.sql`, `src/adapters/digest/index.ts`, `src/scripts/vote-form.ts` (selection-state enhancement only), `tests/unit/voting.test.ts`, `tests/integration/votes-schema.integration.test.ts`, `tests/integration/votes-adapter.integration.test.ts`, `tests/e2e/vote.spec.mjs`
- Updated: `src/modules/voting/index.ts`, `src/modules/polls/types/multiple-choice.ts`, `src/shared/application/index.ts`, `src/adapters/d1/index.ts` (or sibling), `src/pages/[reference].astro`, `wrangler.jsonc`, `.dev.vars.example`, `scripts/provision-auth-secrets.zsh`, `tests/unit/shared-kernel.test.ts`, `db/migrations.manifest.json` (via checksum script), README secret docs
- Kebab-case files, snake_case SQL, `*.integration.test.ts` naming is mandatory, unit tests stay out of the workerd pool
- Latest-tech check: no new libraries — WebCrypto HMAC, SQLite triggers, and the Workers Rate Limiting binding are all on the pinned stack (TS 7.0.2, Astro 7.1.5, Zod 4.4.3, Wrangler 4.115.0, Vitest 4.1.10, compatibility date 2026-07-29). The Rate Limiting binding is the only platform surface new to this repo — verify its current `wrangler.jsonc` syntax against Cloudflare docs at dev time; it has been GA but its config shape has shifted across Wrangler majors

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5] (lines 330–374) — story statement + 9 ACs; #Epic 1 Implementation notes (line ~157) — complete-transaction-from-day-one mandate, shared version helper, Session-Checks default
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md#AD-7] (L120–157) — the transaction; #AD-8 (L159–167) digests; #AD-11 effective state; #AD-15 logging; #AD-16 admission vs. integrity; #AD-19 ownership; #AD-24 representation version; ER diagram (L460–475) — VOTE/VOTER_CLAIM/VOTE_SELECTION/COMMENT; conventions table (L372–380)
- [Source: .../architecture/.../reviews/review-current-tech.md#H2] (L59–80) — batch rollback semantics, `RAISE(ABORT)`; [Source: reviews/review-adversarial.md#H-6] (L265–281) — idempotency semantics; #C-1 (L130–146) — close/delete linearization
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md#4.2 FR-6] single-select; #4.6 FR-15 (Session-Checks-on default), FR-16 (session path); #4.1 FR-4 (post-close rejection), FR-5 (delete → 404); #5 NFRs — voter privacy, race-free concurrency ("never more accepted Votes than the rules allow"), baseline abuse floor, no heavy client payload
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md#Voice and Tone] (L64–130) — all copy verbatim; #State Patterns (L172–216) — every voting-page state; #Accessibility Floor (L244–265) — post-submit focus/title contract, native radio semantics; #Interaction (L219–226) — 48px targets, bans
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md#Components → poll-option] (L534–546), #button-primary (L601–605) — visuals/states/tokens; #Do's and Don'ts (L669–698); mockups/key-voting.html (evidence, not spec — spines win)
- [Source: docs/design/poll-type-contract-check.md] (L32–53) — contract-change rule + the pre-specified 1.5 shapes for multiple choice
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — closed-state rendering deferred INTO 1.5 (1.3 review); poll-option-primitive reuse ratified (1.3 review); constraint-error message matching accepted (1.4)
- [Source: _bmad-output/implementation-artifacts/1-4-custom-links.md#Dev Agent Record] — harness realities, gate order, `[reference].astro` review history

## Dev Agent Record

### Agent Model Used

OpenAI Codex (GPT-5)

### Implementation Plan

- Implement each story task in order with red-green-refactor tests, preserving the provider-free domain boundary and the review-hardened public-route lookup order.
- Keep exactly-once correctness in D1 constraints and one atomic batch; application pre-checks exist only for useful voter-facing outcomes.
- Finish with the repository's full deploy-gate command sequence and browser-observable proof for the voting surface.

### Debug Log References

- 2026-07-30: Task 1 RED — `votes-schema.integration.test.ts` failed with six missing-table assertions before migration 0006.
- 2026-07-30: Task 1 GREEN — focused schema tests passed (6/6), migration guard passed (6 files), and full Vitest passed (244/244).
- 2026-07-30: Task 2 RED — six multiple-choice submission and fact-contribution tests failed while the optional strategy ports were absent.
- 2026-07-30: Task 2 GREEN — focused unit tests passed (134/134), TypeScript passed, and full Vitest passed (250/250).
- 2026-07-30: Task 3 RED — the new voting unit suite failed at import because the command, domain errors, and copy catalog did not exist.
- 2026-07-30: Task 3 GREEN — focused voting/poll/shared tests passed (150/150), TypeScript passed, and full Vitest passed (266/266).
- 2026-07-30: Task 4 RED — digest/cookie tests failed on the absent adapter and provisioning tests proved the digest secret was not initialized or preserved.
- 2026-07-30: Task 4 GREEN — digest and provisioning tests passed (13/13), TypeScript passed, and full Vitest passed (273/273).
- 2026-07-30: Task 5 RED — all seven real-D1 adapter tests failed while `createVotePersistence` was absent.
- 2026-07-30: Task 5 GREEN — focused workerd adapter tests passed (7/7), TypeScript passed, and full Vitest passed (280/280).
- 2026-07-30: Task 6 RED — the voting E2E suite found the placeholder page had no selectable ballot, submission behavior, or outcome states.
- 2026-07-30: Task 6 GREEN — focused voting E2E passed (5/5), full Vitest passed (281/281), TypeScript passed, and the full Chromium suite passed (37/37).
- 2026-07-30: Task 7 RED — the new admission tests failed against the empty rate-limit adapter, and the story's pre-GA `unsafe.bindings` assumption differed from the installed Wrangler 4.115 schema.
- 2026-07-30: Task 7 GREEN — current GA `ratelimits` bindings validate in all three environments; focused unit tests passed (4/4), full Vitest passed (285/285), and the real local binding drove the focused 429 E2E suite green (6/6).
- 2026-07-30: Task 8 RED — the telemetry allowlist test proved the existing five-field record omitted the architecture-required internal Poll ID.
- 2026-07-30: Task 8 GREEN — the six-field voter-blind record passed focused unit (217/217 project total), workerd integration (68/68), and TypeScript checks while retaining one emission per request.
- 2026-07-30: Task 9 browser gate initially failed because the console assertion classified Chromium's expected 422 navigation message as a runtime error; it was narrowed to known 422/429 form responses while page exceptions and all unexpected console errors remain blockers.
- 2026-07-30: Task 9 GREEN — ordered final gates passed: migration guard (6/6), Vitest (21 files, 285/285), TypeScript, Playwright (38/38), Wrangler types with `VOTE_RATE_LIMITER` in every environment, and the production build.
- 2026-07-30: Visual proof captured the selected and Counted states at 1440×1000; focus, marker/read-only transitions, spacing, copy, and design tokens matched the Story 1.5 UX contract with zero page exceptions or unexpected console errors.

### Completion Notes List

- Added forward-only vote, selection, and voter-claim facts with idempotency and duplicate-claim constraints, cascading foreign keys, lookup indexes, and a transaction-time closed-Poll trigger.
- Verified the SQLite millisecond `unixepoch('subsec')` trigger expression in real workerd/D1 integration tests for explicit closure, past deadlines, and future deadlines.
- Filled the frozen multiple-choice strategy slots with exact-one persisted-option validation and relational vote-selection contributions; zero, forged multi, duplicate, and unknown selections are rejected without a contract-version bump.
- Implemented provider-free `castVote` with canonical ballot hashing, replay-first adjudication, effective-state and Session-Checks gates, safe error codes/copy, concurrent collision re-read, extensible ordered fact contributions, and the shared representation-version descriptor.
- Added secret-keyed, Poll/check-scoped WebCrypto HMAC plus 128-bit first-party voter tokens; public Poll GETs issue a one-year HttpOnly/Lax cookie with HTTPS-only Secure, and masked provisioning preserves the new digest secret across provider rotations.
- Added one-batch D1 vote persistence with ordered fact rendering, shared version updates, stored-submission and claim reads, typed constraint translation, and verified rollback/error precedence for duplicate, closed, and deleted-Poll races.
- Replaced the public Poll placeholder with a progressive-enhancement voting form, POST/redirect/get success flow, one-time confirmation, preserved-ballot rejection states, closed/already-voted read-only states, and exact accessible focus/title/copy behavior.
- Added a masked `initialize-voting` provisioning upgrade so existing local checkouts can add the digest secret without overwriting auth or OAuth credentials.
- Added a generous per-Poll/client Cloudflare rate-limit admission check using distinct GA binding namespaces per environment; exhausted limits preserve the ballot in a focused 429 state, while missing identities, bindings, or provider failures fail open.
- Extended the narrow telemetry record with nullable internal Poll correlation, populated only after a canonical Poll lookup; tokens, digests, selections, voter copy, and public references remain outside the allowlist.
- Completed the full unit/property, workerd/D1, signed-out/no-JS, rate-limit, and browser regression matrix; reconciled binding/setup/changelog/deferred-work documentation and generated Worker types.

### File List

- .dev.vars.example
- .github/workflows/deploy.yml
- AGENTS.md
- CHANGELOG.md
- README.md
- _bmad-output/implementation-artifacts/1-5-cast-a-vote-that-counts-exactly-once.md
- _bmad-output/implementation-artifacts/deferred-work.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- db/migrations/0006_votes.sql
- db/migrations.manifest.json
- scripts/provision-auth-secrets.zsh
- src/adapters/d1/index.ts
- src/adapters/digest/index.ts
- src/adapters/rate-limit/index.ts
- src/adapters/telemetry/index.ts
- src/components/poll-option.astro
- src/modules/voting/index.ts
- src/modules/polls/types/multiple-choice.ts
- src/env.d.ts
- src/lib/request-context.ts
- src/middleware.ts
- src/pages/[reference].astro
- src/scripts/vote-form.ts
- src/shared/application/index.ts
- tests/integration/csrf.integration.test.ts
- tests/integration/votes-adapter.integration.test.ts
- tests/e2e/creator-session.mjs
- tests/e2e/vote.spec.mjs
- tests/unit/auth.test.ts
- tests/unit/digest.test.ts
- tests/unit/polls.test.ts
- tests/unit/provision-auth-secrets.test.mjs
- tests/unit/rate-limit.test.ts
- tests/unit/shared-kernel.test.ts
- tests/unit/telemetry.test.ts
- tests/unit/voting.test.ts
- tests/integration/votes-schema.integration.test.ts
- vitest.integration.config.ts
- worker-configuration.d.ts
- wrangler.jsonc

### Change Log

- 2026-07-30: Implemented exactly-once multiple-choice voting, voter-private duplicate checks, accessible public voting states, permissive Cloudflare rate limiting, Poll-correlated voter-blind telemetry, complete automated/browser proof, and Story 1.5 documentation.
