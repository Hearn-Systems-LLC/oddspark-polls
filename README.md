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
| Tests | Vitest (unit + workerd integration) · Playwright e2e |
| Package manager | pnpm 11.17.0 · Node 24.18.0 |

Binding truth lives in `wrangler.jsonc`. Secrets never do.

## Environments

| Env | Worker name | D1 | R2 |
| --- | --- | --- | --- |
| local | `oddspark-polls-local` (`wrangler dev`) | local D1 | local R2 |
| staging | `oddspark-polls-staging` | `oddspark-polls-staging` | `oddspark-polls-staging` |
| production | `oddspark-polls` | `oddspark-polls` | `oddspark-polls` |

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

Every environment requires all six bindings:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

Initialize local auth once with the masked provisioning helper. It generates an
independent Better Auth master secret, accepts provider credentials through
hidden prompts, and never places them in command arguments or shell history:

```zsh
./scripts/provision-auth-secrets.zsh local initialize
```

Cloudflare secret writes are upserts, not create-only operations, so the helper
intentionally refuses remote master-secret initialization. Bootstrap
`BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` once in each target Worker's
dashboard, verifying the environment before saving. Then provision or rotate
only the Google and GitHub credentials with:

```zsh
./scripts/provision-auth-secrets.zsh local rotate-providers
./scripts/provision-auth-secrets.zsh staging rotate-providers
./scripts/provision-auth-secrets.zsh production rotate-providers
```

Local provisioning atomically replaces only the ignored `.dev.vars` file using
a mode-`600` temporary file on the same filesystem. Remote provider
provisioning sends dotenv over stdin to one `wrangler secret bulk` request, so
each operation creates one Worker version rather than one per secret.
Cloudflare preserves secrets omitted from a bulk update, so provider rotation
never replaces `BETTER_AUTH_SECRET` or `BETTER_AUTH_URL`. Wrangler disk logs and
metrics are disabled for this operation. Never paste a credential into chat, a
command argument, `wrangler.jsonc`, CI logs, or Git.

Rotating `BETTER_AUTH_SECRET` is intentionally outside this helper because it
invalidates active sessions and makes previously encrypted OAuth access and
refresh tokens unreadable. Treat any such rotation as a planned incident with
session cleanup and provider reauthentication.

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
4. Staging smoke (HTTP 200 + token marker in HTML)
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

### Live URLs (foundation placeholder)

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
