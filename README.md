# oddspark-polls

Oddspark Polls is a trustworthy casual-poll product: create a question, share
one durable link, and watch an honest count without a subscription wall. It
exists because quick group decisions should not require an enterprise survey
tool or a ballot box that is easy to stuff.

Try the live production Worker at
[oddspark-polls.hearnsystems.workers.dev](https://oddspark-polls.hearnsystems.workers.dev).
`polls.oddspark.dev` is the product identity and planned custom domain; it is
not bound yet.

This is a **public demonstration build**: the product is real, the repo is presentable, and nothing secret belongs in history.

## Current scope

Infrastructure does not count as shipped product behavior. In particular, the
configured R2 binding prepares image storage; it does not mean Image Polls are
available yet.

| Status | Capabilities |
| --- | --- |
| Shipped | Multiple-Choice Polls, including bounded multi-select, opt-in Comments with Votes, authorized Comment lists, and owner/administrator Comment moderation; Session and IP Checks; Turnstile; per-source-IP rate limiting; canonical sharing; live Results; creator lifecycle controls; opt-in Discovery and administrator delisting; the product landing page; the live Demo Poll |
| Planned / backlog | CSV and XLSX export; Ranked-Choice, Image, and Meeting Polls; Voter Codes; VPN Blocking |

## Product tour

1. Start at `/` to read the product account and cast a real Vote in the live
   Demo.
2. Browse open Listed Polls at `/discover`, or sign in at `/sign-in` and create
   one at `/creator/new`.
3. Manage created Polls from `/creator` and their creator detail pages.
4. Open the published canonical `/{reference}` link as a signed-out Voter,
   choose an option, optionally attach a Comment and display name when the
   Creator enabled them, and submit.
5. Follow the same Poll to `/{reference}/results`; its visibility policy decides
   whether the Tally is live, opens after close, or remains creator-only. The
   complete newest-first Comment list follows every visible Tally. Owners can
   remove an individual Comment there; the Administrator uses the separate
   exact-reference `/creator/moderation` surface. The canonical URL and Share
   action stay visible wherever sharing is lawful.

Provider callbacks and operator-only endpoints are intentionally outside this
primary evaluator path.

## Architecture

The authoritative [Architecture Spine](_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md)
contains the complete decisions and capability map. The evaluator-sized map is:

- One Astro Worker is a hexagonal modular monolith: routes are inbound
  adapters, capability modules own policy, and Cloudflare/auth integrations are
  outbound adapters (AD-1).
- Browser journeys begin as server-rendered functional HTML, with isolated
  progressive enhancement only where interaction needs it (AD-2).
- D1 owns facts, each fact has one legal owner/write path, and projections do
  not become competing truth (AD-6, AD-19).
- Vote acceptance is one constrained transaction, including an optional typed
  Comment contribution; duplicate identities become secret-keyed, Poll-scoped
  digests rather than stored raw identifiers (AD-7, AD-8, AD-19).
- Results authorizes before coherently projecting a Tally and its complete
  Comment list; Voting-owned owner/administrator commands delete only a
  Comment and advance the shared representation version atomically (AD-19,
  AD-21, AD-24).
- Local, staging, and production share code but never state, and production is
  promoted only after the staging gate (AD-14).
- Telemetry remains voter-blind, and result authorization happens before any
  projection or caching decision (AD-15, AD-21).

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Cloudflare Workers (`nodejs_compat`) |
| Framework | Astro 7 (SSR via `@astrojs/cloudflare`) |
| Database | Cloudflare D1 (forward-only SQL migrations) |
| Object storage | Cloudflare R2 (configured media infrastructure; Image Polls planned) |
| Auth | Better Auth + Google/GitHub OAuth |
| Abuse floor | Cloudflare Workers Rate Limiting (30 vote submissions/source IP/Poll/minute; shared IPs share the budget) |
| Tests | Vitest (unit + workerd integration) · Playwright e2e |
| Package manager | pnpm 11.17.0 · Node 24.18.0 |

Binding truth lives in `wrangler.jsonc`. Secrets never do.

## Environments

| Env | Worker name | D1 | R2 | Vote rate-limit namespace |
| --- | --- | --- | --- | --- |
| local | `oddspark-polls-local` (`wrangler dev`) | local D1 | local R2 | local-only |
| staging | `oddspark-polls-staging` | `oddspark-polls-staging` | `oddspark-polls-staging` | staging-only |
| production | `oddspark-polls` | `oddspark-polls` | `oddspark-polls` | production-only |

The `VOTE_RATE_LIMITER` binding is configured independently in every
environment. It keys on the connecting source IP (`cf-connecting-ip`) per
edge location, so CGNAT networks and offices share one budget, and the
platform limiter is only eventually consistent. It is a permissive abuse
throttle, not an exactly-once boundary; D1 vote constraints remain
authoritative.

### OAuth applications and secrets

Authentication uses six separate provider registrations: one Google OAuth
client and one GitHub OAuth App for each environment. Keeping them separate
prevents a local or staging callback from sharing production credentials.

| Environment | Base URL | Google authorized redirect URI | GitHub callback URL |
| --- | --- | --- | --- |
| local | `http://localhost:4321` | `http://localhost:4321/api/auth/callback/google` | `http://localhost:4321/api/auth/callback/github` |
| staging | `https://oddspark-polls-staging.hearnsystems.workers.dev` | `https://oddspark-polls-staging.hearnsystems.workers.dev/api/auth/callback/google` | `https://oddspark-polls-staging.hearnsystems.workers.dev/api/auth/callback/github` |
| production | `https://oddspark-polls.hearnsystems.workers.dev` | `https://oddspark-polls.hearnsystems.workers.dev/api/auth/callback/google` | `https://oddspark-polls.hearnsystems.workers.dev/api/auth/callback/github` |

Create registrations named `Oddspark Polls — Local`, `Oddspark Polls — Staging`,
and `Oddspark Polls — Production` in each provider. Set each application's
homepage/origin to the matching base URL and its callback to the exact URI
above. Do not add the future custom domain until it is actually bound.

Every environment requires ten runtime values: eight secret-backed bindings
plus two public vars.

Secrets (declared in `secrets.required` in `wrangler.jsonc` — binding/type/deploy
truth; not inferred from `.dev.vars` key order):

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `TURNSTILE_SECRET_KEY`
- `VOTE_DIGEST_SECRET`

Public var (per environment in `wrangler.jsonc` `vars`):

- `TURNSTILE_SITE_KEY` — local/CI uses Cloudflare's official always-pass test
  site key; staging and production use distinct real widgets registered for
  `oddspark-polls-staging.hearnsystems.workers.dev` and
  `oddspark-polls.hearnsystems.workers.dev` respectively (add `polls.oddspark.dev`
  to the production widget before the custom-domain switch).
- `DEMO_POLL_REFERENCE` — the lower-case Custom Link for the exact live Demo
  Poll rendered on `/`. It is public designation, not a credential, and named
  environment vars do not inherit it from the root Wrangler config.

Initialize local auth and voting privacy once with the masked provisioning
helper. It generates independent Better Auth and vote-digest master secrets,
writes the official always-pass Turnstile dummy secret for local/CI,
accepts provider credentials through hidden prompts, and never places them in
command arguments or shell history:

```zsh
./scripts/provision-auth-secrets.zsh local initialize
```

For a local checkout initialized before Story 1.5, add only the missing vote
digest secret without replacing auth or provider credentials:

```zsh
./scripts/provision-auth-secrets.zsh local initialize-voting
./scripts/provision-auth-secrets.zsh local initialize-turnstile
```

Cloudflare secret writes are upserts, not create-only operations, so the helper
intentionally refuses remote master-secret initialization. Bootstrap
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `VOTE_DIGEST_SECRET`, and
`TURNSTILE_SECRET_KEY` once in each
target Worker's dashboard, verifying the environment before saving. Generate
each secret with `openssl rand -base64 32` — this is the one secret humans
type by hand. Then
provision or rotate only the Google and GitHub credentials with:

```zsh
./scripts/provision-auth-secrets.zsh local rotate-providers
./scripts/provision-auth-secrets.zsh staging rotate-providers
./scripts/provision-auth-secrets.zsh production rotate-providers

# Provider-issued Turnstile secret only (stdin or hidden prompt). Staging and
# production refuse Cloudflare's documented dummy secrets.
./scripts/provision-auth-secrets.zsh staging rotate-turnstile
./scripts/provision-auth-secrets.zsh production rotate-turnstile
```

Local provisioning atomically replaces only the ignored `.dev.vars` file using
a mode-`600` temporary file on the same filesystem. Remote provider
provisioning sends dotenv over stdin to one `wrangler secret bulk` request, so
each operation creates one Worker version rather than one per secret.
Cloudflare preserves secrets omitted from a bulk update, so provider rotation
never replaces `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, or
`VOTE_DIGEST_SECRET`. Wrangler disk logs and metrics are disabled for this
operation. Never paste a credential into chat, a command argument,
`wrangler.jsonc`, CI logs, or Git. If `.dev.vars` lists any managed key more
than once, the helper refuses to run in every mode — wrangler applies the
last occurrence of a duplicated key, so remove the duplicates by hand and
re-run.

Rotating `BETTER_AUTH_SECRET` is intentionally outside this helper because it
invalidates active sessions and makes previously encrypted OAuth access and
refresh tokens unreadable. Treat any such rotation as a planned incident with
session cleanup and provider reauthentication.

Rotating `VOTE_DIGEST_SECRET` is also outside the helper: duplicate-vote claim
digests are keyed on it, so a replacement resets duplicate-vote protection
outright — every prior claim becomes incomparable and a browser can vote
again. Treat rotation as a planned integrity incident in the same class as
`BETTER_AUTH_SECRET` rotation, never a routine step.

Verify remote names without returning their values:

```zsh
WRANGLER_WRITE_LOGS=false WRANGLER_SEND_METRICS=false \
  pnpm exec wrangler secret list --env staging --format json
```

`wrangler secret bulk` creates and deploys a Worker version immediately. After
provisioning, deploy the tested application build and validate both provider
round-trips before promoting.

## Local development

```bash
# Prerequisites: Node 24.18.0 (see .nvmrc), pnpm 11.17.0
nvm use
corepack enable
pnpm install

# Initialize ignored local runtime values through masked prompts. Never put
# credentials in command arguments, repository files, or chat.
./scripts/provision-auth-secrets.zsh local initialize

# Apply local D1 migrations
pnpm migrate:local

# Dev server
pnpm dev

# Focused and full tests
pnpm test:unit
pnpm test
pnpm test:e2e          # Playwright starts its own dev server

# Build flavors
pnpm build             # local-flavored artifact
pnpm build:production  # shipping production-flavored artifact
```

## Local verification gate

Run the same test/build sequence as the repository gate, in this exact order,
then perform the final worktree whitespace check used for story handoff:

```bash
pnpm migrations:guard
pnpm test
pnpm check
pnpm test:e2e
pnpm types
git diff --exit-code worker-configuration.d.ts
pnpm build:production
git diff --check
```

`pnpm types` regenerates the binding declaration from `wrangler.jsonc`; the
following diff check proves the committed declaration is current. The final
`git diff --check` is a local handoff check and is not a separate GitHub Actions
job.

## Release and deploy gate (AR-3)

Order is fixed:

1. Tests + build
2. Privacy-safe, read-only staging Demo Poll preflight
3. Staging migration
4. Staging deploy
5. Staging smoke (HTTP 200 + token marker, exact configured Demo, auth, and
   `/api/health` binding-liveness probes)
6. Privacy-safe, read-only production Demo Poll preflight
7. Production migration
8. Production deploy
9. Production smoke with the same exact Demo and liveness assertions

GitHub Actions owns this sequence in `.github/workflows/deploy.yml`. Remote
preflight, migrations, deploys, and smoke checks require environment authority
and are outside ordinary local verification; do not run them as a substitute
for the local gate or without release authorization.

The smoke check ends with `/api/health`, an unauthenticated binding-liveness
probe: it returns 200 when every required binding is present (including
`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and `DEMO_POLL_REFERENCE`) and
names the missing bindings (never their values) otherwise. The Demo preflight
returns only `ready`/`not_ready`; it never prints Poll, option, owner, or
credential identifiers and never mutates D1.

**Turnstile privacy note:** Siteverify deliberately omits optional `remoteip` so
raw client addresses never leave the request-bound identity preparation already
constrained by IP Checks. The browser still makes a direct third-party request
to Cloudflare's Turnstile iframe when CAPTCHA is on for that Poll; CAPTCHA-off
polls load no widget and make no Turnstile client request.
The landing Demo is CAPTCHA-on, so its Poll, options, and live Tally remain
readable without JavaScript but a Vote cannot be accepted without a
Turnstile-capable client and successful Siteverify proof.

### Live URLs (product landing page)

| Environment | URL |
| --- | --- |
| Staging | https://oddspark-polls-staging.hearnsystems.workers.dev |
| Production | https://oddspark-polls.hearnsystems.workers.dev |

Custom domain `polls.oddspark.dev` is wired later.

## Migrations

- Files: `db/migrations/NNNN_description.sql` (forward-only)
- Checksums: `db/migrations.manifest.json` (CI rejects edits to historical files)
- Guard: `pnpm migrations:guard`
- Refresh checksums after adding a new migration: `pnpm migrations:checksum`

## Administration

The single Administrator role is assigned out of band with the Better Auth
internal user ID. There is no in-product role-grant surface. Follow the
[administration runbook](docs/administration.md) for the guarded, environment-by-environment
assignment, transfer, revocation, verification, and recovery procedure.

## Design system

Tokens come from DESIGN.md and live in `src/styles/tokens.css`. Mode is OS preference by default; a progressive-enhancement toggle persists light/dark in `localStorage`. Courier Prime + Newsreader are self-hosted under `public/fonts/`.

## Recovery

D1 Time Travel is the database recovery floor. After any restore, reconcile R2 from D1 ownership records. See [docs/recovery.md](docs/recovery.md).

The configured Demo is provisioned through the authenticated product, never
from a public request or deploy script. If it is deleted, permanently closed,
has unrepairable security drift, or has moderation history that forbids reset,
create another exact Poll at a new Custom Link, review and change
`DEMO_POLL_REFERENCE` separately for staging and production, then require the
environment's read-only preflight and post-deploy smoke to pass. Manage the
former Poll through the ordinary Creator/Administrator lifecycle. Do not put
credentials, cookies, OAuth identity, internal IDs, or capability URLs in the
runbook, configuration, CI output, or commit history.

## Project layout

- `src/pages` — inbound HTTP adapters and server-rendered routes
- `src/middleware.ts` — request context, telemetry, session, CSRF, and creator guard chain
- `src/components` — token-bound server-rendered UI
- `src/scripts` — isolated progressive enhancement
- `src/lib` — delivery composition and cross-route helpers
- `src/layouts` / `src/styles` — document shells and design-token expression
- `src/modules/*` — provider-free capability policy and application seams
- `src/shared/*` — provider-free domain values and application contracts shared across capabilities
- `src/adapters/*` — D1, cache, auth, digest, Turnstile, rate-limit, and telemetry adapters
- `db/migrations` — forward-only D1 SQL
- `tests/{unit,integration,e2e}` — Node, workerd, and browser proof

## License / demonstration

Built in public as a demonstration of the BMad Method implementation path. Do not commit secrets, OAuth client secrets, or personal data.
