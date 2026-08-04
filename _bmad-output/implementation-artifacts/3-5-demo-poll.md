---
baseline_commit: 01e3e8d580c8a4bd5d20a7e94c1a512dd1eaa701
baseline: "origin/main @ 01e3e8d580c8a4bd5d20a7e94c1a512dd1eaa701 (Story 3.4 done)"
dependency_story: 3-4-landing-page
epic: "3 — Public Face: Discovery, Landing & Demo"
---

# Story 3.5: Demo Poll

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a demo visitor,
I want to cast a real vote on the landing page and watch the bars move,
So that the product demonstrates itself — no screenshot, no video, the actual thing (UJ-5's climax).

## Acceptance Criteria

Verbatim from `_bmad-output/planning-artifacts/epics.md` § Story 3.5 (lines 790–810):

1. **Given** the landing page, **When** the pinned Demo Poll renders, **Then** it is a complete, votable Poll inline — the same `poll-option` rows, vote button, trust badge, and `results-bar` group as any `/{link}` page, never a reduced version (UX-DR26), **And** the Demo Poll ("Best day for a long weekend?", no Deadline) runs with CAPTCHA and Session Checks on and IP Checks off, so shared and CGNAT addresses are never falsely blocked (FR-26).

2. **Given** a returning visitor who already voted, **When** the landing page renders, **Then** the already-voted rejection renders inline with the live Tally beneath it — live bars, not a dead form.

3. **Given** the Creator on the Demo Poll's detail surface, **When** they reset its Votes, **Then** all Votes clear and the Poll passes through the normal empty state — zero-width bars, the empty-state line, no separate "resetting" state — so a visitor arriving mid-reset sees a Poll with no Votes yet, which is true (FR-26), **And** the Demo Poll is designated by an explicit configuration reference to one Poll (mechanism chosen in-story and documented); the reset action appears only on the designated Poll's detail surface.

## Tasks / Subtasks

- [x] Task 1: Establish the provider-free Demo Poll contract and explicit designation (AC: #1, #3)
  - [x] FIRST, ratify the unresolved architecture/UX decisions in the implementation branch before writing reset or embed code: `ARCHITECTURE-SPINE.md` must name `ResetDemoPoll` as the one sanctioned cross-capability coordinator and resolve review finding M-5; `epics.md` UX-DR3/7/16/17 plus `DESIGN.md`/`EXPERIENCE.md` must receive the exact combined-surface, fourth-confirmation, and post-submit-order refinements below. If those source-of-truth edits do not land in the same PR, implementation is blocked rather than allowed to ship a story-only exception.
  - [x] ADD a purpose-shaped Demo policy under `src/modules/polls/` (for example `demo-poll.ts`). It owns the fixed definition, reference validation, designation comparison, reset eligibility/command/port, stable application errors, and public-safe copy; it imports no Astro, Cloudflare, D1, environment, or provider types (AD-1/AD-19). Do not put question/options/security policy in `src/pages/index.astro` or infer designation from content.
  - [x] PIN the required voting template: canonical custom reference comes from server-owned `DEMO_POLL_REFERENCE`; question `Best day for a long weekend?`; options in order `Friday`, `Monday`, `Either works`; `multiple_choice`; single-select (`min=1`, `max=1`); `result_visibility=live`; no Deadline; Session Checks on; CAPTCHA on; IP Checks, Voter Codes, and VPN Blocking off; initially open and Unlisted. Description remains an ordinary optional Creator-owned field and Discovery state remains ordinary Discovery-owned state. The admission rate limiter still runs when IP Checks are off; it is never uniqueness evidence.
  - [x] Validate `DEMO_POLL_REFERENCE` as one lower-case, non-reserved Custom Link using the existing slug bounds/registry. Missing, malformed, unresolved, or definition/security-drifted configuration returns a stable operational-unavailable result; it must never fall back to a question match, newest Poll, internal ID, random reference, or another environment's data.
  - [x] Do NOT revoke global Creator rights. Close, delete, description, pre-Vote definition/security changes, result visibility, and Unlisted/Listed transitions continue through their existing owner-qualified commands. Closed renders the specified final-Tally fallback; deleted/missing or incompatible drift renders operationally unavailable until the Creator repairs what ordinary rules permit or the operator provisions a replacement reference and changes config. Reset is not a back door to reopen, undelete, loosen security, or repair a drifted definition.
  - [x] Keep Administrator Delist/Clear semantics intact: Delist may place the designated Poll under an Administrator hold without changing its link or public-link reachability. Reset must refuse both while currently Delisted and whenever any `moderation_action` history exists, even after Clear, so aggregate replacement cannot cascade-delete append-only Delist/Clear facts. Recovery is a newly provisioned Poll/reference plus a reviewed config change; never move/rewrite moderation rows, special-case Discovery enumeration, or mutate `discovery_state` from the Demo module.

- [x] Task 2: Reuse the ordinary vote/results delivery path and embed the complete Poll on `/` (AC: #1, #2, #3)
  - [x] EXTRACT the reusable delivery state from `src/pages/[reference].astro` into a narrow inbound-delivery helper plus a shared Astro voting-surface component. Both `/{reference}` and `/` must compose the same replay lookup, Session/IP preflight priority, rate limiter, conditional Turnstile verification, `castVote`, failure mapping, selection preservation, flash/PRG handling, authorized Results query, own-ballot resolution, components, and enhancement scripts. Do not clone the route's business rules or create a Demo-only vote endpoint.
  - [x] Keep page-level effects at the page boundary: the helper returns declarative status/header/cookie/redirect effects and each `.astro` page applies them. A nested component must not attempt to set cookies or response headers. Parameterize at least the fixed reference, form action, successful redirect (`/` for the embed, `/{reference}` for the canonical page), canonical Share URL, live endpoint, and embedded/full-page presentation.
  - [x] UPDATE `src/pages/index.astro` to accept only GET/HEAD/POST (`405`, `Allow: GET, HEAD, POST` otherwise), resolve only the configured reference, and render the Demo immediately after the technical build account while retaining the statement, repository, smoke marker, create entry, Discover entry, mode toggle, self-canonical root metadata, indexability, and `private, no-store` on every response. POST `/` remains under the existing central Origin/Fetch-Metadata CSRF boundary.
  - [x] Render the editable ballot and the current live Tally together on a fresh open landing GET, including the all-zero Tally after reset. Query authorized Live Results before a vote instead of fabricating counts; pass `/${reference}/results/live` to the existing live enhancer. The direct `/{reference}` page keeps its established post-vote-only Tally behavior. A Tally lookup failure must never become fake zeros; preserve a committed vote outcome, but make an initial incomplete Demo operationally unavailable.
  - [x] Reuse `PollOption`, `TrustBadge`, `Turnstile`, `ButtonPrimary`, `ResultsTally`, the chart/live scripts, and `ShareAction`. The Share action shares the Poll's canonical `/{reference}` URL, not `/`, and remains secondary inside the one conceptual Demo entry. Trust copy continues to come from persisted Toggle truth (`ONE VOTE PER BROWSER` and `HUMAN CHECK ON SUBMIT`); do not hard-code a Demo badge. Render exactly one badge: while the ballot is editable it lives in the ballot above Turnstile/VOTE and the nested Tally receives no second badge; once read-only, the Tally owns the badge in its established position.
  - [x] Keep the existing state semantics inline: accepted POST → flash + `303 /` → `Counted.` and live Tally; returning Session claim → exact already-voted rejection and live Tally; failed CAPTCHA/selection/offline/rate-limit paths preserve the ballot and retry state; closed → final Tally with no vote affordance; reset → ordinary empty bars and exact existing line `No Votes yet. Yours would be the first, which is a kind of power.` No Demo spinner, skeleton invention, optimistic count, or “resetting” state.
  - [x] Preserve UX-DR17 without an exception: on an ordinary open GET with no outcome, Demo remains immediately after the build account; on every outcome-bearing render (recoverable POST, successful flash/PRG, returning already-voted GET, or closed fallback), place the complete Demo region first inside `<main>` so its outcome is literally the first main content. The outcome stays `tabindex="-1"`, receives autofocus, is announced once, and leads `<title>`; the statement/build/repository/create/Discover blocks follow without duplication.
  - [x] The VOTE button becomes the page's sole `button-primary`; demote `/creator/new` to the existing secondary anchor treatment without changing its destination or sign-in return behavior. Treat the editable ballot and live Tally as separately labelled regions divided by the existing hairline rhythm. In the combined editable variant only, all bars retain the normal entropy wash/edge and a unique leader keeps a non-gold `◆` plus accessible “leading” state; once the ballot becomes read-only, canonical Tally gold leadership returns and own ballot remains text-only. Carry this presentation mode through every live reconcile, not only server HTML. This removes the third competing gold while retaining leadership without color. Exact ties remain unmarked with `TIED`.
  - [x] Add the honest CAPTCHA-without-JavaScript floor for this public CAPTCHA-on surface: the Poll/question/options/Tally remain readable, a `<noscript>` line says `JavaScript is required for the human check on this Poll.`, and the server can never imply a Vote was accepted without a Siteverify proof. A successful Demo Vote requires a Turnstile-capable client; record that constraint in UX/README rather than creating a bypass or looping a no-token POST.
  - [x] Resolve Story 3.4's deferred header finding by extracting the landing brand header/mode toggle to a small `site-header.astro` component only if the extraction stays presentation-only; otherwise update `deferred-work.md` with the concrete reason it remains deferred. Do not turn this into site-wide navigation or session-aware chrome.

- [x] Task 3: Reset only the designated Demo through an atomic Poll replacement (AC: #3)
  - [x] ADD `reset-demo` to `src/lib/creator-lifecycle-form.ts` with the strict allowlist `intent` + `csrf_token` only. On the current designated Poll detail, show a secondary `RESET DEMO POLL` link only to its owner; it targets `?confirm=reset-demo`, whose server render opens the existing overlay even without JavaScript, supplies a real `KEEP VOTES` cancel link, and contains the CSRF-protected POST. When the current Tally is empty, render the control disabled as `NO VOTES TO RESET`. Re-check session-bound CSRF, ownership, live configured reference, exact reset eligibility, open state, non-Delisted state, and absence of all moderation history on POST.
  - [x] Do not delete Vote rows in place. Implement the architecture review's compatibility path in a purpose-shaped D1 adapter operation owned by the ratified `ResetDemoPoll` coordinator: one `db.batch()` inserts a new Poll ID by guarded `INSERT … SELECT` from the exact old ID/owner/configured canonical reference and current live version; moves the existing option rows to the successor so option IDs and unsent selections remain valid; moves the canonical reference row old→new; and only then deletes the old Poll aggregate. Existing foreign-key cascades remove its Votes, selections, Session/IP claims, idempotency rows, and future old-Poll-owned children; no Discovery-owned moderation row may exist or be deleted.
  - [x] Specify staged SQL guards, not one impossible repeated predicate: successor insert requires the old mapping/owner/exact eligible state plus `NOT EXISTS moderation_action`; option move depends on both exact old and new rows; reference move requires reference→old and successor existence; old delete requires that same reference now point to the exact successor. Finish the same `db.batch()` with a rollback assertion: when a successor exists but the exact completed invariant does not, a conditional `INSERT … SELECT` must deliberately duplicate the still-present configured `poll_reference.reference` and raise its known UNIQUE constraint, forcing D1 to roll the whole batch back. The assertion is a zero-row no-op only for the complete replacement or the untouched no-successor path. Then inspect every statement's `changes`; all-zero is only a no-op candidate, while mixed/unexpected metadata is an integrity incident and never a claimed success. Post-batch inspection alone is not atomicity protection.
  - [x] Preserve owner, stable canonical reference/reference metadata, option IDs/order, original creation ordering, description, and current `unlisted | listed` state while reproducing the fixed question/type/visibility/deadline/security contract and starting the successor open. Refuse closed, Delisted, drifted, history-bearing, missing, or already-empty targets rather than reopening/repairing them. Set the successor version to the old row's value at transaction linearization + 1, never a pre-read value or 1: from a pre-race baseline V, reset-first yields V+1 and Vote-first yields V+2.
  - [x] Classify by batch metadata and authoritative re-read. One actual replacement returns the new Poll ID/version. If the URL's old ID is already missing, execute the reset branch before the creator route's generic 404: redirect without creating/clearing any success flash only when the current configured Demo is still owned by the authenticated Creator; otherwise return the ordinary privacy-safe not-found/denied result. No lineage means no claim that an arbitrary stale request was this reset. A current no-Vote Poll is a no-op with no new ID/version or success flash.
  - [x] Linearize races explicitly: a Vote that commits first is removed and contributes its increment before successor +1; a public Vote that loses sees the stable reference now resolve another Poll ID and is remapped only for this configured Demo to the ordinary `poll_definition_changed` refresh/retry state, not a false deleted 404. Because option IDs persist, unsent selections remain checked and a post-reset submission may truthfully become the first new Vote; consumed/failed Turnstile state still resets through the existing retry path. Direct deletion of an ordinary Poll retains existing 404 behavior.
  - [x] Define reset/Delist order: Delist-first makes the reset guard refuse without touching the hold/history; reset-first makes a concurrently pre-resolved moderation write report a stable stale-target result and require Administrator retry against the successor, never claim a hold that missed. Add no retry loop that can starve a busy public Poll.
  - [x] After an actual replacement, set a purpose-separated, session-bound, HttpOnly one-shot success flash tied to the authenticated Creator, successor Poll ID, and reset version. Reuse the existing session/CSRF HMAC approach keyed by `BETTER_AUTH_SECRET` with an explicit `demo-reset-flash` domain; add/rotate no secret and expose/log none of those values. `303` to `/creator/polls/{newPollId}` without a success query. GET consumes/verifies the flash and re-reads that exact successor with version at least the reset version: zero Votes uses the pinned empty success copy; a positive count uses `DEMO POLL RESET` plus `The Demo Poll was reset. A new Vote has already arrived.` A typed URL, pre-existing empty Poll, wrong/lower-version successor, stale redirect, or replay cannot forge success.
  - [x] Add the fourth sanctioned overlay consumer to the UX/epic contract and reuse the existing accessible confirmation behavior: focus trap; `Esc`, scrim, and `KEEP VOTES` dismiss; focus returns to the trigger; page behind does not scroll; no-JS server-open/cancel/POST baseline. Pin copy: trigger `RESET DEMO POLL`; title `RESET DEMO POLL?`; body `This permanently clears every Vote from the landing-page Demo Poll. The public link stays the same.`; cancel `KEEP VOTES`; destructive confirm `RESET VOTES`; enhanced pending label `RESETTING…`; verified success heading `DEMO POLL RESET` with body `The landing-page Demo Poll is empty and ready for new Votes.` No toast, browser `confirm()`, spinner, or unconfirmed destructive button.

- [x] Task 4: Synchronize binding, deploy, architecture, UX, and public documentation truth (AC: all)
  - [x] ADD public, non-secret `DEMO_POLL_REFERENCE: "demo"` under root, staging, and production `vars` in `wrangler.jsonc` (Wrangler environment vars do not inherit). Update `src/env.d.ts`, regenerate `worker-configuration.d.ts` with `pnpm types`, and update binding tests. Do not add it to `.dev.vars`, `secrets.required`, command arguments, or secret-provisioning helpers.
  - [x] Extend `/api/health` only as its existing presence-only binding probe: name `DEMO_POLL_REFERENCE` when missing, expose no value, query no Poll, and add no side effect. Extend `scripts/smoke.mjs` so a deployed root must return 200 and prove the exact question, all three option labels/order, canonical Share URL, real vote form, both required trust claims, absence of the IP claim, and a Results/empty-or-counted group while retaining the load-bearing solar-token/auth/health checks; smoke must not cast or reset a Vote.
  - [x] UPDATE `ARCHITECTURE-SPINE.md` as Task 1's prerequisite to resolve review finding M-5: accepted Vote facts remain immutable while their Poll aggregate exists; only `ResetDemoPoll` may replace the explicitly configured Demo under its stable reference, coordinate destruction of Voting-owned facts, and only when no Discovery-owned moderation fact exists. Record stable option identity, staged guards, version-at-linearization, causal flash, Vote/Delist races, no-migration decision, and module/adapter/route ownership in AD-6/AD-19/AD-24 and the capability map.
  - [x] UPDATE `epics.md` UX-DR3/7/16/17, `EXPERIENCE.md`, and `DESIGN.md` narrowly and consistently: entropy-only leadership + one shared badge while the embedded ballot is editable; canonical Tally treatment after read-only; Demo first in `<main>` for every outcome-bearing render; exact options/live-before-vote/503/no-JS states; and reset as the fourth confirmation with the exact baseline/focus/dismissal contract. Do not change Story 3.5's acceptance criteria or general non-Demo behavior, and introduce no token unless browser proof demonstrates a genuine missing primitive.
  - [x] Pin operational-unavailable truth across UX/implementation: missing/malformed/unresolved/drifted config or initial Tally failure returns `503` (`HEAD` has no body), `private, no-store`, title `Demo unavailable — Oddspark Polls`, and the labelled Demo error first in `<main>` followed by the normal landing content. Its `tabindex="-1"` focused heading is `DEMO UNAVAILABLE`, followed by `The live Demo is unavailable right now. The rest of Oddspark Polls is still here.` and a secondary `TRY AGAIN` link to `/`. Emit one generic privacy-safe `demo_unavailable` result and request ID; never reveal which invariant/value failed. POST performs no mutation in this state.
  - [x] UPDATE `README.md` with the public binding, Turnstile/JavaScript truth, and credential-safe provisioning/recovery runbook; UPDATE `CHANGELOG.md` under `[Unreleased]` for the real landing Demo and owner reset. Provision through the existing authenticated product. Recovery for deleted, unrepairable security drift, closed finality, or moderation-history reset refusal is: create another exact Poll at a new Custom Link, change the reviewed per-environment config, pass staging/production preflight and smoke, then manage the former Poll through ordinary lifecycle rules. Never record credentials, cookies, OAuth identity, internal IDs, or capability URLs; never seed or repair on a public request.
  - [x] Treat remote provisioning as a release prerequisite, not implicit dev-story authority: before merging the deploy-triggering PR, obtain operator evidence that staging and production each contain the exact configured Poll. Add a privacy-safe read-only production D1 preflight immediately before promotion and expanded post-deploy production smoke after deploy; staging still must pass first. Update the workflow so release-complete status requires both production checks. Dev-story itself does not push, deploy, mutate remote D1, or claim release completion; missing live evidence is a release NO-GO even when local gates pass.
  - [x] No migration is expected: the existing Poll-owned `ON DELETE CASCADE` graph and D1 transactional batch are sufficient. If implementation discovers an uncascaded Poll-owned fact or decides reset audit must persist, stop and reopen the architecture decision; never edit migrations `0001`–`0011` or the manifest to force the chosen path.

- [x] Task 5: Add complete unit, workerd/D1, source-contract, and browser proof (AC: all)
  - [x] Unit-test exact reference/template validation, fixed options/order, ordinary lifecycle rights, reset eligibility/history refusal, command success/no-op/stale/errors, strict form parsing, causal flash, public-safe copy, and version-at-linearization policy. Extend source-contract tests to prove both pages use the shared delivery/surface, the root owns POST/redirect parameters, Create is secondary, VOTE is the sole primary, exactly one trust badge renders per state, editable leadership is non-gold, and no duplicate Demo vote policy appears in `index.astro`.
  - [x] In real workerd + D1, prove root GET/HEAD/POST, `405`/Allow, central CSRF, accepted Vote + `303 /`, lost-response replay, Session duplicate, two browsers behind one test IP both voting once, Turnstile pass/fail/duplicate-token semantics, selection preservation, live-before-vote/after-vote/empty Tallies, missing/malformed/drifted configuration, no shared cache, request ID, and exactly one privacy-safe telemetry record. Keep direct `/{reference}` behavior regression-covered.
  - [x] Prove the replacement transaction: stable reference/new Poll ID with stable option IDs; old Poll/Votes/selections/claims/idempotency rows gone; owner/reference/description/discovery/creation ordering retained; reset-first V→V+1 and Vote-first V→V+2; no-op leaves ID/version unchanged; forged ordinary-Poll/non-owner/malformed POSTs change nothing; current/prior moderation history and closed/drifted targets refuse unchanged; fault-inject every staged zero-row/mixed path and prove the final rollback assertion leaves the original aggregate intact with no orphan; Vote/reset and Delist/reset orders linearize; stable-reference live endpoint never returns false `304` and reconciles the same option IDs to zero without reload.
  - [x] Extend creator-route integration/E2E proof for reset visibility, disabled empty state, exact `?confirm=reset-demo` server-open overlay, focus trap/Escape/scrim/cancel/return focus, exact copy, enhanced double-submit label, verified causal-flash PRG to the new detail ID, unforgeable/focused empty success, truthful “new Vote already arrived” success, stale-old-ID redirect without success, and ordinary Poll lifecycle regression. The no-JavaScript server-open/cancel/POST confirmation baseline is required, not optional.
  - [x] Update `tests/e2e/landing.spec.mjs` (or add a focused serial Demo spec) for UJ-5 end to end: fresh browser sees the form and current live bars, votes using the deterministic local Turnstile test harness, receives Counted and moving bars, reloads into already-voted + live Tally, owner resets, public root shows the exact zero-bar empty state, and the old browser may vote once again. Also select an option before an external reset and prove the stable option remains checked/live without a page reload and may become the first new Vote. Keep test data isolated: make Playwright readiness `/api/health` mandatory and deterministically seed the Demo/owner before any landing spec, never through test-order dependence.
  - [x] Keep local and live challenge evidence honest: local E2E may use the documented test key/controlled token and may filter only the existing explicitly enumerated third-party vendor noise; it is not proof of a real widget round-trip. Before promotion, capture staging browser evidence that the real Turnstile widget follows resolved mode and a real token is accepted once, with app console/network clean and no credential/cookie/token retained.
  - [x] Capture and inspect committed proof under `test-results/story-3-5-demo-poll-proof/` at 375px dark and 1280px light, including fresh, Counted/live, already-voted, reset confirmation, and empty post-reset states. Prove one primary action, 48px targets, keyboard order/focus, no overflow, one-column landing at `lg`, mode-bound Turnstile, clean console/network, real bar change, and reduced-motion snap with all state information retained.

- [x] Task 6: Run the exact repository gate and maintain the story record (AC: all)
  - [x] Under Node `24.18.0` and pnpm `11.17.0`, run in repository order: `pnpm migrations:guard`, `pnpm test`, `pnpm check`, `pnpm test:e2e`, `pnpm types`, `git diff --exit-code worker-configuration.d.ts`, `pnpm build:production`, and `git diff --check`. Record fresh totals/results in this story; Story 3.4's 1,199 Vitest / 152 E2E totals are historical only.
  - [x] Keep this story's Dev Agent Record, File List, Change Log, and `sprint-status.yaml` current through implementation/review. No `TODO`, skipped/only test, placeholder, undocumented deferral, secret, or broad staging may remain. Preserve the two unrelated untracked retrospective files; stage only explicit Story 3.5/status/implementation paths. Dev-story never pushes or deploys.

## Dev Notes

### Decisions resolved at story-creation time (binding unless Justin reopens one before dev-story)

| # | Gap | Decision |
|---|---|---|
| D1 | Exact option labels were absent from every source. | Pin `Friday`, `Monday`, `Either works` in that order. Single-select Multiple Choice, min/max 1. No implementation-time copy choice remains. |
| D2 | What is the “explicit config ref”? | Public non-secret `DEMO_POLL_REFERENCE`, repeated in each Wrangler environment and set to canonical Custom Link `demo`. The reference is stable across isolated D1 databases; internal Poll IDs are never configuration because reset replaces them. |
| D3 | What configuration is required, and are ordinary lifecycle rights removed? | Exact question/options/type, Live visibility, no Deadline, Session + CAPTCHA on, IP/Voter Codes/VPN off; initially open and Unlisted. No lifecycle exception: description, visibility, listing, close, delete, and allowed definition/security edits remain ordinary Creator rights. Closed renders truth; deletion/drift requires repair or config rollover. |
| D4 | How can reset coexist with immutable accepted Votes? | Replace the whole designated Poll aggregate atomically under the same public reference and delete the old aggregate by cascade. Do not mutate or bulk-delete accepted Vote facts in place. The architecture spine must ratify this narrow lifecycle operation. |
| D5 | What happens to version, identity, and races? | New Poll ID but stable option IDs, reference, owner, and creation order. Successor version is transaction-current old version + 1. Old claims disappear; unsent fixed-option ballots remain valid. Stale old URLs may redirect without success, never infer lineage. Vote/Delist races have explicit stale/refresh results. |
| D6 | How does reset interact with Discovery moderation? | Administrator Delist/Clear still work and landing pinning stays separate from `/discover`. Reset refuses while Delisted **or after any moderation action ever existed**, so replacement cannot erase append-only history. Recovery uses a new Poll/reference and config change, not history rewrites. |
| D7 | What does `/` do when configuration is missing or drifted? | Return the exact private/no-store 503 landing shape in Task 4 with no guessed Poll. `/api/health` checks binding presence only; staging and production preflight/smoke prove actual configured data. Closed is the specified final-Tally fallback, not generic drift. |
| D8 | Is the Tally visible before a fresh visitor votes? | Yes. AC #1 and the mid-reset state require the real Results group on initial render. The root's embedded variant queries Live Results alongside the editable ballot; the canonical Poll route keeps its established behavior. |
| D9 | Does the inline Demo include Share? | Yes: reuse the existing secondary `ShareAction` and canonical `/{reference}` URL as part of the complete Poll. It is nested inside the one Demo entry and does not replace/add landing navigation. |
| D10 | How are one-primary and outcome focus reconciled? | VOTE owns the sole primary; Create becomes secondary. An ordinary open GET remains statement/build/Demo; any outcome-bearing state puts the whole Demo first in `<main>` so UX-DR17 remains literal, including a returning duplicate. There is no accessibility exception or duplicated outcome. |
| D11 | What is the reset interaction and success proof? | Fourth sanctioned confirmation using server-open `?confirm=reset-demo`, exact copy/keyboard/dismissal behavior, no spinner/toast. Actual success sets a session-bound one-shot causal flash tied to successor/version; query strings and an already-empty Poll prove nothing. |
| D12 | Is a migration or automatic seed/reset job part of the story? | No. Stable option rows plus existing cascades and D1 batch suffice because reset refuses any moderation history. Provision/recover through the authenticated product and reviewed config; reset is owner-invoked only, never scheduled or bootstrapped on a public request. |
| D13 | How does the combined editable ballot/Tally obey gold and trust rules? | Exactly one persisted-truth badge lives with the editable ballot; read-only Tally owns it later. Editable Tally leadership keeps `◆` and accessible state but uses entropy, not gold. Canonical gold leadership returns when the ballot/primary action disappears. |
| D14 | What happens without JavaScript? | The Poll and Tally remain readable and `<noscript>` names the required human check. No CAPTCHA bypass or false success exists; accepted Demo voting requires a Turnstile-capable client. Reset confirmation retains the existing complete server-rendered baseline. |

### Architecture and security guardrails

- **AD-1 / AD-19:** `src/modules/polls` owns designation/template/reset eligibility; the explicitly ratified `ResetDemoPoll` application coordinator may cross Polls/Voting only for this configured capability and must prove no Discovery moderation fact exists. Delivery helpers coordinate existing application commands; Astro maps HTTP; D1 implements purpose-shaped ports. No direct route SQL or provider type in the domain.
- **AD-2:** both public surfaces remain server-rendered and progressively enhanced. JS improves selection, Turnstile, share, chart form, live updates, motion, and overlay behavior; it does not own authorization, reset, count truth, redirect truth, or validation.
- **AD-6 / architecture M-5:** the old Poll aggregate is deleted as a unit and a successor becomes reachable in one transaction; option identity transfers, Voting facts cascade, and Discovery facts are a hard refusal. This is not a generic clear-votes API and not a second mutation path for ordinary Polls. The spine update is a prerequisite, not cleanup after code.
- **AD-7 / AD-16 / AD-17:** every Demo Vote uses the ordinary constrained vote transaction and fail-closed server-side Turnstile verification. Exact persisted toggles, not config wishes or form fields, control the request.
- **AD-10 / AD-21 / AD-24:** Live Results are authorized before projection, served private/no-store, and keyed by a monotonically newer version derived at reset linearization. Stable option IDs let the existing endpoint reconcile to zero without reloading or erasing an unsent selection.
- **AD-14:** `demo` names a different D1 row per environment; no cross-environment ID or origin is valid. Build canonical URLs from the request origin.
- **AD-15:** one outer telemetry record per request. Stable operation/result codes only; never log question/options, selections, raw IP, browser token, Turnstile token, claim digest, owner, Poll IDs, reference values, or SQL/provider detail.
- **AD-22:** public POST `/` receives central same-origin CSRF; authenticated reset also requires the session-derived constant-time token and owner check. UI visibility and a configured reference are not authorization by themselves.
- **D1 batch semantics:** `batch()` is transactional on statement failure, but a guarded zero-row statement is successful SQL. Use the staged old-mapping → successor → moved-options → moved-reference → old-delete guards from Task 3 and end the batch with its conditional duplicate-reference rollback assertion. That in-transaction constraint failure—not a later metadata check—rolls back every partial successor. Inspect every result and re-read truth only after the assertion has made the complete and untouched outcomes the sole committed shapes.
- **Discovery:** current Poll insert/delete triggers advance the catalog revision even for Unlisted rows. Accept the safe invalidation; do not hand-edit the singleton or force an exact revision delta. `representation_version` remains separate from listing/catalog revision.

### Current implementation inventory (merged baseline)

- `src/pages/index.astro` is the Story 3.4 landing page: GET/HEAD only, private/no-store after review, one primary Create anchor, exact statement/build/repository/Discover copy, mode toggle, and load-bearing solar smoke marker. Story 3.5 adds the data/session/POST surface without regressing those contracts.
- `src/pages/[reference].astro` currently owns roughly the whole public delivery composition: reference resolution, browser cookie/digests, Session-first/IP preflight, limiter, Turnstile, `castVote`, 422 ballot preservation, flash/303, authorized Results, own-ballot lookup, `PollOption`, `TrustBadge`, `Turnstile`, `ResultsTally`, `ShareAction`, and scripts. Extract shared behavior; do not copy it into root.
- `src/components/results-tally.astro` already owns exact empty copy, zero-width bars, chart toggle, live indicator, own-ballot line, trust badge, skeleton/final render, and live endpoint metadata. `src/scripts/results-live.ts` reloads when option identity changes and `results-live-core.ts` rejects lower versions. Story 3.5 deliberately transfers stable option IDs so a dirty fixed-option ballot survives; monotonic version still forces the zero-count payload to be adopted.
- `src/modules/results/index.ts` owns visibility and tally projection. The Demo's persisted `live` setting makes a pre-vote root query authorized without creating a new visibility rule.
- `src/modules/voting/index.ts` + `src/adapters/d1/index.ts` own exactly-once voting, claim/idempotency persistence, and representation increments. Existing migrations cascade `poll_option`, `vote`, `vote_selection`, and `voter_claim` through the Poll/Vote graph.
- `src/pages/creator/polls/[pollId].astro`, `src/lib/creator-lifecycle-form.ts`, `src/modules/polls/poll-lifecycle.ts`, and `poll-security.ts` are the existing owner-qualified lifecycle seams. Reset returns a new internal ID, so its success redirect cannot reuse the old detail URL.
- Migration `0010` increments catalog revision on Poll insert/delete. Migration `0011` attaches `moderation_action` to Poll with cascade; reset therefore refuses both a current hold and any prior action history. No `0012` is required by the chosen design.
- `wrangler.jsonc` currently repeats only `TURNSTILE_SITE_KEY` as a public var. `worker-configuration.d.ts` is generated truth; `/api/health` is presence-only; `scripts/smoke.mjs` verifies root token/auth/binding liveness but not yet the Demo.
- Landing tests currently encode the pre-Demo contract: exactly three links, Create as sole primary, POST 405, and statement → build → create → Discover. Replace those expectations without losing mode, focus, font, token, indexability, request-ID, or clean-log coverage.

### Previous-story and Git intelligence

- Live baseline is `main == origin/main == 01e3e8d580c8a4bd5d20a7e94c1a512dd1eaa701`, `chore(review): apply code review patches and mark Story 3.4 done (#19)`. Story 3.4 is the direct dependency and its source/review contracts are incorporated here.
- Story 3.4 explicitly deferred the primary-action collision and header extraction to Story 3.5. Its latest review also made root private/no-store and improved build-account labelling/smoke accessibility; retain those patches.
- Story 3.3's guarded-batch lesson applies: transactionality does not make a zero-row guarded statement fail. Re-read authoritative D1 state before claiming an operation succeeded.
- Story 3.2/3.3 established that Discovery owns provider-free listing/moderation and that listing does not bump Poll representation. Demo pinning must not become a second catalog owner.
- Preserve unrelated untracked `_bmad-output/implementation-artifacts/epic-1-retro-2026-08-03.md` and `epic-2-retro-2026-08-03.md`. Never stage them or use `git add -A`.
- Match Conventional Commits with logical, explicit-path staging and no attribution trailers. Push only when asked; merging to `main` deploys production.

### Current platform specifics (verified 2026-08-04)

- Locked repository versions: Node `24.18.0`, pnpm `11.17.0`, TypeScript `7.0.2`, Astro `7.1.5`, `@astrojs/cloudflare` `14.1.6`, Better Auth `1.6.25`, Zod `4.4.3`, Wrangler `4.115.0`, Vitest `4.1.10`, Playwright `1.62.0`, and fast-check `4.9.0`. Add no dependency.
- Context7 instructions were followed, but its MCP resolver/query tools were unavailable in this session. Retry Context7 at dev-story start. Official Astro guidance confirms request methods/cookies/direct responses belong to on-demand page handling and response headers are page-level concerns: https://docs.astro.build/en/guides/on-demand-rendering/
- Official Cloudflare D1 guidance confirms `D1Database.batch()` executes statements sequentially as a transaction and rolls back on statement failure; guarded zero-row classification remains application work: https://developers.cloudflare.com/d1/worker-api/d1-database/
- Official Wrangler guidance confirms environment `vars` are non-inheritable and must be repeated in every named environment: https://developers.cloudflare.com/workers/wrangler/environments/
- Official Turnstile guidance confirms server-side Siteverify is mandatory and tokens are single-use with a five-minute lifetime; reuse the existing adapter unchanged: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

### Testing requirements

| Layer | Required proof |
|---|---|
| Unit (Node) | Exact template/reference/eligibility; ordinary lifecycle rights; strict reset form; causal flash; command success/no-op/stale/errors; shared-surface/gold/badge/source contracts; safe copy; version-at-linearization policy. |
| Integration (workerd + real D1) | Root GET/HEAD/POST/405/503/CSRF/cache/telemetry; ordinary vote/Turnstile/claims/replay/errors; pre/post/empty Live Results; atomic reference/option transfer, cascades, history refusal, version/races; owner/designation checks; direct-route regression. |
| E2E (Playwright) | Full UJ-5 vote → Counted → moving bars → returning duplicate → owner reset → empty bars → vote again; dirty-ballot reset survival; server-open overlay/focus/keyboard; two same-IP browsers; honest no-JS states; modes, responsive geometry, reduced motion, clean app logs. |
| Deploy evidence | Exact remote Poll provisioned without retained identity/credential data; real-widget staging proof; staging smoke; immediate production D1 preflight; post-deploy production smoke. Local green is not release proof. |
| Full gate | Migration guard, both Vitest projects, TypeScript check, Playwright, generated bindings + clean drift check, production build, `git diff --check`, in repository order. |

### Scope fences — do not build here

- No screenshot/video/fake counts, Demo-specific vote engine, alternate tally, client-owned mutation, optimistic acceptance, generic clear-votes endpoint, or internal-ID configuration.
- No automatic/scheduled reset, reset cadence UI, reset audit/history surface, undelete/archive system, soft-delete migration, or seed-on-public-request behavior.
- No new Poll type, Ranked/Image/Meeting work, Comments, export, Voter Codes, VPN provider, IP uniqueness, auth provider, analytics/engagement vendor, realtime topology, cache layer, or dependency.
- No Discovery pin/rank/featured flag, search, second listing state, sitemap exception, or Administrator-policy rewrite. The configured landing pin and `/discover` remain separate.
- No second CAPTCHA path, optional `remoteip`, logged challenge/browser/IP data, dummy remote secret, or secret rotation. Do not touch `VOTE_DIGEST_SECRET`.
- No change to committed migrations `0001`–`0011`, `db/migrations.manifest.json`, the middleware order, reserved-slug set, live cadence, result-visibility rules, or `--color-solar-dark` smoke token.
- No site-wide navigation, new primary action, toast, spinner, modal stack, generic design system, or heavy client framework. Update UX only for the explicitly resolved Demo exceptions.
- No commit, push, PR, remote provisioning, deployment, or release-complete claim unless separately authorized.

### Project Structure Notes

- Likely NEW: `src/modules/polls/demo-poll.ts`, `src/lib/public-poll-delivery.ts` (name may follow existing delivery conventions), `src/components/public-poll-surface.astro`, focused Demo unit/integration specs, and `test-results/story-3-5-demo-poll-proof/`. `src/components/site-header.astro` is conditional per Task 2.
- Likely UPDATE: `src/pages/index.astro`, `src/pages/[reference].astro`, `src/pages/creator/polls/[pollId].astro`, `src/components/results-tally.astro`, `src/lib/creator-lifecycle-form.ts`, `src/adapters/d1/index.ts` (and the existing moderation outcome seam if its stale-target classification needs widening), `wrangler.jsonc`, `src/env.d.ts`, generated `worker-configuration.d.ts`, `/api/health`, `scripts/smoke.mjs`, `.github/workflows/deploy.yml`, Playwright readiness/fixtures, landing/vote/results/lifecycle tests, `README.md`, `CHANGELOG.md`, `epics.md`, architecture/UX spines, this story, and `sprint-status.yaml`.
- Expected UNCHANGED: committed migrations/manifest, vote/digest/Turnstile/rate-limit domain semantics, `src/pages/[reference]/results/live.ts` route shape, Discovery cache/sitemap behavior, auth providers/secrets, token names/values, and middleware order. Change one only if a failing required proof demonstrates the story contract cannot be met, then record the architectural reason first.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Epic 3 goal/dependencies (694–696), Story 3.5 (790–810), inherited AR/NFR/UX requirements (55–117)]
- [Source: `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md` — UJ-5 (45), Vote finality (82), visibility (237–243), FR-26 (291–295), NFRs (311–317), Demo/reset open question and assumption (368–385)]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` — AD-1/2/6/7/10/14–17/19/21/22/24, consistency conventions, capability map, stack]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/reviews/review-adversarial.md` — unresolved M-5 reset/finality conflict and stable-reference replacement option (406–416)]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md` — IA/four entries (39–61), states (188–217), responsive order (257–261), accessibility (269–290), UJ-5 (410–420)]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md` — gold rarity/two-golds (457), layout (499–528), motion (548–568), button/one-primary (599–605), overlay (663–667)]
- [Source: `_bmad-output/implementation-artifacts/3-4-landing-page.md` — forward decisions/review findings, private-no-store landing baseline, full-gate precedent]
- [Source: `src/pages/index.astro`, `src/pages/[reference].astro`, `src/pages/[reference]/results/live.ts`, `src/pages/creator/polls/[pollId].astro`, `src/components/results-tally.astro`, `src/lib/creator-lifecycle-form.ts`, `src/modules/results/index.ts`, `src/modules/polls/poll-lifecycle.ts`, `src/modules/polls/poll-security.ts`, `src/modules/voting/index.ts`, `src/adapters/d1/index.ts`, `src/scripts/results-live.ts`, `src/scripts/results-live-core.ts`, `scripts/smoke.mjs`, `wrangler.jsonc`, migrations `0004`, `0006`, `0010`, `0011`]
- [Source: official Astro on-demand rendering, Cloudflare D1 batch, Wrangler environments, and Turnstile Siteverify documentation linked in Current platform specifics]

## Dev Agent Record

### Agent Model Used

OpenAI GPT-5 (Codex)

### Implementation Plan

- Ratify the provider-free Demo/reset contract in the architecture, epic, and UX sources before implementation.
- Extract one shared public Poll delivery path and surface, then compose it at both `/` and `/{reference}`.
- Implement the owner-only reset as one guarded D1 replacement batch with stable reference/options and causal success proof.
- Add environment binding, preflight/smoke/deploy gates, complete automated coverage, and committed browser proof.

### Debug Log References

- Fixed root POST cookie propagation after focused integration proof showed response effects were not serialized at the page boundary.
- Fixed reset submission serialization after browser proof showed disabling the submit button removed `intent=reset-demo` from native form data; the enhancer now uses an idempotent pending guard without disabling the successful control.
- The first full Playwright run exposed two selectors made stale by the shared surface and fourth overlay. Scoped lifecycle focus to `#delete-poll-overlay` and trust-badge markup inspection to `[data-poll-voting-surface]`; both focused cases and the clean full rerun passed.
- Final repository-order gate: 11 migrations guarded; 84 Vitest files / 1,251 tests passed; TypeScript passed; 153 Playwright tests passed; Wrangler types regenerated with zero unstaged drift; production build and `git diff --check` passed under Node 24.18.0 / pnpm 11.17.0.

### Completion Notes List

- Implemented the exact configured Demo Poll on `/` through the ordinary voting/results path, with fresh live Tally, inline outcome ordering, one trust badge, non-gold editable leadership, canonical Share URL, no-JavaScript truth, and privacy-safe 503 handling.
- Added the single sanctioned `ResetDemoPoll` coordinator and guarded D1 aggregate replacement: stable reference and option IDs, transaction-current versioning, cascade cleanup, moderation-history refusal, race classification, and session-bound one-shot causal flash.
- Added `DEMO_POLL_REFERENCE` binding truth, presence-only health coverage, read-only D1 preflight, expanded staging/production smoke and workflow gates, and synchronized architecture/UX/public documentation without adding a migration or dependency.
- Added exhaustive unit, workerd/D1, route, source-contract, and E2E coverage plus ten inspected 375px-dark/1280px-light Story 3.5 proof images.
- Local development evidence is complete. Release remains a NO-GO until the deploy-triggering PR has real staging/production Poll provisioning evidence, the real staging Turnstile round-trip, both remote preflights/smokes, and promotion authorization; dev-story did not provision, push, deploy, or retain credentials/tokens.

### File List

- `.github/workflows/deploy.yml`
- `.gitignore`
- `CHANGELOG.md`
- `README.md`
- `_bmad-output/implementation-artifacts/3-5-demo-poll.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md`
- `astro.config.mjs`
- `package.json`
- `playwright.config.ts`
- `scripts/demo-preflight.mjs`
- `scripts/deploy-config.mjs`
- `scripts/deploy.mjs`
- `scripts/smoke.mjs`
- `src/adapters/d1/demo-poll.ts`
- `src/adapters/telemetry/index.ts`
- `src/components/landing-intro.astro`
- `src/components/poll-voting-surface.astro`
- `src/components/results-bar.astro`
- `src/components/results-tally.astro`
- `src/components/site-header.astro`
- `src/env.d.ts`
- `src/lib/creator-lifecycle-form.ts`
- `src/lib/demo-reset-flash.ts`
- `src/lib/poll-delivery.ts`
- `src/lib/request-context.ts`
- `src/middleware.ts`
- `src/modules/polls/demo-poll.ts`
- `src/modules/polls/index.ts`
- `src/pages/[reference].astro`
- `src/pages/api/health.ts`
- `src/pages/creator/polls/[pollId].astro`
- `src/pages/index.astro`
- `src/scripts/overlay.ts`
- `test-results/story-3-4-landing-proof/landing-1280-light.png`
- `test-results/story-3-4-landing-proof/landing-375-dark.png`
- `test-results/story-3-5-demo-poll-proof/already-voted-1280-light.png`
- `test-results/story-3-5-demo-poll-proof/already-voted-375-dark.png`
- `test-results/story-3-5-demo-poll-proof/counted-live-1280-light.png`
- `test-results/story-3-5-demo-poll-proof/counted-live-375-dark.png`
- `test-results/story-3-5-demo-poll-proof/empty-post-reset-1280-light.png`
- `test-results/story-3-5-demo-poll-proof/empty-post-reset-375-dark.png`
- `test-results/story-3-5-demo-poll-proof/fresh-1280-light.png`
- `test-results/story-3-5-demo-poll-proof/fresh-375-dark.png`
- `test-results/story-3-5-demo-poll-proof/reset-confirmation-1280-light.png`
- `test-results/story-3-5-demo-poll-proof/reset-confirmation-375-dark.png`
- `tests/e2e/creator-poll-lifecycle.spec.mjs`
- `tests/e2e/demo-poll.spec.mjs`
- `tests/e2e/landing.spec.mjs`
- `tests/e2e/trust-badge.spec.mjs`
- `tests/integration/creator-poll-lifecycle-route.integration.test.ts`
- `tests/integration/demo-reset-adapter.integration.test.ts`
- `tests/integration/health-endpoint.integration.test.ts`
- `tests/integration/landing-middleware.integration.test.ts`
- `tests/integration/landing-route.integration.test.ts`
- `tests/integration/live-results-route.integration.test.ts`
- `tests/integration/moderation-route.integration.test.ts`
- `tests/unit/auth.test.ts`
- `tests/unit/chart-form-toggle.test.mjs`
- `tests/unit/creator-lifecycle-form.test.ts`
- `tests/unit/demo-delivery-contract.test.mjs`
- `tests/unit/demo-poll.test.ts`
- `tests/unit/demo-release-contract.test.mjs`
- `tests/unit/demo-reset-flash.test.ts`
- `tests/unit/demo-reset-route-contract.test.mjs`
- `tests/unit/demo-story-contract.test.mjs`
- `tests/unit/deploy-config.test.mjs`
- `tests/unit/landing-page.test.mjs`
- `tests/unit/own-vote-spark.test.mjs`
- `tests/unit/poll-card.test.mjs`
- `tests/unit/share-action.test.mjs`
- `tests/unit/telemetry.test.ts`
- `tests/unit/trust-badge.test.mjs`
- `worker-configuration.d.ts`
- `wrangler.jsonc`

## Change Log

- 2026-08-04: Created implementation-ready Story 3.5 with explicit Demo configuration, shared inline vote/results delivery, atomic stable-reference reset, operational gates, and complete proof requirements.
- 2026-08-04: Implemented Story 3.5 end to end, added release-gated operational contracts and complete automated/browser proof, passed the exact local repository gate, and moved the story to review without pushing or deploying.
- 2026-08-04: Group 1 (Core Delivery & Surface) code review completed — 5 patch findings, 13 dismissed, 0 deferred, 0 decision-needed.

### Review Findings — Group 1: Core Delivery & Surface (2026-08-04)

- [x] [Review][Patch] `deliverPollVotingSurface` poll_deleted remap failure omits `markDemoUnavailable()` and returns wrong status for demo page [src/lib/poll-delivery.ts:388-399] — When the demo poll was deleted and the remap finds no replacement, `markDemoUnavailable()` is never called (telemetry will not record `demoUnavailable`) and status is hardcoded to 404 even when `operationalUnavailable` is true (should be 503 for the index page). Fix: call `markDemoUnavailable()` before returning and use `input.operationalUnavailable ? 503 : 404` for status.
- [x] [Review][Patch] `.vote-bounds-hint` typography silently regressed from caption to machine-caps for all polls [src/components/poll-voting-surface.astro:255-257] — Collapsing `.vote-bounds-hint` and `.vote-hint` into shared `font-family: var(--font-machine)` / `text-transform: uppercase` rules silently changed the hint from caption-style to machine-caps, affecting every multi-select poll on both routes. Fix: separate the selectors; preserve original caption typography for `.vote-bounds-hint`.
- [x] [Review][Patch] Missing `:hover{background:transparent}` for unchecked options when max selections reached [src/components/poll-voting-surface.astro:249] — The old code had `[data-vote-form][data-max-reached="true"] :global(label.poll-option:has(.poll-option-input:not(:checked)):hover) { background: transparent; }`. Only the non-hover `cursor: default` rule survived the extraction. Unchecked options now show a hover background when max is reached. Fix: add the missing `:hover` rule.
- [x] [Review][Patch] `turnstileSiteKey.trim()` without typeof guard [src/components/poll-voting-surface.astro:201] — The old code guarded `typeof env.TURNSTILE_SITE_KEY === "string"` before calling `.trim()`. The prop type claims `string` but Astro props have no runtime enforcement; if the value is undefined at runtime, `.trim()` throws a 500. Fix: restore the `typeof` guard.
- [x] [Review][Patch] `<noscript>` does not guard on `turnstileSiteKey` presence [src/components/poll-voting-surface.astro:202] — The `<noscript>` warning renders when `poll.captchaEnabled` is true but does not also check `turnstileSiteKey.trim().length > 0` like the Turnstile widget does. A broken config with CAPTCHA on but no site key would show a misleading noscript warning without the actual widget. Fix: add the `turnstileSiteKey.trim().length > 0` guard to the noscript block.
- [x] [Review][Patch] Post-batch re-read TOCTOU race triggers false `integrity_failure` on concurrent vote [src/adapters/d1/demo-poll.ts:245-253] — After the D1 batch commits but before the post-commit re-read, a concurrent vote on the successor would hit `voterCount !== 0` and return `integrity_failure` despite the replacement having succeeded. The `resetSuccessRaced` copy was unreachable. Fix: removed `voterCount !== 0` from the post-batch integrity check; a concurrent vote on the successor is a normal post-reset event, not a corruption signal.
- [x] [Review][Patch] Delisted-only demo poll gets misleading "moderated" error message [src/modules/polls/demo-poll.ts:234] — The guard combined `discoveryState === "delisted"` and `moderationActionCount > 0` under a single `resetModerated` error that said "A moderated Demo Poll cannot be reset." A delisted poll with zero moderation actions saw a message about moderation, not delisting. Fix: separated into two distinct guards with separate `resetDelisted` and `resetModerated` copy constants.
- [x] [Review][Patch] EXPERIENCE.md overlay counts stale at two locations [EXPERIENCE.md:67, EXPERIENCE.md:171] — Line 67 said "two confirmations" (should be three: delete poll, delete comment, reset demo) and line 171's overlay table said "Three exist" with "two confirmations" scrim-dismissable (should be four exist, three confirmations). These contradicted the already-updated UX-DR16 count and the actual four-overlay implementation.
- [x] [Review][Patch] `demo-poll.test.ts` expects wrong error code for delisted state [tests/unit/demo-poll.test.ts:230] — The test expected `"demo_reset_moderated"` for the delisted case, but the source now returns `"demo_reset_delisted"` after the Group 2 patch separated the delisted and moderated guards. Fix: updated the expected error code to match.
