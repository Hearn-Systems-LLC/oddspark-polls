---
baseline_commit: 5fa65b5c5b94416d11fa64838e39af98a03be766
---

# Story 1.4: Custom Links

Status: ready-for-dev

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

- [ ] Task 1: Slug validation in the polls domain module (AC: #1, #3)
  - [ ] `src/modules/polls/index.ts`: extend `CreatePollDraft` with `customLink: string` and `ValidatedCreatePoll` with `customLink: string | null`. Normalize (trim, then lowercase-fold `[ASSUMPTION: forgiving normalization, consistent with isReservedSlug's lowercase comparison]`), then validate: blank → `null` (generated-reference path, unchanged); non-blank must match `^[a-z0-9-]+$` and be ≤ 63 chars `[ASSUMPTION: cap unspecified in PRD/UX; 63 = DNS-label convention]`; then reject reserved via the EXISTING `isReservedSlug` from `src/modules/polls/reserved-slugs.ts` — do NOT write a second list (AC #3, AD-13)
  - [ ] Extend `CREATE_POLL_COPY` (all follow the voice rules — flat, layout-neutral, no exclamation): `customLinkInvalid` `[ASSUMPTION: new line]`: "A Custom Link uses lowercase letters, digits, and hyphens. Nothing else." · `customLinkTooLong` `[ASSUMPTION: new line]`: "That Custom Link is too long. Keep it to 63 characters." · `customLinkReserved` (verbatim, epic): `` "`{slug}` is reserved by the application itself. Pick something less structural." `` · `customLinkTaken` (verbatim, epic): `` "`{slug}` is taken. Pick another." `` — `{slug}` interpolated at render with the normalized submitted value (Astro's default escaping applies; slugs reaching taken/reserved have already passed the charset gate)
  - [ ] Validation order per field: format → length → reserved. "Taken" is NOT pre-checked here — uniqueness is decided by the D1 constraint inside the batch (AD-16: only D1 constraints are authoritative; a read-then-write availability check would be a race)
- [ ] Task 2: Reference row + taken-collision mapping in command and adapter (AC: #1, #2)
  - [ ] `src/modules/polls/index.ts`: when `customLink` is present, the batch's single reference row is the custom slug — `reference: { reference: customLink, kind: "custom", ... }` — and NO generated reference is created `[ASSUMPTION: "replaced as canonical" + Glossary "replacing the random Poll ID" read as substitution; one URL per Poll, no second guessable random URL]`; widen `PollPersistenceRows.reference.kind` to `"generated" | "custom"`; blank customLink keeps today's generated path byte-for-byte
  - [ ] `src/adapters/d1/index.ts` `insertPoll`: on batch failure, detect the reference-uniqueness violation (D1 error message contains `UNIQUE constraint failed: poll_reference.reference` — the PK) and rethrow/return a distinguishable typed error (e.g. `ReferenceTakenError`); all other failures stay generic
  - [ ] `createPoll` command: map the taken error to `fieldErrors.customLink = customLinkTaken` (422 re-render path) instead of the generic `poll_create_failed`; only when the draft had a custom link — a generated-reference collision (~impossible at 128 bits) stays the generic failure. The failed batch leaves no rows (AD-3 atomicity, already proven by 1.3's forced-failure test)
  - [ ] NO migration: `poll_reference` (PK `reference`, `kind`, `is_canonical` default 1) already holds everything this story needs — the table was shaped in 1.3 exactly for this (`db/migrations/0004_polls.sql` comment). Custom and generated references share one namespace/one uniqueness constraint by construction
- [ ] Task 3: Custom Link field on `/creator/new` (AC: #1, #2, #3)
  - [ ] `src/pages/creator/new.astro`: add an optional field on the existing `input` primitive — label `CUSTOM LINK (OPTIONAL)` `[ASSUMPTION: label string unspecified; matches DEADLINE (OPTIONAL) idiom]` — placed after Deadline, before Description `[ASSUMPTION: UJ-1 narrative order — visibility, deadline, then custom link]`; helper note in the existing `helper-note` idiom `[ASSUMPTION: no helper text specified; layout-neutral, factual]`: "Lowercase letters, digits, and hyphens. Leave blank for a random link."
  - [ ] Wire into the existing flow: form schema gains `customLink` (string, default ""), `values` carries it through the ADD OPTION round-trip and every 422 re-render (ballast preservation is already the page's pattern — extend, don't fork); error renders inline beneath the field in `caption`/`alarm` with `aria-describedby` via the input's `describedby` prop (the primitive already supports it, added in 1.3)
  - [ ] Validate on submit ONLY — never on blur, no debounce, no async availability check, no "available" affirmative state, no URL preview while typing (EXPERIENCE.md hard rule; the `input-code` precedent explicitly rejects pre-submit checks as "a lie" — availability at typing time isn't availability at submit time). Do not autofocus the field
  - [ ] No JS enhancement needed: `src/scripts/create-poll-form.ts` untouched unless the field breaks its row-indexing assumptions — verify it doesn't (it targets `[data-option-row]` only)
- [ ] Task 4: Routing already resolves custom slugs — verify, don't build (AC: #1)
  - [ ] `src/pages/[reference].astro` resolves ANY `poll_reference` row kind-agnostically and checks `isReservedSlug` first — confirm a created `/team-lunch` renders the poll page with zero changes to this file
  - [ ] Confirmation page `src/pages/creator/polls/[pollId].astro` renders `canonicalReference` via `findPollForOwner` (`is_canonical = 1` join) — with the custom row canonical, the full custom URL appears with "It never changes." — zero changes expected; verify by test
- [ ] Task 5: Tests + gates (AC: all)
  - [ ] Unit (`tests/unit/polls.test.ts`): validation matrix — blank → null; valid `team-lunch`; uppercase `Team-Lunch` folds to valid; invalid chars (space, `/`, `_`, unicode, `.`) → invalid copy; 63/64 boundary; every reserved-registry entry rejected with reserved copy (import the registry, don't hand-copy the list); normalization idempotence; `PollPersistenceRows.kind` values
  - [ ] Integration (`tests/integration/` — extend the 1.3 files): POST `/creator/new` with custom link → 303, `poll_reference` row `kind='custom'`, `is_canonical=1`, no generated row; duplicate slug (seed one, submit same) → 422 with exact taken copy, all other fields preserved, zero partial rows from the failed batch; reserved slug (`creator`, `results`) → 422 with exact reserved copy; created slug resolves at `/{slug}` (route test); mixed-case submission persists lowercase
  - [ ] E2E (`tests/e2e/create-poll.spec.ts`): form shows the Custom Link field with its label; signed-out redirect still passes (regression)
  - [ ] Gates: full Vitest suite, `pnpm check`, `pnpm migrations:guard` (manifest unchanged — no new migration), production build — all green before story-done

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
| `src/pages/[reference].astro` | Reserved-check then `findPollByReference`; 404 otherwise | Nothing | — |
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
- Playwright can't drive the authenticated create flow (real OAuth consent) — middleware-level integration tests + the signed-out-redirect e2e stand in; same constraint applies here, so the duplicate/reserved-slug paths are integration-tested, not e2e'd.
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

### Debug Log References

### Completion Notes List

### File List
