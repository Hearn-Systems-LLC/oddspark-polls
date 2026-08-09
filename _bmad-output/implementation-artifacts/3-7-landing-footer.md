---
baseline_commit: c7727c92bd7b13853a82891b97b543292fa22bcc
baseline: "origin/main @ c7727c92bd7b13853a82891b97b543292fa22bcc (UX landing-footer spines merged)"
dependency_story: 3-6-presentable-repository
epic: "3 — Public Face: Discovery, Landing & Demo"
---

# Story 3.7: Landing Footer

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a landing visitor,
I want one quiet full-width footer carrying Create, Discover, the repository, and the Hearn byline,
So that the intro column no longer trails off into orphaned text blocks and the page closes with a single deliberate band (DW-119, UX `landing-footer`).

## Acceptance Criteria

Verbatim from `_bmad-output/planning-artifacts/epics.md` § Story 3.7:

1. **Given** any landing variant — intro-first, outcome-bearing (demo-first), or 503 demo-unavailable — **When** the page renders at `{breakpoints.lg}` and up, **Then** a `<footer>` band spans the full shell width below the two-column grid, outside both columns, separated from the content above by one top hairline, carrying the Hearn byline at the left and `CREATE A POLL`, `DISCOVER POLLS`, `VIEW REPOSITORY` at the right in that order (DESIGN.md §Components `landing-footer`).

2. **Given** the byline, **When** it is inspected or activated, **Then** it is one link to `https://hearn.systems` with `rel="noopener"` opening in the same tab, composed of lowercase `built by ` (trailing space) plus the Hearn. wordmark SVG verbatim from oddspark.dev (`role="img"`, `aria-label="Hearn."`, `fill: currentColor`, height `.78em`, baseline-aligned), with computed accessible name "built by Hearn.", a 44px minimum block target, and the whole line lifting dim → text on hover.

3. **Given** the footer navigation, **When** a visitor tabs through the page, **Then** the byline and the three links follow all main content in source and focus order inside the `<footer>`, the three links sit in a `<nav aria-label="Landing">` at 48px targets with the standard 2px/2px focus outline, and everything is server-rendered and functional without JavaScript (AD-2).

4. **Given** a viewport below `{breakpoints.sm}`, **When** the footer renders, **Then** the row wraps: the byline holds the first line and the three links stack beneath it, left-aligned at 48px targets in the same order, with nothing hidden, nothing rearranged beyond the wrap, and no horizontal overflow (widen-don't-rearrange).

5. **Given** the intro column, **When** the page renders, **Then** the Create and Browse blocks and their standalone rules are gone, the build-account copy ends at "The code is public." with no trailing repository pointer, the repository link renders only in the footer as `VIEW REPOSITORY`, and the token smoke marker remains intact (deploy-gate load-bearing).

## Tasks / Subtasks

- [x] Task 1: Create the Hearn byline presentation component from the verbatim oddspark.dev asset (AC: #2)
  - [x] NEW `src/components/hearn-byline.astro` (or fold into the footer component — one component total, dev's choice). Copy the `HEARN_MARK` SVG **verbatim** from the oddspark worker (`/Volumes/fast/Github/oddspark/src/worker.js:1394`, `const HEARN_MARK`): `viewBox="18.9 24.8 178.6 39.9"`, `role="img"`, `aria-label="Hearn."`, `fill="currentColor"`. Do not redraw, simplify, or re-export it.
  - [x] One `<a href="https://hearn.systems" rel="noopener">` containing lowercase text `built by ` **with the trailing space preserved** (the space keeps the computed accessible name "built by Hearn." — without it the name concatenates) immediately followed by the inline SVG. Opens in the same tab (no `target`).
  - [x] Style with existing tokens only: link color `--color-dim`, hover `--color-text` for text and wordmark together; SVG `height: .78em; width: auto; vertical-align: baseline; margin-left: var(--space-1)`; the whole link is a 44px-minimum block target (`display: inline-flex; align-items: center; min-height: 44px`); standard `--focus-outline` / `--focus-outline-offset`. Byline type is `--type-body-size` (14px) in the machine font.

- [x] Task 2: Build the `landing-footer` in `src/pages/index.astro` and retire the orphaned blocks (AC: #1, #3, #4, #5)
  - [x] NEW footer markup as a sibling of `<main>` inside `.site-shell`: `<footer>` containing the byline and `<nav aria-label="Landing">` with the three links in order `Create a Poll` (`/creator/new`), `Discover Polls` (`/discover`), and `<PublicRepositoryLink surface="landing" />` (which renders the label-caps `View repository` link — the existing `is-landing` 48px treatment already matches the footer idiom).
  - [x] Footer style: full shell width; `margin-top: var(--space-section-gap)` (or equivalent separation) and a single top hairline `var(--space-hairline) solid var(--color-rule)`; one row with the byline left and the nav links right (`justify-content: space-between`), nav links sharing one row with `--space-8`-scale gaps. Below `--breakpoint-sm` (640px) the row wraps: byline first line, links stacked left-aligned at 48px targets, same order, no overflow.
  - [x] Remove the Create block, the standalone `<hr class="rule">`, and the Browse block from `<main>`; remove the now-dead `.landing-block, .rule` grid-column pins from the `@media (min-width: 1024px)` block. Keep `[data-demo-region]` column/row pinning and both `regionOrder` variants intact — the footer sits outside the grid, so it renders below the grid in intro-first **and** demo-first order, and on the 503 `demo-unavailable` variant, with no variant-specific code.
  - [x] UPDATE `src/components/landing-intro.astro`: end the build-account copy at "The code is public." (delete " see the repository." — the referent moved to the footer, and the product never describes where anything is), and remove the `<PublicRepositoryLink surface="landing" />` usage and its import. Keep the hero statement, build account, and `data-smoke-marker="oddspark-token-solar"` marker byte-for-byte intact otherwise — `scripts/smoke.mjs` reads that marker in the deploy gate.
  - [x] The link idiom is the existing one: label-caps `--color-entropy` links lifting to `--color-text` on hover, 48px targets, standard focus outline — same as `{components.pagination}` and the existing `.landing-text-link` class being retired. No new link style, no new token, no inline hard-coded colors or px where a token exists (`src/styles/tokens.css` is the only place tokens change; this story adds none).

- [x] Task 3: Update the test contracts for the new structure (AC: all)
  - [x] UPDATE `tests/unit/landing-page.test.mjs`: the footer exists outside `.landing-page`; contains the byline link (`href="https://hearn.systems"`, `rel="noopener"`, SVG `role="img"` `aria-label="Hearn."`, trailing space in the text node) and `<nav aria-label="Landing">` with the three links in order; the retired Create/Browse blocks and the " see the repository." trailing pointer are gone; smoke marker contract preserved.
  - [x] UPDATE `tests/unit/public-repository-contract.test.mjs` wherever it pins the repository link's landing location — the link still renders on the landing page, now inside the footer. Do not weaken any assertion.
  - [x] UPDATE `tests/e2e/landing.spec.mjs` geometry assertions: at 1280px the footer spans the full shell width below both grid columns, byline left / links right on one row, links at 48px, no horizontal overflow; at 375px the byline holds the first line and the links stack beneath at 48px targets. Tab-order assertion: footer links come after all main content.
  - [x] EXTEND `tests/e2e/demo-poll.spec.mjs` (or the landing spec) so the footer is asserted present and correctly laid out in the outcome-bearing demo-first variant too (the existing rejected-vote test already forces that variant by voting without a Turnstile token).
  - [x] Capture inspected browser proof under `test-results/story-3-7-landing-footer-proof/` at 1280px light and 375px dark, both landing variants (intro-first and rejected-vote demo-first). Inspect the screenshots yourself: full-width footer, single hairline, one row at desktop, clean stack on mobile, wordmark legible in both modes, no orphaned text in the intro column, no console/network errors. Never ask the user to eyeball it.

- [x] Task 4: Ledger, changelog, and gate (AC: all)
  - [x] UPDATE `CHANGELOG.md` under `## [Unreleased]` (Changed): landing Create/Browse links and the repository entry consolidated into a full-width footer with the Hearn byline.
  - [x] UPDATE `_bmad-output/implementation-artifacts/deferred-work.md`: mark DW-119 `status: done` with a one-line resolution naming this story.
  - [x] Run the exact local gate in repository order under Node `24.18.0` / pnpm `11.17.0`: `pnpm migrations:guard` → `pnpm test` → `pnpm check` → `pnpm test:e2e` → `pnpm types` → binding drift check → `pnpm build:production` → `git diff --check`. Record fresh totals; prior totals are historical only. CI runs e2e in a 4-shard matrix — a green local unsharded run is the parity signal.
  - [x] Keep this story's Dev Agent Record, File List, and `sprint-status.yaml` current. No `TODO`, skipped/only test, placeholder, or undocumented deferral remains. Work lands via a `story/3-7-landing-footer` branch and PR; do not push to `main` directly.

## Dev Notes

### Decisions resolved at story-creation time (binding unless Justin reopens one before dev-story)

| # | Gap | Decision |
|---|---|---|
| D1 | Footer scope | Landing page (`/`) only. Poll surfaces keep the existing Poll footer; creator/auth/admin/moderation/404 surfaces get nothing. |
| D2 | Footer contents | Hearn byline + Create a Poll + Discover Polls + View Repository. Nothing else; no wordmark/tagline block beyond the byline. |
| D3 | Byline treatment | Verbatim oddspark.dev footer line: `built by ` + HEARN_MARK SVG, one link to `https://hearn.systems`, `rel="noopener"`, same tab, dim → text hover, 44px block target. |
| D4 | Band structure | `<footer>` landmark containing the byline plus `<nav aria-label="Landing">` — the byline is attribution, not navigation, and stays out of the nav landmark (reviewer-gate resolution). |
| D5 | Variant behavior | Footer renders on every landing variant — intro-first, demo-first (rejected vote), and 503 demo-unavailable. It is page chrome below `<main>`, never part of the Demo region. |
| D6 | Mobile | Below 640px the row wraps: byline first line, links stacked left-aligned at 48px targets, same order. Widen-don't-rearrange holds; nothing hidden. |
| D7 | Build-account copy | Ends at "The code is public." — the "see the repository." pointer is deleted because the referent is no longer adjacent (no-copy-describes-location rule). |
| D8 | User-approved [ASSUMPTION]s from the UX run | Link order/grouping (byline left; Create, Discover, Repository right); byline at body copy size; mobile stacking order byline-then-links; same-tab opening. Justin approved all four 2026-08-08. |

### Architecture and design guardrails

- **AD-1 (hexagonal direction):** the footer is presentation only. No domain concept, no route logic, no module changes. `src/pages/index.astro` and components are inbound adapters; no business rule may appear in them.
- **AD-2 (no-JS mandate):** the footer is pure server-rendered HTML/CSS. No hydration, no client script, no progressive-enhancement hook.
- **Token discipline:** all styling uses existing tokens from `src/styles/tokens.css`. This story adds **zero** tokens and changes **zero** token values. If a value seems missing, it isn't — reuse the nearest token and note it in the story.
- **Smoke marker is load-bearing:** `scripts/smoke.mjs` asserts the served landing HTML carries the `--color-solar-dark` hex via `data-smoke-marker="oddspark-token-solar"` in `landing-intro.astro`. Touch nothing about that marker.
- **Design-spine sync:** DESIGN.md/EXPERIENCE.md were already amended (merged 2026-08-09, PR #43) and are the spec. If implementation reveals a spec gap, stop and flag it rather than freelancing — the spines win on conflict with anything else, including this story.
- **Reviewer-gate resolutions are binding:** the three gate reviews (`review-rubric-landing-footer.md`, `review-accessibility-landing-footer.md`, `review-adversarial-landing-footer.md` in the UX workspace) already attacked this design; their resolutions are baked into the spines and ACs. Do not regress them (e.g., do not put the byline inside the `<nav>`, do not drop the trailing space, do not skip the 44px byline target).

### Current implementation inventory (merged baseline `c7727c9`)

- `src/pages/index.astro` — landing page. `<main class="landing-page[--demo-first]">` grid contains `.landing-intro-region` and `[data-demo-region]` via `regionOrder.map`, then the Create block, `<hr class="rule">`, Browse block. The `<style>` block's `@media (min-width: 1024px)` pins `.landing-intro-region, .landing-block, .rule` to one column and `[data-demo-region]` (`grid-row: 1 / span 10`) to the other, with `.landing-page--demo-first` swapping tracks. `.landing-text-link` (48px, entropy → text hover) is the link style being relocated.
- `src/components/landing-intro.astro` — hero statement + "How it's built" account ending "...The code is public — see the repository." + `<PublicRepositoryLink surface="landing" />` + the smoke marker.
- `src/components/public-repository-link.astro` — the shared repository seam. `surface="landing"` renders the label-caps `View repository` link with `is-landing` 48px treatment; reuse it unchanged inside the footer nav.
- The HEARN_MARK SVG source: `/Volumes/fast/Github/oddspark/src/worker.js:1394` (also used at lines 1688/2356 as `<a class="built" href="https://hearn.systems" rel="noopener">built by ${HEARN_MARK}</a>`; reference CSS: `.built{color:var(--dim)} .built:hover{color:var(--text)} .built svg{height:.78em;width:auto;vertical-align:baseline;margin-left:.3em}`).
- Tests pinning the current structure: `tests/unit/landing-page.test.mjs`, `tests/unit/public-repository-contract.test.mjs`, `tests/e2e/landing.spec.mjs` (geometry), `tests/e2e/demo-poll.spec.mjs` (includes the rejected-vote demo-first layout test added 2026-08-08).

### Previous-story and Git intelligence

- Story 3.6 (done, GPT-5 Codex) built the `public-repository-link` seam and its contracts; this story reuses it, does not rebuild it. Its review finding about keeping engineering detail out of the user-facing CHANGELOG applies to Task 4.
- PR #39/#40 (2026-08-08) established the two-column landing grid and the demo-first track swap, plus the e2e geometry-assertion pattern (`landing.spec.mjs`) and proof-directory convention (`test-results/story-*-proof/` at 1280px light / 375px dark). Follow those patterns exactly.
- PR #41 sharded CI e2e into a 4-way matrix; local `pnpm test:e2e` stays serial (`workers: 1`, shared Wrangler local-persistence D1). Run focused specs first (`pnpm test:e2e -- tests/e2e/landing.spec.mjs tests/e2e/demo-poll.spec.mjs`), then the full suite once.
- Known flake DW-118: `comment-list-moderation.spec.mjs:198` can fail locally with `net::ERR_ABORTED` (test reload races live-poll reload); CI's retry absorbs it. If it fails locally and is unrelated to your diff, note it — do not "fix" it here.
- An exploratory footer implementation was written and deliberately discarded uncommitted on 2026-08-08 per Justin's call to re-run the work as a proper feature. Do not resurrect it; the spines are the spec now.

### Testing requirements

- Unit tests run on Node, integration in workerd, e2e via Playwright — put each test in its proper project; this story needs no integration tests (no D1/auth/middleware change).
- Test names read as prose sentences describing behavior, matching `tests/unit/csrf.test.ts` style.
- Every changed behavior gets its test in the same commit (project rule).
- Browser proof is required because public landing UI changes in both modes; inspect it yourself and report console/network state.
- No e2e may depend on external network (hearn.systems reachability is not asserted in CI).

### Scope fences — do not build here

- No footer on any non-landing surface; no site-wide navigation; no header changes.
- No new tokens, token-value changes, components beyond the footer/byline, dependencies, migrations, bindings, routes, or API changes.
- No changes to the Demo region, voting surface, poll delivery, smoke script, or Turnstile wiring.
- No redesign beyond the spines: no boxes, no shadows, no radius, no new hairlines beyond the single top rule, no motion.
- Do not modify `scripts/smoke.mjs`, the smoke marker, or `public-repository-link.astro`'s Poll-footer variant.
- Do not commit `tests/test-results/` scratch output; commit only the curated proof PNGs under `test-results/story-3-7-landing-footer-proof/` after inspecting them for identifier-free content.

### Project Structure Notes

- Expected UPDATE: `src/pages/index.astro`, `src/components/landing-intro.astro`, `tests/unit/landing-page.test.mjs`, `tests/unit/public-repository-contract.test.mjs`, `tests/e2e/landing.spec.mjs`, `tests/e2e/demo-poll.spec.mjs`, `CHANGELOG.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, this story, `sprint-status.yaml`.
- Expected NEW: `src/components/hearn-byline.astro` (or a single `landing-footer.astro` containing the byline — one component total), `test-results/story-3-7-landing-footer-proof/*.png`.
- Expected UNCHANGED: everything under `src/modules`, `src/adapters`, `src/lib`, middleware, `wrangler.jsonc`, migrations, tokens.css, `public-repository-link.astro` internals, DESIGN.md/EXPERIENCE.md (already amended).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Story 3.7]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md` §Components `landing-footer` and `public-repository-link`, §Layout & Spacing]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md` §Information Architecture, §Component Patterns `landing-footer`/`public-repository-link`, §Responsive & Platform]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/review-rubric-landing-footer.md`, `review-accessibility-landing-footer.md`, `review-adversarial-landing-footer.md`]
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` DW-119]
- [Source: `/Volumes/fast/Github/oddspark/src/worker.js` lines 1394, 1688, 2356 — HEARN_MARK asset and reference treatment]
- [Source: `src/pages/index.astro`, `src/components/landing-intro.astro`, `src/components/public-repository-link.astro`, `src/styles/tokens.css`]
- [Source: `_bmad-output/implementation-artifacts/3-6-presentable-repository.md` Dev Notes and Dev Agent Record]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` AD-1, AD-2]

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References

- TDD red: unit tests failed on missing `src/components/landing-footer.astro` before implementation, then passed after.
- e2e iteration 1: footer-width assertion compared against the shell border-box; corrected to the shell content width (shell padding).
- e2e iteration 2: repository link sat 16px low in the desktop footer row — Astro scoped styles cannot reach the child `PublicRepositoryLink`, so its `is-landing` `margin-top` won; fixed with `.landing-footer :global(.public-repository-link.is-landing) { margin-top: 0; }`.
- e2e iteration 3: `navRect` missing from the geometry helper's return object (test bug, not implementation); restored.
- Full-suite run while `pnpm build:production` executed concurrently failed `xlsx-export.spec.mjs:143` once (500 + download timeout); clean rerun passed 182/182 — self-inflicted interference, unrelated to this diff.

### Completion Notes List

- Chose the single-component option: `src/components/landing-footer.astro` contains both the Hearn byline and the `<nav aria-label="Landing">`; no separate `hearn-byline.astro`.
- `HEARN_MARK` SVG copied byte-for-byte from `oddspark/src/worker.js` (`const HEARN_MARK`, 4653 chars); verified verbatim by string inclusion, keeping `role="img"`, `aria-label="Hearn."`, `fill="currentColor"`, and the trailing space in `built by ` (computed accessible name "built by Hearn.", asserted in e2e via `getByRole("link", { name: "built by Hearn." })`).
- Byline stays outside the nav landmark (D4); byline 44px target, nav links 48px, `--color-dim` → `--color-text` hover on the whole byline, entropy → text on nav links, standard `--focus-outline` / `--focus-outline-offset`. Zero new tokens.
- Footer is a `<footer>` sibling of `<main>` inside `.site-shell`, rendering on every landing variant with no variant-specific code; `margin-top: var(--space-section-gap)` + single top hairline replaced the removed `.landing-page` bottom padding so separation stays one section-gap.
- Create/Browse blocks, the standalone `<hr class="rule">`, the dead `.landing-block, .rule` lg grid pins, and the now-unused `.landing-label` / `.landing-block` styles were removed from `index.astro`; the build account ends at "The code is public." with `PublicRepositoryLink` moved to the footer; the smoke marker is byte-for-byte intact.
- Below 640px the footer row wraps via `flex-wrap` + a column nav: byline holds the first line, links stack left-aligned at 48px targets; no horizontal overflow asserted at 375px.
- Gate (fresh, Node 24.18.0 / pnpm 11.17.0, in order): `pnpm migrations:guard` ok (15 files, 15 checksummed) → `pnpm test` 120 files / 1683 tests passed → `pnpm check` clean → `pnpm test:e2e` 182 passed → `pnpm types` regenerated with no drift → `git diff --exit-code worker-configuration.d.ts` clean → `pnpm build:production` built → `git diff --check` clean.
- Browser proof (self-inspected): `test-results/story-3-7-landing-footer-proof/{landing,demo-first}-{1280-light,375-dark}.png` — full-width footer below both grid columns, single hairline, one row at desktop, clean left-aligned stack on mobile, wordmark legible in both modes, intro column ends at the build account with no orphaned Create/Browse text, and `watchPage`/`observeApp` reported zero console, page, response, and request failures. PNGs carry no personal identifiers (local dev origin only).

### File List

- `src/components/landing-footer.astro` (NEW)
- `src/pages/index.astro`
- `src/components/landing-intro.astro`
- `tests/unit/landing-page.test.mjs`
- `tests/unit/public-repository-contract.test.mjs`
- `tests/unit/demo-delivery-contract.test.mjs`
- `tests/e2e/landing.spec.mjs`
- `tests/e2e/demo-poll.spec.mjs`
- `CHANGELOG.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/3-7-landing-footer.md`
- `test-results/story-3-7-landing-footer-proof/landing-1280-light.png` (NEW)
- `test-results/story-3-7-landing-footer-proof/landing-375-dark.png` (NEW)
- `test-results/story-3-7-landing-footer-proof/demo-first-1280-light.png` (NEW)
- `test-results/story-3-7-landing-footer-proof/demo-first-375-dark.png` (NEW)

## Change Log

- 2026-08-09: Created via bmad-create-story from the merged UX landing-footer spines (PR #43), epics.md § Story 3.7, the reviewer-gate resolutions, the merged baseline `c7727c9`, and Story 3.6/PR #39-#41 intelligence; status set to `ready-for-dev`.
- 2026-08-09: Implemented the landing footer (Tasks 1–4): new `landing-footer.astro` with the verbatim HEARN_MARK byline and Landing nav, retired the orphaned Create/Browse blocks and the trailing repository pointer, updated unit/e2e contracts, captured inspected browser proof for both variants, DW-119 resolved, full local gate green (`pnpm test` 1683/1683; `pnpm test:e2e` 182/182).
