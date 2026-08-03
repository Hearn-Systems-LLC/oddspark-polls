---
baseline_commit: a2ba154
baseline: main @ a2ba154 (post Story 2.4, Epic 2 complete)
dependency_story: 2-1-per-poll-security-toggles (chooser/intent/guarded-update patterns), 2-4-trust-badge (badge component + token-group patterns)
epic: 3 — Public Face: Discovery, Landing & Demo
---

# Story 3.1: Listing Control — Opt Into Discovery

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Creator,
I want my Poll Unlisted by default with an explicit opt-in to the public directory,
So that nothing I make is ever public without my say-so, and foot traffic is one choice away.

## Acceptance Criteria

Verbatim from `_bmad-output/planning-artifacts/epics.md` § Story 3.1 (lines 698–719):

1. **Given** any newly created Poll, **When** it is created, **Then** its discovery state is Unlisted — reachable by link, absent from the directory, sitemaps, and every index (FR-23), **And** `discovery_state` persists separately from `result_visibility` (AD-5).

2. **Given** the creation form and the Poll detail, **When** the listing control renders, **Then** it reuses the `poll-option` single-select chooser — **Unlisted** ("reachable only by link; absent from Discover and sitemaps") and **Listed** ("appears on Discover and in sitemaps while the Poll is open") — with consequence lines beneath each (UX-DR12), **And** the Creator can move between Unlisted and Listed at any time; discovery is presentation, not integrity.

3. **Given** a creator `poll-card` or Poll detail, **When** it renders, **Then** a label-caps-lg `listing-badge` shows the state as a word — `UNLISTED` in dim, `LISTED` in entropy, `DELISTED` in alarm — the word carrying the state, color only annotating (UX-DR12), **And** only Discovery-module commands may write listing state (AR-1).

**AC #1 clarification (AD-5 + UJ-6, binding):** "starts Unlisted" means the form *defaults* to Unlisted; AD-5 says "creation presents an explicit opt-in to `listed`" and UJ-6 step 4 has the Creator opting in *on the creation form*. A Poll created with Listed explicitly selected is born `listed`. A fresh GET renders Unlisted checked; an absent or tampered `listing` POST value is a 422 field error, never a silent default (the `visibility` precedent, `new.astro:135`).

## Tasks / Subtasks

- [x] Task 1: Discovery module — vocabulary, policy, command (AC: #1, #2, #3)
  - [x] REPLACE the stub `src/modules/discovery/index.ts` (currently `export {}`) following the `src/modules/polls/poll-security.ts` shape exactly: provider-free, injectable ports, `Result<T>` from `src/shared/application`, `ApplicationError` with stable snake_case codes, `console.error(code, { pollId, cause })` on persistence failure (IDs only — AD-15).
  - [x] Export `DISCOVERY_COPY` (single copy catalog, keyed by code — the `LIFECYCLE_COPY`/`SECURITY_COPY` precedent): the two consequence lines verbatim (D4), `listingInvalid` ("Pick a Discovery Setting." — D4), the delisted-refusal line (D6), and `LISTING_CHOICES` (value/label/description triples) so `new.astro` and `[pollId].astro` render from one source.
  - [x] Export `parseListingDraft(value: string): DiscoveryState | null` narrowing to the *creator-settable* subset `"unlisted" | "listed"` — `"delisted"` is never a legal form value (only the Administrator sets it, Story 3.3). Type guard mirrors `isResultVisibility` (`src/modules/polls/index.ts:231`).
  - [x] Export the `setPollListing(deps, pollId, ownerUserId, requested)` command: load owned snapshot → if `discoveryState === "delisted"` return error `poll_delisted` (D6) → if unchanged return `{kind:"unchanged"}` idempotent success → else call the update port. Port outcome union `"updated" | "unchanged" | "delisted" | "not_found"` mapped back to `Result` (the `updatePollSecurityToggles` mapping, `poll-security.ts:152`).
  - [x] **No `representation_version` bump** (D1): the command takes no version contribution and the port takes no `version` param — unlike `updateSecurityTogglesForOwner`. Update `updated_at_ms` only. Comment the divergence in-source citing AD-24's enumerated list.
  - [x] Unit tests `tests/unit/discovery.test.ts` (prose-sentence `it(...)` names): parse accepts exactly `unlisted`/`listed`, rejects `delisted`/junk/empty; unchanged is idempotent success; delisted snapshot refuses both directions; outcome mapping matrix; copy strings exact.
- [x] Task 2: D1 adapter — read paths + guarded listing update (AC: #1, #3)
  - [x] UPDATE `src/adapters/d1/index.ts` — add `discovery_state` to the SELECT lists and mapped types that creator surfaces read: `loadLifecycleForOwner` (~line 334, + `PollLifecycleSnapshot.discoveryState` in `src/modules/polls/poll-lifecycle.ts` ~45) and `listPollsForOwner` (~line 292, + its list-item type) so detail and dashboard render the badge from one consistent read. **`discovery_state` is written on INSERT today but read nowhere — each query has a hand-written SELECT list; do not miss the anonymous row types.** Leave `findPollByReference`/`PollPage` (voter surface) untouched — voters never see listing state (UX-DR19; Story 3.3 makes delisted polls indistinguishable by link).
  - [x] NEW `updateListingForOwner` port implementation modeled on `closePollForOwner` (`d1/index.ts:422`), not on the security-toggles version-bumping variant: one guarded UPDATE — `SET discovery_state = ?, updated_at_ms = ? WHERE id = ? AND owner_user_id = ? AND discovery_state != 'delisted' AND discovery_state != ?requested` — **no `representation_version` increment** (D1). Zero rows changed → re-read → classify `not_found` / `delisted` / `unchanged`; otherwise `updated`. The delisted guard is race-free in SQL even though no delist writer exists until 3.3 (D6).
  - [x] Integration tests `tests/integration/discovery-adapter.integration.test.ts` (real D1 via `applyD1Migrations`, the existing harness): unlisted→listed and back both persist; unchanged classifies without touching `updated_at_ms`… (verify actual no-op semantics match the command's short-circuit); wrong owner → `not_found`; seeded `delisted` row → `delisted` and column unchanged; `representation_version` NOT bumped by any listing write; `loadLifecycleForOwner`/`listPollsForOwner` round-trip the state.
- [x] Task 3: Creation form — Discovery Setting chooser (AC: #1, #2)
  - [x] UPDATE `src/modules/polls/index.ts` — widen `PollPersistenceRows.poll.discoveryState` from the literal `"unlisted"` (line 377) to `DiscoveryState`; extend `CreatePollDraft` with `discoveryState: string` (raw — the `resultVisibility` naming precedent; the form key is `listing`); `validateCreatePoll` narrows via Discovery's `parseListingDraft` (import from `src/modules/discovery` — vocabulary has one home, D2) with field key `listing`, reason code `listing_invalid`, copy `DISCOVERY_COPY.listingInvalid`; replace the hardcoded `discoveryState: "unlisted"` in `createPoll` (line 699) with the validated value. Creation persists the chosen initial state inside the existing single D1 batch (D2 — AD-3 atomicity wins; the 0004 header comment sanctions CreatePoll *initialization*, transitions belong to Discovery).
  - [x] UPDATE `ExistingPollSnapshot`, `matchesExistingPoll` (~480), and `draftContentForCompare` to include the listing value — the D4 retry-dedupe adjudication must not misclassify an idempotent retry that differs only in listing.
  - [x] UPDATE `src/pages/creator/new.astro` — zod `formSchema` gains `listing: z.string().default("")`; `values` initializer carries `discoveryState: "unlisted"` on fresh GET (default lives in the render); 422 re-renders preserve the posted choice. Render the fieldset in the EXPERIENCE.md IA order — **between the Visibility Setting fieldset and the Deadline field**: `<fieldset class="field-block">` + `<legend class="group-label">WHO CAN FIND IT</legend>` (D5) + two `PollOption` rows (`name="listing"`, ids `listing-unlisted`/`listing-listed`, labels `UNLISTED`/`LISTED` (D3), `description` = the verbatim consequence lines) + `aria-describedby`-linked `.field-error` — clone the visibility fieldset construction at `new.astro:312-332` exactly.
  - [x] No enhancer changes: a radio pair inside the existing publish form works without JavaScript (AD-2 no-JS floor).
  - [x] Tests: UPDATE `tests/unit/polls.test.ts` (draft mapping, invalid/missing listing → `listing_invalid`, dedupe-compare drift guard) and `tests/integration/create-poll-route.integration.test.ts` (create with default persists `unlisted`; create with `listing=listed` persists `listed`; tampered value 422s and re-renders the choice).
- [x] Task 4: Poll detail — listing section + `update-listing` intent (AC: #2, #3)
  - [x] UPDATE `src/lib/creator-lifecycle-form.ts` — add `"update-listing"` to `LifecycleIntent`/`INTENTS`, a `LISTING_FORM_KEYS` allowlist (`intent`, `csrf_token`, `listing` only), and the parsed-form shape. The strict parser must keep 422-ing unknown keys. UPDATE `tests/unit/creator-lifecycle-form.test.ts`.
  - [x] UPDATE `src/pages/creator/polls/[pollId].astro` — render the Discovery Setting section (own `<form method="post">` with hidden `csrf_token`, two `PollOption` rows checked from the lifecycle snapshot's `discoveryState`, one save control with `intent=update-listing`), placed with the other setting forms after Security Toggles. Dispatch mirrors `update-security` (~lines 129-360): success → hand-built 303 `?outcome=listing-updated` with `cache-control: private, no-store` (never `Astro.redirect`); `not_found` → 404; `poll_delisted` → 422 re-render from re-loaded persisted state (never echo the rejected draft — the 2.1 HIGH finding); persistence failure → 500 (telemetry folds ≥500 as `result: "error"`; never map 5xx to 422). `unchanged` follows the security no-op behavior: 303 with the same outcome.
  - [x] Add `"listing-updated": "Listing updated."` to `outcomeCopy` (D7). Post-submit render follows the 1.12 outcome contract already on this page: outcome line first in main, `tabindex="-1"`, focused, `<title>` leads with the outcome.
  - [x] Render the `listing-badge` beside the Poll's open/closed status in the detail status line (the `LiveIndicator`/vote-total row) per DESIGN.md:633 "beside the Poll's open/closed status".
  - [x] Tests: UPDATE `tests/integration/creator-poll-lifecycle-route.integration.test.ts` — intent matrix (ownership 404, unknown key 422, unlisted↔listed 303 + persisted, seeded-delisted 422 re-render from persisted state, no version bump across the route).
- [x] Task 5: `listing-badge` component + poll-card composition (AC: #3)
  - [x] NEW `src/components/listing-badge.astro` — JSDoc citing Story 3.1 / UX-DR12; `interface Props { state: DiscoveryState; class?: string }`; renders the word `UNLISTED`/`LISTED`/`DELISTED` (uppercase stored as canonical copy; `text-transform: uppercase` is belt-and-braces) as a single `<span class:list={["listing-badge", className]} data-listing-badge data-state={state}>`. Non-interactive, no ARIA role needed — plain text carries the state. **All three states ship now** (vocabulary complete — the 2.4 enforced-subset lesson); `delisted` is unreachable in production until Story 3.3 writes it, but the badge, colors, and tests are done here.
  - [x] Styling: label-caps-lg recipe — `--font-machine`, `--type-label-caps-lg-size` (12px), `--type-label-caps-lh`, `--type-label-caps-ls`, uppercase (the `.results-tally-summary`/`trust-badge` recipe; there is no `.label-caps-lg` class). Color by `data-state` attribute selector: unlisted → `--listing-badge-unlisted-color`, listed → `--listing-badge-listed-color`, delisted → `--listing-badge-delisted-color`. No border, no chip, no background, no radius, no opacity, no motion (idle is still).
  - [x] UPDATE `src/styles/tokens.css` — `--listing-badge-*` token group in the unsuffixed `:root` component block (the `--trust-badge-*` precedent), binding only to existing collapsed vars: `--color-dim`, `--color-entropy`, `--color-alarm`. No new `-dark`/`-light` pairs, no fourth `…Light` exception, do not touch `--color-solar-dark` (deploy smoke reads it).
  - [x] UPDATE `src/components/poll-card.ts` / `poll-card.astro` — add **optional** `listing?: DiscoveryState` to the view-model input/output (optional because the same component serves the public `/discover` catalog "unchanged" in Story 3.2, where no badge may appear). When present, render `<ListingBadge>` in the status cluster beside `LiveIndicator`/`CLOSED`, separated by the existing `·` idiom (D8 — `CLOSED` and `UNLISTED` are both label-caps-lg dim; the word alone distinguishes them, which is the system's rule, but they need the middot separation the metadata line already uses). Both creator call sites (`src/pages/creator/index.astro:44`, `[pollId].astro:458`) pass the state from `listPollsForOwner`.
  - [x] Source-contract test `tests/unit/listing-badge.test.mjs` (template: `trust-badge.test.mjs`): token bindings present; all three `data-state` selectors; no raw hex, no `opacity:`, no `border-radius`, no `box-shadow`, no `transition`/`animation`, no `set:html`; the three words present. UPDATE `tests/unit/poll-card.test.mjs` for the optional badge slot. `tests/unit/no-raw-html.test.mjs` picks the component up automatically.
- [x] Task 6: E2E, proof, gate (AC: all)
  - [x] NEW `tests/e2e/listing-control.spec.mjs` (auth harness: `seedCreatorSession`, D1 seed, cleanup, `pnpm migrate:local` first): create with defaults → detail + dashboard card show `UNLISTED`; create opting into Listed → `LISTED` badge; flip Listed→Unlisted and back on detail via the section form → badge and chooser reflect persisted state after 303; computed-style assertions (12px, resolved `--color-dim` for UNLISTED, resolved `--color-entropy` for LISTED) in dark AND light (the 2.1 review lesson: DOM presence is vacuous for a styling contract); voter page for a listed poll shows no badge and no listing text.
  - [x] Screenshot proof under `test-results/story-3-1-listing-control-proof/`: 375px dark + 1280px light minimum — create-form chooser, detail section with badge, dashboard card. Visually inspect.
  - [x] Merge gate, exact order (Node 24.18.0 / pnpm 11.17.0): `pnpm migrations:guard` → `pnpm test` → `pnpm check` → `pnpm test:e2e` → `pnpm types` → `git diff --exit-code worker-configuration.d.ts` → `pnpm build:production`. Record fresh totals (2.4 baseline: 920 unit/integration + 144 e2e).
- [x] Task 7: Docs in the same commit
  - [x] UPDATE `CHANGELOG.md` under `## [Unreleased]` (listing control on create + detail, Unlisted by default, listing badge on creator surfaces).
  - [x] UPDATE this story file's Dev Agent Record + `sprint-status.yaml` per workflow. No README/AGENTS.md changes expected — no binding, secret, env, or migration change (Epic 2 retro confirmed: none needed for 3.1).

## Dev Notes

### Decisions resolved at story-creation time (Justin to ratify before dev-story)

| # | Gap | Decision |
|---|---|---|
| D1 | **Does a listing write bump `representation_version`?** AD-24 enumerates the version-bumping writes: "Vote acceptance, Meeting revision, Comment moderation, manual close, result visibility, and pre-Vote option or type edits" — listing state is *not* on the list, yet `updatePollSecurityToggles` (the pattern being copied) does bump. | **No bump.** Listing state renders on creator surfaces only; the voter representation is unchanged by design (a delisted poll is "indistinguishable from any other Poll" — Story 3.3 AC). The story's own language settles it: "discovery is presentation, not integrity." Model the adapter on `closePollForOwner`'s guarded UPDATE but without the version increment; update `updated_at_ms` only. If review disagrees, the change is one line in the port + one in the UPDATE. |
| D2 | **AR-1 says only Discovery-module commands write listing state, but `CreatePoll` (Polls module) writes the initial row in one atomic D1 batch (AD-3), and AD-5 says creation presents the opt-in.** Strict AR-1 would force a follow-on Discovery command after creation — non-atomic, and a failure window where the Creator's explicit choice is silently dropped. | **Creation persists the chosen initial state inside `CreatePoll`'s single batch; the Discovery module owns the vocabulary** — `parseListingDraft`, the creator-settable subset, and all listing copy live in `src/modules/discovery`, and `validateCreatePoll` imports from it. The `0004_polls.sql` header comment already sanctions this split verbatim: "discovery_state is a poll column initialized to 'unlisted' by CreatePoll; all later listing transitions belong to Discovery-module commands (AD-5/AD-19)." Initialization ≠ transition. |
| D3 | **Chooser option labels: mixed case or caps?** EXPERIENCE.md:163 writes **Unlisted**/**Listed** mixed-case; but the shipped Visibility chooser (`new.astro:62`) renders `LIVE` / `AFTER CLOSE` / `CREATOR-ONLY` in caps. | **Follow the shipped sibling: `UNLISTED` / `LISTED`.** Two adjacent chooser fieldsets on one form must not use two label treatments, and the caps form matches the badge vocabulary. (EXPERIENCE.md:141 also wrote the visibility labels mixed-case and the implementation ratified caps — same translation.) |
| D4 | **Consequence lines and error copy.** The consequence lines are specified verbatim; the invalid-value error is not. | Consequence lines exactly as written (sentence case, no terminal period, semicolon join in the Unlisted line): Unlisted — "reachable only by link; absent from Discover and sitemaps"; Listed — "appears on Discover and in sitemaps while the Poll is open". Invalid/missing POST value: **"Pick a Discovery Setting."** — the `visibilityInvalid` ("Pick a Visibility Setting.") construction with the PRD's own noun (glossary: "Discovery Setting"). |
| D5 | **Fieldset legend is unwritten.** Visibility's legend is `WHO SEES THE RESULTS`. | **`WHO CAN FIND IT`** — same register, names the consequence not the mechanism. Amend at implementation if Justin prefers (e.g. `WHERE IT APPEARS`); whichever ships lives in `DISCOVERY_COPY`, keyed by code. |
| D6 | **Delisted handling in 3.1.** No delist writer exists until Story 3.3, but AC #3 requires the `DELISTED` badge vocabulary and AR-1 requires the write path be safe from day one. | Ship the guard now, the UI later: `setPollListing` refuses when the snapshot is `delisted` (stable code `poll_delisted`) and the adapter's WHERE clause re-enforces `discovery_state != 'delisted'` race-free. The badge component ships all three states, unit-tested. The read-only control rendering + moderation line ("Delisted by the Administrator. The link still works and Votes still count; the Poll no longer appears on Discover. Only the Administrator can reverse this.") is **Story 3.3's** — do not build it here; the `PollOption` `readOnly` prop already exists for 3.3 to use. The 422 copy for the (production-unreachable) delisted refusal reuses that moderation line's first sentence via `DISCOVERY_COPY`. |
| D7 | **Outcome line for a listing change.** | `"Listing updated."` — the `outcomeCopy` register (`"Security updated."`). |
| D8 | **Badge placement/separator on `poll-card`.** DESIGN.md:633 says "beside the Poll's open/closed status"; a closed unlisted poll renders `CLOSED` and `UNLISTED` in identical type and color. | Badge joins the status cluster (right side) separated by the metadata line's existing `·` idiom. The word alone distinguishing them is the system's stated rule ("the word carries the state"); the middot keeps them from reading as one phrase. Badge is non-interactive — the whole row stays one tap target (UX-DR11: no secondary actions inside the row). |

### Architecture guardrails (binding invariants)

- **AD-5 (spine:94-107):** "Persist `result_visibility` separately from `discovery_state`. Every new Poll starts `unlisted`; creation presents an explicit opt-in to `listed`. Unlisted Polls remain reachable by link but are absent from discovery and sitemaps. Discovery owns the `unlisted`, `listed`, and `delisted` state machine… Delisting changes neither ownership, result visibility, nor Vote data." Both columns already exist and are independent — never derive one from the other.
- **AD-19 / AR-1 one owner, one write path:** "Discovery owns listing and moderation state… Only the owning module's application commands may write its tables." The `update-listing` route wires `setPollListing` from `src/modules/discovery`; no route, no Polls command, and no adapter caller writes `discovery_state` outside it (creation initialization excepted per D2).
- **AD-24:** listing writes do NOT bump `representation_version` (D1). Do not copy the bump from `poll-security.ts`.
- **AD-1 hexagonal:** the command is provider-free with injectable ports; the route only parses FormData and maps Results. No business rules in route frontmatter (recurring HIGH review finding).
- **AD-3:** discrete column, never a settings blob; creation stays one atomic batch.
- **AD-13:** `discover`, `sitemap.xml`, `robots.txt` are already reserved slugs (`src/modules/polls/reserved-slugs.ts:8,16,17`) — nothing to do, do not re-reserve.
- **AD-22 CSRF:** the listing form posts to the existing creator route behind the middleware; include `csrf_token`; the strict parser must allowlist the new keys or parsing throws.
- **AD-15 telemetry:** one structured record per operation, IDs and codes only.
- **AD-23 shared kernel:** `DISCOVERY_STATES` / `DiscoveryState` already live in `src/shared/domain/index.ts:49-50`, pinned by `tests/unit/shared-kernel.test.ts:38`. Import; do not redeclare. The creator-settable subset (`unlisted | listed`) is Discovery-module policy, not a kernel change.
- **AR-19 conventions:** POST→303 on success; 422 re-render with preserved values from *persisted* truth on policy rejection; stable snake_case codes; Zod at the delivery boundary with domain re-enforcement; no env lookup in modules.
- **AR-17's cache-namespace clause is Story 3.2's obligation**, not this story's — no discovery caching work here.

### Existing code this story touches (verified on main @ a2ba154)

- `db/migrations/0004_polls.sql` — `discovery_state TEXT NOT NULL DEFAULT 'unlisted'` **already exists** with the AD-5/AD-19 header comment. **No migration in this story.** `tests/integration/polls-schema.integration.test.ts` already pins the column via `PRAGMA table_info`.
- `src/shared/domain/index.ts:49-50` — `DISCOVERY_STATES = ["unlisted","listed","delisted"] as const` + `DiscoveryState`. Exists, exported, currently zero consumers.
- `src/modules/discovery/index.ts` — placeholder (`export {}`). This story populates it.
- `src/modules/polls/index.ts` — `CreatePollDraft` (~43), `validateCreatePoll` (~248) with the `isResultVisibility` guard at 231 and the "Stable per-field reason codes" comment, `PollPersistenceRows.poll.discoveryState: "unlisted"` literal (377), hardcoded write in `createPoll` (699), `matchesExistingPoll` (~480) / `draftContentForCompare` for the retry-dedupe.
- `src/modules/polls/poll-security.ts` — the command template (parse → snapshot → pure decision → port outcome union → Result mapping). `LoadOwnedPollPort` / `PollLifecycleSnapshot` in `poll-lifecycle.ts:128,45`.
- `src/adapters/d1/index.ts` — INSERT binds `discovery_state` at ?7 (156,165); **no SELECT reads it anywhere**; hand-written per-query SELECT lists at `loadLifecycleForOwner` (~334) and `listPollsForOwner` (~292); `closePollForOwner` (422) is the guarded-UPDATE template *without* the toggles' version machinery; `updateSecurityTogglesForOwner` (627) shows zero-row re-read classification.
- `src/pages/creator/new.astro` — `VISIBILITY_CHOICES` (62), zod `formSchema` (69), `values` defaults (~95), POST mapping (174), the visibility fieldset to clone (312-332), no-silent-default comment (135). Every response `cache-control: private, no-store`; hand-built 303s.
- `src/pages/creator/polls/[pollId].astro` — intent dispatch (129-360), `outcomeCopy` map, `PollCard` at 458/573, section forms at 612/640/686/725, the persisted-truth re-render convention (92-94, 496-517).
- `src/lib/creator-lifecycle-form.ts` — `LifecycleIntent` (5), strict per-intent allowlists, `parseLifecycleForm` (80); unknown keys → `unreadable_lifecycle_form` → 422.
- `src/components/poll-option.astro` — props `{id,name,value,label,description?,checked?,type?,readOnly?,class?}`; description renders `.poll-option-description` in `--color-dim`; `readOnly` variant exists (3.3 will use it — not here).
- `src/components/poll-card.astro` + `poll-card.ts` — `PollCardViewModel {title, metadata, status, href, current}`; status cluster renders `LiveIndicator` or `CLOSED`. Serves creator dashboard, detail left list, and (3.2) the public catalog — hence the *optional* listing prop.
- `src/components/trust-badge.astro`/`.ts` — the badge construction, token-group convention, and walker-test template.
- `src/styles/tokens.css` — collapsed `--color-dim`/`--color-entropy`/`--color-alarm` all exist (dark #78848F/#6E8FB8/#B8705E, light #5A6773/#3D6491/#9A4B33 — all ≥4.5:1 both modes per DESIGN.md:465-476); `--type-label-caps-lg-size: 12px`, `--type-label-caps-lh: 1.4`, `--type-label-caps-ls: 0.18em`.
- Integration seeds that enumerate `poll` columns explicitly (update if the INSERT shape changes — it doesn't, but new assertions touch them): `creator-poll-lifecycle-route.integration.test.ts:52`, `polls-adapter.integration.test.ts:86` (already asserts `discovery_state = 'unlisted'` round-trip), `creator-dashboard-adapter.integration.test.ts:65`.

### UX contract (exact, from DESIGN.md / EXPERIENCE.md / epics.md)

- **UX-DR12 (epics.md:103):** "`listing-badge` + `listing-control` — `UNLISTED`/`LISTED`/`DELISTED` text badges (word carries state, color annotates: dim/entropy/alarm); creation-time opt-in reuses the single-select chooser with consequence lines; Poll detail offers the same two-way control; Delisted renders the control read-only with the moderation line; changeable at any time (discovery is presentation, not integrity)." (Read-only Delisted control = 3.3.)
- **`listing-badge` tokens (DESIGN.md frontmatter, complete object — no size/padding/border/background token exists, by design):** typography `label-caps-lg` (Courier Prime 12px/400/1.4/0.18em, uppercase treatment); `unlistedColor` dim, `listedColor` entropy, `delistedColor` alarm. Light mode resolves by the `-dark`→`-light` suffix swap; `listing-badge` is not one of the three `…Light` exceptions.
- **DESIGN.md:631-633 (badge prose):** the word sits "on each creator `poll-card` and on the Poll detail, **beside the Poll's open/closed status**. Unlisted renders dim — the default needs no emphasis. Listed renders entropy — a data fact about where the Poll appears. Delisted renders alarm — the one state the Creator must not miss."
- **Chooser (DESIGN.md:534-546):** `poll-option` rows — 48px, bottom hairline, visually-hidden native radio with the row as `<label>`, decorative `::before` markers `·`/`◆` (faint/solar-ink), hover `panel` fill, focus `2px solid focus-ring` offset 2px. Consequence line beneath the label in `{typography.body}` (14px) `{colors.dim}` — body, not caption. Selected `◆` is gold; the Visibility chooser already carries the identical publish-button/gold tension — match whatever it does, invent nothing.
- **Form order (EXPERIENCE.md:48, IA):** Question, options, Poll Type, Security Toggles, Visibility Setting, **Discovery Setting**, Deadline, Custom Link. The chooser goes between Visibility and Deadline.
- **EXPERIENCE.md:163 (control behavior):** "At creation, an explicit opt-in reusing the `poll-option` single-select chooser idiom (like the Visibility Setting chooser)… On the Poll detail, the same two-way choice with the current state shown as a `listing-badge`… Changeable at any time — like the Visibility Setting, discovery is presentation, not integrity."
- **EXPERIENCE.md:164 (badge):** "A `{typography.label-caps-lg}` text badge — `UNLISTED`, `LISTED`, or `DELISTED` — on each creator `poll-card` and on the Poll detail. The word carries the state, never color alone."
- **EXPERIENCE.md:261 (accessibility):** "the listing control is a native single-select choice at creation, with the current state carried as a text badge." Native radio semantics; no switch ARIA; 2px/2px focus ring; badge is static text, no focus stop, no live region.
- **Voter surfaces show nothing** (EXPERIENCE.md:214): a delisted (or any) poll by link "renders exactly as any open Poll… No banner, no notice to the Voter: moderation is not the Voter's business." No listing data leaves the creator read paths.
- **Voice:** consequence lines sentence-case, no terminal period, effect-not-instruction; "sitemaps" lowercase, "Discover" capitalized as product noun. No exclamation marks, no opacity, no boxes/chips/radius, no motion (five primitives closed; idle is still), no `faint` on readable text.

### Scope fences — do NOT build in this story

- `/discover` page, catalog query, pagination, discovery cache namespace (AR-17), `sitemap.xml` / `robots.txt` routes, `discovery_state` index → **Story 3.2**.
- Administrator role, delist/clear-delist commands, read-only DELISTED control + moderation line rendering, admin capability assignment → **Story 3.3** (this story ships only the badge vocabulary, the `poll_delisted` refusal, and the SQL guard).
- Landing page, Demo Poll → **Stories 3.4/3.5**.
- No changes to: the AD-7 vote transaction, `PollPage`/voter read paths, results projections, live-results payload, security toggles, `representation_version` semantics, Turnstile, or any migration file (0001–0009 are checksum-immutable).

### Previous-story intelligence (Epic 1/2 patterns that bind)

- **Two-layer enforcement** (2.1): advisory command pre-check + race-free SQL guard in the adapter. Never trust the snapshot at write time — here the guard is `!= 'delisted'` and owner match.
- **Policy rejection re-renders persisted truth, never the rejected draft** (2.1 HIGH finding; 1.12 precedent).
- **Persistence failure is 500, not 422**; telemetry folds ≥500 as error.
- **Stable codes, never copy branching** (1.3): `listing_invalid`, `poll_delisted`; policy keys off codes.
- **No silent defaults for tampered fields** (1.7/2.1 `multiSelect` semantics): absent/invalid `listing` on POST → 422 field error; the Unlisted default lives in the fresh-GET render only.
- **Computed-style E2E assertions** (2.1 review → 2.4 practice): DOM presence is vacuous for a styling contract — assert `font-size: 12px` and resolved state colors in both modes.
- **Astro scoping** (2.4 + 2.1 reviews): parent-page styles reaching into child-component DOM need `:global()` — the badge inside `poll-card`'s status cluster is exactly that shape; check both surfaces.
- **E2E traps** (2.3/2.4): `pnpm migrate:local` before local e2e; vote/interact via custom link + `label.poll-option` click; assert attachment/count not `toBeVisible()` for absence checks; scope absence assertions to `<main>` (Vite inlines component `<style>` into `<head>` in dev); focused reruns via `pnpm exec playwright test <spec>`.
- **Walker-test authoring** (2.4 debug log): the render-site regex must match the exact source shape including expression wrappers.
- **`.astro` type blind spot** (Epic 2 retro): `tsc --noEmit` skips templates; component wiring defects surface only via review or e2e — wire the badge props carefully and let e2e prove them.
- **Deferred-work check:** nothing in `deferred-work.md` blocks this story. The three Epic-2 deferrals (seedPoll SQL, walker fragility, `afterAll` leak) are pre-existing E2E-harness patterns this story will inherit, not fix.

### Git intelligence

Pattern from PRs #12–#14: one branch (`story/3-1-listing-control-opt-into-discovery`), one PR, one `feat(...)` commit touching module + adapter + pages + component + all three test layers + CHANGELOG + sprint-status, then adversarial review before merge (Epic 2 retro action items 4/5 re-committed). No dependency changes in any Epic 2 story — none here either.

### Tech stack (no new dependencies, no web research required)

Node 24.18.0 · pnpm 11.17.0 · TypeScript 7.0.2 · Astro 7.1.5 · `@astrojs/cloudflare` 14.1.6 · Better Auth 1.6.25 · Wrangler 4.115.0 · Vitest 4.1.10 · `@cloudflare/vitest-pool-workers` 0.19.0 · Playwright 1.62.0 · fast-check 4.9.0 · Zod 4.4.3. Zero new packages, zero client JavaScript, zero bindings/secrets/env changes, zero migrations.

### Testing requirements

Three layers, strict separation ("never move pure-logic tests into integration"):

| Layer | File | What it proves |
|---|---|---|
| unit (node) | NEW `tests/unit/discovery.test.ts`; UPDATE `polls.test.ts`, `creator-lifecycle-form.test.ts` | parse subset, idempotence, delisted refusal, outcome mapping, copy exact; draft mapping + dedupe drift; intent allowlist |
| unit walker | NEW `tests/unit/listing-badge.test.mjs`; UPDATE `poll-card.test.mjs` | token bindings, three states, no hex/opacity/radius/shadow/motion; optional badge slot |
| integration (workerd, real D1) | NEW `discovery-adapter.integration.test.ts`; UPDATE `create-poll-route`, `creator-poll-lifecycle-route`, `creator-dashboard-adapter`, `poll-lifecycle-adapter` | guarded update matrix incl. delisted + no version bump; create persists choice; route intent matrix; badge state on list reads |
| e2e (Playwright) | NEW `tests/e2e/listing-control.spec.mjs` | default UNLISTED, opt-in LISTED, flip both ways, computed styles dark+light, dashboard + detail badge, voter page clean |

Gate order before merge: `pnpm migrations:guard` → `pnpm test` → `pnpm check` → `pnpm test:e2e` → `pnpm types` → `git diff --exit-code worker-configuration.d.ts` → `pnpm build:production`. Screenshot proof under `test-results/story-3-1-listing-control-proof/`, 375 dark + 1280 light minimum.

### Project Structure Notes

- NEW: `src/modules/discovery/index.ts` (replaces stub), `src/components/listing-badge.astro`, `tests/unit/discovery.test.ts`, `tests/unit/listing-badge.test.mjs`, `tests/integration/discovery-adapter.integration.test.ts`, `tests/e2e/listing-control.spec.mjs`.
- UPDATE: `src/modules/polls/index.ts`, `src/modules/polls/poll-lifecycle.ts`, `src/adapters/d1/index.ts`, `src/lib/creator-lifecycle-form.ts`, `src/pages/creator/new.astro`, `src/pages/creator/polls/[pollId].astro`, `src/components/poll-card.astro`, `src/components/poll-card.ts`, `src/styles/tokens.css`, plus the test files above and CHANGELOG/sprint-status.
- No `src/scripts/*` change (no client JS). No `shared/domain` change (enum exists). No migration, no wrangler/env change, no `worker-configuration.d.ts` drift (gate asserts it).
- Component conventions (uniform across `live-indicator`/`trust-badge`/`poll-card`): JSDoc with story + UX-DR citation stating what the component owns and does not own; `interface Props` with `class?: string`; `class:list` + `data-*` hook; scoped `<style>` with `listing-badge-*` class prefix.
- Naming discipline across layers (do not invent a fourth variant): form field `listing` → draft `discoveryState: string` (raw) → validated/domain `discoveryState: DiscoveryState` → column `discovery_state` (mirrors form `visibility` → draft/validated `resultVisibility` → column `result_visibility`).

### References

- Requirements: `_bmad-output/planning-artifacts/epics.md` — Epic 3 intro (694-696), Story 3.1 (698-719), Story 3.2 preview (721-741), Story 3.3 preview (743-770), UX-DR2 (93), UX-DR11 (102), UX-DR12 (103), UX-DR19 (110), AR-1 (68), AR-17 (84), Epic 3 note (167)
- PRD: `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md` — FR-23 (254-260), glossary Discovery Setting/Unlisted/Delisted (54, 70-73), Unlisted-by-default pillar (303), Custom-Link/obscurity note (108)
- Architecture: `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` — AD-5 (94-107), AD-4 (80-92), AD-19 (290-301, ownership table 477-484), AD-21 (318-328), AD-23 (342-353), AD-24 (355-366), AD-13, AD-11, AD-22, capability map (504), deferred listing-moderation note (523)
- UX: `.../ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md` — frontmatter `components.listing-badge` + `components.poll-option`, label-caps-lg (491), poll-option chooser (534-546), listing-badge prose (631-633), poll-card (621-623), contrast table (465-476), don'ts (669-678); `EXPERIENCE.md` — IA order (48), discovery IA rule (60), Voice principles (70-77), delisted moderation line (128), Visibility chooser precedent (141), poll-card behavior (155), listing-control (163), listing-badge (164), state rows (213-214), accessibility floor (261), UJ-6 (401)
- Prior stories: `_bmad-output/implementation-artifacts/2-1-per-poll-security-toggles.md` (chooser fieldset, intent, guarded update, decisions D1-D5, review findings), `2-4-trust-badge.md` (badge component, token group, walker test, E2E traps), `epic-2-retro-2026-08-03.md` (Epic 3 readiness, action items)
- Code: `src/shared/domain/index.ts:49-50`, `src/modules/discovery/index.ts`, `src/modules/polls/index.ts:231,377,480,699`, `src/modules/polls/poll-security.ts:152`, `src/modules/polls/poll-lifecycle.ts:45,128`, `src/modules/polls/reserved-slugs.ts:8,16,17`, `src/adapters/d1/index.ts:156,165,292,334,422,627`, `src/pages/creator/new.astro:62,69,135,312-332`, `src/pages/creator/polls/[pollId].astro:129-360,458,573`, `src/lib/creator-lifecycle-form.ts:5,80`, `src/components/poll-option.astro`, `src/components/poll-card.ts`, `src/components/trust-badge.astro`, `src/styles/tokens.css`, `db/migrations/0004_polls.sql`, `tests/unit/shared-kernel.test.ts:38`, `tests/integration/polls-schema.integration.test.ts:59`, `tests/integration/polls-adapter.integration.test.ts:86`

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

- 2026-08-03 — Task 1 red-green-refactor: added the Discovery command contract and 15 focused unit tests; pinned Node 24 full Vitest regression passed 935/935.
- 2026-08-03 — Task 2 red-green-refactor: added five real-D1 adapter tests, guarded listing persistence, and creator read mappings; TypeScript and the 940-test regression suite passed.
- 2026-08-03 — Task 3 red-green-refactor: added required listing validation, atomic initial persistence, dedupe comparison, create-form chooser, and route coverage; TypeScript and 948 tests passed.
- 2026-08-03 — Task 4 red-green-refactor: added strict lifecycle parsing, detail listing control/dispatch, persisted-truth rejection handling, outcome contract, status badge, and route tests; TypeScript and 955 tests passed.
- 2026-08-03 — Task 5 red-green-refactor: added the three-state tokenized ListingBadge and optional poll-card composition on both creator surfaces; TypeScript and 961 tests passed.
- 2026-08-03 — Task 6 validation: visually inspected six browser proofs; the exact Node 24.18.0 merge gate passed 961 unit/integration tests, 145 Playwright tests, binding drift verification, and the production build.
- 2026-08-03 — Task 7 documentation: updated the Unreleased changelog, story record, and sprint status; no binding, secret, environment, migration, README, or AGENTS.md change was required.

### Completion Notes List

- Task 1: Implemented provider-free listing vocabulary, parsing, command policy, safe persistence errors, delisted race handling, and the explicitly non-versioned adapter contract.
- Task 2: Added race-safe owner listing writes plus lifecycle/dashboard state reads while keeping voter reads and representation versions unchanged.
- Task 3: Added the no-JS Discovery Setting chooser and made missing/tampered POST values fail explicitly while preserving atomic create and retry semantics.
- Task 4: Added the creator detail listing workflow with correct 303/404/422/500 mappings, no version bump, and a visible state word beside Poll status.
- Task 5: Centralized listing-state presentation in a still, word-first badge and threaded its optional view-model value through creator poll cards.
- Task 6: Added browser coverage for default/opt-in creation, both listing transitions, non-versioned persistence, creator-only badges, computed styles in both modes, and voter-page non-disclosure; all six required screenshots were inspected.
- Task 7: Documented the user-facing listing control and completed the BMad review handoff records.

### File List

- src/modules/discovery/index.ts
- src/modules/polls/poll-lifecycle.ts
- src/modules/polls/index.ts
- src/adapters/d1/index.ts
- src/pages/creator/new.astro
- src/pages/creator/index.astro
- src/pages/creator/polls/[pollId].astro
- src/lib/creator-lifecycle-form.ts
- src/components/listing-badge.astro
- src/components/poll-card.astro
- src/components/poll-card.ts
- src/styles/tokens.css
- tests/unit/discovery.test.ts
- tests/unit/poll-lifecycle.test.ts
- tests/unit/poll-security.test.ts
- tests/integration/discovery-adapter.integration.test.ts
- tests/integration/create-poll-route.integration.test.ts
- tests/integration/polls-adapter.integration.test.ts
- tests/unit/polls.test.ts
- tests/unit/creator-lifecycle-form.test.ts
- tests/integration/creator-poll-lifecycle-route.integration.test.ts
- tests/unit/listing-badge.test.mjs
- tests/unit/poll-card.test.mjs
- tests/e2e/listing-control.spec.mjs
- tests/e2e/create-poll-authed.spec.mjs
- tests/e2e/results.spec.mjs
- CHANGELOG.md
- _bmad-output/implementation-artifacts/3-1-listing-control-opt-into-discovery.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-08-03 — Story created via create-story (ultimate context engine: architecture, UX, and codebase audits + Epic 2 retro intelligence). No migration required; `discovery_state` and `DiscoveryState` pre-exist. Status: ready-for-dev.
- 2026-08-03 — Implemented listing control end to end, added creator-surface badges and browser proof, passed the full merge gate, and moved the story to review.

### Review Findings

- [x] [Review][Patch] `.poll-card-status-separator` has no explicit color — inherits page text color while sibling `CLOSED`/`UNLISTED` badges both use `--color-dim` — fixed, added `color: var(--color-dim)` [src/components/poll-card.astro:132-134]
- [x] [Review][Patch] ~~`.field-error` and `.form-error` CSS blocks are identical duplicates~~ — re-evaluated: blocks differ in margin (`.form-error` has `margin: 0 0 var(--space-4)`, `.field-error` has `margin: 0`); combining shared properties would require 3 blocks instead of 2 with specificity risk; dismissed as noise
- [x] [Review][Defer] If `loadLifecycleForOwner` fails after `findPollForOwner` in the delisted error branch, the "Delisted by the Administrator" message is swallowed and replaced with 404 — pre-existing pattern, same gap in the security toggles path [src/pages/creator/polls/[pollId].astro:431-441, 479-485]
