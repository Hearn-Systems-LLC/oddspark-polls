---
baseline_commit: 3cac4af060fc11904dbe5a84f11071822e120f45
baseline: origin/main @ 3cac4af060fc11904dbe5a84f11071822e120f45 (merged Story 3.1)
dependency_story: 3-1-listing-control-opt-into-discovery
epic: 3 — Public Face: Discovery, Landing & Demo
---

# Story 3.2: Discover Catalog & Sitemap

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a visitor,
I want to browse open public Polls and vote in one without ever receiving a link,
So that the platform is usable from a cold start (SM-8).

## Acceptance Criteria

Verbatim from `_bmad-output/planning-artifacts/epics.md` § Story 3.2 (lines 721–741):

1. **Given** `/discover`, **When** it renders, **Then** it lists only effectively open, Listed Polls, newest first, as unchanged `poll-card` rows — question, metadata line, live indicator, whole row one tap target — never a card grid (FR-23, UX-DR11), **And** discovery cards contain only explicitly public fields and are served from a cache namespace separate from result responses (AR-17).

2. **Given** more Polls than one page, **When** the catalog paginates, **Then** `NEWER` / `OLDER` render as real links at 48px targets (~20 per page), the exhausted end dim and inert — never infinite scroll, **And** loading renders skeleton rows without shimmer, an error keeps loaded rows with a retry and “The directory didn't load.”, and an empty catalog reads “Nothing here yet. Polls appear when their Creators opt them in. Yours could be the first.” with a create prompt.

3. **Given** the sitemap and robots endpoints, **When** they are requested, **Then** `sitemap.xml` contains Listed, effectively open Polls and the public surfaces only — Unlisted and Delisted Polls appear in no sitemap or index — and closing or unlisting a Poll drops it from the sitemap (FR-23).

## Tasks / Subtasks

- [x] Task 1: Discovery catalog application contract and public projection (AC: #1, #2)
  - [x] EXTEND `src/modules/discovery/index.ts`; preserve every Story 3.1 listing command, error code, Delisted guard, and non-versioned write contract. Keep it provider-free: no Astro, D1, Cache API, DOM, or `cloudflare:workers` imports (AD-1/AD-19).
  - [x] Define one public catalog DTO and a purpose-shaped query port. The card allowlist is exactly: canonical reference, domain plain-text question, Poll Type, accepted-Vote count, Deadline (nullable), created timestamp/order key, and derived open status/LIVE presentation. Keep the question unencoded in domain/application/cache data and let Astro escape it exactly once at render time. Do not expose owner/user IDs, `result_visibility`, `discovery_state`, option labels/counts, percentages, rounds, Comments, security-toggle state, digests/claims, submissions, raw database rows, or internal Poll IDs in card markup/JSON.
  - [x] Ratify `DISCOVERY_PAGE_SIZE = 20`. Define deterministic keyset order `(created_at_ms DESC, id DESC)` and fetch `pageSize + 1`; no offset pagination. The internal ID may exist only inside the opaque cursor/query boundary and must never render as a card field or telemetry value.
  - [x] Implement a versioned, bounded base64url cursor codec with explicit direction. URLs use at most one of `newer` or `older`; reject both, malformed JSON/base64, wrong version, non-safe timestamps, invalid IDs, oversized values, extra keys, or duplicate parameters with a safe `400`, never interpolation into SQL and never silent fallback to page one. The cursor is opaque/untrusted transport, not authenticated or secret: do not reuse any application secret; a structurally valid edited tuple safely addresses another page.
  - [x] `OLDER` seeks strictly below the last tuple in descending order; if 21 rows return, drop the final/farthest row and expose `OLDER`. `NEWER` seeks strictly above the first tuple in ascending order; if 21 rows return, drop that ascending result's final/farthest-newer row **before** reversing the remaining 20 for display, and expose `NEWER`. This yields the immediately adjacent page rather than jumping to the newest page. Return real URLs for available directions and `null` for exhausted directions. Concurrent inserts ahead of an older cursor must not duplicate or skip the already-addressed page.
  - [x] Add one provider-free `queryDiscoveryCatalog` application service that sequences revision read → cache lookup → D1 page query → cache write through injected ports. A missing/unreadable revision or D1 query failure is the stable application error the page maps to `500`; Cache API failures alone fall through. The route must not orchestrate these policy steps itself.
  - [x] Centralize exact Discover copy in the Discovery module: empty state, full error line (`The directory didn't load. Try again — everything that was on screen is still there.`), `NEWER`, `OLDER`, retry, and create-prompt copy. Unit-test the copy and the complete cursor boundary.

- [x] Task 2: Forward-only catalog projection migration and D1 read adapter (AC: #1, #2, #3)
  - [x] ADD `db/migrations/0010_discovery_catalog_projection.sql`; never edit migrations `0001`–`0009`. Avoid an index that accumulates an unbounded expired prefix: add `poll_discovery_no_deadline_idx` on `(created_at_ms DESC, id DESC)` for `listed`, manually-open rows with `deadline_ms IS NULL`, plus `poll_discovery_active_deadline_idx` led by `deadline_ms` and carrying `(created_at_ms DESC, id DESC)` for `listed`, manually-open rows with a non-null Deadline. Effective closure remains request-derived (AD-11).
  - [x] In the same migration, add a singleton `discovery_catalog_revision` projection-metadata row plus D1 triggers that increment it atomically on Poll insert/delete and **actual value changes** to the card/eligibility columns (`discovery_state`, `closed_at_ms`, `deadline_ms`, `question`, `poll_type`); guard the update trigger with null-safe OLD/NEW comparisons so no-op SETs do not churn the cache. Do not bump for Votes, result visibility, security toggles, or representation-version-only writes. This is a cache generation, not a second Poll representation version or a domain fact. Story 3.3's `discovery_state` updates activate the same trigger without new cache code.
  - [x] Run `pnpm migrations:checksum` to add the immutable migration hash to `db/migrations.manifest.json`; do not hand-edit a checksum to conceal migration drift.
  - [x] ADD a separate `createDiscoveryPersistence(db)` factory in `src/adapters/d1/index.ts` rather than widening creator or Results repositories. It exposes the current catalog revision and purpose-shaped catalog/sitemap queries. Bind one request-scoped `nowMs`; eligible means literal `listed`, `closed_at_ms IS NULL`, and `(deadline_ms IS NULL OR deadline_ms > nowMs)`. Equality at the Deadline is closed.
  - [x] Join only the unique canonical `poll_reference` row (`is_canonical = 1`). Count `vote` rows through `vote_poll_id_idx` so one accepted Vote is one Voter for every Poll Type; never count `vote_selection` rows. Map the database row to the Discovery-owned projection before returning it (AD-6/AD-23).
  - [x] Implement both keyset directions as two eligibility-partitioned queries. The no-Deadline query is creation-order indexed and output-bounded. The Deadline query range-seeks `deadline_ms > nowMs` through `poll_discovery_active_deadline_idx`, then explicitly sorts the qualifying rows by `(created_at_ms, id)` and applies `LIMIT 21`; its v1 work is proportional to the active Deadline-bearing set, not to page size. Merge both outputs by the one `(created_at_ms, id)` order and take the combined sentinel/page. This replaces an unbounded expired-prefix walk with an explicitly accepted active-set sort. Give every SELECT an explicit column list; do not use `SELECT *`. Preserve public-reference semantics and case-sensitive generated references.
  - [x] Give the sitemap a dedicated, paged D1 query of canonical references and eligibility facts. It must enumerate every eligible Poll, not only catalog page one, and it must not perform the Vote-count subquery. It reads D1 directly on each sitemap request so a committed close/unlist/delete is absent on the next request.
  - [x] Real-D1 tests cover listed/open inclusion; Unlisted, Delisted, manually closed, Deadline-before-now, and Deadline-equal-now exclusion; no-Deadline inclusion; canonical-reference selection; same-millisecond ID tie order; 19/20/21/40+ row traversal in both directions without duplicates; forward→back round trips; concurrent inserts and deleted boundary rows; and `COUNT(vote)` rather than selections.
  - [x] Trigger tests prove the revision bump matrix and atomic rollback: create/list/unlist/delist/close/deadline/question/type/delete bump; no-op SETs, Vote acceptance, and visibility/security/version-only updates do not; a failed Poll mutation cannot commit a revision bump. Existing rows begin with one usable revision after migration.
  - [x] Use `EXPLAIN QUERY PLAN` assertions to prove both catalog queries use their named indexes, the canonical join uses `poll_reference_canonical_idx`, and counts probe `vote_poll_id_idx`. Permit a named **index scan** for the first no-Deadline page; require an indexed Deadline range search and permit `USE TEMP B-TREE FOR ORDER BY` for that query; reject a poll-table scan and never describe `LIMIT 21` as a scan-work bound. Add a many-expired-row fixture proving the Deadline query seeks `deadline_ms > nowMs`, plus a 5,000-active-Deadline fixture proving merged order/page correctness and recording plan/`rows_read` evidence. V1 accepts the proportional active-set sort through the documented 49,998-public-Poll cap. If that cap cannot complete within D1/Worker execution limits, the implementation is not done: introduce a materialized or bucketed public catalog projection, update the architecture, and re-run the proof rather than weakening the test.

- [x] Task 3: Revisioned, bounded public Cache API projection (AC: #1, #3)
  - [x] ADD `src/adapters/cache/discovery.ts` behind a Discovery-owned port. Use the runtime named Cache API `caches.open("oddspark-discovery-v1")`; do not use `caches.default`, Workers Caching/`cache.purge`, a Results key, an application response cache, KV, a new binding, or a new package. Build one headerless synthetic **GET** Request under a constant same-origin internal path per D1 revision + validated page/direction/cursor identity; GET and HEAD share it, and inbound path/query text, Range/conditional/cookie headers, or `X-Forwarded-*` values never participate directly in `match`/`put`.
  - [x] Cache only a serialized, runtime-validated catalog projection plus relative paging links/expiry. Never cache a request origin, SSR HTML, middleware/session headers, `Set-Cookie`, request IDs, Results payloads, D1 rows, or an error response. Render a fresh Astro response around every hit.
  - [x] Set a short explicit maximum age of 30 seconds and an absolute `expiresAtMs` no later than the earliest Deadline in the page. Skip storage when no positive lifetime remains. On lookup, reject/delete a corrupt, wrong-version, or expired entry and fall through to D1; a Deadline crossing must never leave an expired Poll visible merely because no write ran.
  - [x] Read the D1 catalog revision before every cache lookup and key the entry by that revision. A committed card/eligibility mutation makes every earlier entry unreachable in every data center, including a stale fill that completes after the mutation; old generations simply expire. Do not add route-level post-commit invalidation or import Cloudflare APIs into Polls/Discovery domain code.
  - [x] Schedule successful `cache.put` work with the current Workers `waitUntil` surface inside the outbound adapter (or an injected equivalent in tests) so cache population does not extend page latency; catch/reduce its rejection to the same privacy-safe cache warning. Cache reads and revision/D1 truth reads remain awaited.
  - [x] Treat Cache API read/write failure as a cache miss/fail-open, with one stable operational code and no question, reference, cursor, cookie, or user data in logs. D1 remains truth. The rendered `/discover` response itself stays non-shared (`private, no-store`) so middleware cookie refreshes cannot be captured.
  - [x] Vote acceptance deliberately does not bump the catalog revision: the aggregate public count may be at most the documented 30-second cache age stale. Listing/closure/card changes and Story 3.3 moderation bump atomically through D1 triggers. Tests inject the named-cache port and prove generation isolation, stale-fill safety, expiry-at-Deadline, corrupt-entry fallback, D1/cache failure behavior, and that Results never read or write this namespace.

- [x] Task 4: Discover components, pagination tokens, and unchanged poll-card composition (AC: #1, #2)
  - [x] ADD `src/components/discover-catalog.astro` to render one `h1` (`Discover`) and the Poll rows as a semantic list (`ul`/`li`), plus `src/components/pagination.astro` for one `nav` with `aria-label="Discover pages"`. Use the existing `PollCard` and `buildPollCardViewModel` unchanged: pass the public Vote count, `status: "open"`, canonical `href`, and omit optional `listing`, so no `LISTED` badge appears on a voter surface.
  - [x] Keep one centered column at every breakpoint. Do not add a grid, masonry, infinite scroll, load-more button, ranking, search, filters, trending, related Polls, ads, or secondary row actions. Question text remains normal Astro-escaped text; never use `set:html`.
  - [x] Render enabled `NEWER`/`OLDER` as anchors with at least 48px hit area and the existing 2px/2px focus treatment. Render an exhausted direction as visible text in a non-anchor/non-button element: dim, `aria-disabled="true"`, no `href`, no click handler, and no tab stop. Labels, not color alone, carry direction/state.
  - [x] ADD only the missing `pagination` component token bindings in `src/styles/tokens.css`, deriving them from existing collapsed tokens (`--font-machine`, label-caps values, entropy, dim, space-6, focus outline/offset). Do not add raw component hex values or a fourth light-mode exception; do not rename/remove `--color-solar-dark` because the deployment smoke gate reads it.
  - [x] Skeleton rows match the title/metadata/hairline geometry at a count of 20, have `aria-hidden="true"`, cannot receive focus, and contain no animation, transition, shimmer, pulse, spinner, or opacity trick. The loaded-list container uses `aria-busy` during enhanced navigation without hiding its existing rows from assistive technology.
  - [x] Unit/source-contract tests prove PollCard reuse, one anchor per Poll row, no listing badge prop, no raw HTML, exact token bindings, inert exhausted controls, 48px targets, and no motion/shimmer declarations.

- [x] Task 5: SSR `/discover` with no-JavaScript floor and bounded enhancement (AC: #1, #2)
  - [x] ADD `src/pages/discover.astro` as a thin GET/HEAD inbound adapter. Reject other methods before querying with `405`, `Allow: GET, HEAD`, and safe non-shared cache headers. Capture `nowMs` once, parse the query boundary once, call the Discovery query/cache service, and compose view models; no eligibility, cursor, or public-field policy lives in the page.
  - [x] Initial SSR and every pagination URL work with JavaScript disabled. The initial `/discover` page is indexable and canonical to itself. Every cursor page is `noindex` and has a self-canonical URL rebuilt only from its validated direction/cursor (never raw query text), preventing A→B→A alternate cursors from becoming duplicate search entries; error/invalid-cursor states are also `noindex`. Every row links to `/${encodeURIComponent(canonicalReference)}`. Do not change `src/modules/polls/reserved-slugs.ts`: all three static names are already reserved.
  - [x] Empty state renders exactly: `Nothing here yet. Polls appear when their Creators opt them in. Yours could be the first.` plus a `CREATE A POLL` link to `/creator/new` (the existing guard sends signed-out visitors through `/sign-in?return=/creator/new`).
  - [x] A first-load D1 failure renders the full error copy and a real same-URL retry link with HTTP `500`, so outer telemetry reports an error. Do not emit a second route log. Invalid cursors render a safe `400` error state and never echo the cursor.
  - [x] ADD `src/scripts/discover-catalog.ts` as optional vanilla TypeScript enhancement only—no client framework/dependency. Intercept same-origin pagination links, retain the current rows, append/overlay inert skeleton rows, fetch the target SSR HTML, and replace only the catalog region on success. Use `history.pushState`, implement `popstate`, and move neither focus nor scroll unexpectedly.
  - [x] On network, non-2xx, parse, or replacement failure: remove skeletons, clear `aria-busy`, keep every previous row and its links, show the exact full error line with a retry for the target URL, and announce it once through a polite status region. Prevent stale/out-of-order fetches from replacing a newer navigation (abort or request token). No-JS behavior remains ordinary page navigation.
  - [x] Route/integration tests cover GET/HEAD parity, method gate before D1, query parsing, `400`/`500`, exact empty/error copy, valid real links, canonical URLs, public-only projection, and no `Set-Cookie`/private HTML in the named cache.

- [x] Task 6: `sitemap.xml`, `robots.txt`, canonical URLs, and per-Poll indexability (AC: #3)
  - [x] ADD `src/pages/sitemap.xml.ts` with `GET` plus an explicit unsupported-method/`ALL` gate returning `405` and `Allow: GET, HEAD`; verify Astro's generated HEAD invokes GET and strips the body. Successful responses are UTF-8 valid XML with `Content-Type: application/xml; charset=utf-8` and `Cache-Control: no-store` so browser/CDN caching cannot defeat post-mutation freshness. Emit absolute same-origin canonical URLs for exactly `/`, `/discover`, and every canonical Listed/effectively-open Poll. Escape XML; omit aliases, private routes, Results/live, and every ineligible Poll.
  - [x] Build the origin from the Worker request URL, not `X-Forwarded-*` headers, and normalize to one origin/trailing-slash convention. Do not leak bindings or secrets. Iterate the dedicated keyset query until exhausted; do not silently truncate at the first page.
  - [x] Use `SITEMAP_BATCH_SIZE = 1000`; each of the same two eligible streams fetches at most 1001 candidates so their merged page can emit 1000 plus an exhaustion sentinel. Merge/paginate without duplicates and cap v1 at 49,998 Poll URLs plus two static URLs (50,000 total), 50 merged pages, at most 100 D1 list statements, and 50 MB uncompressed. If a URL/byte/query bound would be exceeded, return `503`/`no-store` with stable code `sitemap_capacity_exceeded`, no partial XML, and no Poll references in logs. Unit-test boundaries/query counts through fake ports; record sitemap-index work in `deferred-work.md` before production approaches the cap.
  - [x] ADD `src/pages/robots.txt.ts` with the same GET/HEAD/unsupported-method contract, returning `text/plain; charset=utf-8` and `Cache-Control: no-store` with `User-agent: *`, `Allow: /`, and an absolute `Sitemap: {origin}/sitemap.xml` line. Do not enumerate hidden Poll references or use `robots.txt` as authorization. Do not disallow Poll routes: crawlers must be able to observe `noindex`.
  - [x] UPDATE `src/layouts/base-layout.astro` with optional, escaped `canonicalUrl` and `robots` props; existing callers keep current behavior when omitted. Use these props rather than hand-writing divergent head markup per page.
  - [x] UPDATE the internal `PollPage`/`findPollByReference` projection in `src/adapters/d1/index.ts` to carry `discoveryState` solely for indexability policy; do not render listing state/badges/copy on the voting page. In `src/pages/[reference].astro`, a canonical Poll page is indexable only when `discoveryState === "listed"` and `effectivePollStatus(...) === "open"`; all Unlisted, Delisted, and closed/expired Poll responses emit both `<meta name="robots" content="noindex">` and `X-Robots-Tag: noindex`. Every found Poll emits a canonical link to its canonical reference.
  - [x] UPDATE `src/pages/[reference]/results.astro` to be unconditionally `noindex` in meta and response header, with a canonical link back to the canonical voting URL when a Poll resolves. Preserve its authorization-before-projection ordering and `private, no-store` response contract; do not add a preliminary Vote/tally read or cache any Results response.
  - [x] Endpoint/integration tests prove XML escaping/parsing, content/cache headers, origin, empty and multi-batch sitemaps, omission matrices, robots privacy, and disappearance after close/unlist/delete. Assert GET/HEAD/POST semantics (`405` + `Allow`), comparing semantic HEAD headers while excluding per-request `x-request-id`. Route tests prove index/noindex/canonical metadata without exposing listing words to voters.

- [x] Task 7: Browser proof, regression suite, and documentation (AC: all)
  - [x] ADD `tests/e2e/discover.spec.mjs` using the existing local D1/auth helpers. Prove 21+ rows, newest/tie order, real `NEWER`/`OLDER` links with JavaScript disabled, both exhausted ends, whole-row navigation, and no listing badge. Prove Unlisted/Delisted/manual-close/deadline-expired rows never render.
  - [x] Exercise empty, loading, and failed enhanced-navigation states: exact copy, previous rows retained, retry works, `aria-busy` clears, no shimmer, no focus trap/loss, out-of-order response protection, and clean console. Check 48px pagination targets and computed token colors/focus in dark and light modes.
  - [x] Capture and inspect browser proof under `test-results/story-3-2-discover-proof/`: at minimum 375px dark and 1280px light catalog/pagination, plus empty/error states. Check console and network for errors and verify voter-visible pages contain no listing/moderation text.
  - [x] UPDATE `CHANGELOG.md` under `## [Unreleased]` for public discovery and sitemap/indexing behavior. Synchronize the public aggregate-count decision in PRD FR-20/FR-23, UX Discover/After-Close wording, and AD-21's explicit Discovery allowlist so the source artifacts no longer appear to disagree: a Listed/open card may expose accepted-Vote attendance, but never Tally shape. UPDATE this story's Dev Agent Record/File List and `sprint-status.yaml` through their workflows. No README, AGENTS, binding, secret, environment, or dependency change is expected; update any other governing document in the same commit if implementation changes its truth.
  - [x] Run the exact Node 24.18.0 / pnpm 11.17.0 merge gate in order: `pnpm migrations:guard` → `pnpm test` → `pnpm check` → `pnpm test:e2e` → `pnpm types` → `git diff --exit-code worker-configuration.d.ts` → `pnpm build:production`. Record fresh totals; Story 3.1's 961 unit/integration and 145 E2E totals are historical, not proof for this story.

## Dev Notes

### Decisions resolved at story-creation time (binding unless Justin reopens one before dev-story)

| # | Gap | Decision |
|---|---|---|
| D1 | **Is the aggregate Vote count public when Results are After Close or Creator-Only?** Story 1.8 hides every count on Results/confirmation surfaces, while UX-DR11 and UJ-7 explicitly define the Discover row as `MULTIPLE CHOICE · 122 VOTES · CLOSES IN 3H` and “question, type, Vote count, closing time.” | **Yes, only for a Creator-opted-in Listed Poll:** accepted-Vote count is explicitly public catalog attendance metadata. Listing opt-in makes that aggregate public; it does not authorize or read the Tally. Per-option counts, percentages, option/round/result shape, result visibility, and Comments remain forbidden. Count `vote` rows only, test all three Visibility Settings, and synchronize PRD/UX/AD-21 wording in this story so the distinction is no longer implicit. |
| D2 | **What does “~20” mean?** | **Exactly 20 visible rows, fetch 21.** Stable keyset order is `(created_at_ms DESC, id DESC)`, not offset. |
| D3 | **How can skeleton/error preservation coexist with SSR real links?** | **Progressive enhancement only.** SSR is the complete no-JS product. The small script enhances clicks, preserves old rows, and paints inert skeletons while fetching the next SSR document. No client-only catalog/API is introduced. |
| D4 | **What is cached?** | **Only the public catalog projection in named Cache API `oddspark-discovery-v1`, maximum 30 seconds and never across the nearest Deadline.** Full HTML, middleware headers, Results, errors, and private/internal data are never cached. Sitemap reads D1 directly so close/unlist is reflected on its next request. |
| D5 | **How do writes invalidate a data-center-local named Cache API without mixing it with Workers Caching?** | **D1 owns one atomic catalog generation.** Migration triggers bump it for card/eligibility writes; every cache key includes the generation. Old or fill-after-write entries are unreachable without any global purge/configuration. Vote counts alone may lag by ≤30 seconds. Story 3.3's state update activates the trigger automatically. |
| D6 | **Does “no sitemap or index” require search-engine controls?** | **Yes.** Sitemap omission alone cannot remove a directly linked URL from search. Voting pages are indexable iff Listed + effectively open; otherwise they carry meta and HTTP `noindex`. Results are always `noindex`. `robots.txt` must not block crawlers from seeing those directives. |
| D7 | **Which static URLs belong in the v1 sitemap?** | **Exactly `/` and `/discover`, plus eligible canonical voting URLs.** Sign-in, creator, API, Results/live, aliases, and implementation routes are omitted. Story 3.4 will improve `/`; it already exists and is public now. |
| D8 | **Should `poll-card` be changed?** | **No.** Story 3.1 made the listing prop optional specifically for Discover. Its current structured model already renders the required public Vote count, Deadline, and LIVE state. Compose it; do not fork or duplicate it. |
| D9 | **What happens at the single-sitemap protocol ceiling?** | **V1 supports 49,998 eligible Poll URLs plus `/` and `/discover`.** It never emits invalid/partial XML: crossing 50,000 URLs or 50 MB returns a privacy-safe `503` and triggers the already-defined sitemap-index follow-up before that scale is reached. |

### Architecture and security guardrails

- **Eligibility is one predicate in two execution forms.** Domain/app tests define `listed && effectively open`; D1 enforces the equivalent SQL (`closed_at_ms IS NULL`, Deadline null or `> nowMs`). Sitemap, catalog, cache-hit expiry, and indexability use the same request-scoped time semantics. Never persist “open” or wait for a scheduler (AD-5/AD-11).
- **Discovery and Visibility stay orthogonal.** Listed + Creator-Only and Listed + After-Close Polls are discoverable while open, but catalog query code must not call Results projection code or read option/tally facts. Result authorization still happens before private reads (AD-21).
- **Public DTO, not database row.** Discovery owns its outward schema; D1 maps to it. Runtime validation protects the cache boundary. The question stays plain text until Astro escapes it once. No raw HTML and no question/reference/cursor in telemetry (AD-15/AD-23, NFR-8).
- **Cache is an optimization.** D1 is truth. Cache failure cannot make Discover unavailable. Synthetic cache entries use a dedicated named Cache API plus D1 generation and finite expiry; request/session responses stay private and fresh. Never append or replay a cached `Set-Cookie`/request ID, and never confuse runtime `caches.open()` with separately configured Workers Caching.
- **Sitemap is enumeration, not authorization.** Unlisted/Delisted Polls remain directly reachable and voteable by link. Do not 404, redirect, or visually mark them. `noindex` is invisible delivery metadata, not moderation copy.
- **Search removal is eventually observed.** The application and sitemap change on the next request, but external engines remove a URL only after recrawling its `noindex`; do not claim instantaneous third-party deindexing.
- **One request, one telemetry record.** Initial query failure uses HTTP 500 so the existing outer middleware classifies it. Routes do not add ad-hoc logs. Cache-adapter warnings contain a stable code and normalized error kind only.
- **Migration is forward-only.** `0010` is the next migration and the manifest must be regenerated. Do not edit history. Test index use, not merely index existence.
- **No new dependency or binding.** The project already has Astro server endpoints, Cloudflare Cache API globals/module exports, D1, Zod, and vanilla client scripts. `wrangler.jsonc`, secret provisioning, and `worker-configuration.d.ts` should not change; the binding-drift gate proves that.

### Current implementation inventory (merged baseline)

- `src/modules/discovery/index.ts` owns Story 3.1 vocabulary, parsing, and `setPollListing`; extend it rather than creating a second discovery policy module.
- `src/adapters/d1/index.ts` exposes purpose-shaped Poll, Vote, and Results factories with bound SQL and explicit row mapping. `listPollsForOwner` already demonstrates correlated `COUNT(*)` through `vote_poll_id_idx`, but it is owner-scoped and returns listing state—do not reuse its DTO as the public catalog.
- `src/components/poll-card.ts` / `.astro` already provide Poll Type labels, accepted-Vote total formatting, Deadline display, LIVE, one full-row anchor, and optional creator-only listing badge. Discover passes no `listing`.
- `src/shared/domain/index.ts` owns `DiscoveryState`, `PollStatus`, `PollType`, IDs, and `effectivePollStatus`; do not redefine them.
- `src/modules/polls/reserved-slugs.ts` already reserves `discover`, `robots.txt`, and `sitemap.xml`; leave it unchanged.
- `src/layouts/base-layout.astro` currently owns common head metadata but has no canonical/robots props. Add optional props without changing current callers.
- `src/pages/[reference].astro` currently sets `private, no-store`, resolves canonical references, and handles GET/HEAD/POST voting. Preserve every voting, CSRF, cookie, CAPTCHA, Results, alias, and telemetry behavior while adding only index metadata.
- `src/pages/[reference]/results.astro` authorizes through the Results module before any private projection and never uses Cache API. Preserve that ordering; unconditional `noindex` needs no extra private read.
- Migrations `0001`–`0009` are committed/immutable. `0004_polls.sql` already has `discovery_state`, Deadline/manual-close fields, and poll references; `0005` guarantees one canonical reference; `0006` supplies `vote_poll_id_idx`. Story 3.2 needs an index and projection-generation metadata/triggers, not a second discovery-state column.
- `src/styles/tokens.css` already collapses dark/light semantic colors and has component groups. Add pagination aliases only. The smoke script extracts `--color-solar-dark` from this file.

### Previous-story and Git intelligence

- Story 3.1 deliberately scoped `/discover`, its catalog query/pagination/cache, sitemap/robots, and the discovery-state index to this story. It established the legal listing states, race-safe Delisted guard, optional PollCard listing prop, and no representation-version bump for listing changes.
- Preserve Story 3.1's finding that voter pages show no listing badge or moderation line; index metadata does not authorize visible listing copy.
- Preserve the recurring `.astro` type-check blind spot: source/unit walkers are not enough for component wiring. Browser tests must exercise the real SSR pages and computed styles.
- Preserve built-artifact discipline: route and production behavior are proved after the production build where the applicable test reads `dist`; do not diagnose stale output as a source bug.
- `main` and `origin/main` were refreshed and matched full SHA `3cac4af060fc11904dbe5a84f11071822e120f45` when this story was created. Recent work uses one `story/*` branch, logical commits, explicit-path staging, a PR, adversarial review, and the protected deploy gate. Do not implement on `main` or push unless asked.
- Story 3.1 recorded 961 unit/integration and 145 Playwright tests at its merge gate. Those are expectations for regression scale only; rerun and record current totals.

### Current platform specifics (verified 2026-08-03)

- Project pins Node 24.18.0, pnpm 11.17.0, TypeScript 7.0.2, Astro 7.1.5 with `@astrojs/cloudflare` 14.1.6, Wrangler 4.115.0, Vitest 4.1.10, and Playwright 1.62.0. Add no package.
- Current Astro endpoint guidance: a `.ts` page exports HTTP-method handlers returning `Response`; set `Content-Type` explicitly for XML/text. When GET exists without an explicit HEAD, Astro invokes GET and strips the body—test that generated behavior rather than implementing divergent data logic.
- Current Astro on-demand guidance supports `Astro.response.headers.set(...)` for page response headers; use it for `X-Robots-Tag` and preserve existing cache headers.
- Current Cloudflare guidance distinguishes runtime `caches.open(name)` from separately configured Workers Caching. Named Cache API entries are data-center-local, `put` honors response cache headers, `cache.delete` is local, and `waitUntil` keeps non-blocking work alive. This story uses D1-generation keys for global logical invalidation and requires no `cache.enabled` Wrangler configuration or purge API.
- Current D1 guidance recommends prepared/bound statements and `EXPLAIN QUERY PLAN`. A cursor/Deadline range can report `SEARCH ... USING INDEX`; an initial ordered stream can validly report `SCAN ... USING INDEX`. Require the named index and reject `SCAN poll`, rather than asserting one verb for every page.
- Google requires absolute canonical URLs and valid UTF-8 XML in sitemaps, caps one sitemap at 50,000 URLs/50 MB, and documents that a URL must remain crawlable for `noindex` meta/header to be observed. Therefore robots must not hide Unlisted/Delisted URLs by path.

### Testing requirements

| Layer | Required proof |
|---|---|
| Unit (Node) | Eligibility/public allowlist; exact copy; cursor codec, malformed/structurally edited inputs, bounds, directions, tie order; canonical synthetic GET cache key/version/expiry/fail-open; pagination source contracts; sitemap XML/capacity helpers and escaping. |
| Integration (workerd + real D1) | Migration/index plan and revision-trigger matrix; eligibility including Deadline equality; canonical refs; accepted-Vote counting/Visibility matrix; bidirectional 19/20/21/40+ traversal; generation/cache isolation; Discover statuses/headers; sitemap/robots bodies; Poll/Results noindex and canonical metadata. |
| E2E (Playwright) | No-JS discovery and links; enhanced loading/error/history/race; empty state; 48px/focus/inert controls; dark/light mobile/desktop visuals; close/unlist disappearance; no voter-visible listing copy; clean console/network. |
| Full gate | Migration guard, both Vitest projects, type check, Playwright, generated binding types + zero diff, production build, in the repository-prescribed order. |

### Scope fences — do not build here

- Administrator auth/capabilities, delist/clear-delist mutations, moderation records/UI → Story 3.3. This story makes all reads exclude the already-valid `delisted` state; the D1 revision trigger automatically covers Story 3.3's future state writes.
- Landing-page redesign/navigation, repository link, Demo Poll → Stories 3.4–3.6. Do not alter `src/pages/index.astro` merely to add a Discover link early.
- Search, ranking, trending, filters, categories, related Polls, ads, infinite scroll, analytics vendor, read replication, Durable Objects, scheduled close jobs, or a separate Worker → explicitly deferred.
- Do not change result visibility, Tally authorization, Vote transaction semantics, listing transitions, `representation_version`, auth/CSRF, Turnstile, bindings/secrets, or migrations `0001`–`0009`.

### Project Structure Notes

- Expected NEW: `db/migrations/0010_discovery_catalog_projection.sql`, `src/adapters/cache/discovery.ts`, `src/components/discover-catalog.astro`, `src/components/pagination.astro`, `src/pages/discover.astro`, `src/pages/sitemap.xml.ts`, `src/pages/robots.txt.ts`, `src/scripts/discover-catalog.ts`, focused unit/integration/E2E tests.
- Expected UPDATE: `src/modules/discovery/index.ts`, `src/adapters/d1/index.ts`, `src/layouts/base-layout.astro`, `src/pages/[reference].astro`, `src/pages/[reference]/results.astro`, `src/styles/tokens.css`, focused tests, `db/migrations.manifest.json`, PRD/architecture/UX source artifacts for the public-count clarification, `CHANGELOG.md`, this story record, and `sprint-status.yaml`.
- Expected unchanged: `src/components/poll-card.ts`, `src/components/poll-card.astro`, `src/shared/domain/index.ts`, `src/modules/polls/reserved-slugs.ts`, `src/pages/index.astro`, `wrangler.jsonc`, `worker-configuration.d.ts`, package manifests/lockfile, README/AGENTS, and committed migrations `0001`–`0009`.
- If implementation proves an expected-unchanged file must move, document the governing requirement and update the story File List; never duplicate the existing component/domain/route behavior to avoid touching it.

### References

- Requirements: `_bmad-output/planning-artifacts/epics.md` — Epic 3 objective (694–696), Story 3.1 dependency (698–719), Story 3.2 (721–741), Story 3.3 moderation consumer (743–770), UX-DR11 (102), AR-17 (84)
- PRD: `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md` — UJ-7/SM-8 (47, 357–360), Discovery glossary (70–73), FR-20 (237–251), FR-23 (254–260), NFRs (301–315)
- Architecture: `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` — AD-1, AD-5 (94–107), AD-6, AD-11, AD-13, AD-15/16/19, AD-21 (318–328), AD-23 (342–353), HTTP/cache convention (375–383), capability map (498–512), deferred ranking/read replication (515–527)
- UX: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md` — discovery IA (39–60), exact copy (126–127), PollCard/pagination contracts (155, 165–166), states (210–212), accessibility (247–263), UJ-7 (407–415); `DESIGN.md` — pagination tokens (348–355), PollCard (621–625), motion/accessibility/anti-patterns (645–678)
- Previous story: `_bmad-output/implementation-artifacts/3-1-listing-control-opt-into-discovery.md` — Story 3.2 scope fence, PollCard composition, review findings, gate record
- Code/schema: `src/modules/discovery/index.ts`, `src/adapters/d1/index.ts`, `src/components/poll-card.ts`, `src/components/poll-card.astro`, `src/layouts/base-layout.astro`, `src/pages/[reference].astro`, `src/pages/[reference]/results.astro`, `src/styles/tokens.css`, `src/modules/polls/reserved-slugs.ts`, `db/migrations/0004_polls.sql`, `0005_poll_reference_canonical_unique.sql`, `0006_votes.sql`
- Current Astro docs: https://github.com/withastro/docs/blob/main/src/content/docs/en/guides/endpoints.mdx and https://github.com/withastro/docs/blob/main/src/content/docs/en/guides/on-demand-rendering.mdx
- Current Cloudflare docs: https://developers.cloudflare.com/workers/runtime-apis/cache/, https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil, https://developers.cloudflare.com/workers/cache/configuration/, https://developers.cloudflare.com/d1/best-practices/use-indexes, https://developers.cloudflare.com/d1/worker-api/d1-database/
- Search indexing: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap, https://developers.google.com/search/docs/crawling-indexing/block-indexing, and https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading

## Dev Agent Record

### Agent Model Used

OpenAI Codex (GPT-5)

### Implementation Plan

- Implement each story task in sequence with focused RED tests, minimal GREEN code, refactoring, and a full Vitest/type validation before marking the task complete.
- Keep discovery policy provider-free, isolate D1 and Cache API adapters behind Discovery-owned ports, and preserve the existing PollCard and voter/result authorization boundaries.
- Finish with real SSR/E2E browser proof and the repository's exact Node 24.18.0 merge gate.

### Debug Log References

- Task 1 RED: `pnpm test:unit -- tests/unit/discovery.test.ts` failed because `encodeDiscoveryCursor` did not exist (740 historical tests passed).
- Task 1 GREEN: full `pnpm test` passed 59 files / 988 tests; `pnpm check` passed on Node 24.18.0.
- Task 2 RED: the focused integration run failed all 16 new cases because `discovery_catalog_revision` did not exist.
- Task 2 GREEN: `pnpm migrations:guard` passed 10 checksummed migrations; full `pnpm test` passed 60 files / 1,004 tests and `pnpm check` passed. Query-plan assertions require the two named catalog indexes, canonical-reference and Vote indexes, an indexed Deadline range search, and bounded `rows_read` evidence for 2,000 expired / 5,000 active fixtures.
- Task 3 RED: the focused unit run failed because `src/adapters/cache/discovery.ts` did not exist.
- Task 3 GREEN: full `pnpm test` passed 62 files / 1,015 tests and `pnpm check` passed on Node 24.18.0.
- Task 4 RED: four source-contract cases failed because the Discover components and pagination bindings did not exist.
- Task 4 GREEN: unchanged PollCard diff confirmed; full `pnpm test` passed 63 files / 1,019 tests and `pnpm check` passed.
- Task 5 RED: the focused unit/integration run failed because `src/scripts/discover-catalog.ts` and `src/pages/discover.astro` did not exist.
- Task 5 GREEN: focused route coverage passed 20 integration files / 230 tests, the complete `pnpm test` matrix passed 65 files / 1,028 tests, and `pnpm check` passed on Node 24.18.0.
- Task 6 RED: six sitemap-boundary tests failed on missing application helpers and eight route metadata tests failed on missing canonical/noindex delivery.
- Task 6 GREEN: full `pnpm test` passed 69 files / 1,055 tests and `pnpm check` passed. The pinned Astro 7.1 dispatcher resolves `ALL` before its documented GET-to-HEAD fallback, so `ALL` delegates HEAD to the same GET function and Astro still strips the body; route-container tests prove the final semantics.
- Task 7 BROWSER: focused Discover Playwright passed 5/5; inspected `catalog-375-dark.png`, `catalog-1280-light.png`, `empty-1280-light.png`, and `error-1280-light.png` under `test-results/story-3-2-discover-proof/` with clean intended geometry, states, console, and network evidence.
- Task 7 GATE: Node 24.18.0 / pnpm 11.17.0 passed in prescribed order — migration guard 10/10, Vitest 69 files / 1,055 tests, TypeScript, Playwright 150/150, Wrangler types, zero `worker-configuration.d.ts` drift, and production build.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Task 1: Added the public catalog DTO/query/cache ports, strict versioned cursor boundary, adjacent-page composition, exact Discover copy, and stable fail-open cache/fail-closed D1 application service without changing Story 3.1 listing commands.
- Task 2: Added forward-only migration 0010, atomic cache-generation triggers, split eligibility indexes, purpose-shaped catalog/sitemap D1 reads, two-stream keyset merge, accepted-Vote counts, and real-D1 coverage for eligibility, traversal, trigger rollback, plans, and active-set scale.
- Task 3: Added the isolated named Cache API adapter with canonical synthetic keys, generation isolation, 30-second/Deadline expiry, runtime projection validation, corrupt-entry deletion, `waitUntil` population, and privacy-safe fail-open warnings; Results cache-boundary tests remain green.
- Task 4: Added the one-column semantic Discover list, unchanged PollCard composition, exact empty/error surfaces, static 20-row skeletons, 48px real-link pagination with inert ends, and collapsed pagination token bindings without motion or raw HTML.
- Task 5: Added the thin SSR Discover route, validated self-canonical cursor pages, noindex/error contracts, no-JavaScript real links, and a bounded vanilla enhancement that preserves usable rows through loading, failure, history, and request races.
- Task 6: Added bounded fresh sitemap/robots endpoints, canonical/noindex metadata for Discover, voting, and Results surfaces, sitemap-index deferred work, and real-D1/Astro-route coverage for eligibility, privacy, multi-batch enumeration, method semantics, and mutation disappearance.
- Task 7: Added and visually inspected complete Discover browser proof, synchronized the public attendance-vs-Tally contract across changelog/PRD/UX/architecture, and completed the exact merge gate with no binding drift.

### File List

- `_bmad-output/implementation-artifacts/3-2-discover-catalog-sitemap.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md`
- `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md`
- `CHANGELOG.md`
- `src/modules/discovery/index.ts`
- `db/migrations/0010_discovery_catalog_projection.sql`
- `db/migrations.manifest.json`
- `src/adapters/d1/index.ts`
- `src/adapters/cache/discovery.ts`
- `src/components/discover-catalog.astro`
- `src/components/pagination.astro`
- `src/layouts/base-layout.astro`
- `src/pages/discover.astro`
- `src/pages/robots.txt.ts`
- `src/pages/sitemap.xml.ts`
- `src/pages/[reference].astro`
- `src/pages/[reference]/results.astro`
- `src/scripts/discover-catalog.ts`
- `src/styles/tokens.css`
- `tests/integration/discover-route.integration.test.ts`
- `tests/integration/discovery-catalog-adapter.integration.test.ts`
- `tests/integration/discovery-endpoints.integration.test.ts`
- `tests/integration/discovery-indexability.integration.test.ts`
- `tests/integration/polls-adapter.integration.test.ts`
- `tests/e2e/discover.spec.mjs`
- `tests/unit/discovery-cache-boundary.test.mjs`
- `tests/unit/discovery-cache.test.ts`
- `tests/unit/discover-components.test.mjs`
- `tests/unit/discover-enhancement.test.mjs`
- `tests/unit/discovery-endpoints.test.mjs`
- `tests/unit/discovery-sitemap.test.ts`
- `tests/unit/discovery.test.ts`

## Change Log

- 2026-08-03 — Story created from refreshed merged `origin/main` baseline `3cac4af060fc11904dbe5a84f11071822e120f45`; status set to ready-for-dev.
- 2026-08-03 — Implemented and validated Task 1 discovery catalog application contract and cursor/query policy.
- 2026-08-03 — Implemented and validated Task 2 discovery migration, revision triggers, D1 catalog/sitemap projections, and query-plan/scale proof.
- 2026-08-03 — Implemented and validated Task 3 revisioned named Cache API projection and isolation/failure tests.
- 2026-08-03 — Implemented and validated Task 4 Discover rows, pagination, skeletons, and token contracts with PollCard unchanged.
- 2026-08-03 — Implemented and validated Task 5 SSR Discover routing, canonical/error states, and bounded progressive enhancement.
- 2026-08-03 — Implemented and validated Task 6 sitemap/robots enumeration, protocol ceilings, and per-route canonical/noindex policy.
- 2026-08-03 — Completed Task 7 browser proof, documentation synchronization, exact merge gate, and moved the story to review.

### Review Findings

- [x] [Review][Patch] `mapDiscoveryCatalogRow` lacks length caps matching `validCatalogItem` [src/adapters/d1/index.ts:~241] — D1 rows with `canonical_reference.length > 128` or `question.length > 500` pass D1 validation, get cached, then fail cache re-read causing cache churn. Sync length caps with `validCatalogItem` in `src/adapters/cache/discovery.ts:75-79`.
- [x] [Review][Patch] `mergeDiscoveryStreams` does not deduplicate across concurrent D1 snapshots [src/adapters/d1/index.ts:1472] — If a poll's `deadline_ms` is set between the two parallel queries (no-deadline vs active-deadline), the same poll can appear in both streams and render twice. Track seen IDs in the merge loop.
- [x] [Review][Patch] `renderDiscoverySitemapXml` returns misleading `pollUrlCount` [src/modules/discovery/index.ts:509] — The computed `pollUrlCount` is always overwritten by `buildDiscoverySitemap`. Drop the dead computation from the return value.
- [x] [Review][Defer] Cache `Expires` header corrupts for extreme `expiresAtMs` timestamps [src/adapters/cache/discovery.ts:210] — `new Date().toUTCString()` produces "Invalid Date" for values beyond ~275,760. Investigate with Chunk 2 review.

## Review Findings (Chunk 2 — Cache + Routes)

- [x] [Review][Patch] Missing `cfContext`/`waitUntil` null guard [src/pages/discover.astro:47] — `Astro.locals.cfContext.waitUntil()` throws TypeError when context is missing in non-CF runtimes. Added optional chaining guard.
- [x] [Review][Patch] Uncaught `new URL()` in robots.txt GET [src/pages/robots.txt.ts:6] — Malformed `request.url` produces unhandled 500 without try/catch. Wrapped in try/catch matching sitemap pattern.
- [x] [Review][Patch] `validCatalogItem` permits empty `question` [src/adapters/cache/discovery.ts:78-79] — No `> 0` lower bound on cached question length. Added `item.question.length > 0` guard.
- [x] [Review][Patch] String concat canonical URL [src/pages/discover.astro:67-70] — Replaced with `new URL(validatedPath, Astro.url.origin).href` for proper origin-safe construction.
- [x] [Review][Defer] No D1 query timeout in sitemap build loop — 50 sequential D1 queries could exhaust Worker CPU wall clock; add AbortSignal timeout. Low priority, platform limitation.

## Review Findings (Chunk 3 — Components + Indexability)

- [x] [Review][Patch] 500 retry URL drops cursor [src/pages/discover.astro:75] — On D1 500 error with pagination, retry redirected to `/discover` instead of same cursor URL. Now only redirects to page 1 on invalid-cursor 400s.
- [x] [Review][Patch] `showFailure` leaves stale empty message [src/scripts/discover-catalog.ts:45] — Enhanced navigation failure could show both empty state and error message. Now removes `[data-discover-empty]` alongside `[data-discover-error]`.
- [x] [Review][Patch] `indexabilityNowMs` stale after POST [src/pages/[reference].astro:124] — Timestamp captured before Turnstile/vote processing caused stale effective status. Split into `closedCheckMs` (post-verification) and `indexabilityNowMs` (post-POST for robots meta).

## Deferred-work bundle follow-up — 2026-08-06

- Replaced the 49,998-Poll single-file failure point with a hybrid sitemap:
  catalogs through 45,000 Polls retain the original XML bytes, while larger
  catalogs receive strict opaque v1 keyset-range children from the same route.
- Scoped exact-once coverage to a stable root-and-children traversal. Each
  child is a fresh D1 read that excludes newly ineligible rows and cannot cross
  its encoded range; newly eligible rows outside the range wait for a refreshed
  root. Deleted boundaries remain safe, and an emptied non-static child returns
  `410 sitemap_range_gone`.
- Combined client disconnect with one ten-second whole-build deadline/signal,
  added pre/post-render and late-rejection checks, and retained the 500-page
  enumeration ceiling, per-document 50,000-URL/50 MiB enforcement, strict UUID
  range boundaries, and stable privacy-safe failure responses.
- Split sitemap persistence into explicit root/start/end/both row-value query
  shapes so bounded children range-seek the creation/UUID keyset. Real-D1 plan
  evidence and equal-timestamp fixtures prove the boundary contract; unit proof
  covers exactly 50,000 and 50,001 non-static child URLs.
- Hardened Cache API expiry arithmetic and four-digit HTTP-date handling. The
  deferred-work ledger remains orchestrator-owned and was not edited here.
- Node 24.18.0 follow-up proof passed migration guard 12/12, all 99 Vitest
  files / 1,480 tests, TypeScript, full Playwright 164/164, generated binding
  drift, the production build, and diff hygiene.
