# Reviewer Gate — Rubric Walker

**Artifact:** `ARCHITECTURE-SPINE.md`
**Intent:** Finalize-time independent review
**Date:** 2026-07-29
**Verdict after final verification:** **PASS.** All five prior findings are resolved; no critical or high finding remains.

Mechanical lint passes with zero findings when the linter is run directly with
Python. No critical finding was found.

## Verification Pass

| Prior finding | Status | Verification |
| --- | --- | --- |
| H1 — CSRF invariant | **Resolved** | AD-22 now binds every browser mutation to one same-origin/Fetch Metadata middleware and adds a session-bound token for creator/admin forms (`ARCHITECTURE-SPINE.md:321-331`). |
| H2 — Outbox executor | **Resolved** | AD-12 now chooses a same-Worker `scheduled()` handler on a 15-minute Cron Trigger as retry owner, with optional request-path acceleration and a stale-temporary-object sweep (`:198-210`). |
| H3 — Discovery admission | **Resolved** | AD-5 gives Discovery ownership of `unlisted`, `listed`, and `delisted`, defines owner/admin transitions, limits public reads to open `listed` Polls, and now requires every new Poll to start `unlisted` with an explicit creation-time opt-in to `listed` (`:95-108`). |
| M1 — Idempotent replay | **Resolved** | AD-7 now stores a normalized payload hash and accepted outcome, returns the original outcome on exact replay, and rejects payload mismatch as `IDEMPOTENCY_CONFLICT` (`:115-135`). |
| M2 — Contradictory source package | **Resolved as a gate** | Scope reconciliation is now explicitly marked `BLOCKING` before epic creation (`:487-495`). |

## Remaining Critical

None.

## Remaining High

None.

---

The sections below preserve the initial-pass record; their active status is
superseded by the verification table above.

## Initial Pass — Critical

None.

## Initial Pass — High

### H1 — Authenticated browser mutations have no CSRF invariant

- **Evidence:** AD-4 establishes cookie-backed creator sessions and ownership checks (`ARCHITECTURE-SPINE.md:77-88`); the HTTP convention establishes ordinary browser POST mutations (`:274-279`). Neither binds origin validation, SameSite cookie posture, nor a CSRF token strategy for creator/admin commands.
- **Why this is a divergence point:** Better Auth can protect its own auth endpoints, but independently built Poll, export, deletion, and moderation routes are application endpoints. One epic can rely on SameSite cookies, another can validate `Origin`, and another can add tokens. That inconsistency leaves high-impact authenticated mutations with different protection.
- **Impact:** A cross-site request could create, close, delete, or moderate a Poll in an authenticated Creator's browser even when authentication and resource ownership are otherwise correct.
- **Disposition:** **Autofix before final.** Extend AD-4 or add a security AD: every cookie-authenticated unsafe request must pass one centrally implemented CSRF policy (for example strict `Origin`/`Sec-Fetch-Site` validation plus an explicit token where the policy requires it); auth/session cookies must be `Secure`, `HttpOnly`, and use the chosen `SameSite` posture. Delivery adapters enforce the policy before application commands.

### H2 — AD-12 requires retries but does not choose an outbox executor

- **Evidence:** AD-12 requires idempotent background R2 cleanup that “retries until complete” (`ARCHITECTURE-SPINE.md:185-194`), but the stack, binding conventions, topology diagram, and environment rules contain no scheduled handler, Queue, or opportunistic dispatcher (`:209-229`, `:281-301`, `:336-383`).
- **Why this is a divergence point:** The image, deletion, deployment, and operations epics can independently choose Cron Triggers, Cloudflare Queues, or request-driven cleanup. Those choices have incompatible bindings, retry semantics, observability, failure modes, and cost.
- **Impact:** Orphan cleanup can silently never run, run only under traffic, or introduce an unapproved service and breach AD-18.
- **Disposition:** **Autofix before final.** Bind one Phase-1 executor. The smallest fit is a scheduled handler on the same Worker, configured in `wrangler.jsonc`, that leases due outbox rows, performs idempotent deletion, records attempts/next-attempt, and exposes stuck-row telemetry. Defer Queue adoption behind a measured throughput/failure threshold.

### H3 — “Policy-eligible” discovery is undefined and its deferral is too late

- **Evidence:** AD-5 allows only “policy-eligible `listed` Polls” into discovery (`ARCHITECTURE-SPINE.md:90-100`), but does not name the policy owner, initial listing state, or approval transition. The missing policy is deferred until “before CAP-DISCOVER opens to untrusted creators” (`:417`) even though self-service creation and discovery are adopted launch capabilities.
- **Why this is a divergence point:** Creator, discovery, and moderation epics can each infer a different meaning for `listed`: creator-selected, automatically eligible, or administrator-approved. Reversible delisting does not resolve who may list a Poll in the first place.
- **Impact:** The public directory can accidentally publish abusive/private content, or the independently built creator and discovery flows can disagree on whether a newly created Poll is discoverable.
- **Disposition:** **Discuss, then fix before final.** Bind the state machine and policy owner now, while deferring detailed moderation criteria. A safe default is `unlisted → pending → listed → delisted`, with only a central listing-policy command able to enter `listed`; public queries consume only `listed`. If automatic listing is intended, state that explicitly and bind the minimum eligibility checks.

## Initial Pass — Medium

### M1 — Vote retry identity prevents duplicates but does not define idempotent replay

- **Evidence:** AD-7 claims to bind “retry safety” and requires a unique `submission_id` (`ARCHITECTURE-SPINE.md:113-122`), while the identifier convention only says it is unique per Poll (`:270`). It does not say what happens when the same ID is replayed after a successful commit or reused with a different ballot.
- **Why this matters:** One route can return the original success, another can surface a duplicate-vote error, and another can overwrite or ignore payload mismatch. These are incompatible user-visible semantics after a lost response.
- **Disposition:** **Autofix.** Store a request fingerprint and terminal outcome with the submission ID. Exact replay returns the original outcome; the same ID with a different payload is rejected as a stable conflict.

### M2 — The requirement sources still contradict the adopted product scope

- **Evidence:** The spine adopts public self-service creation and discovery (`ARCHITECTURE-SPINE.md:83-100`) while its bound PRD/UX sources still require one Creator, no sign-up, and all Polls unlisted. Reconciliation is deferred until before epics (`:413`).
- **Why this matters:** The spine itself gives a clear precedence decision, so this is not an architecture contradiction; however, epic/story agents consuming both packages can still implement the stale journeys or acceptance criteria.
- **Disposition:** **Defer only with a hard gate.** Do not create epics until `bmad-spec` or PRD/UX update work reconciles the source package and adds self-service creation, discovery, moderation, and share journeys. Record the refreshed documents as companions without renumbering ADs.

## Initial Pass — Low

### L1 — Version verification is current but not auditable from the spine alone

- **Evidence:** The Stack says it was verified on 2026-07-29 (`ARCHITECTURE-SPINE.md:281-301`). Spot checks confirmed Astro 7.1.5, TypeScript 7.0.2, Better Auth 1.6.25, Zod 4.4.3, and Vitest 4.1.10 as current registry releases at review time.
- **Disposition:** **Ignore in the spine; preserve in the memlog.** The terse spine should not carry research rationale, but the memlog should retain the registry/documentation evidence for every pinned seed, especially the Astro adapter and Cloudflare test tooling compatibility.

## Initial Checklist Walk

| Gate criterion | Result | Notes |
| --- | --- | --- |
| Real divergence points fixed | **Needs change** | Domain seams are excellent; CSRF, outbox execution, and listing admission remain divergent. |
| `Binds` / `Prevents` / `Rule` enforceability | **Needs change** | Most ADs are concrete and testable. AD-12 promises a retry behavior without an executor; AD-7 needs replay semantics. |
| Deferred safety | **Needs change** | Transport, replication, XLSX, additional providers, and service splitting are safely gated. Listing moderation is deferred too late for adopted public discovery. |
| Named technology current and fit | **Pass with evidence note** | Spot-checked versions are current. The modular Astro-on-Workers/D1/R2 fit matches the cost and performance constraints. Preserve full evidence in the memlog. |
| Brownfield ratification | **N/A** | This is a greenfield seed; no existing application conventions were found to contradict. |
| PRD/UX capability coverage | **Pass with pre-epic gate** | FR-1–FR-27 and the UX live/trust surfaces are mapped. New self-service/discovery/share scope is architecturally covered but not yet reconciled into the source journeys. |
| Parent-spine inheritance | **N/A** | No parent architecture spine is declared. |
| Structural dimensions complete | **Pass** | Paradigm, dependency direction, capability ownership, mutation path, state authority, identifiers, validation, errors, and routing are decided. |
| Operational/environmental dimensions complete | **Needs change** | Environment isolation, migrations, deploy gates, telemetry, recovery, and cost are covered. The outbox execution path is the remaining operational hole. |

## Strong Calls Worth Preserving

- AD-1 and AD-3 establish a compact, enforceable modular-monolith contract without turning the spine into a codebase tour.
- AD-6 through AD-10 create a coherent vote-integrity chain: D1 facts, constrained acceptance, privacy-safe duplicate claims, deterministic tallying, and versioned live projections.
- AD-11 correctly keeps deadline correctness out of a scheduler.
- AD-13 resolves the root-slug collision and sharing seam in one rule.
- AD-14, AD-15, and AD-18 cover the environmental, recovery, observability, privacy, and cost envelope that architecture drafts often omit.

## Initial Gate Recommendation

Apply H1, H2, and the state/ownership portion of H3; tighten AD-7's replay rule; then rerun lint and the independent lenses. Keep source reconciliation as a hard pre-epic gate if it is not completed during this architecture run.
