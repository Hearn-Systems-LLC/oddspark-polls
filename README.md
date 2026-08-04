# oddspark-polls

Trustworthy casual polls at [polls.oddspark.dev](https://polls.oddspark.dev) — multiple-choice, ranked, image, and meeting polls with vote security and no subscription wall.

This is a **public demonstration build**: the product is real, the repo is presentable, and nothing secret belongs in history.

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Cloudflare Workers (`nodejs_compat`) |
| Framework | Astro 7 (SSR via `@astrojs/cloudflare`) |
| Database | Cloudflare D1 (forward-only SQL migrations) |
| Object storage | Cloudflare R2 (poll images; later stories) |
| Auth | Better Auth + Google/GitHub OAuth (Story 1.2) |
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

Every environment requires nine runtime values: eight secret-backed bindings
plus one public Turnstile site-key var.

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

# Apply local D1 migrations
pnpm migrate:local

# Dev server
pnpm dev

# Tests
pnpm test              # unit + integration
pnpm test:e2e          # Playwright (starts dev server)

# Production build
pnpm build
```

## Deploy gate (AR-3)

Order is fixed:

1. Tests + build
2. Staging migration
3. Staging deploy
4. Staging smoke (HTTP 200 + token marker in HTML + auth and `/api/health` binding-liveness probes)
5. Production migration
6. Production deploy

GitHub Actions: `.github/workflows/deploy.yml`.

Manual:

```bash
pnpm test && pnpm build
pnpm migrate:staging && pnpm deploy:staging
SMOKE_URL=https://oddspark-polls-staging.hearnsystems.workers.dev pnpm smoke:staging
pnpm migrate:production && pnpm deploy:production
```

The smoke check ends with `/api/health`, an unauthenticated binding-liveness
probe: it returns 200 when every required binding is present (including
`TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`) and names the missing bindings
(never their values) otherwise.

**Turnstile privacy note:** Siteverify deliberately omits optional `remoteip` so
raw client addresses never leave the request-bound identity preparation already
constrained by IP Checks. The browser still makes a direct third-party request
to Cloudflare's Turnstile iframe when CAPTCHA is on for that Poll; CAPTCHA-off
polls load no widget and make no Turnstile client request.

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

## Project layout

Hexagonal structural seed:

- `src/pages` — inbound HTTP / SSR pages
- `src/middleware.ts` — request context, CSRF boundary, telemetry
- `src/components` — token-bound UI primitives
- `src/modules/*` — domain modules (identity, polls, voting, …)
- `src/adapters/*` — outbound adapters (d1, r2, telemetry, …)
- `db/migrations` — D1 SQL
- `tests/{unit,integration,e2e}`

## License / demonstration

Built in public as a demonstration of the BMad Method implementation path. Do not commit secrets, OAuth client secrets, or personal data.
