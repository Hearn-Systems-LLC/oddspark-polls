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

### Secrets

```bash
# Per environment (staging / production)
pnpm wrangler secret put SOME_SECRET --env staging
pnpm wrangler secret put SOME_SECRET --env production

# Local: copy and edit
cp .dev.vars.example .dev.vars
```

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
