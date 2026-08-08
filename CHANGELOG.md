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

- Automatic Image Poll media cleanup. Deleting an Image Poll now removes its
  D1-owned surface immediately while a same-Worker 15-minute cron drains
  self-contained R2 cleanup work. The scheduler also removes unadopted
  temporary uploads after 24 hours while preserving every D1-adopted `tmp/`
  key. Creators can replace an option's image before the first Vote
  (`POST /creator/media/replace`); the superseded object is enqueued through
  the same retryable lifecycle.
- Image Poll creation on `/creator/new`. Creators can now choose the IMAGE poll
  type, upload one JPEG/PNG/WebP image per option (5 MB cap, server-side
  magic-byte validation), and provide required alt text and optional captions.
  Images are stored in R2 with temp-key adoption: files land at scoped temporary
  keys and become publicly servable only after the D1 creation batch adopts them.
  Upload failures preserve all other form fields so the Creator retries only the
  failed file.
- Image Poll voting on `/{link}`. Voters on Image Polls see square-cropped
  image plates at full column width with captions below. Tapping the image
  selects it — the image is the option, never a lightbox. Selection, bounds,
  submission, confirmation, and duplicate rejection behave exactly as
  Multiple-Choice. Already-voted and closed states show plates with the
  cast selection marked ◆. Results show plates above each option's bar.
- Public media serving at `/media/{id}`. Adopted images are served with
  immutable caching headers; unadopted or unknown IDs return 404.
- Per-round IRV table on Ranked-Choice Results. Every Round shows per-option
  counts, elimination statements (fewest votes, safe batch, backward tie-break),
  and exhausted-Ballot counts. Eliminated options are struck through from their
  elimination Round onward; the winner's final-Round cell is gold; unresolved
  ties mark tied options with an entropy border. The table scrolls horizontally
  on narrow viewports without collapsing or paginating.
- Ballot Manifest at `/{link}/manifest`. After a Ranked-Choice Poll closes,
  every anonymized Ballot's rankings are published in canonical order — no voter
  data, no timestamps, no internal identifiers — sufficient to independently
  recompute every Round and the outcome. Before close, the route renders a
  not-yet shape with the deadline.
- Comments on Ranked-Choice Results surfaces. Public Comment lists now appear
  on ranked Results pages, live payloads, and post-vote surfaces, matching the
  Multiple-Choice behavior. Owner moderation controls are included on owned
  views.
- YOUR BALLOT line on ranked post-vote. Voters who just cast a ranked Ballot
  see their options in rank order on the post-vote Tally. Claim-lookup failure
  remains fail-open.
- Ranked-Choice CSV and XLSX export. Ballot rows arrive through the type's
  projection port with one row per Vote and its full ranking. The XLSX
  1,000-Vote bound and 409 CSV-fallback behavior apply unchanged.
- Deterministic instant-runoff (IRV) tabulation for Ranked-Choice Polls. After
  authorization, live and closed Results, post-vote surfaces, and the live JSON
  endpoint compute the same pure IRV outcome from accepted Ballots — majority
  wins, safe batch elimination, backward tie-breaking, honest unresolved ties,
  and exhaustion tracking. The summary shows the winner or unresolved standings;
  the per-round table, Ballot Manifest, Comments on ranked Results, and ranked
  export remain for later stories.
- Ranked-Choice Poll creation and accessible ordered partial Ballots. Voters
  can rank, unrank, and compact options by tap, Enter, or Space, with the same
  complete flow available through server forms without JavaScript. Accepted
  preferences commit atomically as normalized Vote facts.
- Large Discover catalogs now publish a bounded sitemap index whose opaque
  keyset-range children reapply fresh D1 eligibility without crossing their
  encoded ranges; smaller catalogs keep the byte-compatible single
  `sitemap.xml` shape. Empty retired children return a stable gone response,
  generation has one whole-build request budget, and extreme cache timestamps
  no longer emit invalid HTTP dates.
- Direct owner XLSX export beside CSV on each creator Poll detail. Polls with
  up to 1,000 accepted Votes receive literal-string/numeric `VOTES`, `TALLY`,
  and `SUMMARY` worksheets from one bounded snapshot; a 1,001st-Vote sentinel
  returns a stable non-attachment `409` and leaves CSV available for larger
  Polls. The workerd writer is dynamically loaded and never truncates or adds
  continuation sheets.
- Direct owner CSV export from each creator Poll detail: one snapshot contains
  a deterministic raw row per accepted Vote plus every option and aggregate
  Tally total in disambiguated Tally and Summary sections. The download is
  private, spreadsheet-formula-safe, available
  regardless of Poll status or Results visibility, and excludes internal IDs,
  duplicate-enforcement identities, and provider/session/network data.
- Complete newest-first Comment lists now follow every authorized Tally.
  Readers see plain text and an `ANONYMOUS` fallback; Poll owners and the live
  Administrator can remove one Comment through an accessible confirmation
  without deleting its Vote, while open live surfaces reload when the list
  changes.
- Opt-in Comments with Votes: before the first Vote, a Creator can enable one
  optional plain-text Comment and display name on each ballot. Accepted
  Comments commit atomically with their Vote, safe retryable failures preserve
  the form values, and disabled Polls expose no Comment composer.
- Evaluator-first repository guide with a truthful shipped/planned capability
  matrix, live-product tour, exact local verification gate, and direct map to
  the authoritative architecture spine.
- Public Poll footers on canonical voting and non-404 Results surfaces link to
  the public source from the same server-rendered presentation seam used by the
  landing page; the embedded Demo and private/operator surfaces stay unchanged.
- The landing page now embeds the configured live Demo Poll with its ordinary
  ballot, CAPTCHA-backed Vote path, live Tally, trust claims, canonical Share
  link, and accessible no-JavaScript/read-only states. The owner can reset a
  non-empty eligible Demo through a confirmed atomic aggregate replacement
  that preserves the public link while clearing prior Vote-owned facts.
- Product landing page at `/`: a plain-language statement, technical build
  account, public repository link, create entry, and Discover link replace the
  foundation component showcase.
- Administrator Discovery moderation: the single out-of-band-assigned
  Administrator can find a Poll by link or reference, remove it from Discover
  and the sitemap without changing its link, ownership, Visibility Setting, or
  Votes, and clear the hold back to the Creator's prior Listed or Unlisted
  choice. A Delisted Creator sees a read-only explanation; Voters see the
  unchanged Poll.
- Public Discover catalog and crawl metadata: open Listed Polls now appear in
  a newest-first, keyset-paginated directory with accepted-Vote attendance,
  real no-JavaScript links, bounded progressive enhancement, canonical/noindex
  policy, and fresh `sitemap.xml` / `robots.txt` endpoints. Tally shape remains
  governed independently by each Poll's Visibility Setting.
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
- Evidence-gated deploy workflow (tests/build → staging Demo preflight,
  migrate, deploy, smoke → production Demo preflight, migrate, deploy, smoke)
  in GitHub Actions.
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

### Fixed

- Vote recovery can no longer duplicate a Vote when every Security Toggle is
  off. The voter's "Counted." proof is now signed before the Vote commits, so
  a signing failure surfaces as a truthful retry with nothing stored instead
  of a fresh retry behind an already-counted Vote; and the ten-second
  in-flight form recovery now keeps the original submission identity, so a
  resubmission after a slow or lost response replays to the stored outcome —
  or conflicts with the counted original standing — instead of counting
  twice.
