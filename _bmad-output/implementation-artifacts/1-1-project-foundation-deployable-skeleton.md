---
baseline_commit: c5197a46636ccb091f44a95edb8fbddb3a5b20b1
---

# Story 1.1: Project Foundation & Deployable Skeleton

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As Justin (site operator),
I want the project scaffolded from the official Cloudflare Astro Workers starter with environments, CI, migrations, the CSRF boundary, and the design-token system in place,
so that every later story builds on a deployable, tested, secure floor instead of inventing infrastructure mid-feature.

**Exit criterion (binary):** this story is done when the styled placeholder page is live on staging *and* production, having passed the full deploy gate (tests → build → staging migration → smoke). Every AC below is scaffolding toward that signal.

## Acceptance Criteria

1. **Given** a fresh clone of the repository, **When** `pnpm install`, `pnpm test`, and `pnpm build` are run, **Then** all succeed on the pinned stack (Node 24.18.0, TypeScript 7.0.2, Astro 7.1.5, `@astrojs/cloudflare` 14.1.6, Wrangler 4.115.0, Vitest 4.1.10 + `@cloudflare/vitest-pool-workers`, Playwright, fast-check) scaffolded from the official Cloudflare Astro Workers starter, **And** `wrangler.jsonc` is the binding truth and enables `nodejs_compat`.
2. **Given** the three environments (local, staging, production), **When** the app is deployed, **Then** each uses distinct Worker names, D1 databases, R2 buckets, and secrets, **And** production deploys only after tests, build, staging migration, and a staging smoke check pass (AR-3).
3. **Given** the migrations directory, **When** a numbered `NNNN_description.sql` migration is added, **Then** it applies forward-only to local, staging, and production D1 in that order, and out-of-order or edited historical migrations are rejected.
4. **Given** any state-changing HTTP request whose `Origin` or Fetch Metadata is not same-origin, **When** it reaches the Worker, **Then** the single delivery middleware rejects it before any handler runs (AD-22/AR-18) — in place before the first mutation route exists.
5. **Given** the deployed placeholder page, **When** viewed with OS dark and light preferences, **Then** the DESIGN.md token set renders both modes correctly (suffix-swap rule with its three exceptions), a manual mode override persists locally, and the base layout uses the token spacing, typography, and zero-radius rules (UX-DR1).
6. **Given** the public repository, **When** a visitor reads it, **Then** a real README covers what the product is, the stack, and how to run it, and no secrets or personal data exist anywhere in the history (FR-27 baseline).
7. **Given** any application operation, **When** it completes, **Then** the telemetry adapter emits one structured Workers Logs record — request ID, operation, stable result or error code, duration, provider outcome — and never records tokens, voter digests, Comments, ballot content, or Voter Codes (AD-15/AR-12), **And** D1 Time Travel is documented as the database recovery floor, with R2 reconciled from D1 ownership records after any restore.

## Tasks / Subtasks

- [x] Task 1: Scaffold from the official Cloudflare Astro Workers starter on the pinned stack (AC: #1)
  - [x] Pin Node 24.18.0 (`.nvmrc` or `engines`) and pnpm 11.17.0 (`packageManager` field); scaffold with the official Cloudflare Astro template (`pnpm create cloudflare@latest -- --framework=astro`), then pin exact dependency versions per Dev Notes table
  - [x] Convert generated `wrangler` config to `wrangler.jsonc` if needed; set `compatibility_date: "2026-07-29"` and `compatibility_flags: ["nodejs_compat"]`
  - [x] Create the full Structural Seed directory tree (see Dev Notes) with `.gitkeep` or placeholder barrel files so module boundaries exist from day one
  - [x] Wire `pnpm test` (Vitest unit + integration projects) and `pnpm build` (astro build) scripts; add at least one real passing test per tier so the harness is proven, not vacuous
- [x] Task 2: Three environments in `wrangler.jsonc` + deploy gate (AC: #2)
  - [x] Define staging and production Wrangler environments with distinct Worker names (e.g. `oddspark-polls-staging` / `oddspark-polls`), distinct D1 database bindings, distinct R2 bucket bindings; local uses workerd + local D1/R2 via `wrangler dev`
  - [x] Document Worker secrets flow (`wrangler secret put` per environment; `.dev.vars` locally — already gitignored); no secrets in `wrangler.jsonc`
  - [x] Create CI pipeline (GitHub Actions) implementing the gate order: tests → build → staging migration → staging deploy → staging smoke check → production migration → production deploy
  - [x] Smoke check = HTTP GET against the staging placeholder page asserting 200 and a token-derived marker in the HTML (the observable exit-criterion signal)
  - [x] Refresh generated binding types in CI (`wrangler types`) per Consistency Conventions
- [x] Task 3: Forward-only D1 migration discipline (AC: #3)
  - [x] Create `db/migrations/` with migration `0001_` (baseline — may be minimal, e.g. a `meta`/no-op table; full domain schema belongs to later stories)
  - [x] Configure Wrangler D1 migrations (`migrations_dir`) so `wrangler d1 migrations apply` runs local → staging → production in that order via scripts/CI
  - [x] Add a guard (CI step or script) that rejects out-of-order numbering and edits to already-applied migration files (e.g. checksum/manifest comparison committed to the repo)
- [x] Task 4: CSRF delivery middleware (AC: #4)
  - [x] Implement `src/middleware.ts` as the single delivery middleware: reject any state-changing request (non-GET/HEAD/OPTIONS) whose `Origin` header or Fetch Metadata (`Sec-Fetch-Site`) is not same-origin — before any handler runs
  - [x] Stub the session-bound CSRF token hook for authenticated creator/admin forms (full wiring lands with Story 1.2's auth; the rejection boundary itself must be complete now)
  - [x] Leave a documented pass-through for the future Better Auth mounted handler (it keeps its own CSRF/OAuth-state protections) without creating a general bypass — no capability route may bypass this middleware
  - [x] Integration tests (workerd pool): cross-origin POST rejected; same-origin POST passes; GET unaffected
- [x] Task 5: Design-token system + styled placeholder page (AC: #5)
  - [x] Translate the DESIGN.md frontmatter token set (colors, typography, motion, breakpoints, rounded, spacing, component groups) into a single canonical stylesheet source — CSS custom properties; mode-suffixed source tokens collapse to unsuffixed runtime vars scoped by mode (the DESIGN.md mockup convention)
  - [x] Implement mode resolution: `-dark`→`-light` suffix swap with exactly three `…Light` exceptions (`results-bar.leaderMarkerColorLight`, `availability-cell.yesGlyphColorLight`, `overlay.scrimLight`); OS preference default (`prefers-color-scheme`) + manual override persisted locally (localStorage), applied without flash on load
  - [x] Load Courier Prime (400, 700) and Newsreader (400 only) as self-hosted `@font-face` assets — voter surface must not wait on a third-party font CDN (NFR-5); fallback stack `"Courier Prime", "Courier New", monospace`
  - [x] Build the shared token-bound component primitives in `src/components/` as server-rendered Astro components: `button-primary`, `button-secondary`, `input` (+ label-caps label treatment), `poll-option`, `results-bar`, `overlay` — later epics consume, never restyle; every focusable primitive binds `focusOutline` to `focus-ring-*` (2px outline, 2px offset)
  - [x] Placeholder page at `/` exercising the base layout (mobile-first single column, 20px/48px margins, 68ch measure, zero radius, hairline rules, both type families) and demonstrating the primitives in both modes
  - [x] Mode-override enhancement script in `src/scripts/` as isolated vanilla TS; page renders correctly with JS disabled (OS-preference mode)
- [x] Task 6: Telemetry adapter + recovery documentation (AC: #7)
  - [x] Implement `src/adapters/telemetry/` emitting exactly one structured Workers Logs record per operation: `request ID, operation, stable result or error code, duration, provider outcome` — a typed emit function, not ad-hoc `console.log`
  - [x] Enforce the deny-list by construction (narrow record type; never tokens, voter digests, Comments, ballot content, Voter Codes); generate/propagate a request ID in the middleware request context
  - [x] Unit test: record shape; forbidden-field freedom
  - [x] Document D1 Time Travel as the recovery floor (7 days Workers Free / 30 days Paid) and post-restore R2 reconciliation from D1 ownership records (README or `docs/` runbook)
- [x] Task 7: Real README + secrets hygiene (AC: #6)
  - [x] Replace the current BMad-status README.md with a product README: what oddspark-polls is (trustworthy casual polls at polls.oddspark.dev — multiple-choice/ranked/image/meeting, vote security, no subscription), the Cloudflare stack, how to run locally, how environments deploy; note it's a public demonstration build
  - [x] Verify no secrets or personal data in history (git log is one BMad commit; keep it that way — `.dev.vars`/`.env` already gitignored); baseline rate limits, OAuth setup etc. are later stories
  - [x] Create the GitHub remote/public repo if absent (FR-27 baseline; presentable bar closes in Epic 3)
  - [x] Remove the stray empty `{output_folder}/` directory at repo root
- [x] Task 8: Prove the exit criterion (AC: #2, exit)
  - [x] Run the full gate end-to-end; styled placeholder page live on staging and production; record deployed URLs in Dev Agent Record

## Dev Notes

### Constraints that bind this story (do not violate)

- **Cost ceiling (AD-18/NFR-1):** Cloudflare free tiers or one $5 Workers Paid plan; nothing with an additional mandatory monthly fee. CI must be free-tier (GitHub Actions free for public repos).
- **AD-2 progressive enhancement:** server-rendered HTML, zero client JS by default; isolated vanilla TS in `src/scripts/` only where UX requires (here: only the mode override); POST-redirect-GET works without JS.
- **AD-1 hexagonal boundaries:** delivery adapters → application commands/queries → domain + outbound ports; domain imports neither Astro nor provider APIs; no environment lookup inside domain modules.
- **Do NOT build yet:** auth (Story 1.2 — but leave the middleware pass-through documented), any poll schema/routes, Voter Codes, VPN blocking, WebSockets, analytics, rate-limit bindings beyond scaffolding needs. No draft states, no speculative abstractions.

### Pinned stack (verified 2026-07-29; lockfile owns transitive versions after scaffold)

| Package | Version |
| --- | --- |
| Node.js | 24.18.0 |
| pnpm | 11.17.0 |
| TypeScript | 7.0.2 |
| Astro | 7.1.5 |
| `@astrojs/cloudflare` | 14.1.6 |
| Zod | 4.4.3 |
| Wrangler | 4.115.0 |
| Vitest | 4.1.10 |
| `@cloudflare/vitest-pool-workers` | 0.19.0 |
| Playwright | 1.62.0 |
| fast-check | 4.9.0 |
| Better Auth | 1.6.25 — *install deferred to Story 1.2; listed so no other version is chosen* |
| Workers compatibility date | `2026-07-29` |

### Structural Seed (create exactly this tree)

```text
src/
  pages/                 # Astro inbound HTTP adapters and server-rendered pages
  middleware.ts          # session extraction, request context, CSRF boundary
  components/            # server-rendered UI bound to DESIGN.md
  scripts/               # isolated progressive-enhancement TypeScript
  modules/
    identity/            # creator principal and authorization policy
    polls/               # lifecycle plus poll-type strategies
    voting/              # security composition and CastVote
    results/             # Tally and Manifest projections
    discovery/           # listed-poll eligibility and catalog queries
    comments/            # vote-attached comment policy
  shared/
    domain/              # provider-free value types and errors
    application/         # command/query primitives and outbound ports
  adapters/
    auth/                # Better Auth and OAuth (empty until 1.2)
    d1/                  # repositories, batches, projection SQL
    r2/                  # temporary/adopted image objects
    turnstile/           # challenge verification
    rate-limit/          # best-effort admission controls
    telemetry/           # Workers Logs mapping
db/
  migrations/            # forward-only numbered D1 SQL (NNNN_description.sql)
tests/
  unit/                  # pure domain and tabulation tests
  integration/           # workerd plus local D1/R2 adapter contracts
  e2e/                   # Playwright user journeys
```

Naming: TypeScript files kebab-case; exported types PascalCase; functions camelCase; D1 tables/columns snake_case; UUID strings for internal entities; UTC Unix ms in D1. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions]

### Environments & deploy gate (AD-14/AR-3)

- Distinct per env: Worker name, D1 database, R2 bucket, secrets (OAuth credentials arrive in 1.2). `wrangler.jsonc` is binding truth; secrets via `wrangler secret put` / `.dev.vars`.
- Gate order (CI): tests + build → staging migrate → staging deploy → staging smoke → production migrate → production deploy. The spine defines the gate's existence and order, not resource-name strings or CI vendor — choose sensible names, GitHub Actions.
- Migrations: `wrangler d1 migrations` gives ordered forward-only apply; the "edited historical migration rejected" AC needs an explicit checksum manifest guard in CI (wrangler does not checksum by itself).

### CSRF boundary (AD-22) — exact contract

One delivery middleware rejects state-changing requests whose `Origin` and Fetch Metadata are not same-origin. Authenticated creator/admin forms additionally require a session-bound CSRF token (hook now, full wiring with 1.2). Better Auth's mounted handler keeps its own protections — pass-through must be scoped to its mount path only, never a general bypass. No capability route may bypass the central middleware. Rejection happens before any handler runs. [Source: ARCHITECTURE-SPINE.md#AD-22]

### Design tokens (UX-DR1) — implementation contract

- DESIGN.md YAML frontmatter is the single canonical token source: groups `colors`, `typography`, `motion`, `breakpoints`, `rounded` (all 0 except `full: 9999px`), `spacing`, `components`. Read it directly at `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md` before styling anything.
- Every color has explicit `-dark`/`-light` twins (neither mode is default). Light mode = suffix swap, with exactly three explicit `…Light` exceptions: `results-bar.leaderMarkerColorLight` (= `solar-ink-light` #8A6D10), `availability-cell.yesGlyphColorLight` (= `solar-ink-on-wash-light` #6E560B), `overlay.scrimLight` (rgba(26,32,40,0.36)).
- Gold fills bind to `solar-*`; gold ink (glyphs, markers, rules, edges) to `solar-ink-*`; every focus outline to `focus-ring-*` (2px solid, 2px offset) — never `solar-*` directly (light-mode contrast is why: `focus-ring-light` #8A6D10 = 4.57:1 vs solar-light 2.25:1).
- Typography: Courier Prime (machine voice, 400/700, tabular-by-monospace) + Newsreader (human voice, 400 only, never bold). 13 named styles; `label-caps` = 11px/0.18em uppercase in `dim` — the identity-carrying detail.
- Shape: zero radius everywhere; `rounded.full` exists only for the 6px live-indicator dot; Turnstile iframe is the only other sanctioned exception. No shadows, no elevation beyond void→panel one step; hairlines (`rule`, 1px) never form boxes.
- Motion tokens defined now; **nothing animates in this story** (five primitives arrive with the results stories; idle is still).
- Primitive component token bodies (exact values for `button-primary`, `button-secondary`, `input`, `poll-option`, `results-bar`, `overlay`) live in DESIGN.md frontmatter — bind to tokens, don't restate values. `poll-option` uses visually-hidden native inputs with the row as `<label>` and decorative `::before` markers. `results-bar` in this story is a static token-bound skeleton (bars on baseline rules, label + `47% · 122` value cluster inside, leader gold + `◆`); no live data, no animation yet.
- `faint` is never for text a user must read; disabled buttons use `dim`.

### Telemetry (AD-15) — record shape

Exactly five fields: request ID, operation, stable result/error code, duration, provider outcome. One record per operation. Forbidden forever: tokens, voter digests, Comments, ballot content, Voter Codes. Structured via Workers Logs (`console.log` of a JSON object is the Workers Logs structured mechanism; wrap it in the adapter). Request ID generated in middleware context. [Source: ARCHITECTURE-SPINE.md#AD-15]

### Current repo state (verified 2026-07-29)

- One commit (`c5197a4`, BMad scaffold), branch `main`, **no git remote yet**. No `package.json`, no `src/`, nothing app-shaped exists — greenfield scaffold into a root that already contains `_bmad/`, `_bmad-output/` (untracked), `.claude/`, `.bmad-loop/`, `.codex/`, `.agents/`, `.omc/`, empty `docs/`, and the BMad-status `README.md` (replace it).
- `.gitignore` already covers `.wrangler/`, `.dev.vars`, `.env*`, `node_modules/`, BMad runtime dirs. Stray empty `{output_folder}/` dir at root — remove it.
- Scaffolder note: run the Cloudflare starter into a temp dir and merge, or scaffold in place carefully — the root is not empty and the starter must not clobber BMad files.

### Testing standards

- `tests/unit`: pure functions, plain Vitest. `tests/integration`: Vitest with `@cloudflare/vitest-pool-workers` (workerd + local D1/R2) — this is where middleware and telemetry tests run. `tests/e2e`: Playwright against `wrangler dev` (placeholder-page smoke: renders, both modes, focus ring visible).
- Vitest 4 + pool-workers 0.19.0: configure via `defineWorkersConfig` with a Vitest projects/workspace split so unit tests don't pay workerd startup. fast-check installed now; first real use is the IRV tabulator (Epic 5).
- Minimum for this story: harness proven with ≥1 meaningful test per tier (e.g. unit: telemetry record shape; integration: CSRF rejection; e2e: placeholder page renders in both modes).

### Project Structure Notes

- The Structural Seed is authoritative over whatever layout the starter generates — keep starter's `astro.config.mjs`/`public/` conventions, then shape `src/` to the seed.
- `src/middleware.ts` is Astro's native middleware location (`defineMiddleware`/`sequence`); CSRF + request context + (later) session extraction compose there as one chain.
- Component filenames kebab-case (e.g. `poll-option.astro`, `results-bar.astro`).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1] — story statement, exit criterion, ACs
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1] (line 157) — foundation scope list, de-risking rules, primitives list
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md#Stack] — pinned versions
- [Source: ARCHITECTURE-SPINE.md#Structural Seed] — source tree, deploy pipeline, entity map
- [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-14, #AD-15, #AD-18, #AD-22] — starter mandate, environments, telemetry, cost ceiling, CSRF
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions] — naming, config, errors, logging, HTTP rules
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md] — frontmatter token set (canonical), §Colors, §Typography, §Shapes, §Elevation, §Layout & Spacing, component token bodies
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md#1, #4.9 FR-27, #5, #6] — README product summary material, cost/data-ownership NFRs, non-goals

## Dev Agent Record

### Agent Model Used

Grok 4.5 (xAI) via bmad-dev-story

### Debug Log References

- Astro Cloudflare adapter emits `no_bundle` multi-module uploads; Workers script API returned HTML 403 for multi-module PUT/versions. Fixed with `scripts/deploy.mjs` single-module esbuild bundle + env-specific deploy config.
- `CLOUDFLARE_ENV=staging|production` required at build time (Astro 6+/adapter) so redirected `dist/server/wrangler.json` bakes the correct env bindings.
- Invalid `CLOUDFLARE_API_TOKEN` in shell environment forced OAuth-only deploy (`env -u CLOUDFLARE_API_TOKEN`); OAuth scopes include `workers_scripts` write.
- Playwright e2e initially hit port 4321 collision (another Astro app); moved e2e to port 4391 with `reuseExistingServer: false`.
- R2 binding named `MEDIA` (not `IMAGES`) to avoid clashing with Cloudflare Images adapter default.
- Vitest pool-workers 0.19 uses `cloudflareTest()` plugin (not legacy `defineWorkersConfig` / `./config` export).

### Completion Notes List

- Scaffolded Astro 7.1.5 + `@astrojs/cloudflare` 14.1.6 on Node 24.18.0 / pnpm 11.17.0 with pinned stack versions.
- Structural seed directories + barrel placeholders for hexagonal modules/adapters.
- CSRF middleware + request ID + telemetry emit; Better Auth mount path pass-through documented/stubbed; session CSRF hook stub for 1.2.
- DESIGN.md tokens in `src/styles/tokens.css`; self-hosted Courier Prime + Newsreader; primitives + placeholder `/`.
- D1 baseline migration + checksum manifest guard; applied local/staging/production.
- CI deploy gate workflow; smoke script asserts 200 + solar token marker.
- Product README + recovery runbook; public GitHub remote created at https://github.com/drinkyouroj/oddspark-polls (not yet pushed).
- **Live:** staging https://oddspark-polls-staging.hearnsystems.workers.dev · production https://oddspark-polls.hearnsystems.workers.dev (smoke OK both).
- Tests: 15 unit+integration pass; 3 Playwright e2e pass; `pnpm build` pass.

### Implementation Plan

1. Pin tooling and scaffold Astro/Cloudflare bindings without clobbering BMad artifacts.
2. Middleware/CSRF/telemetry first so the security floor exists before routes.
3. Token system + primitives + placeholder page as the deploy smoke target.
4. Migrations + checksum guard + three-env wrangler + GitHub Actions gate.
5. Bundle-based deploy script to work around multi-module upload 403; prove staging then production.

### File List

- `.dev.vars.example`
- `.github/workflows/deploy.yml`
- `.gitignore`
- `.nvmrc`
- `README.md`
- `astro.config.mjs`
- `db/migrations/0001_baseline.sql`
- `db/migrations.manifest.json`
- `docs/recovery.md`
- `package.json`
- `playwright.config.ts`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `public/.assetsignore`
- `public/favicon.ico`
- `public/favicon.svg`
- `public/fonts/courier-prime-400.woff2`
- `public/fonts/courier-prime-700.woff2`
- `public/fonts/newsreader-400.woff2`
- `scripts/deploy.mjs`
- `scripts/migrations-checksum.mjs`
- `scripts/migrations-guard.mjs`
- `scripts/smoke.mjs`
- `src/adapters/auth/index.ts`
- `src/adapters/d1/index.ts`
- `src/adapters/r2/index.ts`
- `src/adapters/rate-limit/index.ts`
- `src/adapters/telemetry/index.ts`
- `src/adapters/turnstile/index.ts`
- `src/components/button-primary.astro`
- `src/components/button-secondary.astro`
- `src/components/input.astro`
- `src/components/overlay.astro`
- `src/components/poll-option.astro`
- `src/components/results-bar.astro`
- `src/env.d.ts`
- `src/layouts/BaseLayout.astro`
- `src/lib/csrf.ts`
- `src/lib/request-context.ts`
- `src/middleware.ts`
- `src/modules/comments/index.ts`
- `src/modules/discovery/index.ts`
- `src/modules/identity/index.ts`
- `src/modules/polls/index.ts`
- `src/modules/results/index.ts`
- `src/modules/voting/index.ts`
- `src/pages/index.astro`
- `src/scripts/mode-override.ts`
- `src/shared/application/index.ts`
- `src/shared/domain/index.ts`
- `src/styles/fonts.css`
- `src/styles/tokens.css`
- `tests/e2e/placeholder.spec.ts`
- `tests/integration/csrf.integration.test.ts`
- `tests/integration/worker-entry.ts`
- `tests/unit/csrf.test.ts`
- `tests/unit/telemetry.test.ts`
- `tsconfig.json`
- `vitest.config.ts`
- `vitest.integration.config.ts`
- `vitest.unit.config.ts`
- `worker-configuration.d.ts`
- `wrangler.jsonc`
- `_bmad-output/implementation-artifacts/1-1-project-foundation-deployable-skeleton.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-07-29: Implemented Story 1.1 foundation — scaffold, CSRF, tokens, telemetry, migrations, CI, deploy to staging+production, public GitHub remote.
