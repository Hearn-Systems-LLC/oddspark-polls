# UX Reconciliation Review

**Artifact reviewed:** `ARCHITECTURE-SPINE.md`
**UX sources:** `.memlog.md`, `DESIGN.md`, `EXPERIENCE.md`
**Verdict:** **REQUIRES RECONCILIATION before finalization**

The architecture preserves the existing voting experience well: server-rendered
HTML with progressive enhancement, anonymous voting, immutable Vote facts,
privacy-safe duplicate controls, deterministic Tallies, stable Poll URLs, and
versioned live updates all support the UX package. The new public-creation and
discovery direction is also a legitimate deliberate override of the old
Justin-only/unlisted-only product boundary.

The problem is that the draft treats that deliberate direction as an unresolved
assumption while continuing to cite the old UX package as a binding source. The
result is a build substrate whose identity and discovery rules cannot be
implemented from the current IA/component contract without independently
inventing major user journeys.

## Findings

### 1. Critical — The explicit public-product direction is still marked as an assumption

The user has now directed that the public audience must be able to create, vote
on, discover, and share Polls. That deliberately supersedes the UX package's
Justin-only Creator and unlisted-only IA.

The spine nevertheless leaves both self-service identity and discovery tagged
`[ASSUMPTION]` (AD-4 and AD-5), then asks for the same scope confirmation again
under Open Questions. This is no longer an open question. Leaving it unresolved
allows downstream units to treat public accounts and discovery as optional.

- Architecture: AD-4 and AD-5 are assumptions
  (`ARCHITECTURE-SPINE.md:76-96`).
- Architecture: the scope is re-opened for confirmation
  (`ARCHITECTURE-SPINE.md:368-374`).
- UX: Creator is explicitly one person, with no sign-up or rendered login
  (`EXPERIENCE.md:25-29`).
- UX: no public Poll enumeration exists
  (`EXPERIENCE.md:55-59`).

**Required reconciliation:** Treat the newest direction as adopted. Remove the
scope-confirmation question and the assumption status from the decisions that
exist solely to implement that direction. Retain only genuinely unresolved
choices such as the initial OAuth provider set.

### 2. Critical — The binding UX package has no IA or component contract for accounts or discovery

AD-4 introduces Better Auth and multiple Creator principals; AD-5 introduces
listed Polls, a public directory, sitemaps, and administrative delisting. The
capability map additionally fixes `/discover`. The UX package instead says
`/creator` is reached from a private bookmark, is not linked publicly, and that
the landing page links only to the Demo Poll and repository. Its complete
component contract has a `poll-card` only for the Creator Poll list and landing
page, not a discovery result.

This is not a reason to remove public creation or discovery; the new direction
wins. It means the UX source cited by the architecture is stale at exactly the
two most load-bearing product boundaries.

- UX: `/creator` is private and not linked from public surfaces
  (`EXPERIENCE.md:37-51`).
- UX: no index, feed, sitemap entry, or recent-Polls surface
  (`EXPERIENCE.md:55-59`).
- UX: the component contract is exhaustive
  (`EXPERIENCE.md:15-17`, `DESIGN.md:493-495`).
- Architecture: public identity, discovery catalog, `/discover`, sitemap
  eligibility, and delisting are now structural
  (`ARCHITECTURE-SPINE.md:82-96`, `ARCHITECTURE-SPINE.md:350-363`).

**Required reconciliation:** Refresh `EXPERIENCE.md` and `DESIGN.md`, or add a
clearly binding companion UX addendum, covering at minimum:

- the public create entry point and its navigation from `/`;
- sign-in, callback, denial, expiry, and return-to-create behavior;
- the ownership-aware Creator list and empty state;
- `/discover`, its entry points, listing rows, empty/loading/error states, and
  pagination;
- the Creator's listed/unlisted control and the meaning of each state;
- delisted and moderation states as seen by Creator and visitor;
- `/discover` in the reserved root-slug set;
- accessible, mobile-first behavior for every new control.

Without this, teams building auth, catalog, landing, and navigation can all make
incompatible choices while still claiming compliance.

### 3. High — `CAP-SHARE` guarantees URL stability, not an easy sharing experience

AD-13 correctly makes Poll URLs canonical and immutable. The capability map,
however, places `CAP-SHARE` only in the Poll repository and public routes. The
existing UX journey provides one-tap copy immediately after creation, but it
does not define a reusable share affordance for a voter or results viewer. It
also explicitly bans social buttons and any “share to see results” gate.

That leaves the user's “share polls with friends” requirement open to divergent
implementations: Creator-only copying, a native share action, a copy-link
fallback, or no visible action after the creation screen.

- Architecture: stable public reference but no share use-case/UI boundary
  (`ARCHITECTURE-SPINE.md:187-195`,
  `ARCHITECTURE-SPINE.md:352-356`).
- UX: the only explicit easy-share moment is the post-publish full URL and copy
  action (`EXPERIENCE.md:311-316`).
- UX: social buttons and share-gated results are rejected
  (`EXPERIENCE.md:377-381`).

**Required reconciliation:** Bind a visible, text-labelled Share/Copy Link
action on the post-create, voting, and results surfaces, with progressive
enhancement and a copy fallback. Preserve direct URL sharing, never gate results
behind sharing, and do not introduce vendor-specific social buttons.

### 4. High — The live transport rule permits silent staleness

AD-10 specifies visibility-aware conditional polling, version coalescing, and
close behavior. It does not bind failure detection, last-known timestamp,
reconnection behavior, or accessible announcements. Two result-screen
implementations could therefore comply with AD-10 while one silently leaves old
counts on screen.

The UX explicitly says a broken connection must announce itself rather than
silently showing stale values. It further specifies replacement of the live
indicator, the last-known timestamp, frozen bars, a snap to current values on
reconnection, and announcements in both directions.

- Architecture: `AD-10` covers polling cadence but not connection truth
  (`ARCHITECTURE-SPINE.md:158-166`).
- UX: silent stale counts are forbidden
  (`EXPERIENCE.md:202-205`).
- UX: concrete lost/reconnected states and announcements
  (`EXPERIENCE.md:184`, `EXPERIENCE.md:232-234`).

**Required reconciliation:** Extend AD-10's rule so the live projection owns an
explicit `live | stale(last_success_at) | closed` delivery state. Poll failures
must surface stale state; a successful recovery must snap to the current
version and announce resumed updates. This is a transport/UI boundary invariant,
not optional polish.

### 5. High — The universal POST→303 convention leaves failed ballots at risk

The architecture says every mutating form uses POST then `303`. The UX requires
every rejected or failed Vote to preserve the exact ballot: choices, ranks,
availability, Comment, display name, and Voter Code. It also requires the
outcome line and document title to identify every post-submit result.

A redirect after an unsuccessful POST loses the submitted body unless another
owner persists or safely transports it. The spine defines no flash-state owner,
and persisting rejected ballot material would add privacy and cleanup concerns.
Independent route implementations could therefore clear ballots while obeying
the architecture.

- Architecture: universal POST→303 convention
  (`ARCHITECTURE-SPINE.md:237-244`).
- UX: exact ballot preservation for failure, CAPTCHA, rate-limit, and validation
  states (`EXPERIENCE.md:159-178`).
- UX: focus and `<title>` contract for every post-submit render
  (`EXPERIENCE.md:227-230`).

**Required reconciliation:** Narrow POST→303 to successful mutations and
idempotent duplicate outcomes. Render recoverable validation/admission failures
from the submitted payload without recording rejected ballot content, or define
an equally explicit short-lived state mechanism with privacy and cleanup rules.
Whichever rule is chosen must preserve the UX focus/title contract.

## UX constraints that landed cleanly

- AD-2 matches the lightweight, server-rendered voter surface and progressive
  enhancement constraint.
- AD-7 and `submission_id` support the UX prohibition on accidental duplicate
  POSTs.
- AD-8 and AD-15 preserve the trust-surface promise that no raw IP, browser
  identifier, ballot, Comment, or Voter Code leaks through Creator surfaces or
  telemetry.
- AD-9 supports stable author order, reproducible IRV results, and the published
  Ballot Manifest.
- AD-13 supports durable link sharing and root-path Poll URLs.
- Separate `result_visibility` and `discovery_state` is the correct domain split:
  public-directory eligibility must not leak a Creator-Only or After-Close
  Tally.

## Reconciliation conclusion

The architecture does not need to retreat from public creation or discovery.
It needs to adopt that scope unambiguously, update the stale UX contract around
it, and tighten three cross-unit behaviors: share affordance availability,
live-connection truth, and failed-ballot preservation. Once those changes land,
the remaining architecture is compatible with the specified mobile-first,
anonymous, trustworthy Poll experience.

## Resolution — 2026-07-29 UX synchronization

The UX package (`EXPERIENCE.md`, `DESIGN.md`, updated 2026-07-29) now adopts
the public-product direction end to end: public self-service Creators via
Google/GitHub sign-in, an ownership-aware `/creator` dashboard, a public
`/discover` catalog with pagination and full state coverage, the
unlisted/listed/delisted listing control with creator- and visitor-side
delisted treatments, and a text-labelled `share-action` (Web Share API with a
copy fallback and a visible canonical URL as the no-JavaScript baseline) on
the create-confirmation, voting, and results surfaces. Re-reconciliation
finds all five earlier findings resolved, and finds no new critical or high
contradiction with the spine: anonymous voting, server-rendering-first with
zero-JS fallbacks, live-results reconnection truth, privacy digests, and the
accessibility floor are all preserved or strengthened. **Verdict: PASS.**

| Finding | Status | Evidence |
| --- | --- | --- |
| 1. Public direction marked as an assumption | Resolved | AD-4 and AD-5 are now `[ADOPTED]` (`ARCHITECTURE-SPINE.md:80`, `ARCHITECTURE-SPINE.md:94`), and the old scope-confirmation question is gone — the lines it occupied now open Consistency Conventions (`ARCHITECTURE-SPINE.md:368-374`). The UX agrees: Creators are "anyone who signs in with Google or GitHub" (`EXPERIENCE.md:27`) and `/discover` is the public catalog (`EXPERIENCE.md:42`, `EXPERIENCE.md:60`). |
| 2. No IA/component contract for accounts or discovery | Resolved | IA table gains `/sign-in`, `/api/auth/*` callback with denial handling, `/discover`, and the create entry linked from `/` (`EXPERIENCE.md:39-48`); the reserved-slug set explicitly includes `/discover` and `/sign-in` (`EXPERIENCE.md:58`); component contract adds `sign-in`, `listing-control`, `listing-badge`, the Discover `poll-card` row, and `pagination` (`EXPERIENCE.md:162-166`); empty/loading/error states for Discover and the creator list, plus creator- and visitor-side delisted states (`EXPERIENCE.md:204`, `EXPERIENCE.md:210-215`); visual specs in `DESIGN.md:621-637` and frontmatter tokens `DESIGN.md:319-355`; accessibility floor extended to every new control (`EXPERIENCE.md:261-262`). Every bullet of the required list is covered. |
| 3. Share affordance undefined | Resolved | `share-action` is bound on create confirmation, voting page, and Tally view, text-labelled, beside the always-visible canonical URL, Web Share API with clipboard fallback and a polite `LINK COPIED` announcement, never gating results and never vendor-branded (`EXPERIENCE.md:161`; `DESIGN.md:627-629`; "Don't" `DESIGN.md:698`). This matches AD-13's share contract verbatim (`ARCHITECTURE-SPINE.md:227-230`). |
| 4. Live transport permits silent staleness | Resolved (spine-side, confirmed) | AD-10 now binds failure detection: first failed refresh shows a non-blocking `RECONNECTING` state preserving the last known Tally, capped backoff to 30s, "stale results are never presented as live" (`ARCHITECTURE-SPINE.md:186-191`). The UX matches: the lost-connection notice replaces the live indicator with the last-known timestamp, bars hold frozen, reconnection announces once and snaps to current values (`EXPERIENCE.md:199`; announcements both ways `EXPERIENCE.md:255`; notice styling as warning `DESIGN.md:643`). |
| 5. Universal POST→303 endangers failed ballots | Resolved (spine-side, confirmed) | The HTTP convention is narrowed: successful mutations use POST→303; validation failures re-render the same route with `422`, safe submitted values, and field errors (`ARCHITECTURE-SPINE.md:380`). The UX's ballot-preservation and focus/title contracts assume exactly this (`EXPERIENCE.md:176`, `EXPERIENCE.md:250`). |

### New conflicts introduced by the update

None at critical or high severity. Two low-severity observations:

1. The UX cites FR-28 and UJ-6/UJ-7 (both now present in the updated PRD —
   `prd.md:46-47`, `prd.md:262-263`), but the spine's frontmatter still binds
   only `FR-1..FR-27` and `UJ-1..UJ-5`, and the capability map has no FR-28
   row. A traceability gap, not a behavioral contradiction — AD-13 already
   governs the Share action.
2. `EXPERIENCE.md:23` carries an `[ASSUMPTION]` that the creator surface "may
   use heavier tooling if the architecture phase wants it." AD-2 answers for
   all browser surfaces: server-rendered, zero client JavaScript by default
   (`ARCHITECTURE-SPINE.md:56-64`). The assumption defers to the architecture,
   so the resolution is coherent (the creator surface stays
   server-rendered-first), but the UX could drop the dangling assumption.

Everything else checked — anonymous voting (`EXPERIENCE.md:28`,
`DESIGN.md:637`), zero-JS fallbacks for sign-in and share
(`EXPERIENCE.md:161-162`), privacy digests (`EXPERIENCE.md:316` vs AD-8), the
reserved-slug registry rule (AD-13), and the cost ceiling — is consistent.

### Spine-side sync required

No blocking edits. Recommended traceability cleanup:

1. Frontmatter `binds:` — extend to `FR-1..FR-28` and `UJ-1..UJ-7`
   (`ARCHITECTURE-SPINE.md:12-13`).
2. Capability map — add an explicit FR-28 row (or rename the existing
   `CAP-SHARE` row to include it), and name the rendered `/sign-in` page in
   the FR-1 row, which currently lists only `pages/api/auth` and middleware
   (`ARCHITECTURE-SPINE.md:502-503`).
3. Deferred table — the "BLOCKING — PRD and UX scope synchronization" entry
   (`ARCHITECTURE-SPINE.md:520`) is now satisfied: the PRD gained FR-28 and
   UJ-6/UJ-7 and the UX package gained the self-service creator, discovery,
   and Share journeys. Close it or narrow it to any remaining PRD-only
   cleanup before epics are created.
