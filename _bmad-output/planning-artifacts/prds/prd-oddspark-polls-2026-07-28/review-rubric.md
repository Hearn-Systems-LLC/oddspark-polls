# PRD Quality Review — oddspark-polls

## Overall verdict

This is a strong PRD for its stakes: it has a real thesis (replace StrawPoll's paywalled trust features on a stack where they're free), the features trace back to that thesis rather than to a wishlist, and the scope discipline is genuinely above the bar — Non-Goals do work, the Assumptions Index round-trips, and §10's "confirmed and promoted" footer is a practice most PRDs skip. It is buildable today for Phases 1 and 2.

The soft spot is Meeting Polls (§4.5, Phase 3), which received a fraction of the rigor applied to Ranked-Choice: two of its three FRs have no testable consequences and its core tabulation rule — how `if-need-be` weighs against `yes` — is simply absent. A second cluster of gaps sits around vote mutability and the Demo Poll's security configuration, both places where an unstated decision will surface as a bug rather than as a question.

## Decision-readiness — adequate

The PRD makes decisions and says so. §4.1 states "There is no separate draft state" and gives the reason. FR-5 locks options and Poll Type after the first Vote with the trade-off named inline: "editing them would silently invalidate cast Votes and undermine trustworthiness." FR-9 picks simultaneous elimination of all tied-last options and the addendum records what it was chosen *over* ("backward tie-breaking or random draw for explainability"). FR-19 concedes ground honestly — "the one feature where parity is approximate." §7.4 defers Voter Codes and VPN Blocking as demand-driven rather than pretending they're scoped. This is not a PRD that smooths everything to neutral.

What holds it back from strong is the absence of any surfaced tension. There are zero `[NOTE FOR PM]` callouts, and while a solo PRD where the PM is the builder doesn't need ceremonial ones, there are real tensions here that went unflagged — most concretely the Demo Poll's security configuration (below) and the sequencing mismatch between §7 phasing and SM-1. §9 Open Questions has two entries, and OQ-1 isn't open: it's a recorded deferral with its resolution path already chosen, which inflates the section's apparent openness while leaving the genuinely unresolved product decisions (vote revision, pre-vote result visibility) outside it entirely.

### Findings

- **high** Demo Poll security config conflicts with its own user journey (§4.9, FR-26) — FR-26 specifies the Demo Poll "runs with CAPTCHA, IP Checks, and Session Checks on." IP Checks reject "a second Vote from the same IP address on one Poll" (§3), so exactly one visitor per office, campus, café, or CGNAT pool can ever vote. UJ-5 promises "a live Demo Poll they can actually vote in," and SM-C2 explicitly names false-positive blocks as a thing not to optimize into. The reset lever exists (`[ASSUMPTION]` under FR-26) but its cadence is Open Question 2, so the mitigation is undecided. *Fix:* either run the Demo Poll with Session Checks and CAPTCHA only (still demonstrates the stack) and say why IP Checks are off, or add a `[NOTE FOR PM]` naming the demo-fidelity vs. demo-reachability trade-off and the reset cadence that resolves it.
- **medium** SM-1 is unachievable until phasing completes, and the PRD doesn't say so (§8 vs §7) — SM-1 reads "Justin's next real poll runs on polls.oddspark.dev instead of StrawPoll — as does every poll after it." Phase 1 ships only Multiple-Choice. If the next real poll is a meeting poll or a ranked-choice vote, SM-1 fails for a reason that is not a product defect. *Fix:* scope SM-1 to Phase 1's Poll Types, or restate it as "every poll whose type has shipped."
- **low** Open Question 1 is not an open question (§9) — "Live-results transport … deferred to the architecture phase by design" is a decision to defer with the candidate set already enumerated in the addendum. Listing it alongside the genuinely undecided OQ-2 makes §9 look more open than it is. *Fix:* move it to a "Deferred to architecture" line under §7 or §5 and leave §9 for things nobody has decided.

## Substance over theater — strong

Very little furniture here. §2 skips personas entirely in favour of four JTBD lines, each of which visibly drives requirements — "pay ~nothing" becomes the §5 cost ceiling, "trust the result" becomes the FR-9/FR-10 tabulation spec, "see in under a minute" becomes §4.9. No persona survives in this PRD without doing work.

The Vision (§1) is the opposite of swappable: it names StrawPoll, the $28/mo Pro tier, and the two specific features that tier gates, then states the economic argument in one sentence. Drop it into another PRD and it breaks immediately, which is the test. The NFRs mostly carry product-specific bite rather than boilerplate — the cost NFR isn't "cost-efficient," it's "$0–5/mo" with an enforcement rule attached ("A feature that would breach this ceiling is out of scope by definition"), and the voter-privacy NFR states three concrete negatives (never displayed, not to the Creator, absent from exports) instead of gesturing at "privacy-respecting."

Two NFRs do fall back on adjectives — Performance ("feels instant") and Craft bar ("portfolio-quality") — but both are explicitly `[ASSUMPTION]`-tagged as deliberately unbounded, which is honest rather than theatrical. The accessibility bound is the one that should still be tightened (see Done-ness).

### Findings

- **low** "This stack is the product's moat" (§4.6) — a moat defends market position against competitors. This product has one user, no market, and §2.2 rules out other creators. The security stack is the *point* of the product, not a moat around it. It's the only line in the PRD that reaches for language it hasn't earned. *Fix:* "This stack is what makes a Poll's result believable" — same emphasis, accurate claim.

## Strategic coherence — strong

The thesis is stated twice and both statements are load-bearing. §1 names trustworthiness as "the core value" and immediately cashes it into three concrete commitments (duplicates blocked, invite-only admits exactly the invited, ranked-choice reproducible). §4.3's description then explicitly derives its own rigor from that thesis: "Because trustworthiness is the core value, the tabulation rules are specified exactly and results expose every Round." That is a PRD reasoning from its premise rather than decorating with one.

Prioritization follows the thesis rather than convenience. Phase 1 bundles the security infrastructure (FR-15, FR-16, FR-18) with the basic poll rather than deferring it as hardening — correct, since deferring it would ship the product without its reason for existing. §7.1's claim that "Phase 1 alone replaces StrawPoll for most of Justin's real polls and stands as a complete demo" is a real MVP-coherence test, and Phase 1's contents pass it. Meeting Polls going last is justified on code-sharing grounds, which is an ease argument, but it's labeled as one rather than dressed up.

Success Metrics are outcomes, not activity — no DAU/MAU tell anywhere — and the two counter-metrics are well chosen, with SM-C1 protecting exactly the thing a security-focused product is most likely to erode (frictionless friends polls).

### Findings

- **medium** Two Poll Types have no Success Metric (§8) — mapping SM validation targets covers FR-1–7, 9, 10, 16–18, 20–23, 25–27 and the §5 cost NFR. Unvalidated: FR-11 (Image Polls) and FR-12–14 (Meeting Polls) — an entire build phase each. Meeting Polls serve UJ-3, one of five journeys. *Fix:* add an SM for the scheduling job ("a meeting gets scheduled from a Meeting Poll without a follow-up thread") — it's the JTBD in §2.1 and currently nothing measures it.
- **medium** The trustworthiness thesis is applied unevenly across Poll Types (§4.2 vs §4.3) — Ranked-Choice gets a verifiability surface: FR-10's consequence is "A reader can recompute the winner by hand from the displayed Rounds." Multiple-Choice, the type §4.2 calls "the workhorse," gets no equivalent — its trust rests entirely on server-side tallying that no one can check. A Voter has no way to confirm their Vote landed in the Tally. *Fix:* either add a light verifiability consequence to FR-6/FR-7 (vote receipt, or Tally total reconciling against a displayed Voter count) or state in §4.2 that Multiple-Choice trust is enforcement-based, not verification-based, so the asymmetry is a decision rather than an oversight.

## Done-ness clarity — adequate

Most FRs carry a **Consequences (testable)** block and most of those consequences are genuinely testable. The best of them are excellent: FR-17's "Exactly N Votes are possible from N codes" is a complete acceptance criterion in seven words; FR-16's third consequence ("With Session Checks on and IP Checks off, multiple Voters behind one shared IP … can each Vote") specifies an interaction, not just a behavior; FR-9's five bullets are implementable and property-testable as written, including the degenerate case where simultaneous elimination would empty the field. FR-18's insistence on "rejected server-side (not merely hidden client-side)" closes a hole an implementer would otherwise leave open.

The failures cluster, and they cluster in §4.5. FR-12 and FR-14 have no Consequences block at all — the only two FRs in the document without one — and FR-14 is where the missing rule bites: "highlighting the slot(s) with the most availability" is undefined when responses are three-state. Is one `if-need-be` worth half a `yes`? Does a slot with 4 yes / 0 if-need-be beat 3 yes / 3 if-need-be? The PRD that specified IRV to the level of exhausted-ballot handling left its other tabulation rule entirely to the implementer. FR-25's consequence — "The page makes sense to a non-technical visitor and rewards a technical one" — is the rubric's canonical unfalsifiable statement, made worse by sitting under a heading that asserts testability.

### Findings

- **high** Meeting Poll tabulation is unspecified (FR-14, §4.5) — "highlighting the slot(s) with the most availability" gives no weighting for the three-state responses FR-13 introduces, no tie rule, and no consequences block. Contrast FR-9, which specifies IRV down to exhausted-ballot behavior and determinism. An engineer building Phase 3 must invent the scoring rule and will guess. *Fix:* state the rule — e.g. "slots rank by yes count; ties broken by if-need-be count; the grid shows both totals per slot and does not collapse them into one score" — and add consequences to FR-12 (slot count bounds, slot editability after first response) and FR-14.
- **high** Vote revision and retraction are never addressed (§4.2–§4.6) — no FR says whether a Voter can change or withdraw a Vote. FR-16 implies "no" *when duplicate checks are on*, but FR-15's own consequence for all-toggles-off is "a Vote submits with no challenge, no code, and no duplicate check." In that configuration — the one UJ-3 prescribes for friends polls — a Voter who mis-marks a slot can only re-submit, and since FR-13's assumption identifies Meeting Poll Voters by a self-entered display name, the grid gains a second row for the same person with no stated merge rule. *Fix:* add an FR (or a consequence on FR-15) stating the rule: whether re-submission replaces or duplicates, and how identity is resolved on Meeting Polls where duplicate checks are off.
- **medium** FR-25's consequence is not testable (§4.9) — "The page makes sense to a non-technical visitor and rewards a technical one" cannot pass or fail. *Fix:* replace with content requirements that can — the page states what the platform is, links the repository, names the stack, and embeds a votable Demo Poll above the fold.
- **medium** FR-21 has no staleness bound (§4.7) — "update without manual refresh" is satisfied by a 5-minute polling interval as readily as by a live socket. UJ-1 has Justin "watch the live chart update as votes arrive," which implies something tighter. *Fix:* state a bound the architecture phase must meet — e.g. "a new Vote appears in an open Tally view within 5 seconds" — which constrains the transport choice without making it.
- **medium** The accessibility bar has no floor (§5) — "basic accessibility (keyboard navigation, sensible contrast, alt text)" plus `[ASSUMPTION: pragmatic accessibility, not formal WCAG certification]`. Declining formal certification is right for this project, but "sensible contrast" is an adjective on a surface the PRD elsewhere calls portfolio-quality, and a portfolio reviewer *will* run an audit. *Fix:* keep the no-certification stance and name two checkable floors — the full vote flow is completable by keyboard alone, and text meets 4.5:1 contrast. Both are cheap and both are what a technical visitor checks.
- **low** No retention rule for duplicate-check records (§5, FR-16) — the privacy NFR says IPs and session identifiers "are stored only to enforce duplicate checks" but never says for how long, and nothing states whether deleting a Poll (FR-5) purges them. *Fix:* one clause — duplicate-check records are deleted with the Poll and no later than its close plus a stated window.
- **low** FR-2's cross-reference is imprecise (§4.1) — "Every setting in §4.6 and §4.7 is settable per Poll at creation," but §4.7 contains FR-22 (Export, a creator action) and FR-23 (Unlisted, a global invariant), neither of which is a per-Poll setting. *Fix:* narrow to "every Security Toggle (§4.6) and the Visibility Setting (FR-20)."

## Scope honesty — strong

§6 is a real Non-Goals section, not a disclaimer. Seven entries, each ruling out something a reader might otherwise assume — and one of them ("No PDF export — StrawPoll doesn't have it either; CSV/XLSX suffice") carries its own justification, which is the difference between de-scoping and hand-waving. "Not a survey platform: one question per Poll" pre-empts the single most likely scope creep for a polling product.

§10 is better than the practice most PRDs manage. Ten indexed assumptions, all of which appear inline; every inline `[ASSUMPTION]` in the body appears in the index — the round-trip is complete. The closing footer is the standout: recording five items that were *confirmed and promoted to plain requirements* means a reader can see which parts of the PRD were inferred versus checked, which is precisely the information a downstream implementer needs and almost never gets.

§7.4 is honest deferral — Voter Codes and VPN Blocking are named as built-on-demand rather than quietly omitted from Phase 1 and left to be discovered missing. The open-items density (2 Open Questions, 10 assumptions, 0 `[NOTE FOR PM]`) is proportionate for a solo green-light-to-build PRD; nothing here is being deferred to avoid deciding it. The gaps flagged elsewhere in this review are omissions the author didn't notice, not omissions being papered over — a different and less serious failure.

### Findings

- **medium** Pre-vote result visibility is decided in a parenthetical without acknowledging the trade-off (FR-20) — "Live (visible to anyone with the link, updating in real time)" means a Voter sees the Tally before casting. Showing standings pre-vote measurably biases voting, which cuts against the trustworthiness thesis in §1. This may well be the right call for parity with StrawPoll, but it's currently a side effect of how Live was worded rather than a decision. *Fix:* state it and own it — either add a consequence ("On Live, the Tally is visible before voting; bandwagon effect is accepted as the cost of link-shareable live results") or add a `[NOTE FOR PM]` if it's still live.

## Downstream usability — strong

This dimension matters here — the PRD is explicitly chain-top ("written for the downstream architecture, UX, and implementation phases," §0) — and it holds up under source-extraction.

The Glossary is doing real work: seventeen terms, defined tightly enough to constrain implementation (the definitions of IP Check, Session Check, and Voter Code each specify the rejection semantics, not just the concept), and the capitalized nouns are used consistently across FRs, UJs, and SM definitions. IDs are clean: FR-1 through FR-27 with no gaps or duplicates, UJ-1–5, SM-1–6 plus SM-C1–C2. Cross-references resolve — every `Realizes UJ-n` points at a journey that exists, and every SM's `Validates FR-n` range is real.

§7's phase breakdown partitions all twenty-seven FRs with no orphans and no double-assignment, which means story creation can pull a phase and get a complete, non-overlapping work set. Sections survive being read alone: §4.6 is comprehensible without §4.1 because it references Security Toggles by Glossary term rather than "as described above."

### Findings

- **low** "creator surface" is load-bearing but not a Glossary term (FR-1, FR-22, FR-26, §4.1) — FR-1 defines the entire auth boundary in terms of it ("An unauthenticated request to any creator surface route is denied") and FR-22 scopes Export by it, yet it's the one central noun the Glossary omits while defining fifteen less critical ones. A UX or architecture pass has to infer which routes are in it. *Fix:* add a Glossary entry naming what it comprises — creation, configuration, monitoring, close, export, Demo Poll reset.

## Shape fit — strong

The shape matches the product, which is unusual for a template-driven PRD. This is a hybrid — a single-operator internal tool on the creator side, a genuinely public consumer surface on the voter side — and the PRD formalizes each side to the right depth rather than applying one level of rigor uniformly.

The creator side is treated as a capability spec: FR-1 is a single requirement with two consequences and the auth mechanism pushed to the addendum (Cloudflare Access). Correct — there is one operator, no roles, no permissions model, and elaborating it would be pure overhead. The voter side gets the UJ treatment it needs, because voters are strangers whose experience actually varies: UJ-2 (public stranger), UJ-3 (trusted friend), UJ-4 (code holder), UJ-5 (evaluator) are four materially different flows through the same product, and each one is realized by a different combination of Security Toggles. Those UJs are load-bearing rather than decorative — §4.6's description explicitly justifies the per-poll toggle design by pointing at the three journeys it has to serve simultaneously.

No personas, no stakeholder matrix, no RACI, no risk register. For a solo project that would be over-formalization, and the PRD correctly skips all of it while keeping the substance bar high. The UJ protagonists are named where a name exists (Justin) and typed where one doesn't ("a stranger," "someone from Justin's portfolio") — appropriate, since inventing personas for anonymous voters would be exactly the theater the rubric warns about.

No findings.

## Mechanical notes

- **Glossary number drift.** Glossary defines singular forms (**Security Toggle**, **IP Check**, **Session Check**); the body uses plurals throughout (FR-16 "IP Checks and Session Checks are separate Security Toggles"). Consistent and unambiguous, just not literally matched. FR-17/18/19 also shorten to bare "Toggle" ("With this Toggle on"). Harmless; worth one pass if the Glossary is being machine-consumed downstream.
- **ID continuity: clean.** FR-1–27 contiguous, no gaps or duplicates. UJ-1–5, SM-1–6, SM-C1–C2 all resolve. §7's phase assignments cover all 27 FRs exactly once.
- **Assumptions Index round-trip: complete.** Eleven inline `[ASSUMPTION]` tags map to ten index entries — the §4.4 entry correctly merges the two assumptions in that subsection (select-mode reuse, and formats/size cap). No orphans in either direction. The §4.4 index entry is the only one without an FR label, since one of its two assumptions sits in the section description rather than an FR.
- **UJ protagonists.** All five carry their protagonist inline; UJ-2 and UJ-5 use typed rather than named protagonists, which is correct for anonymous voters.
- **Sections present for the stakes.** Vision, users, glossary, features, NFRs, non-goals, phasing, metrics, open questions, assumptions index. Nothing missing for a solo chain-top PRD; nothing present that's ceremonial.
