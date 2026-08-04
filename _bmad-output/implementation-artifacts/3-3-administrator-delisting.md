---
baseline_commit: 2de96922e812a9e2a18028acdb597fb4c1faa609
baseline: origin/main @ 2de96922e812a9e2a18028acdb597fb4c1faa609 (merged Story 3.2)
dependency_story: 3-2-discover-catalog-sitemap
epic: 3 — Public Face: Discovery, Landing & Demo
---

# Story 3.3: Administrator Delisting

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the Administrator,
I want to remove any Poll from the public directory,
So that the directory stays worth browsing without touching anyone's Poll, Votes, or links.

## Acceptance Criteria

Verbatim from `_bmad-output/planning-artifacts/epics.md` § Story 3.3 (lines 743–770):

1. **Given** the Administrator (an application-level role on the internal user, not a separate auth surface), **When** they delist any Poll, **Then** it leaves Discover and the sitemap immediately but remains fully reachable by link, with ownership, Visibility Setting, and Vote data unchanged (FR-23, AD-5).

2. **Given** a Delisted Poll's Creator, **When** they view the Poll detail, **Then** the listing control renders read-only with the `DELISTED` badge and "Delisted by the Administrator. The link still works and Votes still count; the Poll no longer appears on Discover. Only the Administrator can reverse this.", **And** only the Administrator can clear Delisted — the Creator's Unlisted/Listed control stays inert until then.

3. **Given** a Voter opening a Delisted Poll by link, **When** the page renders, **Then** it is indistinguishable from any other Poll — no banner, no notice; moderation is not the Voter's business (UX-DR19).

4. **Given** a non-Administrator Creator, **When** they attempt a delist or clear-delist command, **Then** it is denied server-side — moderation is an explicit capability, never inferred from ownership (NFR-3).

5. **Given** the Administrator capability itself, **When** it is assigned, **Then** assignment is a documented out-of-band operation (seed migration or console update against the internal user ID) — deliberately, no in-product grant surface exists (AD-4).

## Tasks / Subtasks

- [x] Task 1: Provider-neutral Administrator role and out-of-band assignment (AC: #1, #4, #5)
  - [x] ADD forward-only `db/migrations/0011_administrator_moderation.sql`; never edit migrations `0001`–`0010`. Extend Better Auth's internal `user` row with `role TEXT NOT NULL DEFAULT 'creator' CHECK (role IN ('creator', 'administrator'))`, and enforce the product's single-Administrator boundary with a partial unique index that permits at most one `administrator`. Existing and future users must default to `creator` at the database boundary.
  - [x] In the same migration, ADD the private Discovery-owned `moderation_action` fact table. Use `sequence INTEGER PRIMARY KEY AUTOINCREMENT` as the deterministic private order; `poll_id TEXT NOT NULL` with Poll-delete cascade; `actor_user_id TEXT NOT NULL` with the existing user table as a foreign key and default restrictive/`NO ACTION` deletion behavior; `action TEXT NOT NULL CHECK (action IN ('delist', 'clear_delisted'))`; prior/next states with the shared three-value CHECK; and non-negative UTC-millisecond `created_at_ms`. Add a CHECK that permits only `unlisted|listed → delisted` for `delist` and `delisted → unlisted|listed` for `clear_delisted`, plus an index on `(poll_id, sequence DESC)`. Do not decide deferred Creator deletion/anonymization here: moderation actors remain required until that policy is explicitly designed. Run `pnpm migrations:checksum` so `db/migrations.manifest.json` records migration 0011; never rewrite an old checksum.
  - [x] UPDATE `src/adapters/auth/index.ts` to configure Better Auth `user.additionalFields.role` exactly as a server-owned enum: `type: ["creator", "administrator"]`, `required: true`, `defaultValue: "creator"`, `input: false`, and `returned: true`. Do not install or enable Better Auth's admin plugin, access-control system, admin endpoints, or any user-management UI; this product needs one application capability, not a general permissions surface.
  - [x] UPDATE Identity's role/principal contract in `src/modules/identity/index.ts`, `src/middleware.ts`, and Astro locals typing. Parse the returned field through an explicit allowlist and fail closed to non-administrator for missing, malformed, or unknown values. Ownership and role both use Better Auth's opaque internal `user.id`; never inspect email, provider, provider subject, or account rows to infer authority.
  - [x] Role data in the session principal is an early application check, not the final authority. Every D1 moderation write must re-check `user.id = actorUserId AND role = 'administrator'` in the same guarded transaction so role revocation between session resolution and mutation fails closed.
  - [x] ADD `docs/administration.md` and link it from the operator/setup material in `README.md`. Document environment-by-environment assign, verify, transfer/revoke, and recovery steps through the Cloudflare D1 console using only an `<INTERNAL_USER_ID>` placeholder. Require a one-row verification before and after mutation, name local/staging/production databases exactly, warn that email/OAuth IDs are invalid keys, and commit no real user ID or credential. There is no in-product grant route, form, API, seed-by-email, or first-user auto-promotion.
  - [x] Unit/integration tests prove database and Better Auth defaults, the enum/unique constraint, server-owned input behavior, principal parsing, same-user multi-provider neutrality, and fail-closed missing/invalid role handling.

- [x] Task 2: Discovery-owned delist and clear commands with atomic D1 persistence (AC: #1, #4)
  - [x] EXTEND `src/modules/discovery/index.ts` with provider-free Administrator moderation commands and purpose-shaped ports. Routes may parse transport and map Results only; they may not decide role policy, state transitions, restoration state, or cache behavior (AD-1/AD-19).
  - [x] Define two explicit intents, `delist` and `clear_delisted`, plus stable result/error codes. An Administrator may delist any existing Poll whether its Creator state is `listed` or `unlisted`; ownership is irrelevant. Refuse a non-administrator before any target lookup. Treat delisting an already-Delisted Poll as a successful idempotent no-op with no audit row, `updated_at_ms` churn, or revision bump. A clear against a non-Delisted Poll is a stable invalid-transition result and performs no write.
  - [x] On a real delist transition, atomically capture the current Creator-selected `listed | unlisted` state in `moderation_action` and move the Poll to literal `delisted`. On clear, inspect the latest action by `sequence DESC`: when it is the unmatched successful `delist` for the current Delisted cycle, restore that row's captured prior state and append `clear_delisted`. For a pre-0011/externally seeded Delisted row with no usable unmatched action, clear to privacy-safe `unlisted` and record that fallback. Multiple cycles, including actions sharing one timestamp, must restore the choice immediately preceding each cycle.
  - [x] ADD a dedicated moderation persistence factory/port in `src/adapters/d1/index.ts`; do not widen the owner listing repository into a generic arbitrary-state writer. Execute the guarded state mutation and matching audit insertion as bound statements in one D1 `batch()` transaction, with the live role predicate inside the mutation. Derive classification from the ordered batch results and then re-read only purpose-shaped status needed to distinguish missing Poll, revoked role, idempotence, or invalid transition without leaking provider or owner data. A failed statement must roll back both state and action.
  - [x] Preserve Story 3.1's owner-qualified SQL guard: Creator `unlisted ↔ listed` writes must still exclude literal `delisted`, including a race with an Administrator. Serialized outcomes must never let either actor overwrite the other's fact. Once clear commits, ordinary Creator listing control resumes from the restored state.
  - [x] A moderation transition changes only `poll.discovery_state` and `updated_at_ms`, plus its private audit row. It must not change owner, canonical/alias references, lifecycle/Deadline, `result_visibility`, security toggles, options, Votes/selections/claims, Tally data, or `representation_version`. Discovery has its own generation; do not invent another Poll representation bump.
  - [x] Reuse migration 0010's existing `discovery_state` trigger. An actual delist/clear increments `discovery_catalog_revision` atomically; no-op/denied/failed commands do not. Do not call Cache API purge, add route-level invalidation, change the cache namespace, or edit catalog/sitemap query policy.
  - [x] Unit and real-D1 tests cover the full role/state matrix, any-owner behavior, listed and unlisted restoration, legacy fallback, repeated cycles, missing Poll, revocation race, owner/admin write races, atomic rollback, immutable non-Discovery facts, no representation bump, one audit row per actual transition, and one catalog-revision bump per actual transition.

- [x] Task 3: Fixed, authenticated moderation operator surface (AC: #1, #4, #5)
  - [x] ADD one SSR/progressively enhanced route at `src/pages/creator/moderation.astro`. It reuses the existing Better Auth sign-in/session and the already-reserved `/creator` surface; do not create `/admin`, a second login, a new top-level reserved slug, or a dynamic moderation URL. This avoids shadowing a historical Poll reference named `admin` and keeps telemetry operation names free of Poll IDs/references.
  - [x] Signed-out requests follow the existing Creator guard and validated `/sign-in?return=/creator/moderation` flow. A signed-in non-administrator receives a non-cacheable `403` before any Poll lookup or target-existence disclosure. The route and application command still enforce capability independently; hiding a link or page is never authorization.
  - [x] GET renders a compact operator lookup that accepts a Poll's canonical link or reference, resolves aliases to the canonical target, and shows only the minimum moderation context: escaped question, canonical voting link, effective open/closed presentation, and current Discovery state. Parse a pasted URL locally; never fetch it. Accept only a bare reference or a same-origin one-segment Poll URL, enforce the existing reference length/grammar, and reject credentials, fragments, extra path segments, malformed encoding, duplicate/oversized parameters, or an unsupported origin without echoing raw input. Do not build an all-Poll directory, expose owner identity, result visibility, options, Tally shape, Comments, ballots, or moderation history.
  - [x] POST accepts a strict allowlisted form (`intent`, target, `csrf_token`) and is protected by the existing central same-origin/Fetch Metadata plus session-derived CSRF boundary. Render `DELIST` for non-Delisted targets and `CLEAR DELISTED` for Delisted targets as text-labelled keyboard-operable controls with at least 44px targets. Do not add an unnecessary confirmation, icon-only action, toast, spinner, or JavaScript requirement.
  - [x] Follow POST→303→GET with one explicit bounded query contract: GET accepts at most one canonical `target` reference and at most one allowlisted `outcome=delisted|cleared`; initial GET may omit both. POST success canonicalizes the target and redirects to `/creator/moderation?target={encodedCanonicalReference}&outcome={delisted|cleared}`. Reject duplicate, oversized, or malformed query values with safe non-reflective errors. Treat `outcome` as display-only, re-read fresh persisted truth before rendering, and show `Poll delisted.` or `Delisting cleared.` only for the matching allowlisted token; every response remains `private, no-store`.
  - [x] UPDATE request context and telemetry with two explicit rejection flags/results. CSRF middleware sets `csrfRejected` and maps its 403 to existing `csrf_rejected`; the Administrator capability boundary sets `authorizationDenied` and maps its 403 to new stable result `authorization_denied`. Because CSRF runs first, it wins precedence and the capability code never executes on a CSRF rejection; an unflagged 403 must not be guessed as either result. Emit exactly one method-qualified operation, `GET /creator/moderation` or `POST /creator/moderation`. After authorized target resolution, the existing internal `pollId` correlation field may be set; never log the submitted URL/reference/alias, question, owner ID, email, or provider identifier, and never put any target value in `operation` or `error_code`.
  - [x] If a Creator-dashboard entry point is added, render a simple `MODERATION` link only for the Administrator principal and keep the non-administrator page unchanged. The route must remain secure and directly usable if that conditional link is omitted or forged.
  - [x] Route/integration tests cover GET/HEAD/unsupported methods; sign-in return; non-admin denial before lookup; CSRF rejection before command execution; strict malformed/duplicate form and query fields; bounded URL/reference parsing; alias-to-canonical lookup; escaped display; exact canonical POST/303 query outcomes; forged/mismatched display-only outcomes with fresh truth; persistence failures; cache headers; method-qualified operations; `csrf_rejected` versus `authorization_denied` flag precedence; exactly one record; and no sensitive response/log fields.

- [x] Task 4: Creator read-only Delisted treatment (AC: #2, #4)
  - [x] UPDATE `src/pages/creator/polls/[pollId].astro` so a Delisted snapshot renders the existing alarm-colored `DELISTED` badge and one neutral non-form read-only listing row labelled `DELISTED`. Omit enabled radio inputs, listing `<form>`, and Save action entirely. Do not reuse `PollOption`'s current vote-specific read-only announcement (“Your vote”) unchanged; either render dedicated semantic markup or first generalize it without changing voter semantics.
  - [x] Render this exact line once, unabridged and punctuation-exact: `Delisted by the Administrator. The link still works and Votes still count; the Poll no longer appears on Discover. Only the Administrator can reverse this.` Keep it legible in light/dark modes; do not communicate state by color alone or dim the control with opacity.
  - [x] Preserve server-side refusal of forged Creator listing POSTs, including the adapter's race-safe guard. Fix the pre-existing Delisted-error re-read path if necessary so a transient load failure does not replace this policy outcome with misleading not-found copy.
  - [x] Creator-route/source tests prove exact copy, one badge, non-form/inert semantics, no enabled listing input/submit, keyboard/screen-reader clarity, restored ordinary listing control after Administrator clear, forged POST denial, and no regression to other lifecycle/security forms.

- [x] Task 5: Immediate enumeration removal with an unchanged voter experience (AC: #1, #3)
  - [x] Prove rather than reimplement the Story 3.2 substrate: catalog/cache and sitemap queries already include only literal `listed`, migration 0010 revision-qualifies cache generations after actual state changes, and `sitemap.xml` reads D1 with `no-store`. The next successful request after delist must omit the Poll; after clear-to-prior-Listed it may return if effectively open, while clear-to-prior-Unlisted remains absent.
  - [x] Direct canonical and alias links continue resolving. Voting and Results authorization, accepted-Vote transaction semantics, lifecycle/deadline status, Visibility Setting, aggregate/count data, and existing `private, no-store` behavior remain unchanged. A Delisted public page remains `noindex` through the existing Story 3.2 policy.
  - [x] Anonymous public Poll and Results HTML must contain no `DELISTED`, Administrator, moderation, reason, appeal, or admin-control copy. Do not condition voter markup on listing state beyond the existing head indexability rule. No moderation badge or banner appears on the voter surface.
  - [x] Real-D1/route tests snapshot protected facts before and after delist/clear; exercise immediate Discover named-cache generation isolation and next-request sitemap removal/restoration; cast and count a Vote through the direct link while Delisted; and assert voter/result HTML stays moderation-blind.

- [x] Task 6: Documentation, browser proof, and repository gate (AC: all)
  - [x] UPDATE `CHANGELOG.md` under `## [Unreleased]` for the user-observable Administrator delisting/Creator read-only behavior. This story is the architecture spine's scheduled “Detailed listing moderation policy” revisit: UPDATE `ARCHITECTURE-SPINE.md` in the implementation PR to ratify the role, distinct Delisted hold, pre-hold-state restoration/legacy fallback, private ordered moderation actions, and fixed capability boundary, then remove or replace that deferred row. Do not create a parallel decision log.
  - [x] UPDATE `EXPERIENCE.md` in the same implementation PR because `/creator/moderation` is a new governed operator surface. Add it to the Creator/Administrator IA and specify initial lookup, invalid/empty/not-found, target result, success, persistence-error, signed-out, and non-admin 403 states; no-JavaScript floor; canonical-target redirect contract; focus placement after lookup/error/redirect; responsive silhouette; 44px controls; exact action/success/error copy. Keep ordinary Creator and Voter journeys unchanged. Update `DESIGN.md` only if a genuinely new component/token contract is required.
  - [x] ADD a focused Playwright moderation journey using an internal Administrator fixture, never a real user ID: Administrator finds and delists a Listed Poll; Discover row disappears; sitemap omits it; direct link remains visually ordinary and accepts/counts a Vote; Creator detail shows the exact inert treatment; a non-admin cannot forge either command; clear restores the pre-delist listing choice. Also cover a prior-Unlisted Poll.
  - [x] Capture and inspect dark/light evidence at mobile and desktop widths for the operator page and Creator Delisted state, plus the unchanged linked voter surface. Prove 44px action targets, visible keyboard focus, logical focus order, text-carried state, no horizontal overflow, and a clean browser console/network log. Do not ask the user to supply visual proof.
  - [x] Under Node `24.18.0` and pnpm `11.17.0`, run the exact local gate in repository order: `pnpm migrations:guard`, `pnpm test`, `pnpm check`, `pnpm test:e2e`, `pnpm types`, `git diff --exit-code worker-configuration.d.ts`, `pnpm build:production`, and `git diff --check`. Record fresh totals/evidence in this story; historical Story 3.2 totals are not proof.
  - [x] Because the Better Auth user projection changes, validate both Google and GitHub round trips on staging before production promotion when push/deploy authority is separately granted. Dev-story must not push, deploy, mutate a remote D1 role, or include an operator ID merely to complete local implementation.
  - [x] Keep this story's Dev Agent Record, File List, Change Log, and `sprint-status.yaml` current through implementation and review. No `TODO`, skipped/only tests, placeholder branch, or undocumented deferral may remain.

## Dev Notes

### Decisions resolved at story-creation time (binding unless Justin reopens one before dev-story)

| # | Gap | Decision |
|---|---|---|
| D1 | How is Administrator represented without a second auth system or general RBAC? | One server-owned `user.role` enum (`creator | administrator`) on Better Auth's provider-neutral internal user. Database default/check/at-most-one index are authoritative; Better Auth returns it but accepts no role input. Do not add the admin plugin. This enforces the PRD's single site-operator role, not a reusable role system. |
| D2 | What does “clear Delisted” restore? | Restore the Creator's `listed | unlisted` state captured immediately before that delist. This preserves owner intent across an Administrator hold and satisfies the architecture review's two-owner warning. A legacy Delisted row with no history fails privacy-safe to `unlisted`. Never blindly clear to `listed`. |
| D3 | Where does moderation live? | Fixed `/creator/moderation`, with link/reference lookup and no enumeration. It reuses the existing sign-in, Creator guard/return policy, CSRF boundary, reserved top-level slug, and fixed telemetry operation. Do not add `/admin`; that name was historically valid as a Poll reference and reserving it now could break a link. |
| D4 | Is a moderation record required? | Yes. Architecture explicitly models `USER → MODERATION_ACTION → POLL`, Discovery owns the fact, and restoration needs durable prior state. Keep it private/append-only and order it with an internal monotonic sequence; no history UI, reason, appeal, or notification in this story. |
| D5 | Does moderation bump Poll `representation_version` or purge cache? | Neither. Voter/Results representation is intentionally unchanged. Migration 0010 already atomically bumps the separate catalog revision on actual `discovery_state` changes; sitemap is a direct no-store read. |
| D6 | What are retry/invalid-transition semantics? | Repeated delist of a currently Delisted Poll is a success/no-op. Clear requires a currently Delisted Poll; otherwise return a stable invalid transition without writing. Only actual transitions append actions and touch timestamps/revisions. |
| D7 | How is authorization enforced? | Principal role rejects early; the Discovery command re-enforces; guarded D1 SQL checks the live internal user role in the same transaction. Signed-in non-admin surface access returns 403 before target lookup; telemetry distinguishes authorization from CSRF. |
| D8 | The architecture defers “detailed listing moderation policy”; may this story settle it? | Yes: Story 3.3 is the named pre-untrusted-Discovery revisit point. The implementation PR must promote these decisions into `ARCHITECTURE-SPINE.md` and add the new route/states to `EXPERIENCE.md` before the capability ships. If Justin reopens a decision, update those sources and this table together before code proceeds. |

### Architecture and security guardrails

- **AD-1 / AD-19:** Discovery owns listing/moderation policy and commands. Astro is an inbound adapter; D1 is outbound. Neither route nor Better Auth config may mutate `discovery_state` directly.
- **AD-4:** the only actor/owner key is the internal Better Auth user ID. Provider accounts and email are authentication evidence, never authorization or ownership keys.
- **AD-5:** literal `delisted` is a load-bearing state, separate from `unlisted`; Creator SQL cannot overwrite it. Delisting is enumeration policy only and changes no Poll/Vote/result fact.
- **AD-6:** D1 is truth for role, state, and moderation action. Do not trust a role hidden field, query value, client claim, or stale principal as the final write guard.
- **AD-15:** emit one privacy-safe completion record. Do not misclassify capability denial as CSRF, and do not log target references, questions, owner IDs, OAuth data, Vote data, or moderation history.
- **AD-21:** the public discovery allowlist/cache remains separate from authenticated moderation. No admin/owner/role fields may enter catalog DTOs or Cache API values.
- **AD-22:** every state-changing moderation form receives central Origin/Fetch-Metadata enforcement plus the session-bound CSRF token; there is no capability-route bypass.
- **AD-23/AD-24:** reuse shared Discovery state vocabulary; do not redeclare provider DTOs as domain types, and do not increment Poll representation version for listing/moderation.
- **Deferred-policy closure:** `ARCHITECTURE-SPINE.md` currently defers detailed listing moderation policy until before Discovery opens to untrusted Creators. Story 3.3 is that revisit; its implementation is incomplete until the spine and UX IA contain the ratified behavior.
- The migration is forward-only/checksummed. Never edit a committed migration or “fix” the manifest to bless drift.

### Current implementation inventory (merged baseline)

- `src/modules/discovery/index.ts` already owns listing copy, `unlisted | listed` parsing, `setPollListing`, idempotence, and the stable `poll_delisted` refusal. Extend it; do not replace those Story 3.1 contracts.
- `src/adapters/d1/index.ts` already has owner-qualified `updateListingForOwner` with `discovery_state != 'delisted'` and no representation bump. Direct Poll lookup still resolves Delisted Polls. Add a purpose-shaped moderation persistence boundary rather than exposing a generic any-Poll update.
- `db/migrations/0002_identity_auth.sql` has no role column. `db/migrations/0004_polls.sql` already defines the three Discovery states. `db/migrations/0010_discovery_catalog_projection.sql` already bumps `discovery_catalog_revision` for actual state changes. Migration 0011 is next.
- `src/adapters/cache/discovery.ts` keys named cache entries by revision; old generations become unreachable after the D1 commit. `src/pages/sitemap.xml.ts` reads D1 each request with `no-store`. Both should remain implementation-unchanged unless a failing proof exposes a defect.
- `src/modules/identity/index.ts` currently gives `CreatorPrincipal` only internal user/session data; `src/adapters/auth/index.ts` maps only Better Auth core fields; `src/middleware.ts` builds the principal. Those are the role projection seams.
- Middleware already applies session-bound CSRF to `/creator` and anticipates `/admin`, but only `/creator` is an authenticated guard/validated return surface. This story deliberately nests moderation under `/creator`; do not broaden the root namespace.
- `src/pages/creator/polls/[pollId].astro` already displays the shared listing badge, but currently renders active Unlisted/Listed controls with neither selected for Delisted. Its exact read-only UI is Story 3.3 work.
- `src/components/poll-option.astro` has a vote-specific read-only mode that announces “Your vote.” Reusing it verbatim for listing would be semantically wrong.
- `src/pages/[reference].astro` already resolves Delisted Polls, uses `noindex` for non-Listed state, and renders no listing words. Preserve that voter contract.
- `src/adapters/telemetry/index.ts` currently labels every HTTP 403 `csrf_rejected`; Story 3.3 introduces a real non-CSRF 403 and must correct the classification without double-emission.
- `src/modules/polls/reserved-slugs.ts` does not reserve `admin`. No new reservation is needed because `/creator` is already reserved.

### Previous-story and Git intelligence

- Baseline is live-refreshed `origin/main` at `2de96922e812a9e2a18028acdb597fb4c1faa609`, the Story 3.2 merge. Local `main` matched it when this story was created.
- Story 3.1 deliberately shipped the Delisted sentinel, owner-domain refusal, race-safe owner SQL guard, shared badge vocabulary, and no representation bump; it deferred only the Administrator writer and exact read-only treatment to this story.
- Story 3.2 deliberately made every public read exclude `delisted`. Its revision trigger makes a moderation write visible to Discover without purge code; its sitemap is a fresh D1 read. Reuse and test those seams.
- Recent implementation conventions are one logical change per commit, provider-free application services, purpose-shaped D1 factories, strict delivery parsing, POST→303, private/no-store authenticated HTML, stable snake_case errors, and real-D1/browser proof.
- Preserve unrelated untracked retrospectives present at story creation: `_bmad-output/implementation-artifacts/epic-1-retro-2026-08-03.md` and `epic-2-retro-2026-08-03.md`. Stage only this story's explicit implementation/status paths; never `git add -A`.

### Current platform specifics (verified 2026-08-04)

- Locked repository versions are Node `24.18.0`, pnpm `11.17.0`, TypeScript `7.0.2`, Astro `7.1.5`, `@astrojs/cloudflare` `14.1.6`, Better Auth `1.6.25`, Zod `4.4.3`, Wrangler `4.115.0`, Vitest `4.1.10`, Workers pool `0.19.0`, Playwright `1.62.0`, and fast-check `4.9.0`. Add no dependency for this story.
- The ambient shell was Node 22 at creation time. Implementation commands must load `/Users/justin/.nvm/nvm.sh` and run `nvm use` (or otherwise prove Node `24.18.0`) before interpreting package/test failures.
- Better Auth's current database docs specify `user.additionalFields`, distinguish `input` from `returned`, and explicitly recommend `input: false` for a server-owned role; configured defaults still apply to OAuth-created users. Its TypeScript docs state those fields are available on the inferred session user. Pinned `1.6.25` installed types support the complete enum contract `type: ["creator", "administrator"]`, `required: true`, `defaultValue: "creator"`, `input: false`, `returned: true`. Use this narrow facility, not the admin plugin: https://better-auth.com/docs/concepts/database, https://better-auth.com/docs/concepts/typescript, https://better-auth.com/docs/concepts/oauth
- Cloudflare D1 currently documents `D1Database.batch()` as a transaction whose prepared statements execute sequentially and whose full sequence rolls back on a statement failure. Use bound statements and inspect each result; do not concatenate target/actor values: https://developers.cloudflare.com/d1/worker-api/d1-database/
- Cloudflare's migration docs keep ordered SQL files under the configured `migrations_dir`; this repository adds immutability/checksum rules on top: https://developers.cloudflare.com/d1/reference/migrations/
- Astro's current on-demand rendering docs expose `Astro.request.method`/body and direct `Response`/redirect returns. Follow the repository's existing `.astro` POST/303 convention; do not introduce Astro Actions merely because they exist: https://docs.astro.build/en/guides/on-demand-rendering/
- `AGENTS.md` requires Context7 for current library/cloud docs. Context7 resolve/query tools were unavailable in this session, so the official primary docs above were used as the explicit fallback. At dev-story start, retry Context7 for Better Auth `1.6.25` custom user fields/session inference and current D1 batch semantics before coding; if current docs conflict with the pinned package, inspect the installed type definitions and record the resolution.

### Testing requirements

| Layer | Required proof |
|---|---|
| Unit (Node) | Role parser/capability matrix; provider/email never grant; delist/clear transition table, idempotence, legacy fallback, exact copy; route-boundary parser; authorization/CSRF telemetry classification. |
| Integration (workerd + real D1) | Migration/default/check/unique index; Better Auth-created user/session role projection and rejected request/provider escalation; fresh SQL role guard; atomic action+state transition/rollback; same-timestamp sequence ordering and unmatched-cycle restoration; protected-fact invariants; catalog revision; Discover/cache/sitemap immediacy; canonical PRG query contract; creator/voter route contracts. |
| E2E (Playwright) | Admin lookup/delist/clear; non-admin forgery denial; exact Creator read-only UI; direct linked vote still counts with no moderation UI; Discover/sitemap removal/restoration; dark/light mobile/desktop accessibility and clean console. |
| Full gate | Migration guard, both Vitest projects, type check, Playwright, generated binding types + zero diff, production build, and `git diff --check` in repository order under Node 24.18.0. |

### Scope fences — do not build here

- No separate admin login, Better Auth admin plugin/endpoints, general RBAC/ACL, teams, organizations, role hierarchy, in-product grant/revoke UI, seed-by-email, provider allowlist, or first-user promotion.
- No all-Poll admin directory, search/ranking, owner data browser, bulk moderation, reason/appeal/notification workflow, public explanation, moderation-history UI, Comment deletion, Poll deletion, ownership transfer, or ban/suspension system.
- No change to canonical links, aliases, Poll lifecycle/Deadline, result visibility, voting/security toggles, Vote/Tally/Results behavior, `representation_version`, public discovery DTOs, Cache API namespace, sitemap capacity, or bindings/secrets.
- No new top-level `/admin` route or `admin` reserved slug. Do not place Administrator controls on the ordinary voter page.
- Do not edit migrations `0001`–`0010`, introduce a package, modify `wrangler.jsonc`, regenerate bindings without a config change, push, deploy, or assign a real remote Administrator during dev-story.

### Project Structure Notes

- Expected NEW: `db/migrations/0011_administrator_moderation.sql`, `src/pages/creator/moderation.astro`, a focused moderation form/parser if needed, `docs/administration.md`, focused integration/E2E test files.
- Expected UPDATE: `src/modules/identity/index.ts`, `src/adapters/auth/index.ts`, `src/middleware.ts`, Astro locals/request context typing, `src/modules/discovery/index.ts`, `src/adapters/d1/index.ts`, `src/adapters/telemetry/index.ts`, `src/pages/creator/polls/[pollId].astro`, focused existing tests, `db/migrations.manifest.json`, `README.md`, `CHANGELOG.md`, `ARCHITECTURE-SPINE.md`, `EXPERIENCE.md`, this story record, and `sprint-status.yaml`.
- Expected test-only/read-and-preserve: `src/adapters/cache/discovery.ts`, `src/pages/discover.astro`, `src/pages/sitemap.xml.ts`, `src/pages/[reference].astro`, Results/voting modules and routes, `src/components/listing-badge.astro`.
- Expected unchanged: `src/modules/polls/reserved-slugs.ts`, `src/shared/domain/index.ts` unless a proven cross-capability type belongs there, `wrangler.jsonc`, `worker-configuration.d.ts`, package manifests/lockfile, and committed migrations `0001`–`0010`.
- If implementation proves an expected-unchanged file must move, document the governing requirement and update the File List; never duplicate an existing policy merely to avoid touching its owner.

### References

- Requirements: `_bmad-output/planning-artifacts/epics.md` — Epic 3 objective (694–696), Story 3.1 dependency (698–719), Story 3.2 dependency (721–741), Story 3.3 (743–770), AR-17/18 and UX-DR19 cross-cutting rules
- PRD: `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md` — Administrator/glossary (49–75), permissions (86–93), FR-23 (255–262), authorization/privacy NFRs (303–328); `addendum.md` — Administrator role clarification (5–7)
- Architecture: `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` — AD-1, AD-4/5 (80–107), AD-6, AD-15/19/21/22/23/24, persistence model/fact ownership (465–488), capability map/deferred moderation policy (498–527); `reviews/review-adversarial.md` — H-5 two-owner listing/moderation warning (249–263)
- UX: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md` — role/states (25–29, 58–60), exact copy (128), listing control/badge (163–164), Delisted Creator/Voter states (213–214), accessibility/responsiveness (217–264), voter journey (410–413); `DESIGN.md` — state tokens and Delisted badge (337–341, 631–633), contrast/state rules (669–690)
- Previous stories: `_bmad-output/implementation-artifacts/3-1-listing-control-opt-into-discovery.md` — Delisted guard/read-only deferral/no version bump; `3-2-discover-catalog-sitemap.md` — revisioned cache/sitemap and explicit Story 3.3 handoff
- Code/schema: `src/modules/discovery/index.ts`, `src/modules/identity/index.ts`, `src/adapters/auth/index.ts`, `src/adapters/d1/index.ts`, `src/middleware.ts`, `src/lib/request-context.ts`, `src/adapters/telemetry/index.ts`, `src/pages/creator/polls/[pollId].astro`, `src/pages/[reference].astro`, `src/components/poll-option.astro`, `db/migrations/0002_identity_auth.sql`, `0004_polls.sql`, `0010_discovery_catalog_projection.sql`
- Current official docs: https://better-auth.com/docs/concepts/database, https://better-auth.com/docs/concepts/typescript, https://better-auth.com/docs/concepts/oauth, https://developers.cloudflare.com/d1/worker-api/d1-database/, https://developers.cloudflare.com/d1/reference/migrations/, https://docs.astro.build/en/guides/on-demand-rendering/

## Dev Agent Record

### Agent Model Used

OpenAI Codex (GPT-5)

### Implementation Plan

- Establish the provider-neutral role and migration boundary before exposing any capability.
- Implement Discovery-owned moderation commands and one purpose-shaped D1 transaction adapter.
- Add the fixed operator route and strict delivery parsing, then make the Creator Delisted state inert.
- Prove public enumeration changes and voter invariants with real D1, route, and browser coverage.
- Ratify architecture/UX contracts, run the exact repository gate, and prepare the story for review.

### Debug Log References

- 2026-08-04: RED role tests failed on absent role projection, schema, and capability parsing; focused GREEN checks passed (36 unit, 23 integration) under Node 24.18.0.
- 2026-08-04: Task 1 repository regression passed: migration guard 11/11; Vitest 71 files, 1,071 tests; TypeScript check passed.
- 2026-08-04: Task 2 RED failed on absent moderation command/adapter; focused GREEN passed (50 Discovery unit, 11 real-D1 transaction tests). Full regression passed: 72 files, 1,090 tests; TypeScript check passed.
- 2026-08-04: Task 3 strict parser/telemetry suites passed 152 focused unit tests and the operator route passed 14 real-D1/middleware cases; Task 4 passed 20 Creator lifecycle-route cases. Combined regression passed: 74 files, 1,185 tests; TypeScript and Astro builds passed.
- 2026-08-04: Task 5 public-surface proof passed 57 focused cases and all 286 integration cases: real delist/clear commands isolate Discover cache generations, update sitemap enumeration, preserve public Poll/Results markup, and accept/count a direct Vote while Delisted.
- 2026-08-04: Adversarial review found and closed inner error-log leakage, unresolved-target reflection, signed-out query propagation, missing no-store middleware headers, an inaccurate cross-console transaction runbook, and the missing post-clear protected-fact snapshot. Post-fix regression passed 74 files and 1,190 tests; review found no remaining blocker.
- 2026-08-04: Focused Chromium moderation journey passed 1/1 in 24.6s. Inspected 12 light/dark mobile/desktop proofs for operator, Creator, and Voter surfaces; 44px targets, focus order/rings, 8.043:1 primary-button contrast, no overflow, no moderation-blindness regression, and clean console/page/network observations passed.
- 2026-08-04: Exact local gate passed under Node 24.18.0 and pnpm 11.17.0: migration guard 11/11; Vitest 74 files and 1,190 tests; TypeScript; Playwright 151/151 in 11.9m; generated binding types with zero drift; production build; tracked and intended-untracked diff hygiene.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Fresh-context checklist validation passed after tracker, governance, PRG, audit-ordering, telemetry, Better Auth, and D1 contracts were made explicit.
- Added a fail-closed Better Auth role projection, forward-only role/audit schema, singleton Administrator constraint, and provider-neutral principal capability.
- Added a placeholder-only, environment-specific Administrator assignment/transfer/revocation/recovery runbook with no in-product grant surface.
- Added provider-free `delist`/`clear_delisted` commands and a live-role-guarded D1 batch that restores prior Creator intent, falls back safely for legacy rows, and leaves representation/Vote facts untouched.
- Added the fixed `/creator/moderation` surface with strict bounded parsing, independent capability enforcement, POST-redirect-GET outcomes, privacy-safe telemetry classification, and no JavaScript dependency.
- Made the Creator's Delisted listing state an exact-copy, semantic, non-form read-only treatment while preserving race-safe forged-POST refusal and restored controls after clear.
- Proved the existing Discover, sitemap, indexability, Poll, Results, and Vote surfaces react only where intended, including restoration of prior Listed versus Unlisted intent and moderation-blind public markup.
- Ratified the Administrator capability, reversible Delisted hold, private ordered actions, fixed operator route, telemetry, and catalog revision in the architecture spine; governed every operator state in EXPERIENCE without adding a DESIGN token/component contract.
- Hardened failure and guard paths so they emit only one privacy-safe telemetry record, never reflect unresolved targets or carry them through sign-in, and remain `private, no-store` even when middleware intercepts the request.
- Added and visually inspected the full browser journey and 12 ignored proof screenshots at `test-results/story-3-3-administrator-delisting-proof/`.
- Staging Google and GitHub round trips remain a mandatory pre-production promotion check when separate push/deploy authority is granted. Dev-story performed no push, deploy, remote D1 mutation, or real operator-ID handling.
- Context7 was unavailable in this session; current Better Auth, Cloudflare D1, and Astro behavior was checked against their official documentation instead.

### File List

- `_bmad-output/implementation-artifacts/3-3-administrator-delisting.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md`
- `CHANGELOG.md`
- `README.md`
- `db/migrations/0011_administrator_moderation.sql`
- `db/migrations.manifest.json`
- `docs/administration.md`
- `src/adapters/auth/index.ts`
- `src/adapters/d1/index.ts`
- `src/adapters/telemetry/index.ts`
- `src/lib/moderation-form.ts`
- `src/lib/request-context.ts`
- `src/middleware.ts`
- `src/modules/discovery/index.ts`
- `src/modules/identity/index.ts`
- `src/pages/creator/moderation.astro`
- `src/pages/creator/polls/[pollId].astro`
- `tests/e2e/administrator-moderation.spec.mjs`
- `tests/e2e/creator-session.mjs`
- `tests/integration/administrator-schema.integration.test.ts`
- `tests/integration/administrator-upgrade-schema.integration.test.ts`
- `tests/integration/auth-middleware.integration.test.ts`
- `tests/integration/auth-schema.integration.test.ts`
- `tests/integration/moderation-persistence.integration.test.ts`
- `tests/integration/moderation-route.integration.test.ts`
- `tests/integration/creator-poll-lifecycle-route.integration.test.ts`
- `tests/integration/discover-route.integration.test.ts`
- `tests/integration/discovery-endpoints.integration.test.ts`
- `tests/integration/discovery-indexability.integration.test.ts`
- `tests/integration/live-results-route.integration.test.ts`
- `tests/integration/vote-route.integration.test.ts`
- `tests/unit/auth.test.ts`
- `tests/unit/discovery.test.ts`
- `tests/unit/identity.test.ts`
- `tests/unit/moderation-form.test.ts`
- `tests/unit/telemetry.test.ts`

## Change Log

- 2026-08-04: Created and independently validated Story 3.3 at live baseline `2de96922e812a9e2a18028acdb597fb4c1faa609`; resolved role, restoration, audit, operator-route, governance, PRG, cache, security, telemetry, testing, and scope contracts; set status to `ready-for-dev`.
- 2026-08-04: Implemented and fully regressed Task 1's Administrator role, moderation schema, Better Auth boundary, principal projection, and out-of-band operations runbook.
- 2026-08-04: Implemented and fully regressed Task 2's Discovery commands, ordered moderation facts, reversible atomic persistence, live-role guard, concurrency semantics, and cache-generation invariants.
- 2026-08-04: Implemented and fully regressed Task 3's fixed operator surface, strict transport boundary, authorization/CSRF telemetry split, and canonical PRG contract.
- 2026-08-04: Implemented and fully regressed Task 4's exact, inert Creator Delisted treatment and race-safe forged-listing refusal.
- 2026-08-04: Added real-command public enumeration, indexability, privacy, and direct-Vote proof for Task 5 without changing the Story 3.2 runtime substrate.
- 2026-08-04: Ratified Story 3.3 architecture/UX, corrected the D1 console runbook, added the full Administrator browser journey and visual proof, closed all adversarial privacy/cache/telemetry findings, passed the exact repository gate, and moved the story to `review` without remote mutations.

### Review Findings

> Group 1 (core logic) review, 2026-08-04

- [x] [Review][Patch] D1 batch() non-transactional: orphaned moderation_action on race [src/adapters/d1/index.ts:1693] — handled: `actionChanges === 1 && stateChanges === 0` now routes to `classifyNoChange` instead of throwing.
- [x] [Review][Patch] CLEAR_DELISTED_STATE_QUERY subquery unfiltered by action type [src/adapters/d1/index.ts:1567] — fixed: added `AND ma.action = 'clear_delisted'` to the subquery.
- [x] [Review][Defer] classifyNoChange fallthrough throw for future DISCOVERY_STATES values [src/adapters/d1/index.ts:1620] — deferred, pre-existing
- [x] [Review][Defer] findTargetByReference accepts empty question string [src/adapters/d1/index.ts:1661] — deferred, pre-existing
- [x] [Review][Defer] findTargetByReference accepts empty canonical_reference [src/adapters/d1/index.ts:1662] — deferred, pre-existing

> Group 2 (UI pages) review, 2026-08-04

- [x] [Review][Defer] requestContext.pollId not cleared after moderation poll_not_found [src/pages/creator/moderation.astro:170] — stale pollId attribution in telemetry when target lookup succeeds but subsequent moderation fails with not_found. Deferred, pre-existing.
- [x] [Review][Defer] lookupValue shows stale previous value after invalid form submission [src/pages/creator/moderation.astro:82] — visual inconsistency between pre-filled input and error message. Deferred, pre-existing.

> Group 3 (tests) review, 2026-08-04

- [x] [Review][Defer] Route test `fail_moderation_route` trigger cleanup is only in beforeEach, not afterEach [tests/integration/moderation-route.integration.test.ts:279] — suite passes because applyD1Migrations resets schema, but cross-file fragility remains. Deferred, pre-existing.
- [x] [Review][Defer] E2E `cleanupCreator` call in afterAll may not await async operations [tests/e2e/administrator-moderation.spec.mjs:47-64] — unawaited promise rejections could be lost. Deferred, pre-existing.
