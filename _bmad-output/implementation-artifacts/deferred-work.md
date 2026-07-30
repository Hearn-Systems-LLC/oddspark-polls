# Deferred Work

## Deferred from: code review of 1-1-project-foundation-deployable-skeleton (2026-07-29)

- Playwright e2e not in CI gate — spec gate requires unit+integration only; add when the e2e suite grows.
- Overlay primitive never demonstrated (rendered `open={false}`) — accepted deviation: overlay exists token-bound and opens in later stories; AD-2 forbids the client JS an open demo would need.
- Mode-toggle label goes stale on OS theme change — no `matchMedia("prefers-color-scheme")` change listener [src/scripts/mode-override.ts:52-69].
- `…Light` exception tokens `availability-yes-glyph-light` / `solar-ink-on-wash-light` defined but unconsumed — canonical DESIGN.md tokens consumed by Epic 7 availability-cell [src/styles/tokens.css:41,48-50].
- Structural Seed deviation — `src/lib/`, `src/layouts/`, `src/styles/` not in the seed tree; update ARCHITECTURE-SPINE seed to match the real layout.
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

## Deferred from: code review of 1-3-create-a-multiple-choice-poll (2026-07-29)

- Public poll page does a per-request D1 read with no caching decision — every bot scan and link preview of `/{anything}` hits `findPollByReference`; the page sets no `cache-control` (AD-21 governs creator surfaces only). Deferred: caching the public surface is a product/perf decision outside Story 1.3's ACs [src/pages/[reference].astro].

## Deferred from: code review round 2 of 1-3-create-a-multiple-choice-poll (2026-07-29)

- Owner can get "This Poll doesn't exist" on their own poll if it has zero canonical `poll_reference` rows — the 0005 partial unique index enforces at-most-one canonical, not exactly-one; `findPollForOwner`'s inner join then yields null → 404. Deferred: latent corrupt-state handling, relevant when Story 1.4 starts writing custom references [src/adapters/d1/index.ts:123-132].

## Deferred from: code review round 3 of 1-3-create-a-multiple-choice-poll (2026-07-29)

- `poll_reference.is_canonical INTEGER NOT NULL DEFAULT 1` is the wrong default for a multi-reference table — a Story 1.4 custom-link insert that omits `is_canonical` defaults to 1 and explodes on the 0005 partial unique index. Deferred: SQLite can't ALTER a column default (needs a table rebuild); Story 1.4 must set `is_canonical` explicitly on every insert — call this out in its story spec [db/migrations/0004_polls.sql:43-50].

## Deferred from: code review round 4 of 1-3-create-a-multiple-choice-poll (2026-07-29)

- Every creator POST pays a double full-body parse — `readRequestCsrfToken` parses a cloned body in middleware and the page parses again; a large crafted multipart is fully materialized twice with no size cap anywhere in the chain. Deferred: request-size policy is a platform decision above this story (the mechanism predates 1.3; `/creator/new` is just the first route to exercise it) [src/lib/csrf.ts:194-213, src/pages/creator/new.astro].

## Deferred from: code review round 6 of 1-3-create-a-multiple-choice-poll (2026-07-30)

- The reachable sign-in redirect has no `cache-control` — `creatorGuardMiddleware` 303s every unauthenticated `/creator/*` request bare; the page-level defense-in-depth redirects patched in review round 5 are dead code by comparison. Deferred: pre-existing middleware behavior from Story 1.2; fix belongs to the middleware layer, not this story's diff [src/middleware.ts:237-242].
- The 10s idle-restore can re-enable PUBLISH while a legitimately slow POST is still in flight — a second click stacks two navigations; the nonce dedupe keeps the database safe (exactly the D4 case), but the UI outcome is whichever response wins. Deferred: accepted residual; a request-aware restore is a larger client redesign [src/scripts/create-poll-form.ts].

## Deferred from: code review round 2 of 1-2-creator-sign-in-with-google-or-github (2026-07-29)

- Signed-in users are bounced to `/sign-in` during transient D1 errors, indistinguishable from being signed out — retrying OAuth then returns 502 until D1 recovers. Accepted degradation of the session-lookup failure path; a distinct "transient error" outcome would need new UX copy [src/middleware.ts].
- Session-lookup failure during a sign-out POST that later succeeds leaves the `oddspark.creator_session_seen` marker stale — a later anonymous `/creator` visit can show a spurious "You've been signed out". Self-heals on the next authenticated response [src/middleware.ts].
- GitHub `/user/emails` outage during sign-in stores `email_verified=false`; the `requireLocalEmailVerified` gate then blocks a later same-email Google sign-in from linking, landing on the misleading denial — narrow residual of the account-linking patch [src/adapters/auth/index.ts].
- No gate verifies migration 0003 (`user_email_nocase_unique_idx`) is applied to staging/production D1 before the code deploys; the failure mode is latent because the index is preventive [db/migrations/0003_user_email_case_insensitive.sql, scripts/deploy.mjs].

## Deferred from: code review of 1-4-custom-links (2026-07-30)

- Taken-collision detection substring-matches D1 driver error text (`/UNIQUE constraint failed: poll_reference\.reference/`) — if remote D1 ever phrases batch constraint errors differently, a taken Custom Link degrades from the designed 422 field error to a generic 500. Deferred: D1 exposes no structured error code, message text is the only signal; same accepted pattern as `DuplicatePollIdError` from Story 1.3 [src/adapters/d1/index.ts:131-138].
- `poll_reference.kind` has no CHECK constraint and `canonicalReferenceKind` is an unchecked cast — an out-of-union value (manual SQL, future writer, botched migration) makes `matchesExistingPoll` classify every idempotent retry of that poll as divergent, silently turning retries into "That Poll already published" errors. Deferred: schema shipped in Story 1.3; Story 1.4's no-new-migration constraint forbids the fix here [db/migrations/0004_polls.sql, src/adapters/d1/index.ts:166-170].
- Migration 0004's comment permanently describes the superseded "add a custom slug alongside the generated one" design — the shipped design is substitution (custom slug is the only reference row). Deferred: migrations are immutable by policy (AD-14); the supersession is recorded in Story 1.4's decisions table instead [db/migrations/0004_polls.sql:40-41].

## Deferred from: code review round 2 of 1-4-custom-links (2026-07-30)

- A case-mangled *generated* reference whose lowercase fold collides with a registered custom slug redirects to the wrong poll instead of 404ing. Deferred: inherent to the ratified case-insensitive custom-link design; collision needs a 128-bit random fold to equal a chosen slug (~2⁻⁷⁷ per pair), and the all-lowercase short-circuit plus canonical guards bound the reachable surface [src/pages/[reference].astro, src/adapters/d1/index.ts].
- Canonical-resolution composition (exact lookup → case-folded fallback → 301) lives in the `[reference].astro` frontmatter — arguably FR-28 domain policy inside an inbound adapter (AD-1). Deferred: the composition is two adapter calls and a branch; the case-fold rule itself is encoded in the port method and its test; extracting a domain function would add a port for one conditional [src/pages/[reference].astro].
- CI retry converts a partial e2e failure into a guaranteed one — a retry after the 303 publish re-submits the same slug and dies on "taken" because `cleanupCreator` runs in `afterAll`, not `afterEach`. Deferred, pre-existing: harness design predates this round and applies to the whole authed file [tests/e2e/create-poll-authed.spec.mjs, tests/e2e/creator-session.mjs].
- The 301/404 case-variant contract is covered only by the authed e2e, which `test.skip`s when `BETTER_AUTH_SECRET` isn't provisioned locally. Deferred: the deploy gate provisions the secret, so CI coverage is unconditional; a signed-out seed-based test is a nice-to-have [tests/e2e/create-poll-authed.spec.mjs].

## Deferred from: code review round 3 of 1-4-custom-links (2026-07-30)

- A mixed-case request to an orphan reference row (poll deleted out-of-band, bypassing the FK cascade) 301s into a 404 instead of 404ing directly — the exact lookup misses and no reachability re-check runs before the 301. Deferred: corrupt-state-only reachability (D1 enforces the cascade), the redirect chain terminates at the designed 404, and a reachability re-check would tax every legitimate case-variant hit [src/pages/[reference].astro].
