---
baseline_commit: c137df7311e81f6e76ce90f255ab69fd4856f813
context_commit: c137df7
baseline: main @ c137df7 (post Story 2.1, Epic 2 in progress)
dependency_story: 2-1-per-poll-security-toggles
epic: 2 — Vote Security & Trust Surfaces
---

# Story 2.2: IP Checks

Status: done

## Story

As a Creator running a public poll,
I want repeat votes from the same network connection blocked,
So that ballot-stuffing from one machine across browsers doesn't corrupt my results.

## Acceptance Criteria

1. **Given** a Poll with IP Checks on, **When** a second Vote arrives from the same IP address — including from a different browser — **Then** the IP claim's unique constraint rejects the Vote inside the existing vote transaction and the Tally and representation version remain unchanged, **And** IPv4 uses the canonical full address while IPv6 is canonicalized to its `/64` before the secret-keyed digest is derived (FR-16, AR-5, AR-6, AD-7, AD-8).

2. **Given** a same-network, different-browser rejection classified to the IP claim (with no matching Session claim), **When** the rejection renders, **Then** it uses the complete IP-specific message: "**Someone on this connection already voted.** The Creator turned on one-vote-per-network, and it can't tell roommates apart. If that's you, ask them to send you the results instead.", **And** it never uses or conflates the Session Checks message for that different-browser/network collision (UX-DR19).

3. **Given** a Poll with Session Checks on and IP Checks off, **When** different browsers behind one shared IP each Vote, **Then** each browser may cast one Vote, **And** a repeat from the same browser is still rejected by the Session claim (FR-15, FR-16).

4. **Given** any IP-based admission or duplicate check, **When** identity leaves the bounded in-memory header-selection, normalization, and HMAC preparation step, **Then** only a `VOTE_DIGEST_SECRET`-keyed, purpose-domain-separated HMAC may cross into an application command, provider, persistence, log, telemetry record, error detail, export, response, voter surface, or Creator surface — `(Poll, "ip")` over the claim token for D1 and `(Poll, "rate_limit")` over the full-address token for the abuse floor — **And** the raw or normalized address appears in none of those destinations (AR-6, NFR-4, NFR-7, AD-8, AD-16).

## Tasks / Subtasks

- [x] Task 1: Add one provider-free network-identity policy and canonical claim contracts (AC: #1, #4)
  - [x] NEW `src/modules/voting/ip-address.ts` — expose a pure, Workers-safe normalizer (for example `normalizeIpIdentity`) that accepts one ASCII address literal and returns a discriminated success/failure result containing two ephemeral canonical tokens: `claimToken` and `rateLimitToken`. Never echo the source string. Reject before parsing unless length is `1..45` characters (the maximum single IPv6 literal with a dotted-decimal tail). No trimming, Node `net` dependency, environment lookup, logging, or third-party package.
  - [x] IPv4 contract: exactly four decimal octets in `0..255`; reject leading-zero ambiguity except the single octet `0`. The exact tokens are UTF-8 `claimToken = v4:<canonical dotted decimal>` and `rateLimitToken = v4-full:<canonical dotted decimal>`; both compare the complete address. Reject signs, shorthand/integer forms, ports, bracket syntax, whitespace, comma-separated/forwarded lists, and trailing data.
  - [x] IPv6 contract: accept valid compressed or expanded single literals case-insensitively; expand to eight 16-bit hextets. The exact tokens are `claimToken = v6:<first 16 lowercase hex digits>` (family tag plus the first four zero-padded hextets, no separators) and `rateLimitToken = v6-full:<all 32 lowercase hex digits>`. Equivalent spelling must yield byte-identical tokens; host-bit variants within one `/64` share only the claim token and retain different full-address limiter tokens.
  - [x] Treat IPv4-mapped IPv6 (`::ffff:a.b.c.d` and equivalent `::ffff:c000:0201` form) as the exact embedded IPv4 tokens (`v4:192.0.2.1` / `v4-full:192.0.2.1`) so representation changes cannot bypass either policy. A valid dotted-decimal tail outside `::ffff/96` is ordinary IPv6 and therefore yields `v6:`/`v6-full:` tokens. Reject zone identifiers, ports, lists, multiple `::` runs, overlong hextets, and every malformed form.
  - [x] Treat the token bytes above as stored-claim compatibility, not an incidental display format: changing them later resets HMAC comparability. Pin known-answer normalization and HMAC vectors in tests.
  - [x] Export canonical `VoterClaimCheckKind = "session" | "ip"` and `VoteDigestPurpose = VoterClaimCheckKind | "rate_limit"` contracts, plus separately branded `VoterClaimDigest` and `VoteRateLimitDigest` lowercase-64-hex types. Provide runtime validators/constructors; use the correct brand for digest output, claims/CastVote/D1 reads, and limiter keys. Remove repeated inline unions and never rely on a TypeScript cast as validation.

- [x] Task 2: Prepare purpose-separated privacy-safe IP digests for the abuse floor and CastVote (AC: #1, #4)
  - [x] NEW `src/lib/cloudflare-client-address.ts` — select and normalize the trusted identity at the inbound delivery boundary. Normally use `CF-Connecting-IP`. Under Cloudflare Pseudo IPv4 "Overwrite Headers", use a valid `CF-Connecting-IPv6` only when `CF-Connecting-IP` is a Class E pseudo address (`240.0.0.0/4`); otherwise ignore that auxiliary header. Missing/malformed guarded pairs fail as one unavailable identity.
  - [x] Never accept an address from FormData, query parameters, `X-Forwarded-For`, `X-Real-IP`, `CF-Pseudo-IPv4`, cookies, or client JavaScript. The Cloudflare delivery helper may call Task 1's pure policy but returns only its two canonical in-memory tokens or a static failure code; no error contains either header value.
  - [x] UPDATE `src/pages/[reference].astro` — for every **new** POST, attempt identity preparation regardless of the delivery snapshot's Toggle value. Derive two branded, purpose-separated HMACs with the existing digest primitive: `ipClaimDigest` from `[pollId, "ip", claimToken]` and `rateLimitDigest` from `[pollId, "rate_limit", rateLimitToken]`. Pass only the limiter digest to the best-effort limiter and only the claim digest (or `null`) to `castVote`. The route does not decide whether the claim is required; CastVote's fresh Poll snapshot does.
  - [x] Derive the two purposes independently. A `rateLimitDigest` failure always degrades only the limiter to fail-open and must not discard or block a valid `ipClaimDigest`. An `ipClaimDigest` failure does not borrow the limiter digest; it becomes `ip_check_unavailable` only when CastVote's authoritative snapshot requires IP Checks. Never substitute or reuse one purpose's digest for the other.
  - [x] Preserve replay ordering exactly: `findVoteBySubmission` adjudication happens before network preparation and before the rate limiter. A committed replay must not depend on the request's current network, consume limiter budget, or add IP identity to `normalizeVotePayload`.
  - [x] If the authoritative CastVote snapshot has IP Checks enabled and the digest is absent/invalid, return a stable internal `ip_check_unavailable` outcome before constructing a batch. The route maps only that code to HTTP 500, `private, no-store`, plain "Voting is unavailable.", no vote-rejection flag, and no D1 write. This covers a Toggle enabled after the delivery snapshot; it is not a voter-correctable 422.
  - [x] If the authoritative snapshot has IP Checks off, missing/malformed identity only makes the permissive limiter fail open; the Vote proceeds and creates no IP claim. A valid identity may still feed the baseline abuse floor, which remains active even when all Security Toggles are off (NFR-7, AD-16).
  - [x] UPDATE `src/adapters/rate-limit/index.ts` so `clientKey` is `VoteRateLimitDigest | null` and its provider key contains no raw/normalized address. The distinct brand prevents ordinary claim/limiter mix-ups at compile time; runtime-reject non-64-hex values by failing open without calling the provider. Keep missing binding/key and provider errors fail-open; it is never the integrity boundary. Full IPv6 addresses remain independent limiter sources, preserving the documented per-source-IP budget.

- [x] Task 3: Compose Session and IP claims in the existing CastVote batch (AC: #1, #3, #4)
  - [x] UPDATE `src/modules/voting/index.ts` — add `ipChecksEnabled` to `VotingPollSnapshot` and accept `ipDigest: VoterClaimDigest | null` in `CastVoteInput`. Do not pass raw addresses or unvalidated strings into the application command.
  - [x] Keep the current Session claim behavior unchanged. Runtime-validate every digest before a contribution is built. Add an IP `voter_claim` only when `ipChecksEnabled` is true; absent/malformed input returns `ip_check_unavailable` with no persistence.
  - [x] With both checks on, append both claims to the same existing `VotePersistenceBatch` in stable priority order: Session first, IP second. Vote, selections, all enabled claims, and the one `representation_version` increment commit or roll back together. Do not add a preflight claim read as a correctness check and do not reshape the transaction.
  - [x] Preserve all four composition states: all off creates no claims; Session-only creates one Session claim; IP-only creates one IP claim; both-on creates both. Enabling IP Checks mid-Poll affects later submissions only and never backfills or invalidates earlier Votes.
  - [x] The fresh `castVote.findPoll` read is the policy linearization point for a concurrent enable: a request whose authoritative read sees off is pre-enable and creates no IP claim; one whose read sees on must carry a valid digest and enforce the claim. Do not attempt commit-time Toggle re-reading without an architecture change.
  - [x] Add `VOTE_COPY.alreadyVotedIp` as the single source of the exact three-sentence copy in AC #2. Preserve `already_voted` for Session collisions and add a stable distinct `already_voted_ip` outcome for IP collisions.
  - [x] Make `AlreadyVotedError` carry its `checkKind`. CastVote maps `session` to the existing code/copy and `ip` to the new code/copy; an unclassified persistence failure stays the generic `vote_failed` outcome.

- [x] Task 4: Preserve atomicity while classifying the colliding claim (AC: #1, #2, #4)
  - [x] UPDATE `src/adapters/d1/index.ts` — add `ip_checks_enabled` to `createVotePersistence.findPoll`'s hand-written SELECT, row type, and `VotingPollSnapshot` mapping. The public `PollPage` and lifecycle mappings already carry this field; do not create a second source of truth.
  - [x] Keep `insertVote`'s one `db.batch` transaction. The existing primary key on `voter_claim (poll_id, check_kind, digest)` is the race-free integrity boundary; no migration or new uniqueness mechanism is needed.
  - [x] When the batch reports the voter-claim unique constraint, inspect only the batch's submitted claim contributions after rollback and query whether each candidate now exists. Classify in deterministic Session-then-IP order and throw `AlreadyVotedError(checkKind)`. This re-read explains the already-decided constraint failure; it does not decide acceptance.
  - [x] Ratified dual-collision precedence: if both submitted claims exist, report Session. This preserves the established same-browser result; a genuinely different browser has a different Session digest and therefore receives the IP-specific result.
  - [x] If no submitted candidate can be confirmed, or the adjudication read fails, do not guess a cause; surface the generic safe failure. Preserve existing submission-replay, closed-trigger, definition-change, and Poll-deletion precedence.
  - [x] Never bind an address into SQL. Assert stored claim values remain lowercase 64-hex HMACs and rejected batches leave Vote count, selections, claims, Tally, timestamps, and representation version unchanged.
  - [x] Defense in depth: `insertVote` validates every `voter_claim.digest` before preparing SQL even though the application uses a branded type. A forged/raw/malformed direct-adapter batch fails with a static error before `db.batch` and never calls D1.
  - [x] Apply the same runtime validation before `findClaim` and `findVoteSelectionByClaim` prepare or bind SQL. Forged/raw/malformed direct-adapter read input fails with a static result/error and never calls D1; add read-boundary tests.

- [x] Task 5: Render cause-specific SSR rejection states without misattributing a ballot (AC: #2, #3, #4)
  - [x] UPDATE `src/pages/[reference].astro` — map `already_voted_ip` to the existing rejection view with title prefix `Already voted`, alarm heading, and `body-lg` explanation. A rejected POST is HTTP 422 with `private, no-store` and the existing vote-rejection telemetry flag; a GET/HEAD preflight remains HTTP 200 with `private, no-store`.
  - [x] Include both duplicate codes in the read-only branch. The rejected selection is not a cast ballot: clear submitted selection markers, remove the Vote action, retain the Poll/question/options, and show the authorized Tally only when the Visibility policy allows.
  - [x] On GET and HEAD, prepare an IP digest only for a Poll whose IP Checks are enabled. Preserve priority exactly: valid Counted flash (GET only) → closed state → Session claim → IP claim. An IP-only match gets the IP-specific read-only state without another write; a missing/invalid identity leaves the readable Poll open. HEAD stays side-effect-free: it issues no cookie and never consumes the flash.
  - [x] Keep `YOUR BALLOT` resolution strictly Session-claim based and after Results authorization. An IP claim says only that a network voted; it must never reveal or attribute a roommate's selection. An IP-only read-only state may therefore have no `YOUR BALLOT` line.
  - [x] Preserve the established duplicate composition and breakpoint behavior; do not introduce an IP-only layout. On every POST rejection the outcome remains first in `<main>`, `tabindex="-1"`, focused on load, with `Already voted — {question}` leading the document title.
  - [x] Keep the full message in `VOTE_COPY`, never route-local text. Render the first sentence as the heading and the remaining two sentences as multi-sentence `body-lg` prose. No address, digest, inferred location, or security identifier appears in HTML or attributes.

- [x] Task 6: Harden the privacy and telemetry contracts (AC: #4)
  - [x] UPDATE `src/adapters/telemetry/index.ts` — extend the forbidden-key catalog with raw-IP and digest variants (for example `ip`, `ipAddress`, `ip_address`, `clientIp`, `cfConnectingIp`, `digest`, `ipDigest`). Keep the emitted record at exactly its existing six fields.
  - [x] UPDATE `tests/unit/telemetry.test.ts` — hostile input must prove neither a supplied raw address nor a claim digest, their values, nor their field names reach serialized telemetry.
  - [x] Do not add a second log for duplicate outcomes. In the real AstroContainer route integration test below, spy on Worker `console.error`/`console.log` while injecting identity/digest failures; captured serialization contains neither the fixture address nor digest. Normalization and identity-preparation errors carry stable codes only and never the rejected input.

- [x] Task 7: Prove policy, concurrency, privacy, and UX at the correct layers (AC: all)
  - [x] NEW `tests/unit/ip-address.test.ts` — known-answer/property coverage for exact `v4:`/`v4-full:`/`v6:`/`v6-full:` token bytes; IPv4 bounds/shorthand/leading zeros; compressed/expanded/mixed-case IPv6; same `/64` with distinct full host identity; mapped IPv4 in dotted and hex form; valid non-mapped dotted-decimal IPv6 tails; the 45-character bound; and rejected list/port/bracket/zone/whitespace/malformed shapes. Errors never contain input.
  - [x] NEW `tests/unit/cloudflare-client-address.test.ts` — direct IPv4/IPv6 selection; guarded Class-E Pseudo IPv4 + real `CF-Connecting-IPv6` recovery; missing/malformed pair failure; non-Class-E requests ignore auxiliary/spoofed `CF-Connecting-IPv6`; generic forwarded headers are ignored; no console method is called for hostile input.
  - [x] UPDATE `tests/unit/voting.test.ts` — all four toggle matrices; stable claim order; branded/runtime digest validation; missing IP digest returns `ip_check_unavailable` only when enabled; digest/persistence failures make no write; exact replay returns before identity work; Session/IP mapping/copy; dual-collision precedence; sequential before/after-enable policy snapshots.
  - [x] UPDATE `tests/unit/digest.test.ts` and `tests/unit/rate-limit.test.ts` — retain known-answer HMAC-SHA256 and Poll/check-kind separation; pin claim/`rate_limit` purpose-separated HMAC vectors; prove two IPv6 hosts in one `/64` share the claim digest but have different limiter digests; prove limiter keys contain only a validated `VoteRateLimitDigest` and malformed/raw keys fail open without a provider call.
  - [x] UPDATE `tests/integration/votes-adapter.integration.test.ts` — real D1 coverage for `ipChecksEnabled`; both-on commits two claims with one version bump; same normalized network/different browser rolls back atomically with IP cause; same browser/different IP remains Session cause; Session-only shared-network voters both succeed; IP-only blocks; same/different IPv6 `/64`; mid-Poll enablement; unclassified failures; existing replay/closed precedence.
  - [x] UPDATE `tests/integration/results-adapter.integration.test.ts`, `tests/integration/poll-lifecycle-adapter.integration.test.ts`, and `tests/integration/live-results-route.integration.test.ts` — their direct `VotePersistenceBatch` fixtures currently use human-readable fake digests. Construct valid values through the canonical digest validator/fixture helper, never a cast, so type hardening cannot be bypassed in adjacent tests.
  - [x] Add a real concurrent same-network test in workerd (both submissions reach `db.batch`; exactly one commits). Assert the losing batch leaves no Vote, selection, Session claim, or version bump, and persisted claim rows contain only 64-hex HMACs — never fixture addresses.
  - [x] NEW `tests/integration/vote-route.integration.test.ts` — follow the existing AstroContainer + real middleware/D1 route harness. Prove IP-on missing/malformed identity → `ip_check_unavailable`/500/no mutation; IP-off missing/malformed identity → limiter fail-open and accepted Vote; independent injected claim-digest and limiter-digest failures obey Task 2 without cross-purpose substitution; exact committed replay with missing/changed identity bypasses normalization and limiter; delivery snapshot off but authoritative CastVote snapshot on → 500/no mutation; invalid GET/HEAD stays readable; POST duplicate is 422 while GET/HEAD preflight is 200; priority is Counted → closed → Session → IP. Capture Worker console calls here for the Task 6 non-disclosure assertion.
  - [x] NEW `tests/e2e/ip-checks.spec.mjs` — use independent browser contexts/cookie jars with controlled Cloudflare headers. To exercise the constraint (not only GET preflight), load browser B's form **before** browser A commits, then submit B's stale form and prove 422 IP copy plus unchanged Tally/version; separately prove a later GET/HEAD preflight. Also prove same-browser Session copy, IP-off shared-network success, same-`/64` IPv6 rejection, title/focus/read-only state, visibility-aware Tally, no false `YOUR BALLOT`, `private, no-store`, and clean browser console.
  - [x] Inspect response HTML and headers and the D1 fixture directly: neither the supplied address, canonical token, nor derived digest appears in HTML, attributes, headers, logs, or non-claim storage; only the 64-hex claim value is present in `voter_claim`.
  - [x] Browser proof is required in both modes and responsive sizes: 375px dark and 1280px light under `test-results/story-2-2-ip-checks-proof/`. Setup/auth fixtures fail closed; no `test.skip`/`test.only`.
  - [x] Run the full local deploy gate under pinned Node 24.18.0 / pnpm 11.17.0: `pnpm migrations:guard` → `pnpm test` → `pnpm check` → `pnpm test:e2e` → `pnpm types` → `git diff --exit-code worker-configuration.d.ts` → `pnpm build:production`.

- [x] Task 8: Documentation and story record (AC: all)
  - [x] UPDATE `CHANGELOG.md` under `## [Unreleased]` with the user-visible IP Checks enforcement and cause-specific shared-network rejection.
  - [x] UPDATE this story's Dev Agent Record, File List, Completion Notes, and status through the BMad workflow; update only the Story 2.2 and timestamp hunks in `sprint-status.yaml`.
  - [x] No README, AGENTS.md, architecture-spine, binding, generated Worker type, or migration change is expected. If implementation changes those realities, stop and reconcile the governing document in the same PR rather than silently drifting.

### Review Findings

- [x] [Review][Patch] Reject zero-width IPv6 compression and lone trailing-colon aliases [src/modules/voting/ip-address.ts:178]
- [x] [Review][Patch] Validate the complete Pseudo IPv4 guarded pair, including a canonical primary and IPv6 auxiliary [src/lib/cloudflare-client-address.ts:20]
- [x] [Review][Patch] Preserve Session-first preflight precedence when the Session digest or claim lookup is unavailable [src/pages/[reference].astro:582]
- [x] [Review][Patch] Make digest runtime validators reject non-string values before regex validation [src/modules/voting/ip-address.ts:47]
- [x] [Review][Patch] Enforce canonical digest purposes and branded claim digests at application and D1 read ports [src/adapters/digest/index.ts:34; src/adapters/d1/index.ts:961]
- [x] [Review][Patch] Validate every voter claim before preparing or binding any D1 statement [src/adapters/d1/index.ts:714]
- [x] [Review][Patch] Complete the route integration privacy, independent-failure, replay, toggle-race, and priority matrix [tests/integration/vote-route.integration.test.ts:156]
- [x] [Review][Patch] Make E2E console, status, focus, visibility, and privacy proof observe the actual voter pages [tests/e2e/ip-checks.spec.mjs:34]
- [x] [Review][Patch] Complete the required unit, D1 matrix, read-boundary, and forced-concurrency proof [tests/integration/votes-adapter.integration.test.ts:667]

## Dev Notes

### Binding decisions resolved at story creation

| # | Ambiguity | Decision |
|---|---|---|
| D1 | Both Session and IP claims collide on one retry. | **Session-first.** The same browser receives the established personal Session message. A different browser has a distinct Session digest, so an IP-only collision receives the connection message. The unique constraint still decides rejection; the post-rollback read only classifies its cause. |
| D2 | The trusted Cloudflare identity is missing, malformed, or becomes required after the route's first read. | **CastVote returns `ip_check_unavailable` only when its authoritative snapshot has IP Checks on; the route maps it to infrastructure 500 with no write.** With IP off, the baseline limiter fails open. GET/HEAD remain readable. |
| D3 | IPv4-mapped IPv6 could bypass or over-collapse. | **Canonicalize mapped forms to the exact embedded `v4:` token.** Ordinary IPv6 uses the stable `v6:` + 16-hex `/64` token. |
| D4 | The limiter currently receives a raw full address, while IP claims require IPv6 `/64`. | **Derive two purpose-separated HMACs:** full IPv4/IPv6 for `rate_limit` (preserving the per-source-IP budget), and full IPv4 or IPv6 `/64` for the `ip` claim. Raw/normalized tokens are transient only; never reuse one digest across purposes. |
| D5 | Whether to detect IP claims on reads. | **Yes on GET and HEAD when the Toggle is on, after Counted/closed/Session priority.** This matches the existing Session preflight and avoids needless form completion. It never grants ballot ownership. |
| D6 | Claim retention after Poll close is unspecified. | **No new close-time purge.** Existing FK cascade removes claims when the Poll is deleted; a future retention decision may change that. Do not invent lifecycle semantics in this story. |
| D7 | A Vote races a Creator enabling IP Checks. | **The fresh CastVote Poll read is the policy linearization point.** A request that reads off is pre-enable; one that reads on enforces IP or returns `ip_check_unavailable`. |
| D8 | Cloudflare Pseudo IPv4 overwrites the primary address header. | **Recover `CF-Connecting-IPv6` only behind a Class-E `CF-Connecting-IP` guard.** Otherwise use the primary header and ignore auxiliary/forwarded values. |

### Current code seam → required change → invariant to preserve

| Current seam on `main @ c137df7` | Required Story 2.2 change | Preserve |
|---|---|---|
| `VotingPollSnapshot` and CastVote claims are Session-only. | Add `ipChecksEnabled` and an optional prepared IP digest; compose enabled claims. | Replay adjudication, validation order, one batch, one version bump. |
| `createVoteDigest` already HMACs JSON `[pollId, checkKind, token]` and accepts `"ip"`. | Widen the digest purpose to include `"rate_limit"`; feed byte-stable claim/full tokens and return the correct validated brand. | Existing Session/IP known-answer HMAC and secret failure behavior. |
| `voter_claim` already has PK `(poll_id, check_kind, digest)`. | Classify a failed candidate after rollback and carry kind in `AlreadyVotedError`. | The D1 unique constraint, not a read, decides acceptance. |
| `createVotePersistence.findPoll` omits `ip_checks_enabled`. | Select and map it. | All other snapshot fields and hand-written-query discipline. |
| The route passes raw `CF-Connecting-IP` into the rate limiter. | Convert the canonical full address to a Poll/`rate_limit`-scoped HMAC, separate from the claim digest. | Per-source-IP budget, replay-before-limiter, and limiter fail-open semantics. |
| GET probes only the Session claim; own-ballot lookup uses Session. | Add Session-first/IP-second read-only detection. | Keep own-ballot attribution Session-only and Results-authorized. |
| One generic `already_voted` route state exists. | Add `already_voted_ip` with exact copy and the same accessible composition. | Session copy/code and existing SSR/no-JS resilience. |
| Telemetry emits six allowlisted fields. | Expand forbidden-key tests/catalog for IP/digest vocabulary. | Exactly one record, no identity payload. |

### Architecture guardrails

- **AD-1 / AD-19:** the provider-free Voting module owns normalization policy, claim composition, and CastVote coordination. Routes parse/prepare and map outcomes; D1 and digest adapters implement ports. Do not put IP parsing rules or duplicate-vote policy inline in Astro frontmatter.
- **AD-7:** one constrained batch contains the Vote, selections, all enabled claims, and one representation increment. Any failure rolls the entire batch back.
- **AD-8 / AR-6:** normalize before HMAC; scope by Poll and purpose. Persist only the `"ip"` claim digest; the rate-limit provider receives only the distinct `"rate_limit"` digest. Never emit raw/normalized identity or reuse a digest across purposes.
- **AD-15:** one privacy-safe telemetry record per request. Duplicate 422s use the existing `voteRejection` signal; infrastructure failures fold to `result: "error"`.
- **AD-16 / AR-13:** `VOTE_RATE_LIMITER` is permissive, best-effort admission control. D1 uniqueness is the exact integrity boundary under concurrency.
- **AD-17 / FR-15:** toggles compose and tighten only. Enabling IP Checks affects subsequent submissions, with no historical backfill.
- **AD-21:** authorize Results visibility before reading a claim's selected options. Never use a shared-network claim to disclose a ballot.
- **AD-22:** the existing centralized CSRF chain remains unchanged. No IP-specific bypass or alternate endpoint.
- **AD-23:** one canonical claim-kind contract; no repeated unions across application and adapters.
- **NFR-4 / NFR-7:** privacy-safe enforcement remains lightweight; the baseline limiter continues even with all Security Toggles off.

### UX and accessibility contract

- Exact IP copy is the full three-sentence EXPERIENCE.md version in AC #2, not the Epic's abbreviated ellipsis. The Session copy remains: "**You've already voted here.** Enthusiasm noted; the Tally is unchanged."
- First sentence is the rejection heading; the remaining explanation is `body-lg` because all multi-sentence prose uses the 16px step. The existing outcome component already supplies alarm tone, line length, focus, and title behavior; reuse it.
- An already-voted render leaves the question and options visible but read-only, replaces the Vote action, and shows only Results the Visibility policy authorizes. It is never a blank page.
- The IP result says "connection" / "one-vote-per-network" and makes no claim of one human, household, or device. Shared IPv4, office NAT, and CGNAT can over-block; that is why the protection is opt-in.
- The blocked browser's submitted selection is not marked. A Session claim may identify the returning browser's prior ballot; an IP claim never does.
- Match the existing Session-duplicate composition at every breakpoint. Do not use Story 2.2 to redesign the broader duplicate/Tally large-screen layout.
- No trust badge in this story. Story 2.4 owns `ONE VOTE PER NETWORK` and the visible mechanism list.

### Current platform guidance

- The repository pins Astro 7.1.5, `@astrojs/cloudflare` 14.1.6, Wrangler 4.115.0, Vitest 4.1.10, Playwright 1.62.0, TypeScript 7.0.2, Node 24.18.0, and pnpm 11.17.0. Add no IP-parsing dependency for this bounded, exhaustively tested pure policy.
- Cloudflare D1 documents `batch()` as sequential and transactional: one statement failure aborts and rolls back the batch. Preserve the current transaction and use the unique constraint as the concurrency boundary.
- Workers Web Crypto supports `crypto.subtle` HMAC/SHA-256; the existing digest adapter already uses the correct primitive. Reuse it and never invent a fallback or plain hash.
- Cloudflare supplies `CF-Connecting-IP` for direct incoming traffic. Its Pseudo IPv4 "Overwrite Headers" mode moves the real IPv6 address to `CF-Connecting-IPv6`; recover that value only under the Class-E guard in Task 2. Cloudflare also documents different Worker-to-Worker behavior, so never generalize to arbitrary forwarded headers or claim this proves a person/device.

### Previous-story and git intelligence

- Verified baseline after refreshing `origin/main`: `c137df7311e81f6e76ce90f255ab69fd4856f813` (merge of Story 2.1). Story 2.2 is cut from that exact merged state.
- Story 2.1 shipped `ip_checks_enabled` storage, Creator controls, tighten-only writes, and voter-page projection, but intentionally left vote-time IP enforcement inert for this story. Its review requires persisted-truth re-renders, fail-closed E2E setup, one shared contract/copy source, real route matrices, and exact sprint bookkeeping.
- Story 1.5 established `voter_claim`, `submission_id` replay, keyed digesting, and the constrained batch. Story 2.2 extends those seams; it does not create a second acceptance path.
- Relevant recent history: `fe696a3` (Story 2.1 toggles); `bad6f6c` (post-failure D1 classification precedent); `186d504` (vote resilience/idempotency); `1a7ddfd` (accessible no-JS rejection states); `f250ee1` (replay-before-limiter and concurrency proof).
- `deferred-work.md` records that rotating `VOTE_DIGEST_SECRET` resets duplicate-claim comparability. IP claims inherit that accepted integrity trade-off; do not rotate the secret or redesign secret management here.

### Scope fences — do not build

- No migration: `0006_votes.sql` already supports `check_kind = "ip"` and `0009_security_toggles.sql` already stores the Toggle. Never edit committed migrations or the manifest for this story.
- No Creator-toggle work (2.1), Turnstile/CAPTCHA (2.3), trust badge (2.4), Voter Codes, VPN heuristics, comments, exports, Demo reset, or new vote-contribution extension.
- Preserve the Demo Poll's specified IP Checks-off configuration; Story 3.5 owns the Demo surface.
- Do not add IP identity to payload hashing, replay semantics, session cookies, public result projections, export DTOs, health probes, smoke tests, or binding configuration.
- Do not make rate-limit admission evidence of uniqueness, and do not silently disable IP enforcement to accommodate future Voter Codes.

### Project Structure Notes

- Keep provider-free normalization under `src/modules/voting/` and Cloudflare request-header selection in the inbound delivery helper `src/lib/cloudflare-client-address.ts`; `src/adapters/*` remains reserved for outbound-port implementations. The Astro route composes those boundaries but owns no parsing rule.
- Follow repository naming: kebab-case source files, Node-only pure tests as `tests/unit/*.test.ts`, real D1/workerd tests as `tests/integration/*.integration.test.ts`, and browser journeys as `tests/e2e/*.spec.mjs`.
- No topology or dependency addition is expected: the delivery helper calls inward to Voting policy, and Voting remains unaware of Cloudflare/Astro/D1.

### Expected implementation files

New:

- `src/modules/voting/ip-address.ts`
- `src/lib/cloudflare-client-address.ts`
- `tests/unit/ip-address.test.ts`
- `tests/unit/cloudflare-client-address.test.ts`
- `tests/integration/vote-route.integration.test.ts`
- `tests/e2e/ip-checks.spec.mjs`

Update:

- `src/modules/voting/index.ts`
- `src/adapters/d1/index.ts`
- `src/adapters/digest/index.ts`
- `src/adapters/rate-limit/index.ts`
- `src/adapters/telemetry/index.ts`
- `src/pages/[reference].astro`
- `tests/unit/voting.test.ts`
- `tests/unit/digest.test.ts`
- `tests/unit/rate-limit.test.ts`
- `tests/unit/telemetry.test.ts`
- `tests/integration/votes-adapter.integration.test.ts`
- `tests/integration/results-adapter.integration.test.ts`
- `tests/integration/poll-lifecycle-adapter.integration.test.ts`
- `tests/integration/live-results-route.integration.test.ts`
- `CHANGELOG.md`
- this story file and `sprint-status.yaml`

No expected change:

- `db/migrations/*` or `db/migrations.manifest.json`
- `wrangler.jsonc` or `worker-configuration.d.ts`
- `README.md`, `AGENTS.md`, architecture topology, or unrelated stories

### References

- [Source: _bmad-output/planning-artifacts/epics.md:55-110,152-162,587-642 — AR/NFR/UX definitions, Epic 2 objective, and Story 2.2]
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md:196-213,289-293,301-315,352 — FR-15/16, Demo setting, privacy/concurrency, SM-2]
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/addendum.md:17-20 — IPv4 full address, IPv6 /64, CGNAT trade-off]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md:46-64,120-167,244-301,318-353,368-405 — AD-1/2/7/8/15/16/17/19/21/22/23 and conventions]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md:70-92,176-188,217-264,293-317,330-358 — exact copy, state, focus, trust and UJ-2]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md:463-497 — rejection tone and body-lg prose]
- [Source: _bmad-output/implementation-artifacts/2-1-per-poll-security-toggles.md:108-190 — current seams, scope handoff, review lessons]
- [Source: _bmad-output/implementation-artifacts/1-5-cast-a-vote-that-counts-exactly-once.md — constrained transaction, digest and privacy foundation]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — digest-secret rotation and replay pre-read trade-offs]
- [Source: src/modules/voting/index.ts; src/adapters/d1/index.ts; src/adapters/digest/index.ts; src/adapters/rate-limit/index.ts; src/adapters/telemetry/index.ts; src/pages/[reference].astro — verified current code on baseline]
- [Cloudflare D1 Database batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [Cloudflare Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Cloudflare HTTP request headers — CF-Connecting-IP](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip)

## Dev Agent Record

### Agent Model Used

Grok 4.5 (xAI) via bmad-dev-story

OpenAI Codex (GPT-5) via bmad-code-review (adversarial review and remediation)

### Debug Log References

- Unit gate: `pnpm test:unit` — 678 tests passed (including malformed IPv6/Pseudo IPv4 and hostile digest regressions).
- Integration gate: `pnpm test:integration` — 178 tests passed (D1 read/write boundaries, forced concurrency, and the complete 17-case vote-route matrix).
- Full suite: `pnpm test` — 856 tests passed across 51 files.
- Typecheck: `pnpm check` clean; `pnpm types` + `worker-configuration.d.ts` drift-free.
- E2E: `playwright test tests/e2e/ip-checks.spec.mjs` — 5/5 passed; full `pnpm test:e2e` — 133/133 passed; four proof screenshots visually inspected under `test-results/story-2-2-ip-checks-proof/`.
- Production build: `pnpm build:production` succeeded.
- Migration guard: `pnpm migrations:guard` ok (no migration changes).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Implemented pure `normalizeIpIdentity` with exact `v4:`/`v4-full:`/`v6:`/`v6-full:` token contracts, IPv4-mapped collapse, and branded `VoterClaimDigest` / `VoteRateLimitDigest` constructors (Task 1).
- Inbound `selectCloudflareClientAddress` recovers Class-E Pseudo IPv4 via `CF-Connecting-IPv6` only; purpose-separated HMACs feed the limiter and CastVote independently; replay remains before network prep (Task 2).
- CastVote composes Session-then-IP claims from the authoritative snapshot; missing IP digest when enabled returns `ip_check_unavailable`; `AlreadyVotedError` carries `checkKind` with exact IP copy in `VOTE_COPY.alreadyVotedIp` (Task 3).
- D1 `findPoll` selects `ip_checks_enabled`; claim-unique failures classify Session-first after rollback; digests validated before SQL on write and read paths (Task 4).
- Route maps `already_voted_ip` / 422, GET/HEAD IP preflight after Counted→closed→Session priority, no YOUR BALLOT from IP claims, infrastructure 500 for `ip_check_unavailable` (Task 5).
- Telemetry forbidden-key catalog expanded for IP/digest vocabulary; six-field emit contract unchanged (Task 6).
- Layered tests: unit known-answers, integration concurrent race + toggle matrix, AstroContainer route harness, Playwright dual-context proof with CF-Connecting-IP injection (Task 7).
- CHANGELOG Unreleased entry for user-visible IP Checks enforcement (Task 8).
- Adversarial review closed all nine patch findings: strict IPv6/Pseudo IPv4 boundaries, primitive-only digest validation, canonical branded ports, pre-SQL D1 validation, Session-first degraded preflight, complete route/D1 concurrency matrices, and non-vacuous browser/privacy proof.

### File List

- src/modules/voting/ip-address.ts
- src/lib/cloudflare-client-address.ts
- src/modules/voting/index.ts
- src/adapters/digest/index.ts
- src/adapters/rate-limit/index.ts
- src/adapters/d1/index.ts
- src/adapters/telemetry/index.ts
- src/pages/[reference].astro
- tests/unit/ip-address.test.ts
- tests/unit/cloudflare-client-address.test.ts
- tests/unit/digest.test.ts
- tests/unit/rate-limit.test.ts
- tests/unit/telemetry.test.ts
- tests/unit/voting.test.ts
- tests/integration/votes-adapter.integration.test.ts
- tests/integration/vote-route.integration.test.ts
- tests/integration/results-adapter.integration.test.ts
- tests/integration/poll-lifecycle-adapter.integration.test.ts
- tests/integration/live-results-route.integration.test.ts
- tests/e2e/ip-checks.spec.mjs
- CHANGELOG.md
- _bmad-output/implementation-artifacts/2-2-ip-checks.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

### Change Log

- 2026-08-03 — Story created from the refreshed merged Story 2.1 baseline. Status: ready-for-dev.
- 2026-08-03 — Implemented IP Checks enforcement end-to-end: normalization, purpose-separated digests, CastVote composition, D1 classification, SSR rejection states, telemetry privacy, and full unit/integration/e2e proof. Status: review.
- 2026-08-03 — Completed full adversarial review, applied all nine approved patches, visually inspected responsive browser proof, and passed the exact local deploy gate. Status: done.
