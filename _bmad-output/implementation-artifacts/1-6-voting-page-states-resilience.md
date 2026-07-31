---
baseline_commit: 57973774b5b224104c0177fbbc8fc37791559dcf
---

# Story 1.6: Voting-Page States & Resilience

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Prerequisite: Story 1.5 is in `review` on branch `story/1-5-cast-a-vote-that-counts-exactly-once`. 1.6 modifies 1.5's voting page and vote-form script directly — start ONLY after 1.5's review closes and merges to main, then re-check `git log` (the baseline above is pre-1.5-merge main). Every `[1.5]`-tagged file reference below describes that branch's state. -->

## Story

As a Voter,
I want the voting page to keep my ballot safe through failures, offline moments, and in-flight submits — and to tell me when the Poll closes,
so that I never rebuild a ballot the product lost and never get surprised by a deadline.

## Acceptance Criteria

1. **Given** an open Poll with a Deadline, **When** the voting page renders, **Then** the Deadline shows as a local datetime, switching to a countdown under 24 hours (UX-DR19).
2. **Given** a submission in flight, **When** the Voter has activated the vote button, **Then** its label swaps to `COUNTING…` and it disables — a second activation cannot produce a second POST — while the ballot and options stay fully legible, and it re-enables at its normal label on any failure (UX-DR8, UX-DR19).
3. **Given** a submission failure of any kind (network error, validation, rejection), **When** the page re-renders, **Then** the Voter's ballot is preserved exactly — selection, any typed text — and the failure message appears above the vote button; a Voter never reconstructs a ballot the product lost (UX-DR19).
4. **Given** a Voter who goes offline, **When** they attempt to submit (or the connection event fires), **Then** the page shows "No connection. Your ballot is safe on this page; nothing has been sent yet.", the ballot is held, the button re-enables, and the loaded page remains fully readable offline — only submission is affected (UX-DR19).

## Tasks / Subtasks

- [x] Task 1: Deadline display — local datetime + sub-24h countdown (AC: #1)
  - [x] Pure helpers in a NEW `src/modules/polls/deadline-display.ts` `[ASSUMPTION: polls module owns deadline facts (AD-19); separate file so the client script can import it without dragging commands into the chunk — the `caps.ts` split precedent]`: `countdownLabel(deadlineMs, nowMs): string | null` returning `null` at ≥24h or ≤0 remaining, `CLOSES IN {n}H` for 1h–24h (floor, min 1), `CLOSES IN {n}M` under 1h (floor, min 1) `[ASSUMPTION: format from the poll-card precedent "CLOSES IN 3H" (DESIGN.md:623); floor so the label never overstates remaining time]`. No `Date.now()` inside — `nowMs` injected (testability, AR-19's no-environment-lookup rule)
  - [x] `src/pages/[reference].astro` `[1.5]` GET (open, votable poll only): render a meta row above the question — deadline right-aligned `[ASSUMPTION: mockups/key-voting.html places the deadline in a top `.meta` flex row; the live indicator that shares it is Story 1.9 — render the row with the deadline alone for now]` — as `<time datetime="{RFC 3339}" data-deadline="{deadlineMs}">{server UTC datetime via the existing formatUtc}</time>` in `label-caps-lg` + `dim` `[ASSUMPTION: token unresolved in DESIGN.md — label-caps-lg per the :491 information-vs-structure rule (CLOSED and the timezone line are label-caps-lg; the deadline carries information); mockup used label-caps — flag if wrong]`. No deadline → NO element at all (the no-timestamp-variant discipline, epics.md:446). RFC 3339 on the wire per AR-19; UTC server text is the no-JS floor (AD-2 — a deadline must never be blank without JavaScript)
  - [x] Client enhancement in `src/scripts/vote-form.ts` `[1.5]`: rewrite the `<time>` textContent (never innerHTML — `no-raw-html.test.mjs` walks src/) to the reader's local datetime via `Intl.DateTimeFormat(undefined, …)` `[ASSUMPTION: `{month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}`, plus year when it differs from the current year; EXPERIENCE.md:322 — local time "with no ceremony", no timezone label, no override]`; under 24h ALSO render the countdown line with the local datetime above it (EXPERIENCE.md:174 — both render, stacked)
  - [x] Tick decision (recorded, not inferred): countdown updates on a once-per-minute `setTimeout` chain — NEVER per-second ("Idle is still", EXPERIENCE.md:289; text rewrite is a content change, not one of the five motion primitives, but a second-hand tick puts a second moving thing on the page). NOT in any `aria-live` region (the polite region is the Tally's, 1.9 — nothing authorizes one on the voting form). Crossing zero client-side does NOT flip the UI to closed — swap the label to nothing (or leave the last value) and let the next request render the closed state; AD-11 makes the server authoritative at read/submit time, and the D1 trigger from 1.5 is the enforcement
- [x] Task 2: In-flight `COUNTING…` lock (AC: #2)
  - [x] Extend `src/scripts/vote-form.ts` `[1.5 — currently disabled-until-selection only]` with the submit lifecycle already proven in `src/scripts/create-poll-form.ts:150-202`: on `submit`, swap the button label to `COUNTING…` (the `components.button-primary.pendingLabel` token string, single-character ellipsis `…`, DESIGN.md:254) and set `disabled` — no spinner, no progress bar, "the state is type" (DESIGN.md:602). Disabled styling is the existing `button-primary` disabled treatment (`dim` text on transparent — never `faint`, never opacity, DESIGN.md:605/:690); `ButtonPrimary` already carries it
  - [x] Restore lifecycle verbatim from the create-form precedent: `restoreIdleState()` (normal label, re-enabled, per current selection state) registered on `window` `pageshow` (bfcache restore) AND a 10-second `setTimeout` fallback — Esc/stop mid-POST fires no `pageshow`; a real navigation discards the timer with the page. This is also the client half of AC #2's "re-enables on any failure": a server 422 is a NEW document whose button renders enabled — restore matters only when no navigation completed
  - [x] Options non-interactive but FULLY legible in flight (EXPERIENCE.md:175): DO NOT set `disabled` on the radio inputs in the submit handler — the form's entry list is built after the submit event fires, and a disabled checked radio drops `option_id` from the POST (the exact spec hazard `create-poll-form.ts:182-189` documents for its intent stamp). Use a `data-vote-inflight` attribute on the form driving `pointer-events: none` on the fieldset plus an early-return guard in the change handler `[ASSUMPTION: mechanism; the requirement is no interaction, zero visual dimming — no opacity, no color change]`
  - [x] No-JS floor: without JavaScript there is no `COUNTING…` — the browser's native repeat-submit applies, and 1.5's `submission_id` idempotency (exact replay returns the stored outcome, AD-7) is the real double-POST protection. The client disable is a courtesy, never the guarantee — do not add server logic for it
- [x] Task 3: Failure re-render — ballot preservation + fresh `submission_id` (AC: #3)
  - [x] The 422-preserved-ballot mechanism already ships in 1.5 (`[reference].astro` re-renders `selectedOptionIds` as `checked` with the outcome line on top) — VERIFY against each failure code and extend tests; do not restructure. "Any typed text" is forward-looking: no text field exists on the vote form until 4.1's Comment composer — keep the mechanism shape general (the re-render round-trips the parsed form values, not a hand-picked field list)
  - [x] CHANGE: every 422 re-render must mint a FRESH `submission_id` into the hidden field (`[1.5]` currently re-renders the submitted one). Reasoning to preserve in a code comment: rejected submissions store nothing (1.5 decision — idempotency covers committed outcomes only), so a fresh ID is always safe; but a reused ID with an EDITED ballot returns `IDEMPOTENCY_CONFLICT` (AD-7) if the original ever committed — a dead end that contradicts "a Voter never reconstructs a ballot the product lost". The committed-but-response-lost case needs no re-render ID at all: the ORIGINAL page (never re-rendered) holds the original ID, and an exact resubmit recovers the stored outcome by design
  - [x] Failure-message position (decision): the outcome line stays FIRST in the main landmark, `tabindex="-1"`, focused on load, `<title>` leading with the outcome — exactly as 1.5 built it. UX-DR17 names "submission-failed" explicitly and is normative on EVERY post-submit render; the AC's "above the vote button" is satisfied by DOM order (the outcome line precedes the button). Do NOT move the message button-adjacent or render it twice. `<title>` for the failure render is 1.5's existing `Vote not counted — {question}` — already authored, keep it
  - [x] Never store a rejected ballot server-side — preservation is re-rendering the submitted payload in the 422 response, nothing else (reconcile-ux.md finding 5, resolved; also AD-15: ballot content never in logs). No sessionStorage/localStorage ballot stash `[ASSUMPTION: a client stash is unneeded — server re-render covers every server-reached failure; the offline/aborted path never leaves the page]`
- [x] Task 4: Offline handling (AC: #4)
  - [x] Add to 1.5's `VOTE_COPY` catalog in `src/modules/voting/index.ts` `[1.5]`: `offline` — verbatim: "**No connection.** Your ballot is safe on this page; nothing has been sent yet." (EXPERIENCE.md:88)
  - [x] Client-only (greenfield — no offline code exists anywhere): in `vote-form.ts`, two independent triggers (EXPERIENCE.md:177): (a) submit attempt while `navigator.onLine === false` → `preventDefault()`, show the offline message, keep the ballot untouched, button stays/returns enabled; (b) the `window` `offline` event → show the message without blocking anything. On `online`: remove the message `[ASSUMPTION: silent removal; announce nothing — "Updates resumed" copy belongs to the 1.9 Tally subscription, do not borrow it]`
  - [x] Message placement and semantics (decision): insert the offline line into the same top-of-main outcome-line slot the server renders outcomes into (one consistent place; built via `textContent` on a pre-rendered empty container `[ASSUMPTION: ship an empty `data-offline-outcome` element in the page HTML so the script never constructs HTML]`), styled by the existing `.vote-outcome` idiom (`body-lg`, lead clause `strong` in `alarm` — the 1.5 rejection pattern). On the submit-attempt trigger, move focus to it (mirrors the post-submit contract even though no navigation happened); on the bare connection-event trigger, one polite announcement, no focus theft `[ASSUMPTION: UX gap — offline-without-navigation is in neither the focus contract nor the live-region list; this split follows each mechanism's intent]`
  - [x] No-JS floor (state explicitly, don't let review "discover" it): with JavaScript off, an offline submit yields the browser's own network-error page — there is no no-JS equivalent and the spines sanction none. The loaded document staying readable offline is ordinary browser behavior plus the bfcache-friendly `pageshow` restore from Task 2; NO service worker, NO offline caching, NO PWA manifest (payload discipline, EXPERIENCE.md:242)
- [x] Task 5: Tests + gates (AC: all)
  - [x] Unit (`tests/unit/` — extend `voting.test.ts` or NEW `deadline-display.test.ts`): `countdownLabel` matrix — ≥24h → null, 23h59m → `23H`, 90m → `1H`, 59m → `59M`, 1m → `1M`, 30s → `1M`, 0/past → null; boundary exactly 24h → null `[ASSUMPTION: strictly-under-24h shows countdown]`; injected `nowMs` (no clock reads); `VOTE_COPY.offline` exactness
  - [x] Integration (extend `tests/integration/votes-adapter` or the route pattern from `create-poll-route.integration.test.ts`): 422 re-render carries a DIFFERENT `submission_id` than submitted while `checked` selection is preserved; replay of the ORIGINAL id + identical payload after a committed vote still returns the stored outcome (guards the fresh-ID change against breaking AD-7 recovery)
  - [x] E2E (`tests/e2e/vote.spec.mjs` `[1.5]` — extend; the seeded-session harness + `agePoll` from `creator-session.mjs` can set deadlines): (a) poll with far deadline → local datetime rendered, no countdown; deadline within 24h (via `agePoll`-style D1 update) → countdown line + datetime; no deadline → no element; (b) in-flight: intercept/delay the POST route, click VOTE, assert `COUNTING…` + disabled + second click produces no second request, options still visible unfaded; (c) offline: `context.setOffline(true)`, submit → verbatim offline copy shown, focus on it, no request fired; `setOffline(false)` → message gone, submit succeeds; (d) failure re-render: forced 422 (zero-selection POST via request or JS-off form) → selection preserved, outcome focused, `<title>` leads with outcome, hidden `submission_id` differs from the one submitted
  - [x] Gates in order (the 1.4/1.5 sequence): `pnpm migrations:guard` (manifest unchanged — NO migration in this story) → full Vitest → `pnpm check` → Playwright → `pnpm types` → production build — all green before story-done

## Dev Notes

### Decisions resolved at story-creation time (all `[ASSUMPTION]`-marked — flag to Justin if any feel wrong)

| Gap (unspecified or conflicting in sources) | Decision | Rationale |
| --- | --- | --- |
| `submission_id` across a failure (highest-risk ambiguity — AD-7 conflict trap) | **Fresh ID on every 422 re-render; the never-re-rendered original page keeps its original ID** | Rejected submissions store nothing, so fresh is always safe; reused-ID-with-edited-ballot is a stable `IDEMPOTENCY_CONFLICT` dead end; committed-but-response-lost recovery uses the original page's original ID by exact replay |
| Does the countdown tick? | **Minute-granularity `setTimeout` chain; no seconds; no aria-live; zero-crossing never flips the UI to closed** | "Idle is still" (EXPERIENCE.md:289); five motion primitives are closed (UX-DR4); AD-11 makes the server authoritative — the client countdown is presentational only |
| Countdown format + threshold | `CLOSES IN {n}H` (1–24h, floor) / `CLOSES IN {n}M` (<1h, floor, min 1); strictly-under-24h switches | Only precedents: `CLOSES IN 3H` card metadata (DESIGN.md:623), mockup `Closes in 5h`; floor never overstates time left |
| Deadline typography/placement | `label-caps-lg` + `dim`, right side of a meta row above the question; element absent without a Deadline | DESIGN.md:491 information-vs-structure rule (CLOSED/timezone are `label-caps-lg`; deadline omitted = oversight); mockup fixes placement; no-hole-in-the-sentence discipline (epics.md:446) |
| Local datetime format | Browser-locale `Intl.DateTimeFormat`, short month/day + time, year only when different; server floor = existing UTC `formatUtc` | EXPERIENCE.md:322 — local time "with no ceremony"; no IANA zone on the wire for non-Meeting polls (AR-19 asymmetry) |
| Failure message position vs. "above the vote button" | **Top-of-main outcome line (the 1.5 pattern) wins; DOM order satisfies "above"** | UX-DR17 is normative on every post-submit render incl. submission-failed; State-Patterns prose is looser; 1.5 already implements (a) and review hardened it |
| Offline without navigation — focus/title or live region? | Submit-attempt trigger: focus the inserted line (mirrors post-submit); connection-event trigger: one polite announcement, no focus theft; silent removal on `online` | Neither contract covers the in-place case; each mechanism applied where its rationale holds; "Updates resumed" copy is 1.9's, not borrowed |
| In-flight non-interactivity mechanism | `pointer-events: none` + change-handler guard via a form data-attribute — never `disabled` on inputs at submit | Disabled inputs leave the form's entry list — a disabled checked radio drops `option_id` from the POST (create-form precedent comment) |
| Offline ballot stash | None — no sessionStorage/localStorage | Server 422 re-render covers server-reached failures; offline/aborted submits never leave the page; rejected ballots must not be recorded (reconcile-ux.md finding 5) |

### Scope boundaries — build none of these

- **Live indicator (`LIVE` dot) + lost-connection notice ("Not receiving updates…")** → 1.9; the meta row ships deadline-only. Do not borrow 1.9's connection copy for offline
- **Tally/results rendering, skeleton bars, `/{link}/results`** → 1.8
- **Multi-select hints, checkbox rows, bounds copy** → 1.7
- **Turnstile widget/reset-on-failure, trust badge** → Epic 2 (but the 422 re-render shape must not preclude a widget re-issue — consumed tokens never replay)
- **Comment/display-name preservation** → 4.1 (mechanism stays general; no fields yet)
- **Rate-limit cooldown count** ("disabled for a short cooldown with the count visible", EXPERIENCE.md:192) — 1.5 shipped disabled-no-count; the UX gap (no duration, no format, conflicts with UX-DR8's blanket re-enable) stays open — record in deferred-work if review flags it, do not invent here
- **Service worker / offline caching / PWA** — never (payload discipline)
- **Closed-state rendering, already-voted state, flash confirmation** — shipped in 1.5; touch only if a task above requires it

### Architecture constraints that bind this story

- **AD-11/AR-9:** effective state = `closed_at` set OR `deadline ≤ request time`, derived on every read and command; 1.5's D1 trigger enforces it at transaction time. Everything client-side about the deadline is presentation. [Source: ARCHITECTURE-SPINE.md#AD-11]
- **AD-7/AR-5:** exact replay returns the stored outcome; reused ID + different payload → `IDEMPOTENCY_CONFLICT`. This story's fresh-ID rule is designed around it — don't "simplify" it away. [Source: ARCHITECTURE-SPINE.md#AD-7]
- **AD-2:** server-rendered floor for every state this story touches; enhancements are isolated vanilla TS in `src/scripts/` (one file per surface — extend `vote-form.ts`, don't add siblings `[ASSUMPTION: one-file precedent]`). NOTE: UX-DR25's sanctioned-JS list (epics.md:116) omits countdown/offline/in-flight scripts while UX-DR8/19 mandate the behaviors — an enumeration gap, not a prohibition; don't stall on it. [Source: ARCHITECTURE-SPINE.md#AD-2]
- **AR-19 conventions:** UTC Unix ms in D1 (`poll.deadline_ms`/`closed_at_ms`, nullable, 0004), RFC 3339 on the wire (the `<time datetime>`), IANA zones only where civil time matters (NOT here); POST → 303 success / 422 re-render with preserved values; stable error codes; kebab-case files. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions]
- **AD-15/AR-12:** ballot content never in logs; every failure state already has a stable code from 1.5 — reuse, don't mint new ones except offline (which never reaches the server). [Source: ARCHITECTURE-SPINE.md#AD-15]
- **AD-21/AD-24 note:** the voting page embeds a per-request `submission_id` and 1.5 already sets `cache-control: private, no-store` on every response of this route — preserve that; a cached page crossing its deadline must not revalidate fresh. [Source: ARCHITECTURE-SPINE.md#AD-21, #AD-24]
- **AD-22:** anonymous vote POSTs are covered by the origin/Fetch-Metadata middleware alone — zero CSRF changes here. [Source: ARCHITECTURE-SPINE.md#AD-22]

### Existing code — read before touching (state on the 1.5 branch → change → preserve)

| File `[1.5 branch]` | Today | This story | Must not break |
| --- | --- | --- | --- |
| `src/pages/[reference].astro` | GET/POST voting route: reserved→exact→case-variant-301 chain; token cookie; flash "Counted."; closed/already-voted read-only states; 422 re-render with `selectedOptionIds` re-checked and outcome line first-in-main `tabindex="-1"` autofocus; `formatUtc`; `private, no-store` everywhere | Add deadline meta row (`<time>` + data attrs); mint fresh `submission_id` on 422 re-renders; empty offline-outcome container; wire new data hooks | The review-hardened lookup/301 chain (1.4 burned five rounds on it); every 1.5 outcome state, copy, focus contract, and header byte-for-byte |
| `src/scripts/vote-form.ts` | Disabled-until-selection + hint toggle only (`data-vote-form`, `data-vote-hint`, `data-vote-locked`) | Add: in-flight lifecycle, offline triggers, deadline local-conversion + countdown tick | The selection-state sync and its locked handling (rate-limited state renders `data-vote-locked="true"`) |
| `src/scripts/create-poll-form.ts` | `PUBLISHING…` in-flight lifecycle with intent-stamp-before-disable, `pageshow` + 10s restore (`:150-202`) | Pattern source only — extract/mirror the lifecycle; zero changes | The create form |
| `src/modules/voting/index.ts` | `castVote`, typed errors, `VOTE_COPY`, stable codes | Add `VOTE_COPY.offline` | Every existing code/copy line; the command untouched |
| `src/components/button-primary.astro` | Disabled styling (`dim` on transparent), form-submitter props | Nothing expected — verify `COUNTING…` fits its width without reflow jump `[ASSUMPTION]` | Both existing consumers |
| `src/components/poll-option.astro` | Radio/checkbox row, `readOnly` variant | Nothing — in-flight non-interactivity lives in the form/script layer | Create-form + vote-form consumers |
| `src/modules/polls/index.ts` | `civilToUtcMs`, `POLL_CAPS`, caps.ts split precedent | Nothing (new sibling `deadline-display.ts` only) | — |
| `src/styles/tokens.css` | `--type-label-caps-*` sizes, `--color-dim/alarm`, motion tokens (unused), NO `prefers-reduced-motion` block anywhere | Scoped styles in the page; if any real animation appears, add the reduced-motion guard — a minute-tick text swap needs none `[ASSUMPTION]` | Four-place mode-collapse structure if any token is added |
| `db/migrations/*` | `poll.deadline_ms`/`closed_at_ms` since 0004; 0006 votes + trigger | Nothing — NO migration | Immutable (AD-14) |

### UX contract — exact copy and behavior

| Moment | Copy (verbatim) | Source |
| --- | --- | --- |
| Offline | **No connection.** Your ballot is safe on this page; nothing has been sent yet. | EXPERIENCE.md:88 |
| In-flight button label | `COUNTING…` (token `components.button-primary.pendingLabel`, single-char `…`) | DESIGN.md:254, :602 |
| Submission failed | **That didn't land.** The Vote wasn't recorded and your ballot is still here… *(shipped in 1.5 — reuse)* | EXPERIENCE.md:87 |
| Countdown | `CLOSES IN {n}H` / `CLOSES IN {n}M` `[ASSUMPTION — card precedent]` | DESIGN.md:623 |

Behavior invariants: one `button-primary` per screen, always the vote action; no spinner/progress/toast/invented indicator — "the state is type"; disabled and in-flight use `dim` (never `faint`, never opacity); failure copy at `body-lg` (multi-sentence rule, DESIGN.md:495) with the lead clause `strong` in `alarm` (the 1.5 `.vote-outcome` idiom); the failure message is INSERTED, replacing nothing; whitespace not boxes (no bordered alert); options in flight are non-interactive but visually unchanged; copy is layout-neutral — position words never appear in message text; no exclamation marks, no emoji, no "Oops!". [Source: EXPERIENCE.md#State Patterns L174-177, #Voice and Tone; DESIGN.md#button-primary, #Do's and Don'ts]

Accessibility: post-submit focus contract on every server-rendered failure (1.5 built it — extend to nothing, break nothing); offline submit-attempt focuses the inserted line; countdown NEVER in a live region and never announced per tick; in-flight button keeps its visible focus ring; `Enter` submits; state never color alone. [Source: EXPERIENCE.md#Accessibility Floor L244-260]

### Previous story intelligence (1.5 Dev Agent Record + 1.4 review lessons)

- 1.5 is in `review` on `story/1-5-cast-a-vote-that-counts-exactly-once` (3 commits, 285 Vitest / 38 Playwright green at completion). Its story file's scope boundary names this story verbatim: "`COUNTING…` in-flight lock, failure-state re-enable, offline handling, deadline countdown/local display → Story 1.6" — and its closed-`{when}` copy deliberately renders UTC because "local-time display and countdown are 1.6". Upgrading those closed-state `{when}` renders to local time is IN scope for this story's client enhancement `[ASSUMPTION: same `<time>` treatment as the deadline — one mechanism]`.
- 1.5 established on this route: Zod-over-formData parse with non-string coercion; `outcomeFromError` view mapping; `readOnly`/`actionDisabled` render flags; flash-cookie PRG for "Counted."; per-render `submission_id` minting on GET. The POST branch currently re-renders the SUBMITTED `submission_id` — Task 3 changes exactly that one behavior.
- `create-poll-form.ts`'s restore comment names offline explicitly — the aborted-navigation restore is the same problem class; reuse its lifecycle, including the bfcache `pageshow` subtlety.
- Integration harness: workerd + local D1, migrations injected via `TEST_MIGRATIONS`; seeds idempotent, per-file cleanup; the route-level 422 test pattern lives in `create-poll-route.integration.test.ts` (fake middleware context + real `onRequest`).
- E2E harness: `creator-session.mjs` (`seedCreatorSession`, `agePoll`, `d1Query`) — `agePoll` already exists to mutate poll timestamps for deadline scenarios; authed specs `test.skip` without `BETTER_AUTH_SECRET` locally but run in the deploy gate; `cleanupCreator` in `afterAll` makes CI retries hazardous — keep new specs retry-tolerant.
- `tests/unit/no-raw-html.test.mjs` fails the build on any `innerHTML`/`set:html` in src/ — all client text via `textContent`.
- 1.4's review burned five rounds on `[reference].astro`'s lookup/redirect chain — it is review-sensitive; add to it without reordering anything.
- Review lesson (1.2→1.4→1.5): map errors to stable codes once in the command; pages render, never classify.

### Project Structure Notes

- New files: `src/modules/polls/deadline-display.ts`, `tests/unit/deadline-display.test.ts` (or fold into existing suites)
- Updated: `src/pages/[reference].astro`, `src/scripts/vote-form.ts`, `src/modules/voting/index.ts`, `tests/e2e/vote.spec.mjs`, integration route/adapter tests; NO migration, NO manifest change, NO wrangler/binding change, NO new dependency
- Kebab-case files; unit tests stay out of the workerd pool; `*.integration.test.ts` naming
- Latest-tech check: nothing new — `Intl.DateTimeFormat`, `navigator.onLine`/`online`/`offline` events, `pageshow`, and Playwright's `context.setOffline` are all long-stable platform APIs on the pinned stack (TS 7.0.2, Astro 7.1.5, Playwright 1.62.0); no library research required

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.6] (lines 376–398) — story statement + 4 ACs; #UX-DR8 (line 99), #UX-DR19 (line 110), #UX-DR17 (line 108), #UX-DR25 JS list (line 116)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md#AD-2, #AD-7, #AD-11, #AD-15, #AD-21, #AD-22, #AD-24, #Consistency Conventions (L372-380), #Structural Seed (L409-438)]
- [Source: .../architecture/.../reviews/reconcile-ux.md finding 5 (L138-162, resolved :210)] — no server-side storage of rejected ballots; 422-re-render preservation is the ratified mechanism
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md#Voice and Tone L81-128 (offline L88, in-flight L86, failed L87), #State Patterns L174-177 + L191-193, #Accessibility Floor L244-260 (post-submit contract L250), #Interaction L219-226 (bans), L289 ("Idle is still"), L322 (local time no ceremony), L242 (payload discipline)]
- [Source: .../ux-designs/.../DESIGN.md#button-primary L243-257 + L601-605 (pendingLabel, disabled=dim), L491-495 (label-caps-lg rule, body-lg rule), L623 (CLOSES IN 3H), L689-690 (faint/opacity bans); mockups/key-voting.html:212-214 (meta-row placement — evidence, not spec)]
- [Source: branch story/1-5-cast-a-vote-that-counts-exactly-once — _bmad-output/implementation-artifacts/1-5-cast-a-vote-that-counts-exactly-once.md (scope boundary naming 1.6; decisions table), src/pages/[reference].astro, src/scripts/vote-form.ts]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — closed-state rendering history; create-form in-flight residual (10s idle-restore re-enable race, accepted)
- [Source: src/scripts/create-poll-form.ts:150-202] — the in-flight/restore lifecycle to mirror

## Dev Agent Record

### Agent Model Used

OpenAI Codex (GPT-5)

### Implementation Plan

- Follow the story tasks in order with red-green-refactor: isolate pure deadline policy, progressively enhance the SSR vote page, mirror the proven create-form submit lifecycle, preserve server-rendered ballots with fresh retry IDs, and add client-only offline handling.
- Keep Polls/Voting ownership and the reviewed route lookup chain intact; add no migrations, bindings, dependencies, storage, or service worker.
- Prove each behavior with the narrowest unit/browser coverage first, then run the complete repository gate in its documented order.

### Debug Log References

- Task 1 RED: `vitest --project unit tests/unit/deadline-display.test.ts` failed because the new provider-free helper did not exist.
- Task 1 GREEN: deadline unit matrix passed (10 tests), focused Playwright deadline flow passed, TypeScript passed, and the full Vitest regression passed (23 files, 345 tests).
- Task 2 RED: the held-POST Playwright flow could not find a disabled `COUNTING…` button before the submit lifecycle existed.
- Task 2 GREEN: the two-phase browser flow passed with keyboard activation, `aria-busy`, a forced visible focus outline, unchanged presentation for both options, guarded selection, deterministic `pageshow` recovery, and exactly one real POST while a queued second submit was rejected.
- Task 3 verification: focused Playwright cases passed for lost-token 422 preservation/fresh ID and exact committed replay/conflict behavior; TypeScript and all 345 Vitest tests remained green.
- Task 4 RED: the exact-copy unit assertion failed without `VOTE_COPY.offline`, and the offline Playwright flow found no outcome container.
- Task 4 GREEN: the catalog passed all 34 Voting unit tests; the offline browser flow preserved focus semantics and selection, fired zero offline POSTs, re-enabled Vote, removed the line on `online`, restored focus to Vote, and then submitted successfully.
- Task 5 layered coverage: the workerd integration project has no Astro transform, so the real-route Playwright suite proves checked-selection/fresh-ID HTML while the real-D1 integration suite proves original-ID replay after a divergent rejection. Independent source and test reviews accepted that split with no remaining findings.
- Visual QA: inspected deadline states in light and dark modes plus the focused offline outcome; layout, contrast, selection, and focus treatment were intact, with no browser console errors.
- Final gate (Node 24.18.0, in order): migration guard passed 7/7 checksums; Vitest passed 23 files / 345 tests; `pnpm check` passed; Playwright passed 52/52; `pnpm types` completed with no tracked drift; `pnpm build:production` completed.

### Completion Notes List

- Task 1: Added an injected-time countdown helper, SSR RFC 3339/UTC deadline floor, local browser formatting, minute-granularity countdown updates, and right-aligned deadline metadata without changing server-authoritative closure.
- Task 2: Mirrored the proven submit/restore lifecycle with `COUNTING…`, a disabled/`aria-busy` submitter, a guaranteed pending focus outline, bfcache and ten-second recovery, and a form-level guard that leaves option controls visually unchanged while preventing a second POST.
- Task 3: Preserved the reviewed first-in-main failure contract and submitted selection, strengthened the fresh-ID recovery rationale, and explicitly proved a valid failed submission receives a different UUID while exact committed replay still succeeds.
- Task 4: Added the canonical offline copy, a pre-rendered polite outcome slot populated only through `textContent`, offline-event and offline-submit handling, focused retry feedback, and silent online removal with focus restored to Vote when needed. With JavaScript disabled, the browser's network-error page remains the intentional floor; no service worker, offline cache, PWA manifest, or ballot storage was added.
- Task 5: Added unit, real-D1 integration, and real-route browser coverage for every acceptance criterion, completed independent source/test reviews, visually inspected both color modes and offline focus, and passed the production gate in repository order.

### File List

- CHANGELOG.md
- _bmad-output/implementation-artifacts/1-6-voting-page-states-resilience.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/modules/polls/deadline-display.ts
- src/modules/voting/index.ts
- src/pages/[reference].astro
- src/scripts/vote-form.ts
- tests/e2e/vote.spec.mjs
- tests/integration/votes-adapter.integration.test.ts
- tests/unit/deadline-display.test.ts
- tests/unit/voting.test.ts

### Review Findings

- [x] [Review][Patch] Timed restore can re-arm a genuinely in-flight POST under the same `submission_id` — resolved (Justin, 2026-07-31): harden. On the 10s `restoreTimer` restore path only, mint a fresh `submission_id` into the hidden field so an edited resubmit can never hit a permanent `IDEMPOTENCY_CONFLICT` (a committed original then answers `already_voted`, an uncommitted one votes cleanly). `pageshow`/bfcache restore keeps the original ID — exact-replay recovery (AD-7) depends on it [src/scripts/vote-form.ts:190]
- [x] [Review][Patch] Offline protection depends on `navigator.onLine`, unreliable outside Chromium — resolved (Justin, 2026-07-31): compensate. Add a pre-submit connectivity probe: with JS active, `preventDefault` every submit, `fetch` a tiny same-origin URL (`cache: "no-store"`, short `AbortSignal.timeout`), and only on probe success call `form.submit()` (native submit skips the submit event — no recursion); on probe failure show the offline outcome and restore idle. This catches Firefox-offline and captive-portal/dead-uplink cases where `navigator.onLine` lies, at the cost of one extra RTT per vote [src/scripts/vote-form.ts:167-173]
- [x] [Review][Patch] `offline` event clears the in-flight lock mid-flight [src/scripts/vote-form.ts:194-197]
- [x] [Review][Patch] In-flight keydown guard swallows browser shortcuts (F5, Ctrl/Cmd+R, Escape, Home/End) when a radio has focus [src/scripts/vote-form.ts:143-151]
- [x] [Review][Patch] `pageshow` restore does not reconcile the offline banner with current connectivity — stale "No connection" banner persists after bfcache resume while reconnected [src/scripts/vote-form.ts:193]
- [x] [Review][Patch] Rate-limited (429) locked page still shows the offline banner on connectivity loss, stacking contradictory rejection copy [src/pages/[reference].astro:599, src/scripts/vote-form.ts:194-197]
- [x] [Review][Patch] Focus drops to `<body>` when a submit hides the focused offline message — `hideOfflineOutcome()` called without a focus target on the submit path [src/scripts/vote-form.ts:178]
- [x] [Review][Patch] Connectivity flaps re-announce the offline message — `showOfflineOutcome` rewrites `textContent` unconditionally, re-triggering the polite live region [src/scripts/vote-form.ts:78-90]
- [x] [Review][Patch] Missing-placeholder fallback leaks the literal `{when}`/`{deadline}` token to voters if copy drifts from its placeholder (pre-change `replace` degraded cleanly) [src/pages/[reference].astro:568-583]

## Change Log

- 2026-07-31: Implemented deadline presentation, resilient in-flight/offline voting states, fresh retry IDs, accessibility recovery, and complete regression coverage for Story 1.6.
- 2026-07-31: Code review (three adversarial layers, 9 findings applied): pre-submit connectivity probe with fresh-`submission_id` timed restore, offline-event lock preservation, pageshow banner reconciliation, locked-form offline suppression, selection-only keydown guard, focus/flap/token-leak hardening; 3 new e2e flows, full gate green (345 Vitest-equivalent unit+integration, 55 Playwright, types, production build).
