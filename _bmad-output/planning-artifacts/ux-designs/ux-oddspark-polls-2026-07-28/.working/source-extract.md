# UX Extraction Digest — oddspark-polls

**Source files (absolute paths, referenced below by short label):**
- `PRD` = `/Volumes/fast/Github/oddspark-polls/_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md`
- `PRD-ADD` = `/Volumes/fast/Github/oddspark-polls/_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/addendum.md`
- `BRIEF` = `/Volumes/fast/Github/oddspark-polls/_bmad-output/planning-artifacts/briefs/brief-oddspark-polls-2026-07-28/brief.md`
- `BRIEF-ADD` = `/Volumes/fast/Github/oddspark-polls/_bmad-output/planning-artifacts/briefs/brief-oddspark-polls-2026-07-28/addendum.md`

## Product Summary

oddspark-polls is a personal polling platform at **polls.oddspark.dev**, running end-to-end on Cloudflare, that replaces StrawPoll for Justin's own polling (PRD §1, BRIEF "What This Is"). One creator (Justin), many anonymous voters — some reached privately by link, some arriving from public shares. It matches StrawPoll's four poll types and vote-security stack while dropping everything that exists only to sell subscription tiers; its core value is **trustworthiness** ("a poll on oddspark-polls should produce results the creator and voters can believe" — PRD §1), and it doubles as a **public demonstration of Justin's skills** with an open-source repo and a live demo poll.

## Users & Personas

Named roles (mirror verbatim; PRD §2, §3 Glossary, BRIEF "Users"):

- **Creator** — "Justin, the sole authenticated user of the creator surface. Creates and manages Polls." (PRD §3). Justin only; no public sign-ups, no teams (BRIEF).
- **Voter** — "anyone who opens a Poll link and casts a Vote. Anonymous; no account." (PRD §3)

Voter sub-types named in the Jobs-To-Be-Done (PRD §2.1) and BRIEF "Users":
- **Voter (known group)** — "vote in seconds from a shared link — trust is high, friction should be near zero." BRIEF calls these *Known small groups* (friends, colleagues, communities) reached by direct link.
- **Voter (public)** — "vote once in a poll that visibly resists ballot-stuffing." BRIEF calls these *Public internet voters* from open shares.
- **Demo visitor** — "see, in under a minute, that Justin can design and build a polished product." (PRD §2.1). Also referred to as "a visitor" / "Someone lands on polls.oddspark.dev from Justin's portfolio" in UJ-5.

Explicit **Non-Users (v1)** (PRD §2.2):
- Other poll creators. No public sign-ups, no teams — the creator surface is Justin-only.
- Organizations needing branded, embedded, or API-driven polls.

Key vocabulary that UX must reuse verbatim (PRD §3 Glossary): Poll, Poll Type, Vote, Ballot, Ballot Manifest, Tally, Round, Security Toggle, IP Check, Session Check, Voter Code, CAPTCHA, VPN Blocking, Visibility Setting, Deadline, Custom Link, Unlisted, Demo Poll, Comment.

## Stated Needs / Features

**Poll creation & lifecycle (PRD §4.1)**
- **FR-1 Creator authentication** — only the authenticated Creator can access the creator surface; an unauthenticated request to any creator surface route is denied; "No sign-up path exists anywhere on the product." (PRD §4.1)
- **FR-2 Create a Poll** — question, options, Poll Type, Security Toggles, Visibility Setting, optional Deadline, optional Custom Link; a created Poll is "immediately reachable at its link and accepts Votes." (PRD §4.1)
- **No draft state** — "A Poll is live from creation, matching StrawPoll's flow and keeping the surface simple." (PRD §4.1 description)
- **FR-3 Custom Links** — creator-chosen readable path, e.g. `polls.oddspark.dev/team-lunch`; collisions rejected "with a clear error"; reserved application paths (landing page, creator surface, static assets) rejected at assignment. `[ASSUMPTION: slugs are lowercase letters, digits, and hyphens; polls without a Custom Link get a short random ID path.]` (PRD §4.1)
- **FR-4 Deadlines and closing** — Creator sets a Deadline, Poll auto-closes at it; Creator can close any Poll manually at any time; a closed Poll still serves its Tally per Visibility Setting. (PRD §4.1)
- **FR-5 Edit and delete** — Creator can edit a Poll's **description** at any time and delete a Poll entirely (deletion removes it and all Votes; link stops resolving). "The question text, options, and Poll Type are locked once the first Vote exists." (PRD §4.1)
- Votes are final once submitted; the only exception is Meeting Poll availability (FR-13). (PRD §4.1)

**Multiple-Choice Polls (PRD §4.2)**
- **FR-6 Single-select voting** — Voter selects exactly one option; zero or multiple selections rejected client- and server-side.
- **FR-7 Multi-select voting** — Creator can enable multi-select. `[ASSUMPTION: with optional min/max selection bounds; default is 1 to all.]` Submissions outside bounds rejected. Tally reports per-option counts **and the number of Voters**.

**Ranked-Choice Polls (PRD §4.3)**
- **FR-8 Ballot casting** — Voter ranks options in strict preference order. `[ASSUMPTION: partial Ballots are allowed — a Voter may rank any subset of options, minimum one.]` "A Ballot cannot rank the same option twice or skip rank positions."
- **FR-9 IRV tabulation** — server-computed instant-runoff with an exactly specified rule set (see Behavioral Constraints).
- **FR-10 Per-Round results and Ballot Manifest** — "The Tally view shows each Round: per-option counts, who was eliminated, and exhausted-Ballot counts." On close the **Ballot Manifest** is published alongside it, "available wherever the Tally is visible." Success bar: "A reader can recompute the winner by hand from the displayed Rounds."

**Image Polls (PRD §4.4)**
- **FR-11 Image options** — Creator uploads an image per option; images served on **both** the voting page and results view; optional captions. `[ASSUMPTION: Image Polls support the same single/multi-select settings as Multiple-Choice Polls.]` `[ASSUMPTION: common web formats (JPEG/PNG/WebP), reasonable per-image size cap (~5 MB) enforced at upload.]`

**Meeting Polls (PRD §4.5)** — "Doodle-style scheduling"
- **FR-12 Propose time slots** — Creator defines candidate slots (date + start/end time) in the Creator's timezone; slots may fall on different dates with different durations within one Meeting Poll; slots lock after first Vote.
- **FR-13 Availability voting** — Voter marks each slot **yes / no / if-need-be**, with slot times shown in the Voter's local timezone; "A slot created as 15:00 EST renders as 21:00 for a CET Voter, with the source timezone noted." Voter can update their own availability while the Poll is open. `[ASSUMPTION: yes/no/if-need-be three-state responses, matching Doodle's model; Voter enters a display name so the Creator knows who answered.]`
- **FR-14 Availability grid** — "a grid of Voters × slots with per-slot totals, ranked to surface the best slot(s)." Ranked by *yes* count, ties broken by *if-need-be* count, still-tied slots "highlighted together." "The grid informs; the Creator picks the final slot — the system never auto-commits a meeting time."

**Vote security (PRD §4.6, BRIEF "Vote security")** — "a per-poll dial, not a global setting"
- **FR-15 Per-poll Security Toggles** — five independent toggles: IP Checks, Session Checks, Voter Codes, CAPTCHA, VPN Blocking. All five off = "a Vote submits with no challenge, no code, and no duplicate check." Toggles compose.
- **FR-16 Duplicate-vote checks** — IP Checks and Session Checks are separate, independently enabled.
- **FR-17 Voter Codes** — "Creator can generate N codes and view/copy the list for distribution"; a valid unused code required to Vote; exactly N Votes possible from N codes; redemption atomic.
- **FR-18 CAPTCHA on the vote action** — Cloudflare Turnstile challenge on submit; validated server-side, "not merely hidden client-side."
- **FR-19 VPN Blocking** — Votes from VPN/datacenter IPs "rejected with an explanatory message."

**Results, visibility & export (PRD §4.7)**
- **FR-20 Visibility Settings** — exact wording: "**Live** (visible to anyone with the link, updating in real time), **After Close** (hidden until the Poll closes), or **Creator-Only**."
- **FR-21 Live-updating charts** — "bar/pie charts that update without manual refresh while a Poll is open"; a Vote cast elsewhere "appears in that viewer's charts without a page reload."
- **FR-22 Export** — Creator exports raw Votes and Tally as **CSV and XLSX**; one row per Vote (options/Ballot/availability, timestamp, Comment if present); "Export is available only on the creator surface."
- **FR-23 Unlisted Polls** — "No page, feed, sitemap entry, or index lists Polls. A Poll is reachable only by its link." Landing page links only the Demo Poll and the repository.

**Comments (PRD §4.8)**
- **FR-24 Vote-attached Comments** — Voter attaches one Comment (with an optional display name) when submitting a Vote; visible wherever the Tally is visible per Visibility Setting; Creator can delete any Comment and can disable Comments per Poll; "A Voter cannot Comment without voting; one Comment max per Vote."

**Public demo surface (PRD §4.9)**
- **FR-25 Landing page** — root URL serves "what the platform is, how it was built, a link to the public repository, and the Demo Poll." Bar: "The page makes sense to a non-technical visitor and rewards a technical one."
- **FR-26 Demo Poll** — one designated Demo Poll pinned to the landing page, votable by any visitor; runs with **CAPTCHA and Session Checks on, IP Checks off**. `[ASSUMPTION: the Creator can periodically reset the Demo Poll's Votes; reset is a creator-surface action.]`
- **FR-27 Public repository** — public, presentable repo with README (what/why/how, the stack, how to run it) and architecture notes; no secrets or personal data in history.

**MVP boundaries — phasing (PRD §7)**
- *Phase 1 — Core polls, secured:* FR-1–FR-5, FR-6–FR-7, FR-15 + FR-16 + FR-18, FR-20–FR-23, FR-24, FR-25–FR-27. "Phase 1 alone replaces StrawPoll for most of Justin's real polls and stands as a complete demo."
- *Phase 2 — Ranked choice & images:* FR-8–FR-10, FR-11.
- *Phase 3 — Meeting polls:* FR-12–FR-14, last "because the availability grid and timezone handling share little code with the other types."
- *Added when first needed by a real poll:* Voter Codes (FR-17), VPN Blocking (FR-19) — "built when a real Poll actually requires them, not speculatively."

**Explicitly out of scope (PRD §6 Non-Goals, BRIEF "Explicitly out of scope")**
- No multi-tenancy: no public sign-ups, teams, workspaces, or permissions system.
- No monetization of any kind — no ads, no tiers, no billing.
- No embeds, webhooks, notifications, or public REST API.
- No custom themes, custom branding, or custom domains beyond polls.oddspark.dev.
- No PDF export ("StrawPoll doesn't have it either; CSV/XLSX suffice").
- No email invites or any in-product distribution — "Poll links and Voter Codes are shared out-of-band by the Creator."
- No migration of existing StrawPoll data; the platform starts empty.
- "Not a survey platform: one question per Poll; no multi-page forms, logic, or branching."
- BRIEF adds: ad handling, branding removal, email-invite quotas.

## Surfaces & Screens Implied

Named or directly implied by the sources:

- **Landing page / root of polls.oddspark.dev** (FR-25) — what the platform is, how it was built, repo link, pinned Demo Poll. Named explicitly as a reserved application path (FR-3).
- **Creator surface** (FR-1, FR-2, FR-22, FR-26) — the auth-gated area; named as a reserved path in FR-3. Encompasses:
  - **Poll creation form** (FR-2) — "Every setting in §4.6 and §4.7 can be configured per Poll at creation": question, options, Poll Type picker, five Security Toggles, Visibility Setting, Deadline, Custom Link.
  - **Poll management / monitoring view** (PRD §4.1: Polls are "created, configured, monitored, and closed") — includes manual close (FR-4), edit description (FR-5), delete (FR-5), export CSV/XLSX (FR-22), delete a Comment / disable Comments (FR-24), Demo Poll reset (FR-26), and enabling (never disabling) Toggles mid-poll (FR-15).
  - **Voter Code generation & distribution view** (FR-17) — "generate N codes and view/copy the list for distribution."
  - **Image upload** within Image Poll creation (FR-11).
  - **Time-slot builder** for Meeting Polls (FR-12) — date + start/end time, in the Creator's timezone.
- **Voting page** (per Poll Type; PRD §5 calls it "the voter surface"):
  - Multiple-choice single-select and multi-select ballot (FR-6, FR-7).
  - Ranked-choice ranking interface (FR-8) — strict order, no duplicates, no skipped positions, partial ranking allowed.
  - Image Poll voting page with images served (FR-11).
  - Meeting Poll availability marking, three-state per slot, localized times, display-name entry (FR-13).
  - CAPTCHA challenge inline on the vote action (FR-18).
  - Voter Code entry (FR-17).
  - Comment + optional display-name field attached to the Vote (FR-24).
- **Results / Tally view** (FR-20, FR-21):
  - Live-updating bar/pie charts.
  - Per-Round IRV results view with per-option counts, eliminations, exhausted-Ballot counts (FR-10).
  - **Ballot Manifest** view/download, published on close alongside the Tally (FR-10).
  - Availability grid (Voters × slots, per-slot totals, ranked, tie-highlighted) (FR-14).
  - Comments displayed alongside the Tally (FR-24).
- **Vote-confirmation state** — explicitly required by FR-20: "On After Close, a Voter who has voted sees a confirmation, not the Tally, until close."
- **Rejection / error states** (see Behavioral Constraints) — already voted, poll closed, invalid/used/missing code, CAPTCHA failure, VPN-blocked with explanation, out-of-bounds selection, custom-link collision, reserved-slug rejection, IRV "unresolved" halt.
- **Public repository** (FR-27) — an off-site surface with a README that is part of the demo experience.

## Form Factor & Platform Signals

- **Web only**, single domain: `polls.oddspark.dev`. No custom domains beyond it (PRD §6). No native apps mentioned.
- **Mobile is a first-class voting context**: "a Voter on a phone votes within seconds of opening the link" (PRD §5 Performance NFR); FR-26 reasons about "shared mobile/CGNAT IPs."
- **No heavy client framework on the voter surface**: "voting pages are lightweight and fast globally… No heavy client framework payload on the voter surface." (PRD §5). No UI framework is named anywhere in the sources.
- **Stack** (PRD-ADD "Platform stack", BRIEF "Platform & Constraints"): Cloudflare end-to-end — **Workers** (app), **D1** (poll/vote storage), **R2** (Image Poll uploads), **Turnstile** (CAPTCHA), **Cloudflare Access** (creator auth). No mention of Cloudflare Pages.
  - Creator auth via **Cloudflare Access** implies the login is an infrastructure-level gate, not an in-app login form; FR-1 only requires that unauthenticated requests to creator routes are denied.
  - Turnstile determines the CAPTCHA widget's visual/interaction form (FR-18).
- **Cost ceiling $0–5/mo** (free tiers or the $5 Workers Paid plan) — "A feature that would breach this ceiling is out of scope by definition." (PRD §5). Durable Objects require the Workers Paid plan but sit within the ceiling (PRD-ADD).
- **Live-update transport undecided** (polling vs. WebSockets/Durable Objects) — deferred to architecture; UX requirement is only "no manual refresh" (FR-21, PRD §9, PRD-ADD).
- **Low traffic expected**: "Low traffic is expected; the demo dimension raises the craft bar, not the scale bar." (PRD §1)

## Brand / Voice / Visual Signals

- **Product name / domain:** oddspark-polls at polls.oddspark.dev.
- **Core value to express: trustworthiness.** "The product's core value is **trustworthiness**: a poll on oddspark-polls should produce results the creator and voters can believe." (PRD §1) — duplicate votes blocked, invite-only polls admit exactly the invited, ranked-choice tabulation "follows explicit, reproducible rules."
- **Portfolio / craft bar:** "The platform is also a **public demonstration of Justin's skills**" (PRD §1). PRD §5 Craft bar NFR: "the public surfaces (landing page, voting, results) are portfolio-quality — visual polish and basic accessibility."
- **Casual poll-card feel (a named NFR, PRD §5):** "the product reads as a casual poll card — one question, tappable options, instant results — never as a survey form. This is the exact gap no OSS alternative fills… and losing it would forfeit the product's category." Reinforced by PRD §6: "Not a survey platform."
- **Competitive positioning vs. StrawPoll:** matches StrawPoll's core product "where it matters and deliberately drops the parts that only exist to sell subscription tiers" (BRIEF). StrawPoll Pro at **$28/mo ($336/yr)** gates CAPTCHA protection and custom poll links — both free on Cloudflare (PRD §1, PRD-ADD, BRIEF-ADD tier table). No ads, no tiers, no upsell surfaces anywhere (PRD §6). PRD-ADD notes the argument leans on "the *gating pattern* — trust features are Pro-only — not on exact dollar figures" (some figures flagged unverified in BRIEF-ADD).
- **Positioning vs. OSS alternatives** (BRIEF-ADD, PRD-ADD): Rallly is schedule-only, LimeSurvey is survey-heavy with no poll-card UX, OpenVoter is election-methodology-focused, SurveyJS is a building block. "No open-source project combines **casual poll-card UX** with vote-fraud prevention, meeting polls, and ranked choice."
- **Doodle** is the named reference model for Meeting Polls ("Doodle-style availability grid," "matching Doodle's model") (PRD §4.5, FR-13, BRIEF).
- **Landing page voice:** "makes sense to a non-technical visitor and rewards a technical one" (FR-25); explains "what the platform is, who built it," and lets them try it live (PRD §4.9).
- **Demo bar:** a visitor should see "in under a minute, that Justin can design and build a polished product" (PRD §2.1).
- No color, typography, logo, or visual-identity direction is stated anywhere.

## Behavioral Constraints

**Security toggle model**
- Security is "a **per-poll dial, not a global setting**" — frictionless for friends (UJ-3), resistant for public (UJ-2), exact-admission for invite-only (UJ-4). "This stack is the product's moat." (PRD §4.6)
- **Default state for a new Poll: Session Checks ON, every other Toggle OFF** — "baseline integrity with zero voter-visible friction; anything stronger is an explicit Creator choice." (FR-15)
- **Tighten-only rule:** "Once the first Vote exists, Toggles can be enabled but not disabled — protection can tighten mid-poll, never loosen." `[ASSUMPTION]` (FR-15) — the creator UI must disable/lock the "off" direction after first Vote.
- All five off → "a Vote submits with no challenge, no code, and no duplicate check." Toggles compose: "any combination enforces all enabled checks." (FR-15)

**Duplicate prevention (FR-16, PRD-ADD)**
- Session Checks on → "a repeat submission from the same browser is rejected with an **'already voted'** message; the Tally is unchanged."
- IP Checks on → repeat from same IP rejected "even from a different browser."
- Session on / IP off → "multiple Voters behind one shared IP (household, office) can each Vote, while same-browser repeats are still blocked."
- IP matching granularity (PRD-ADD): IPv4 full address, IPv6 /64 prefix. "CGNAT means IP Checks will always over-block on shared IPv4 egress; that is why they are a per-poll toggle, off by default."

**Voter Codes (FR-17)** — valid unused code required; "A Vote without a code, with an invalid code, or with an already-used code is rejected." Exactly N Votes from N codes. Redemption atomic under concurrency.

**CAPTCHA (FR-18)** — Turnstile on the vote action; server-side validation, "not merely hidden client-side."

**VPN Blocking (FR-19)** — rejection "with an explanatory message." `[ASSUMPTION: … Blocked Voters are told why and that the Poll's creator enabled this protection.]` Best-effort heuristic; quality bar is "blocks obvious datacenter/VPN egress" (PRD-ADD).

**Results visibility (FR-20)** — exact options: **Live** ("visible to anyone with the link, updating in real time"), **After Close** ("hidden until the Poll closes"), **Creator-Only**. On After Close, "a Voter who has voted sees a confirmation, not the Tally, until close." On Creator-Only, "the Tally is served only to the authenticated Creator." Comments follow the same Visibility Setting (FR-24).

**Poll lifecycle**
- No draft state; live from creation (PRD §4.1).
- Open or closed only. Closes at Deadline or by Creator at any time (FR-4).
- "A Vote submitted after close is rejected and the Voter sees that the Poll has closed." (FR-4)
- "A closed Poll still serves its Tally per its Visibility Setting." (FR-4)
- Question text, options, and Poll Type lock after the first Vote; description stays editable (FR-5). Meeting Poll slots lock the same way (FR-12).
- Deleting a Poll removes it and all Votes; the link stops resolving (FR-5).
- Votes are final once submitted, except Meeting Poll availability, which a Voter can update while open (PRD §4.1, FR-13). `[ASSUMPTION: re-identification is session-based; a returning Voter on a different device appears as a new row.]`
- Ballot Manifest publishes only on close (FR-10).

**IRV tabulation rules — all surfaced in the results UI (FR-9, FR-10)**
- Each Round counts every active Ballot toward its highest-ranked non-eliminated option.
- ">50% of active Ballots" wins and tabulation stops.
- Otherwise fewest-votes option eliminated. **Safe batch elimination:** a tied-for-fewest group is eliminated together "only when the group's combined votes are less than the votes of the next-lowest remaining option."
- Otherwise ties broken **backward**: compared "in the most recent earlier Round where they differed."
- If identical in every completed Round, "tabulation halts: the Tally reports the Poll as **unresolved at that Round**, displaying the standing counts and naming the tied options, rather than applying an arbitrary elimination." — a distinct results-screen state UX must design.
- Exhausted Ballots leave the active count and are shown per Round.
- "Tabulation is deterministic… with no randomness anywhere."
- Worked example given: A=40, B=30, C=30 → B and C are *not* batch-eliminated.

**Unlisted (FR-23)** — "No page, feed, sitemap entry, or index lists Polls." Landing page links only the Demo Poll and the repository. Custom Links trade obscurity for readability: "A memorable Custom Link makes a Poll's URL guessable — the Creator trades Unlisted obscurity for readability, per Poll." (FR-3 Notes)

**Comments (FR-24)** — one per Vote, cannot comment without voting, optional display name, Creator can delete any Comment or disable Comments per Poll, and Comment submission is covered by the same Security Toggles as its Vote.

**Privacy (PRD §5)** — "IP addresses and session identifiers are stored only to enforce duplicate checks, are never displayed to anyone (**including the Creator**), and appear in no export." The Ballot Manifest carries "rankings only, no voter data" (PRD §3) — PRD-ADD adds: no timestamps, "and no ordering that could correlate to voters in small groups (consider shuffling Ballots or sorting them canonically before publication)."

**Other cross-cutting NFRs affecting UI states (PRD §5)**
- **Baseline abuse floor:** platform-wide rate-limiting on vote submissions, independent of any Toggle. `[ASSUMPTION: limits generous enough that no human Voter ever encounters them.]` — implies a rate-limit rejection state that should be effectively unreachable for humans.
- **Input safety:** all Voter-supplied text (Comments, display names) sanitized/escaped on render; "Voter input can never execute as script on any surface."
- **Trustworthy tabulation:** all Tally computation server-side.
- **Concurrency safety:** duplicate checks and code redemption race-free.
- **Performance:** "a Voter on a phone votes within seconds of opening the link." `[ASSUMPTION: no hard numeric budget; "feels instant" at this traffic level.]`
- **Counter-metrics (PRD §8):** SM-C1 "Friction on trusted polls. Security must never creep into known-group Polls by default — a friend votes in under a minute with zero challenges." SM-C2 "False-positive blocks… VPN Blocking that turns away legitimate Voters is worse than occasional abuse on a casual poll."

## Accessibility / Regulatory / i18n

- **Accessibility:** stated, but deliberately pragmatic. PRD §5 Craft bar: "the public surfaces (landing page, voting, results) are portfolio-quality — visual polish and **basic accessibility (keyboard navigation, sensible contrast, alt text on Image Poll images)**." `[ASSUMPTION: pragmatic accessibility, not formal WCAG certification.]` (also PRD §10)
- **Regulatory:** none stated. No GDPR/CCPA/cookie-consent/legal requirements appear anywhere. The only privacy statement is the internal Voter-privacy NFR (PRD §5).
- **i18n:** no language localization stated. The only internationalization signal is **timezone localization for Meeting Polls** — FR-13 requires slot times rendered in the Voter's local timezone with the source timezone noted ("A slot created as 15:00 EST renders as 21:00 for a CET Voter"), and FR-12 has Creator-timezone slot definition. The JTBD mentions "schedule a meeting across timezones" (PRD §2.1). No multi-language UI requirement.

## Open Questions & Assumptions in Sources

**PRD §9 Open Questions**
1. "Live-results transport (polling vs. WebSockets/Durable Objects) — deferred to the architecture phase by design; the PRD requires only 'updates without manual refresh' (FR-21)."
2. "Demo Poll content and reset cadence — what question makes the best standing demo, and how often to reset it (FR-26)." — **a UX-owned question.**

**PRD §10 Assumptions Index (verbatim list)**
- §4.1 (FR-3) — Slug charset (lowercase/digits/hyphens); random short ID fallback.
- §4.2 (FR-7) — Multi-select has optional min/max bounds, default 1-to-all.
- §4.3 (FR-8) — Partial Ballots allowed (rank any subset, minimum one).
- §4.4 — Image Polls reuse single/multi-select settings; JPEG/PNG/WebP, ~5 MB cap.
- §4.5 (FR-13) — Yes/no/if-need-be availability; Voters give a display name on Meeting Polls.
- §4.5 (FR-13) — Availability updates re-identify by browser session; new device = new row.
- §4.5 (FR-14) — If-need-be is a tie-break weight only, never a fraction of a yes.
- §4.6 (FR-15) — Tighten-only rule: Toggles can be enabled but not disabled after the first Vote.
- §4.6 (FR-19) — VPN Blocking is best-effort heuristic; blocked Voters get an explanation.
- §4.7 (FR-21) — Live-update transport deferred to architecture.
- §4.9 (FR-26) — Demo Poll votes are creator-resettable.
- §5 — Baseline rate limits are generous enough that no human Voter encounters them.
- §5 — Performance: no numeric budget; lightweight voter surface.
- §5 — Accessibility: pragmatic (keyboard, contrast, alt text), not formal WCAG certification.

**Already resolved upstream — do not reopen** (PRD §10 closing note): "Confirmed 2026-07-28 and promoted to plain requirements: no draft state (§4.1); options/type lock after first Vote (FR-5); IP Checks and Session Checks as independent Toggles (FR-16); Comment visibility/moderation rules (FR-24); Voter-privacy NFR (§5)."

**BRIEF-level `[ASSUMPTION]` tags** (BRIEF "Platform & Constraints", "Success Criteria", "Risks"): Cloudflare stack choice; live-results transport; heuristic VPN blocking; $0–5/mo cost target; no StrawPoll data migration; phasing is acceptable and belongs in the PRD.

**BRIEF-ADD data-quality caveats:** StrawPoll pricing is "point-in-time research (2026-07-28)"; ad-free vote quota interpretation "unverified"; "StrawPoll Meetings" pricing "a single unverified source, not confirmed pricing"; the "Absent from StrawPoll" items (Comments, public REST API, custom domains) are "not found in StrawPoll's public documentation" rather than confirmed absences — so Comments is "*beyond* parity, not a parity requirement."

**BRIEF Risks relevant to UX:** "Scope is large. Four poll types plus a four-mechanism anti-cheat stack is weeks of work, not a weekend." · "VPN blocking quality — best-effort heuristics may frustrate legitimate voters; the per-poll toggle mitigates." · "IRV tie-breaking and elimination rules need explicit specification… or results lose trustworthiness." · "Meeting polls are a different UX (availability grids, timezones) and share little code with the other three types."

## Journeys / Flows Defined Upstream

Five journeys are defined in PRD §2.3 "Key User Journeys" — reuse these IDs and titles verbatim:

- **UJ-1. Justin runs a public poll.** "Authenticated on the creator surface, Justin creates a multiple-choice Poll, gives it the custom link `polls.oddspark.dev/team-lunch`, enables CAPTCHA, IP Checks, and Session Checks, sets a deadline, and shares the link publicly. He watches the live chart update as votes arrive; the Poll auto-closes at the deadline."
- **UJ-2. A public voter votes once.** "A stranger opens a shared link, picks an option, passes the CAPTCHA, and sees the live results. Trying again from the same browser or IP, they are told they've already voted — their duplicate attempt does not change the Tally."
- **UJ-3. Friends pick a meeting time.** "Justin creates a Meeting Poll with five time slots and sends the link to four friends. No CAPTCHA, no codes — each friend marks yes / no / if-need-be per slot in their own timezone, in under a minute. The availability grid shows the winning slot."
- **UJ-4. An invite-only ranked-choice vote.** "Justin creates a Ranked-Choice Poll for a community decision, generates 25 Voter Codes, and distributes them. Only code holders can vote; each code works exactly once. Results show every elimination round, so anyone can verify the winner."
- **UJ-5. A visitor evaluates the demo.** "Someone lands on polls.oddspark.dev from Justin's portfolio. The landing page explains what the platform is and how it's built, links to the repository, and offers a live Demo Poll they can actually vote in."

**Journey → feature mapping stated in the PRD:** §4.1 realizes UJ-1 · §4.2 realizes UJ-1, UJ-2 · §4.3 realizes UJ-4 · §4.5 realizes UJ-3 · §4.6 spans UJ-2, UJ-3, UJ-4 (FR-17 → UJ-4; FR-18 → UJ-2, UJ-5) · §4.7 realizes UJ-1, UJ-2 · §4.9 realizes UJ-5.

**Success metrics tied to journeys (PRD §8):** SM-1 (Justin's next real poll runs here — *Phase 1 gate*), SM-2 (a public Poll withstands a duplicate-voting attempt — *Phase 1 gate*), SM-3 (Voter Codes admit exactly the invited — validated when Voter Codes ship), SM-4 (ranked-choice recomputable from per-Round display and Ballot Manifest — *Phase 2 gate*), SM-5 (cost within $0–5), SM-6 (the demo "earns a comment, a repo star, or a conversation").
