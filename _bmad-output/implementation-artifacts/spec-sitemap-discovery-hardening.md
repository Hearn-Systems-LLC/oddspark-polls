---
title: 'Sitemap and Discovery hardening'
type: 'chore'
created: '2026-08-06T04:00:00-04:00'
status: 'done'
baseline_revision: '3ec205f2cea0a376345a44e6c188fd1f3191dacb'
final_revision: '82064c3d73eaf41803f40dc0542fc6920f02b0ce'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md'
warnings: [multiple-goals]
---

<intent-contract>

## Intent

**Problem:** Discovery's single-file sitemap fails closed above 49,998 eligible Polls, its sequential D1 enumeration has no request budget, extreme cache timestamps can emit an invalid HTTP date, and moderation no-change classification can throw after a future Discovery-state addition.

**Approach:** Preserve the current small-catalog sitemap while introducing bounded, opaque keyset-range sitemap children before the protocol ceiling; add one whole-build abort budget; and harden the two defensive adapter boundaries without changing product policy.

## Boundaries & Constraints

**Always:** D1 remains fresh truth; include only canonical literal-Listed/effectively-open Polls plus `/` and `/discover`; use request origin, UTF-8 XML, `no-store`, strict bounded tokens, keyset order, per-file 50,000-URL/50 MiB limits, and privacy-safe stable errors. Keep Discovery provider-free and preserve current moderation outcomes for known states.

**Block If:** Correct range coverage would require offset pagination, a schema migration, weakening freshness, or claiming cancellation that the D1 API cannot perform.

**Never:** Edit `deferred-work.md`; expose internal IDs outside opaque sitemap tokens; cache sitemap output; add a binding/dependency; broaden moderation SQL to a future state; clamp a Deadline later; emit partial XML or Poll references in errors/logs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Small sitemap | At most 45,000 eligible Polls | Existing `/sitemap.xml` URL set with two static URLs and all Poll URLs | Capacity/byte overflow is `503 sitemap_capacity_exceeded` |
| Large sitemap | More than 45,000 eligible Polls | Root sitemap index; same-route `?range=` children cover explicit `(startExclusive, endInclusive]` key ranges, with static URLs only in the first child | Invalid/duplicate/extra token input is `400 invalid_sitemap_range`; oversized index/child is fail-closed |
| Dataset mutation | Insert, delete, unlist, delist, close, or Deadline crossing between index and child reads | Range boundaries prevent overlap/spill and every response re-applies live eligibility | A shard that grows past its headroom returns capacity error, never truncation |
| Enumeration timeout | One 10-second whole-build signal aborts before or during a page | Stop awaiting, start no further page, return no partial XML | `503 sitemap_generation_aborted`; in-flight D1 cancellation is not claimed |
| Extreme cache expiry | Unsafe or non-HTTP-date `expiresAtMs` | Unsafe expiry skips population; representable lifetime keeps bounded max-age and omits an invalid `Expires` header | Cache remains fail-open and never emits `Invalid Date` |
| Future Discovery state | Runtime-recognized state not in current transition set | Moderation no-change returns `invalid_transition` with no state/audit/revision write | Unknown corrupt values and impossible known-state guard mismatches still throw |

</intent-contract>

## Code Map

- `src/modules/discovery/index.ts` -- sitemap range codec, XML builders, capacity and abort policy.
- `src/adapters/d1/index.ts` -- two-stream keyset sitemap persistence and moderation no-change classification.
- `src/pages/sitemap.xml.ts` -- root/child HTTP mapping and 10-second signal.
- `src/adapters/cache/discovery.ts` -- Cache API expiry/header boundary.
- `tests/unit/discovery-sitemap.test.ts` -- range, index, capacity, and abort matrix.
- `tests/integration/discovery-endpoints.integration.test.ts` -- real D1 root/child freshness and HTTP semantics.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/discovery/index.ts` -- add strict v1 range parsing/encoding, hybrid root index at 45,000 Polls, range-bounded child URL sets, 500-page enumeration ceiling, XML byte/entry checks, signal-aware page waits plus pre/post-render deadline checks, and a typed gone result for an empty non-static child.
- [x] `src/pages/sitemap.xml.ts` -- parse only the canonical no-query or single `range` request inside the route error boundary, combine client disconnect with a 10-second timeout/deadline contract, and map invalid/gone/abort/capacity results to stable `400/410/503` no-store responses.
- [x] `src/adapters/cache/discovery.ts` -- validate safe expiry arithmetic and construct `Expires` only for a valid four-digit-year HTTP date.
- [x] `src/adapters/d1/index.ts` -- select explicit root/start/end/both sitemap query shapes for real keyset range seeks, reject non-UUID boundary IDs before token construction, and classify a recognized future state as `invalid_transition` while retaining malformed/current-state anomaly throws.
- [x] `tests/unit/discovery-sitemap.test.ts`, `tests/unit/discovery-cache.test.ts`, `tests/integration/discovery-endpoints.integration.test.ts`, `tests/integration/moderation-persistence.integration.test.ts`, `tests/unit/discovery-endpoints.test.mjs`, `tests/e2e/administrator-moderation.spec.mjs` -- prove the matrix, including boundary deletion/empty-child behavior, active Deadline exclusion, abort/deadline checks, strict ID/date guards, and following index children where needed.
- [x] `CHANGELOG.md`, `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md`, `_bmad-output/implementation-artifacts/3-2-discover-catalog-sitemap.md`, `_bmad-output/implementation-artifacts/3-3-administrator-delisting.md` -- synchronize current truth and append follow-up evidence without rewriting history or the deferred ledger.

**Acceptance Criteria:**
- Given an eligible dataset that does not change during one root-and-children traversal and remains within the 500-page operational bound, when the sitemap set is resolved, then every eligible canonical URL appears exactly once, excluded Polls never appear, and no document exceeds protocol limits.
- Given eligibility changes between independently fresh root or child requests, when a referenced child is resolved, then it never exposes an ineligible Poll or crosses its encoded range; newly eligible Polls outside that range are incorporated by the next root index, and an emptied non-static child returns a stable gone response rather than invalid XML.
- Given an abort, malformed range, oversized response, or persistence failure, when the endpoint responds, then it emits the stable status/code with `no-store`, no partial XML, and no private identifier.
- Given ordinary Discovery and moderation inputs, when focused and full regression gates run, then existing cache freshness, sitemap mutation, and known-state moderation semantics remain unchanged.

## Spec Change Log

### 2026-08-06 — Review repair 1

- Trigger: adversarial review found that the acceptance criteria promised cross-request exact-once coverage even though root and child documents intentionally use independent fresh D1 reads without a shared snapshot.
- Amendment: scoped exact-once to a stable dataset during one traversal and made concurrent eligibility semantics explicit; added guards for non-UUID boundary rows, emptied children, and deadline checks around synchronous rendering.
- Avoids: claiming snapshot consistency that the architecture does not provide, emitting an invalid empty URL set, constructing an unresolvable child token, or returning success after the whole-build deadline.
- KEEP: preserve small-catalog byte compatibility, the 45,000-Poll hybrid threshold, strict same-route v1 ranges, live eligibility exclusion, stable privacy-safe errors, safe cache dates, known-state moderation behavior, and the no-ledger boundary.

### 2026-08-06 — Review repair 2

- Trigger: the second blind/edge pass found a deadline-rejection race, missing client-disconnect propagation, and insufficient evidence for the new range-query shape and exact child ceiling.
- Amendment: normalized late persistence rejection after expiry to the stable abort result; combined the request and timeout signals; replaced nullable OR range predicates with explicit root/start/end/both row-value query shapes; added real-D1 plan/equal-timestamp evidence, exact 50,000/50,001 child tests, runtime abort mapping, isolated future-state injection, and strict E2E `410` assertions.
- Avoids: generic `500` responses after budget expiry, abandoned-client work continuing for the full timer, range-bound index scans, child-limit off-by-one regressions, shared test-state mutation, or unrelated `410` responses hiding E2E failures.
- KEEP: do not sign tokens or add a secret/dependency, do not claim D1 in-flight cancellation, and do not replace fresh D1 enumeration with cached or persisted sitemap state in this bundle.

## Review Triage Log

### 2026-08-06 — Review pass
- intent_gap: 0
- bad_spec: 1: (high 0, medium 1, low 0)
- patch: 4: (high 0, medium 2, low 2)
- defer: 2: (high 0, medium 2, low 0)
- reject: 6: (high 0, medium 3, low 3)
- addressed_findings:
  - `[medium]` `[bad_spec]` Scoped exact-once acceptance to a stable traversal, documented independent fresh-child semantics, and carried positive implementation boundaries plus concrete guard repairs into re-derivation.

### 2026-08-06 — Review pass 2
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 4, low 4)
- defer: 1: (high 0, medium 1, low 0)
- reject: 3: (high 0, medium 1, low 2)
- addressed_findings:
  - `[medium]` `[patch]` Combined client disconnect and timeout signals and normalized a page rejection observed after the absolute deadline to `sitemap_generation_aborted`.
  - `[medium]` `[patch]` Replaced nullable OR range predicates with explicit keyset query shapes and proved equal-timestamp boundaries plus index use against real D1.
  - `[medium/low]` `[patch]` Added exact non-static child ceilings, runtime route abort mapping, strict E2E gone-response assertions, and an isolated future-state test seam.
  - `[medium]` `[defer]` Root index generation still enumerates fresh eligible rows; the explicit 10-second and 500-page limits bound that work, while eliminating enumeration requires a different persisted or asynchronous indexing architecture outside the frozen intent.

### 2026-08-06 — Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 11: (high 0, medium 4, low 7)
- addressed_findings:
  - none

## Design Notes

Range tokens are opaque/untrusted transport, not authorization. Each child owns keys after its newer boundary through its older boundary; comparing order keys stops correctly even when the exact boundary row disappears. A 45,000-Poll shard leaves 4,998 URL slots in the first file after the two static URLs, so concurrent listings within that range fail closed only after consuming explicit headroom. Root and child requests do not share a D1 snapshot: every child freshly excludes ineligible rows, while newly eligible rows outside its encoded range appear after the crawler refreshes the root index.

## Verification

**Commands:**
- `pnpm test -- tests/unit/discovery-sitemap.test.ts tests/unit/discovery-cache.test.ts tests/integration/discovery-endpoints.integration.test.ts tests/integration/moderation-persistence.integration.test.ts` -- focused behavior passes.
- `source /Users/justin/.nvm/nvm.sh && nvm use --silent && pnpm migrations:guard && pnpm test && pnpm check && pnpm test:e2e && pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` -- pinned exact repository gate passes.

**Complete local release gate (2026-08-06):** Node 24.18.0; migration guard `12/12`; Vitest `99/99` files and `1,480/1,480` tests; TypeScript; Playwright `164/164` in 13.1 minutes; generated binding types with no drift; production build; `git diff --check`; and the baseline-to-worktree deferred-ledger comparison all passed.

**Residual risk:** Root index generation still enumerates the fresh eligible catalog before it can encode child boundaries. The ten-second and 500-page limits fail closed and bound the request, but eliminating root enumeration would require a persisted or asynchronous indexing design outside this bundle. Range tokens remain opaque untrusted transport rather than authorization; strict canonical decoding and bounded child work are the defense. Nothing was pushed or deployed, and the deferred-work ledger remains untouched.

## Auto Run Result

Status: done

_Appended by the bmad-loop orchestrator (missing-marker repair, #224): the session finalized this spec's frontmatter without its `## Auto Run Result` marker, so the orchestrator synthesized the result from the frontmatter and appended this section._

Synthesized by the bmad-loop orchestrator from frontmatter status `done` for story `dw-sitemap-discovery-hardening` (session finalized the spec without appending its marker).
