---
baseline_commit: 13fa2f57809c210978d6872ce7f241410f913ddb
---

# Story 1.2: Creator Sign-In with Google or GitHub

Status: done

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

- [x] Task 1: Better Auth adapter — per-request factory on D1 (AC: #2)
  - [x] Install `better-auth@1.6.25` (exact pin). Implement `src/adapters/auth/` as a `createAuth(env)` factory — env bindings are NOT available at Workers module top level; get env via `context.locals.runtime.env` (Astro Cloudflare adapter). Memoize per-isolate if desired
  - [x] Config: `database: env.DB` (direct D1 binding — Better Auth ≥1.5 auto-detects D1 via its built-in Kysely dialect; no extra packages, no ORM), `secret: env.BETTER_AUTH_SECRET`, `baseURL` per environment (missing baseURL ⇒ redirect_uri_mismatch), `trustedOrigins` for the env's origin, `socialProviders: { google: {clientId, clientSecret}, github: {clientId, clientSecret} }`; email/password stays absent (disabled by default)
  - [x] Map every Better Auth model/field to snake_case via explicit `fields` mapping per model (`user`, `session`, `account`, `verification` — e.g. `emailVerified: "email_verified"`, `createdAt: "created_at"`); do NOT rely on a `casing` option (unverified in 1.6.25) or Kysely CamelCasePlugin (unsupported)
  - [x] Mount the handler at the existing pass-through path: `src/pages/api/auth/[...all].ts` with `export const ALL: APIRoute = (ctx) => createAuth(...).handler(ctx.request)` — `BETTER_AUTH_MOUNT_PATH` is already `/api/auth` in `src/lib/csrf.ts`
- [x] Task 2: Auth schema migration (AC: #2)
  - [x] Add `db/migrations/0002_identity_auth.sql`: snake_case `user`, `session`, `account`, `verification` tables matching the field mapping (user: id/name/email unique/email_verified/image/created_at/updated_at; session: id/expires_at/token unique/ip_address/user_agent/user_id FK cascade/created_at/updated_at; account: id/account_id/provider_id/user_id FK/token+expiry columns/scope/password unused/created_at/updated_at; verification: id/identifier/value/expires_at/created_at/updated_at); UTC Unix ms INTEGER for all timestamps per Consistency Conventions; internal user id = UUID string
  - [x] Generate the reference SQL with `npx @better-auth/cli generate` against the real config (so mappings apply), then hand-shape to project conventions; CLI runs in Node without bindings — config must tolerate absent env at CLI time (stub DB)
  - [x] Regenerate `db/migrations.manifest.json` via `scripts/migrations-checksum.mjs` (the guard from 1.1 rejects unlisted migrations); apply local → staging → production
- [x] Task 3: Session extraction in middleware + CSRF token wiring (AC: #2, #4, #5)
  - [x] Extend `src/middleware.ts` (single chain, AD-22): after request context, resolve `createAuth(env).api.getSession({ headers: context.request.headers })`; populate `context.locals` session principal (internal user id, session) — `src/lib/request-context.ts` grows a nullable principal; spine: middleware does "session extraction and request context only"
  - [x] Wire the 1.1 stub into reality: session-bound CSRF token (derive/store per session; `X-CSRF-Token` header / `csrf_token` form field names already fixed by `createSessionCsrfTokenStub`), required on authenticated creator/admin form POSTs — `checkCsrf`'s `requireSessionToken` branch already exists; replace the stub issuance with real issuance
  - [x] Creator-surface guard: unauthenticated or expired-session requests to `/creator*` routes → 303 redirect to `/sign-in?return={path}` with the Voice line context (expired ⇒ "You've been signed out.")
  - [x] Return-address validation (AC #4 exact rule): accept only same-origin relative paths — must start with single `/`, reject `//`, `\`, absolute URLs, schemes; violations fall back to `/creator`. Pure function in `src/modules/identity/` or `src/lib/`, unit-tested against open-redirect payloads
- [x] Task 4: `/sign-in` page + no-JS server-posted sign-in (AC: #1, #3)
  - [x] `src/pages/sign-in.astro`: centered single column; `heading-lg` line; two full-width `button-secondary` submit buttons `CONTINUE WITH GOOGLE` / `CONTINUE WITH GITHUB` stacked `spacing.3` (12px) apart; `caption`/`dim` note that voting never needs an account; no vendor logos or brand colors; reuse the existing `button-secondary.astro` primitive — never restyle
  - [x] Each button is a plain HTML `<form method="post">` to our own endpoint (guaranteed no-JS path — form-urlencoded direct to Better Auth's `/sign-in/social` is NOT verified for 1.6.25): endpoint calls `auth.api.signInSocial({ body: { provider, callbackURL, errorCallbackURL, disableRedirect: true }, headers })` and issues the redirect itself (303 to the provider URL)
  - [x] `callbackURL` = validated return address (default `/creator`); `errorCallbackURL` = `/sign-in` variant that renders the denial Voice line
  - [x] Carry `return` through the round-trip (hidden form field → callbackURL); re-validate server-side at every hop
- [x] Task 5: Outcome renders per the post-submit contract (AC: #2, #3, #5)
  - [x] Signed-in return, denial, and expiry renders: outcome line is `tabindex="-1"`, first content in the main landmark, focused on load; document `<title>` leads with outcome — exact strings `Signed in — Oddspark Polls`, `That didn't sign you in — Oddspark Polls`
  - [x] Voice catalog verbatim: denial "That didn't sign you in. Nothing was created, and nothing was lost — the create form is right where you left it."; expiry "You've been signed out. Sign back in to pick up where you left off."; copy is layout-neutral, no exclamation marks
  - [x] Minimal guarded `/creator` landing target (placeholder page proving the guard + post-sign-in return; the real dashboard is Story 1.11 — do not build lists/counts)
- [x] Task 6: Per-environment OAuth apps + secrets + README (AC: #6)
  - [x] Document in README: six OAuth apps (Google + GitHub × local/staging/production), authorized redirect URIs exactly `{baseURL}/api/auth/callback/google` and `{baseURL}/api/auth/callback/github` per environment (staging/production Worker URLs from 1.1; local `http://localhost:4321`)
  - [x] Secrets per environment via `wrangler secret put` (staging/production) and `.dev.vars` (local): `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — names already reserved in `.dev.vars.example`; add `BETTER_AUTH_URL` (or set baseURL from env config); never in `wrangler.jsonc` vars
  - [x] Provision the real apps and store secrets for local + staging at minimum (de-risk rule #3 demands a real round-trip on staging); production before story-done
- [x] Task 7: Tests — the de-risk gate (AC: #2, #3, #4, #5)
  - [x] Unit: return-address validator (payloads: `https://evil.example`, `//evil.example`, `/\evil`, `javascript:`, empty, valid `/creator/new`); CSRF session-token branch with real issuance
  - [x] Integration (workerd pool): guard redirects signed-out `/creator` request to `/sign-in?return=/creator`; session extraction populates principal; auth tables accept Better Auth writes (adapter contract against local D1)
  - [x] E2E (Playwright): sign-in page renders both buttons and caption without JS errors; guard redirect round-trip. Full OAuth e2e against real providers is manual — record the staging validation (both providers) in Dev Agent Record instead of automating consent screens
  - [x] Manual validation (blocking, de-risk rule #3): complete Google and GitHub round-trips on local workerd AND staging; verify D1 rows (internal UUID user id; account row maps provider pair; session row) and cookie `__Secure-better-auth.session_token` on staging

### Review Findings

- [x] [Review][Patch] Cross-provider same-email sign-in dead-ends on a misleading denial — account linking unconfigured (`trustedProviders` defaults to `[]`), so a second provider with the same email errors "account not linked" into the denial page whose copy claims nothing exists. Decision (Justin, 2026-07-29): enable account linking with `trustedProviders: ["google", "github"]` so same-email providers auto-link to the existing internal user [src/adapters/auth/index.ts]
- [x] [Review][Patch] HIGH: Unguarded session middleware — `createAuth(workerEnv).api.getSession()` has no try/catch; a D1 error or missing auth binding 500s every route (including public pages) for any request carrying a session cookie, instead of degrading to signed-out [src/middleware.ts:115-118]
- [x] [Review][Patch] Stale session-refresh cookies are appended after Better Auth's own response on every `/api/auth/*` path except the exact string `/api/auth/sign-out` — a session-mutating endpoint (current or future) can have its just-deleted cookie restored by the pre-handler `getSession` refresh header [src/middleware.ts:137-144]
- [x] [Review][Patch] Uncaught non-APIError exceptions inside the Better Auth handler (D1 failure during callback insert, UNIQUE violation) escape as raw 500s mid-OAuth; `onAPIError.errorURL` only covers Better Auth `APIError` [src/pages/api/auth/[...all].ts:8]
- [x] [Review][Patch] `user.email UNIQUE` is case-sensitive in SQLite and Better Auth does not normalize email casing — provider email-casing drift creates duplicate user rows for the same mailbox; fix needs a new migration (`COLLATE NOCASE`) since 0002 is applied in all three environments [db/migrations/0002_identity_auth.sql:9]
- [x] [Review][Patch] Smoke gate has no auth-liveness assertion — `requireBinding` throws at request time, so a staging deploy missing any of the six auth bindings passes `scripts/smoke.mjs` green while every auth/session request 500s [scripts/smoke.mjs]
- [x] [Review][Patch] No length cap on the `return` field — `z.string().optional()` and `validateReturnAddress` accept any length; an oversized value is embedded in the OAuth state cookie, browsers silently drop >4KB cookies, and the callback fails state-mismatch into a denial loop [src/pages/api/sign-in.ts:9, src/modules/identity/index.ts:32-53]
- [x] [Review][Patch] Any-method request to `/api/auth/sign-out` is treated as a completed sign-out — a GET (Better Auth 404s) still suppresses refresh cookies and deletes the `oddspark.creator_session_seen` marker while the session is alive [src/middleware.ts:137,146-151]
- [x] [Review][Patch] Unescaped dots in the marker-cookie regex — `oddspark.creator_session_seen` is interpolated into a `RegExp` without escaping, so `oddsparkXcreator_session_seen=1` also matches [src/middleware.ts:42-44]
- [x] [Review][Patch] Dead `provider-button` class on both sign-in buttons — no stylesheet defines it; full-width relies implicitly on grid-item stretch [src/pages/sign-in.astro:40,48]
- [x] [Review][Defer] `.astro` files lost all static type coverage — `check` is `tsc --noEmit`, which skips `.astro`; restore `astro check` when `@astrojs/check` supports the pinned TS stack [package.json:22] — deferred, in ledger
- [x] [Review][Defer] Rate limiting effectively absent on auth endpoints — Better Auth's limiter defaults to per-isolate memory storage with enablement derived from `NODE_ENV`, which the esbuild deploy bundle does not define; SESSION KV not wired as `secondaryStorage`. Rate limiting is explicitly not bound to this story by the spine's capability map — deferred, out of scope
- [x] [Review][Defer] Duplicate `createAuth()` + per-request D1 `getSession` on every cookie-bearing request including `/api/auth/*` (auth-handler traffic does the lookup twice) — perf/cost tuning for later stories [src/middleware.ts:115, src/pages/api/auth/[...all].ts:8] — deferred
- [x] [Review][Defer] `readRequestCsrfToken` buffers entire multipart/urlencoded bodies in middleware to read one field; cost lands when Epic 6 image uploads grow [src/lib/csrf.ts:194-213] — deferred, in ledger
- [x] [Review][Defer] Playwright e2e (sign-in flow) not in any CI gate; deploy gate runs unit+integration only — deferred, in ledger
- [x] [Review][Defer] CSRF body transport only readable for urlencoded/multipart — a no-JS `text/plain` form with a valid token 403s; no current consumers [src/lib/csrf.ts:200-206] — deferred
- [x] [Review][Defer] Provisioning `.dev.vars` parser accepts values the runtime rejects (inline `#` comments, whitespace-trimmed secrets) and does not validate `BETTER_AUTH_URL` format at provisioning time [scripts/provision-auth-secrets.zsh:66-91] — deferred
- [x] [Review][Defer] Remote provisioning can hang indefinitely on wrangler's browser OAuth login — no timeout, TTY check, or auth preflight [scripts/provision-auth-secrets.zsh:149,196] — deferred
- [x] [Review][Defer] `/admin*` counts as a CSRF authenticated-mutation surface but has no auth guard (unauthenticated requests 404) — admin capability is Epic 3, no admin routes exist [src/middleware.ts:168-169] — deferred, in ledger

### Review Findings — Round 2 (review of the round-1 patches)

- [x] [Review][Patch] HIGH: The round-1 `[...all].ts` try/catch never fired for in-endpoint errors — better-call's router converts non-APIError endpoint throws into bare 500s unless `onAPIError.throw: true` is set (verified in `better-call/dist/router.mjs`, `better-auth/dist/api/index.mjs`). Fixed by setting `throw: true`; the catch now also returns JSON for non-navigation methods instead of a redirect into an HTML page [src/adapters/auth/index.ts, src/pages/api/auth/[...all].ts]
- [x] [Review][Patch] The 512-char `return` cap counted UTF-16 code units of the raw input, but the value embedded in the OAuth state cookie is the URL-normalized form — percent-encoding inflates multibyte input up to ~9x, defeating the cap. Cap now enforced on both raw and normalized forms, solely inside `validateReturnAddress` (the zod `.max()` was removed to avoid a divergent 422 path) [src/modules/identity/index.ts, src/pages/api/sign-in.ts]
- [x] [Review][Patch] Session-lookup failure double-emitted telemetry (own record + outer record with contradictory `ok` result) and left `sessionExpired` untouched — a D1 hiccup during a valid session rendered the misleading "You've been signed out" expiry line, and during a sign-out POST skipped marker expiry. Lookup failure now sets `sessionLookupFailed`, the outer telemetry record marks it `error` (one record per request), and the flow continues through the normal post-handler path [src/middleware.ts, src/lib/request-context.ts]
- [x] [Review][Patch] Duplicated denial-URL literals (`[...all].ts` fallback vs adapter `errorURL`) could drift — extracted `SIGN_IN_DENIED_PATH` into the identity module, shared by both [src/modules/identity/index.ts]
- [x] [Review][Patch] Migration 0003's comment claimed "Better Auth does not normalize email casing" — false; 1.6.25 lowercases provider emails on lookup and create (verified `better-auth/dist/oauth2/link-account.mjs:11,74,101`). The NOCASE unique index is kept as defense-in-depth with a corrected comment and a pre-apply dedup note [db/migrations/0003_user_email_case_insensitive.sql]
- [x] [Review][Patch] Smoke auth-liveness URL dropped any path prefix from `SMOKE_URL` (absolute-path `new URL`), and its comment overstated coverage — `/api/auth/ok` exercises config construction but never touches D1. URL now joined relatively; comment corrected [scripts/smoke.mjs]
- [x] [Review][Defer] Signed-in users are bounced to `/sign-in` during transient D1 errors, indistinguishable from being signed out (retrying OAuth then 502s until D1 recovers) — accepted degradation; distinct from the misleading-expiry case which IS fixed [src/middleware.ts] — deferred
- [x] [Review][Defer] Session-lookup failure during a sign-out POST that later succeeds leaves the creator marker stale (spurious "You've been signed out" on a later visit) — self-heals on next authenticated response [src/middleware.ts] — deferred
- [x] [Review][Defer] GitHub `/user/emails` outage stores `email_verified=false`, and the `requireLocalEmailVerified` gate then blocks a later same-email Google sign-in with the misleading "not linked" denial — narrow residual of the account-linking patch [src/adapters/auth/index.ts] — deferred
- [x] [Review][Defer] No gate verifies migration 0003 is applied to staging/production before the code deploys — failure mode is latent (the index is preventive) [db/migrations/0003, scripts/deploy.mjs] — deferred
- Round-2 dismissed: migration 0003 hard-fails on pre-existing case-variant duplicate emails (unreachable — Better Auth lowercases all OAuth writes, so such rows cannot exist); NOCASE index vs lowercased lookup permanent-denial interplay (same premise — the mixed-case row it requires cannot be created); smoke auth-liveness not touching D1 (converted to a comment fix; full D1 liveness would need an authenticated probe); zod/validator 422-vs-fallback divergence (resolved by removing the zod `.max`, folded into the length-cap patch).

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

OpenAI GPT-5

### Debug Log References

- Astro 7.1.5 / `@astrojs/cloudflare` 14.1.6 has removed `context.locals.runtime.env`; the supported binding source is `env` from `cloudflare:workers`. Task 1 uses that source while preserving a per-request `createAuth(env)` factory.
- Better Auth 1.6.25 does not default to UUID IDs. `advanced.database.generateId: "uuid"` enforces the story's internal provider-independent UUID contract.
- Better Auth 1.6.25's built-in direct-D1 adapter serializes dates as ISO-8601 strings and only hydrates string values as `Date`; declaring these fields `INTEGER` would store ISO strings under INTEGER affinity and fail to hydrate actual integers. Justin approved the explicit auth-table compatibility exception on 2026-07-29: migration 0002 uses `TEXT` for auth-only date fields; domain timestamps remain UTC Unix-ms INTEGER.
- The v1.6.25 CLI package is `auth` (the documented replacement for deprecated `@better-auth/cli`). Reference schema generated successfully with `pnpm dlx auth@1.6.25 generate --config scripts/better-auth-schema.ts`.
- Migration 0002 applied successfully to local, staging, and production D1 after Justin's explicit approval on 2026-07-29.
- Better Auth 1.6.25 names its signed OAuth state cookie `better-auth.state` (`__Secure-better-auth.state` on HTTPS). The no-JavaScript wrapper forwards that `Set-Cookie` header into its own 303 response.
- Task 6 provider inventory found no existing Hearn Systems GitHub OAuth Apps, no Google OAuth clients in Google Cloud project `hearn-systems`, and no staging or production Worker secrets. The Google Auth Platform brand currently reads `Hearn Systems | Cloudflare`, is External/Testing, and has no test users; provider creation remains an explicit external-action checkpoint.
- The adversarial security pass enabled Better Auth OAuth-token encryption, revalidated return paths after URL normalization, routed state failures to the product denial outcome, added nested creator return coverage, wrapped session lookup in operation telemetry, and changed CSRF comparison to a timing-resistant byte comparison.
- A non-sensitive, HttpOnly creator-session marker now survives the seven-day Better Auth cookie long enough to distinguish natural browser expiry. It is cleared after reporting expiry and on sign-out; empty auth cookies no longer trigger D1 session resolution, and sign-out never appends session-refresh cookies after Better Auth's deletion response.
- Justin approved all provider registrations and secret provisioning on 2026-07-29. The Google consent brand is now `Oddspark Polls`, remains External/Testing, includes `j.d.hearn@gmail.com` as a test user, and has local/staging/production Web clients. Three organization-owned GitHub OAuth Apps also exist; GitHub's passkey/mobile confirmation and direct credential entry remain the human-only security checkpoint.
- Local, staging, and production credential provisioning completed through masked human-only prompts. Local `.dev.vars` is ignored and mode `600`; remote verification returned exactly the six expected secret names and types without values. No credential value entered conversation, command arguments, tool output, repository history, or Wrangler disk logs.
- Better Auth 1.6.25 encrypts stored OAuth access/refresh tokens but not provider ID tokens. Account create/update database hooks now force `id_token` to `NULL`; a real workerd D1 adapter test covers both operations. The provisioning helper initializes local auth only, refuses non-create-only remote master-secret writes, atomically replaces local `.dev.vars` on the destination filesystem, and rotates only provider bindings after validating existing master material.
- Cloudflare Workers SDK issue #14922 caused WAF 403 responses for the original monolithic upload. The deploy helper now emits a minified split ESM graph with `no_bundle`; staging version `679f0385-d520-47ca-a141-7daf727e37b0` deployed successfully as 37 modules. Public smoke, the nested creator guard, and unsafe-return fallback all passed. Production application code was not deployed.
- Manual OAuth validation completed on 2026-07-29 for Google and GitHub on both local workerd and staging. Each environment ended with two UUID-shaped internal users, one account mapping per provider, two mapped sessions, zero orphaned rows, and zero stored ID tokens. Justin visually confirmed the staging `__Secure-better-auth.session_token` cookie was both Secure and HttpOnly without exposing its value. The local daemon was then stopped and its generated `.astro/dev.log` deleted.

### Completion Notes List

- Task 1: pinned Better Auth 1.6.25, added the direct-D1 provider-only factory with exhaustive snake_case mappings, validated required environment config, and mounted the catch-all handler at `/api/auth/*`.
- Task 1 validation: 3 focused auth unit tests, full 18-test Vitest suite, TypeScript, and Astro/Cloudflare production build all pass on Node 24.18.0.
- Task 2: generated and hand-shaped the four-table D1 schema, added provider/account uniqueness and cascade constraints, refreshed the checksum manifest, applied migration 0002 to local/staging/production, and added 3 workerd D1 schema tests.
- Task 2 validation: full 21-test Vitest suite, TypeScript, migration checksum guard, and all three D1 migration targets pass on Node 24.18.0.
- Task 3: added provider-neutral Better Auth session extraction, nullable request principals, deterministic session-bound CSRF issuance and enforcement, exact creator-route guarding, expired-session context, and strict same-origin return-address validation.
- Task 3 validation: 24 focused unit tests, 5 focused workerd integration tests, and the full 46-test Vitest suite pass on Node 24.18.0.
- Task 4: added the centered token-bound `/sign-in` surface and a Zod-validated server POST wrapper that creates Better Auth OAuth state, forwards the state cookie, preserves only validated return paths, and redirects to Google or GitHub without JavaScript.
- Task 4 validation: 13 focused identity unit tests, 3 focused workerd endpoint tests, the full 51-test Vitest suite, TypeScript, and the Astro/Cloudflare production build pass on Node 24.18.0.
- Task 5: added safe signed-in outcome markers, exact denial/expiry outcome policy, first-in-main focus management, outcome-leading titles, and a minimal guarded `/creator` landing page.
- Task 5 validation: 17 focused identity unit tests, 4 sign-in Playwright scenarios (7 total E2E tests), the full 55-test Vitest suite, TypeScript, and the Astro/Cloudflare production build pass on Node 24.18.0.
- Task 6 documentation: added the exact six-registration callback matrix, environment-separated naming guidance, masked Wrangler provisioning commands, secret-list verification, and a complete local `.dev.vars` template.
- Task 7 automated validation: 74 Vitest unit/workerd integration tests, 8 Playwright scenarios, TypeScript, migration checksum guard, script syntax checks, and the Astro/Cloudflare staging build pass. Coverage includes real Better Auth provider-account adapter writes with `id_token` forced to `NULL`, provider denial with zero auth rows, missing-state fallback, both CSRF token transports, nested creator returns, no-JavaScript POST initiation, JavaScript runtime errors, natural session expiry, sign-out cookie handling, and provisioning safety edges.
- Credential handling: added a masked helper that initializes local auth only, writes `.dev.vars` atomically as ignored mode `600`, refuses remote master-secret initialization, and sends provider-only remote rotations to Wrangler as one stdin bulk update while preserving existing master and URL bindings. Wrangler disk logging and metrics remain disabled for these operations.
- Task 6: registered all six provider applications, configured exact per-environment callbacks, and securely provisioned all six bindings in local, staging, and production.
- Task 7 manual validation: completed real Google and GitHub OAuth round-trips on local workerd and staging; verified UUID-shaped provider-independent users, provider mappings, mapped sessions, zero persisted ID tokens, correct post-sign-in outcomes, and staging Secure/HttpOnly session-cookie flags using aggregate-only D1 queries.
- Deployment validation: deployed the corrected split-module application to staging as version `679f0385-d520-47ca-a141-7daf727e37b0`; public smoke, exact nested creator redirect, unsafe-return fallback, and both live provider callbacks passed. No production application deployment was performed.
- Final adversarial security review: GO after closing plaintext ID-token persistence, master-secret rotation, same-filesystem atomic replacement, effective dotenv binding validation, return-address scope, CSRF, cookie, telemetry, and deployment-graph findings.

### Implementation Plan

1. Implement each story task in order with focused RED/GREEN tests, preserving the single middleware chain and provider-independent identity boundary.
2. Use Better Auth's exact 1.6.25 D1/API behavior; record any version-specific deviation from the story research in Debug Log References.
3. Run the full unit + workerd integration suite after each task, then finish with Playwright, build, migration guard, and manual OAuth/deployment gates.

### File List

- `_bmad-output/implementation-artifacts/1-2-creator-sign-in-with-google-or-github.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `.dev.vars.example`
- `.gitignore`
- `README.md`
- `package.json`
- `pnpm-lock.yaml`
- `db/migrations/0002_identity_auth.sql`
- `db/migrations.manifest.json`
- `scripts/better-auth-schema.ts`
- `scripts/deploy.mjs`
- `scripts/provision-auth-secrets.zsh`
- `src/adapters/auth/index.ts`
- `src/adapters/telemetry/index.ts`
- `src/components/creator-placeholder.astro`
- `src/env.d.ts`
- `src/lib/csrf.ts`
- `src/lib/request-context.ts`
- `src/middleware.ts`
- `src/modules/identity/index.ts`
- `src/pages/api/auth/[...all].ts`
- `src/pages/api/sign-in.ts`
- `src/pages/creator/[...path].astro`
- `src/pages/creator/index.astro`
- `src/pages/sign-in.astro`
- `tests/e2e/sign-in.spec.ts`
- `tests/integration/auth-middleware.integration.test.ts`
- `tests/integration/auth-schema.integration.test.ts`
- `tests/integration/csrf.integration.test.ts`
- `tests/integration/sign-in-endpoint.integration.test.ts`
- `tests/unit/auth.test.ts`
- `tests/unit/csrf.test.ts`
- `tests/unit/identity.test.ts`
- `tests/unit/provision-auth-secrets.test.mjs`
- `tests/unit/telemetry.test.ts`
- `tsconfig.json`
- `vitest.integration.config.ts`
- `vitest.unit.config.ts`

### Change Log

- 2026-07-29: Implemented Story 1.2 creator OAuth sign-in, completed all six provider registrations and environment bindings, deployed and validated staging, closed adversarial security findings, and passed the full automated plus local/staging manual de-risk gate.
- 2026-07-29: Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor): 1 decision (cross-provider account linking — enabled with `trustedProviders: ["google", "github"]`), 10 patches applied and checked off above (session-lookup failure degradation, `/api/auth/*` cookie-append isolation, auth-handler 303 fallback, case-insensitive email uniqueness via migration 0003, smoke auth-liveness check, return-address length cap, POST-only sign-out detection, escaped marker regex, dead class removal), 9 findings deferred to `deferred-work.md`, 4 dismissed. Validation: 76 Vitest tests, `tsc --noEmit`, migration guard, and production build all pass. Migration 0003 requires application to staging and production D1.
- 2026-07-29: Code review round 2 (re-review of the round-1 patches by the same three layers): the round-1 `[...all].ts` catch was verified dead for in-endpoint errors — fixed with `onAPIError.throw: true`; the 512-char return cap was verified bypassable via multibyte percent-encoding inflation — cap moved onto the normalized form; session-lookup failure no longer double-emits telemetry or risks the misleading expiry line; denial-URL literal deduplicated into `SIGN_IN_DENIED_PATH`; migration 0003 comment premise corrected (Better Auth 1.6.25 does lowercase OAuth emails — index kept as defense-in-depth); smoke auth-liveness URL and comment fixed. 4 findings deferred, 4 dismissed (two HIGHs from Edge Case Hunter collapsed after verifying Better Auth lowercases all OAuth email writes). 6 new regression tests (session-lookup degradation, mount-path cookie suppression + refresh fixture, auth-handler fallback GET/POST, multibyte return cap, throw config). Validation: 82 Vitest tests, `tsc --noEmit`, migration guard, and production build all pass.
- 2026-07-29: Migration 0003 applied to staging and production D1 (wrangler confirmed ✅ per environment; `user_email_nocase_unique_idx` verified present in `sqlite_master` on both). All three environments now run identical schema.
