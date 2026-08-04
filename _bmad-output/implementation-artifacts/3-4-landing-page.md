---
baseline_commit: f37e7c98fae6122374f60d3bb65757ae74341076
baseline: origin/main @ f37e7c98fae6122374f60d3bb65757ae74341076 (merged Story 3.3)
dependency_story: 3-3-administrator-delisting
epic: 3 — Public Face: Discovery, Landing & Demo
---

# Story 3.4: Landing Page

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a demo visitor,
I want the root URL to tell me what this is, how it's built, and where to go next,
So that within a minute I know whether to vote, browse, create, or read the code (UJ-5).

## Acceptance Criteria

Verbatim from `_bmad-output/planning-artifacts/epics.md` § Story 3.4 (lines 772–788):

1. **Given** a visitor at `/`, **When** the page renders, **Then** it opens with one Newsreader statement of what the platform is, followed by a short technical account of how it's built (Workers, D1, R2, Turnstile, Better Auth) in the monospaced instrument voice, the repository link, the create entry, and the link to Discover (FR-25, UX-DR26), **And** the opening statement contains no stack vocabulary — the technical build account is a separate, following block — so the plain-language/technical split is checkable rather than aspirational.

2. **Given** any visitor, **When** they want to act, **Then** Discover and the sign-in/create entry are reachable from the landing page without a shared link (FR-25), **And** the page holds the single-column, widen-don't-rearrange layout at every breakpoint (UX-DR25).

## Tasks / Subtasks

- [x] Task 1: Rewrite `src/pages/index.astro` as the product landing page (AC: #1, #2)
  - [x] REPLACE the Story 1.1 foundation showcase with the landing page in the existing `BaseLayout` + `.site-shell` composition. Keep one `.site-header` block (label-caps `polls.oddspark.dev`, `.site-title` `oddspark polls`, tagline) and the existing `[data-mode-toggle]` button — the landing page remains the mode toggle's home. Compose the body in the canonical block order: opening statement → technical build account (with repository link) → create entry → Discover link. Single column at every breakpoint; hairlines (`.rule`) and whitespace do all grouping — no cards, boxes, shadows, or new layout machinery (UX-DR25). The retained header tagline (`Trustworthy casual polls — multiple-choice, ranked, image, meeting. Free. No subscription.`) intentionally overlaps the opening statement: the header is brand chrome, the statement is the product explanation. Justin may reopen this copy pairing before dev-story.
  - [x] Render the opening statement in Newsreader (`--font-human`, display/heading token scale, never bold) as one statement of what the platform is. It must contain no stack vocabulary (no Workers, D1, R2, Turnstile, Better Auth, Astro, OAuth, server, deploy, or similar terms). Use this pinned opening copy unless Justin reopens it: `Oddspark Polls is where a casual question gets an honest answer — multiple-choice, ranked, image, and meeting polls, with vote security and no subscription wall.`
  - [x] Render the technical build account as a separate following block in the monospaced instrument voice (Courier Prime, `--font-machine`, `body-lg` 16px per the widened review finding — never `faint`). It names how the platform is built. Pinned build-account copy: `Runs on Cloudflare Workers, server-rendered by Astro. Polls and votes live in D1; images live in R2. Sign-in is Better Auth with Google or GitHub. Turnstile checks the vote; rate limiting checks the rush. The code is public — see the repository.`
  - [x] KEEP the deploy-gate smoke marker exactly: import `../styles/tokens.css?raw`, extract `--color-solar-dark` at build time with the existing regex, throw if absent, and render `<p class="label-caps" data-smoke-marker="oddspark-token-solar" data-token-solar={solarHex}>smoke · solar · {solarHex}</p>` visibly inside the technical build account block. `scripts/smoke.mjs` (token extraction lines 32–42, marker constant line 44, assertions 46–81) requires the served `/` HTML to carry this marker and hex; dropping or hiding it breaks the staging gate by design. Never rename or remove `--color-solar-dark` in `src/styles/tokens.css`.
  - [x] Link exactly three destinations (the Demo Poll is Story 3.5, not this story): the public repository at `https://github.com/Hearn-Systems-LLC/oddspark-polls` (ordinary same-tab external anchor from the build account block), the create entry at `/creator/new`, and Discover at `/discover`. Render the create entry as the page's single `button-primary` via the component's anchor form — `<ButtonPrimary href="/creator/new">` (`button-primary.astro` renders `<a>` only when passed `href`; a bare `<button>` cannot navigate without JS, violating AD-2). Render the repository and Discover links as secondary/text-level links per the label-caps idiom. The existing Creator guard redirects signed-out visitors from `/creator/new` to `/sign-in?return=%2Fcreator%2Fnew` (URL-encoded, built with `URLSearchParams` in `src/middleware.ts:259-267`) — this satisfies the sign-in-before-create flow with no session branching on the page. Do not add any other navigation, feed, poll listing, or session-aware link.
  - [x] Set `BaseLayout` props: `title` exactly `Oddspark Polls — trustworthy casual polls` (a deliberate deviation from the `{Page} — Oddspark Polls` subpage convention in `discover.astro`/`creator/new.astro`, because the root page has no page name), a real `description`, and `canonicalUrl` built from the request origin for `/` exactly as `discover.astro:74` builds it (`new URL(validatedPath, Astro.url.origin).href` — no string concatenation). The page stays indexable and self-canonical: no `noindex`, no `robots` override, no `x-robots-tag`. Do not touch `src/pages/sitemap.xml.ts` or `src/pages/robots.txt.ts` — `/` is already emitted and allowed.
  - [x] Gate methods like `discover.astro:15-24`: return `405` with `Allow: GET, HEAD` for any non-GET/HEAD request before rendering. No POST handling exists on `/` (voting POSTs target `/{reference}`, and `/` is already in `src/modules/polls/reserved-slugs.ts` — do not change it). Emit no route-level log; the outer telemetry middleware owns the single per-request record.
  - [x] Use design tokens exclusively: all color/space/type values reference collapsed runtime vars (`--color-*`, `--space-*`, `--type-*`); no inline hex, no new mode-suffix exceptions, no `style` attributes carrying token values that already have classes. Any genuinely new primitive goes in `src/styles/tokens.css` derived from existing tokens. No client JavaScript beyond the layout's existing mode machinery (AD-2); no emoji, no exclamation marks, no upsell copy.

- [x] Task 2: Source-contract unit and route integration tests (AC: #1, #2)
  - [x] ADD `tests/unit/landing-page.test.mjs` in the established source-contract style (`readFileSync` of `src/pages/index.astro`, prose-sentence test names — model on `tests/unit/discover-components.test.mjs` and `tests/unit/poll-card.test.mjs`). Assert: the exact pinned opening statement and build-account copy are present; the opening statement block contains no stack vocabulary while the build account names Workers, D1, R2, Turnstile, and Better Auth (this is the checkable plain/technical split from AC #1); the smoke marker attribute and `tokens.css?raw` extraction survive; the three link targets (`/creator/new`, `/discover`, the repository URL) are present and no other `href` leaks in; the create entry uses `ButtonPrimary` with `href` and is the page's only `button-primary`; no inline hex colors and no `noindex` appear.
  - [x] ADD integration coverage in the workerd project, split across the two established harnesses — do not mix them: (a) `experimental_AstroContainer` page-render harness (model on `tests/integration/discover-route.integration.test.ts:38-53`, which bypasses middleware) owns `GET /` 200 HTML, the `405` + `Allow: GET, HEAD` gate, no `noindex` in head, self-referencing canonical on the request origin, and the served marker carrying the current `--color-solar-dark` hex; (b) the full middleware-chain harness via `tests/integration/astro-middleware-shim.ts` (model on `tests/integration/csrf.integration.test.ts:94-116`) owns `x-request-id` presence and exactly one telemetry record. Note for the 405 probe: through the real chain, a non-GET/HEAD request without same-origin headers is 403'd by `checkCsrf` (`src/lib/csrf.ts:129-132`) before the page's gate runs — assert the 405 in the container harness, and if a full-chain non-GET probe is added, send same-origin headers.
  - [x] Prove both type families are actually bound — Newsreader on the opening statement, Courier Prime on the build account — via computed-style assertions written fresh in the e2e layer. The retired placeholder spec's name ("both type families in use") overpromised: it never asserted fonts (it checked only the marker, heading, "Vote" button, and "47% · 122"), so there is no existing pattern to mirror.

- [ ] Task 3: Replace the placeholder e2e spec and capture browser proof (AC: #1, #2)
  - [ ] DELETE `tests/e2e/placeholder.spec.ts` and ADD `tests/e2e/landing.spec.mjs`. `playwright.config.ts` has no explicit `testMatch`; the default glob already covers `.spec.mjs` (proven by `discover.spec.mjs`). PORT, do not lose, the coverage the placeholder spec uniquely carries: the mode toggle persists `oddspark-mode` and applies `data-mode`, and focus-visible rings resolve to exactly 2px solid with 2px offset. The new spec additionally proves: opening statement, build account, and smoke marker visible; all three entries navigate (Discover → `/discover`; create entry → `/creator/new` redirecting to `/sign-in?return=%2Fcreator%2Fnew` when signed out — assert the encoded spelling; repository link carries the exact URL); the fresh computed-style font bindings from Task 2; keyboard focus order follows reading order; clean console and network log.
  - [ ] Capture and inspect committed proof under `test-results/story-3-4-landing-proof/` at 375px dark and 1280px light (matching the `story-3-2-discover-proof` convention): single column holds, 68ch measure respected, no horizontal overflow, 44px+ targets on the create entry, visible focus rings, no card/box/shadow styling. Inspect the screenshots yourself; never ask the user for visual proof.

- [ ] Task 4: Documentation sync and repository gate (AC: all)
  - [ ] UPDATE `CHANGELOG.md` under `## [Unreleased]` for the user-observable change: the root URL now serves the product landing page (statement, build account, repository link, create entry, Discover link) replacing the foundation showcase.
  - [ ] UPDATE `README.md` heading `### Live URLs (foundation placeholder)` (line 205): the root URL is no longer a placeholder, and README is the source of truth for environment reality. Adjust that heading/line to describe the landing page; no other README change is expected.
  - [ ] UPDATE `EXPERIENCE.md` only where reality changed: the landing IA rows already describe this page — reconcile the Demo Poll's absence until Story 3.5 if the text implies it ships now, and record the header composition (mode toggle retained, four-entry discipline). Update `DESIGN.md` only if a genuinely new component or token contract was required; otherwise leave it untouched. Optionally refresh the stale `scripts/smoke.mjs:3` header comment ("placeholder page") in the same PR; the script's logic stays untouched.
  - [ ] Under Node `24.18.0` and pnpm `11.17.0`, run the exact local gate in repository order: `pnpm migrations:guard`, `pnpm test`, `pnpm check`, `pnpm test:e2e`, `pnpm types`, `git diff --exit-code worker-configuration.d.ts`, `pnpm build:production`, and `git diff --check`. Record fresh totals in this story; prior-story totals are historical, not proof.
  - [ ] Keep this story's Dev Agent Record, File List, and `sprint-status.yaml` current through implementation and review. No `TODO`, skipped/only tests, placeholder branch, or undocumented deferral may remain. Dev-story never pushes, deploys, or mutates remotes.

## Dev Notes

### Decisions resolved at story-creation time (binding unless Justin reopens one before dev-story)

| # | Gap | Decision |
|---|---|---|
| D1 | Story 3.4's ACs omit the Demo Poll, but FR-25 and the IA describe the landing page with it pinned. Ship a placeholder? | No. Story 3.4 ships the complete page minus the Demo Poll: statement, build account, repository link, create entry, Discover link. No visible placeholder, teaser, or empty section — the "no placeholder completions" rule applies to UI too. Story 3.5 inserts the inline Demo Poll after the build account per the canonical mobile block order (`EXPERIENCE.md` § Responsive: statement → build notes → Demo Poll). |
| D2 | The smoke marker lives only on `/` and the staging gate asserts it. Keep or relocate? | Keep on `/`, visibly, relocated into the technical build account block where its instrument-voice rendering (`smoke · solar · {hex}`) fits the page. Same `tokens.css?raw` extraction and throw-if-missing guard. Hiding it or moving it to another route would silently change deploy-gate semantics; don't. |
| D3 | Where does the create entry point, and does the page branch on session? | `/creator/new`, unconditionally, rendered as `<ButtonPrimary href="/creator/new">`. The existing Creator guard already redirects signed-out visitors to `/sign-in?return=%2Fcreator%2Fnew` (the validated return flow Story 3.3 reused for moderation). No session read, no conditional markup on the landing page — it renders identically for everyone. |
| D4 | Repository link target and behavior? | Exactly `https://github.com/Hearn-Systems-LLC/oddspark-polls` (the origin remote, Story 3.6's forward contract). Ordinary same-tab anchor, no `target`, no tracking parameters. |
| D5 | Is the component showcase (buttons, input, poll options, results bars, overlay) preserved somewhere? | No — it is intentionally deleted. The primitives are now proven by the real voting, results, Discover, and creator surfaces; the showcase's e2e value (mode toggle, focus rings) is ported into the new landing spec. Its "both type families" test name overpromised and ports nothing — font bindings get fresh computed-style assertions. |
| D6 | One-primary-button rule vs. create entry vs. Story 3.5's vote button? | In 3.4 the create entry is the page's single `button-primary`. The collision with the Demo Poll's vote button arrives in Story 3.5 and is resolved there (the share-action precedent demotes competing actions to secondary); 3.4 does not pre-solve it. |
| D7 | Session-aware "my polls" nav for signed-in creators (`EXPERIENCE.md` IA hints at a landing nav)? | Not in 3.4. The page keeps the four-entry discipline (Demo Poll, repository, create entry, Discover — with the Demo Poll landing in 3.5) and renders identically for all visitors. If a creator entry is wanted later, it is a separate UX decision, not a silent addition. |
| D8 | Cache/indexability posture for the new `/`? | Indexable and self-canonical, as it already is via the sitemap and `BaseLayout` defaults. Method-gated to GET/HEAD with `405` + `Allow` matching `discover.astro`. No cache-control invention: the page is per-request SSR with no user data and no catalog read, so no new caching policy is introduced in this story. |
| D9 | Does landing copy live in a domain module like Discover's copy does? | No. Story 3.2 centralized Discover copy because the Discovery module owns catalog behavior; the landing page has no domain behavior — static copy in the page is not a business rule (AD-1 is not implicated). Copy is pinned in this story and guarded by exact-copy source-contract tests, which is the checkable split AC #1 demands. |

### Architecture and security guardrails

- **AD-1 / AD-19:** the page is a thin inbound adapter. It reads no data and decides no policy; the only logic is build-time token extraction for the smoke marker and the method gate. Do not add D1, KV, R2, Cache API, or session reads.
- **AD-2:** SSR with zero client JavaScript beyond the layout's existing anti-flash/mode-override scripts. Every link and the create entry must work with JavaScript disabled — this is why the create entry is `ButtonPrimary`'s anchor form, not a `<button>`.
- **AD-13:** `/` is already in `src/modules/polls/reserved-slugs.ts`; leave the registry untouched.
- **AD-14:** build the canonical URL from the request origin at runtime; never hardcode an environment origin.
- **AD-15:** one telemetry record per request, emitted by the outer middleware — the route adds no logging of its own.
- **AD-22:** the middleware chain already covers `/`; the page's only transport concern is the GET/HEAD method gate. No new CSRF surface exists because the page accepts no mutations. Full-chain non-GET probes without same-origin headers are CSRF-403'd before the page's 405 gate runs — test each behavior in the harness that owns it.
- **UX-DR25:** single column, widen-don't-rearrange, 20px mobile / 48px desktop margins, 68ch measure. The two-column `lg` exception applies to exactly two other surfaces, never this one.
- **UX-DR26 / FR-25:** the block contract is Newsreader statement → monospaced build account → repository link → create entry → Discover link; the Demo Poll joins in Story 3.5.
- **Token discipline:** consume collapsed runtime vars only; dark binds unconditionally as fallback; light is the suffix swap with exactly three documented exceptions — add no fourth without updating `DESIGN.md`. `--color-solar-dark` is load-bearing for the deploy gate.
- **Voice:** wry, flat, factual — no exclamation marks, no emoji, no marketing superlatives, no engagement machinery. Non-technical readers get the first block; technical readers get the second and the repository link.

### Current implementation inventory (merged baseline)

- `src/pages/index.astro` (105 lines) is the Story 1.1 foundation showcase: `BaseLayout` title `oddspark polls — foundation`, `.site-shell` + `.site-header` with `[data-mode-toggle]`, the smoke marker (lines 9–16, 49–51), and demos of `ButtonPrimary`, `ButtonSecondary`, `Input`, `PollOption`, `ResultsBar`, and `Overlay`. This story replaces it wholesale; the header, mode toggle, and smoke-marker mechanics are the only survivors.
- `src/layouts/base-layout.astro` (lines 5–10) already supports `title`, `description`, `canonicalUrl`, and `robots` props (Story 3.2) — use them; never hand-write head markup.
- `src/styles/tokens.css` (lines 357–470) already ships the primitives this page needs: `.site-shell`, `.site-header`, `.site-title`, `.site-tagline`, `.label-caps`, `.section`, `.section-title`, `.stack`, `.rule`, `.visually-hidden`, `.mode-toggle`, and the global `:focus-visible` ring. Reuse before adding.
- `src/components/button-primary.astro` (lines 25–35) renders an `<a>` when passed `href`, otherwise a `<button>`. The create entry must use the anchor form.
- `src/pages/discover.astro` is the route-contract precedent: 405 + `Allow: GET, HEAD` (lines 15–24), canonical URL via `new URL(validatedPath, Astro.url.origin).href` (line 74). Mirror its shape; differ only where D8 says (no `noindex` path needed — the landing page has no error/cursor states).
- `src/pages/creator/new.astro` + the Creator guard already implement the sign-in-before-create flow (`src/middleware.ts:248-280`, defense-in-depth redirect at `new.astro:49-60`); `src/pages/sign-in.astro` accepts the validated `return` parameter. The landing page only links.
- `scripts/smoke.mjs` extracts `--color-solar-dark` from `tokens.css` (lines 32–42) and asserts the deployed `/` HTML carries `data-smoke-marker="oddspark-token-solar"` with that hex (marker constant line 44, assertions 46–81), then probes `/api/auth/ok` and `/api/health`. The marker contract is the single biggest hidden coupling on this story. Its header comment (line 3) still says "placeholder page" — comment-only staleness.
- `tests/e2e/placeholder.spec.ts` asserts current-page content (marker visibility, `oddspark polls` heading, "Vote" button, "47% · 122") and uniquely covers mode-toggle persistence and focus-ring geometry. Its first test is named "both type families in use" but asserts no fonts. Deleting the page without porting the real coverage is a silent test-quality regression.
- `src/pages/sitemap.xml.ts` already emits `${origin}/`; `src/pages/robots.txt.ts` allows all; Story 3.2's D7 put `/` in the sitemap deliberately ("Story 3.4 will improve `/`; it already exists and is public now"). Keep both untouched.
- There is no shared header/nav component — `.site-header` markup exists only inline in `index.astro`. Keep it page-local; only `/` uses it.
- `src/scripts/mode-override.ts` wires any `[data-mode-toggle]` button automatically; no script changes are needed to keep the toggle working on the rewritten page.
- `README.md:205` is titled `### Live URLs (foundation placeholder)` — it goes stale the moment this story ships and is a required Task 4 edit.

### Previous-story and Git intelligence

- Baseline is live-refreshed `origin/main` at `f37e7c98fae6122374f60d3bb65757ae74341076`, the Story 3.3 merge.
- Story 3.2's scope fence (`3-2-discover-catalog-sitemap.md:167`): "Landing-page redesign/navigation, repository link, Demo Poll → Stories 3.4–3.6. Do not alter `src/pages/index.astro` merely to add a Discover link early." This story is the sanctioned owner of `index.astro`.
- Story 3.2 centralized surface copy near its owning module and wrote exact-copy source-contract tests; Story 3.3 kept routes as transport-only adapters and recorded decisions in a binding D-table. Both patterns are reflected here.
- Recurring adversarial-review classes to avoid: `new URL()` without care (use the `new URL(path, origin).href` idiom, never string-concat), reflecting unvalidated input in errors, and `.astro` type-check blind spots (`pnpm check` skips `.astro` — component wiring is proved by source-contract walkers and browser tests, not `tsc`).
- Commit conventions: Conventional Commits with a scope (Story 3.2/3.3 used `feat(discovery): …`; this story's natural scope is `feat(landing): …`), one logical change per commit, explicit-path staging, no attribution trailers, merge via PR with `--no-ff`.
- Preserve unrelated untracked files present at story creation: `_bmad-output/implementation-artifacts/epic-1-retro-2026-08-03.md` and `epic-2-retro-2026-08-03.md`. Stage only this story's explicit paths; never `git add -A`.
- Adjacent deferred items (do not fix silently, do not regress): the two unconsumed `…Light` exception tokens in `tokens.css`; the `.astro` type-coverage gap. The `deferred-work.md:43` entry "mode-toggle label goes stale on OS theme change, no `matchMedia` change listener" looks outdated — `src/scripts/mode-override.ts:100-117` now has a change listener that syncs toggle labels. Verify before touching that entry; if confirmed stale, record the finding rather than silently editing the ledger. If this story's work resolves any item incidentally, record it in `deferred-work.md`; otherwise leave entries untouched.

### Current platform specifics (verified 2026-08-04)

- Locked repository versions are Node `24.18.0`, pnpm `11.17.0`, TypeScript `7.0.2`, Astro `7.1.5`, `@astrojs/cloudflare` `14.1.6`, Better Auth `1.6.25`, Zod `4.4.3`, Wrangler `4.115.0`, Vitest `4.1.10`, Playwright `1.62.0`, and fast-check `4.9.0`. This story adds no dependency.
- The ambient shell may be Node 22. Implementation commands must load `/Users/justin/.nvm/nvm.sh` and run `nvm use` (or otherwise prove Node `24.18.0`) before interpreting package/test failures.
- Astro's on-demand rendering docs cover `Astro.request.method` and direct `Response` returns from page frontmatter — the mechanism for the 405 gate: https://docs.astro.build/en/guides/on-demand-rendering/
- `AGENTS.md` prefers Context7 for current library/cloud docs. Context7 was unavailable at story-creation time, so official primary docs are the recorded fallback; at dev-story start, retry Context7 for Astro `7.1.5` page-route method handling before coding and record the resolution if docs and pinned behavior diverge.

### Testing requirements

| Layer | Required proof |
|---|---|
| Unit (Node) | Source-contract assertions on `src/pages/index.astro`: exact pinned copy, checkable plain/technical split (no stack vocabulary in the statement block; build account names Workers, D1, R2, Turnstile, Better Auth), smoke marker + `tokens.css?raw` extraction, exactly three link targets, `ButtonPrimary` with `href` as the single `button-primary`, no inline hex, no `noindex`. |
| Integration (workerd + real D1) | Container harness (no middleware): `GET /` 200 HTML, `405` + `Allow: GET, HEAD`, no `noindex`, self-canonical on request origin, served marker carries current `--color-solar-dark` hex. Full-chain harness (`astro-middleware-shim.ts`): `x-request-id` present, exactly one telemetry record. Full-chain non-GET probes need same-origin headers (CSRF 403 precedes the page's 405). |
| E2E (Playwright) | Landing content and navigation (Discover, create entry → encoded `/sign-in?return=%2Fcreator%2Fnew` redirect when signed out, repository URL); ported mode-toggle persistence and focus-ring geometry; fresh computed-style font bindings (Newsreader statement, Courier Prime build account); keyboard focus order follows reading order; clean console/network; 375px dark + 1280px light proof screenshots committed under `test-results/story-3-4-landing-proof/`. |
| Full gate | Migration guard, both Vitest projects, type check, Playwright, generated binding types + zero diff, production build, and `git diff --check` in repository order under Node 24.18.0. |

### Scope fences — do not build here

- No Demo Poll, poll placeholder, poll feed, featured-polls query, or any data read on `/` (Story 3.5 owns the pinned poll; `/discover` remains the only public enumeration).
- No site-wide navigation bar, shared header component extraction, footer, session-aware menu, or "my polls" entry.
- No new client JavaScript, animations, page transitions, toasts, spinners, or mode-toggle behavior changes.
- No changes to `src/styles/tokens.css` token names/values (especially `--color-solar-dark`), `src/scripts/mode-override.ts`, `scripts/smoke.mjs` logic, the sitemap, robots, reserved slugs, middleware, bindings, or secrets.
- No marketing machinery: no signup wall copy, tracking, analytics embeds, social cards beyond existing head props, or A/B hooks.
- No new module, adapter, migration, or route; the story touches one page, its tests, proof assets, and documentation.

### Project Structure Notes

- UPDATE: `src/pages/index.astro` (wholesale rewrite keeping header/mode-toggle/smoke-marker mechanics), `tests/e2e/placeholder.spec.ts` → replaced by `tests/e2e/landing.spec.mjs` (delete the former), `CHANGELOG.md`, `README.md` (line 205 heading only), `EXPERIENCE.md` (only if Task 4 reconciliation is needed), `sprint-status.yaml`, this story file.
- NEW: `tests/unit/landing-page.test.mjs`, one or two integration specs (e.g. `tests/integration/landing-route.integration.test.ts` for the container harness; the full-chain assertions may extend an existing middleware-shim spec or live in their own file), `test-results/story-3-4-landing-proof/` screenshots.
- Unchanged (proof-only): `src/pages/sitemap.xml.ts`, `src/pages/robots.txt.ts`, `src/layouts/base-layout.astro`, `src/styles/tokens.css`, `src/scripts/mode-override.ts`, `scripts/smoke.mjs` logic, `src/modules/polls/reserved-slugs.ts`.
- `playwright.config.ts` has no explicit `testMatch`; the default glob already covers `.spec.mjs` (mixed extensions exist today: `placeholder.spec.ts`, `discover.spec.mjs`). No config change needed.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Story 3.4 (lines 772–788); UX-DR25/UX-DR26 (lines 116–117); Epic 3 goal (lines 694–696)]
- [Source: `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md` — UJ-5 (line 45), §4.9 Public Demo Surface (281–283), FR-25 (285–289), FR-26 (291–295), FR-27 (297–301), craft-bar NFR (316)]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md` — IA route `/` (line 39), four-links rule (61), UJ-5 copy contract (410–420), UJ-6 create entry (424), responsive block order (257), Accessibility Floor (269–290)]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md` — two-golds rule (457), Newsreader voice (487), `body-lg` widening (495), layout rules (503–509), one primary per screen (601), poll-card on landing (621)]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` — AD-1, AD-2, AD-13, AD-14, AD-15, AD-22; capability map FR-25–FR-27]
- [Source: `src/pages/index.astro`, `src/pages/discover.astro` (15–24, 74), `src/layouts/base-layout.astro` (5–10), `src/components/button-primary.astro` (25–35), `src/styles/tokens.css` (357–470), `scripts/smoke.mjs` (3, 32–44, 46–81), `src/middleware.ts` (248–280), `src/lib/csrf.ts` (129–132), `tests/e2e/placeholder.spec.ts`, `tests/integration/csrf.integration.test.ts` (94–116), `tests/integration/discover-route.integration.test.ts` (38–53), `src/pages/creator/new.astro` (49–60), `src/pages/sign-in.astro`]
- [Source: `_bmad-output/implementation-artifacts/3-2-discover-catalog-sitemap.md` (D7 sitemap decision, scope fence line 167), `3-3-administrator-delisting.md` (story format, gate order)]

## Dev Agent Record

### Agent Model Used

OpenAI Codex (GPT-5)

### Implementation Plan

- Replace only the root inbound adapter, retaining the header, mode machinery, and token-derived smoke contract.
- Prove the static page contract first, then add direct-route and full-middleware integration coverage without crossing harness responsibilities.
- Replace the retired browser spec with navigation, typography, focus-order, mode, clean-log, and committed visual proof before running the repository gate.

### Debug Log References

- 2026-08-04: Context7 was unavailable in this session; current official Astro on-demand rendering documentation confirmed `Astro.request.method` and direct `Response` returns from SSR `.astro` pages, matching the pinned story contract.
- 2026-08-04 RED: the new landing source-contract suite produced five expected failures against the foundation showcase while 1,191 unaffected tests remained green.
- 2026-08-04 GREEN/REFACTOR: the focused landing suite passed 6/6; full `pnpm test` passed 75 files / 1,196 tests and `pnpm check` passed under Node 24.18.0.
- 2026-08-04 RED: the exact smoke-marker source assertion caught an extra class, and the new AstroContainer tests exposed that the workerd transform reduced `tokens.css?raw` to an empty CSS side-effect module.
- 2026-08-04 GREEN/REFACTOR: restored the exact marker shape and added a narrowly scoped virtual raw-token module in the integration config; the focused route/middleware suite passed 3/3, computed font proof passed 1/1, full `pnpm test` passed 77 files / 1,199 tests, and `pnpm check` passed.

### Completion Notes List

- Task 1: Replaced the foundation showcase with the indexable, self-canonical product landing page in statement → technical account/repository/smoke marker → create → Discover order. The page remains one SSR column, retains the mode toggle and smoke coupling, uses one anchor-form primary action, and adds no data/session read, cache policy, route log, or client script.
- Task 2: Added exact source contracts, direct-container route/indexability/smoke coverage, isolated full-chain request-ID/telemetry coverage, and real-browser computed Newsreader/Courier Prime assertions. The integration-only Vite hook preserves the production `?raw` semantics that the workerd CSS transform otherwise discarded.

### File List

- `_bmad-output/implementation-artifacts/3-4-landing-page.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `src/pages/index.astro`
- `tests/e2e/landing.spec.mjs`
- `tests/integration/landing-middleware.integration.test.ts`
- `tests/integration/landing-route.integration.test.ts`
- `tests/unit/landing-page.test.mjs`
- `vitest.integration.config.ts`

## Change Log

- 2026-08-04: Replaced the foundation showcase with the Story 3.4 product landing page and exact source-contract coverage.
- 2026-08-04: Added isolated route, middleware, smoke-marker, and computed-font proof for the landing contract.
