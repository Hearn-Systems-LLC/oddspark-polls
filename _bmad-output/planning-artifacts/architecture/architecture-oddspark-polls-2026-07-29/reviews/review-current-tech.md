# Current-technology review

Reviewed: 2026-07-29
Target: `ARCHITECTURE-SPINE.md`
Lens: named technology, version, starter, runtime, managed-service, and
cross-package compatibility claims

## Verdict

**PASS — VERIFIED AFTER AMENDMENT.** The selected Astro-on-Cloudflare stack is
current, its pinned package versions are mutually compatible, and all four
previously reported technology findings are now resolved. No critical or high
current-technology issue remains.

Context7 was requested first but no Context7 tools were available in this
reviewer context. Per project instructions, verification used only official
vendor documentation, official project documentation, and live npm registry
metadata.

## Verification pass

| Prior finding | Result | Amended spine evidence |
| --- | --- | --- |
| Better Auth requires an explicit Workers compatibility flag | **Resolved.** AD-14 now requires `nodejs_compat`, and the configuration convention puts it in `wrangler.jsonc`. | Lines 225–235 and 333–348 |
| Conditional zero-row D1 mutation did not guarantee batch rollback | **Resolved.** AD-7 now models redemption as a unique insert with foreign keys, so invalid or already-redeemed codes produce a failing statement and roll back the batch. | Lines 115–135 |
| Rate Limiting and Turnstile had conflated failure semantics | **Resolved.** AD-16 now treats Rate Limiting as permissive/best-effort and enabled Turnstile as mandatory, pre-mutation, fail-closed validation. | Lines 248–258 |
| D1 Time Travel recovery window was unspecified | **Resolved.** AD-15 now states seven days on Workers Free and thirty days on Workers Paid. | Lines 237–246 |

The narrower `nodejs_als` alternative is no longer relevant because the spine
has intentionally selected the fully documented `nodejs_compat` path. The D1
redemption amendment no longer relies on inspecting `changes` after a
transactional `batch()` has committed.

## Remaining critical

None.

## High (original findings, all resolved)

### H1 — Better Auth on Workers requires a compatibility flag that the stack does not bind [RESOLVED]

- **Location:** Stack lines 283–301; AD-14 lines 209–218; Better Auth choice at
  lines 77–88.
- **Finding:** The stack pins only `compatibility_date: 2026-07-29`. Better
  Auth's Cloudflare Workers instructions state that it uses
  `AsyncLocalStorage` and requires either `compatibility_flags:
  ["nodejs_compat"]` or the narrower `["nodejs_als"]`. Cloudflare documents that
  `nodejs_compat` is not enabled merely by choosing a recent compatibility date.
- **Impact:** A builder following the spine can produce a Worker that fails to
  bundle or run the auth path even though every package version is correct.
- **Evidence:**
  - [Better Auth installation — Cloudflare Workers and AsyncLocalStorage](https://better-auth.com/docs/installation)
  - [Cloudflare compatibility flags — `nodejs_compat` is explicit](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)
  - [Cloudflare compatibility dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)
- **Disposition:** **Autofix.** Add the selected flag to AD-14/Stack. Prefer
  `nodejs_compat` unless the scaffold proves `nodejs_als` alone against the
  production bundle; keep the compatibility date current independently.

### H2 — A conditional `UPDATE` that affects zero rows does not abort a D1 `batch()` [RESOLVED]

- **Location:** AD-7 lines 113–122.
- **Finding:** D1 `batch()` is a transaction and rolls the entire sequence back
  when a statement fails. However, SQLite explicitly treats a conditional
  `UPDATE` that matches no row as a successful statement affecting zero rows.
  Therefore a Voter Code redemption expressed only as
  `UPDATE ... WHERE unused` can return `changes: 0` while later statements in
  the same batch still commit. The phrase “guarded by unique or conditional SQL
  constraints” does not bind the missing failure mechanism.
- **Impact:** Two independently implemented vote paths can diverge, and one can
  accept a Vote without actually redeeming the required Voter Code—the exact
  partial-acceptance case AD-7 says it prevents.
- **Evidence:**
  - [D1 `batch()` semantics — rollback requires a statement failure](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
  - [SQLite `UPDATE` — zero matching rows is not an error](https://www.sqlite.org/lang_update.html)
  - [SQLite trigger `RAISE(ABORT, ...)`](https://www.sqlite.org/lang_createtrigger.html#the_raise_function)
- **Disposition:** **Discuss, then autofix.** Bind one supported atomic pattern:
  a schema constraint/trigger that raises on failed conditional redemption, or a
  single SQL mutation whose failure is enforced inside SQLite. Do not rely on
  inspecting `changes` after `batch()` because the transaction has already
  committed.

### H3 — Rate Limiting is best-effort; Turnstile validation is not [RESOLVED]

- **Location:** AD-16 lines 231–239; security sequence lines 124–139; adapter
  seed lines 321–327.
- **Finding:** Cloudflare accurately describes the Workers Rate Limiting API as
  local to a Cloudflare location, permissive, eventually consistent, and
  unsuitable for exact accounting. In contrast, Turnstile requires mandatory
  server-side Siteverify validation; tokens expire after five minutes and are
  single-use. Grouping both services as “best-effort admission controls” leaves
  fail-open versus fail-closed behavior ambiguous and can cause a builder to
  treat a failed or skipped Siteverify call like a permissive counter.
- **Impact:** A vote or poll-creation route may proceed without a valid
  challenge even when Turnstile is enabled.
- **Evidence:**
  - [Workers Rate Limiting — locality and accuracy](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
  - [Turnstile server-side validation — mandatory, expiring, single-use](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- **Disposition:** **Autofix.** Split the rule: Rate Limiting is best-effort and
  never an integrity control; enabled Turnstile is a pre-mutation, server-side,
  fail-closed admission check with hostname/action validation and explicit
  handling of transient Siteverify errors. D1 remains the final Vote/Voter Code
  integrity authority.

## Medium

### M1 — The Better Auth + D1 + Astro combination is supported, but its binding lifecycle is not fixed

- **Location:** AD-4 lines 77–88; structural seed lines 305–327.
- **Finding:** Better Auth 1.5+ documents first-class D1 support by passing the
  request's D1 binding to `betterAuth`, and Better Auth separately documents a
  first-class Astro handler. The sources establish fit, but the spine does not
  say how the request-scoped Workers binding reaches the auth adapter. A
  module-scope recipe copied from a Node-hosted Astro example can be
  incompatible with a request-bound D1 environment.
- **Evidence:**
  - [Better Auth 1.5 — first-class Cloudflare D1](https://better-auth.com/blog/1-5)
  - [Better Auth Astro integration](https://better-auth.com/docs/integrations/astro)
  - [Astro Cloudflare runtime and bindings](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- **Disposition:** **Defer with a proof gate.** Because auth is already tagged
  `[ASSUMPTION]`, require a scaffold smoke test covering Worker build, OAuth
  callback, session creation/read, and D1 migrations before adopting it. If
  adopted, bind request-scoped D1 injection in the auth adapter.

### M2 — “D1 Time Travel is the recovery floor” omits the plan-dependent recovery window [RESOLVED]

- **Location:** AD-15 lines 220–229.
- **Finding:** Time Travel is a valid recovery mechanism, but the retention
  window is seven days on Workers Free and thirty days on Workers Paid. Calling
  it the recovery floor without the window and a restore drill lets operations
  infer a stronger recovery posture than the platform supplies.
- **Evidence:**
  - [D1 Time Travel retention](https://developers.cloudflare.com/d1/platform/release-notes/#2023-07-27)
  - [Wrangler Time Travel restore command](https://developers.cloudflare.com/d1/wrangler-commands/#d1-time-travel-restore)
- **Disposition:** **Autofix.** State the 7/30-day floor, select the production
  plan's actual window, and require a restore-and-R2-reconciliation drill.

## Low

### L1 — Name the Playwright package, not only the product

- **Location:** Stack line 298.
- **Finding:** `1.62.0` is current for `@playwright/test`; “Playwright” is
  technically true but leaves package selection ambiguous.
- **Disposition:** **Autofix.** Rename the row to `@playwright/test`.

## Verified-current matrix

| Claim | Result | Evidence |
| --- | --- | --- |
| Official Cloudflare Astro Workers starter exists | **Verified**. C3 scaffolds Astro on Workers with `npm create cloudflare@latest -- --framework=astro`. | [Cloudflare Astro Workers guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/) |
| Astro SSR deploys as a Worker with Cloudflare bindings | **Verified**. The adapter sets server output and supports bindings; the chosen single-Worker topology fits. | [Cloudflare Astro Workers guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/), [Astro Cloudflare deployment](https://docs.astro.build/en/guides/deploy/cloudflare/) |
| Astro `7.1.5` + `@astrojs/cloudflare` `14.1.6` + Wrangler `4.115.0` | **Verified compatible**. Adapter peers are Astro `^7.0.0` and Wrangler `^4.83.0`; Astro requires Node `>=22.12.0`. | [astro npm metadata](https://registry.npmjs.org/astro/latest), [`@astrojs/cloudflare` npm metadata](https://registry.npmjs.org/%40astrojs%2Fcloudflare/latest), [wrangler npm metadata](https://registry.npmjs.org/wrangler/latest) |
| Node.js LTS `24.18.0` | **Verified current LTS** (`Krypton`, released 2026-06-23). | [Node distribution index](https://nodejs.org/dist/index.json) |
| pnpm `11.17.0` | **Verified current**; engine `node >=22.13`, satisfied by Node 24.18.0. | [pnpm npm metadata](https://registry.npmjs.org/pnpm/latest) |
| TypeScript `7.0.2` | **Verified current**; no conflicting peer range in Astro or the adapter. | [TypeScript npm metadata](https://registry.npmjs.org/typescript/latest) |
| Better Auth `1.6.25` | **Verified current stable** and documented with first-class D1 and Astro support; **configuration gap H1 remains**. | [better-auth npm metadata](https://registry.npmjs.org/better-auth/latest), [D1 support](https://better-auth.com/blog/1-5), [Astro integration](https://better-auth.com/docs/integrations/astro) |
| Zod `4.4.3` | **Verified current**. | [zod npm metadata](https://registry.npmjs.org/zod/latest) |
| Vitest `4.1.10` + `@cloudflare/vitest-pool-workers` `0.19.0` | **Verified compatible**. The pool peers on Vitest/runner/snapshot `^4.1.0`; Vitest accepts Node `>=24`. | [vitest npm metadata](https://registry.npmjs.org/vitest/latest), [Cloudflare pool npm metadata](https://registry.npmjs.org/%40cloudflare%2Fvitest-pool-workers/latest) |
| `@playwright/test` `1.62.0` | **Verified current**; Node `>=20`, satisfied. | [`@playwright/test` npm metadata](https://registry.npmjs.org/%40playwright%2Ftest/latest) |
| fast-check `4.9.0` | **Verified current**; Node requirement satisfied. | [fast-check npm metadata](https://registry.npmjs.org/fast-check/latest) |
| Workers compatibility date `2026-07-29` | **Verified correct current-date practice**. It does not substitute for explicit compatibility flags. | [Cloudflare compatibility dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/) |
| `wrangler.jsonc` as binding truth and generated types in CI | **Verified current Cloudflare recommendation**. | [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [`wrangler types`](https://developers.cloudflare.com/workers/wrangler/commands/workers/#types) |
| D1 `batch()` is transactional | **Verified with qualification**: statements are sequential and the sequence rolls back when one fails; see H2. | [D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) |
| R2 adoption/outbox is a valid cross-resource pattern | **Verified fit**. R2 operations are strongly consistent, but R2 and D1 have no shared transaction; an outbox remains appropriate. | [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/), [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) |
| Rate Limiting binding is a best-effort admission control | **Verified**. It is location-local, permissive, and eventually consistent. | [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) |
| Turnstile is suitable before mutation | **Verified with qualification**: enabled challenges require mandatory server-side validation; see H3. | [Turnstile Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) |
| Workers Logs, D1, and R2 fit the fixed-cost ceiling | **Verified for fixed cost**. Workers Paid has a $5 monthly minimum; D1 and R2 have included usage but can add variable charges beyond it. | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |

## Close

No named package is stale, and no package-to-package incompatibility was found.
The architecture can retain Astro 7, the Cloudflare adapter, Better Auth 1.6,
D1, R2, Turnstile, the Rate Limiting binding, and the listed test stack. M1
correctly remains a proof-gated auth assumption rather than being silently
treated as settled. The remaining Playwright package-name precision note is low
severity and does not block the gate.
