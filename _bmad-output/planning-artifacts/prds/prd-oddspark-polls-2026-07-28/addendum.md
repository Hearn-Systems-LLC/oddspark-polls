# PRD Addendum — oddspark-polls

Technical and downstream material that supports the PRD but belongs in the architecture/UX phases, not in the requirements themselves.

## Platform stack

Cloudflare end-to-end, user-confirmed during the brief run: Workers (app), D1 (poll/vote storage), R2 (Image Poll uploads), Turnstile (CAPTCHA), Better Auth (creator auth, Google + GitHub OAuth, sessions in D1). Target cost is $0–5/mo — free tiers, or the $5 Workers Paid plan. Creator auth was originally Cloudflare Access (sole-creator scope); when the product opened to public self-service creators on 2026-07-29, Better Auth with social OAuth replaced it — Access gates a known set of users, not public sign-up. The administrative moderation capability is an application-level role on the internal user, not a separate auth surface.

## Live-results transport (deferred, PRD Open Question 1)

Candidates: client polling on an interval, or WebSockets backed by Durable Objects. Durable Objects require the Workers Paid plan (within the cost ceiling), and per-poll DO instances map naturally to live-tally fan-out; simple polling is free and adequate at expected traffic. The PRD requires only "updates without manual refresh."

## VPN Blocking mechanism candidates (FR-19)

Datacenter ASN lists, IP-reputation feeds, and the `request.cf` metadata available on Workers. Accepted as best-effort: the quality bar is "blocks obvious datacenter/VPN egress," not StrawPoll-grade coverage.

## IP Check granularity (FR-16)

Match IPv4 on the full address and IPv6 on the /64 prefix — clients rotate within their /64 under privacy extensions, so exact-address matching would make the check trivially bypassable. CGNAT means IP Checks will always over-block on shared IPv4 egress; that is why they are a per-poll toggle, off by default.

## IRV implementation notes (FR-9)

The PRD's tabulation spec is deliberately complete enough to implement and property-test: determinism (the same Ballots produce the same Rounds) is a testable invariant.

Adversarial review caught that naively eliminating all tied-last candidates collapses to plurality — counterexample: A=40, B=30, C=30. The spec now uses safe batch elimination (batch only when the tied group's combined total is below the next-lowest candidate), backward tie-breaking on earlier-round counts, and an honest "unresolved" halt when options are identical in every Round. No randomness anywhere.

Store raw Ballots and compute Rounds on demand or on close; never store only aggregated Rounds, since both exports (FR-22) and the Ballot Manifest (FR-10) need the raw Ballots. The Manifest publishes anonymized rankings only — no timestamps, and no ordering that could correlate to voters in small groups (consider shuffling Ballots or sorting them canonically before publication).

## Phasing rationale (PRD §7)

Meeting Polls come last because the availability grid and timezone handling share little code with the other three poll types. Voter Codes and VPN Blocking are demand-driven — built when a real Poll first needs them — to keep Phase 1 shippable. Phase 1 is deliberately a complete, demo-able product.

## Competitive grounding

Full StrawPoll research — tier/pricing matrix, feature inventory, rejected OSS alternatives, sources — lives in the brief addendum: `_bmad-output/planning-artifacts/briefs/brief-oddspark-polls-2026-07-28/addendum.md`. The figure this PRD uses: StrawPoll Pro at $28/mo ($336/yr) gates CAPTCHA and custom links, both free on this stack. Pricing is point-in-time research (2026-07-28), with some values flagged unverified in the brief addendum, so the PRD's argument leans on the *gating pattern* — trust features are Pro-only — not on exact dollar figures.

No open-source project combines **casual poll-card UX** with vote-fraud prevention, meeting polls, and ranked choice: Rallly is schedule-only, LimeSurvey is survey-heavy with no poll-card UX, OpenVoter is election-methodology-focused, and SurveyJS is a building block. That gap is the category differentiator, and the §5 "casual poll-card feel" NFR exists to keep it from eroding during implementation.
