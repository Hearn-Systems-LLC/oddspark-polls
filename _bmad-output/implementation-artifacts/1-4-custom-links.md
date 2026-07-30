---
baseline_commit: 5fa65b5c5b94416d11fa64838e39af98a03be766
---

# Story 1.4: Custom Links

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Prerequisite: Story 1.3 is in `review` with its work uncommitted in the working tree. 1.4 builds directly on those files — start only after 1.3's review closes and its work is committed. -->

## Story

As a Creator,
I want to give my Poll a readable custom link like `/team-lunch`,
so that the URL itself is memorable and shareable.

## Acceptance Criteria

1. **Given** a Creator assigning a Custom Link at creation, **When** the slug contains only lowercase letters, digits, and hyphens and is unclaimed and unreserved, **Then** `polls.oddspark.dev/{custom-link}` resolves to the Poll and the random reference is replaced as the canonical URL (FR-3).
2. **Given** a slug already in use, **When** submitted, **Then** the form re-renders with "`{slug}` is taken. Pick another." inline, everything else preserved.
3. **Given** a slug in the reserved set (`/`, `/creator/*`, `/discover`, `/sign-in`, `/assets/*`, `/api/*`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml`, `results`, `manifest`), **When** submitted, **Then** it is rejected with "`{slug}` is reserved by the application itself. Pick something less structural.", **And** routing and slug validation import the same single reserved-slug registry (AD-13).

## Tasks / Subtasks

- [x] Task 1: Slug validation in the polls domain module (AC: #1, #3)
  - [x] `src/modules/polls/index.ts`: extend `CreatePollDraft` with `customLink: string` and `ValidatedCreatePoll` with `customLink: string | null`. Normalize (trim, then lowercase-fold `[ASSUMPTION: forgiving normalization, consistent with isReservedSlug's lowercase comparison]`), then validate: blank → `null` (generated-reference path, unchanged); non-blank must match `^[a-z0-9-]+$` and be ≤ 63 chars `[ASSUMPTION: cap unspecified in PRD/UX; 63 = DNS-label convention]`; then reject reserved via the EXISTING `isReservedSlug` from `src/modules/polls/reserved-slugs.ts` — do NOT write a second list (AC #3, AD-13)
  - [x] Extend `CREATE_POLL_COPY` (all follow the voice rules — flat, layout-neutral, no exclamation): `customLinkInvalid` `[ASSUMPTION: new line]`: "A Custom Link uses lowercase letters, digits, and hyphens. Nothing else." · `customLinkTooLong` `[ASSUMPTION: new line]`: "That Custom Link is too long. Keep it to 63 characters." · `customLinkReserved` (verbatim, epic): `` "`{slug}` is reserved by the application itself. Pick something less structural." `` · `customLinkTaken` (verbatim, epic): `` "`{slug}` is taken. Pick another." `` — `{slug}` interpolated at render with the normalized submitted value (Astro's default escaping applies; slugs reaching taken/reserved have already passed the charset gate)
  - [x] Validation order per field: format → length → reserved. "Taken" is NOT pre-checked here — uniqueness is decided by the D1 constraint inside the batch (AD-16: only D1 constraints are authoritative; a read-then-write availability check would be a race)
- [x] Task 2: Reference row + taken-collision mapping in command and adapter (AC: #1, #2)
  - [x] `src/modules/polls/index.ts`: when `customLink` is present, the batch's single reference row is the custom slug — `reference: { reference: customLink, kind: "custom", ... }` — and NO generated reference is created `[ASSUMPTION: "replaced as canonical" + Glossary "replacing the random Poll ID" read as substitution; one URL per Poll, no second guessable random URL]`; widen `PollPersistenceRows.reference.kind` to `"generated" | "custom"`; blank customLink keeps today's generated path byte-for-byte
  - [x] `src/adapters/d1/index.ts` `insertPoll`: on batch failure, detect the reference-uniqueness violation (D1 error message contains `UNIQUE constraint failed: poll_reference.reference` — the PK) and rethrow/return a distinguishable typed error (e.g. `ReferenceTakenError`); all other failures stay generic
  - [x] `createPoll` command: map the taken error to `fieldErrors.customLink = customLinkTaken` (422 re-render path) instead of the generic `poll_create_failed`; only when the draft had a custom link — a generated-reference collision (~impossible at 128 bits) stays the generic failure. The failed batch leaves no rows (AD-3 atomicity, already proven by 1.3's forced-failure test)
  - [x] NO migration: `poll_reference` (PK `reference`, `kind`, `is_canonical` default 1) already holds everything this story needs — the table was shaped in 1.3 exactly for this (`db/migrations/0004_polls.sql` comment). Custom and generated references share one namespace/one uniqueness constraint by construction
- [x] Task 3: Custom Link field on `/creator/new` (AC: #1, #2, #3)
  - [x] `src/pages/creator/new.astro`: add an optional field on the existing `input` primitive — label `CUSTOM LINK (OPTIONAL)` `[ASSUMPTION: label string unspecified; matches DEADLINE (OPTIONAL) idiom]` — placed after Deadline, before Description `[ASSUMPTION: UJ-1 narrative order — visibility, deadline, then custom link]`; helper note in the existing `helper-note` idiom `[ASSUMPTION: no helper text specified; layout-neutral, factual]`: "Lowercase letters, digits, and hyphens. Leave blank for a random link."
  - [x] Wire into the existing flow: form schema gains `customLink` (string, default ""), `values` carries it through the ADD OPTION round-trip and every 422 re-render (ballast preservation is already the page's pattern — extend, don't fork); error renders inline beneath the field in `caption`/`alarm` with `aria-describedby` via the input's `describedby` prop (the primitive already supports it, added in 1.3)
  - [x] Validate on submit ONLY — never on blur, no debounce, no async availability check, no "available" affirmative state, no URL preview while typing (EXPERIENCE.md hard rule; the `input-code` precedent explicitly rejects pre-submit checks as "a lie" — availability at typing time isn't availability at submit time). Do not autofocus the field
  - [x] No JS enhancement needed: `src/scripts/create-poll-form.ts` untouched unless the field breaks its row-indexing assumptions — verify it doesn't (it targets `[data-option-row]` only)
- [x] Task 4: Routing already resolves custom slugs — verify, don't build (AC: #1)
  - [x] `src/pages/[reference].astro` resolves ANY `poll_reference` row kind-agnostically and checks `isReservedSlug` first — confirm a created `/team-lunch` renders the poll page with zero changes to this file *(true at implementation; the review round later added the case-variant redirect fallback to this file — see Review Findings)*
  - [x] Confirmation page `src/pages/creator/polls/[pollId].astro` renders `canonicalReference` via `findPollForOwner` (`is_canonical = 1` join) — with the custom row canonical, the full custom URL appears with "It never changes." — zero changes expected; verify by test
- [x] Task 5: Tests + gates (AC: all)
  - [x] Unit (`tests/unit/polls.test.ts`): validation matrix — blank → null; valid `team-lunch`; uppercase `Team-Lunch` folds to valid; invalid chars (space, `/`, `_`, unicode, `.`) → invalid copy; 63/64 boundary; every reserved-registry entry rejected with reserved copy (import the registry, don't hand-copy the list); normalization idempotence; `PollPersistenceRows.kind` values
  - [x] Integration (`tests/integration/` — extend the 1.3 files): POST `/creator/new` with custom link → 303, `poll_reference` row `kind='custom'`, `is_canonical=1`, no generated row; duplicate slug (seed one, submit same) → 422 with exact taken copy, all other fields preserved, zero partial rows from the failed batch; reserved slug (`creator`, `results`) → 422 with exact reserved copy; created slug resolves at `/{slug}` (route test); mixed-case submission persists lowercase
  - [x] E2E (`tests/e2e/create-poll.spec.ts`): form shows the Custom Link field with its label; signed-out redirect still passes (regression)
  - [x] Gates: full Vitest suite, `pnpm check`, `pnpm migrations:guard` (manifest unchanged — no new migration), production build — all green before story-done

### Review Findings

- [x] [Review][Decision] Case-variant public URL 404s an existing custom link — severity: medium. Creation folds to lowercase (`src/modules/polls/index.ts:266`) but the public resolver passes the raw param into a BINARY-collated lookup (`src/pages/[reference].astro:12,23-25` → `src/adapters/d1/index.ts:146`), so a voter visiting `/Team-Lunch` (phone autocapitalize, chat-client case mangling) gets "This Poll doesn't exist." A blanket lowercase on the read is NOT safe: generated references are base64url with uppercase (`src/modules/polls/index.ts:202`). **Resolved (Justin, 2026-07-30): redirect to canonical.** Exact lookup, then a NOCASE lookup restricted to `kind='custom'` (`findCanonicalCustomReference`), 301 to `/{canonical}`; generated references pinned case-sensitive. Covered by adapter integration tests and e2e (`/TEAM-Lunch` → 301, case-mangled generated ref → 404).
- [x] [Review][Decision] Validation-order re-interpretation favors AC #3 over Task 1's stated format → length → reserved — severity: low. `isReservedSlug` runs first and exact registry matches bypass the charset gate (`src/modules/polls/index.ts:267-291`), because AC #3's reserved set (`/`, `favicon.ico`, `_astro`) can never pass the charset — the spec is internally contradictory. Side effect: the registry now drives error-copy routing, so adding a future reserved entry changes which copy a charset-invalid value receives. **Ratified as-is (Justin, 2026-07-30):** AC #3 wins over Task 1's ordering; behavior and the data-driven test matrix stand.
- [x] [Review][Decision] Task 5's prescribed integration-test matrix relocated to Playwright e2e — severity: low. POST → 303 + custom-row assertions, duplicate → 422 with ballast/rollback, reserved → 422, `/{slug}` → 200, mixed-case persistence all live in `tests/e2e/create-poll-authed.spec.mjs`; `tests/integration/create-poll-route.integration.test.ts` is untouched despite being in the story's own Files-changed note, and the label assertion landed in the authed spec instead of `create-poll.spec.ts` (forced: signed-out visitors redirect away). **Ratified as-is (Justin, 2026-07-30):** the e2e suite runs in the deploy gate against the real stack; no backfill. The stale "Playwright can't drive the authenticated flow" note in Previous story intelligence is corrected — the seeded-session harness can.
- [x] [Review][Patch] 63-char cap is a magic number outside `POLL_CAPS` with the literal duplicated in copy and check [src/modules/polls/index.ts:77-78, :279] — fixed: `POLL_CAPS.maxCustomLinkLength`, interpolated into `customLinkTooLong`
- [x] [Review][Patch] Normalization `(draft.customLink ?? "").trim().toLowerCase()` duplicated between validation and the deadline-past dedupe path — "mirrors exactly" is a promise nothing enforces [src/modules/polls/index.ts:266, :504] — fixed: shared `normalizeCustomLink` helper
- [x] [Review][Patch] Slug input lacks mobile hints (`autocapitalize="none"`, `spellcheck="false"`, `autocomplete="off"`) on a lowercase-only field — iOS autocapitalize guarantees the raw/normalized mismatch [src/pages/creator/new.astro:332-342, src/components/input.astro] — fixed: pass-through props on the Input primitive, set on the slug field, pinned in e2e
- [x] [Review][Patch] Error-state `aria-describedby` announces the helper before the error, unlike sibling fields — swap to error-first order [src/pages/creator/new.astro:339-341] — fixed: `custom-link-error custom-link-help`, pinned in e2e
- [x] [Review][Defer] Taken-collision detection substring-matches D1 driver error text [src/adapters/d1/index.ts:131-138] — deferred, pre-existing: D1 exposes no structured error code, message text is the only signal; same accepted pattern as `DuplicatePollIdError` from Story 1.3
- [x] [Review][Defer] `poll_reference.kind` has no CHECK constraint; `canonicalReferenceKind` is an unchecked cast — an out-of-union value silently turns D4 retries into "already published" errors [db/migrations/0004_polls.sql, src/adapters/d1/index.ts:166-170] — deferred, pre-existing: schema shipped in 1.3; Story 1.4's no-new-migration constraint forbids the fix here
- [x] [Review][Defer] Migration 0004's comment permanently describes the superseded "alongside the generated one" design [db/migrations/0004_polls.sql:40-41] — deferred, pre-existing: migrations are immutable by policy (AD-14); substitution design is recorded in this story's decisions table instead

#### Review round 2 (re-review of the patch round)

- [x] [Review][Patch] Redirect hardening: the NOCASE fallback runs on every unknown reference (second D1 round trip on ordinary garbage 404s, full-table scan — the BINARY PK can't serve a COLLATE NOCASE lookup); `canonical` is never checked against the requested reference (self-301 loop if a custom row's poll is unreachable via the JOIN); the DB value flows into `Location` with no read-side charset guard; the query string is dropped; and the bare 301 has no `Cache-Control`, making a wrong redirect effectively irrevocable while the file's own 405 sets `no-store` [src/pages/[reference].astro:30-35] — fixed: case-variant candidate gate, self-hit guard, charset re-check, query preserved, `no-store` on the 301
- [x] [Review][Patch] `findCanonicalCustomReference` ignores `is_canonical` (named "canonical", sibling `findPollForOwner` filters it), orders NOCASE ties nondeterministically, and its comment overpromises — SQLite NOCASE folds ASCII only, correct here solely because slugs are `[a-z0-9-]` [src/adapters/d1/index.ts:156-170] — fixed: `is_canonical = 1` filter (tested), `ORDER BY reference`, comment corrected
- [x] [Review][Patch] E2E case-mangle regex flips the first letter of the whole pathname — a lettered path prefix would be mangled instead of the reference, passing the 404 assertion without exercising case-sensitivity (false green) [tests/e2e/create-poll-authed.spec.mjs:136-140] — fixed: regex anchored to the final path segment
- [x] [Review][Patch] Input pass-through props typed as plain `string` — `spellcheck="banana"` compiles; literal unions make misuse a type error [src/components/input.astro:14-16] — fixed: `autocapitalize`/`spellcheck` literal unions
- [x] [Review][Patch] Story-file records went stale in the review round: Task 4 and the "Existing code" table still claim zero changes to `src/pages/[reference].astro`; the File List omits `caps.ts`, `input.astro`, `[reference].astro`, `deferred-work.md`; Completion Notes cite pre-patch gate counts (228/228) with no recorded re-run behind the `done` flip [_bmad-output/implementation-artifacts/1-4-custom-links.md] — fixed: Task 4, table, File List, and Completion Notes reconciled with the review-round reality and re-run gate results
- [x] [Review][Defer] A case-mangled *generated* reference whose lowercase fold collides with a registered custom slug redirects to the wrong poll instead of 404ing — deferred: inherent to the ratified case-insensitive custom-link design; collision needs a 128-bit random fold to equal a chosen slug (~2⁻⁷⁷ per pair), and the all-lowercase short-circuit plus canonical guards bound the reachable surface [src/pages/[reference].astro, src/adapters/d1/index.ts]
- [x] [Review][Defer] Canonical-resolution composition (exact-then-fold-then-redirect) lives in the page frontmatter — arguably FR-28 domain policy inside an inbound adapter (AD-1) — deferred: the composition is two adapter calls and a branch; the case-fold rule itself is encoded in the port method and its test; extracting a domain function would add a port for one conditional
- [x] [Review][Defer] CI retry converts a partial e2e failure into a guaranteed one — a retry after the 303 publish re-submits the same slug and dies on "taken" because `cleanupCreator` runs in `afterAll` — deferred, pre-existing: harness design predates this round and applies to the whole authed file
- [x] [Review][Defer] The 301/404 contract is covered only by the authed e2e, which `test.skip`s without a provisioned `BETTER_AUTH_SECRET` — deferred: the deploy gate provisions the secret, so CI coverage is unconditional; a signed-out seed-based test is a nice-to-have [tests/e2e/create-poll-authed.spec.mjs]

#### Review round 3 (re-review of the round-2 patch)

- [x] [Review][Patch] Candidate gate rebuilt: unbounded length lets `/Wp-Admin`-shape and 500-char mixed-case probes pay the NOCASE scan despite the "only plausible case variants" comment; non-Unicode `/i` legacy-folds `ſ`/`ı`/Kelvin `K` (Unicode mode folds them too — the flag is the wrong tool); and as inlined frontmatter the gate logic can't be unit-tested [src/pages/[reference].astro:30-33] — fixed: `isCustomSlugCaseVariant` domain predicate (fold-first, cap-bounded, charset on the folded form) with a unit matrix
- [x] [Review][Patch] `ORDER BY reference` + `.first()` + the page-side charset guard compose into a hole: with out-of-band case-duplicate canonical rows, BINARY ordering selects the uppercase row first and the guard then rejects it — 404 despite a valid lowercase canonical match [src/adapters/d1/index.ts:163-170, src/pages/[reference].astro:43] — fixed: `AND reference GLOB '[a-z0-9-]*'` in the SQL, tested with an out-of-band uppercase row
- [x] [Review][Patch] Change Log says "10 patches" but the Review Findings label exactly 9 `[Review][Patch]` items — the tenth is the `[Review][Decision]` redirect implementation [_bmad-output/implementation-artifacts/1-4-custom-links.md] — fixed: counts now include this round's 3 (12 total)
- [x] [Review][Defer] A mixed-case request to an orphan reference row (poll deleted out-of-band, bypassing the cascade) 301s into a 404 instead of 404ing directly — deferred: corrupt-state-only reachability (D1 enforces the cascade), the chain terminates correctly, and a reachability re-check would tax every legitimate case-variant hit [src/pages/[reference].astro]

#### Review round 4 (re-review of the round-3 patch)

- [x] [Review][Patch] Round 3's GLOB fix is wrong: `GLOB '[a-z0-9-]*'` constrains only the FIRST character (`*` is a wildcard, not a Kleene star — verified against real SQLite), so an out-of-band row like `tEAM-lunch` passes the filter, wins BINARY ordering, gets rejected by the page guard, and 404s despite the valid `team-lunch` row — the composition hole survives [src/adapters/d1/index.ts:171] — fixed: `AND reference NOT GLOB '*[^a-z0-9-]*'`
- [x] [Review][Patch] The round-3 GLOB test is a false green: its out-of-band fixture `TEAM-LUNCH` violates the charset at position 0, the only shape the broken pattern excludes [tests/integration/polls-adapter.integration.test.ts:320-353] — fixed: fixture now `tEAM-lunch` (interior uppercase)
- [x] [Review][Patch] The self-hit guard `canonical !== reference` is provably dead (predicate requires uppercase in the request; correct GLOB restricts canonical to lowercase) and the page comment wrongly credits it with the orphan 404 behavior, which is actually the deferred 301→404 chain [src/pages/[reference].astro:36-42] — fixed: guard removed, comments corrected in code and both ledgers
- [x] [Review][Patch] The page-side guard re-introduces a literal `63` after round 1 extracted the cap into `POLL_CAPS`; with a correct GLOB the `ORDER BY` is vestigial and its comment overpromises [src/pages/[reference].astro:43, src/adapters/d1/index.ts:156-171] — fixed: `POLL_CAPS.maxCustomLinkLength` in the guard, ORDER BY dropped

#### Review round 5 (re-review of the round-4 patch)

- [x] [Review][Patch] Kelvin-sign gate leak: U+212A folds to ASCII `k` under JS `toLowerCase`, so `\u{212A}team`-shape probes pass the fold-first predicate and pay the full NOCASE scan on every request (always 404 correctly — SQLite NOCASE is ASCII-only — but the scan-bounding the gate exists for is defeated, and the comment claims fold-first excludes Kelvin) [src/modules/polls/index.ts:222-229] — fixed: raw-form ASCII test (`/^[a-zA-Z0-9-]+$/`), no fold semantics consulted; Kelvin/İ pinned in unit tests
- [x] [Review][Patch] Completion Notes still credit the removed self-hit guard ("canonical/self-hit/charset guards") — round 4 corrected code and both defer ledgers but missed this sentence [_bmad-output/implementation-artifacts/1-4-custom-links.md:208] — fixed: phrase now "canonical/charset guards"

## Dev Notes

### Decisions resolved at story-creation time (all `[ASSUMPTION]`-marked — flag to Justin if any feel wrong)

| Gap (unspecified in PRD/UX/epics/spine) | Decision | Rationale |
| --- | --- | --- |
| Generated reference when a custom link is given | **Not created** — the custom slug is the Poll's only reference row (`kind='custom'`, `is_canonical=1`) | Glossary: Custom Link "replac[es] the random Poll ID"; AD-13 Identifiers row: references are "custom slugs **or** generated … values"; avoids a second live guessable URL |
| Case handling | Trim + lowercase-fold before validation, persist the folded form | Forgiving; matches `isReservedSlug`'s lowercase comparison; AC's "contains only lowercase" satisfied post-normalization |
| Length bound | 1–63 chars after normalization | No bound anywhere in the sources; DNS-label convention; well under the input's practical width |
| Hyphen placement | Any placement valid (leading/trailing/consecutive allowed) | The AC specifies charset only; adding rules the spec doesn't have is scope creep |
| Slug editing after creation | **Out of scope** — set-once at creation, no edit path | FR-28: "the shared URL is the canonical link and never changes"; AD-13 Prevents: "mutable share links"; FR-5 names only description as editable |
| Deleted-poll slug reuse | Re-claimable (no retirement) | AD-12 hard-deletes reference rows via cascade; deletion = nonexistence by design (UX: "indistinguishable from nonexistence"); retirement would need a tombstone store the spine forbids |
| Malformed-slug copy | Two new voice-consistent lines (see copy table) | Only "taken"/"reserved" exist in the copy deck; the validation-copy gap is acknowledged in the project's own UX review |

### Scope boundaries — build none of these

- **Slug edit/change command** — no story owns it; the spine leans immutable (see decisions table). Story 1.12 (close/edit/delete) covers description only
- **Live availability check / URL preview / "available" tick** — explicitly contrary to the UX spec (validate on submit, never on blur; `input-code` precedent)
- **Vote submission** → Story 1.5; **Share control** → 1.13 (confirmation still shows the URL as text only)
- **Redirects from generated → custom URL** — no generated reference exists when a custom link is assigned; nothing to redirect
- **Guessability warning copy** — the FR-3 trade-off note is not surfaced as UI copy anywhere in EXPERIENCE.md; don't invent it
- **Rate limiting on creation** — still the deferred stub (unchanged from 1.3)

### The one architecture rule that shapes this story

AD-3: `CreatePoll` "commits the Poll, type facts, options or slots, **slug reservation**, and adopted media records in one D1 batch. A failed batch leaves no reachable Poll." Slug uniqueness is decided by the `poll_reference` PRIMARY KEY inside that batch — never by a pre-flight SELECT (AD-16: "only D1 constraints decide"). The adapter's job is to make that constraint failure *legible* (typed taken-error), the command's job is to map it to the field error, and the page's job is the standard 422 re-render. [Source: ARCHITECTURE-SPINE.md#AD-3, #AD-16]

### Architecture constraints that bind this story

- **AD-13:** root-path references; ONE reserved-slug registry imported by both routing and slug validation (already true — `src/modules/polls/reserved-slugs.ts` carries a comment naming this story); canonical URLs never change. [Source: ARCHITECTURE-SPINE.md#AD-13]
- **AD-1:** slug normalization/validation is provider-free domain code in `src/modules/polls/`; the D1 adapter implements the port. No Astro imports in the module.
- **AD-19:** only Polls-module commands write `poll_reference`.
- **AD-5:** custom links resolve regardless of discovery state — never gate `/{reference}` on listing.
- **AD-12:** deleting a Poll cascades its reference rows — the link 404s immediately (schema already does this; don't add logic).
- **Consistency Conventions:** POST → 303 success / 422 re-render with preserved values + field errors on the same route; stable error codes, never SQL detail in messages; kebab-case files, snake_case SQL. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions]
- **AD-2:** the field and its validation work with JavaScript off — they do by construction (server-side validation, server re-render).

### Existing code — read before touching (current state → change → preserve)

| File | Today | This story | Must not break |
| --- | --- | --- | --- |
| `src/modules/polls/index.ts` | `CreatePollDraft` (no slug), `validateCreatePoll`, `CREATE_POLL_COPY`, `PollPersistenceRows.reference.kind: "generated"`, `createPoll` catch → generic `poll_create_failed` | Add customLink field + validation + 4 copy lines; widen `kind`; map taken-error | Every existing validation path and copy line byte-for-byte; the generated-reference path when customLink is blank |
| `src/modules/polls/reserved-slugs.ts` | `isReservedSlug` — lowercases, rejects empty; app slugs + `results`/`manifest` | Import it. Zero changes | The routing consumer (`[reference].astro`) |
| `src/adapters/d1/index.ts` | `insertPoll` one `db.batch()`; `findPollByReference` kind-agnostic; `findPollForOwner` joins `is_canonical = 1` | Distinguish the reference-PK constraint failure | Batch atomicity (forced-failure test exists); both read queries unchanged |
| `src/pages/creator/new.astro` | Form schema/values/422 re-render/ADD OPTION round-trip all preserve fields | Add one field block + schema entry + values plumbing | CSRF hidden field, intent handling, option rows, all existing field blocks |
| `src/pages/[reference].astro` | Reserved-check then `findPollByReference`; 404 otherwise | Nothing at implementation; the review round added the case-variant → canonical redirect fallback (Review Findings) | — |
| `src/pages/creator/polls/[pollId].astro` | Renders `canonicalReference` URL | Nothing | Outcome-line focus contract |
| `db/migrations/0004_polls.sql` | `poll_reference` PK `reference`, `kind`, `is_canonical` | Nothing — NO new migration | Never edit a shipped migration (AD-14) |

### UX contract — exact copy and behavior

| Case | Copy | Source |
| --- | --- | --- |
| Slug taken | **`{slug}` is taken.** Pick another. | EXPERIENCE.md#Voice and Tone (verbatim) |
| Slug reserved | **`{slug}` is reserved by the application itself.** Pick something less structural. | EXPERIENCE.md#Voice and Tone (verbatim) |
| Invalid characters | **A Custom Link uses lowercase letters, digits, and hyphens.** Nothing else. | `[ASSUMPTION: new line, voice rules]` |
| Too long | **That Custom Link is too long.** Keep it to 63 characters. | `[ASSUMPTION: new line, voice rules]` |

`{slug}` is a render-time copy placeholder (EXPERIENCE.md's own convention) — interpolate the normalized submitted slug; Astro's default escaping renders it inert (and charset validation runs first, so taken/reserved only ever see `[a-z0-9-]` strings).

Behavior: validate on submit only, never on blur; error inline beneath the field (`caption` size, `alarm` color, alarm bottom rule on the input); rest of the form preserved; never a tooltip, modal, or top-of-form summary; label always above the field (`label-caps`, never placeholder-as-label); the `input` primitive's focus ring + underline both fire on focus; no autofocus (Voter-Code precedent: don't drop screen-reader users into an edit field). [Source: EXPERIENCE.md#Component Patterns → input, #State Patterns → Creator: creation validation; DESIGN.md#Components → input]

Bans that bite: no rounded corners, no spinner, no toast, no live "checking…" affordance, no icon-only anything, no `faint` on readable text. [Source: DESIGN.md#Do's and Don'ts]

### Previous story intelligence (1.3 Dev Agent Record)

- 1.3 is in `review` with all work **uncommitted** on `main`'s working tree — this story starts after that lands. Baseline commit above predates 1.3's merge; re-check `git log` at dev time.
- The 422 re-render / values-preservation / fieldErrors pattern in `new.astro` is proven end-to-end (20/20 scripted smoke assertions) — extend it, don't restructure.
- Integration-test harness: D1 storage persists across tests within a file; seed inserts must be idempotent (`INSERT OR IGNORE`) with per-file cleanup (`DELETE FROM poll`). Cascades fire in workerd local D1 without pragmas.
- Playwright can drive the authenticated create flow via the seeded-session harness (`tests/e2e/creator-session.mjs`, session seeded into local D1 and cookie signed with the local `BETTER_AUTH_SECRET`) — 1.3's note that it couldn't is stale; the duplicate/reserved-slug paths are e2e'd there, not integration-tested (review decision, Justin 2026-07-30).
- `input` primitive gained `describedby` in 1.3 — use it for the error wiring.
- Env bindings via `env` from `cloudflare:workers`; custom domain NOT yet bound — canonical URLs render from request origin, never hardcode `polls.oddspark.dev`.
- Review lesson from 1.2: map provider errors to stable codes once, in the command's single envelope — the taken-error mapping belongs there, not in the page.

### Project Structure Notes

- Files changed: `src/modules/polls/index.ts`, `src/adapters/d1/index.ts`, `src/pages/creator/new.astro`, `tests/unit/polls.test.ts`, `tests/integration/create-poll-route.integration.test.ts`, `tests/integration/polls-adapter.integration.test.ts`, `tests/e2e/create-poll.spec.ts`
- No new files expected; no migration; no manifest change; kebab-case throughout
- Latest-tech check: no new libraries — pure string validation on the pinned stack (TS 7.0.2, Astro 7.1.5, Zod 4.4.3); nothing to research

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4] (lines 309–328) — story statement + 3 ACs with verbatim copy + reserved set
- [Source: prd.md#4.1 FR-3] — consequences (resolution, collision rejection, reserved rejection, charset/fallback assumption) + guessability note; #FR-2 (link set at creation); #FR-5 (deletion → link stops resolving); #FR-28 (canonical never changes); #3 Glossary (Custom Link "replacing the random Poll ID"); #6 Non-Goals (no custom domains)
- [Source: ARCHITECTURE-SPINE.md#AD-3, #AD-12, #AD-13, #AD-16, #AD-19, #Consistency Conventions → Identifiers] — batch slug reservation, cascade deletion, one registry, constraint authority, write ownership, reference format
- [Source: EXPERIENCE.md#Voice and Tone → Key moments] — the two verbatim error lines + `{slug}` placeholder convention; #Information Architecture → Route rules (reserved set incl. `/api/auth/*`); #Key Flows → UJ-1 (field order, failure branch); #Component Patterns → input, input-code (submit-only validation precedent); #State Patterns → Creator: creation validation
- [Source: DESIGN.md#Components → input] — field visuals/states/tokens; #Do's and Don'ts — bans
- [Source: _bmad-output/implementation-artifacts/1-3-create-a-multiple-choice-poll.md#Dev Agent Record] — harness, smoke, primitive extensions
- [Source: db/migrations/0004_polls.sql] — `poll_reference` shape ("so Story 1.4 can add a custom slug … without a schema rewrite")

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Implementation Plan

- Task 1: add failing domain tests for normalization, charset, length, reserved paths, reason codes, and the shared registry; implement provider-free validation and copy without an availability query.
- Task 2: add failing command/adapter tests for custom reference rows and typed uniqueness collisions; implement the domain-owned error and D1 mapping.
- Task 3: add failing form assertions, then extend the existing schema/value/422 ballast path with the optional field and accessible inline error.
- Task 4: prove the existing public and creator queries resolve the canonical custom row without changing either route.
- Task 5: complete unit, workerd integration, authenticated browser, signed-out browser, type, migration, generated-types, and production-build gates.

### Debug Log References

- Task 1 red phase failed before implementation because `RESERVED_SLUGS` was not exported. The story's format-first line conflicts with AC #3 for `/`, reserved filenames containing punctuation (`favicon.ico`, `robots.txt`, `sitemap.xml`), and the existing `_astro` route. The format gate therefore admits exact shared-registry matches only; ordinary punctuation still fails format, length remains second, and admitted structural names receive reserved copy third. No availability query was added.
- Node 24.18.0 was invoked directly from the installed NVM runtime for deterministic checks. The full Vitest gate requires unsandboxed workerd localhost access and Wrangler log writes.
- Task 2 preserves duplicate-Poll-ID precedence when a replay collides on both constraints. The owner snapshot now carries canonical reference kind so an idempotent retry cannot silently clear or change a Custom Link.
- Task 3 browser red phase failed on the missing `CUSTOM LINK (OPTIONAL)` control. The existing enhancement was graph-inspected after the field landed: every row operation remains scoped below `[data-option-list]` to `[data-option-row]`; no script change was needed.
- Task 4 required no route implementation. The graph and source confirm the public lookup has no `kind` predicate and the owner lookup selects `is_canonical = 1`; the authenticated end-to-end proof then created one custom row, rendered the full confirmation URL, and loaded that root path with HTTP 200.
- Task 5 test placement follows the executable boundaries rather than duplicating an Astro route in the workerd direct-module harness: real D1 custom-row, collision, atomicity, and kind-agnostic reads stay in integration; protected POST/303/422 preservation and root-route resolution run through the live Astro server in authenticated Playwright; the prescribed signed-out redirect remains in `create-poll.spec.ts`. `pnpm types` exposed a pre-existing generated-file delta from local binding discovery; because Story 1.4 changes no bindings, that side effect was restored to the branch baseline after the gate passed.

### Completion Notes List

- Task 1: `CreatePollDraft` and `ValidatedCreatePoll` now carry Custom Link state; validation trims and lowercase-folds, keeps blank on the generated path, enforces charset and the 63-character boundary, rejects every shared reserved entry (including `/`) with normalized exact copy, and emits stable per-field reason codes. `RESERVED_SLUGS` exposes the existing single registry for data-driven tests. Focused domain tests: 112/112 passed.
- Task 2: a valid Custom Link now substitutes for the generated reference and persists as the single canonical `kind='custom'` row without drawing randomness. The domain-owned `ReferenceTakenError` translates the D1 reference-PK collision into the normalized Custom Link field error only for custom submissions; generated collisions remain generic. Duplicate-publish matching now includes canonical reference kind/value. Focused workerd adapter tests: 8/8 passed. No migration or manifest file changed.
- Task 3: `/creator/new` now carries `customLink` through Zod parsing, initial/postback values, no-JS ADD OPTION, and all re-renders. The field sits between Deadline and Description, uses the existing input primitive, connects helper/error text through `aria-describedby`, validates only on submit, preserves the raw submitted value, and never autofocuses or performs an availability check. Authenticated browser coverage proves the normal, reserved, taken, no-JS, and canonical-link paths.
- Task 4: verified without modifying either route. A mixed-case submission persisted lowercase `team-lunch` as the only canonical custom row, the creator confirmation rendered the complete custom URL and immutable-reference guidance, and `/team-lunch` returned 200 with the created question/options.
- Task 5: ordered gates passed on Node 24.18.0 — migration guard (5/5 checksummed), Vitest (16 files, 228/228 tests), TypeScript check, Playwright (32/32), Wrangler types, and production build. Light/dark browser screenshots covered the normal and reserved-error field states; the browser had no page exceptions or unexpected console errors (the intentional 422 navigation produced Chromium's expected failed-resource entry).
- Review round (2026-07-30): case-variant custom links now 301 to the canonical lowercase URL (query string preserved, `cache-control: no-store`, canonical/charset guards, `is_canonical = 1` + GLOB-filtered deterministic NOCASE lookup, `isCustomSlugCaseVariant` domain predicate bounding the fallback to plausible variants); generated references pinned case-sensitive; `POLL_CAPS.maxCustomLinkLength`; shared `normalizeCustomLink`; Input hint pass-throughs (`autocapitalize="none"`, `spellcheck="false"`, `autocomplete="off"`, literal-union types); error-first `aria-describedby`. Gates re-run green on the patched tree: Vitest 238/238 (16 files), `tsc --noEmit`, `migrations:guard` (5/5), Playwright 32/32.

### File List

- `CHANGELOG.md`
- `_bmad-output/implementation-artifacts/1-4-custom-links.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `src/adapters/d1/index.ts`
- `src/components/input.astro`
- `src/modules/polls/caps.ts`
- `src/modules/polls/index.ts`
- `src/modules/polls/reserved-slugs.ts`
- `src/pages/[reference].astro`
- `src/pages/creator/new.astro`
- `tests/e2e/create-poll-authed.spec.mjs`
- `tests/integration/polls-adapter.integration.test.ts`
- `tests/unit/polls.test.ts`

### Change Log

- 2026-07-30: Implemented Custom Link validation, canonical persistence, D1 collision mapping, creator-form preservation, route verification, and complete automated/browser proof for Story 1.4.
- 2026-07-30: Code review — resolved 3 decisions (case-variant 301 to canonical; validation order ratified; e2e test placement ratified), applied 18 patches across five rounds (redirect hardening, candidate-gate predicate, full-charset GLOB filter, caps, shared normalization, input hints, aria order, record reconciliation), deferred 8 items to `deferred-work.md`. Status → done.
