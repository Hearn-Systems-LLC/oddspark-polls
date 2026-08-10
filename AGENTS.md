# AGENTS.md — oddspark-polls

<!-- context7 -->
Use the `ctx7` CLI to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service — even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer — your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

## Context7 steps

1. Resolve library: `npx ctx7@latest library <name> "<what to look up>"` — use the official library name with proper punctuation.
2. Pick the best `/org/project` match by exact name, description relevance, snippet count, source reputation, and benchmark score.
3. Fetch docs: `npx ctx7@latest docs <libraryId> "<what to look up>"` — use one command per distinct concept unless the question is about their interaction.
4. Answer using the fetched documentation.

Call `library` first unless the user provides a `/org/project` ID. Do not run more than three Context7 commands per question or include sensitive information in queries. For version-specific docs, use the versioned ID returned by `library`. If quota is exhausted, suggest `npx ctx7@latest login` or `CONTEXT7_API_KEY`; do not silently fall back to training data.
<!-- context7 -->

<!-- codebase-memory-mcp:start -->
## Codebase Knowledge Graph

Prefer codebase-memory-mcp graph tools over grep, glob, or file search for code discovery:

1. `search_graph`
2. `trace_path`
3. `get_code_snippet`
4. `query_graph`
5. `get_architecture`

Use grep or file search for string literals, error messages, configuration and non-code files, or when graph results are insufficient. Run `index_repository` first if the repository is not indexed.
<!-- codebase-memory-mcp:end -->

> This file is the authoritative guide for Claude Code and any AI agent working in this
> repository. Read it fully before taking any action. It is committed to the repo root
> and applies to every session.

**Project:** oddspark-polls
**Purpose:** Trustworthy casual polls — multiple-choice, ranked, image, and meeting polls with vote security and no subscription wall.
**Live:** Cloudflare Workers, `oddspark-polls` at `polls.oddspark.dev` — production ships from `main` via `.github/workflows/deploy.yml`; the workers.dev hostname is disabled.
**Preview:** Cloudflare Workers, `oddspark-polls-staging` — every production deploy passes through staging first; there is no separate staging branch.
**Last updated:** 2026-08-10

This is a **public demonstration build**. The product is real, the repo is presentable, and
nothing secret belongs in history — not in code, not in `wrangler.jsonc`, not in a commit
message, not in CI logs.

---

## Environment & Stack

**Language(s):** TypeScript 7, SQL (D1/SQLite dialect)
**Framework(s):** Astro 7 (SSR via `@astrojs/cloudflare` 14)
**Database(s):** Cloudflare D1 (forward-only SQL migrations)
**Key dependencies:** Better Auth 1.6 (Google + GitHub OAuth), Zod 4, Wrangler 4
**Runtime:** Cloudflare Workers with `nodejs_compat` · Node 24.18.0 · pnpm 11.17.0

Binding truth lives in `wrangler.jsonc`. Secrets never do.

| Binding | What it is |
|---|---|
| `DB` | D1 database (`migrations_dir: db/migrations`) |
| `MEDIA` | R2 bucket for poll images (named `MEDIA`, not `IMAGES`, to avoid clashing with Cloudflare Images) |
| `SESSION` | KV namespace for Astro sessions (adapter default name) |
| `ASSETS` | Static assets from `./dist` |
| `VOTE_RATE_LIMITER` | Best-effort per-source-IP per-Poll vote admission throttle (shared IPs share one budget) |

| Env | Worker | D1 / R2 name |
|---|---|---|
| local | `oddspark-polls-local` | `oddspark-polls-local` |
| staging | `oddspark-polls-staging` | `oddspark-polls-staging` |
| production | `oddspark-polls` | `oddspark-polls` |

Staging and production are selected at **build time** via `CLOUDFLARE_ENV`, not by a runtime
flag. `pnpm build` alone produces the local-flavored artifact.

### Setup

```bash
# Prerequisites: Node 24.18.0 (see .nvmrc), pnpm 11.17.0
nvm use
corepack enable
pnpm install

# Apply local D1 migrations (required before first run)
pnpm migrate:local

# Run locally
pnpm dev

# Run tests
pnpm test
```

> Always verify the environment is set up before suggesting code changes.
> Never assume a dependency is installed.

### Secrets

Nine runtime values are required in **every** environment: eight secret-backed
bindings plus one public Turnstile site-key var. Secrets
(`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`TURNSTILE_SECRET_KEY`, `VOTE_DIGEST_SECRET`) are declared under
`secrets.required` in `wrangler.jsonc` at the root **and** in each named
environment — that list is binding/type/deploy truth (Wrangler 4.115), not
`.dev.vars` key order. `TURNSTILE_SITE_KEY` is a public per-env `vars` entry
(local/CI always-pass test key; distinct real widgets for staging and production).
Each environment has its own OAuth registrations — six in total — so a local or staging
callback can never share production credentials.

Provision only through the masked helper, which keeps credentials out of command arguments
and shell history:

```zsh
./scripts/provision-auth-secrets.zsh local initialize
./scripts/provision-auth-secrets.zsh local initialize-voting
./scripts/provision-auth-secrets.zsh local initialize-turnstile
./scripts/provision-auth-secrets.zsh staging rotate-providers
./scripts/provision-auth-secrets.zsh staging rotate-turnstile
```

- **Never** paste a credential into chat, a command argument, `wrangler.jsonc`, CI logs, or Git.
- The helper deliberately refuses remote master-secret initialization — Cloudflare secret
  writes are upserts, so `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` / `VOTE_DIGEST_SECRET` /
  `TURNSTILE_SECRET_KEY` are bootstrapped once by hand (or via masked `rotate-turnstile`)
  in each Worker's dashboard. Staging/production rotation rejects every documented
  Cloudflare dummy Turnstile secret.
- Rotating `BETTER_AUTH_SECRET` invalidates active sessions and makes stored OAuth tokens
  unreadable. Treat it as a planned incident, never a routine step.
- Rotating `VOTE_DIGEST_SECRET` makes existing duplicate-vote claims
  incomparable and can allow repeat voting. Treat it as a planned integrity
  incident, never a routine step.
- Siteverify omits optional `remoteip` (raw addresses stay request-bound). CAPTCHA-on
  still loads Cloudflare's third-party iframe in the browser; CAPTCHA-off loads none.

See `README.md` for the full provider-registration table.

---

## Verification

How to *prove* a change is good, and which layer to run for which change.

| Command | Checks | Build first? |
|---|---|---|
| `pnpm test:unit` | Fast logic: CSRF rules, identity policy, telemetry, auth helpers | no |
| `pnpm test:integration` | Real workerd + D1: middleware chain, auth schema, endpoints | no |
| `pnpm test` | Both Vitest projects (unit + integration) | no |
| `pnpm check` | `tsc --noEmit` type check | no |
| `pnpm migrations:guard` | Migration ordering + immutability of committed migrations | no |
| `pnpm test:e2e` | Playwright against a dev server it starts itself — in the deploy gate (CI provisions browsers, local D1 migrations, and a throwaway `.dev.vars`) | no |
| `pnpm build:production` | The artifact that actually ships | — |
| `pnpm smoke:staging` | Deployed staging returns 200, serves the token marker, and answers the auth + binding liveness probes (`/api/auth/ok`, `/api/health`) | yes, deployed |

The CI gate (`.github/workflows/deploy.yml`) runs two parallel jobs: `test-and-build`
(migration guard → `pnpm test` → `pnpm check` → `pnpm types` → binding-types drift check
(`git diff --exit-code worker-configuration.d.ts`) → `pnpm build:production`) and `e2e`,
a 4-way Playwright shard matrix (`pnpm test:e2e --shard=N/4`) whose shards are separate
runners with their own dev server and local-persistence D1, so the local `workers: 1`
serialization does not apply across them. Deploy jobs need both. Match that locally before
pushing. Binding types are driven by `secrets.required` plus public `vars` in
`wrangler.jsonc` (not `.dev.vars` inference). Keep `.dev.vars` provisioning order
with `VOTE_DIGEST_SECRET` last for script consistency with `.dev.vars.example`.

### What the automated checks *don't* catch

- **Visual and design-token fidelity.** Nothing asserts that a component *looks* right in both
  modes. For browser-observable changes, verify against the running app and **show proof** —
  screenshot the affected area, check the console. Don't ask the user to eyeball it.
- **Accessibility beyond the mechanical.** There is no axe run in CI. Contrast, focus order,
  and screen-reader flow are human judgment; the UX review artifacts under
  `_bmad-output/planning-artifacts/ux-designs/` are the standard to check against.
- **Real OAuth round-trips.** Integration tests exercise the middleware against a real Better
  Auth schema in workerd, but no test completes a Google or GitHub redirect. After any auth
  change, validate both provider round-trips against staging before promoting.
- **Migration *semantics*.** `migrations:guard` proves a migration wasn't edited after the
  fact and that numbering is in order. It says nothing about whether the SQL is correct or
  safe against existing production rows — that is on you.
- **`pnpm types` regenerates `worker-configuration.d.ts` from `wrangler.jsonc`.** If you add a
  binding, run it; a stale file makes the type check pass on a binding that doesn't exist.

---

## Testing Conventions

**Framework:** Vitest 4 (two projects) · Playwright 1.62 · fast-check for property tests

### Rules

- Every new function, endpoint, or middleware behavior gets a test in the same commit that
  introduces it.
- Tests live in `tests/{unit,integration,e2e}/`. Integration files are named
  `*.integration.test.ts`; unit files are `*.test.ts`.
- Test names read as prose sentences describing behavior, not implementation:
  `it("rejects cross-origin POST via Origin header")`, not `it("checkCsrf case 3")`.
  Match the existing style in `tests/unit/csrf.test.ts`.
- **Unit tests run on Node; integration tests run in workerd** via
  `@cloudflare/vitest-pool-workers`. The split exists so unit tests don't pay workerd
  startup — don't move a pure-logic test into the integration project for convenience.
- Anything touching D1, Better Auth, or the middleware chain belongs in integration, where it
  runs against real bindings rather than a mock.
- No commit lands on `main` with failing tests.

### Running Tests

```bash
pnpm test                     # both projects
pnpm test:unit                # node project only
pnpm test:integration         # workerd project only
pnpm test -- tests/unit/csrf.test.ts   # a single file
pnpm test:watch               # watch mode
pnpm test:e2e                 # Playwright (starts its own dev server)
```

---

## Git Flow & Commit Conventions

### Branch Model

This project does **not** use a `develop` branch. `main` is the integration branch *and* the
deploy trigger.

| Branch | Role |
|---|---|
| `main` | Integration and release. Every push runs the full deploy gate and ships to staging then production. Never push work-in-progress here. |
| `story/N-M-slug` | One branch per BMad story, cut from `main`, merged back via PR. Named after the story: `story/1-2-creator-sign-in`. |
| `fix/*` / `chore/*` | Work that isn't a tracked story. |

### Rules

- **A push to `main` deploys to production.** Treat every merge as a release: the gate runs
  tests, migrates staging, deploys staging, smokes it, migrates production, deploys production.
- Work happens on a `story/*` branch and merges via PR. If you find yourself on `main` with
  uncommitted work, branch first.
- The deploy workflow sets `cancel-in-progress: false` deliberately — a run cancelled between
  the production migration and the production deploy would leave prod schema ahead of code.
  Never "unstick" a queued run by cancelling one mid-flight.
- Delete story branches after merge.

### Commit Message Format

[Conventional Commits](https://www.conventionalcommits.org/), matching existing history
(`feat: implement creator OAuth sign-in`, `fix: close Story 1.1 foundation review findings`):

```
<type>(<scope>): <short description>

[optional body — wrap at 72 chars]

[optional footer — BREAKING CHANGE, closes #issue]
```

**Types:** `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`

### Commit Granularity

**Commit per logical change — not per file, not per hour, not per task.** A logical change is
the smallest unit that leaves the codebase in a valid state: the migration in one commit, the
module that reads it in another, the route that exposes it in a third.

Anti-patterns: batching unrelated changes ("misc fixes"), splitting one logical change to pad
history, "WIP" commits on shared branches, committing commented-out code.

### Attribution & When to Commit

- **No attribution trailers.** No `Co-Authored-By`, no "Generated with …". A commit message is
  its subject, an optional body, and Conventional-Commit footers — nothing more. Match history.
- **Commit after each round of changes**, once types and tests are green, scoping `git add` to
  the files that round touched — never a blanket `git add -A`.
- **Push only when the user asks.** Here that rule has teeth: pushing to `main` deploys.

### Pull Requests

- PR title in Conventional Commit format.
- Description states what changed, why, and how to verify it. Link the story file under
  `_bmad-output/implementation-artifacts/`.
- Merge with `--no-ff` so story history stays legible.

---

## Documentation & Design — sources of truth

Read the relevant one before changing what it governs, and keep it current in the same commit
that changes the underlying reality.

- **`README.md`** — public-facing overview: stack, environments, OAuth registrations and secret
  provisioning, local setup, deploy gate, migrations. Update it in the same commit when setup,
  bindings, or environment topology change.
- **`CHANGELOG.md`** — [Keep a Changelog](https://keepachangelog.com/) format. Add user-facing
  changes under `## [Unreleased]` as you go; a release promotes that block to a versioned,
  dated section. Never edit a released section retroactively. Internal refactors, test
  changes, and doc edits that a user cannot observe do not belong here.
- **`_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md`**
  — the authoritative architecture. Defines the hexagonal paradigm and the numbered invariants
  (`AD-*`) and requirements (`AR-*`) that source comments reference. Read before adding a
  module, adapter, or route; update it in the same PR when a change alters the topology.
- **`_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md`** (plus its
  `addendum.md`) — product requirements, `FR-*` and `UJ-*` identifiers.
- **`_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md`** — the
  design system: tokens, type, spacing, named rules. `src/styles/tokens.css` is its code
  expression; keep the two in sync and change tokens there, never inline in a component.
  `EXPERIENCE.md` alongside it covers flows and states.
- **`_bmad-output/planning-artifacts/epics.md`** — epic and story breakdown.
- **`_bmad-output/implementation-artifacts/N-M-*.md`** — the per-story spec and running record.
  The story file for the branch you are on is your working brief.
- **`_bmad-output/implementation-artifacts/sprint-status.yaml`** — story status tracking. BMad
  workflows own transitions; don't hand-edit it to mark work done.
- **`_bmad-output/implementation-artifacts/deferred-work.md`** — accepted-but-not-yet-done
  items. Put deferred findings here rather than leaving a `TODO` in source.
- **`docs/recovery.md`** — D1 Time Travel recovery procedure and R2 reconciliation.

This project deliberately has **no** `build_log.md` and **no** `docs/decisions/` directory: the
BMad story files and the architecture spine already hold that record, and a parallel one would
drift. Record decisions where they belong above.

---

## Project-specific notes

- **Migrations are forward-only and checksummed.** `db/migrations/NNNN_description.sql` files
  are immutable once committed; `db/migrations.manifest.json` holds their hashes and
  `pnpm migrations:guard` fails CI on any edit to history or out-of-order numbering. To change
  schema, add a new migration and run `pnpm migrations:checksum` to refresh the manifest.
  Never "fix" a guard failure by editing the manifest to match an edited file.

- **The staging smoke test reads a real design token.** `scripts/smoke.mjs` extracts
  `--color-solar-dark` from `src/styles/tokens.css` and asserts the served HTML carries that
  hex — deleting or renaming that token breaks the deploy gate *by design*. If the smoke test
  fails after a styling change, the fix is in the styles, not in the smoke script. The same
  script then probes `/api/auth/ok` (auth config construction) and `/api/health` (binding
  liveness), so a deploy with a forgotten secret fails the gate even when the page renders.

- **`/api/health` is a presence-only binding-liveness probe, not a status page.** It answers
  200 when every required binding is present and otherwise names the *missing bindings by
  name* — never values, no authentication required. That presence-only contract is
  load-bearing: `scripts/smoke.mjs` asserts it in the deploy gate, so keep the response free
  of secret values and side effects.

- **Hexagonal dependency direction is an invariant (AD-1), not a preference.** `src/modules/*`
  owns domain policy and depends on nothing outside the domain. `src/adapters/*` implements
  outbound ports. `src/pages/*` and `src/middleware.ts` are inbound adapters only. A route
  handler containing a business rule is a defect regardless of whether it works.

- **The middleware chain order in `src/middleware.ts` is load-bearing** (AD-22): request
  context → telemetry → session → CSRF → creator guard. Telemetry wraps the rest so every
  operation emits exactly one record even when a handler throws. Reordering silently changes
  which requests are protected.

- **`/api/auth/*` is the only CSRF pass-through, and it is scoped, not a bypass.** Better Auth
  owns its own CSRF and OAuth-state protection on its mount path. Every capability route goes
  through `src/lib/csrf.ts`. Authenticated creator/admin mutations additionally require a
  session-derived token compared in constant time.

- **Never append `getSession` cookie headers on the Better Auth mount path or a sign-out POST.**
  Those handlers manage their own cookies; appending refresh headers would restore a session
  the user just ended. `src/middleware.ts` guards both cases explicitly.

- **A failed session lookup degrades to signed-out, never a 500.** A missing binding or D1
  error must not 500 every route for cookie-bearing visitors. It sets `sessionLookupFailed`
  on the request context and continues as anonymous; the outer telemetry middleware folds
  that flag into the single per-request record as `result: "error"` — don't emit a second
  record from inside `sessionMiddleware`.

- **A failed lookup is not an expired session.** `sessionExpired` is set only when the lookup
  *succeeded* and returned no session. When the lookup itself failed, session state is
  unknown, and showing the "your session expired" line would be a lie during a D1 outage.

- **`oddspark.creator_session_seen` is a non-sensitive marker, not an auth cookie.** It exists
  only so an expired session can be distinguished from a never-signed-in visitor and shown the
  right sign-in reason. It confers no access; don't treat its presence as authentication.

- **Every response carries `x-request-id`.** Responses with immutable headers (e.g.
  `Response.redirect()`) are cloned rather than mutated — that's why the header code has a
  try/catch. Removing it would double-emit telemetry through the catch path.

- **Design tokens are mode-suffixed at the source and collapse to unsuffixed runtime vars.**
  Light mode is a `-dark` → `-light` suffix swap with exactly three documented exceptions.
  Dark binds unconditionally as the no-preference fallback. Don't add a fourth exception
  without updating DESIGN.md.

- **No placeholder completions.** `TODO` markers, `test.skip`/`.only`, stub tests, and
  unimplemented branches are blockers, not evidence of progress. If work must be deferred,
  record it in `deferred-work.md` and say so explicitly.
