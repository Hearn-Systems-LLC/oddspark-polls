# Story 1.2: Creator Sign-In with Google or GitHub

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a prospective Creator,
I want to sign in with Google or GitHub in seconds,
so that I can create and manage my own Polls without a new account or password.

## Acceptance Criteria

1. **Given** a signed-out visitor at `/sign-in`, **When** the page renders, **Then** it shows two full-width, text-labelled `button-secondary` choices — `CONTINUE WITH GOOGLE` and `CONTINUE WITH GITHUB` — each a server-posted action that works without JavaScript, with no vendor logos or brand colors, and a caption noting that voting never needs an account (UX-DR10).
2. **Given** a visitor completes the OAuth round-trip successfully (validated on workerd, local and staging — de-risk rule #3), **When** they return to the app, **Then** Better Auth has created a session in D1 and an internal, provider-independent user ID, **And** the OAuth `(provider, provider_account_id)` pair maps to that internal ID and is never used as an ownership key (AD-4), **And** the outcome render follows the post-submit contract: outcome line first in the main landmark, `tabindex="-1"`, focused on load, document `<title>` leading with the outcome (UX-DR17).
3. **Given** a visitor cancels or is denied at the provider, **When** they return, **Then** they land at the sign-in entry with "That didn't sign you in. Nothing was created, and nothing was lost." and no account or session exists.
4. **Given** an unauthenticated request to any creator-surface route, **When** it is received, **Then** it is denied with a redirect to `/sign-in` carrying a return address, and after sign-in the Creator lands back where they started (FR-1), **And** the return address is validated as a same-origin relative path — never an absolute URL or scheme; a violating value falls back to `/creator` (no open redirect through the auth flow).
5. **Given** a Creator whose session has expired, **When** they act on a creator route, **Then** they are redirected to sign-in with "You've been signed out." and returned to their prior location after re-auth.
6. **Given** the OAuth apps this story depends on, **When** environments are provisioned, **Then** per-environment Google and GitHub app setup (redirect URIs, client IDs, secrets stored as Worker secrets) is documented in the README as part of this story — six apps across three environments is real work that must not block silently.

## Tasks / Subtasks

- [ ] Task 1: Better Auth adapter — per-request factory on D1 (AC: #2)
  - [ ] Install `better-auth@1.6.25` (exact pin). Implement `src/adapters/auth/` as a `createAuth(env)` factory — env bindings are NOT available at Workers module top level; get env via `context.locals.runtime.env` (Astro Cloudflare adapter). Memoize per-isolate if desired
  - [ ] Config: `database: env.DB` (direct D1 binding — Better Auth ≥1.5 auto-detects D1 via its built-in Kysely dialect; no extra packages, no ORM), `secret: env.BETTER_AUTH_SECRET`, `baseURL` per environment (missing baseURL ⇒ redirect_uri_mismatch), `trustedOrigins` for the env's origin, `socialProviders: { google: {clientId, clientSecret}, github: {clientId, clientSecret} }`; email/password stays absent (disabled by default)
  - [ ] Map every Better Auth model/field to snake_case via explicit `fields` mapping per model (`user`, `session`, `account`, `verification` — e.g. `emailVerified: "email_verified"`, `createdAt: "created_at"`); do NOT rely on a `casing` option (unverified in 1.6.25) or Kysely CamelCasePlugin (unsupported)
  - [ ] Mount the handler at the existing pass-through path: `src/pages/api/auth/[...all].ts` with `export const ALL: APIRoute = (ctx) => createAuth(...).handler(ctx.request)` — `BETTER_AUTH_MOUNT_PATH` is already `/api/auth` in `src/lib/csrf.ts`
- [ ] Task 2: Auth schema migration (AC: #2)
  - [ ] Add `db/migrations/0002_identity_auth.sql`: snake_case `user`, `session`, `account`, `verification` tables matching the field mapping (user: id/name/email unique/email_verified/image/created_at/updated_at; session: id/expires_at/token unique/ip_address/user_agent/user_id FK cascade/created_at/updated_at; account: id/account_id/provider_id/user_id FK/token+expiry columns/scope/password unused/created_at/updated_at; verification: id/identifier/value/expires_at/created_at/updated_at); UTC Unix ms INTEGER for all timestamps per Consistency Conventions; internal user id = UUID string
  - [ ] Generate the reference SQL with `npx @better-auth/cli generate` against the real config (so mappings apply), then hand-shape to project conventions; CLI runs in Node without bindings — config must tolerate absent env at CLI time (stub DB)
  - [ ] Regenerate `db/migrations.manifest.json` via `scripts/migrations-checksum.mjs` (the guard from 1.1 rejects unlisted migrations); apply local → staging → production
- [ ] Task 3: Session extraction in middleware + CSRF token wiring (AC: #2, #4, #5)
  - [ ] Extend `src/middleware.ts` (single chain, AD-22): after request context, resolve `createAuth(env).api.getSession({ headers: context.request.headers })`; populate `context.locals` session principal (internal user id, session) — `src/lib/request-context.ts` grows a nullable principal; spine: middleware does "session extraction and request context only"
  - [ ] Wire the 1.1 stub into reality: session-bound CSRF token (derive/store per session; `X-CSRF-Token` header / `csrf_token` form field names already fixed by `createSessionCsrfTokenStub`), required on authenticated creator/admin form POSTs — `checkCsrf`'s `requireSessionToken` branch already exists; replace the stub issuance with real issuance
  - [ ] Creator-surface guard: unauthenticated or expired-session requests to `/creator*` routes → 303 redirect to `/sign-in?return={path}` with the Voice line context (expired ⇒ "You've been signed out.")
  - [ ] Return-address validation (AC #4 exact rule): accept only same-origin relative paths — must start with single `/`, reject `//`, `\`, absolute URLs, schemes; violations fall back to `/creator`. Pure function in `src/modules/identity/` or `src/lib/`, unit-tested against open-redirect payloads
- [ ] Task 4: `/sign-in` page + no-JS server-posted sign-in (AC: #1, #3)
  - [ ] `src/pages/sign-in.astro`: centered single column; `heading-lg` line; two full-width `button-secondary` submit buttons `CONTINUE WITH GOOGLE` / `CONTINUE WITH GITHUB` stacked `spacing.3` (12px) apart; `caption`/`dim` note that voting never needs an account; no vendor logos or brand colors; reuse the existing `button-secondary.astro` primitive — never restyle
  - [ ] Each button is a plain HTML `<form method="post">` to our own endpoint (guaranteed no-JS path — form-urlencoded direct to Better Auth's `/sign-in/social` is NOT verified for 1.6.25): endpoint calls `auth.api.signInSocial({ body: { provider, callbackURL, errorCallbackURL, disableRedirect: true }, headers })` and issues the redirect itself (303 to the provider URL)
  - [ ] `callbackURL` = validated return address (default `/creator`); `errorCallbackURL` = `/sign-in` variant that renders the denial Voice line
  - [ ] Carry `return` through the round-trip (hidden form field → callbackURL); re-validate server-side at every hop
- [ ] Task 5: Outcome renders per the post-submit contract (AC: #2, #3, #5)
  - [ ] Signed-in return, denial, and expiry renders: outcome line is `tabindex="-1"`, first content in the main landmark, focused on load; document `<title>` leads with outcome — exact strings `Signed in — Oddspark Polls`, `That didn't sign you in — Oddspark Polls`
  - [ ] Voice catalog verbatim: denial "That didn't sign you in. Nothing was created, and nothing was lost — the create form is right where you left it."; expiry "You've been signed out. Sign back in to pick up where you left off."; copy is layout-neutral, no exclamation marks
  - [ ] Minimal guarded `/creator` landing target (placeholder page proving the guard + post-sign-in return; the real dashboard is Story 1.11 — do not build lists/counts)
- [ ] Task 6: Per-environment OAuth apps + secrets + README (AC: #6)
  - [ ] Document in README: six OAuth apps (Google + GitHub × local/staging/production), authorized redirect URIs exactly `{baseURL}/api/auth/callback/google` and `{baseURL}/api/auth/callback/github` per environment (staging/production Worker URLs from 1.1; local `http://localhost:4321`)
  - [ ] Secrets per environment via `wrangler secret put` (staging/production) and `.dev.vars` (local): `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — names already reserved in `.dev.vars.example`; add `BETTER_AUTH_URL` (or set baseURL from env config); never in `wrangler.jsonc` vars
  - [ ] Provision the real apps and store secrets for local + staging at minimum (de-risk rule #3 demands a real round-trip on staging); production before story-done
- [ ] Task 7: Tests — the de-risk gate (AC: #2, #3, #4, #5)
  - [ ] Unit: return-address validator (payloads: `https://evil.example`, `//evil.example`, `/\evil`, `javascript:`, empty, valid `/creator/new`); CSRF session-token branch with real issuance
  - [ ] Integration (workerd pool): guard redirects signed-out `/creator` request to `/sign-in?return=/creator`; session extraction populates principal; auth tables accept Better Auth writes (adapter contract against local D1)
  - [ ] E2E (Playwright): sign-in page renders both buttons and caption without JS errors; guard redirect round-trip. Full OAuth e2e against real providers is manual — record the staging validation (both providers) in Dev Agent Record instead of automating consent screens
  - [ ] Manual validation (blocking, de-risk rule #3): complete Google and GitHub round-trips on local workerd AND staging; verify D1 rows (internal UUID user id; account row maps provider pair; session row) and cookie `__Secure-better-auth.session_token` on staging

## Dev Notes

### Why this story is the de-risk gate

Epic 1 rule #3: "Better Auth on workerd (full OAuth round-trip, local + staging) is validated in the earliest foundation stories, before any surface that assumes it." Every later creator story assumes this session principal. Do not mark done on unit tests alone — the manual round-trip on staging is the actual gate. [Source: epics.md#Epic 1 line 157]

### AD-4 — identity contract (verbatim rule)

"Better Auth owns creator identity and sessions in D1, initially with Google and GitHub OAuth. Every creator command addresses a Poll by both Poll ID and an internal, provider-independent creator user ID. OAuth `(provider, provider_account_id)` pairs map to that user and are never stored as Poll ownership keys. Administrative moderation is a separate role capability. Voters remain anonymous." [Source: ARCHITECTURE-SPINE.md#AD-4]

- Identity module owns users/accounts/sessions; the only legal write path is "Better Auth adapter behind Identity commands" — capability code never touches auth tables directly. [Source: ARCHITECTURE-SPINE.md#AD-19]
- Authorization convention: "Authentication populates a session principal; application commands enforce resource ownership or explicit admin capability. Route hiding is never authorization." Admin role schema is NOT specified — do not invent an admin column/table this story; moderation capability arrives with Epic 3. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions]
- Rate limiting sign-in attempts (NFR-7) is NOT bound to this story by the spine's capability map (FR-1 ⇒ AD-1, AD-4, AD-14 only); the rate-limit adapter stays a stub.

### Better Auth 1.6.25 on Workers — verified specifics (researched 2026-07-29)

- **Per-request construction:** `betterAuth()` needs env bindings; build via `createAuth(env)` factory. In Astro Cloudflare, env is `context.locals.runtime.env`. Middleware `getSession` and the mounted handler must use the same construction path (`src/adapters/auth/`).
- **D1 without ORM:** `database: env.DB` — auto-detected, uses bundled Kysely + D1 dialect. No `kysely-d1`, no drizzle. Lightest option; matches "no ORM chosen" project state.
- **snake_case:** only reliable v1.6 mechanism is explicit per-model `fields` mapping in config (all camelCase fields of user/session/account/verification). CLI `generate` must read the real config to emit snake_case SQL.
- **No-JS sign-in:** direct form-urlencoded POST to `/api/auth/sign-in/social` is unverified for 1.6.25 — wrap in our own POST endpoint calling `auth.api.signInSocial(...{ disableRedirect: true })`, then 303 to the returned provider `url`. This also keeps the sign-in form under OUR middleware (session CSRF not required — visitor has no session yet; same-origin check still applies).
- **Callback paths:** `{baseURL}/api/auth/callback/{google|github}` — register per environment.
- **Cookies:** session cookie `better-auth.session_token` (HTTPS ⇒ `__Secure-` prefix). Session defaults: 7-day expiry, rolling refresh after 1 day (`session.expiresIn`/`updateAge` to change; defaults are fine).
- **Sign-out:** `POST /api/auth/sign-out` exists; a sign-out control is specified NOWHERE in UX — do not build a sign-out UI this story (gap noted for later; the endpoint comes free with the handler).
- **nodejs_compat:** required (Buffer etc.) — already enabled in `wrangler.jsonc` from 1.1.
- Better Auth's mounted handler keeps its own CSRF/OAuth-state protections (AD-22); the `/api/auth` pass-through in `checkCsrf` is the only middleware bypass and is already scoped.

### Existing code this story modifies (read these before coding)

| File | Current state | This story |
| --- | --- | --- |
| `src/middleware.ts` | `sequence(requestContext, csrf, telemetry)`; comment "Session extraction lands with Story 1.2" | Insert session extraction after request context; keep CSRF before handlers; preserve telemetry envelope |
| `src/lib/csrf.ts` | `BETTER_AUTH_MOUNT_PATH="/api/auth"`; `checkCsrf` with working origin/Fetch-Metadata logic, pass-through, and `requireSessionToken` branch; `createSessionCsrfTokenStub` fixes names `X-CSRF-Token`/`csrf_token` | Replace stub with real session-bound issuance; do NOT change the check logic or the fixed names |
| `src/lib/request-context.ts` | `{ requestId, startedAtMs }` | Add nullable session principal (internal user id + session); keep type exported |
| `src/adapters/auth/index.ts` | Placeholder `export {}` | `createAuth(env)` factory + config |
| `src/modules/identity/index.ts` | Placeholder `export {}` | Creator principal type + return-address validation policy (provider-free — no Astro/Better Auth imports in module code per AD-1) |
| `.dev.vars.example` | Secret names already listed, commented | Uncomment/document the five auth vars (+ `BETTER_AUTH_URL` if used) |
| `db/migrations.manifest.json` | Checksums for 0001 | Regenerate after adding 0002 (guard rejects otherwise) |

**Preserve:** cross-origin 403 behavior and its telemetry record; `cf-ray` request-id sourcing; existing tests (`tests/unit/csrf.test.ts`, `tests/integration/csrf.integration.test.ts`) must keep passing — extend, don't rewrite.

### Previous story intelligence (1.1 Dev Agent Record)

- **Deploys:** Astro adapter emits multi-module; use `scripts/deploy.mjs` (esbuild single-module bundle). `CLOUDFLARE_ENV=staging|production` required at build time so env bindings bake correctly. Invalid `CLOUDFLARE_API_TOKEN` in shell — deploys ran OAuth-only via `env -u CLOUDFLARE_API_TOKEN`.
- **Live URLs** (for OAuth redirect URIs): staging `https://oddspark-polls-staging.hearnsystems.workers.dev`, production `https://oddspark-polls.hearnsystems.workers.dev`. Custom domain polls.oddspark.dev not yet bound.
- **Vitest pool-workers 0.19** uses the `cloudflareTest()` plugin (not legacy `defineWorkersConfig`); e2e runs on port 4391 (`reuseExistingServer: false`) to dodge a 4321 collision.
- **Bindings:** D1 `DB`, R2 `MEDIA`, KV `SESSION` (Astro sessions), per-env blocks in `wrangler.jsonc` (`env.staging`, `env.production`).
- **⚠ Uncommitted work:** the entire 1.1 implementation sits uncommitted on `main` (remote `https://github.com/drinkyouroj/oddspark-polls` created, not yet pushed). Commit/push 1.1 before or at the start of this story so 1.2 lands as its own change set — and keep secrets out (AC #6's history rule).
- Story 1.1 is in `review` status — if its code review lands corrections, rebase this story's work on them.

### UX contract (UX-DR10/17/18)

- `sign-in` component tokens: `headingTypography: heading-lg` (Newsreader 24/400/1.25), `providerButton: button-secondary`, `providerGap: spacing.3` (12px), `noteTypography: caption` (Courier Prime 12/400/1.5), `noteColor: dim`. Centered single column at every breakpoint; 68ch measure; zero radius; both color modes via the token system from 1.1 — no new colors, no new components. [Source: DESIGN.md#sign-in]
- Buttons are the product's own `button-secondary` with the provider named in words — no vendor logos, brand colors, or icon rows. In-flight states are label swaps, never spinners (no pending label is defined for sign-in; a plain POST navigation needs none).
- Post-submit contract (OAuth returns included): outcome line `tabindex="-1"`, first in main landmark, focused on load; `<title>` leads with outcome (`Signed in — Oddspark Polls`, `That didn't sign you in — Oddspark Polls`). No toasts. [Source: EXPERIENCE.md#Accessibility Floor]
- The product prompts sign-in BEFORE the create form, not at publish (unsaved form content may not survive a no-JS round trip) — the guard pattern this story builds is what UJ-6 rides on. [Source: EXPERIENCE.md#UJ-6]
- Route facts: `/sign-in` reached from landing create entry, any signed-out creator route, expired sessions; OAuth callback lives under `/api/auth/*`; post-sign-in default destination `/creator`. Both `/sign-in` and `/api/*` are in the reserved-slug set (relevant later, Story 1.4). [Source: EXPERIENCE.md#Information Architecture]

### Conventions that bind this story

- POST → 303 on success; 422 re-render with preserved values on validation failure; Zod at delivery boundaries; provider payloads mapped before entering application code; stable error codes, never provider/SQL detail. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions]
- Telemetry per operation (request ID, operation, stable code, duration, provider outcome) — sign-in operations log provider outcome but NEVER tokens (AD-15). Extend the existing `emitTelemetry` usage; auth flows must not log OAuth tokens or session tokens.
- Time in UTC Unix ms; internal IDs UUID strings; D1 snake_case; TS files kebab-case.
- Cost ceiling AD-18: Better Auth is free/self-hosted; Google/GitHub OAuth apps are free. Nothing new billable.

### Project Structure Notes

- New files: `src/pages/sign-in.astro`, `src/pages/api/auth/[...all].ts`, our sign-in POST endpoint (e.g. `src/pages/api/sign-in.ts` — any path OUTSIDE `/api/auth` so it passes through our own CSRF middleware, not the pass-through), `src/pages/creator/index.astro` (minimal guarded placeholder), `db/migrations/0002_identity_auth.sql`.
- Guard placement: creator-surface guard can live in the middleware chain (route-prefix check on `/creator`) — spine scopes middleware to "session extraction and request context"; keep the redirect decision thin and the return-address validator in `src/modules/identity/` as testable policy.
- kebab-case filenames throughout; Astro page components may keep starter conventions (`BaseLayout.astro` exists — reuse it).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2] — story statement + 6 ACs
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1] (line 157) — de-risk rule #3, transaction/primitive scope boundaries
- [Source: ARCHITECTURE-SPINE.md#AD-4, #AD-19, #AD-22, #AD-14, #AD-15, #AD-18] — identity, ownership, CSRF, environments, telemetry, cost
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions] — HTTP/validation/errors/authz/time/naming rows
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md#sign-in] — component tokens + prose spec
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md#Voice and Tone, #Accessibility Floor, #Information Architecture, #UJ-6] — copy catalog, post-submit contract, routes, journey
- [Source: _bmad-output/implementation-artifacts/1-1-project-foundation-deployable-skeleton.md#Dev Agent Record] — deploy quirks, live URLs, file inventory
- Better Auth v1.6 docs via context7 (astro.mdx, database.mdx, cookies.mdx, session-management.mdx, options.mdx, security.mdx) + better-auth-cloudflare pattern + issue #1375 (nodejs_compat) — researched 2026-07-29

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
