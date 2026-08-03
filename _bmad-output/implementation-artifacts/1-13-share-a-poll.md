---
context_creation_commit: 51c54048e95dd900dd0d6e28deb2b91e3d8118ce
implementation_baseline_commit: 66679b81f05cb5bdf5fc04b4c718d3353efff8ba
baseline_commit: 66679b81f05cb5bdf5fc04b4c718d3353efff8ba
dependency_story: 1.12
dependency_state_at_context_creation: in-progress-uncommitted
---

# Story 1.13: Share a Poll

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Context provenance: context_creation_commit remains 51c54048…. Implementation baseline is origin/main @ 66679b81f05cb5bdf5fc04b4c718d3353efff8ba (PR #10 merge of Story 1.12). Branch story/1-13-share-a-poll cut from that SHA. -->

## Story

As a Creator or Voter,
I want a Share action beside the Poll's canonical URL on the confirmation, voting, and results surfaces,
so that spreading a Poll takes one tap and never requires hunting for the link.

## Acceptance Criteria

1. **Given** the create-confirmation, voting page, or Tally view, **When** it renders, **Then** a text-labelled `SHARE` button in `button-secondary` metrics sits beside the canonical URL, which is always visible as selectable text — the surface is fully functional without JavaScript (FR-28, UX-DR9).
2. **Given** a browser with the Web Share API, **When** `SHARE` is activated, **Then** the native share sheet opens with the canonical URL; without the API, the URL is copied and `LINK COPIED` renders beside the control in label-caps, persisting until the next interaction — not a toast — with one polite live-region announcement.
3. **Given** any share, **When** the URL is shared, **Then** it is the canonical link, which never changes, results are never gated behind sharing, and no vendor-specific social buttons exist anywhere (FR-28), **And** on the voting surface the Share action never competes with the vote button as a primary action.

## Tasks / Subtasks

- [x] Task 0: Begin implementation from the real merged predecessor baseline (dependency for all ACs)
  - [x] Finish Story 1.12 review and merge it before writing Story 1.13 product code. Story 1.12 is the direct UI predecessor — it owns the creator detail link block, button-secondary's extended props, and the overlay/enhancer idioms this story builds on — and was uncommitted at context creation; its routes, component props, tests, and line numbers are provisional.
  - [x] Fetch origin, verify the merged origin/main SHA, cut story/1-13-share-a-poll from that exact commit in a fresh context/worktree, and replace this file's implementation_baseline_commit plus provenance comment with the full 40-character SHA. Keep context_creation_commit as historical provenance. Never implement on the dirty Story 1.12 worktree or infer the baseline from local conversation state.
  - [x] Re-read AGENTS.md, this story, the merged Story 1.12 artifact/review findings, sprint-status.yaml, and the final diff from the recorded baseline before editing. Preserve unrelated work and stage only explicit Story 1.13 files.

- [x] Task 1: Build the reusable `share-action` component (AC: #1, #3)
  - [x] NEW src/components/share-action.astro taking one required prop, the absolute `canonicalUrl` string. It renders the complete share block: the canonical URL as selectable `{typography.body}` `{colors.text}` text (reuse the established `.canonical-url` idiom — `user-select: all; overflow-wrap: anywhere;`), a text-labelled `SHARE` button-secondary control beside it, and a `LINK COPIED` confirmation line in label-caps text color beside the control. No icons, no vendor marks, no brand colors (FR-28, DESIGN.md `share-action`).
  - [x] Render the SHARE control and the confirmation line inert without JavaScript: the button carries `hidden` and the confirmation carries `hidden` + `aria-live="polite"` in the server markup; the enhancer reveals the button only when it can act (see Task 2). The no-JS baseline is "the URL is right there; copy it" — fully functional by construction (UX-DR9, FR-28).
  - [x] Drive all styling from existing tokens — button-secondary's own scoped styles for the control, `--type-label-caps-*`/`--font-machine`/`--color-text` for the confirmation, the established spacing/hairline rhythm for layout. Zero radius, no shadow, no toast, no opacity-as-state. Add no new tokens unless an existing one genuinely cannot express the block; never hardcode a hex (unit source-contract tests enforce this).
  - [x] Expose the interaction contract through `data-*` hooks on the component's own container (e.g. `data-share-action`, `data-share-url`, `data-share-trigger`, `data-share-confirmation`) so the enhancer queries within one root and three pages share one wiring. Do not modify button-secondary.astro unless a prop is genuinely required — query the trigger inside the component root instead of extending its prop whitelist.
  - [x] Unit source-contract test (tests/unit/share-action.test.mjs) binds: the component renders the URL as visible text, the button is text-labelled `SHARE` and hidden pre-enhancement, the confirmation is `LINK COPIED` in label-caps with a polite live region, styling is token-only, and no `set:html`/raw HTML appears. The global tests/unit/no-raw-html.test.mjs guard must keep passing.

- [x] Task 2: Write the progressive enhancer (AC: #2)
  - [x] NEW src/scripts/share-action.ts in the established idiom: a header comment stating the no-JS floor, typed `querySelector` on the `data-*` hooks, early return when no `data-share-action` root exists, no framework, no innerHTML. It is a plain DOM enhancer; if shared logic grows, split a pure core (share-action-core.ts) like results-live/results-live-core — but do not build abstraction for one handler.
  - [x] Reveal the SHARE button only when `typeof navigator.share === "function"` or `navigator.clipboard?.writeText` is available. In a browser with neither, the button stays hidden and the visible URL remains the whole contract. Feature detection must never throw — the vote.spec.mjs console-error gate fails the suite on any pageerror.
  - [x] With the Web Share API, activate the native share sheet with `{ url: canonicalUrl }` — URL only, no `title`/`text` payload (keep the shared artifact exactly the canonical link; some targets mangle combined payloads). `share()` requires secure context + transient activation; call it directly in the click handler.
  - [x] Treat `AbortError` (user cancelled the sheet, or no targets) as a silent no-op — never render `LINK COPIED` or an error for a cancellation. On any other share() rejection, attempt the clipboard path before giving up.
  - [x] Without the Web Share API (or after a non-abort share failure), `await navigator.clipboard.writeText(canonicalUrl)`; only on success reveal `LINK COPIED` beside the control. It persists until the next interaction — the next SHARE activation re-copies/re-shares and replaces or clears it; there is no timer and no toast. Post exactly one polite live-region announcement per copy, following the anti-chatter write-only-on-change rule used by vote-form.ts.
  - [x] On clipboard rejection (permission denied, insecure context) fail silently — the visible selectable URL is the floor and the console-error gate forbids noise. Never use `document.execCommand("copy")` or other deprecated fallbacks.
  - [x] Unit tests cover the pure decisions: feature-detect matrix (share only / clipboard only / neither), AbortError silence, non-abort fallback to clipboard, copy-success confirmation, copy-failure silence, one-announcement-per-copy. DOM-dependent behavior can be covered via the source-contract test plus E2E; do not stub a whole DOM in Node if the existing script-test conventions don't already do so.

- [x] Task 3: Wire the create-confirmation surface (AC: #1)
  - [x] UPDATE src/pages/creator/polls/[pollId].astro (the merged Story 1.12 version): replace the bare `<p class="canonical-url">` inside the existing `link-block` section (provisional lines 535-543) with the share-action component, preserving the `POLL LINK` group label, the helper note ("This is the link you'll share when voting opens. Its reference never changes."), and the existing `canonicalUrl` derivation (`` `${Astro.url.origin}/${poll.canonicalReference}` ``, provisional lines 395-397). The create-confirmation render (`?created` → "Your Poll is live." outcome line) then carries the Share action beside the URL, satisfying FR-28's first surface.
  - [x] Include `share-action.ts` in the page's script block beside edit-poll-form.ts/overlay.ts, guarded the same way those scripts are. The component renders on every detail state (created, updated, locked, closed), not only `?created` — the confirmation AC is met on the create render, and the control is equally truthful afterward.
  - [x] Preserve every Story 1.12 behavior on this page: private no-store on every return, the strict intent union, outcome lines and their focus contract, the definition editor, close/delete flows, and the overlay. The share block is additive presentation; it carries no form, no CSRF token, and no mutation.

- [x] Task 4: Wire the voting surface (AC: #1, #2, #3)
  - [x] UPDATE src/pages/[reference].astro: render the share-action component on every non-404 render branch — open vote form, post-vote outcome, already-voted, closed read-only — so the control is stable across the page's server-rendered states. Build the URL from the resolved canonical reference (`poll.canonicalReference`), not from `Astro.params.reference` raw input; the page already 301s case variants to the canonical form.
  - [x] Placement: the share block sits at the bottom of `<main class="poll-shell">`, after the vote form and the Tally, separated by the standard hairline rhythm — visually subordinate, full-stop secondary. It must never render as or beside a primary action: on the voting surface the vote button is the only `button-primary` (one primary per screen, DESIGN.md Buttons; AC #3).
  - [x] The share markup must live outside the `data-results-tally` root and outside any element the live reconciler patches (results-live.ts replaces tally DOM); it must also never write into `data-results-live-region` — the share confirmation has its own polite region. The motion system and live poller own the tally; share touches neither.
  - [x] Include `share-action.ts` on this page alongside vote-form.ts/chart-form-toggle.ts/results-live.ts with the same conditional-include convention (share renders whenever a poll renders, so include it whenever the poll branch renders). Preserve `cache-control: private, no-store`, the 405 gate, the CSRF vote form, the outcome-line focus contract, and the offline-outcome region unchanged.
  - [x] Extend the existing page source-contract tests (the tests that already read src/pages/[reference].astro, e.g. tests/unit/chart-form-toggle.test.mjs / own-vote-spark.test.mjs style) or the share-action contract test to assert the voting page includes the component and script outside the tally root.

- [x] Task 5: Wire the results (Tally) surface (AC: #1, #2, #3)
  - [x] UPDATE src/pages/[reference]/results.astro: render the share-action component on the visible-tally branch and keep it present (URL + button) on the hidden-result branches too — sharing the link is lawful even when the Tally is not; results are never gated behind sharing and sharing is never gated behind results (FR-28, AD-5).
  - [x] The shared URL on this surface is the canonical **voting** link (`${Astro.url.origin}/${view.canonicalReference}`), never the `/results` URL — a shared link lands a friend on the ballot (UJ-7). ResultsView already carries `canonicalReference` on every variant (src/modules/results/index.ts:38).
  - [x] Placement: last element inside `<main class="results-shell">`, outside the `data-results-tally` root so the live reconciler never clobbers it, visually subordinate to the chart-form toggle and the bars.
  - [x] Include `share-action.ts` with the same conditional-include convention. Preserve the visible/after_close_hidden/creator_only_hidden branch privacy order, `private, no-store`, results-page.ts/chart-form-toggle.ts/results-live.ts wiring, and the tally's shared polite region.

- [x] Task 6: Prove the feature and close the repository gate (AC: all)
  - [x] NEW tests/e2e/share-action.spec.mjs following the seeded harness conventions (tests/e2e/creator-session.mjs, one-worker serial D1). Cover: SHARE button hidden and URL visible/selectable with JavaScript disabled on all three surfaces; with JavaScript, a stubbed `navigator.share` (via `page.addInitScript` + `Object.defineProperty`) records exactly `{ url }` with the canonical voting URL on all three surfaces; the clipboard fallback path (Chromium project with `clipboard-read`/`clipboard-write` permissions granted — assert via `navigator.clipboard.readText()`, and gate clipboard assertions to Chromium if Firefox/WebKit lack the permissions) renders `LINK COPIED` and one polite announcement; a stubbed share rejecting with `AbortError` produces no confirmation and no console error; results page shares the voting URL, not `/results`.
  - [x] Keep the console-error/pageerror gate green in every share test and confirm the existing vote/results/live-results/motion specs still pass untouched — the share block must not perturb the live reconciler or motion system.
  - [x] Browser proof is mandatory: console-clean 375px dark and 1280px light captures of all three surfaces showing the SHARE control beside the canonical URL, plus one `LINK COPIED` state. Store under test-results/ per the established proof convention and record exact paths in the Dev Agent Record.
  - [x] UPDATE CHANGELOG.md under Unreleased for the user-visible Share action. No migration, binding, dependency, telemetry, or wrangler change is expected — if one appears, stop and re-check the design against AD-13/AD-22 first.
  - [x] Run narrow red/green tests while implementing, then the repository gate in documented order: pnpm migrations:guard; pnpm test; pnpm check; pnpm test:e2e; pnpm types; git diff --exit-code worker-configuration.d.ts; pnpm build:production. Record exact totals and browser evidence; never check a task based on an artifact-reported predecessor run.

### Review Findings

- [x] [Review][Patch] Voting-page shares can emit a non-canonical alias [src/pages/[reference].astro:952]
- [x] [Review][Patch] SHARE renders below the canonical URL instead of beside it [src/components/share-action.astro:46]
- [x] [Review][Patch] Share interaction state remains stale and unguarded across activations [src/scripts/share-action.ts:54]
- [x] [Review][Patch] Required share behavior and wiring tests are incomplete or false-positive [tests/unit/share-action.test.mjs:91]
- [x] [Review][Patch] Browser proof omits the required surface/mode matrix and actual created state [tests/e2e/share-action.spec.mjs:245]
- [x] [Review][Patch] A share-specific hook leaks into the generic secondary-button primitive [src/components/button-secondary.astro:17]

## Dev Notes

### Binding Scope Decisions

| Decision | Story 1.13 contract | Why |
|---|---|---|
| Surfaces | Create-confirmation (creator detail `link-block`, which is the post-create confirmation surface), voting page, results view | FR-28 / AD-13 enumerate exactly these three |
| Shared URL | The canonical **voting** URL `${origin}/${canonicalReference}` on all three surfaces — never `/results`, never a query string, never a case-variant | FR-28 "the shared URL is canonical and never changes"; UJ-7's friend must land on the ballot |
| Control | Text-labelled `SHARE` in button-secondary metrics, hidden until JavaScript proves it can act | UX-DR9: no-JS baseline is the visible selectable URL; a dead button without JS would be a lie |
| Share mechanism | `navigator.share({ url })` when present; `navigator.clipboard.writeText` otherwise; nothing else | DESIGN.md/EXPERIENCE.md `share-action`; MDN: share() needs secure context + transient activation |
| Cancellation | `AbortError` is silent — no confirmation, no error copy | MDN: AbortError = user cancelled or no targets; claiming "copied" would be false |
| Confirmation | `LINK COPIED` in label-caps text color beside the control, persisting until the next interaction, one polite announcement per copy | AC #2; same idiom as the codes-copied confirmation; never a toast |
| Result gating | None, in either direction: results never require sharing; sharing never requires visible results | FR-28, AD-5 |
| Vendor buttons, social SDKs, share analytics, UTM tags | Out of scope, forbidden | FR-28, PRD §6 non-goals, DESIGN.md Don't list |
| Domain/modules, D1, auth, middleware, telemetry | Untouched — this story is presentation + one client enhancer | AD-1: share is a delivery concern; there is no mutation, so no command, no CSRF, no port |

### Product and UX Contract

- The canonical URL is always on screen as selectable text — `user-select: all; overflow-wrap: anywhere;` is the established `.canonical-url` idiom on the creator detail; the component carries the same treatment to the public surfaces.
- `SHARE` is a word, uppercase, in the product's machine voice — never an icon, never a vendor glyph. On the voting surface it is unambiguously secondary; the vote button stays the one primary action per screen.
- `LINK COPIED` copy is acceptance data (AC #2), rendered in label-caps at text color — not `dim`, not `faint`; it is information a user must read.
- One polite live region per share block; one announcement per copy; never write share announcements into the tally's shared live region or the vote outcome region.
- The block obeys the widen-don't-rearrange layout discipline: same block, same order, both breakpoints; it does not appear only at one viewport.

### Architecture Guardrails

- AD-1/AD-19: pages are inbound adapters; this story adds presentation and a client enhancer only. No business rule, no domain module, no port. If implementation "needs" a domain change, the design is wrong — stop.
- AD-13 binds CAP-SHARE directly: one canonical collision-safe reference; canonical URLs do not change; every public voting, create-confirmation, and result view renders the Share action and the canonical URL. This story is that rule's implementation.
- AD-22: share is read-only client behavior — no mutation crosses the CSRF boundary, no form, no token. Do not invent a POST endpoint, a share-tracking beacon, or a client API.
- AD-5/AD-21: sharing is independent of result visibility and of discovery state. Do not read tally data, representation_version, or any private projection to render the share block; the URL is already public on the surface.
- AD-2 (lightweight voter surface): hand-written TypeScript, Astro-bundled via `<script src="../scripts/share-action.ts">`, deferred; no framework, no dependency, no `<script is:inline>` except the established paint-critical precedents.
- Consistency: filenames kebab-case; escaped text only (Astro default; the URL is server-derived, but never reach for `set:html`); `private, no-store` preserved on every touched response; telemetry untouched (no new operation).

### Existing Code That Must Be Preserved

- src/pages/creator/polls/[pollId].astro (merged Story 1.12 version) owns the `link-block` (provisional lines 535-543), `canonicalUrl` derivation (395-397), outcome-line contract (476-486), and the lifecycle intents. Replace only the bare URL paragraph with the component; keep label, helper note, and every lifecycle behavior.
- src/pages/[reference].astro owns case-variant 301 canonicalization (provisional lines 98-107), the vote form + CSRF, outcome regions, and conditional script includes (953-965). Add the share block to all non-404 branches without reordering existing regions.
- src/pages/[reference]/results.astro owns the visibility-branch privacy order and the results scripts (154-168). `view.canonicalReference` (line 123 usage) is the share URL source.
- src/scripts/results-live.ts and the tally component reconcile DOM inside `data-results-tally` and own `data-results-live-region`; share markup and announcements stay outside both.
- src/components/button-secondary.astro already carries Story 1.12's extended props; prefer querying the trigger inside the share-action root over widening its prop surface again.
- src/styles/tokens.css: `--color-solar-dark` is load-bearing for the deploy smoke; the share block needs no new token — bind existing ones.
- src/pages/index.astro:60 has an inert demo `Share` button on the token-demo page. Do not wire it; the landing page is Story 3.4's surface.
- The deferred-work note that canonical-resolution composition lives in `[reference].astro` frontmatter (AD-1 tension) is accepted debt — this story reads the resolved reference and must not re-litigate it.

### Previous Story and Git Intelligence

- Story 1.12 was uncommitted at context creation (branch story/1-12-close-edit-delete, all work in the working tree). Its review is in progress with chunk 1 resolved. Task 0 exists because this story's primary anchor — the creator detail link block — is Story 1.12's surface. Do not trust this file's line numbers until the merged baseline is recorded.
- Story 1.12 established the enhancer idioms this story reuses: server renders JS-only affordances inert/hidden and the script reveals them (vote-form hint, overlay invoker); `data-*` hook contracts; pure-core-plus-thin-shell when logic grows; source-contract `.test.mjs` for components/pages.
- Story 1.12's E2E conventions: seeded creator sessions via tests/e2e/creator-session.mjs, one-worker serial D1, console/pageerror gates, 375px-dark/1280px-light proof captures under test-results/.
- Story 1.10/1.9: the live reconciler and motion system own everything inside the tally root — any foreign DOM inside it gets clobbered; share stays outside.
- Recent baseline commits: 51c5404 merged Story 1.11 (creator dashboard); 408e269 dashboard implementation; de84307 merged Story 1.10 (motion system).

### Current Technical Information

- Pinned repository stack: Node 24.18.0, pnpm 11.17.0, TypeScript 7.0.2, Astro 7.1.5 with @astrojs/cloudflare 14.1.6, Vitest 4.1.10, Playwright 1.62. This story needs no new package.
- MDN (verified during context creation): `navigator.share()` is **not Baseline** — availability varies by platform (strongest on mobile Safari/Android; partial or absent on desktop browsers), so feature detection is mandatory, not optional. It requires a secure context and transient user activation; it rejects with `AbortError` on cancellation, `NotAllowedError` on missing activation/permissions-policy blocks, `InvalidStateError` when another share is in progress. The promise resolves with `undefined` at platform-dependent points (Windows: when the popup launches) — resolution is not proof a target received the link, which is why only the clipboard path earns the `LINK COPIED` confirmation.
- `navigator.clipboard.writeText` is Baseline in secure contexts but permission-gated and can reject; there is no non-deprecated fallback, which is why the visible selectable URL is the contractual floor.
- Playwright can exercise both paths deterministically: stub `navigator.share` via `page.addInitScript` (it is a configurable property in Chromium), and grant `clipboard-read`/`clipboard-write` permissions on the Chromium context for the real clipboard path.

### Project Structure Notes

- Expected NEW files: src/components/share-action.astro; src/scripts/share-action.ts; tests/unit/share-action.test.mjs; tests/e2e/share-action.spec.mjs.
- Expected UPDATE files (after Story 1.12 merges): src/pages/creator/polls/[pollId].astro; src/pages/[reference].astro; src/pages/[reference]/results.astro; CHANGELOG.md. Possibly an existing page source-contract test (chart-form-toggle/own-vote-spark style) extended to assert share wiring.
- Expected PRESERVE/no change: db/migrations/*; db/migrations.manifest.json; wrangler.jsonc; worker-configuration.d.ts; package.json/pnpm-lock.yaml; src/modules/**; src/adapters/**; src/middleware.ts; src/lib/**; button-secondary.astro (unless a prop proves genuinely necessary); results-tally.astro; results-live.ts; tokens.css.
- Do not create a share endpoint, share analytics, a second share component per surface, a social-button row, or docs/decisions entries.

### Testing Requirements

- Node unit: pure feature-detect/outcome decisions + the share-action source contract (markup, tokens, hidden-until-enhanced, no raw HTML).
- Workerd integration: not expected — no route behavior changes; page HTML stays covered by source-contract + E2E per repo convention. If a route change sneaks in, it needs an integration test in the same commit.
- Playwright: no-JS floor on all three surfaces; stubbed Web Share call shape; Chromium clipboard fallback with `LINK COPIED`; AbortError silence; results-shares-voting-URL; console cleanliness; both-mode screenshot proof.
- Test names read as behavior prose. No skipped/only/stub tests, no TODOs. Every new behavior gets a same-commit test.

### References

- [Source: _bmad-output/planning-artifacts/epics.md:566-585 — Story 1.13 statement and three acceptance blocks; :148 — FR-28 epic mapping; :154-157 — Epic 1 scope]
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md:262-267 — FR-28 and testable consequences; :74 — Share Action glossary; :324 — non-goal: in-product Share is the only distribution affordance]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md:219-230 — AD-13 canonical reference + Share action mandate; :94-102 — AD-5 discovery/visibility independence; :503 — CAP-SHARE capability map]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md:319-329 — share-action tokens; :627-629 — share-action component spec; :599-605 — button contracts; :698 — no vendor share buttons]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md:161 — share-action behavior contract; :125 — "Link copied." voice line; :261 — accessibility floor for the share action; :338,402,412 — UJ-1/6/7 share beats; :424 — no share-to-see-results dark pattern]
- [Source: _bmad-output/implementation-artifacts/1-12-close-edit-delete.md — predecessor surface ownership, enhancer idioms, baseline provenance pattern; deferred-work.md:79 — accepted AD-1 debt on canonical resolution]
- [Source: src/pages/creator/polls/[pollId].astro — link block + canonicalUrl derivation (provisional: unmerged 1.12); src/pages/[reference].astro — voting surface + conditional script includes; src/pages/[reference]/results.astro — results branches + view.canonicalReference; src/components/button-secondary.astro — secondary button primitive]
- [Source: MDN Web Docs, https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share — availability, secure-context and transient-activation requirements, rejection taxonomy (verified 2026-08-03)]
- [Source: AGENTS.md — verification gate order, testing conventions, design-token rules, no-raw-HTML and privacy rules]

## Dev Agent Record

### Agent Model Used

Grok 4.5 (implementation); Codex GPT-5 (code review)

### Debug Log References

- Baseline: origin/main @ 66679b81f05cb5bdf5fc04b4c718d3353efff8ba (PR #10 Story 1.12 merge). Branch story/1-13-share-a-poll.
- Focused review verification: share-action unit **17** passed; D1 Poll adapter integration **16** passed; share-action E2E **9** passed.
- Full unit+integration: `pnpm test` **753** passed across **46** files.
- Full browser gate: `pnpm test:e2e` **125** passed, including the repaired hidden-results compatibility assertion.
- Repository gate: migrations:guard **8/8**; `pnpm check`; `pnpm types`; worker-configuration.d.ts clean; `pnpm build:production` complete.
- Browser proof paths: `test-results/story-1-13-share-create-confirmation-375-dark.png`, `test-results/story-1-13-share-create-confirmation-link-copied-375-dark.png`, `test-results/story-1-13-share-voting-375-dark.png`, `test-results/story-1-13-share-results-375-dark.png`, `test-results/story-1-13-share-create-confirmation-1280-light.png`, `test-results/story-1-13-share-voting-1280-light.png`, `test-results/story-1-13-share-results-1280-light.png`.

### Completion Notes List

- Reusable share-action.astro: selectable canonical URL always visible; SHARE hidden until enhancer proves share or clipboard; LINK COPIED polite live region.
- Progressive enhancer: navigator.share({ url }) only; AbortError silent; non-abort falls back to clipboard; pending activations are guarded; every interaction clears stale confirmation before one fresh copy announcement; no execCommand or timer.
- Wired create-confirmation (creator detail link-block), voting page (after form/tally, secondary), results (voting URL on all non-404 branches including hidden tallies).
- Canonical alias resolution now returns the Poll's canonical reference from the D1 adapter, so the voting page never shares an exact non-canonical alias.
- SHARE and its confirmation sit beside the flexible canonical URL at desktop width and wrap cleanly on narrow screens; the generic secondary-button primitive carries no share-specific hook.
- Behavioral unit, D1 integration, and Playwright coverage exercise fallback, cancellation, repeated activation, canonical aliases, all three surfaces, both proof modes, and the real `?created` confirmation state.
- Fixed button-secondary `[hidden]` so `display: inline-flex` cannot override the no-JavaScript floor. CHANGELOG Unreleased updated; no migration, binding, dependency, telemetry, or domain-policy change.

### File List

- _bmad-output/implementation-artifacts/1-13-share-a-poll.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- CHANGELOG.md
- src/adapters/d1/index.ts
- src/components/share-action.astro
- src/components/button-secondary.astro
- src/scripts/share-action.ts
- src/pages/creator/polls/[pollId].astro
- src/pages/[reference].astro
- src/pages/[reference]/results.astro
- tests/unit/share-action.test.mjs
- tests/unit/poll-card.test.mjs
- tests/integration/polls-adapter.integration.test.ts
- tests/e2e/share-action.spec.mjs
- tests/e2e/results.spec.mjs

### Change Log

- 2026-08-02: Implemented Story 1.13 Share a Poll; status → review.
- 2026-08-03: Resolved all six code-review findings, completed the repository gate, and moved Story 1.13 to done.
