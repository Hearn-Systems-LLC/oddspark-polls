# Deferred Work

## Deferred from: code review of 1-1-project-foundation-deployable-skeleton (2026-07-29)

- Playwright e2e not in CI gate — spec gate requires unit+integration only; add when the e2e suite grows.
- Overlay primitive never demonstrated (rendered `open={false}`) — accepted deviation: overlay exists token-bound and opens in later stories; AD-2 forbids the client JS an open demo would need.
- Mode-toggle label goes stale on OS theme change — no `matchMedia("prefers-color-scheme")` change listener [src/scripts/mode-override.ts:52-69].
- `…Light` exception tokens `availability-yes-glyph-light` / `solar-ink-on-wash-light` defined but unconsumed — canonical DESIGN.md tokens consumed by Epic 7 availability-cell [src/styles/tokens.css:41,48-50].
- Structural Seed deviation — `src/lib/`, `src/layouts/`, `src/styles/` not in the seed tree; update ARCHITECTURE-SPINE seed to match the real layout.
- poll-option uses a real `<span>` marker instead of decorative `::before` on the row — visually equivalent [src/components/poll-option.astro].
- results-bar `NaN`/`Infinity` percent unhandled — clamp gives false input-safety; latent until live data arrives [src/components/results-bar.astro:23].

## Deferred from: code review round 2 of 1-1-project-foundation-deployable-skeleton (2026-07-29)

- **Story 1.2 WIP scope** (found in the working tree during re-review; belongs to the active 1.2 session): telemetry middleware is innermost, so creator-guard 303s and session-middleware throws emit no record and carry no `x-request-id`; session middleware has no auth-lookup failure path and drops rotated session cookies on error responses; possible duplicate `set-cookie` on `/api/auth/*` responses; `/admin` counts as a CSRF authenticated-mutation surface but is not covered by the creator guard; `readRequestCsrfToken` buffers entire multipart bodies to read one field; session CSRF token compared with `!==` (non-constant-time) [src/middleware.ts, src/lib/csrf.ts].
- `.astro` files have no type coverage — `check` runs `tsc --noEmit`, which skips `.astro`; restore `astro check` when `@astrojs/check` supports the pinned TS 7 stack.
- `parseJsonc` doesn't handle block comments or BOM — wrangler's own JSONC parser accepts `/* */`; a future block comment in `wrangler.jsonc` fails with an opaque error [scripts/deploy.mjs].

## Deferred from: code review of 1-2-creator-sign-in-with-google-or-github (2026-07-29)

- `.astro` files have no static type coverage — `check` runs `tsc --noEmit`, which skips `.astro`; restore `astro check` when `@astrojs/check` supports the pinned TS stack [package.json:22].
- Rate limiting effectively absent on auth endpoints — Better Auth limiter defaults to per-isolate memory storage, enablement derived from `NODE_ENV` (undefined in the esbuild deploy bundle); SESSION KV not wired as `secondaryStorage`. Not bound to Story 1.2 by the spine's capability map [src/pages/api/sign-in.ts, src/adapters/auth/index.ts].
- Duplicate `createAuth()` instantiation and a D1 `getSession` lookup on every cookie-bearing request including `/api/auth/*` — auth-handler traffic performs the session lookup twice; perf/cost tuning for later stories [src/middleware.ts:115, src/pages/api/auth/[...all].ts:8].
- CSRF body transport only readable for `application/x-www-form-urlencoded` and `multipart/form-data` — a no-JS `text/plain` form carrying a valid token is rejected `csrf_token_mismatch`; no current consumers [src/lib/csrf.ts:200-206].
- Provisioning `.dev.vars` parser accepts values the runtime rejects: inline `#` comments pass the non-empty gate, `read -r -s` strips leading/trailing whitespace from pasted secrets, and `BETTER_AUTH_URL` format is not validated at provisioning time [scripts/provision-auth-secrets.zsh:66-91].
- Remote provisioning can hang indefinitely on wrangler's browser OAuth login — no timeout, TTY check, or auth preflight before `wrangler secret bulk` [scripts/provision-auth-secrets.zsh:149,196].

## Deferred from: code review round 2 of 1-2-creator-sign-in-with-google-or-github (2026-07-29)

- Signed-in users are bounced to `/sign-in` during transient D1 errors, indistinguishable from being signed out — retrying OAuth then returns 502 until D1 recovers. Accepted degradation of the session-lookup failure path; a distinct "transient error" outcome would need new UX copy [src/middleware.ts].
- Session-lookup failure during a sign-out POST that later succeeds leaves the `oddspark.creator_session_seen` marker stale — a later anonymous `/creator` visit can show a spurious "You've been signed out". Self-heals on the next authenticated response [src/middleware.ts].
- GitHub `/user/emails` outage during sign-in stores `email_verified=false`; the `requireLocalEmailVerified` gate then blocks a later same-email Google sign-in from linking, landing on the misleading denial — narrow residual of the account-linking patch [src/adapters/auth/index.ts].
- No gate verifies migration 0003 (`user_email_nocase_unique_idx`) is applied to staging/production D1 before the code deploys; the failure mode is latent because the index is preventive [db/migrations/0003_user_email_case_insensitive.sql, scripts/deploy.mjs].
