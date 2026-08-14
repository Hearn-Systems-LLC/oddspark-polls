---
title: Adversarial Review — oddspark-polls PRD
reviewer: bmad-review-adversarial-general
date: 2026-07-28
targets:
  - prd.md
  - addendum.md
context: Solo/internal product, public skills demo on Cloudflare, low traffic, core value = trustworthiness
---

# Adversarial Review — oddspark-polls PRD

## Verdict

**Not ready to hand to the architecture phase.** Structurally this is an above-average PRD — the FR / testable-consequence discipline, the explicit non-goals, and the tagged assumption index are genuinely good and worth keeping. But the document fails on its own terms in three places, and all three sit directly on the stated core value:

1. The IRV spec — the one algorithm the PRD claims to have "specified exactly" — contains a correctness defect that elects the candidate a majority ranks last, reachable with three options and a handful of voters.
2. The security-toggle model has no floor. With all toggles off (explicitly the intended configuration for friends polls, per SM-C1), there is nothing between a script and the vote endpoint, and the document's central abstraction — "Voter" — has no definition at all.
3. Phase 1 is described as "a complete product" but cannot satisfy two of its own four primary success metrics, and one of the five key user journeys (UJ-4) has no phase.

None of these require enterprise process to fix. They require roughly a half-day of PRD revision before anyone writes a schema. Severity below is calibrated to a solo project whose public face is a portfolio piece: "critical" means it produces untrustworthy results or a false public claim, not that it fails an audit.

Counts: **3 critical · 10 high · 12 medium · 5 low** (30 findings).

---

## Critical

### C-1. The IRV batch-elimination rule can elect the candidate a majority ranks last

FR-9 states: *"all options tied for the fewest votes are eliminated simultaneously — unless that would eliminate every remaining option."* The addendum (§ "IRV implementation notes") defends this as chosen "over backward tie-breaking or random draw for explainability."

It is not merely less precise than standard IRV. It produces different — and defensibly wrong — winners. Counterexample with 100 ballots and three options:

| Ballots | Ranking |
|---|---|
| 40 | A > B > C |
| 30 | B > C > A |
| 30 | C > B > A |

Round 1: A=40, B=30, C=30. No option exceeds 50%. B and C are tied for fewest, so **both** are eliminated. Only A remains, so the guard does not fire. **A wins.**

Standard IRV eliminates one of B or C; either way the survivor collects 60 votes and beats A. A is the Condorcet loser here — 60% of voters rank A last — and the PRD's rule elects them.

The general failure: whenever the trailing candidates tie, this rule collapses IRV into plurality. Ties at the bottom are not exotic at poll sizes of 10–30 voters (UJ-4 describes 25 voter codes); they are common. This directly negates the PRD's own justification for specifying IRV at all.

**Fix:** adopt *safe* batch elimination — eliminate the tied-last group only when their combined vote total is strictly less than the next-lowest option's total (in which case no elimination order can change the outcome, and the rule keeps its explainability). When the batch is not safe, apply a documented deterministic tie-break: fewest votes in the immediately preceding round, then fewest first-preference votes; if still fully tied, declare the poll a tie among the tied options rather than picking arbitrarily. This preserves the determinism invariant FR-9 rightly demands, and preserves explainability, without inverting the result.

### C-2. "Anyone can verify the winner" has no mechanism behind it

UJ-4 promises *"Results show every elimination round, so anyone can verify the winner."* FR-10's testable consequence is *"A reader can recompute the winner by hand from the displayed Rounds."*

A reader can check the *arithmetic between* displayed rounds. They cannot check that the rounds derive from the ballots actually cast — the transfers are asserted by the same server that computed them. Raw ballots are available only via FR-22 export, which is explicitly creator-surface-only. So the trust model reduces to "trust the creator's server," which is exactly the property the product claims to improve on.

This is the core value claim of the entire document (§1: "a poll on oddspark-polls should produce results the creator and voters can believe"), and no requirement implements it.

**Fix:** either (a) add an FR for a public, anonymized ballot manifest on ranked-choice polls once closed — an ordered list of ballots with no identifiers, from which any reader can independently re-run tabulation; or (b) soften UJ-4 and FR-10 to claim only transparency of the tabulation steps, not verifiability. Option (a) is cheap (it is a JSON/CSV dump of data already stored per the addendum's "store raw Ballots" note), makes a far better demo artifact, and is the single highest-leverage trustworthiness feature in the document. Note the privacy interaction with H-6 before shipping (a) on polls using Voter Codes.

### C-3. No baseline anti-abuse floor, no stated toggle defaults, and "Voter" is undefined when toggles are off

FR-15's own testable consequence: *"All five off: a Vote submits with no challenge, no code, and no duplicate check."* SM-C1 requires that known-group polls have zero challenges. So the intended default configuration for the common case is an endpoint that accepts unlimited submissions from anyone with the link.

Three problems compound:

- **The PRD never states what a newly created Poll defaults to.** This is the single most consequential product decision in §4.6 and it is absent. If the default is all-off, a "trustworthiness-first" product ships an unprotected default. If the default is all-on, SM-C1 is violated on day one.
- **There is no rate limit anywhere in the document**, independent of the toggles. Not per-IP, not per-poll, not global. A poll link, once public, is a free write endpoint against a $0–5/mo budget (see H-9).
- **The glossary defines Vote as "one Voter's submission," Comment as "at most one per Voter per Poll," and IP/Session checks as rejecting "a second Vote."** All of these presuppose a voter identity that only exists when a duplicate-check toggle is on. With all toggles off, "already voted," "one comment per voter," and "duplicate" are undefined terms. The document's central abstraction is contingent on an optional feature.

**Fix:** (1) State the default toggle configuration explicitly, with rationale — a defensible answer is Session Checks on by default (near-zero friction, blocks the accidental double-submit), everything else off. (2) Add an NFR for an unconditional per-IP rate limit on the vote endpoint that exists regardless of toggles, framed as abuse/cost protection rather than vote integrity so it does not conflict with SM-C1. (3) Define in §3 what identity means when no toggle is on — the honest answer is "none; per-voter guarantees are best-effort and only meaningful when Session or IP Checks or Voter Codes are enabled," and that sentence belongs in the glossary and on the creator UI.

---

## High

### H-1. The Creator is entirely outside the threat model, and FR-5 contradicts itself

FR-5 locks options and poll type after the first Vote, with an excellent rationale: *"editing them would silently invalidate cast Votes and undermine trustworthiness."* The same requirement then permits the Creator to **edit the question at any time**, including after votes are cast. Changing "Should we meet Tuesday?" to "Should we fire Bob?" invalidates every cast vote exactly as thoroughly as changing the options. The rule and its own stated rationale disagree.

Wider gap: §5 states *"a Voter cannot influence a Tally except by their own valid Vote"* — and says nothing about the Creator. The Creator can delete polls, delete comments, and (unspecified) possibly delete individual votes. For UJ-4, a community ranked-choice decision, the party whose neutrality voters actually need to trust is the Creator, not the voters. The document's threat model omits its most obvious adversary.

**Fix:** lock the question text alongside options and type after the first Vote (or allow edits but display an "edited after voting began" marker with a timestamp on the results page). Add an explicit statement of what the Creator can and cannot do to a Tally, and — if individual vote deletion is intended to exist — say so and require it be visible in the results view.

### H-2. Security Toggle mutability mid-poll is completely unspecified

Can Justin turn IP Checks on after 50 votes have been cast? Turn Voter Codes on mid-poll? Turn CAPTCHA off? What happens to already-cast votes that would not have passed the newly enabled check — are they retained, purged, flagged? Nothing in FR-15 through FR-19 addresses this, and FR-5's lock rule covers only options and type.

This is a live trustworthiness hole with the same shape as H-1: a creator can retroactively change the rules a poll ran under, and the results page will not say so.

**Fix:** state the rule. The simple, defensible answer is that Security Toggles lock at the first Vote, exactly like options and type, and the results view displays which toggles were in force. If mid-poll tightening must be possible, require it be recorded and displayed.

### H-3. The IP Check definition is naive about IPv6 and CGNAT, and the Demo Poll will falsely block real visitors

§3 defines IP Check as *"rejection of a second Vote from the same IP address."* Two failure modes, both certain rather than hypothetical:

- **IPv6:** a residential connection gets a /64 and hosts rotate addresses within it (privacy extensions rotate them by the hour). Per-address checking is close to useless on IPv6 — the same person gets a fresh address for free. The standard mitigation is to key on the /64 prefix for IPv6 and the full address for IPv4.
- **CGNAT / corporate NAT:** mobile carriers put thousands of subscribers behind one IPv4 address. FR-16 already anticipates the household case and offers Session-Checks-only as the workaround — but FR-26 then mandates **IP Checks on for the Demo Poll**, the one poll whose visitors are strangers arriving from a portfolio link, disproportionately on mobile. The second visitor from a given carrier NAT is told "you have already voted." That is the portfolio surface failing in the most visible way possible, and it directly undercuts SM-6.

**Fix:** specify IPv6 /64 keying in the glossary. For FR-26, drop IP Checks from the Demo Poll and keep CAPTCHA plus Session Checks — Turnstile is the demonstration that matters and does not false-positive on shared NAT. If demonstrating IP Checks is the point, demonstrate it in copy on the landing page rather than by enforcing it on strangers.

### H-4. Nothing requires the duplicate and code checks to be atomic under concurrency

FR-17's consequence — *"Exactly N Votes are possible from N codes"* — and FR-16's duplicate rejections are all naturally implemented as check-then-insert. Two submissions arriving concurrently with the same code, session, or IP can both pass the check before either writes. This is the single most likely way vote integrity actually breaks in production, and it is trivially triggerable by anyone who wants to (double-click, or two tabs).

The PRD is right not to specify implementation, but the testable consequence should carry the constraint so the architecture phase cannot quietly drop it.

**Fix:** amend the consequences to read "…under concurrent submission," and add a line to §5 requiring that all uniqueness guarantees be enforced by a database constraint rather than an application-level read-then-write.

### H-5. Custom Links collide with reserved routes and undermine "Unlisted"

FR-3 lets the Creator claim any slug at the domain root (`polls.oddspark.dev/{custom-link}`). Three unaddressed consequences:

- **Namespace collision.** The creator surface, the API, the auth callback, and static assets all live in that same root namespace. Nothing prevents claiming `/admin`, `/api`, `/login`, or `/new`. With Cloudflare Access enforcing creator auth by path pattern (per the addendum), a slug that shadows or is shadowed by a protected path is a routing bug in the auth layer, not just a 404.
- **Guessable slugs defeat unlisting.** FR-23 defines Unlisted as "reachable only by link," and the security rests entirely on link secrecy — but FR-3 exists specifically to make links *human-readable and memorable*. `/team-lunch` is guessable. The PRD treats unlisted-ness as a privacy control (§6 non-goals cite no permissions system) while simultaneously making the identifiers predictable.
- **Slug reuse after deletion.** FR-5 deletes a Poll and its link stops resolving. Nothing says the slug is retired. If it is reusable, an old shared link silently starts pointing at a different poll — people vote in the wrong poll.

**Fix:** reserve a route namespace (put all creator/API routes under a single reserved prefix such as `/~/`, or maintain an explicit reserved-slug denylist enforced at FR-3), state plainly in §3 that Unlisted means obscurity and not access control, and specify whether deleted slugs are retired (recommend: retired permanently, served as "this poll was deleted").

### H-6. Voter Codes and Meeting-Poll display names break ballot secrecy; the privacy NFR covers neither

§5's voter-privacy NFR covers IP addresses and session identifiers only. It does not cover:

- **Voter Codes.** A code is distributed to a specific named person. If the vote row records which code was used, the Creator can map every ballot to a person. UJ-4 — an invite-only ranked-choice community decision — is precisely the scenario where voters expect a secret ballot, and the PRD silently provides the opposite.
- **Meeting Poll display names.** FR-13 requires a display name and FR-14 renders a grid of Voters × slots. This is correct for Doodle-style scheduling, but it flatly contradicts §3 ("Voter — Anonymous; no account") and §5 ("never displayed to anyone").
- **Export timestamps.** FR-22 puts a per-vote timestamp in the export. In a 25-person poll, timestamps plus knowledge of when you sent each invite is a de-anonymization channel on its own.

Separately, "never displayed to anyone (including the Creator)" is a UI-level promise, not a data guarantee: §5 also states all data lives in Justin's own Cloudflare account, where he has direct D1 access. The stated control is unenforceable against the person it names.

**Fix:** store a per-poll salted hash of the IP and session identifier rather than the raw values, so the privacy claim is structural rather than a UI convention and cross-poll correlation is impossible by construction. Record only that a code was *consumed*, not which code produced which ballot (or state explicitly that ranked-choice polls with Voter Codes are not secret ballots, and surface that to voters). Reconcile §3/§5 with §4.5 — Meeting Polls are non-anonymous by design and the glossary must say so.

### H-7. Phase 1 cannot satisfy two of the four primary success metrics, and UJ-4 has no phase

§7.1 asserts Phase 1 "stands as a complete demo" and "replaces StrawPoll for most of Justin's real polls." But:

- **SM-3** (invite-only poll admits exactly the invited) validates FR-17 Voter Codes, which §7.4 defers indefinitely to "when a real Poll actually requires them."
- **SM-4** (ranked-choice tabulates correctly) validates FR-9/FR-10, which are Phase 2.

So half the primary success metrics are unevaluable at the end of the phase the PRD calls complete. Worse, **UJ-4 — one of five key user journeys, and the one that carries the trustworthiness story — depends on both a Phase 2 feature and an unscheduled §7.4 feature.** A key journey with no delivery phase is not a plan.

**Fix:** either promote Voter Codes into Phase 2 alongside ranked choice (they are the same journey and a code table is a day of work), or demote SM-3 to secondary and mark UJ-4 as a Phase 2+ journey. Also add per-phase exit criteria; right now no phase has a definition of done.

### H-8. The economic premise does not survive scrutiny, and the PRD launders an upstream "unverified" flag

§1 makes the build's justification explicit: *"The features StrawPoll gates behind its $28/mo Pro tier … are free on the Cloudflare platform this project runs on, which is the economic argument for building it."* The addendum repeats "$28/mo ($336/yr)" as a "key figure."

Two problems.

**The figure carries an uncertainty flag that was dropped in the handoff.** The brief addendum annotates its pricing table with *"Treat these figures as a single unverified source, not confirmed pricing,"* and separately marks the ad-quota row unverified. Neither the PRD nor its addendum carries that qualifier forward. An explicitly-unverified number has been promoted into a confident economic premise across one document boundary.

**The comparison is against the wrong baseline.** The real alternative to building this is not "buy StrawPoll Pro at $336/yr" — it is "keep using StrawPoll Free and live without CAPTCHA and custom links," which costs $0, or Basic at $8/mo. Meanwhile the brief's own risk section concedes the build is "weeks of work, not a weekend." At any plausible valuation of Justin's time, the build exceeds $336/yr by an order of magnitude. The economic argument is not merely weak; it is inverted.

This is not an argument against the project. It is an argument that the *stated* justification is the wrong one, and that matters because it drives prioritization. §1 already contains the real justification — the public skills demo, the craft bar, owning the data. If the honest rationale is portfolio value plus the pleasure of building it, then polish on the public surfaces and the trustworthiness story (C-2) outrank achieving four-poll-type parity with StrawPoll, and the phasing should reflect that.

**Fix:** restate §1 with the demo/craft/ownership rationale leading and cost as a supporting note. Carry the "unverified pricing" qualifier forward, or verify it. Reconsider whether full four-type parity is a goal at all, versus doing two types exceptionally well.

### H-9. The cost ceiling is circular and unenforceable, and its main driver ships in Phase 1

§5 states: *"total running cost stays within $0–5/mo … A feature that would breach this ceiling is out of scope by definition."* That final clause converts a constraint into a tautology — it guarantees compliance by redefining any violation as out of scope, and provides zero guidance for the one decision it should govern (Open Question 1: Durable Objects vs. polling).

Meanwhile FR-21 (live-updating charts, no manual refresh) is in Phase 1 and is the primary cost driver. Naive client polling at a few seconds per open viewer generates D1 reads proportional to viewers × duration; the free-tier D1 read allowance is finite, and a single moment of attention on the Demo Poll from an aggregator can consume it. Combined with C-3 (no rate limiting anywhere), the budget has no enforcement mechanism at all: no cap, no billing alert, no degradation path.

**Fix:** delete the tautological clause and replace it with something falsifiable — a named billing alert threshold, and a stated degradation behavior when limits are approached (e.g. live updates fall back to a longer interval or a manual refresh button). Add a requirement that tally reads for a given poll be served from cache rather than hitting D1 per viewer.

### H-10. The Demo Poll is an unmoderated public text surface on the portfolio page, and no requirement covers sanitization

FR-24 lets any Voter attach a free-text Comment with a display name, visible wherever the Tally is visible. FR-26 makes the Demo Poll publicly votable and pins it to the landing page. Nothing states whether Comments default on or off, there is no length cap ("short" is never quantified), no rate limit, and the only moderation is the Creator deleting things after the fact — with a single, part-time moderator.

The predictable outcome is spam or worse rendered on the first page a prospective employer or client sees.

Separately and more seriously: **no requirement anywhere states that voter-supplied text must be escaped or sanitized.** The PRD has a detailed threat model for ballot stuffing and none at all for injection. Stored XSS on a voting page would let an attacker rewrite what voters see — including the tally — which is a direct attack on the product's core value, not merely a generic web bug.

**Fix:** add an explicit NFR that all voter-supplied content (comments, display names, and slugs) is escaped on output and length-bounded on input. Specify a character cap for Comments. Default Comments off on the Demo Poll, or moderate them pre-publication.

---

## Medium

### M-1. Several "Consequences (testable)" are not testable

The document's core convention is that every FR carries falsifiable consequences. Some do not:

- FR-10: *"A reader can recompute the winner by hand from the displayed Rounds."* Which reader, with what effort, and how is failure observed? (See also C-2 — the deeper problem is that this is not the property that matters.)
- FR-25: *"The page makes sense to a non-technical visitor and rewards a technical one."* Pure aspiration.
- FR-27: *"README explains the product, the stack, and how to run it"* is testable; "architecture notes sufficient for a technical reader to evaluate the work" is not.
- §5 Performance: *"feels instant"* with the assumption explicitly disclaiming any numeric budget.
- §5 Craft bar: "portfolio-quality" and "basic accessibility."

For a solo project, some of these are acceptable as stated intent — but then label them as goals, not as testable consequences, or the convention becomes decorative. Performance and accessibility are both cheaply falsifiable if you want them to be (a Lighthouse threshold, keyboard-only traversal of the vote flow, contrast ratios).

### M-2. No requirement lets the Creator find their own polls, and FR-23 arguably forbids it

FR-1 gates the creator surface, FR-2 creates polls, FR-5 edits and deletes them — but nothing requires a list of the Creator's polls. Read literally, FR-23 ("No page, feed, sitemap entry, or index lists Polls") forbids even a creator-side dashboard. Justin will be reduced to bookmarking his own URLs. Add an FR for a creator dashboard and scope FR-23 to public surfaces.

### M-3. Whether a Voter can change or retract a vote is never stated, for any poll type

This is a real product decision left to implementation coin-flip. It matters most for Meeting Polls, where Doodle's model — which FR-13 explicitly cites as the reference — allows editing your availability, and where an unchangeable answer makes the tool noticeably worse. It also interacts with FR-16: "already voted" rejection and "let me fix my answer" are the same request from the user's side, and the current spec answers it with an error message.

### M-4. Whether results are visible before voting is never decided

FR-20 defines Live as "visible to anyone with the link, updating in real time," which means a voter sees the tally before casting. That is a bandwagon effect on a product whose core value is trustworthy results, and it is a decision the PRD makes implicitly rather than deliberately. StrawPoll's own default is to reveal after voting. Decide it explicitly; consider a fourth visibility option or a "reveal after voting" sub-setting on Live.

### M-5. Deadline timezone and auto-close mechanics are unspecified

FR-4 says the Poll auto-closes at its Deadline. Unstated: whether the Deadline is set and displayed in the Creator's timezone or the Voter's (FR-13 carefully solves this for Meeting Poll slots and FR-4 ignores it entirely — a voter in another timezone cannot tell when voting ends); and what "auto-closes" means on a platform where nothing runs without a request. Lazy evaluation on read satisfies the testable consequence ("a Vote after close is rejected") but leaves a poll displaying as open until someone visits it. Either is fine — pick one and say so.

### M-6. "After Close" visibility has no delivery path

FR-20's After Close mode hides the tally until close, and §6 rules out notifications and email entirely. So voters who were promised results have no way to learn they exist except by re-checking the link on speculation. This is not broken, but it is a mode that will disappoint everyone who uses it. Worth either an acknowledgment or a minimal mitigation (the post-vote confirmation states the close time so voters know when to return).

### M-7. Definitional contradiction: "All Polls are Unlisted"

§3's Poll entry says *"All Polls are Unlisted except the Demo Poll."* §4.7's description says flatly *"All Polls are Unlisted."* FR-23 says *"No page, feed, sitemap entry, or index lists Polls"* — and then its own testable consequence says the landing page links the Demo Poll. Three statements, two of which the Demo Poll violates. Define Unlisted once, carve out the Demo Poll once, and stop restating it.

### M-8. FR-17's "exactly N votes from N codes" contradicts FR-15's compose rule

FR-15 establishes that toggles compose and all enabled checks are enforced. FR-17 asserts that N codes yield exactly N possible votes. If Voter Codes and IP Checks are both on — a plausible configuration for a high-stakes invite-only poll — two code-holders behind one office NAT cannot both vote, and fewer than N votes are possible. The two consequences cannot both hold. Amend FR-17 to "at most N," and add a creator-facing warning when Voter Codes and IP Checks are enabled together, since that combination is almost always a mistake (codes already provide a stronger identity guarantee than IP).

### M-9. VPN Blocking is largely redundant with CAPTCHA and should probably be cut, not deferred

FR-19 is the weakest requirement in the document by the PRD's own account: best-effort, approximate parity, the sole feature with a dedicated counter-metric warning about false positives (SM-C2), and deferred to §7.4. Turnstile already scores datacenter and automated traffic as part of its challenge — the marginal detection FR-19 adds over FR-18 is never stated. Meanwhile it carries the highest false-positive cost of any toggle: turning away a legitimate voter on a VPN, which is an increasingly ordinary way to browse.

Recommend deleting FR-19 outright rather than deferring it, and recording in §6 why (subsumed by Turnstile, unfavourable false-positive tradeoff). Deferred requirements have a habit of getting built because they are on the list.

### M-10. The exhausted-ballot path produces an N-way tie among zero-support options, unremarked

Trace FR-9 when every remaining ballot exhausts: the active count reaches zero, no option holds more than 50% of zero, every remaining option is tied at zero votes, so eliminating "all tied for fewest" would eliminate all remaining options — the guard fires and the poll declares a tie among options that have no support whatsoever. The rules do terminate (each round either halts or strictly shrinks the option set, which is a real strength), but this outcome is surely not intended and is never mentioned. Also, "active Ballots" is used in the majority test without being defined at round boundaries — is the denominator measured before or after that round's exhaustions? The two give different winners.

### M-11. Image Polls: no EXIF stripping, no aggregate storage bound, no per-poll option cap

FR-11 caps individual images at ~5 MB and lists formats. Unaddressed: uploaded photos carry EXIF including GPS coordinates and device identifiers, and these images are served publicly from a portfolio domain — a real personal-data leak with a one-line fix at upload. There is also no cap on options per poll or total R2 usage, which is the other unbounded cost driver against the §5 ceiling (H-9). Add EXIF stripping on upload, an option count cap, and a total storage bound.

### M-12. Two Open Questions is over-confident, and "no draft state" is an untagged assumption

The document lists only two open questions, both of which it immediately answers ("deferred by design"). This review found roughly a dozen genuinely undecided product questions — toggle defaults, mid-poll mutability, vote changeability, pre-vote result visibility, deadline timezone, slug reuse. A PRD whose Open Questions section is shorter than its Assumptions Index is not being honest with its downstream readers.

Relatedly, §4.1 justifies having no draft state as *"matching StrawPoll's flow"* — presented as fact, but neither addendum documents StrawPoll's draft behavior. That is an untagged assumption in a document that is otherwise scrupulous about tagging them. (The decision is fine on simplicity grounds alone; just drop the unsupported appeal to parity.)

---

## Low

### L-1. The glossary binds CAPTCHA to a specific vendor product

§3 defines CAPTCHA as *"the Cloudflare Turnstile challenge,"* while the addendum frames the stack as an architecture-phase concern. Minor layering violation — define the requirement behaviorally in §3 and let the addendum name Turnstile.

### L-2. The public repository publishes the security implementation, which weakens "moat" framing

§4.6 calls the security stack "the product's moat," while FR-27 open-sources the exact implementation — cookie names, session derivation, check ordering. This is the right call for a portfolio project and is not a real risk at this scale, but "moat" is the wrong word for a mechanism you are publishing. It is a feature set, not a moat.

### L-3. No durability or backup requirement despite data ownership being a headline benefit

§5 promotes "all Poll and Vote data lives in Justin's own Cloudflare account" as a differentiator against third-party custody. Custody without backup is a downgrade, not an upgrade: an accidental D1 drop loses every historical poll with no recourse. One line requiring periodic export or D1 Time Travel retention would close it.

### L-4. A declared tie has no defined presentation

FR-9 can declare a tie; FR-10 (per-round display) and FR-14 (availability grid highlighting "the slot(s) with the most availability") never say how a tie renders or what the results page states as the outcome. Small, but it is the one output path most likely to be hit during testing and least likely to have been designed.

### L-5. Two success metrics measure the wrong thing

SM-1 ends with *"as does every poll after it"* — an unbounded forever-condition that can never be marked achieved, only retroactively failed. SM-6 ("at least one person mentions it") measures distribution and audience, neither of which is in scope anywhere in the document; a superb demo that Justin never shares fails it, and a mediocre one posted to the right forum passes. Bound SM-1 to a checkable window (e.g. the next three real polls) and replace SM-6 with something the product controls.

---

## What is genuinely good (do not lose it in revision)

Stated so the revision does not overcorrect:

- The FR → "Consequences (testable)" structure is the right skeleton and most of the consequences are real.
- §6 Non-Goals is unusually disciplined and will save real time.
- The inline `[ASSUMPTION]` tags plus §10 index, including the footnote recording which assumptions were promoted to requirements, is better provenance hygiene than most professional PRDs manage.
- FR-16's third consequence (Session Checks on, IP Checks off, shared household IP) is exactly the kind of concrete composed-behavior test that catches real bugs.
- FR-10 requiring exhausted-ballot counts in the per-round display is correct and frequently missed — it is what stops a "majority" of a tiny remnant from looking like a mandate.
- The addendum's instruction to store raw Ballots rather than aggregated Rounds is right, and is the precondition for fixing C-2 cheaply.
