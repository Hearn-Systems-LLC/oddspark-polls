---
baseline_commit: 5fa65b5c5b94416d11fa64838e39af98a03be766
---

# Story 1.3: Create a Multiple-Choice Poll

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Creator,
I want to create a Multiple-Choice Poll with my question, options, visibility, and optional deadline,
so that my Poll is live and votable the moment I publish it.

## Acceptance Criteria

1. **Given** a signed-in Creator on `/creator/new`, **When** they submit a question, two or more options, a Visibility Setting, and an optional Deadline, **Then** `CreatePoll` commits the Poll, its options, and its generated reference in one D1 batch (AD-3) — a failed batch leaves no reachable Poll, **And** the Poll is immediately open and votable at a root-path link containing at least 96 random bits, URL-safe (AD-13), **And** the create-confirmation page shows the full canonical URL (FR-2).
2. **Given** the creation form, **When** the Visibility Setting is chosen, **Then** the chooser renders as three `poll-option` single-select rows — Live, After Close, Creator-Only — each with its consequence line beneath (UX-DR2), defaulting per the form's initial state, **And** the new Poll records Session Checks on as the baked-in default (FR-15's default, enforced from Story 1.5's transaction).
3. **Given** invalid input — zero options, one option, or a Deadline in the past, **When** the form is submitted, **Then** the route re-renders with status 422, the exact Voice-and-Tone message inline beneath the offending field ("A Poll needs options." / "One option isn't a Poll." / "That Deadline has already passed."), and every other field preserved (AR-19, UX-DR14); success responds POST → 303.
4. **Given** oversized creation input, **When** the option count or the question/option/description length exceeds server-enforced sensible caps, **Then** the submission is rejected 422 with the field named — protecting page weight and D1 batch limits on a public-signup surface. Caps `[ASSUMPTION]`: at most 30 options; question ≤ 280 characters; option label ≤ 100; description ≤ 5,000.
5. **Given** any creator-supplied text — question, options, description, **When** it renders on any surface, **Then** it is escaped plain text; no rich-HTML path exists for any user-supplied content, because on a public-signup platform Creators are untrusted input too (NFR-8 extended, AR-19).
6. **Given** the Poll Type strategy contract defined in this story, **When** it is frozen, **Then** a written design check validates it against all four known Poll Types' needs — ranked ballots, image media adoption, meeting slots/availability + revision (de-risk rule #1).

## Tasks / Subtasks

- [x] Task 1: Shared kernel + Poll Type strategy contract (AC: #6)
  - [x] `src/shared/domain/index.ts`: branded entity IDs (`PollId`, `PollOptionId`, `UserId` at minimum) and the enums AD-23 assigns here — `PollType` (`multiple_choice` now; `ranked_choice`, `image`, `meeting` as declared future values), `ResultVisibility` (`live` | `after_close` | `creator_only`), `DiscoveryState` (`unlisted` | `listed` | `delisted`), and derived `PollStatus` helper `effectivePollStatus({closedAtMs, deadlineMs}, nowMs)` — closed whenever `closed_at` is set or `deadline` ≤ now (AD-11); status is computed, never a stored column
  - [x] `src/shared/application/index.ts`: the versioned `PollTypeStrategy` contribution interface with the four AD-3 ports — `create` (normalize type-specific creation facts), `validateSubmission`, `persistFacts`, `projectResults` — typed so 1.3 implements only `create` and the others are declared contract surface (implemented by Stories 1.5/1.8); plus the shared HTTP error envelope type (stable code, safe message, optional field errors) per Consistency Conventions
  - [x] Written design check (AC #6): `docs/design/poll-type-contract-check.md` `[ASSUMPTION: location]` walking the contract against ranked ballots (ordered selections, IRV rounds), image media adoption (R2 temp-key adoption inside the create batch), and meeting slots (slot facts at create; availability + revision at vote) — the contract must let each type contribute rows to the one CreatePoll D1 batch without reshaping it; freeze only after the check passes
  - [x] Contract tests move with the contract (AD-23): a compile-time consumer test asserting the multiple-choice strategy satisfies the interface
- [x] Task 2: Migration `0004_polls.sql` + manifest (AC: #1, #2) — applied to local, staging, and production D1 (see Debug Log)
  - [x] `poll` table: `id` TEXT PK (UUID), `owner_user_id` TEXT NOT NULL REFERENCES `user`(`id`), `poll_type` TEXT NOT NULL, `question` TEXT NOT NULL, `description` TEXT, `result_visibility` TEXT NOT NULL, `discovery_state` TEXT NOT NULL DEFAULT 'unlisted', `session_checks_enabled` INTEGER NOT NULL DEFAULT 1, `deadline_ms` INTEGER, `closed_at_ms` INTEGER, `representation_version` INTEGER NOT NULL DEFAULT 1 (AD-24), `created_at_ms` INTEGER NOT NULL, `updated_at_ms` INTEGER NOT NULL — discrete columns, no settings JSON blob (AD-3 forbids opaque payloads); further Security Toggle columns arrive with Epic 2 via expand migrations
  - [x] `poll_option` table: `id` TEXT PK (UUID), `poll_id` TEXT NOT NULL REFERENCES `poll`(`id`) ON DELETE CASCADE, `label` TEXT NOT NULL, `position` INTEGER NOT NULL, `created_at_ms` INTEGER NOT NULL, UNIQUE(`poll_id`, `position`)
  - [x] `poll_reference` table: `reference` TEXT PK, `poll_id` TEXT NOT NULL REFERENCES `poll`(`id`) ON DELETE CASCADE, `kind` TEXT NOT NULL ('generated' now; 'custom' arrives Story 1.4), `is_canonical` INTEGER NOT NULL DEFAULT 1, `created_at_ms` INTEGER NOT NULL — a table (not a column) so Story 1.4 can add a custom slug without a schema rewrite
  - [x] Domain timestamps are UTC Unix-ms INTEGER (the auth-table TEXT exception from 0002 does NOT extend to domain tables); regenerate `db/migrations.manifest.json` via `scripts/migrations-checksum.mjs`; apply local → staging → production (`pnpm migrate:*`)
- [x] Task 3: Polls domain module — `CreatePoll` policy, multiple-choice strategy, reference + reserved slugs (AC: #1, #3, #4)
  - [x] `src/modules/polls/index.ts`: provider-free (no Astro/D1 imports, AD-1) `CreatePoll` input type + domain validation enforcing invariants independently of Zod: ≥2 non-blank options after trimming, ≤30 options, question 1–280 chars, option label 1–100, description ≤5,000, deadline strictly in the future, exact-duplicate option labels (after trim) rejected (decision, Justin 2026-07-29), visibility one of the three enum values
  - [x] `src/modules/polls/types/multiple-choice.ts`: the first `PollTypeStrategy` — `create` normalizes question/options into creation facts (options with positions in submitted order)
  - [x] Reference generator: ≥96 random bits from `crypto.getRandomValues` (16 bytes recommended), base64url-encoded, URL-safe, no padding (AD-13)
  - [x] Reserved-slug registry: one module (e.g. `src/modules/polls/reserved-slugs.ts`) exporting the reserved set — `/`, `creator`, `discover`, `sign-in`, `assets`, `api`, `favicon.ico`, `robots.txt`, `sitemap.xml`, and per-poll sub-paths `results`, `manifest` — imported by BOTH routing and (in 1.4) slug validation; generated references are checked against it too (collision practically impossible, check still applied)
  - [x] Validation-error catalog maps each failure to its stable code + exact Voice line (see Dev Notes copy table)
- [x] Task 4: D1 adapter — atomic CreatePoll batch (AC: #1)
  - [x] `src/adapters/d1/index.ts`: `createPoll` repository committing poll + options + reference rows in ONE `DB.batch()` — D1 batch is transactional; a failed statement rolls back the lot, leaving no reachable Poll
  - [x] `discovery_state` decision (spine gap, resolved here): it is a column on `poll`, initialized to `'unlisted'` by CreatePoll — writing the fixed default at creation is initialization, not a cross-module mutation; all subsequent listing transitions belong to Discovery-module commands (Story 3.1+, AD-19/AD-5)
  - [x] Application command wires Zod-validated delivery input → domain validation → strategy `create` → repository batch; telemetry correlates by internal Poll ID, never the reference (AD-15) — the existing `telemetryMiddleware` envelope already covers the request record
- [x] Task 5: `/creator/new` form page (AC: #2, #3, #4)
  - [x] `src/pages/creator/new.astro`: single column at every width, `heading-lg` title, one-column order — question, options, Visibility chooser, Deadline, description `[decision: included at creation]`; guarded automatically by `creatorGuardMiddleware` (do not re-implement auth); verify the page wins routing over the existing `src/pages/creator/[...path].astro` catch-all
  - [x] Question/option/description/deadline fields reuse the `input` primitive (label-caps label above, never placeholder-as-label); no required-field asterisks (banned); textarea variant for description may extend the primitive's tokens — never restyle
  - [x] Options, no-JS baseline (AD-2): render 4 empty option rows initially `[ASSUMPTION]`; an `ADD OPTION` `button-secondary` is a server-round-trip submit re-rendering with one more row, all values preserved; blank rows are ignored on submit (blank = removed) — validation counts non-blank rows only
  - [x] Options, JS enhancement: isolated vanilla TS adds/removes rows client-side (text-labelled `REMOVE` per row — no icon-only buttons); no reorder affordance exists in the spec (drag is banned; none built)
  - [x] Visibility chooser: three `poll-option` single-select rows (native visually-hidden radios) — LIVE / AFTER CLOSE / CREATOR-ONLY with exact consequence lines beneath each in `body`/`dim` (see copy table); default **Live** (decision, Justin 2026-07-29)
  - [x] Deadline: optional `datetime-local` input on the `input` primitive's tokens `[ASSUMPTION: native control; DESIGN.md defers date/time styling]`; JS enhancement fills a hidden `timezone` field with the IANA zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`); absent (no-JS), the value is interpreted as UTC and the resolved time echoed on the confirmation (decision, Justin 2026-07-29); server converts to UTC Unix ms and validates future-ness at submit time
  - [x] Hidden `csrf_token` input = `Astro.locals.requestContext.csrfToken.value` — the csrfMiddleware requires it on creator-path POSTs; the form POSTs to the same route (`/creator/new`), 422 re-render with inline field errors and every other field preserved, success → 303 (Consistency Conventions)
  - [x] Publish button: single `button-primary` `PUBLISH POLL` `[ASSUMPTION: label]`; ~~disabled state is `dim` text with a `label-caps` hint above stating what unlocks it~~ `[superseded: permanently enabled, validate-on-submit only — decision, Justin 2026-07-29]`; in-flight is a label swap `PUBLISHING…` `[ASSUMPTION]`, never a spinner; no toasts, no motion anywhere on this page
- [x] Task 6: Create-confirmation + root-path poll page (AC: #1, #5)
  - [x] Success 303s to the create-confirmation at `/creator/polls/{pollId}` `[ASSUMPTION: route; grows into the Story 1.11/1.12 detail surface]`: outcome line first in main landmark, `tabindex="-1"`, focused on load; `<title>` leads with outcome — copy `[ASSUMPTION]`: "**Your Poll is live.**" / title `Poll created — Oddspark Polls`; the full canonical URL (`{origin}/{reference}`) rendered as selectable `body` text (the `SHARE` control itself is Story 1.13 — do not build it)
  - [x] Root-path route `src/pages/[reference].astro`: resolves the reference via `poll_reference` (checking the reserved-slug registry first), server-renders question + options as `poll-option` rows with zero client framework payload; the vote submission path is Story 1.5 — this story delivers the reachable, open Poll page (unknown reference → plain 404)
  - [x] Escaping (AC #5): all creator text renders through Astro's default HTML-escaping expressions — `set:html` is forbidden for any user-supplied content on every surface, this story and after
- [x] Task 7: Tests + validation gates (AC: all)
  - [x] Unit: domain validation matrix (0/1/2/31 options, blank-only options, cap boundaries at 280/281, 100/101, 5000/5001, past/future/absent deadline, duplicate labels, visibility values); reference generator (length/alphabet/entropy via fast-check property: decodes to ≥96 bits, URL-safe, no collisions across a sample); reserved-slug registry; timezone interpretation incl. UTC fallback
  - [x] Integration (workerd + local D1): migration 0004 schema assertions (pattern: `tests/integration/auth-schema.integration.test.ts`); CreatePoll batch atomicity — force a failing statement (e.g. duplicate reference) and assert zero poll/option rows survive; POST `/creator/new` happy path → 303 + rows persisted with `result_visibility='live'` default, `discovery_state='unlisted'`, `session_checks_enabled=1`, `representation_version=1`; 422 re-render preserves fields; unauthenticated POST → guard redirect; missing CSRF token → 403 (real-page 303/422/XSS coverage lives in `tests/e2e/create-poll-authed.spec.mjs` — the workerd pool can't run Astro page frontmatter; e2e is in the CI gate — decision, Justin 2026-07-29)
  - [x] E2E (Playwright): signed-out `/creator/new` redirects to sign-in; form renders all fields with labels and no JS errors; XSS probe — create a poll whose question/option is `<script>alert(1)</script>` and assert it renders inert as text on the confirmation and root-path page
  - [x] Gates: full Vitest suite, `pnpm check`, `pnpm migrations:guard`, production build — all green before story-done

### Review Findings

- [x] [Review][Defer] Public poll page does not consume the `poll-option` primitive — `[reference].astro` hand-rolls `.poll-option-row`/`.poll-option-marker` markup duplicating the primitive's styles, against Task 6 ("server-renders question + options as `poll-option` rows") — deferred: read-only rows accepted for 1.3; Story 1.5 replaces them with votable radios built on the primitive (decision, Justin 2026-07-29) [src/pages/[reference].astro:35-42]
- [x] [Review][Decision→Resolved] Publish block lacks the spec's disabled-state unlock hint — resolved by spec amendment: the publish button is permanently enabled and validation happens on submit only ("validate on submit, never on blur"); the Task 5 disabled-state/hint line is superseded (decision, Justin 2026-07-29) [src/pages/creator/new.astro:215-222]
- [x] [Review][Patch] HIGH — button primitives drop `name`/`value`, breaking the whole create form's submit wiring: no-JS ADD OPTION publishes (or 422s) instead of adding a row (`intent` defaults to `publish`), and every `button[name="intent"][value=...]` selector in `create-poll-form.ts` matches nothing so the entire JS enhancement (add/remove rows, REMOVE buttons, PUBLISHING… swap) is dead; `tsc --noEmit` never checks `.astro` so nothing caught it. Also, once `name`/`value` render, ADD OPTION precedes PUBLISH in DOM order and becomes the implicit Enter-key submission target. Fix: add `name`/`value` props to both primitives and make PUBLISH the implicit default [src/components/button-primary.astro:2-31, src/components/button-secondary.astro:2-31, src/pages/creator/new.astro:159-161,216-218, src/scripts/create-poll-form.ts:25-27,99-107]
- [x] [Review][Patch] No duplicate-submission protection — the submit handler swaps the label to PUBLISHING… but never disables the button, and `createPoll` has no idempotency key; a double-click or retried POST mints duplicate polls [src/scripts/create-poll-form.ts:102-107, src/modules/polls/index.ts:286-341]
- [x] [Review][Patch] `civilToUtcMs` silently mishandles DST-gap/ambiguous civil times — the two-iteration fixed point does not converge for spring-forward gap times (returns an instant an hour off, no error); add a post-loop wall-time round-trip check returning null (→ "didn't parse") and tests within DST transitions [src/modules/polls/index.ts:135-142]
- [x] [Review][Patch] Persistence failure path discards all diagnostics — the blanket `catch` maps D1 outage, constraint violation, and reference collision to an identical `poll_create_failed` with the original error logged nowhere; a reference collision is also indistinguishable from an outage, so no safe retry can ever be added. Log the underlying error server-side (IDs/codes only, AD-15) [src/modules/polls/index.ts:328-338]
- [x] [Review][Patch] Task 7's route-level integration tests are missing — `create-poll-route.integration.test.ts` stops at middleware (stub `next`); no committed test posts to the real page asserting 303 + persisted row defaults or 422 field preservation, the page frontmatter (the largest block of new logic) is covered only by an uncommitted scripted smoke, and the Task 7 XSS e2e probe is absent [tests/integration/create-poll-route.integration.test.ts, tests/e2e/create-poll.spec.ts]
- [x] [Review][Patch] Single-canonical-reference invariant exists only in comments — `findPollForOwner` joins on `is_canonical = 1` but no partial unique index enforces one canonical row per poll; add `CREATE UNIQUE INDEX ... ON poll_reference(poll_id) WHERE is_canonical = 1` as a new forward migration [db/migrations/0004_polls.sql:43-52, src/adapters/d1/index.ts:123-132]
- [x] [Review][Patch] Resolved deadline is never echoed on the confirmation page — the story's recorded decision requires it ("absent JS, the value is interpreted as UTC and the resolved time echoed on the confirmation"); a no-JS creator gets no feedback about zone interpretation [src/pages/creator/polls/[pollId].astro:40-57]
- [x] [Review][Patch] Field-error a11y wiring is half-done — `options-error` and `visibility-error` render with ids nothing references (no `aria-describedby` on the group/fieldset), and every option input gets `aria-invalid="true"` for group-level failures (too few, duplicates), telling screen-reader users each individual field is wrong [src/pages/creator/new.astro:140-157,166-183]
- [x] [Review][Patch] Cloned option rows inherit error state — `addRow()` `cloneNode(true)` copies `is-error`/`aria-invalid` from a row rendered after a failed publish; clear them on the clone [src/scripts/create-poll-form.ts:72-88]
- [x] [Review][Patch] Visibility fieldset is double-labelled — `<legend>` "WHO SEES THE RESULTS" plus a `role="radiogroup"` div with a competing `aria-label="Visibility Setting"`; keep one name [src/pages/creator/new.astro:166-168]
- [x] [Review][Patch] Redundant/inconsistent focus patterns — `[pollId].astro` sets both `autofocus` and an inline focus script on the same `.outcome-line`; `new.astro` uses `autofocus` alone; `[reference].astro` puts `tabindex="-1"` on its 404 but focuses nothing. Pick one convention [src/pages/creator/polls/[pollId].astro:44,65-71, src/pages/creator/new.astro:120, src/pages/[reference].astro:46]
- [x] [Review][Patch] "It never changes." is printed under an origin that will change — `canonicalUrl` is built from `Astro.url.origin` and the custom domain is not bound yet; the reference is stable, the origin is not. Reword the promise [src/pages/creator/polls/[pollId].astro:28-30,53-55]
- [x] [Review][Patch] Deadline parser rejects seconds-bearing values — `CIVIL_PATTERN` accepts exactly `YYYY-MM-DDTHH:MM`; a `datetime-local` value with seconds (step attribute, non-browser client) fails as "didn't parse"; accept optional `:SS` [src/modules/polls/index.ts:61]
- [x] [Review][Patch] Missing visibility field silently defaults to `live` — `formData.get("visibility") ?? "live"` bypasses the `visibilityInvalid` guard on tampered submissions; default to `""` and let the domain reject it [src/pages/creator/new.astro:64]
- [x] [Review][Patch] No-JS add-option round-trip allows unbounded row growth — each `intent=add-option` POST appends a row with no cap; cap at `POLL_CAPS.maxOptions` [src/pages/creator/new.astro:82-85]
- [x] [Review][Patch] Early 422 for unparseable form bodies misses the AD-21 no-store header set on `Astro.response` [src/pages/creator/new.astro:69-71]
- [x] [Review][Patch] Reserved-slug registry misses `_astro` (asset prefix) and `favicon.svg` (public file) — Story 1.4 custom slugs could claim shadowed, unreachable paths [src/modules/polls/reserved-slugs.ts:5-14]
- [x] [Review][Patch] Generated references are never checked against the reserved-slug registry — Task 3 specifies "collision practically impossible, check still applied"; apply `isReservedSlug` in the reference-generation path (benign by construction, but spec'd) [src/modules/polls/index.ts:148-156,286-299]
- [x] [Review][Patch] No test verifies `new.astro` wins routing over the `creator/[...path].astro` catch-all — Task 5 says "verify with a test anyway"; the signed-out redirect assertion passes identically regardless of which page matched [tests/e2e/create-poll.spec.ts]
- [x] [Review][Patch] CHANGELOG.md not updated — AGENTS.md mandates user-facing changes under `## [Unreleased]`; poll creation is the most user-visible change to date and the changelog still ends at Story 1.2 [CHANGELOG.md]
- [x] [Review][Patch] Reserved-slug test/comment debt — the registry comment conflates per-poll sub-paths with first-segment slugs (`[reference].astro` matches single segments only); the e2e "reserved paths" test asserts `/sign-in` renders the sign-in page, which Astro's static-route precedence guarantees even if `isReservedSlug` were deleted; the "never generates a reserved slug" property test is vacuous (a 22-char base64url string can never equal a reserved word) [src/modules/polls/reserved-slugs.ts:16-18, tests/e2e/create-poll.spec.ts, tests/unit/polls.test.ts]
- [x] [Review][Patch] Adapter integration test cleanup relies on the FK cascade another file is meant to verify — `beforeEach` deletes only `poll` and trusts `ON DELETE CASCADE` to purge options/references, so a cascade regression corrupts this file's assertions instead of failing where it should; clean all three tables explicitly [tests/integration/polls-adapter.integration.test.ts]
- [x] [Review][Defer] Public poll page does a per-request D1 read with no caching decision — every bot scan and link preview of `/{anything}` hits `findPollByReference` and the page sets no `cache-control` (AD-21 governs creator surfaces only) — deferred: caching the public surface is a product/perf decision outside this story's ACs [src/pages/[reference].astro]
- [x] [Review][Defer] Closed/expired poll renders identically to open on the public page — `findPollByReference` fetches `deadline_ms`/`closed_at_ms` but the page never calls `effectivePollStatus` — deferred: closed-state rendering belongs to the Story 1.5 vote-path scope [src/pages/[reference].astro:15-47, src/adapters/d1/index.ts:110-121]

#### Review Findings — Round 2 (2026-07-29)

- [x] [Review][Patch] (D3, decision: Justin 2026-07-29 — accept e2e placement, add e2e to CI gate) Authenticated route-level coverage lives in Playwright e2e rather than the workerd integration layer Task 7 specified: amend Task 7's text to match reality, and add `pnpm test:e2e` to the CI deploy gate (the seeded-session spec must run in CI — provision throwaway env there) [tests/e2e/create-poll-authed.spec.mjs, .github/workflows/deploy.yml]
- [x] [Review][Patch] (D4, decision: Justin 2026-07-29 — build nonce dedupe) No-JS duplicate POST mints duplicate polls: render a per-form idempotency nonce in a hidden field and dedupe/reject a second publish carrying the same nonce (covers the no-JS double-click and retried-POST cases the disabled-on-submit fix can't) [src/pages/creator/new.astro, src/modules/polls/index.ts:286-341]
- [x] [Review][Patch] Reserved-slug registry still misses `fonts` — `public/fonts/` is a real top-level asset path; a Story 1.4 custom slug `fonts` would validate yet be unreachable [src/modules/polls/reserved-slugs.ts:5-14]
- [x] [Review][Patch] JS `addRow()` has no option cap — the no-JS path stops at `POLL_CAPS.maxOptions` (silently) while the JS path clones unbounded; the two paths of one feature enforce different limits [src/scripts/create-poll-form.ts:72-93]
- [x] [Review][Patch] Disable-on-submit drops the submitter's `intent` — disabling every `button[type="submit"]` in the submit handler excludes the submitter from the form entry list per the HTML spec; the flow survives only because `intent` defaults to `publish`. Don't disable the submitter (or write a hidden `intent` input before disabling) [src/scripts/create-poll-form.ts:108-117]
- [x] [Review][Patch] Reserved-path e2e comment still misattributes behavior — the `/sign-in` assertion pins Astro's static-route precedence (worth pinning), not the registry; fix the comment, the round-1 patch only removed the vacuous unit property test [tests/e2e/create-poll.spec.ts:25-35]
- [x] [Review][Patch] `?created` is a sticky outcome flag — a bookmarked/shared link announces "Your Poll is live." and titles "Poll created" on every visit forever; gate the outcome line on recent creation (e.g. within minutes of `created_at_ms`) [src/pages/creator/polls/[pollId].astro:27-35,43-47]
- [x] [Review][Patch] Deadline echo renders raw machine output — `Voting closes 2026-07-30T16:00:00.000Z.` (ms precision, `T`, `Z`) on a human confirmation surface; format plainly (e.g. `2026-07-30 16:00 UTC`) [src/pages/creator/polls/[pollId].astro:56-60]
- [x] [Review][Patch] Persistence-failure logging comment contradicts the behavior it documents — the comment says "never creator text bodies or SQL" while the code logs the raw driver message and the unit test pins `D1_ERROR: UNIQUE constraint failed…` as the expected payload; server-side driver messages are defensible — fix the comment to say the client only ever sees the stable code [src/modules/polls/index.ts:328-338, tests/unit/polls.test.ts]
- [x] [Review][Patch] e2e cleanup trusts the cascade the review itself flagged — `cleanupCreator` does `DELETE FROM poll` with a "cascades" comment, the exact pattern round-1 replaced in the adapter tests; delete all three tables explicitly [tests/e2e/creator-session.mjs:85-91]
- [x] [Review][Patch] Fractional seconds still rejected — `CIVIL_PATTERN` accepts `:SS` but not `:SS.sss`, which a sub-minute `step` or non-browser client can emit [src/modules/polls/index.ts:61]
- [x] [Review][Patch] Seeded-session e2e dies opaquely without `.dev.vars` — emit an explicit `test.skip` (with reason) when `BETTER_AUTH_SECRET` is absent instead of throwing at seed time [tests/e2e/creator-session.mjs:17-24]
- [x] [Review][Patch] Cookie-signing helper hand-copies better-call internals with no version guard — add a comment pinning the better-call version and upstream source it mirrors, so a better-auth bump is diagnosable as harness drift [tests/e2e/creator-session.mjs:51-78]
- [x] [Review][Patch] Multi-line descriptions collapse — the textarea accepts newlines but both pages render description in a single `<p>` with default whitespace handling; add `white-space: pre-wrap` (or strip newlines at validation — preserving is the fidelity-correct choice) [src/pages/[reference].astro, src/pages/creator/polls/[pollId].astro]
- [x] [Review][Patch] Redundant unnamed `role="radiogroup"` wrapper remains after the aria-label removal — fieldset+legend already provides the named group; remove the role [src/pages/creator/new.astro:166-168]
- [x] [Review][Patch] e2e D1 helpers are fragile — `d1Execute` swallows wrangler stderr (failures surface as opaque exit codes), `d1Query` will `JSON.parse` garbage if wrangler prints a warning to stdout, and IDs are interpolated into SQL strings (safe only because they're self-generated UUIDs — validate the shape or document the convention) [tests/e2e/creator-session.mjs:26-49, tests/e2e/create-poll-authed.spec.mjs]
- [x] [Review][Patch] Hidden implicit-publish submit is `aria-hidden="true"` yet focusable/clickable — the pattern a11y rules flag (aria-hidden-focus); prefer putting PUBLISH first in DOM order and restoring visual order with CSS `order` [src/pages/creator/new.astro:139-148]
- [x] [Review][Patch] Multipart File parts named `option` persist as literal `"[object File]"` — filter non-string entries at the boundary [src/pages/creator/new.astro:63]
- [x] [Review][Patch] 422 re-renders unbounded submitted option rows — an attacker-forced 422 re-renders thousands of rows; slice re-rendered options to `POLL_CAPS.maxOptions` [src/pages/creator/new.astro:76]
- [x] [Review][Patch] Reserved-slug regeneration loop is unbounded — a persistently-colliding `generateReference` spins until the worker CPU limit; bound to a few attempts then map to `poll_create_failed` [src/modules/polls/index.ts:297-299]
- [x] [Review][Patch] Disabled submits stay disabled after an aborted navigation — re-enable on `pageshow` so a creator whose POST aborted (offline, bfcache restore) can retry without reloading [src/scripts/create-poll-form.ts:108-117]
- [x] [Review][Patch] No-JS ADD OPTION test asserts row count only — fill fields first and assert all values preserved across the round-trip (the specified behavior); a regression that re-renders blank rows currently passes [tests/e2e/create-poll-authed.spec.mjs]
- [x] [Review][Defer] Owner can get "This Poll doesn't exist" on their own poll if it has zero canonical `poll_reference` rows — the partial unique index enforces at-most-one, not exactly-one; the inner join then yields null → 404 — deferred: latent corrupt-state handling, relevant when Story 1.4 starts writing custom references [src/adapters/d1/index.ts:123-132]

#### Review Findings — Round 3 (2026-07-29)

- [x] [Review][Patch] (D5, decision: Justin 2026-07-29 — generic contract) Strategy contract's future ports were `unknown` while the freeze document sold typed seams — resolved: `PollTypeStrategy` gained a `TPersistedFacts` generic so `persistFacts` produces what `projectResults` consumes; compile-time consumer test exercises the full four-port chain; design-check doc updated to match [src/shared/application/index.ts, src/modules/polls/types/multiple-choice.ts, docs/design/poll-type-contract-check.md]
- [x] [Review][Patch] HIGH — nonce dedupe silently discards an edited resubmission, and the dedupe policy lives in a route handler: publish → Back (bfcache restores the form with the same `poll_id`) → edit → PUBLISH → PK collision → silent 303 to the *first* poll's "Your Poll is live." confirmation while the edit vanishes. The e2e pins this as correct and never tests same-nonce-different-content. Also an AD-1 violation ("a route handler containing a business rule is a defect"): the route decides what a duplicate publish *means*, and because it sits in `.astro` frontmatter it has zero coverage whenever the authed e2e skips. Fix: move the dedupe decision into the polls module as a command outcome (domain compares submitted content against the existing poll: identical → return the existing poll id for redirect; different → a typed `duplicate` outcome the route maps to a 422 with a Voice line and a freshly minted nonce), unit-testable in the node project [src/pages/creator/new.astro:129-141, src/modules/polls/index.ts, tests/e2e/create-poll-authed.spec.mjs]
- [x] [Review][Patch] Dedupe recovery lookup is outside any error handling — on a genuine D1 outage `createPoll` returns `poll_create_failed` and the page's `findPollForOwner` then throws too, escaping as an unhandled 500 that destroys the form values, instead of the designed friendly 422. Wrap in try/catch and fall through to `formError` [src/pages/creator/new.astro:129-141]
- [x] [Review][Patch] Publish-time persistence failures return 422 and fold into telemetry as `result: "ok"` — 422 means "your input was invalid"; a server-side failure should be 500-family (same safe message) so the telemetry record reads `error` [src/pages/creator/new.astro, src/middleware.ts]
- [x] [Review][Patch] Tampered `intent` bypasses friendly handling and nukes the form — `z.enum` defaults only when missing; a present-but-invalid intent throws into the bare-text 422 with every field lost (the asymmetry round 2 deliberately fixed for `visibility`). File parts in `question`/`description`/`deadline`/`timezone`/`poll_id` hit the same hole — round 2's File filter covered only `option`. Filter non-strings on all fields and treat any intent other than `add-option` as publish [src/pages/creator/new.astro:35-43,66-90]
- [x] [Review][Patch] The 422 re-render slice (round 2) violates "every other field preserved" on exactly the submission that triggers the cap — 35 options fails with "Keep it to 30" and the repopulated form silently drops options 31–35; the no-JS add-option at the cap also no-ops silently with no message. Raise the re-render ceiling (e.g. 100 rows) and surface `optionsTooMany` when add-option is declined at the cap [src/pages/creator/new.astro]
- [x] [Review][Patch] CI's throwaway `.dev.vars` pins `BETTER_AUTH_URL=http://localhost:4321` while Playwright's webServer runs on `127.0.0.1:4391` — inert today (no base-URL-dependent auth path in e2e) but a trap for the first future test that touches one [.github/workflows/deploy.yml]
- [x] [Review][Patch] Fractional-seconds fix truncates instead of converting — `12:00:59` becomes `12:00:00.000` (poll closes up to 59s early) and the truncation happens before the future-ness check, manufacturing bogus "already passed" errors; pass seconds through to `Date.UTC` [src/modules/polls/index.ts:61,101-142]
- [x] [Review][Patch] Field caps count UTF-16 code units while the Voice copy says "characters" — an emoji-heavy question hits the 280 cap at ~140 visible characters; count code points (`[...str].length`) to match the copy [src/modules/polls/index.ts:168-194]
- [x] [Review][Patch] `?created` accepts any value and late retries land unexplained — `?created=lol` shows "Your Poll is live." within the window; a dedupe redirect arriving >10 min after publish shows no outcome line. Require the bare empty value and only append `?created` to the dedupe redirect when still inside the window [src/pages/creator/polls/[pollId].astro, src/pages/creator/new.astro]
- [x] [Review][Patch] PUT/DELETE/PATCH carrying a valid CSRF token get the 200 create form instead of 405 [src/pages/creator/new.astro:65]
- [x] [Review][Patch] No-ICU browser: `resolvedOptions().timeZone` can be `undefined`, which assigns the literal string "undefined" to the hidden field (harmless today — server falls back to UTC — but guard it) [src/scripts/create-poll-form.ts:13-22]
- [x] [Review][Patch] e2e seeding can flake on `database is locked` — `wrangler d1 execute --local` contends with the live dev server on the same SQLite file; retry on /locked|busy/i with backoff [tests/e2e/creator-session.mjs]
- [x] [Review][Patch] AGENTS.md not updated for the e2e CI gate — the gate-order line and the Verification table still describe the pre-e2e pipeline [AGENTS.md]
- [x] [Review][Patch] Confirmation copy claims "Anyone with this link can vote." while the linked page says "Voting opens in a coming release." — presently false; reword to a share-oriented line that doesn't claim voting works [src/pages/creator/polls/[pollId].astro]
- [x] [Review][Patch] `sprint-status.yaml` header comment `last_updated` (19:47) disagrees with the field (20:25) — sync the comment [sprint-status.yaml]
- [x] [Review][Defer] `poll_reference.is_canonical INTEGER NOT NULL DEFAULT 1` is the wrong default for a multi-reference table — a Story 1.4 custom-link insert that omits `is_canonical` defaults to 1 and explodes on the 0005 partial unique index — deferred: SQLite can't ALTER a column default (table rebuild); Story 1.4 must set `is_canonical` explicitly on every insert (noted for its spec) [db/migrations/0004_polls.sql:43-50]

#### Review Findings — Round 4 (2026-07-29)

- [x] [Review][Patch] Identical retry dies when the poll's own deadline has passed — `validateCreatePoll(draft, nowMs)` runs before the dedupe path, so a retried POST arriving after the deadline gets 422 "That Deadline has already passed" about a Poll that published successfully and is live. On a deadlinePast-only validation failure carrying a valid idempotency ID, attempt the dedupe lookup before failing [src/modules/polls/index.ts:380-400]
- [x] [Review][Patch] `CreatePollOutcome.existing` is dead weight — the only consumer never reads it (the `?created` suffix derives from `createdAtMs` alone); branch on the flag or delete it [src/modules/polls/index.ts:352, src/pages/creator/new.astro:162-168]
- [x] [Review][Patch] A transient dedupe-lookup failure on a legitimate retry renders "Nothing was created — try again." when something WAS created — the copy is a lie in exactly that case; use a distinct Voice line when an idempotency ID was present but confirmation failed [src/modules/polls/index.ts:461-491]
- [x] [Review][Patch] Content comparison has an unacknowledged timezone trap — a retry from a different browser profile/zone recomputes a different `deadlineMs` and is adjudicated "divergent" though the same civil time was typed; the "back-button edit" comment misdescribes it. Document the policy (deadline compares as resolved instants) [src/modules/polls/index.ts]
- [x] [Review][Patch] `pageshow` recovery doesn't remove the stamped hidden `intent` input — repeated aborted submits accumulate stamps; the oldest silently wins the moment any non-publish intent exists [src/scripts/create-poll-form.ts:145-160]
- [x] [Review][Patch] The 405 convention applies to only one of three new pages — POST/PUT/DELETE to `/creator/polls/{pollId}` or `/{reference}` render 200; and the existing 405's `allow` header omits HEAD which the check permits [src/pages/creator/polls/[pollId].astro, src/pages/[reference].astro, src/pages/creator/new.astro:24-33]
- [x] [Review][Patch] Branded IDs (`PollId`, `PollOptionId`, `UserId`) are exported as the kernel's "exclusive ownership" claim and consumed nowhere — every boundary passes plain `string`. Task 1 requires the brands; wire them into the port signatures (createPoll deps, PollPersistenceRows, adapter row types) [src/shared/domain/index.ts:8-10]
- [x] [Review][Patch] Deadline echo truncates the seconds the parser was just taught to keep — `iso.slice(11, 16)` renders "10:30 UTC" for a poll closing at 10:30:45; include seconds [src/pages/creator/polls/[pollId].astro:60-66]
- [x] [Review][Patch] DST-gap rejection reuses the "didn't parse" Voice line — a well-formed nonexistent wall time (spring-forward gap) tells the creator to check their formatting when the real problem is the time never occurs; return a distinct outcome with its own flat copy [src/modules/polls/index.ts:428-432]
- [x] [Review][Patch] Contract-freeze doc overstates the mechanism — `validateSubmission`/`persistFacts`/`projectResults` are optional members, so the minimal consumer test passes for a strategy that omits them forever; amend the freeze doc to state optionality is deliberate until 1.5/1.8 [docs/design/poll-type-contract-check.md, src/shared/application/index.ts:57-71]
- [x] [Review][Patch] `no-raw-html.test.mjs` scans only `.astro` — the first `.tsx`/`.jsx`/`.svelte` island voids the AC #5 guard silently (`dangerouslySetInnerHTML`, `{@html}`); extend the walker or pin the assumption in a comment [tests/unit/no-raw-html.test.mjs]
- [x] [Review][Patch] No-JS add-option cap counts blank rows — 2 filled + 28 blank rows gets "too many options" and can't add; the cap should count non-blank rows (validation's own rule) up to the render ceiling [src/pages/creator/new.astro:134]
- [x] [Review][Patch] Dead `visibility: z.string().default("live")` survives in the schema against the round-1 recorded decision — the call site always supplies a string so it never fires, but the declaration reintroduces the banned silent default for any future caller; default to `""` [src/pages/creator/new.astro]
- [x] [Review][Patch] Reserved-slug-exhaustion path returns `poll_create_failed` bare — every other `poll_create_failed` goes through the logging `createFailed(cause)`; the one signal that the reference generator is broken is logged nowhere [src/modules/polls/index.ts]
- [x] [Review][Patch] Round-3 `?created` hardening shipped without tests for its new branches — tampered value (`?created=lol`) and outside-the-window redirect/display are unasserted [src/pages/creator/polls/[pollId].astro, tests/e2e/create-poll-authed.spec.mjs]
- [x] [Review][Patch] Declined no-JS ADD OPTION returns 422 although nothing was validated — the add-option round-trip isn't a submission and the 30 on-screen options are valid; re-render 200 with the message as guidance [src/pages/creator/new.astro]
- [x] [Review][Defer] Every creator POST pays a double full-body parse — `readRequestCsrfToken` parses a cloned body in middleware and the page parses again; a large crafted multipart is fully materialized twice with no size cap anywhere in the chain — deferred: request-size policy is a platform decision above this story (mechanism predates 1.3; first route to exercise it) [src/lib/csrf.ts:194-213, src/pages/creator/new.astro]

#### Review Findings — Round 6 (2026-07-30)

- [x] [Review][Patch] Back-button edit retried after the poll's deadline hits the wrong error branch — nonce valid, `deadline_past` sole error, existing poll found, content diverges → the creator gets the misleading "Deadline has already passed" 422 with no fresh nonce, and every retry loops the same way. When the dedupe lookup succeeds and content diverges, return `poll_duplicate_divergent` (route mints a fresh nonce) instead of the validation error [src/modules/polls/index.ts:492-507]
- [x] [Review][Patch] Publish-success 303 is the one creator response missing `private, no-store` — round 5 hand-built no-store 303s for the guard redirects but the primary success redirect still uses `Astro.redirect`, which drops the header; AD-21 now holds on every creator response except the most common one [src/pages/creator/new.astro:179]
- [x] [Review][Patch] REMOVE destroys keyboard focus — removing the row a focused button sits in drops focus to `<body>`; a keyboard user managing up to 30 rows loses their place on every removal. Relocate focus to the adjacent row (input or remove control) in the remove handler [src/scripts/create-poll-form.ts]
- [x] [Review][Patch] Client enhancement imports the entire polls module for two numbers — `create-poll-form.ts` pulls `POLL_CAPS`/`RENDER_OPTION_CEILING` from `../modules/polls/index`, dragging the CreatePoll command, Voice catalog, dedupe policy, and reference generator into the browser chunk. Extract a tiny shared caps module both sides import [src/scripts/create-poll-form.ts, src/modules/polls/index.ts]
- [x] [Review][Patch] `reasonCodes` seam is only partially pinned — eleven reason strings emitted, exact shape asserted for two; add a table-driven test over the full failure matrix so future policy consumers can trust the contract [tests/unit/polls.test.ts]
- [x] [Review][Patch] Raw-HTML guard still misses the repo's actual island surface — `.ts` scripts under `src/scripts/` can inject creator text via `innerHTML`; add `[".ts", "innerHTML"]` to the walker (checking existing scripts comply first) [tests/unit/no-raw-html.test.mjs]
- [x] [Review][Patch] Unparseable-deadline 422 re-renders into a `datetime-local` input, which browser-sanitizes the invalid value to blank — "Check the date and time" shows beside an empty field with the offending input unrecoverable. Echo the entered value in the error line [src/pages/creator/new.astro]
- [x] [Review][Defer] The reachable sign-in redirect has no `cache-control` — `creatorGuardMiddleware` 303s every unauthenticated `/creator/*` request bare; the page-level redirects round 5 patched are dead code by comparison — deferred: pre-existing middleware from Story 1.2, not caused by this change; fix belongs to the middleware layer [src/middleware.ts:237-242]
- [x] [Review][Defer] The 10s idle-restore can re-enable PUBLISH while a legitimately slow POST is still in flight — a second click stacks two navigations (the nonce dedupe keeps the database safe; the UI outcome is whichever response wins) — deferred: accepted residual, recorded; a request-aware restore is a larger client redesign [src/scripts/create-poll-form.ts]

#### Review Findings — Round 5 (2026-07-30)

- [x] [Review][Patch] Case-flipped idempotency nonce defeats dedupe — `isUuidShape` is case-insensitive but the D1 TEXT PK compare is case-sensitive; an uppercased nonce sidesteps the PK collision and mints a duplicate Poll. Normalize to lowercase at the boundary [src/modules/polls/index.ts:358-361]
- [x] [Review][Patch] JS add-option cap counts DOM rows, no-JS counts non-blank — round 4 re-scoped the server cap to non-blank rows ("validation's own rule") but `syncAddButton()`/`addRow()` still count rendered rows including blanks: a JS creator with 28 filled + 2 blank gets a disabled ADD OPTION while no-JS gets another row — the same divergence class round 2 patched. Mirror the non-blank rule in the script [src/scripts/create-poll-form.ts:44-47,74-78]
- [x] [Review][Patch] `pageshow` doesn't cover abort-in-place — Esc/stop mid-POST fires no `pageshow`; the page stays with all submits disabled and the label stuck on "PUBLISHING…", recoverable only by reload. Add a safety timer that restores the idle state if the page is still around N seconds after submit [src/scripts/create-poll-form.ts:117-160]
- [x] [Review][Patch] Homepage still announces "Auth, poll creation, and voting land in later stories" — auth shipped in 1.2, poll creation in this diff; the live landing page contradicts the CHANGELOG [src/pages/index.astro:42-47]
- [x] [Review][Patch] Stale comment from the seconds change — the confirmation-page comment still documents "date, space, HH:MM" while the code renders HH:MM:SS [src/pages/creator/polls/[pollId].astro:100-108]
- [x] [Review][Patch] Extended walker omits `.vue`/`v-html` — Vue is a first-party Astro integration; one official renderer can still silently void the AC #5 guard [tests/unit/no-raw-html.test.mjs:11-17]
- [x] [Review][Patch] Round 4 shipped branches without tests (the pattern it flagged in round 3): declined no-JS ADD OPTION (200 + note), the `RENDER_OPTION_CEILING` slice, and the retry-after-deadline lookup-failure fallthrough have no committed assertions [src/pages/creator/new.astro:167-186, src/modules/polls/index.ts:501-520]
- [x] [Review][Patch] Dedupe control flow keys off user-facing prose — `isOnlyDeadlinePastError` compares against `CREATE_POLL_COPY.deadlinePast`; editing a word in the copy catalog silently disables the retry-after-deadline dedupe, and the tests reference the same constant so nothing catches it. Key policy off a stable code/sentinel, not rendered copy [src/modules/polls/index.ts:878-885]
- [x] [Review][Patch] Every REMOVE button has the identical accessible name "REMOVE" — up to 30 indistinguishable controls in a screen-reader's button list; `renumber()` should give each a per-row name (e.g. `aria-label="Remove option 3"`) [src/scripts/create-poll-form.ts:61-78,96-108]
- [x] [Review][Patch] Neither 404 state has a heading — unknown `/{reference}` and unknown `/creator/polls/{pollId}` render bare `<p>` copy; every other state of those pages has an `<h1>` [src/pages/[reference].astro:52-56, src/pages/creator/polls/[pollId].astro:113-118]
- [x] [Review][Patch] `optionNote` reuses `optionsTooMany` for render-ceiling declines — a crafted body with ≥100 rows but ≤30 non-blank is told "Keep it to 30" while holding 2 valid options; the two decline causes were separated in code but not in copy [src/pages/creator/new.astro:172-186]
- [x] [Review][Patch] The two defense-in-depth `Astro.redirect` early returns carry no `cache-control` — round 1 patched the other early returns for AD-21 with a comment saying "early returns too"; a returned Response bypasses headers set on `Astro.response` [src/pages/creator/new.astro:28-33, src/pages/creator/polls/[pollId].astro:23-29]
- [x] [Review][Patch] e2e harness hardcodes `http://127.0.0.1:4391` as a fallback in four places while `playwright.config.ts` owns the port — change the config port and cookies/Origin headers silently target the wrong origin (opaque 403s) [tests/e2e/creator-session.mjs:60-65]
- [x] [Review][Patch] "Check your Polls before trying again" directs the creator to a surface that doesn't exist — `/creator` is a placeholder ("Poll management will appear here"); the same class as round 3's "can vote" fix. Reword to an action the creator can actually take [src/modules/polls/index.ts]

## Dev Notes

### Decisions resolved at story-creation time (Justin, 2026-07-29)

| Gap (unspecified in PRD/UX/epics) | Decision |
| --- | --- |
| Visibility default | **Live** — the form's initial state selects Live |
| Duplicate option labels | **Rejected** — exact duplicates after trimming get a 422 with new voice-consistent copy (see copy table) |
| Deadline timezone | `datetime-local` + JS-filled hidden IANA tz; no-JS fallback interprets as UTC and echoes the resolved time on confirmation |
| Description at creation | **Included** as an optional field (FR-5's editable description + AC #4's 5,000-char cap imply it exists here) |
| `discovery_state` ownership (spine gap) | Column on `poll`; CreatePoll writes only the fixed `'unlisted'` default (initialization); transitions are Discovery-module commands from Story 3.1 |

### Scope boundaries — build none of these

- **Custom Links** → Story 1.4 (the `poll_reference` table and reserved-slug registry from this story are its landing pad; no slug form field now)
- **Vote submission, session claims, idempotency, AD-7 transaction** → Story 1.5 (this story's root-path page renders the open Poll; voting arrives next)
- **Multi-select toggle + min/max bounds** → Story 1.7 (single-select only; schema deliberately omits multi-select columns — 1.7 adds them expand-style)
- **Results/visibility rendering** → 1.8; **Share action control** → 1.13 (confirmation shows the URL as text only)
- **Security Toggle UI (IP Checks, CAPTCHA)** → Epic 2 (this story persists only `session_checks_enabled=1`)
- **Discovery opt-in control** → Story 3.1 (UX places it on `/creator/new`, but FR-23 is epic-assigned to 3.1; this story persists the `unlisted` default with no control) — note the same FR-2 tension exists PRD-wide: FR-2 says every §4.6/§4.7 setting is configurable at creation; the epic decomposition intentionally staggers them
- **Rate limiting on creation** (NFR-7) — the rate-limit adapter stays a stub; not bound to this story by the capability map
- **No draft state** — a Poll is live from creation (AD-17, PRD §4.1); do not build save-for-later

### AD-3 — the creation transaction (verbatim)

"`CreatePoll` validates the shared fields, asks exactly one Poll Type strategy for normalized creation facts, and commits the Poll, type facts, options or slots, slug reservation, and adopted media records in one D1 batch. A failed batch leaves no reachable Poll." Each Poll Type implements the same `create`, `validateSubmission`, `persistFacts`, `projectResults` ports. Facts are relational rows, never opaque JSON. [Source: ARCHITECTURE-SPINE.md#AD-3]

The multiple-choice strategy is the precedent-setter: shape the contract so ranked ballots (ordered selections), image adoption (R2 records in the same batch), and meeting slots (slot rows + later revision) each fit without reshaping it — that is exactly what the AC #6 design check verifies before freeze.

### Architecture constraints that bind this story

- **AD-1 dependency direction:** pages → application commands → domain + ports; domain imports neither Astro nor provider APIs; the D1 repository implements a port and never calls delivery code.
- **AD-13 references:** internal entities are UUID strings; public references are ≥96-bit base64url at the root path; canonical URLs never change when display text changes. One reserved-slug registry shared by routing and slug validation.
- **AD-17 lifecycle:** immediately open, no draft state; post-first-Vote immutability is enforced from 1.5 — nothing to build here beyond not inventing a draft.
- **AD-24:** `representation_version` starts at 1 in the creation batch; increments go through one shared-kernel helper in later stories — creation just initializes the column.
- **AD-19 write paths:** only Polls-module commands write `poll`/`poll_option`/`poll_reference`.
- **AD-21/AR-17 caching:** creator responses are `private, no-store`.
- **Consistency Conventions:** POST → 303 success / 422 re-render with safe values + field errors, on the SAME route (a form page POST, not a JSON API route — `src/pages/api/sign-in.ts` is NOT the pattern here); Zod at the delivery boundary AND domain invariants re-enforced in constructors; stable error codes, never SQL detail; UTC Unix-ms INTEGER domain timestamps; kebab-case files, snake_case SQL. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions]
- **AD-2 progressive enhancement:** the whole form works with JavaScript off — option add/remove included (server round-trip pattern in Task 5); enhancements are isolated vanilla TS.

### Middleware is already built — consume, don't rebuild

`src/middleware.ts` runs `sequence(requestContext, telemetry, session, csrf, creatorGuard)`. The guard 303s unauthenticated `/creator*` requests to `/sign-in?return={path}` (session-expiry Voice line included); csrfMiddleware enforces the session-bound token on creator POSTs — render the hidden `csrf_token` field and everything else is free. Session principal: `Astro.locals.requestContext` (nullable principal with internal user id) — that internal UUID is the ownership key written to `poll.owner_user_id`; never a provider pair (AD-4).

### UX contract — exact copy catalog

Validation messages (verbatim, EXPERIENCE.md Voice and Tone; bold lead sentence in source):

| Case | Copy |
| --- | --- |
| Zero options | **A Poll needs options.** Add at least two. |
| One option | **One option isn't a Poll.** Add at least one more. |
| Past deadline | **That Deadline has already passed.** The Poll would close before anyone saw it. |
| Duplicate options (new copy, this story) | **Two options say the same thing.** Make one of them different. `[ASSUMPTION: new line — follow voice rules: flat, no exclamation, layout-neutral]` |
| Over-cap input | Name the field plainly in the same idiom, e.g. **That question is too long.** Keep it under 280 characters. `[ASSUMPTION: new lines per field]` |

Visibility consequence lines (verbatim): Live — "anyone with the link watches the count move"; After Close — "Voters see a confirmation until the Poll closes"; Creator-Only — "only you ever see the Tally".

Form rules: validate on submit, never on blur; error inline beneath the offending field in `caption` with `alarm` bottom rule; never a tooltip, modal, or top-of-form summary; label above field always (`label-caps`/`dim`); rest of form preserved. [Source: EXPERIENCE.md#Component Patterns, #State Patterns]

Bans that bite this page: required-field asterisks, section headings inside a poll form beyond grouping whitespace, progress steps, spinners, toasts, drag interactions, icon-only buttons, rounded corners, shadows, motion of any kind (the five motion primitives all belong to results surfaces), bold Newsreader, `faint` on readable text. Whitespace is the grouping mechanism — space before rule, rule before box. [Source: DESIGN.md#Layout, #Interaction Primitives, #Anti-patterns]

Tokens: page title `heading-lg` (Newsreader 24/400); labels `label-caps`; inputs/body `body` (Courier Prime 14/1.65); buttons `button` (13/700/0.22em caps); errors `caption`; gold fills `solar-*`, gold ink `solar-ink-*`; every focus outline `focus-ring` 2px offset 2px. One `button-primary` per screen. All primitives exist in `src/components/` — consume, never restyle. `poll-option`'s current implementation uses a real `<span>` marker (accepted 1.1 deviation, noted in deferred-work.md) — reuse as-is.

Post-submit contract (confirmation render): outcome line first in main landmark, `tabindex="-1"`, focused on load, `<title>` leads with outcome. Pattern proven in Story 1.2's sign-in outcomes — copy that implementation approach. [Source: EXPERIENCE.md#Accessibility Floor]

### Previous story intelligence (1.2 Dev Agent Record + reviews)

- Env bindings come from `env` of `cloudflare:workers` (Astro 7.1.5 removed `context.locals.runtime.env`) — the D1 repository factory should follow `src/adapters/auth/index.ts`'s pattern.
- UUID generation: `crypto.randomUUID()`; Better Auth uses `advanced.database.generateId: "uuid"` — domain rows generate their own UUIDs in the command layer.
- Deploys use `scripts/deploy.mjs` (split ESM graph, `no_bundle` — workers-sdk #14922); `CLOUDFLARE_ENV` required at build; staging `https://oddspark-polls-staging.hearnsystems.workers.dev`, production `https://oddspark-polls.hearnsystems.workers.dev`; custom domain not yet bound — canonical URLs render from the request origin, don't hardcode `polls.oddspark.dev`.
- Migration guard rejects unlisted migrations — regenerate the manifest in the same change; migration 0002's ISO-TEXT timestamps are an auth-only exception, domain tables stay Unix-ms INTEGER.
- Vitest: unit config is node-env; integration config injects `TEST_MIGRATIONS` via `readD1Migrations("./db/migrations")` and aliases `astro:middleware` to the shim so tests exercise the real middleware chain — extend those files, don't fork new configs.
- Telemetry: one structured record per operation; never log creator text bodies, only IDs/codes/durations (AD-15).
- Review-round lesson: unguarded provider/D1 calls and double-emitted telemetry were round-1 findings in 1.2 — wrap the repository call in the command's single telemetry envelope and let errors map to stable codes once.

### Project Structure Notes

- New files: `src/pages/creator/new.astro`, `src/pages/creator/polls/[pollId].astro` (confirmation), `src/pages/[reference].astro`, `src/modules/polls/index.ts` (replaces placeholder), `src/modules/polls/types/multiple-choice.ts`, `src/modules/polls/reserved-slugs.ts`, `src/shared/domain/index.ts` + `src/shared/application/index.ts` (replace placeholders), `src/adapters/d1/index.ts` (replaces placeholder), `db/migrations/0004_polls.sql`, `docs/design/poll-type-contract-check.md`, option-row enhancement script under `src/scripts/`
- `src/pages/creator/[...path].astro` catch-all exists from 1.2 — confirm Astro's static-over-dynamic route priority serves `new.astro` and the confirmation route ahead of it (it does; verify with a test anyway)
- kebab-case filenames; module code provider-free; adapters implement ports

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3] (lines 274–307) — story statement + 6 ACs + caps
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1] (line 157) — de-risk rule #1 (strategy contract paper-check), primitives-consume-never-restyle
- [Source: ARCHITECTURE-SPINE.md#AD-3, #AD-5, #AD-11, #AD-13, #AD-17, #AD-19, #AD-23, #AD-24] — creation transaction, discovery split, deadline semantics, references, lifecycle, write paths, shared kernel, representation version
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions, #Structural Seed] — HTTP/validation/error/time/naming rules; module tree
- [Source: prd.md#§3 Glossary, #§4.1 FR-2/FR-4/FR-5, #§4.7 FR-20/FR-23, #§4.6 FR-15, #§5 NFRs, #§6 Non-goals] — creation data contract, defaults, escaping, scope
- [Source: DESIGN.md#Components (input, button-primary, poll-option, security-toggle), #Colors, #Typography, #Layout, #Shapes, #Anti-patterns] — full visual contract (no creation-form mockup exists; prose is the contract)
- [Source: EXPERIENCE.md#Information Architecture, #UJ-1, #UJ-6, #Voice and Tone, #Component Patterns, #State Patterns, #Accessibility Floor] — route, form order, copy catalog, validation behavior, post-submit contract
- [Source: _bmad-output/implementation-artifacts/1-2-creator-sign-in-with-google-or-github.md#Dev Agent Record] — env/binding/deploy/test-harness specifics
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — known accepted deviations (poll-option marker span; astro check absent)

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5)

### Debug Log References

- **Migration 0004 applied to all three environments.** Local first; staging and production applied 2026-07-29 with Justin's explicit approval (wrangler ✅ per environment; `poll`, `poll_option`, `poll_reference` verified present in production `sqlite_master`). The migration is additive, so deployed 1.2 code is unaffected.
- Integration D1 storage persists across tests within a file — `applyD1Migrations` only applies pending migrations, so seed inserts must be idempotent (`INSERT OR IGNORE`) with per-file cleanup (`DELETE FROM poll`).
- ON DELETE CASCADE fires in workerd local D1 (foreign keys enforced by default) — the cascade and FK-violation schema tests pass without any pragma.
- Authenticated end-to-end validation used a scripted local smoke (scratchpad, not committed): seeded a Better Auth session directly in local D1, signed the session cookie with the better-call HMAC format (`token.base64HMAC`, URL-encoded) using the local `BETTER_AUTH_SECRET`, and drove the real dev server through GET form → invalid POST (422 with exact Voice copy, values preserved) → publish with an XSS probe → 303 → confirmation (outcome line, title, canonical URL) → root-path poll page. 20/20 assertions passed; persisted row verified (`result_visibility='after_close'` as submitted, `discovery_state='unlisted'`, `session_checks_enabled=1`, `representation_version=1`); smoke rows deleted afterward.
- Full Playwright coverage of the authenticated create flow would require automating a real OAuth consent screen (same constraint Story 1.2 recorded); the smoke above plus middleware-level integration tests stand in. E2E covers the signed-out redirect, unknown-reference 404, and reserved-path routing.
- `civilToUtcMs` converts civil datetime + IANA zone to UTC by iterating the Intl-derived zone offset twice (DST-transition convergence); invalid or absent zones take the approved UTC-interpretation path.
- Environment note: local Node is v22.18.0 vs the pinned 24.18.0 (pnpm engine warning); all suites, builds, and wrangler operations succeeded regardless.

### Completion Notes List

- Task 1: shared kernel created — branded IDs, `PollType`/`ResultVisibility`/`DiscoveryState` enums, derived `effectivePollStatus` (AD-11); versioned `PollTypeStrategy` contract (v1) with the four AD-3 ports (`create` required now; the rest declared for 1.5/1.8); error envelope + `Result` type; design check written and contract frozen (`docs/design/poll-type-contract-check.md`); compile-time consumer test in place. 10 unit tests.
- Task 2: migration `0004_polls.sql` (poll, poll_option, poll_reference; discrete columns, Unix-ms timestamps, cascade FKs, unique positions) + manifest regenerated + guard green; applied to local D1. 5 schema integration tests (tables, columns/defaults, cascade, FK enforcement, uniqueness).
- Task 3: polls module — `validateCreatePoll` (trims, drops blank rows, enforces 2–30 options, 280/100/5,000 caps, duplicate rejection, visibility enum, future deadline), `civilToUtcMs`, `generatePollReference` (128-bit base64url, fast-check property-tested), reserved-slug registry, `CREATE_POLL_COPY` catalog with the three verbatim epic lines, `createPoll` command mapping persistence failures to the stable `poll_create_failed` code. 42 unit tests.
- Task 4: D1 adapter `createPollPersistence` — `insertPoll` commits poll + options + reference in one `DB.batch()` (atomicity proven by a forced-failure test asserting zero surviving rows), `findPollByReference`, `findPollForOwner` (ownership-scoped, internal user ID per AD-4). 5 integration tests.
- Task 5: `/creator/new` — single-column token-bound form (question/options via the `input` primitive, visibility chooser as three `poll-option` rows with verbatim consequence lines defaulting to Live, optional datetime-local deadline with hidden IANA-zone field, optional description textarea, hidden `csrf_token`); POST to the same route with 422 re-render preserving all values and inline `caption`/`alarm` errors; success POST → 303; no-JS ADD OPTION server round-trip with blank-rows-are-removed semantics; JS enhancement (`src/scripts/create-poll-form.ts`) adds/removes rows with text-labelled REMOVE, fills the timezone, and swaps the publish label to PUBLISHING…; `private, no-store` on all creator responses.
- Task 6: create-confirmation at `/creator/polls/{pollId}?created` — outcome line "Your Poll is live." first in main, `tabindex="-1"`, focused, `<title>` = "Poll created — Oddspark Polls", canonical URL as selectable text (Share control deferred to 1.13); root-path `[reference].astro` resolves via the reserved-slug registry + `poll_reference`, renders question/options server-side with zero framework payload, plain 404 otherwise; `set:html` guard test enforces AC #5 repo-wide; `poll-option` primitive extended with the spec's consequence-line prop and `input` with `aria-describedby` (extensions per DESIGN.md, no restyling).
- Task 7 + gates: 148 Vitest tests (16 files) including 62 new, 11 Playwright e2e (3 new), `tsc --noEmit`, migrations guard, and production build all green; no regressions in the 1.1/1.2 suites; scripted authenticated smoke (see Debug Log) covered the full happy path, validation copy, and escaping on the live dev server.

### File List

- `_bmad-output/implementation-artifacts/1-3-create-a-multiple-choice-poll.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `db/migrations/0004_polls.sql`
- `db/migrations.manifest.json`
- `docs/design/poll-type-contract-check.md`
- `src/adapters/d1/index.ts`
- `src/components/input.astro`
- `src/components/poll-option.astro`
- `src/modules/polls/index.ts`
- `src/modules/polls/reserved-slugs.ts`
- `src/modules/polls/types/multiple-choice.ts`
- `src/pages/[reference].astro`
- `src/pages/creator/new.astro`
- `src/pages/creator/polls/[pollId].astro`
- `src/scripts/create-poll-form.ts`
- `src/shared/application/index.ts`
- `src/shared/domain/index.ts`
- `tests/e2e/create-poll.spec.ts`
- `tests/integration/create-poll-route.integration.test.ts`
- `tests/integration/polls-adapter.integration.test.ts`
- `tests/integration/polls-schema.integration.test.ts`
- `tests/unit/no-raw-html.test.mjs`
- `tests/unit/polls.test.ts`
- `tests/unit/shared-kernel.test.ts`

### Change Log

- 2026-07-29: Implemented Story 1.3 — shared kernel + frozen Poll Type strategy contract (v1) with written four-type design check; polls schema migration 0004 (local D1 applied); provider-free CreatePoll domain command with the full validation/Voice catalog; atomic D1 creation batch; `/creator/new` form with no-JS parity, create-confirmation, and root-path reference page. 62 new Vitest tests + 3 e2e specs; full suites, typecheck, migrations guard, and production build green; authenticated flow validated end-to-end against the local dev server including XSS escaping.
- 2026-07-29: Migration 0004 applied to staging and production D1 with explicit approval; all three environments now run identical schema (tables verified in production `sqlite_master`).
