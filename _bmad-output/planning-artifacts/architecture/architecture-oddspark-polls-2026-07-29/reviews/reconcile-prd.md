# PRD Reconciliation Review

## Verdict

**NEEDS REVISION — the draft is not ready to finalize against the current PRD
package.**

The voting and stable-link sharing architecture substantially preserves the
finalized product contract. The new public self-service and discovery direction
is also represented clearly enough to review. However, that direction is a
deliberate product-scope replacement, not an architecture refinement: it
contradicts several finalized PRD requirements and the confirmed authentication
stack. The spine currently claims to bind `FR-1..FR-27` while simultaneously
replacing FR-1 and FR-23. Until the source contract is amended, the spine must
remain draft and the two replacement decisions must not be marked adopted.

## Inputs Reconciled

- `ARCHITECTURE-SPINE.md`
- PRD `.memlog.md`
- `prd.md`
- `addendum.md`
- Latest user direction: small-business owners, web developers, independent
  entrepreneurs, and millennial Internet nerds must be able to create, vote on,
  discover, and share Polls.

## Findings

### 1. Critical — The new audience and capabilities intentionally replace the finalized product scope

**Source contract**

- The PRD makes Justin the sole Creator, names other poll creators as v1
  non-users, forbids a sign-up path, and declares public sign-ups,
  multi-tenancy, and a permissions system non-goals (`prd.md` §§2.1–2.2,
  Glossary, FR-1, §6).
- Every real Poll is Unlisted; no page, feed, sitemap, or index may list Polls,
  and only the Demo Poll may be linked from the landing page (`prd.md` Glossary,
  FR-23, §5).
- The memlog confirms that real Polls stay unlisted and that creator auth and
  Unlisted Polls are finalized decisions (`.memlog.md`, decisions dated
  2026-07-28).

**Draft**

- AD-4 establishes public creator identities, per-Creator ownership, and an
  administrative role.
- AD-5 establishes opt-in listed Polls, a public directory, sitemap inclusion,
  and administrative delisting.
- The capability map explicitly says FR-23 is replaced, but frontmatter still
  says the spine binds all of `FR-1..FR-27`.

**Assessment**

The latest user direction is clear enough to treat public creation and discovery
as deliberate input. It directly supersedes, rather than inherits, FR-1,
FR-23, the v1 non-user definition, the Creator glossary definition, the four
pillars statement, relevant journeys and success measures, and the
multi-tenancy/public-sign-up non-goal. The sharing direction itself does not
conflict with the PRD: stable Poll links and out-of-band sharing already satisfy
it. The conflict is public creation and discoverability.

**Required reconciliation**

Revise the PRD/spec before finalizing the spine. The replacement contract needs
at least public account creation, Poll listing consent/defaults, directory
eligibility, moderation/abuse ownership, creator account and Poll deletion,
updated journeys and success measures, and an explicit statement of whether
in-product sharing is merely copy/share-link affordance or a larger
distribution capability. Then mark AD-4 and AD-5 adopted and remove the false
claim that unchanged FR-1 and FR-23 are bound.

### 2. High — Better Auth plus Google/GitHub conflicts with the confirmed stack and is not yet an adopted decision

**Source contract**

- The addendum calls the stack “Cloudflare end-to-end” and records Cloudflare
  Access for creator authentication as user-confirmed (`addendum.md`, Platform
  stack).
- The finalized PRD requires no sign-up path and only one authenticated Creator
  (FR-1).

**Draft**

- AD-4 binds Better Auth with Google and GitHub OAuth.
- Better Auth is also presented as settled structural seed in the paradigm,
  stack table, adapters, environment model, and deployment diagram.
- The provider set remains an Open Question.

**Assessment**

Public self-service makes Cloudflare Access a poor fit for the new scope, so
changing auth is likely appropriate. But neither Better Auth nor the Google and
GitHub provider set follows from the latest user direction, and the source
package still says Cloudflare Access. An `[ASSUMPTION]` AD can carry this on the
Fast path; duplicating it throughout the supposedly factual seed makes it look
settled before confirmation.

**Required reconciliation**

Keep the public-identity boundary, ownership check, and anonymous-voter rule in
the spine, but keep the auth implementation and provider set explicitly
provisional until accepted. Update the PRD addendum when the replacement is
accepted.

### 3. High — Poll deletion as written does not satisfy FR-5

**Source contract**

- FR-5 says deleting a Poll removes the Poll and all its Votes; its link no
  longer resolves.

**Draft**

- AD-12 says deletion first tombstones the D1 aggregate and writes an outbox
  cleanup task. The described cleanup removes R2 objects, but no rule ever
  deletes the D1 Poll, Votes, Ballots, availability, Comments, claims, or codes.
- AD-6 otherwise makes D1 the durable source of truth.

**Assessment**

A hidden tombstone can make the public link disappear, but indefinite retention
of the Poll and Vote facts is not “delete entirely.” This is a direct contract
ambiguity with privacy and account-deletion consequences that become more
important under public self-service.

**Required reconciliation**

Specify a deletion transaction that removes or schedules deletion of all
Poll-owned D1 facts while retaining only the minimum idempotent R2 cleanup
payload. If recovery or compliance requires a retention period, change the
product contract explicitly rather than silently treating a tombstone as
deletion.

### 4. High — Confirmed cross-module lifecycle and security rules did not land as architecture invariants

**Source contract**

- A Poll has no draft state and is live immediately on creation (`prd.md`
  §4.1, FR-2).
- After the first Vote, question, options, Poll Type, and Meeting slots are
  locked; description stays editable (FR-5, FR-12). The memlog records the lock
  as user-confirmed.
- The five Security Toggles compose independently, default to Session Checks on
  and all others off, and may only tighten after the first Vote (FR-15). The
  memlog records the default and threat-model fix.
- Comments are one-per-Vote, share Tally visibility, use the Vote's Security
  Toggles, may be disabled per Poll, and may be deleted by the Creator (FR-24).
  The memlog records comment visibility/moderation as user-confirmed.

**Draft**

- AD-3 states a shared lifecycle/security/comments wrapper but does not fix the
  lifecycle transitions or mutation policy.
- AD-7 composes facts into Vote acceptance, but does not govern the independent
  Poll-editing, security-settings, comment-query, and moderation units.
- No other AD records these confirmed rules.

**Assessment**

These are precisely the kinds of non-obvious calls that independently built
Poll, settings, voting, comment, and results units could implement
incompatibly. A capability-map citation back to the PRD is not a substitute for
the spine’s cross-boundary consistency contract.

**Required reconciliation**

Add one concise lifecycle/mutation AD covering immediate publication,
post-first-Vote definition locks, tighten-only security, and the Meeting update
exception. Add the minimum comment ownership/visibility rule necessary to keep
the voting, results, and moderation units convergent.

### 5. Medium — The hard cost ceiling and product boundary are not binding rules

**Source contract**

- Any feature that pushes total operating cost over $0–5/month is out of scope
  by definition (`prd.md` §5; `addendum.md`, Platform stack).
- The PRD also excludes monetization, embeds, webhooks, notifications, public
  APIs, custom branding/domains, and in-product distribution (`prd.md` §6).
- The memlog records low expected traffic and Phase 1 as a complete product.

**Draft**

- AD-10 chooses polling and Deferred mentions the cost ceiling, but no
  invariant binds new adapters, auth, discovery, moderation, telemetry, or
  future transports to the $0–5 total.
- The new multi-tenant/discovery surface materially expands abuse and
  operational exposure without updating that economic constraint or its revisit
  condition.

**Assessment**

The draft does not directly add monetization, embeds, APIs, or notifications, so
there is no immediate contradiction. But the cost ceiling is a non-negotiable
architectural selection rule and should not live only in prose attached to two
deferred choices.

**Required reconciliation**

Add a platform-economics rule: no provider or runtime dependency may make the
normal operating floor exceed $5/month, with measured load or an explicit
product-scope change as the revisit condition. Revalidate the ceiling after
public creation and discovery are specified.

## Requirements That Landed Cleanly

- Four Poll Types share a strategy boundary while retaining type-specific
  validation, persistence, and projection.
- D1/R2 ownership, raw Vote facts, deterministic IRV, and privacy-preserving
  Ballot Manifests preserve the trustworthiness contract.
- Vote acceptance, duplicate claims, Voter Code redemption, Comments, and
  result versioning share one constrained mutation boundary.
- IPv4/full and IPv6 `/64` normalization plus secret-keyed digests strengthen
  the voter-privacy requirement without changing product behavior.
- Visibility is separated correctly from listing eligibility, which is the
  right structural shape if the new discovery scope is adopted.
- Conditional polling resolves the PRD’s live-results transport question within
  the expected traffic and cost profile.
- Stable, collision-safe root Poll references preserve custom links and
  out-of-band link sharing.
- Server rendering and isolated progressive enhancement preserve the
  lightweight voter surface and casual poll-card direction, though detailed
  accessibility remains owned by the UX/build artifacts.

## Resolution — 2026-07-29 PRD synchronization

The PRD package was revised on 2026-07-29 to adopt the public-direction scope
the spine had already assumed: FR-1 now makes anyone a Creator via Google or
GitHub OAuth with a separate Administrator moderation capability, FR-23 now
specifies opt-in public discovery (Unlisted default, Listed opt-in, admin-only
Delisted), and a new FR-28 specifies the visible Share Action; the Glossary,
journeys (UJ-6, UJ-7), success metrics (SM-7, SM-8), pillars, and non-goals
were updated to match, and the addendum now records Better Auth replacing
Cloudflare Access. Findings 1 and 2 — the two source-contract contradictions
that forced the NEEDS REVISION verdict — are resolved: the spine's adopted
AD-4 and AD-5 now restate, rather than replace, the source contract. Findings
3–5 had already been fixed spine-side during the Reviewer Gate (AD-12
hard-delete, AD-17 lifecycle/tighten-only, AD-18 cost ceiling), and the
updated PRD still agrees with those resolutions. No new critical or high
contradiction was introduced. **Verdict: PASS** — the spine may be finalized
once the spine-side sync edits below are made; one low-severity wording
ambiguity (Share Action on the create-confirmation surface) is noted under
spine sync, not as a conflict.

| Finding | Status | Evidence |
| --- | --- | --- |
| 1. Critical — new audience/capabilities replace finalized scope | Resolved | FR-1 rewritten for public self-service sign-in with Administrator as a separate capability (`prd.md:86-92`); FR-23 rewritten as opt-in public discovery with Unlisted default and admin-only Delisted (`prd.md:254-260`); Glossary adds Creator, Administrator, Discovery Setting, Unlisted/Listed/Delisted (`prd.md:51-52, 70-73`); UJ-6/UJ-7 (`prd.md:46-47`); SM-7/SM-8 (`prd.md:355, 360`); pillars and non-goals updated (`prd.md:303, 319`) — all now match spine AD-4 (`ARCHITECTURE-SPINE.md:80-92`) and AD-5 (`ARCHITECTURE-SPINE.md:94-107`). Residual: creator *account* deletion, listed in the original required-reconciliation, remains unspecified on both sides — an omission, not a contradiction; track as a low-severity open question. |
| 2. High — Better Auth vs confirmed Cloudflare Access stack | Resolved | Addendum now records Better Auth (Google + GitHub OAuth, sessions in D1) as the creator-auth stack and explicitly explains the replacement of Cloudflare Access when the product opened to public self-service on 2026-07-29 (`addendum.md:7`); matches spine AD-4 (`ARCHITECTURE-SPINE.md:86-89`) and the stack table (`ARCHITECTURE-SPINE.md:397`). |
| 3. High — Poll deletion does not satisfy FR-5 | Resolved | Spine AD-12 now hard-deletes the Poll plus all D1-owned children in one batch so the link immediately returns not found, retaining only self-contained R2 cleanup keys (`ARCHITECTURE-SPINE.md:212-217`); FR-5 is unchanged and demands exactly this (`prd.md:119`). The updated PRD introduces no conflicting retention or tombstone language. |
| 4. High — lifecycle/security rules not landed as invariants | Resolved | Spine AD-17 now fixes immediate-open/no-draft, post-first-Vote definition locks with editable description, tighten-only Security Toggles, and the one-per-Vote Comment ownership/visibility/moderation rule (`ARCHITECTURE-SPINE.md:272-277`); the updated PRD retains the identical rules (`prd.md:82, 120, 206, 274`). AD-17's "deleted only by the Poll owner or an administrator" matches FR-24 plus the Administrator glossary entry (`prd.md:52`). |
| 5. Medium — cost ceiling not a binding rule | Resolved | Spine AD-18 binds all provider, transport, storage, telemetry, and auth choices to the USD 5/month ceiling with an explicit revisit condition (`ARCHITECTURE-SPINE.md:285-288`); the updated PRD and addendum keep the same $0–5/mo ceiling (`prd.md:305`; `addendum.md:7`), and the new discovery/auth surface adds no dependency with a mandatory fee. |

### New conflicts introduced by the update

None at critical or high severity. Checked specifically:

- **Anonymous voters** — PRD keeps Voters anonymous with no account
  (`prd.md:53, 90`); spine AD-4 states "Voters remain anonymous"
  (`ARCHITECTURE-SPINE.md:92`). Aligned.
- **Unlisted default** — FR-23 "Every new Poll starts Unlisted" (`prd.md:255`)
  matches AD-5 (`ARCHITECTURE-SPINE.md:102-103`).
- **Admin delisting** — FR-23 and Glossary (`prd.md:73, 255`) match AD-5's
  admin-only `delisted` transitions (`ARCHITECTURE-SPINE.md:104-106`).
- **No share-gating** — FR-28 forbids gating results behind sharing and
  vendor share buttons (`prd.md:266`; `prd.md:324`); AD-13 mandates the Share
  action with Web Share API plus copy-link fallback and no gating
  (`ARCHITECTURE-SPINE.md:227-230`). Aligned.
- **Cost ceiling** — the new auth and discovery surface stays on Cloudflare
  free/Workers-Paid components; AD-18 and `prd.md:305` agree.
- **Cloudflare Access fully replaced** — the addendum records the replacement
  (`addendum.md:7`); the spine contains no Cloudflare Access reference.
- **Vocabulary** — PRD "Discovery Setting" (Unlisted/Listed/Delisted) maps
  cleanly onto the spine's `discovery_state` / `DiscoveryState` enum
  (`ARCHITECTURE-SPINE.md:101, 349`); "Visibility Setting" onto
  `result_visibility`; "Share Action", "Administrator", and "Better Auth" are
  used consistently on both sides.
- **Authorization NFR** — server-side ownership enforced against an internal
  user ID, never OAuth identifiers (`prd.md:307`), matches AD-4's
  provider-independent creator user ID (`ARCHITECTURE-SPINE.md:88-90`).

### Spine-side sync required

Expected edits to the spine itself (not conflicts; required before
finalization):

1. **Frontmatter `binds`** — `FR-1..FR-27` → `FR-1..FR-28` and
   `UJ-1..UJ-5` → `UJ-1..UJ-7` (`ARCHITECTURE-SPINE.md:12-13`), since the PRD
   now defines FR-28 (`prd.md:262-267`) and UJ-6/UJ-7 (`prd.md:46-47`).
2. **Capability Map FR-23 row** — the row still reads "Replaced by opt-in
   `discovery_state` under user direction" (`ARCHITECTURE-SPINE.md:511`); FR-23
   is no longer replaced, it *is* the opt-in discovery requirement. Reword the
   row to bind FR-23 directly (lives in `discovery`, governed by AD-5, AD-13).
3. **AD-5 binds line** — same staleness: "the replacement for FR-23"
   (`ARCHITECTURE-SPINE.md:96`) should bind FR-23 itself.
4. **Capability Map FR-28 row** — add an explicit FR-28 row (Share action,
   canonical URL surfaces; governed by AD-13, AD-2). The behavior is already
   specified in AD-13; only the mapping is missing.
5. **AD-13 Share-action surfaces** — low-severity wording ambiguity: AD-13
   mandates the Share action on "public voting, confirmation, and result"
   views (`ARCHITECTURE-SPINE.md:227-230`), while FR-28 names the
   *create-confirmation*, voting, and results surfaces (`prd.md:74, 262-263`).
   Clarify that the create-confirmation surface is covered.
6. **Deferred "BLOCKING — PRD and UX scope synchronization"** — the PRD half
   of this blocker is now resolved by the 2026-07-29 revision
   (`ARCHITECTURE-SPINE.md:520`); reword or narrow it to the remaining
   UX-artifact sync (UJ-6/UJ-7, Discover and Share surfaces in DESIGN.md /
   EXPERIENCE.md) before epic creation.
7. **Spine status** — once items 1–6 land, `status: draft`
   (`ARCHITECTURE-SPINE.md:9`) can move to final; AD-4 and AD-5 are already
   marked `[ADOPTED]` and are now backed by the source contract.
