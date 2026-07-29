---
title: oddspark-polls PRD
status: final
created: 2026-07-28
updated: 2026-07-29
---

# PRD: oddspark-polls

## 0. Document Purpose

This PRD defines the requirements for oddspark-polls, a public polling platform at polls.oddspark.dev, for the downstream architecture, UX, and implementation phases of this solo project. It builds on the finalized product brief and its competitive-research addendum (`_bmad-output/planning-artifacts/briefs/brief-oddspark-polls-2026-07-28/`) rather than repeating their research. Vocabulary is anchored in §3 Glossary; features are grouped in §4 with globally numbered FRs; inferences are tagged inline `[ASSUMPTION]` and indexed in §10.

## 1. Vision

oddspark-polls replaces StrawPoll for Justin's own polling — and for anyone else's. It matches the parts of StrawPoll that matter — all four poll types, trustworthy vote security, clean results — and deliberately drops the parts that exist only to sell subscription tiers. StrawPoll's free tier is ad-supported and withholds the features that make a poll trustworthy and shareable, reserving them for its $28/mo Pro tier (per 2026-07-28 research). Those same capabilities — CAPTCHA protection, custom poll links — are free on the Cloudflare platform this project runs on. That, plus the portfolio value of building it well, is the argument for the build.

The product is **open to the public**: anyone can sign in with Google or GitHub, create their own polls, opt them into public discovery, and share them. The audience is small business owners, web developers, independent entrepreneurs, and millennial Internet nerds — people who want to run a quick, trustworthy poll without a subscription or a survey tool.

The product's core value is **trustworthiness**: a poll on oddspark-polls should produce results the creator and voters can believe. That means duplicate votes are blocked, invite-only polls admit exactly the invited voters, and ranked-choice tabulation follows explicit, reproducible rules.

The platform is also a **public demonstration of Justin's skills**: the site is publicly reachable, a visitor can try a live demo poll or browse public polls, and the repository is open source. Low traffic is expected; the demo dimension raises the craft bar, not the scale bar.

## 2. Target User

### 2.1 Jobs To Be Done

- **Creator (anyone signed in):** run a poll among friends, colleagues, customers, or a public audience and trust the result; schedule a meeting across timezones; export raw data when needed; pay ~nothing.
- **Voter (known group):** vote in seconds from a shared link — trust is high, friction should be near zero.
- **Voter (public):** vote once in a poll that visibly resists ballot-stuffing.
- **Discoverer:** find open public polls worth voting in, without receiving a link first.
- **Demo visitor:** see, in under a minute, that Justin can design and build a polished product.

### 2.2 Non-Users (v1)

- Organizations needing branded, embedded, or API-driven polls.
- Teams needing shared workspaces, roles, or a permissions system beyond a single site administrator.

### 2.3 Key User Journeys

- **UJ-1. Justin runs a public poll.** Authenticated on the creator surface, Justin creates a multiple-choice Poll, gives it the custom link `polls.oddspark.dev/team-lunch`, enables CAPTCHA, IP Checks, and Session Checks, sets a deadline, and shares the link publicly. He watches the live chart update as votes arrive; the Poll auto-closes at the deadline.
- **UJ-2. A public voter votes once.** A stranger opens a shared link, picks an option, passes the CAPTCHA, and sees the live results. Trying again from the same browser or IP, they are told they've already voted — their duplicate attempt does not change the Tally.
- **UJ-3. Friends pick a meeting time.** Justin creates a Meeting Poll with five time slots and sends the link to four friends. No CAPTCHA, no codes — each friend marks yes / no / if-need-be per slot in their own timezone, in under a minute. The availability grid shows the winning slot.
- **UJ-4. An invite-only ranked-choice vote.** Justin creates a Ranked-Choice Poll for a community decision, generates 25 Voter Codes, and distributes them. Only code holders can vote; each code works exactly once. Results show every elimination round, so anyone can verify the winner.
- **UJ-5. A visitor evaluates the demo.** Someone lands on polls.oddspark.dev from Justin's portfolio. The landing page explains what the platform is and how it's built, links to the repository, and offers a live Demo Poll they can actually vote in.
- **UJ-6. A new creator signs in and publishes.** Maya runs a small bakery. She lands on polls.oddspark.dev, signs in with Google in seconds, and creates a multiple-choice Poll ("Which muffin should we bake next?"). Her new Poll is Unlisted by default; she opts it into the public directory, then uses the Share action to send the link to her Instagram followers. Later she checks the live results from her dashboard.
- **UJ-7. A visitor discovers a poll to vote in.** A stranger browsing the site opens Discover, finds an open listed Poll that looks fun, and votes in seconds. They tap Share on the results view to send it to a group chat — the canonical link is copied and shared without leaving the page.

## 3. Glossary

- **Creator** — any authenticated user of the creator surface; signs in with Google or GitHub. Creates and manages their own Polls.
- **Administrator** — the site operator (Justin), a Creator with the additional moderation capability: delisting Polls and deleting Comments anywhere.
- **Voter** — anyone who opens a Poll link and casts a Vote. Anonymous; no account.
- **Poll** — a single question with options, one Poll Type, per-poll Security Toggles, a Visibility Setting, a Discovery Setting, an optional Deadline, and an optional Custom Link. New Polls are Unlisted by default.
- **Poll Type** — one of: Multiple-Choice Poll, Ranked-Choice Poll, Image Poll, Meeting Poll.
- **Vote** — one Voter's submission to one Poll: selected option(s), a Ballot, or availability marks, plus an optional Comment.
- **Ballot** — a Ranked-Choice Poll Vote: an ordered ranking of some or all options.
- **Ballot Manifest** — the anonymized set of all Ballots (rankings only, no voter data) published when a Ranked-Choice Poll closes.
- **Tally** — the computed result of a Poll: counts, percentages, and (for Ranked-Choice) per-Round results.
- **Round** — one elimination step of IRV tabulation.
- **Security Toggle** — a per-poll on/off control for one of: IP Checks, Session Checks, Voter Codes, CAPTCHA, VPN Blocking.
- **IP Check** — rejection of a second Vote from the same IP address on one Poll.
- **Session Check** — rejection of a second Vote from the same browser session on one Poll.
- **Voter Code** — a unique one-time code that admits exactly one Vote on one Poll.
- **CAPTCHA** — the Cloudflare Turnstile challenge applied to the vote action.
- **VPN Blocking** — best-effort rejection of Votes from VPN/datacenter IPs.
- **Visibility Setting** — who sees the Tally and when: Live, After Close, or Creator-Only.
- **Deadline** — a time at which a Poll auto-closes; closed Polls accept no Votes.
- **Custom Link** — a creator-chosen readable path (e.g. `/team-lunch`) replacing the random Poll ID.
- **Discovery Setting** — whether a Poll appears in the public directory: Unlisted, Listed, or Delisted. Independent of the Visibility Setting (who sees the Tally).
- **Unlisted** — reachable only by link; absent from the public directory, sitemaps, and indexes. The default for every new Poll.
- **Listed** — opted into the public directory by the Creator; appears on Discover and in sitemaps while the Poll is open.
- **Delisted** — removed from the directory by an Administrator; still reachable by link. Only an Administrator can clear Delisted.
- **Share Action** — the visible control on the create-confirmation, voting, and results surfaces that invokes the device's native share sheet when available and copies the canonical link otherwise.
- **Demo Poll** — the one publicly showcased Poll pinned to the landing page.
- **Comment** — an optional short text a Voter attaches to their Vote; at most one per Vote.

## 4. Features

### 4.1 Poll Creation & Lifecycle

**Description:** The creator surface, gated by creator auth, is where Polls are created, configured, monitored, and closed. Realizes UJ-1. A Poll is either open or closed; it closes at its Deadline or whenever the Creator closes it. There is no separate draft state — a Poll is live from creation, matching StrawPoll's flow and keeping the surface simple. Votes are final once submitted; the one exception is Meeting Poll availability, which a Voter can update (FR-13).

**Functional Requirements:**

#### FR-1: Creator sign-in
Anyone can become a Creator by signing in with Google or GitHub OAuth. Only an authenticated Creator can access the creator surface, and only for Polls they own. Realizes UJ-1, UJ-6.
**Consequences (testable):**
- An unauthenticated request to any creator surface route is denied, with a sign-in path offered.
- Sign-in offers both Google and GitHub; Voters never need an account.
- A Creator can view, edit, close, and delete only their own Polls; one Creator cannot mutate another's Polls.
- Administrative moderation (delisting, deleting any Comment) is a separate capability held by the Administrator, not a creator permission.

#### FR-2: Create a Poll
Creator can create a Poll: question, options, Poll Type, Security Toggles, Visibility Setting, optional Deadline, optional Custom Link.
**Consequences (testable):**
- A created Poll is immediately reachable at its link and accepts Votes.
- Every setting in §4.6 and §4.7 can be configured per Poll at creation.

#### FR-3: Custom Links
Creator can assign a Custom Link to a Poll. Realizes UJ-1.
**Consequences (testable):**
- `polls.oddspark.dev/{custom-link}` resolves to the Poll.
- Assigning a Custom Link already in use is rejected with a clear error.
- A Custom Link cannot collide with reserved application paths (landing page, creator surface, static assets); reserved slugs are rejected at assignment.
- `[ASSUMPTION: slugs are lowercase letters, digits, and hyphens; polls without a Custom Link get a short random ID path.]`

**Notes:** A memorable Custom Link makes a Poll's URL guessable — the Creator trades Unlisted obscurity for readability, per Poll.

#### FR-4: Deadlines and closing
Creator can set a Deadline; the Poll auto-closes at it. Creator can close any Poll manually at any time.
**Consequences (testable):**
- A Vote submitted after close is rejected and the Voter sees that the Poll has closed.
- A closed Poll still serves its Tally per its Visibility Setting.

#### FR-5: Edit and delete
Creator can edit a Poll's description at any time and can delete a Poll entirely.
**Consequences (testable):**
- Deleting a Poll removes it and all its Votes; its link no longer resolves.
- The question text, options, and Poll Type are locked once the first Vote exists — editing what people voted on would silently invalidate cast Votes and undermine trustworthiness. The description remains editable.

### 4.2 Multiple-Choice Polls

**Description:** The workhorse Poll Type: pick one option, or several when the Creator allows multi-select. Realizes UJ-1, UJ-2.

#### FR-6: Single-select voting
Voter can select exactly one option and submit a Vote.
**Consequences (testable):**
- A submission with zero or multiple selections on a single-select Poll is rejected client- and server-side.

#### FR-7: Multi-select voting
Creator can enable multi-select on a Multiple-Choice Poll. `[ASSUMPTION: with optional min/max selection bounds; default is 1 to all.]`
**Consequences (testable):**
- A submission outside the configured bounds is rejected.
- The Tally reports per-option counts and the number of Voters.

### 4.3 Ranked-Choice Polls

**Description:** Voters rank options; the winner is computed by instant-runoff (IRV). Because trustworthiness is the core value, the tabulation rules are specified exactly and results expose every Round. Realizes UJ-4.

#### FR-8: Ballot casting
Voter can rank options in strict preference order. `[ASSUMPTION: partial Ballots are allowed — a Voter may rank any subset of options, minimum one.]`
**Consequences (testable):**
- A Ballot cannot rank the same option twice or skip rank positions.

#### FR-9: IRV tabulation
System computes the Tally by instant-runoff with these exact rules:
**Consequences (testable):**
- Each Round counts every active Ballot toward its highest-ranked non-eliminated option.
- If an option holds more than 50% of active Ballots, it wins and tabulation stops.
- Otherwise the option with the fewest votes is eliminated. A group of options tied for fewest is eliminated together only when the group's combined votes are less than the votes of the next-lowest remaining option (**safe batch elimination** — the group could never catch up, so eliminating it cannot change the outcome).
- A tie for fewest that cannot be safely batch-eliminated is broken **backward**: the tied options' counts are compared in the most recent earlier Round where they differed, and the option(s) with fewer votes there are eliminated.
- If tied options hold identical counts in every completed Round, tabulation halts: the Tally reports the Poll as **unresolved at that Round**, displaying the standing counts and naming the tied options, rather than applying an arbitrary elimination.
- Worked check: with first-preference counts A=40, B=30, C=30, B and C are *not* batch-eliminated (their combined 60 exceeds A's 40) — A can never win on mere plurality when a majority ranked it last.
- A Ballot whose ranked options are all eliminated becomes exhausted and leaves the active count for subsequent Rounds.
- Tabulation is deterministic: the same set of Ballots always yields the identical sequence of Rounds and outcome, with no randomness anywhere.

#### FR-10: Per-Round results and Ballot Manifest
The Tally view shows each Round: per-option counts, who was eliminated, and exhausted-Ballot counts. When the Poll closes, the Ballot Manifest is published alongside it.
**Consequences (testable):**
- A reader can recompute the winner by hand from the displayed Rounds.
- On close, the Ballot Manifest — every Ballot's rankings, stripped of all voter-identifying data — is available wherever the Tally is visible, sufficient to independently recompute every Round and the outcome.

### 4.4 Image Polls

**Description:** Options are Creator-uploaded images with optional captions. Voting and tabulation behave as they do in a Multiple-Choice Poll. `[ASSUMPTION: Image Polls support the same single/multi-select settings as Multiple-Choice Polls.]`

#### FR-11: Image options
Creator can upload an image per option when creating an Image Poll.
**Consequences (testable):**
- Uploaded images are served on the voting page and results view.
- `[ASSUMPTION: common web formats (JPEG/PNG/WebP), reasonable per-image size cap (~5 MB) enforced at upload.]`

### 4.5 Meeting Polls

**Description:** Doodle-style scheduling: the Creator proposes time slots; Voters mark availability; the grid reveals the best slot. This type has its own UX (availability grid, timezones) and shares little with the other types — hence its own build phase (§7). Realizes UJ-3.

#### FR-12: Propose time slots
Creator can define a set of candidate time slots (date + start/end time) in the Creator's timezone.
**Consequences (testable):**
- Slots may fall on different dates and have different durations within one Meeting Poll.
- Slots are locked once the first Vote exists, per the FR-5 rule — slots are a Meeting Poll's options.

#### FR-13: Availability voting
Voter can mark each slot yes / no / if-need-be, with slot times displayed in the Voter's local timezone. `[ASSUMPTION: yes/no/if-need-be three-state responses, matching Doodle's model; Voter enters a display name so the Creator knows who answered.]`
**Consequences (testable):**
- A slot created as 15:00 EST renders as 21:00 for a CET Voter, with the source timezone noted.
- A Voter can update their own availability while the Poll is open. `[ASSUMPTION: re-identification is session-based; a returning Voter on a different device appears as a new row.]`

#### FR-14: Availability grid
The Tally view is a grid of Voters × slots with per-slot totals, ranked to surface the best slot(s).
**Consequences (testable):**
- Slots are ranked by count of *yes* responses; ties between slots are broken by count of *if-need-be* responses; slots still tied are highlighted together. `[ASSUMPTION: if-need-be counts as tie-break weight only, never as a fraction of a yes.]`
- The grid informs; the Creator picks the final slot — the system never auto-commits a meeting time.

### 4.6 Vote Security

**Description:** Security is a **per-poll dial, not a global setting**: a friends poll stays frictionless (UJ-3) while a public poll resists abuse (UJ-2) and an invite-only poll admits exactly the invited (UJ-4). This stack is the product's moat.

#### FR-15: Per-poll Security Toggles
Creator can enable/disable each of the five Security Toggles independently per Poll.
**Consequences (testable):**
- All five off: a Vote submits with no challenge, no code, and no duplicate check.
- Toggles compose: any combination enforces all enabled checks.
- A new Poll defaults to Session Checks on and every other Toggle off — baseline integrity with zero voter-visible friction; anything stronger is an explicit Creator choice.
- Once the first Vote exists, Toggles can be enabled but not disabled — protection can tighten mid-poll, never loosen. `[ASSUMPTION: tighten-only rule, so a Poll's protections cannot be quietly dropped after Votes are cast.]`

#### FR-16: Duplicate-vote checks
IP Checks and Session Checks are separate Security Toggles, enabled independently per Poll.
**Consequences (testable):**
- With Session Checks on, a repeat submission from the same browser is rejected with an "already voted" message; the Tally is unchanged.
- With IP Checks on, a repeat submission from the same IP address is rejected, even from a different browser.
- With Session Checks on and IP Checks off, multiple Voters behind one shared IP (household, office) can each Vote, while same-browser repeats are still blocked.

#### FR-17: Voter Codes
Creator can generate a batch of Voter Codes for a Poll; with this Toggle on, a valid unused code is required to Vote. Realizes UJ-4.
**Consequences (testable):**
- Creator can generate N codes and view/copy the list for distribution.
- A Vote without a code, with an invalid code, or with an already-used code is rejected.
- Exactly N Votes are possible from N codes.
- Code redemption is atomic: concurrent submissions using the same code yield exactly one accepted Vote.

#### FR-18: CAPTCHA on the vote action
With this Toggle on, submitting a Vote requires passing the CAPTCHA. Realizes UJ-2, UJ-5.
**Consequences (testable):**
- A submission without a valid CAPTCHA token is rejected server-side (not merely hidden client-side).

#### FR-19: VPN Blocking
With this Toggle on, Votes from IPs identified as VPN/datacenter sources are rejected with an explanatory message. `[ASSUMPTION: best-effort heuristic (datacenter/ASN identification), accepted as approximate rather than StrawPoll-grade — the one feature where parity is approximate. Blocked Voters are told why and that the Poll's creator enabled this protection.]`
**Consequences (testable):**
- A request from a known datacenter IP range is rejected when the Toggle is on and accepted when off.

### 4.7 Results, Visibility & Export

**Description:** Results render as live-updating charts, gated by each Poll's Visibility Setting and exportable by the Creator. Discovery is opt-in per Poll (FR-23). Realizes UJ-1, UJ-2, UJ-6, UJ-7.

#### FR-20: Visibility Settings
Creator can set the Tally visibility per Poll: **Live** (visible to anyone with the link, updating in real time), **After Close** (hidden until the Poll closes), or **Creator-Only**.
**Consequences (testable):**
- On After Close, a Voter who has voted sees a confirmation, not the Tally, until close.
- On Creator-Only, the Tally is served only to the authenticated Creator.

#### FR-21: Live-updating charts
The Tally view shows bar/pie charts that update without manual refresh while a Poll is open. `[ASSUMPTION: transport (polling vs. WebSockets/Durable Objects) is deferred to architecture; the requirement is only "no manual refresh."]`
**Consequences (testable):**
- A Vote cast while another viewer has the Tally open appears in that viewer's charts without a page reload.

#### FR-22: Export
Creator can export any Poll's raw Votes and Tally as CSV and XLSX.
**Consequences (testable):**
- Raw export includes one row per Vote (options/Ballot/availability, timestamp, Comment if present).
- Export is available only on the creator surface.

#### FR-23: Opt-in public discovery
Every new Poll starts Unlisted. The Creator can move a Poll between Unlisted and Listed at any time; Listed Polls appear on the public Discover page and in sitemaps while open. The Administrator can Delist any Poll; only the Administrator can clear Delisted. Realizes UJ-6, UJ-7.
**Consequences (testable):**
- A new Poll never appears in discovery, sitemaps, or any index without an explicit creator opt-in.
- The Discover page shows only effectively open, Listed Polls.
- Unlisted and Delisted Polls remain reachable by link but are absent from the directory and sitemaps.
- Delisting changes neither Poll ownership, Visibility Setting, nor Vote data.

#### FR-28: Share a Poll
The create-confirmation, voting, and results surfaces render an explicit, text-labelled Share Action alongside the Poll's canonical URL. The action uses the device's native share sheet when available and a copy-link fallback otherwise. Realizes UJ-6, UJ-7.
**Consequences (testable):**
- A Voter or results viewer can share a Poll without leaving the surface or hunting for the URL.
- Results are never gated behind sharing, and no vendor-specific social buttons are introduced.
- The shared URL is the canonical link and never changes.

### 4.8 Comments

**Description:** A Voter may leave one short Comment alongside their Vote — beyond StrawPoll parity, but cheap and humanizing for known-group polls.

#### FR-24: Vote-attached Comments
Voter can attach one Comment (with an optional display name) when submitting a Vote. Comments are visible wherever the Tally is visible, per the Poll's Visibility Setting. The Creator can delete any Comment and can disable Comments per Poll.
**Consequences (testable):**
- A Voter cannot Comment without voting; one Comment max per Vote.
- Comment submission is covered by the same Security Toggles as the Vote it belongs to.

### 4.9 Public Demo Surface

**Description:** The skills-demo face of the product. A visitor arriving at the root of polls.oddspark.dev sees what this is, who built it, and can try it live. Realizes UJ-5.

#### FR-25: Landing page
The root URL serves a landing page: what the platform is, how it was built, a link to the public repository, the Demo Poll, and clear entries to Discover and to creating a Poll (sign-in).
**Consequences (testable):**
- The page makes sense to a non-technical visitor and rewards a technical one.
- A visitor can reach Discover and the sign-in/create entry without a shared link.

#### FR-26: Demo Poll
One designated Demo Poll is pinned to the landing page and votable by any visitor.
**Consequences (testable):**
- The Demo Poll runs with CAPTCHA and Session Checks on and IP Checks off — every visitor can vote (shared mobile/CGNAT IPs are never falsely blocked), same-browser repeats are still stopped, and the CAPTCHA demonstrates the security stack.
- `[ASSUMPTION: the Creator can periodically reset the Demo Poll's Votes so the demo stays fresh; reset is a creator-surface action.]`

#### FR-27: Public repository
The source repository is public and presentable: a README covering what/why/how, and architecture notes sufficient for a technical reader to evaluate the work.
**Consequences (testable):**
- README explains the product, the stack, and how to run it.
- No secrets or personal data in the repository history.

## 5. Cross-Cutting NFRs

Four pillars are non-negotiable in every phase: duplicate-vote protection, Unlisted-by-default privacy, data ownership, and authenticated creator ownership. The NFRs below carry them.

- **Cost:** total running cost stays within $0–5/mo (free tiers or the $5 Workers Paid plan). A feature that would breach this ceiling is out of scope by definition.
- **Data ownership:** all Poll and Vote data lives in Justin's own Cloudflare account; no third party holds poll history.
- **Authorization:** every creator-surface action is scoped to Polls the signed-in Creator owns, enforced server-side against an internal user ID — never against OAuth account identifiers. Administrative moderation is a separate, explicit capability.
- **Voter privacy:** IP addresses and session identifiers are stored only to enforce duplicate checks, are never displayed to anyone (including the Creator), and appear in no export.
- **Performance:** voting pages are lightweight and fast globally — a Voter on a phone votes within seconds of opening the link. No heavy client framework payload on the voter surface. `[ASSUMPTION: no hard numeric budget; "feels instant" at this traffic level.]`
- **Trustworthy tabulation:** all Tally computation happens server-side; a Voter cannot influence a Tally except by their own valid Vote.
- **Baseline abuse floor:** independent of any Security Toggle, the platform rate-limits vote submissions, Poll creation, and sign-in attempts per client — protecting the cost ceiling and blunting bulk stuffing even on all-toggles-off Polls. `[ASSUMPTION: limits generous enough that no human Voter or Creator ever encounters them.]`
- **Input safety:** all Voter-supplied text (Comments, display names) is sanitized/escaped on render; Voter input can never execute as script on any surface.
- **Concurrency safety:** duplicate checks and Voter Code redemption are race-free — concurrent submissions can never produce more accepted Votes than the rules allow.
- **Craft bar:** the public surfaces (landing page, voting, results) are portfolio-quality — visual polish and basic accessibility (keyboard navigation, sensible contrast, alt text on Image Poll images). `[ASSUMPTION: pragmatic accessibility, not formal WCAG certification.]`
- **Casual poll-card feel:** the product reads as a casual poll card — one question, tappable options, instant results — never as a survey form. This is the exact gap no OSS alternative fills (see addendum), and losing it would forfeit the product's category.

## 6. Non-Goals (Explicit)

- Not a team product: no teams, workspaces, or role/permissions system beyond the single Administrator. Each Creator manages only their own Polls.
- No monetization of any kind — no ads, no tiers, no billing.
- No embeds, webhooks, notifications, or public REST API.
- No custom themes, custom branding, or custom domains beyond polls.oddspark.dev.
- No PDF export (StrawPoll doesn't have it either; CSV/XLSX suffice).
- No email invites or automated distribution — the in-product Share Action is the only distribution affordance; Polls spread by people sharing links. No social-media integrations or vendor share buttons.
- No migration of existing StrawPoll data; the platform starts empty.
- Not a survey platform: one question per Poll; no multi-page forms, logic, or branching.

## 7. Scope & Phasing

### 7.1 Phase 1 — Core polls, secured
- Poll creation & lifecycle (FR-1–FR-5), Multiple-Choice Polls (FR-6–FR-7)
- Security Toggles infrastructure (FR-15) with IP Checks + Session Checks (FR-16) and CAPTCHA (FR-18)
- Visibility, live charts, export, opt-in discovery, sharing (FR-20–FR-23, FR-28), Comments (FR-24)
- Public demo surface (FR-25–FR-27)

Phase 1 alone replaces StrawPoll for most real polls and stands as a complete demo.

### 7.2 Phase 2 — Ranked choice & images
- Ranked-Choice Polls with full IRV spec (FR-8–FR-10)
- Image Polls (FR-11)

### 7.3 Phase 3 — Meeting polls
- Meeting Polls (FR-12–FR-14) — last because the availability grid and timezone handling share little code with the other types.

### 7.4 Added when first needed by a real poll
- Voter Codes (FR-17), VPN Blocking (FR-19) — built when a real Poll actually requires them, not speculatively.

## 8. Success Metrics

**Primary**
- **SM-1**: Justin's next real poll runs on polls.oddspark.dev instead of StrawPoll — as does every poll after it. Validates FR-1–FR-7, FR-20–FR-23. *Phase 1 gate.*
- **SM-2**: A publicly shared Poll withstands a duplicate-voting attempt — session/IP/CAPTCHA verifiably block repeat Votes. Validates FR-16, FR-18. *Phase 1 gate.*
- **SM-3**: An invite-only Poll using Voter Codes admits exactly the invited Voters and no one else. Validates FR-17. *Validated when Voter Codes ship (§7.4) — not a Phase 1 gate.*
- **SM-4**: Ranked-choice results tabulate correctly, including elimination Rounds and ties, and anyone can recompute them from the per-Round display and Ballot Manifest. Validates FR-9, FR-10. *Phase 2 gate.*
- **SM-7**: A creator other than Justin completes the full self-service loop — signs in with Google or GitHub, creates a Poll, shares it, and collects real Votes — with no involvement from Justin. Validates FR-1–FR-3, FR-28. *Phase 1 gate.*

**Secondary**
- **SM-5**: Monthly cost stays within the $0–5 target. Validates the §5 cost NFR.
- **SM-6**: At least one person who saw the demo mentions it — the portfolio surface earns a comment, a repo star, or a conversation. Validates FR-25–FR-27.
- **SM-8**: A Voter finds and votes in a Poll through Discover without receiving a link first. Validates FR-23.

**Counter-metrics (do not optimize)**
- **SM-C1**: Friction on trusted polls. Security must never creep into known-group Polls by default — a friend votes in under a minute with zero challenges. Counterbalances SM-2/SM-3.
- **SM-C2**: False-positive blocks. VPN Blocking that turns away legitimate Voters is worse than occasional abuse on a casual poll; the per-poll Toggle exists so this is opt-in per stakes. Counterbalances SM-2.

## 9. Open Questions

1. Live-results transport (polling vs. WebSockets/Durable Objects) — deferred to the architecture phase by design; the PRD requires only "updates without manual refresh" (FR-21).
2. Demo Poll content and reset cadence — what question makes the best standing demo, and how often to reset it (FR-26).

## 10. Assumptions Index

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
- §5 — Baseline rate limits are generous enough that no human Voter or Creator encounters them.
- §5 — Performance: no numeric budget; lightweight voter surface.
- §5 — Accessibility: pragmatic (keyboard, contrast, alt text), not formal WCAG certification.

*Confirmed 2026-07-28 and promoted to plain requirements: no draft state (§4.1); options/type lock after first Vote (FR-5); IP Checks and Session Checks as independent Toggles (FR-16); Comment visibility/moderation rules (FR-24); Voter-privacy NFR (§5).*
