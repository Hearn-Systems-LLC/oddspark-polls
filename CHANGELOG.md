# Changelog

All notable changes to oddspark-polls are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Add user-facing changes under `## [Unreleased]` as you go. The release process promotes that
block to a versioned, dated section — never edit a released section retroactively.

## [Unreleased]

Nothing has been released yet. Everything below has landed on `main` and ships to staging and
production on every merge, but no version has been cut or tagged.

### Added

- Creator-controlled Poll discovery: new Polls default to Unlisted, Creators can
  opt into Listed during creation or switch between Listed and Unlisted from
  Poll detail, and creator detail/dashboard surfaces show a word-first listing
  badge. Public voting pages do not disclose listing state.
- Trust badge on the voting page and both Tally surfaces: a label-caps line
  above `VOTE` (and below the bars on results) names each protection actually
  enforcing the count in the Voter's terms — `ONE VOTE PER BROWSER`,
  `ONE VOTE PER NETWORK`, `HUMAN CHECK ON SUBMIT` — with an entropy glyph and
  a hairline, never a "verified"/"secure" claim or shield iconography. Polls
  with every Security Toggle off render no badge at all, and items stack one
  per line on narrow screens without truncation. Voter Codes and VPN Blocking
  stay out of the badge until their enforcement lands (Epic 8).
- Per-Poll CAPTCHA on the vote action via Cloudflare Turnstile: when a Creator
  enables CAPTCHA, the voting form loads an interaction-only challenge above
  `VOTE`, the server verifies the token with Siteverify before any Vote is
  stored, and a failed check returns a safe retry message with the ballot
  preserved. CAPTCHA-off Polls load no widget and remain fully functional
  without JavaScript.
- IP Checks enforcement on the vote path: when a Creator turns on one-vote-per-network,
  a second Vote from the same IPv4 address or IPv6 `/64` is rejected inside the existing
  vote transaction with the connection-specific message, while Session Checks still
  identify a returning browser. Raw addresses never leave the edge boundary — only
  purpose-separated digests reach D1 and the abuse floor.
- Per-poll Security Toggles on create and the Poll detail page: Session Checks, IP Checks,
  Voter Codes, CAPTCHA, and VPN Blocking. A new Poll opens with Session Checks on and the
  rest off. After the first Vote, protections can only tighten — on Toggles lock on, and
  the server rejects any attempt to loosen them.
- Share action beside the canonical Poll URL on the create-confirmation, voting, and
  results surfaces: native share sheet when available, clipboard copy with a persistent
  `LINK COPIED` confirmation otherwise, and a no-JavaScript floor of the selectable URL.
- Creator lifecycle controls on the poll detail page: edit the definition while no Votes
  exist, edit the description anytime, close a Poll on demand, and delete a Poll with a
  confirmed overlay. Closed Polls reject later Votes; deleted Polls return a plain 404 and
  free their custom links for reuse.
- Deployable Astro 7 skeleton on Cloudflare Workers with D1, R2, and KV session bindings
  across three environments (local, staging, production).
- Creator sign-in with Google or GitHub via Better Auth, including a creator-surface
  authentication guard that redirects signed-out visitors to `/sign-in` with their return
  address preserved.
- Session-expiry awareness: a returning creator whose session has lapsed is told so, rather
  than being silently treated as a first-time visitor.
- CSRF and same-origin boundary on all state-changing requests, with session-derived token
  verification on authenticated creator and admin mutations.
- Request-scoped telemetry emitting one record per request, with an `x-request-id` header on
  every response so a user can quote it in a report.
- Design-token stylesheet derived from DESIGN.md, with OS-preference light/dark mode and a
  progressive-enhancement toggle that persists the override.
- Six-step deploy gate (tests → build → staging migrate → staging deploy → staging smoke →
  production migrate → production deploy) in GitHub Actions.
- Forward-only D1 migrations with a checksum manifest and a CI guard that rejects edits to
  committed migrations or out-of-order numbering.
- Masked secret-provisioning helper for Better Auth and OAuth credentials that keeps values
  out of command arguments, shell history, and Wrangler logs.
- Multiple-choice poll creation at `/creator/new`: question, two to thirty options, a
  results-visibility setting, and an optional deadline interpreted in the creator's local
  timezone — fully usable without JavaScript.
- Optional Custom Links at poll creation, with normalized root-path URLs, shared
  application-route reservations, collision-safe inline errors, and no second random URL.
- Create-confirmation page showing the poll's canonical link and, when a deadline was set,
  the resolved closing time in UTC.
- Public poll page at the root path (`/{reference}`) rendering the question and options
  server-side; unknown or application-reserved references return a plain 404.
- Case variants of a Custom Link (e.g. `/Team-Lunch`) permanently redirect to the canonical
  lowercase URL; generated random links remain case-sensitive.
- Signed-out multiple-choice voting with exactly-once D1 persistence, accessible
  counted/already-voted/closed/retry states, first-party duplicate checks, and a
  permissive per-source-IP abuse throttle.
- Voting-page resilience with local deadline display and sub-24-hour countdowns,
  a one-request `COUNTING…` submit lock, preserved retry ballots with fresh
  submission IDs, and focused offline feedback that never sends the held ballot.
- Bounded multi-select polls: creators can allow several choices with optional
  minimum and maximum limits; voter pages enforce the limits accessibly and
  preserve the complete ballot when a submission is rejected.
- Poll results at `/{link}/results`: a server-rendered Tally that honors each
  poll's visibility setting — live results for anyone with the link, results
  that open when the poll closes (with only the question and a local
  closing-time note while open), and creator-only results served to the owning
  creator alone. Counts are computed server-side from accepted votes; exact
  ties are called out as `TIED` with no gold leader, empty polls show labelled
  zero-width bars, and every response is `private, no-store`.
- Post-vote surfaces now render the same authorized Tally beside the
  confirmation on large screens and below it on smaller screens, with the
  voter's own choice shown as a text-only `YOUR BALLOT` line instead of
  gold-marked option rows.
- Open Tallies now update automatically while visible, with a pulsing `LIVE`
  indicator, privacy-preserving conditional refreshes, immediate catch-up
  after returning to the page, and an explicit last-known-time notice when
  updates cannot be received. A closing Poll applies its final snapshot and
  switches permanently to `CLOSED`.
- Live Tallies now move: an arriving Vote transitions every bar's width in
  one synchronized settle, the changed bar's leading edge sparks, counts and
  percentages tick up in place without reflow, and a leadership change
  cross-fades the gold between bars while the `◆` moves with it. Rapid
  updates coalesce into a single settle to the latest value, refreshes after
  returning to the page or reconnecting snap straight to current values, and
  under `prefers-reduced-motion` every state change lands instantly with no
  information lost. A voter's own bar sparks once as their `Counted.`
  confirmation renders.
- `BARS · PIE` chart-form toggle above the Tally: exact server-computed Voter
  shares shape every static slice while the `◆`-marked legend carries the
  same rounded percentage and raw count shown by BARS. The pie never
  animates, and the choice resets to bars on every load. Multi-select polls
  stay bars-only, since per-option shares of voters can sum past 100% and
  cannot form an honest pie.
- Creator dashboard at `/creator`: each creator's polls as hairline-separated
  `poll-card` rows (question, type · votes · closing caption, live/CLOSED
  status), newest live polls first, empty-state copy when none exist, and a
  primary create action. Poll detail at `/creator/polls/{id}` splits list left
  / detail right from the large breakpoint while keeping both regions stacked
  below it, with a monitor floor (status + vote total + link to live results).
- `AGENTS.md` — project instructions for Claude Code and other coding agents.
