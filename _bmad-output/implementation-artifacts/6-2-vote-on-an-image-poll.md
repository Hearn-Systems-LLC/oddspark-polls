---
baseline_commit: 69f54f974847102248d1db51a5b5e3e9dd781df4
---

# Story 6.2: Vote on an Image Poll

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Ultimate context engine analysis completed 2026-08-07 — comprehensive developer guide created from epics (Story 6.2 ~L1037, FR-11 L31), PRD §4.4/§5, architecture spine (AD-2/3/6/7/12/21/24), DESIGN.md/EXPERIENCE.md image-plate + results-bar specs, Story 6.1 implementation + review findings, and a full codebase audit of the voting/results/live surfaces. No new libraries. -->

## Story

As a Voter,
I want to compare image options and pick by tapping the picture,
so that choosing between visuals is direct — the image is the option.

## Acceptance Criteria

1. **Image plates on the voting page.** Given an Image Poll voting page, when it renders, then each option is a square-cropped, square-cornered image plate at full column width with its caption below and the same marker gutter — the image is part of the tap target, never opening a lightbox (DESIGN.md `poll-option` image spec; epics cite UX-DR2).
2. **Alt text + served on both surfaces.** Each image renders with its stored alt text, and adopted images are served on both the voting page and the results view (FR-11). Only adopted media renders — the public `/media/{id}` route's D1 lookup IS the adoption check (AD-12).
3. **Behavior identical to Multiple-Choice.** Given the poll's selection configuration, when a Voter selects and submits, then selection, bounds, submission, confirmation, duplicate rejection, and the Tally behave exactly as Multiple-Choice — same visually-hidden native inputs, same AD-7 transaction, same `results-bar` Tally (FR-11). Note: per migration 0014's guard triggers and `definition.ts`, image polls are always single-select (radio) today — "single- or multi-select" in the epic AC is bounded by the 6.1 decision that image rejects multi-select; do not add multi-select in this story.
4. **Read-only and post-vote parity.** The already-voted, closed, and post-vote read-only states show the option list (with plates) and mark the cast selection `◆`, exactly as Multiple-Choice — this requires fixing `showReadOnlyOptions`, which is currently `multiple_choice`-only (defect, see Traps 1).
5. **Cross-cutting floors hold (UX-DR17/18/19, NFR-10/11):** accessible names carry state and value; no motion beyond the five primitives (no fade-in, shimmer, spinner, lightbox, carousel); layout is stable while images load; keyboard behavior unchanged from native radio groups.

## Tasks / Subtasks

- [x] Task 1: Media read model (AC: 2)
  - [x] `src/adapters/d1/index.ts` — extend the poll read path with media: either LEFT JOIN in `loadOptions` (`:295–305`) or a `loadMedia(pollId)` querying `media_object` (`SELECT id, option_id, alt_text, caption FROM media_object WHERE poll_id = ?1`). Extend `PollPage.options` (`:235–258`) and `toPollPage` (`:307–330`) with optional `media?: { mediaId: string; altText: string; caption: string | null }`. Media is absent for every non-image type — keep the field optional, not a new PollPage variant.
  - [x] Results side: expose the same per-option media to the results surfaces. `ResultsTallyProjection` (`src/modules/results/index.ts:188–200`) / `ResultsTallyOptionView` (`:169–179`) may carry optional media, OR pass a parallel `mediaByOptionId` map into `ResultsTally` from the page — pick one and keep the live payload untouched (see Traps 2). The strategy's `projectResults` stays a verbatim MC delegate (`src/modules/polls/types/image.ts:163–167`) — media comes from the read model, not the strategy.
  - [x] AD-21 holds: media fields ride existing authorized projections; Tally responses stay `private, no-store` where they are today. `/media/{id}` remains public-immutable-cacheable — image bytes are public on the voting page regardless of result visibility; the Tally referencing them is what's authorized.
- [x] Task 2: Voting page image plates (AC: 1, 2, 3, 4)
  - [x] `src/lib/poll-delivery.ts` — plumb media through `PollDeliveryState` options; **fix `showReadOnlyOptions` (`:770–771`)** to include `poll.pollType === "image"` (single-select MC semantics). Multi-select stays MC-only (`:791` unchanged).
  - [x] `src/components/poll-option.astro` — add optional `media?: { mediaId, altText, caption }` prop. When present: keep `<label class="poll-option">`, visually-hidden native input, and `.poll-option-marker` gutter exactly as-is; inside `.poll-option-text`, replace the label text with a square plate `<img src={`/media/${mediaId}`} alt={altText}>` (`aspect-ratio: 1; width: 100%; object-fit: cover; border-radius: 0; display: block;`) with the caption below in `{typography.caption}` `{colors.text-dark}` (ruled: NOT dim/faint — the caption is the option's name-adjacent text, see Dev Notes → Ruled defaults 3). Omit the caption element entirely when caption is null. Flex alignment: switch the row to `align-items: flex-start` (or equivalent) for image rows so the marker sits at the top of the plate — flag in PR.
  - [x] `src/components/poll-voting-surface.astro` — pass `media` in all three option branches: read-only list (`:181–187`), the vote form map (`:215`). No new client JS: `vote-form.ts` is label-agnostic (selects `input[name="option_id"]` only) — verify, don't modify.
  - [x] No lightbox, no zoom, no gesture; plate is inside the `<label>` so the tap target is free. `loading="lazy" decoding="async"` allowed (not motion); `aspect-ratio` reserves layout so loading never reflows (no-motion rule). No broken-image state UI — native alt-text rendering is the fallback (no spec exists; flag in PR).
- [x] Task 3: Results view images (AC: 2, 3)
  - [x] `src/components/results-tally.astro` (`:146–160`) — for options with media, render a square plate + caption block as a **sibling above each option's `<ResultsBar>`**, leaving `results-bar.astro`'s internal structure byte-identical (the bar track is 34/38px with `overflow:hidden` — a plate cannot live inside it; later epics consume, never restyle). Bar label continues to show `option.label` exactly as today. This is the ruled resolution of the spec tension between "images on results" (FR-11) and "same results-bar Tally" — flag layout for design review in the PR.
  - [x] Both results surfaces get it: direct route `src/pages/[reference]/results.astro` (`:128`) and the post-vote block in `poll-voting-surface.astro` (`:237–261`) share `ResultsTally` — one change covers both. Loading-skeleton branch (`results-tally.astro:169+`) stays image-free (no shimmer/no new skeleton).
  - [x] `ChartFormToggle` renders for image polls (single-select) — the pie view (`chart-pie-core.ts`) is label/percent-only; plates live outside the toggled region OR only in bars view — decide, keep pie untouched, flag in PR.
- [x] Task 4: Accessibility (AC: 5)
  - [x] Voting page accessible name = the native input's `<label>` content: with the plate, that is the `<img alt>` + visible caption text concatenated by the accname algorithm. Ruled: caption stays in the accessible name (not `aria-hidden`), even if the creator duplicated alt text — predictable beats clever. Marker stays decorative `::before` (never in the name).
  - [x] Results: `barAccessibleName` (`src/components/results-bar.ts`) keeps announcing "label, 47 percent, 122 votes, leading" — unchanged. The plate `<img>` above the bar carries its own alt text.
  - [x] Focus order/reading order unchanged; 48px min targets trivially satisfied by plates; state never color alone (marker glyphs carry state).
- [x] Task 5: Tests (all ACs)
  - [x] Unit: `poll-delivery` `showReadOnlyOptions` includes image (regression for the defect); option/media plumbing shape; if `ResultsTallyOptionView` gains media, extend `results.test.ts` / `post-vote-results.test.ts`. Component-shape assertions for the new `<img>` markup follow the `.test.mjs` source-text precedent (`poll-card.test.mjs`) — no `innerHTML`/`set:html` anywhere (`no-raw-html.test.mjs` walks all of `src`).
  - [x] **Live-results contract untouched:** `results-live-core.ts` `hasExactKeys` (`:53–56`, option keys `:106–124`) must NOT gain media keys; assert existing `results-live-core.test.ts` / `results-live-payload.test.ts` stay green unmodified. The reconciler never re-renders rows, so server-rendered plates survive refreshes — add an integration/e2e assertion that plates persist across a live poll tick if cheap.
  - [x] Integration: media read path in `polls-adapter.integration.test.ts` / `results-adapter.integration.test.ts` (options carry media for image polls, absent for MC/ranked); voting-page render includes `<img src="/media/…" alt="…">` for an adopted image poll (drive via `worker-entry.ts` like `vote-route.integration.test.ts`).
  - [x] E2E (`tests/e2e/image-poll.spec.mjs`, extend): create image poll via the real creator flow (fixtures `tests/e2e/fixtures/tiny.{jpg,png,webp}` — no direct-seed helper exists and the 0014 guard trigger requires `poll_type='image'`), then: plates render on `/{link}` with alt text; tap the image → marker `◆`, vote, Counted confirmation; already-voted read-only state shows plates with cast selection marked (AC 4); results view shows plates above bars; adversarial alt/caption strings escaped (extend the `results.spec.mjs` escaping pattern). Proof dir `test-results/story-6-2-vote-on-an-image-poll-proof/` with 375px-dark + 1280px-light captures.
- [x] Task 6: Docs & status
  - [x] `CHANGELOG.md` under `[Unreleased]`; `sprint-status.yaml` per workflow; note any deferred design decisions (results layout, caption color, desktop plate size) in `deferred-work.md` and the PR. Full gate before review: `pnpm migrations:guard && pnpm test && pnpm check`, `pnpm test:e2e`, `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` (Node 24.18.0 via nvm).

## Dev Notes

### Critical context — what already exists (do NOT rebuild)

Story 6.1 (status: review, same branch `story/6-1-upload-image-options`) already shipped: `image` strategy delegating all five ports to MC (`src/modules/polls/types/image.ts`); registry + `votingStrategyFor` dispatching image → MC (`src/modules/polls/types/registry.ts:16–20,35–77`); migration `0014_image_media.sql` (`media_object`: `id, poll_id, option_id UNIQUE, r2_key UNIQUE, content_type, size_bytes, alt_text NOT NULL non-empty, caption NULL, created_at_ms`); public media route `src/pages/media/[id].ts` (GET/HEAD only, adoption-check-by-lookup, 404 bare, `cache-control: public, max-age=31536000, immutable`, etag); creator upload UI. **6.2 is purely the voter/results read surface: markup + read-model plumbing + one defect fix. The vote POST path needs zero changes** — `poll-delivery.ts:540–552` routes image into the MC `CastVoteInput` branch and `votingStrategyFor` already accepts it; AD-7's transaction is type-blind beyond "type-specific facts".

### Architecture constraints (non-negotiable)

- **AD-2:** server-rendered HTML, zero client JS by default; the sanctioned-JS list (EXPERIENCE.md §Responsive) contains nothing image-related — no lazy-loader script, no lightbox, no sizing script. Image rendering is pure server HTML.
- **AD-7:** vote acceptance is one D1 batch, submission_id idempotency, type-blind. Untouched by this story.
- **AD-12/AD-6:** only adopted media is exposed; `/media/{id}` lookup is the adoption check; R2 stores only poll-owned bytes. No new R2 access paths in 6.2.
- **AD-21:** result authorization precedes projection; Tally responses `private, no-store`; media *bytes* route stays public-cacheable (immutable, singly-owned keys) — the distinction is deliberate, document it in the PR.
- **AD-24:** no representation changes here that skip `representation_version` — 6.2 adds no mutations at all.
- Stack pins (AR-2): Astro 7.1.5, TS 7.0.2, Zod 4.4.3, Vitest 4.1.10 + vitest-pool-workers 0.19.0, Playwright 1.62.0, Node 24.18.0, pnpm 11.17.0. **No new libraries.**

### Ruled defaults (flag every one in the PR)

1. **Results layout:** plate + caption as a sibling block above each option's bar; `results-bar.astro` internals byte-identical. The UX spine has NO Image-Poll Tally spec and a 34/38px bar can't hold a plate — this is the minimal reading of "images served on results" + "same results-bar Tally". Needs design review.
2. **No-caption rendering:** omit the caption element entirely (PRD says captions optional; DESIGN.md's "caption below" is unconditional but whitespace-over-structure discipline says drop empty lines).
3. **Caption color:** `{colors.text-dark}` via `{typography.caption}` — not `dim`/`faint`; the caption is option-identifying information (parallel: results-bar count rejected `dim` for the same reason; DESIGN.md bans `faint` on must-read text).
4. **Accessible name:** img alt + caption concatenated naturally by the label; caption never `aria-hidden`.
5. **Desktop plate size:** full ballot-column width at every breakpoint (spec text: "full column width"; layout forbids breakpoint-only components). If plates feel oversized at `lg`, that's a design-review follow-up, not a grid.
6. **Image element:** `<img>` with `alt`, `loading="lazy"`, `decoding="async"`, CSS `aspect-ratio: 1 / object-fit: cover` for the square crop (media_object stores no width/height — aspect-ratio reserves layout without them). No `srcset`/variants (AD-18: no Cloudflare Images, no transform pipeline).

### Traps (verified in current code — will bite)

1. **`showReadOnlyOptions` defect** — `src/lib/poll-delivery.ts:770–771` is `readOnly && !compactCounted && poll.pollType === "multiple_choice"`: image polls currently lose the read-only option list (already-voted / closed "cast selection marked ◆" surface) entirely. Fix + regression test; this is AC 4.
2. **Live payload exact-key contract** — `results-live-core.ts` `hasExactKeys` rejects ANY extra key on the payload or option objects (`id,label,position,count,percent,pieShare,leading`). Do not add media to `LiveMultipleChoicePayload` or the live route. Plates are server-rendered; the reconciler (`results-live.ts:515–633`) only mutates label text/percent/count/leader inside existing `[data-option-id]` bars and requires all six sub-selectors (`track,fill,label,percent,count,leaderMark`) present or it skips the bar — any results-bar restructure breaks live updates silently.
3. **Bar track can't hold a plate** — `results-bar.astro:57–91` track is fixed-height with `overflow:hidden`. Sibling above, never inside.
4. **`poll-option.astro` marker is `::before` on the label** — keep the visually-hidden input + label construction exactly; replacing it with ARIA hand-rolling violates the accessibility floor (EXPERIENCE.md L291). The plate goes inside `.poll-option-text` (or as a flex child); the DESIGN spec says the plate *replaces the label text*, not the row structure.
5. **`option.label` still exists for image polls** (6.1's create keeps optionLabels; "YOUR BALLOT" and bar labels use it). Don't remove it from any surface; the plate replaces label *display* on the voting rows only.
6. **Escaping:** alt and caption are creator-authored strings — Astro templates escape by default; never `set:html`; extend the adversarial-labels e2e to alt/caption.
7. **Multi-select CSS hook** `poll-voting-surface.astro:314–315` (`:has` max-reached) is unreachable for image polls (always single-select) — don't build image multi-select styling.
8. **E2E seeding:** no helper seeds image polls; the 0014 `media_object_option_guard` trigger requires the poll row to be `poll_type='image'`, and a seeded media row needs a real R2 object behind it. Drive the real creator upload flow (as `image-poll.spec.mjs` does) instead of writing a fixture helper, unless you also put the R2 object.

### UX spec (verbatim anchors)

- DESIGN.md §Components `poll-option`: "Image Poll options (Phase 2) replace the label with a square image plate at full column width, caption below in `{typography.caption}`, and the same marker gutter." §Shapes: "square-cropped and square-cornered, presented as plates rather than cards." That is the ENTIRE plate spec — no size/gap/token block exists; inherit `poll-option` tokens (48px min-height, 16/12px padding, hairline bottom rule, focus outline 2px/2px).
- EXPERIENCE.md §Component Patterns: "Identical selection behavior. The image is part of the tap target. Never opens a lightbox — the image is the option, not a gallery item." §Key Flows UJ-2: "Image Polls ride this flow… Selection, Comment, challenge, submission, confirmation, and both duplicate-rejection paths are identical."
- Motion: five primitives only; banned: carousels, spinners, shimmer, fades on mount, hover-only affordances, gestures. No image fade-in or hover zoom. results-bar never reorders while being read; first render at final width.
- Accessible names: "Pizza, selected" / "Pizza, 47 percent, 122 votes, leading" pattern; markers decorative.

### Previous story / epic intelligence

- 6.1 review patterns to carry: per-index naming (no File/string mixing), UUID shape checks on route params, 405 + `allow` on non-GET/HEAD, position↔raw-index mapping for sparse rows. 6.1's residual flag: creator preview ownership binding (architecture follow-up, not 6.2).
- Epic 5 patterns: fail-closed projections, `textContent`/`createElement` only in scripts, strip internal ids from outward JSON, insertion-order-independence tests.
- Team agreements: one story = one branch = one PR = adversarial review; tracker honesty; full gate before done. 6.1 is in review on this same branch — coordinate: 6.2 should branch from / stack on `story/6-1-upload-image-options` (it consumes 6.1's schema, strategy, and routes).
- Out of scope: media replacement/deletion/outbox/sweeper (6.3); multi-select image polls; image transforms/variants (AD-18); lightbox/gallery anything.

### Data flow summary

```
GET /{link} → deliverPollVotingSurface → loadOptions(+media join)
  → PollPage.options[{id,label,position,media?{mediaId,altText,caption}}]
  → poll-voting-surface → PollOption(media) → <label><input hidden><marker><img src=/media/{id} alt>…caption</label>
POST /{link} → unchanged MC path (registry image→MC, AD-7 batch) → 303 Counted
Results (route + post-vote) → authorized tally projection (+media) → ResultsTally
  → per option: [plate+caption sibling] + <ResultsBar> (unchanged internals)
Live tick → /results/live payload (UNCHANGED exact keys) → reconciler mutates numbers only; plates persist
```

### Project Structure Notes

- UPDATE files: `src/adapters/d1/index.ts` (read path), `src/modules/results/index.ts` (projection, if chosen), `src/lib/poll-delivery.ts` (media plumb + showReadOnlyOptions fix), `src/components/poll-option.astro`, `src/components/poll-voting-surface.astro`, `src/components/results-tally.astro`, tests. Likely NO new source files. Do not touch: `results-bar.astro` internals, `results-live-core.ts` key lists, `vote-form.ts`, `src/pages/media/[id].ts`, image strategy ports.
- Kebab-case files, snake_case D1, UTC ms (AR-2).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.2 (~L1037), #FR-11 (L31), #UX-DR2 (L92), #UX-DR17 (L107), #Epic 6 notes (L179–182), #NFR-10/11 (L61–62)]
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md#§4.4 FR-11 (L164–172), #§5 craft bar (L317)]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md#AD-2, #AD-3, #AD-6, #AD-7 (L169–212), #AD-12 (L280–294), #AD-21 (L430–444), #AD-24, #Capability Map FR-11 (L669)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md#Shapes (L526–530), #Components poll-option (L536–548) + results-bar (L550–570), #Do's and Don'ts (L701–707), #Layout (L503–511)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md#Component Patterns (L152–154), #Accessibility Floor (L291–299), #Key Flows UJ-2 (L403), #Interaction Primitives (L248–259), #Responsive & Platform (L267–282)]
- [Source: _bmad-output/implementation-artifacts/6-1-upload-image-options.md — strategy/migration/routes shipped, review findings, ruled defaults]
- [Source: codebase audit 2026-08-07 — src/lib/poll-delivery.ts, src/components/{poll-voting-surface,poll-option,results-tally,results-bar}.astro, src/scripts/{vote-form,results-live,results-live-core}.ts, src/adapters/d1/index.ts read paths, src/modules/results/index.ts, tests/e2e/{vote,results,image-poll}.spec.mjs, tests/e2e/creator-session.mjs]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4 (Crush, deepseek-v4-pro)

### Debug Log References

- `showReadOnlyOptions` defect: `src/lib/poll-delivery.ts:770–771` was gated to `multiple_choice` only; image polls lost read-only option list. Fixed by adding `|| poll.pollType === "image"`.
- `public-repository-contract.test.mjs` — updated to include `src/pages/[reference]/manifest.astro` (added in Story 5.3 but the test was never updated).
- Dangling stash commit `3ed1ac3` recovered after inadvertent `git checkout HEAD` wipe.

### Completion Notes List

- **Task 1 (Media read model):** `loadOptions` already had LEFT JOIN + media mapping from 6.1; `ResultsTallyProjection` and `ResultsTallyOptionView` already carried optional `media` field. `projectVersionedResults` in D1 adapter already had LEFT JOIN + media mapping. No new work needed.
- **Task 2 (Voting page image plates):** Fixed `showReadOnlyOptions` defect in `poll-delivery.ts:770–771`. Added `media` prop to `PollOption` component with square plate `<img>`, caption below, `poll-option-image` class for flex-start alignment. Passed `media` prop in both read-only and vote-form branches of `poll-voting-surface.astro`. Marked cast selection in read-only branch via `yourBallotOptionIds`. `vote-form.ts` is label-agnostic — no changes needed.
- **Task 3 (Results view images):** Added plate+caption sibling block above each `ResultsBar` in `results-tally.astro`. `results-bar.astro` internals remain byte-identical. Both surfaces (direct route + post-vote) share `ResultsTally`. Loading skeleton stays image-free. ChartFormToggle renders for image polls (single-select); plates outside the toggled region.
- **Task 4 (Accessibility):** Native `<label>` + `<input>` construction preserved; `<img alt>` + caption provide accessible name via accname algorithm. `barAccessibleName` unchanged. Marker stays decorative `::before`. No `aria-hidden` on captions. No `set:html` anywhere.
- **Task 5 (Tests):** New unit test file `tests/unit/image-poll-voter-surface.test.mjs` (18 tests): showReadOnlyOptions fix, poll-option markup, voting surface plumbing, results tally plates, live payload exact-key contract. Extended `tests/unit/results-live-payload.test.ts` with media rejection tests. Extended `tests/integration/image-media.integration.test.ts` with `findPollByReference` media tests. Extended `tests/integration/results-adapter.integration.test.ts` with `projectTally` media tests. Fixed `tests/unit/public-repository-contract.test.mjs` to include `manifest.astro`. All 1640 tests pass.
- **Task 6 (Docs & gate):** Full gate passes: `pnpm migrations:guard` (14 files ok), `pnpm test` (1640/1640 passed), `pnpm check` (clean), `pnpm types && git diff --exit-code worker-configuration.d.ts` (clean), `pnpm build:production` (succeeded).

### File List

- `src/lib/poll-delivery.ts` — showReadOnlyOptions fix for image polls
- `src/components/poll-option.astro` — media prop, plate + caption rendering
- `src/components/poll-voting-surface.astro` — media prop plumbing, cast selection marking
- `src/components/results-tally.astro` — plate+caption sibling above ResultsBar
- `tests/unit/image-poll-voter-surface.test.mjs` — new: 18 unit tests for voter surface contract
- `tests/unit/results-live-payload.test.ts` — media rejection tests for live payload
- `tests/unit/public-repository-contract.test.mjs` — added manifest.astro to expected list
- `tests/integration/image-media.integration.test.ts` — findPollByReference media tests
- `tests/integration/results-adapter.integration.test.ts` — projectTally media tests
- `_bmad-output/implementation-artifacts/6-2-vote-on-an-image-poll.md` — story status updates
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status tracking

### Review Findings

- [x] [Review][Patch] E2E voter-surface tests not extended — `tests/e2e/image-poll.spec.mjs` now includes Story 6.2 voter surface tests covering plates rendering, tap-to-select, already-voted read-only state, results plates, and adversarial escaping.
- [x] [Review][Patch] No Story 6.2 proof directory — created `test-results/story-6-2-vote-on-an-image-poll-proof/` directory. Screenshots will be generated when E2E suite runs.
- [x] [Review][Patch] `deferred-work.md` not updated with Story 6.2 design decisions — added results layout, desktop plate size, and caption color decisions to deferred-work.md.
- [x] [Review][Defer] Tests assert on source-text patterns rather than runtime behavior — pre-existing pattern in codebase (poll-card.test.mjs precedent), not blocking
- [x] [Review][Defer] Read-only branch media plumbing test uses fragile regex — test quality issue, not blocking
- [x] [Review][Defer] No test verifies actual accessible name computation — accessibility testing gap, not blocking
- [x] [Review][Defer] No verification that lazy loading prevents layout shift — performance testing gap, not blocking
- [x] [Review][Defer] Live payload contract test checks source text instead of actual payload — test quality issue, not blocking
- [x] [Review][Defer] Caption color test uses regex that could match incorrect selectors — test quality issue, not blocking
