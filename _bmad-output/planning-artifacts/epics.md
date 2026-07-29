---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md
  - _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md
---

# oddspark-polls - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for oddspark-polls, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR-1: Creator sign-in — anyone becomes a Creator via Google or GitHub OAuth (Better Auth); creator surface denies unauthenticated requests with a sign-in path; a Creator can view/edit/close/delete only their own Polls; administrative moderation (delisting, deleting any Comment) is a separate Administrator capability; Voters never need an account.
FR-2: Create a Poll — question, options, Poll Type, Security Toggles, Visibility Setting, optional Deadline, optional Custom Link; a created Poll is immediately live at its link and accepts Votes (no draft state).
FR-3: Custom Links — creator-assigned readable slug at the root path (`polls.oddspark.dev/{custom-link}`); collisions with existing slugs and reserved application paths rejected with clear errors; slugs are lowercase letters/digits/hyphens; polls without a Custom Link get a short random ID path.
FR-4: Deadlines and closing — Poll auto-closes at its Deadline; Creator can close manually at any time; a Vote after close is rejected with a closed message; a closed Poll still serves its Tally per its Visibility Setting.
FR-5: Edit and delete — description editable at any time; question text, options, and Poll Type locked once the first Vote exists; deleting a Poll removes it and all Votes and its link stops resolving (plain 404).
FR-6: Single-select voting — exactly one option per Vote; zero or multiple selections rejected client- and server-side.
FR-7: Multi-select voting — Creator-enabled on Multiple-Choice Polls with optional min/max bounds (default 1 to all); out-of-bounds submissions rejected; Tally reports per-option counts and Voter count.
FR-8: Ballot casting — Voter ranks options in strict preference order; partial Ballots allowed (minimum one); no duplicate options, no skipped rank positions.
FR-9: IRV tabulation — exact rules: majority winner check each Round; fewest-votes elimination; safe batch elimination only when the tied group's combined votes are less than the next-lowest option; backward tie-break via the most recent earlier differing Round; identical-in-every-Round ties halt as "unresolved at that Round" with standing counts; exhausted Ballots leave the active count; fully deterministic.
FR-10: Per-Round results and Ballot Manifest — Tally shows each Round (per-option counts, eliminations, exhausted counts) sufficient to recompute the winner by hand; on close, the anonymized Ballot Manifest publishes wherever the Tally is visible.
FR-11: Image options — one uploaded image per option (JPEG/PNG/WebP, ~5 MB cap enforced at upload); served on voting page and results; same single/multi-select settings as Multiple-Choice.
FR-12: Propose time slots — Creator defines candidate slots (date + start/end) in the Creator's timezone; slots may differ in date and duration; slots lock after the first Vote.
FR-13: Availability voting — yes / no / if-need-be per slot, displayed in the Voter's local timezone with the source timezone noted; Voter enters a display name; a Voter can update their own availability while the Poll is open (session-based re-identification; new device = new row).
FR-14: Availability grid — Voters × slots grid with per-slot totals; slots ranked by yes count, ties broken by if-need-be count, remaining ties highlighted together; the system never auto-commits a meeting time.
FR-15: Per-poll Security Toggles — five independent Toggles (IP Checks, Session Checks, Voter Codes, CAPTCHA, VPN Blocking); all-off means no challenge/code/duplicate check; Toggles compose; new-Poll default is Session Checks on, all else off; tighten-only after the first Vote (enable but never disable).
FR-16: Duplicate-vote checks — IP Checks and Session Checks as independent Toggles; same-browser repeats rejected under Session Checks; same-IP repeats rejected under IP Checks (IPv4 full address, IPv6 /64); Session-only allows multiple Voters behind one shared IP.
FR-17: Voter Codes — Creator generates N codes and can view/copy the list; a Vote without a valid unused code is rejected; exactly N Votes possible from N codes; redemption is atomic under concurrency. *(Deferred: built when a real Poll needs it.)*
FR-18: CAPTCHA on the vote action — Cloudflare Turnstile required on submit when the Toggle is on; missing/invalid tokens rejected server-side.
FR-19: VPN Blocking — best-effort rejection of Votes from VPN/datacenter IPs with an explanatory message naming the Creator's choice. *(Deferred: built when a real Poll needs it.)*
FR-20: Visibility Settings — Live, After Close, or Creator-Only per Poll; After Close shows confirmation (never counts) until close; Creator-Only serves the Tally only to the authenticated Creator.
FR-21: Live-updating charts — bar/pie charts update without manual refresh while a Poll is open; a Vote cast elsewhere appears in an open viewer's charts without reload.
FR-22: Export — CSV and XLSX export of raw Votes (one row per Vote with options/Ballot/availability, timestamp, Comment) and Tally; creator surface only.
FR-23: Opt-in public discovery — every new Poll starts Unlisted; Creator moves between Unlisted and Listed at any time; Listed Polls appear on Discover and in sitemaps while open; Administrator can Delist and only the Administrator can clear Delisted; Unlisted/Delisted remain reachable by link; delisting changes neither ownership, visibility, nor Vote data.
FR-24: Vote-attached Comments — one optional Comment (with optional display name) per Vote; visible wherever the Tally is visible; Creator can delete any Comment on their Poll and disable Comments per Poll; Comment submission covered by the same Security Toggles as its Vote.
FR-25: Landing page — root URL explains the platform and how it's built, links the repository, pins the Demo Poll, and offers clear entries to Discover and creating a Poll (sign-in).
FR-26: Demo Poll — one designated Poll pinned to the landing page, votable by any visitor; runs with CAPTCHA + Session Checks on, IP Checks off; Creator can reset its Votes from the creator surface.
FR-27: Public repository — public, presentable repo with README (what/why/how, stack, how to run) and architecture notes; no secrets or personal data in history.
FR-28: Share a Poll — create-confirmation, voting, and results surfaces render an explicit text-labelled Share Action beside the canonical URL; native share sheet when available, copy-link fallback; results never gated behind sharing; no vendor social buttons; the shared URL is canonical and never changes.

### NonFunctional Requirements

NFR-1: Cost — total running cost stays within $0–5/mo (Cloudflare free tiers or the $5 Workers Paid plan); features breaching the ceiling are out of scope by definition.
NFR-2: Data ownership — all Poll and Vote data lives in Justin's own Cloudflare account; no third party holds poll history.
NFR-3: Authorization — every creator-surface action is scoped server-side to Polls the signed-in Creator owns, keyed to an internal user ID (never OAuth account identifiers); administrative moderation is a separate explicit capability.
NFR-4: Voter privacy — IP addresses and session identifiers are stored only to enforce duplicate checks, never displayed to anyone (including the Creator), and appear in no export.
NFR-5: Performance — voting pages are lightweight and fast globally; no heavy client framework payload on the voter surface; "feels instant" at this traffic level.
NFR-6: Trustworthy tabulation — all Tally computation happens server-side; a Voter cannot influence a Tally except by their own valid Vote.
NFR-7: Baseline abuse floor — independent of Toggles, rate-limit vote submissions, Poll creation, and sign-in attempts per client; limits generous enough that no human ever encounters them.
NFR-8: Input safety — all Voter-supplied text (Comments, display names) sanitized/escaped on render; Voter input can never execute as script.
NFR-9: Concurrency safety — duplicate checks and Voter Code redemption are race-free; concurrent submissions can never produce more accepted Votes than the rules allow.
NFR-10: Craft bar — public surfaces are portfolio-quality: visual polish plus pragmatic accessibility (keyboard navigation, sensible contrast, alt text on Image Poll images).
NFR-11: Casual poll-card feel — the product reads as a casual poll card (one question, tappable options, instant results), never as a survey form; this is the product's category-defining constraint.

### Additional Requirements

**Starter template (impacts Epic 1 Story 1):** AD-2 mandates scaffolding from the **official Cloudflare Astro Workers starter** — server-rendered HTML, zero client JavaScript by default, isolated vanilla TypeScript enhancements only, POST-redirect-GET flows that work without JavaScript.

- AR-1: Hexagonal modular monolith (AD-1, AD-19, AD-23) — one Astro app on one Worker; capability modules (`identity`, `polls`, `voting`, `results`, `discovery`, `comments`) own domain policy; Astro routes are inbound adapters; D1/R2/Better Auth/Turnstile/rate-limit/telemetry are outbound adapters; each fact set has one owning module and one legal write path; `shared/domain` and `shared/application` own cross-capability contracts (branded IDs, enums, contribution interfaces, error envelopes); structure per the Structural Seed.
- AR-2: Pinned stack (verified 2026-07-29) — Node 24.18.0, pnpm 11.17.0, TypeScript 7.0.2, Astro 7.1.5, @astrojs/cloudflare 14.1.6, Better Auth 1.6.25, Zod 4.4.3, Wrangler 4.115.0, Vitest 4.1.10 + @cloudflare/vitest-pool-workers 0.19.0, Playwright 1.62.0, fast-check 4.9.0; D1, R2, Turnstile, Rate Limiting, Workers Logs as managed services.
- AR-3: Environments and deployment (AD-14) — local/staging/production with distinct Worker names, D1 databases, R2 buckets, OAuth credentials, and secrets; `wrangler.jsonc` is binding truth with `nodejs_compat`; forward-only numbered SQL migrations with expand-contract; production deploys only after tests, build, staging migration, and staging smoke checks pass.
- AR-4: Poll types as strategies (AD-3) — each Poll Type implements the same `create` / `validateSubmission` / `persistFacts` / `projectResults` ports; ballots and availability are normalized relational facts, not opaque JSON; `CreatePoll` commits Poll + type facts + options/slots + slug reservation + adopted media in one D1 batch; a failed batch leaves no reachable Poll.
- AR-5: One constrained transaction accepts a Vote (AD-7) — `submission_id` idempotency (exact replay returns stored outcome; reused ID with different payload returns `IDEMPOTENCY_CONFLICT`); external challenges validated before mutation; Vote + type facts + Comment + duplicate claims + conditional Voter Code redemption + `representation_version` increment in one D1 `batch()` guarded by unique/conditional constraints; a D1 trigger aborts Vote insertion unless the Poll is effectively open; code use modeled as unique insert into `voter_code_redemptions`.
- AR-6: Duplicate identities are secret-keyed digests (AD-8) — IPv4 full address / IPv6 /64 normalization, then per-(Poll, check-kind) HMAC digests only; same for the first-party browser token; HMAC keys in Worker secrets; digests never exposed in projections or telemetry.
- AR-7: Server-computed results (AD-9) — SQL projections for multiple-choice and Meeting Polls; one pure deterministic IRV tabulator shared by live view, closed result, export, and tests; Ballot Manifest exposes only canonically ordered anonymized rankings.
- AR-8: Live results transport (AD-10, AD-24) — versioned conditional polling on a 3-second cadence, only while the page is visible; immediate refresh on visibility/network return; coalesced versions; stops on close; first failed refresh shows non-blocking RECONNECTING preserving the last Tally, capped backoff to 30s; each Poll carries one monotonic `representation_version` incremented in the same transaction as any representation-changing write; response validator combines version with effective open/closed state.
- AR-9: Deadline correctness without a scheduler (AD-11) — effective state is closed whenever `closed_at` is set or `deadline` ≤ request time; every read and command enforces effective state; cron may materialize closure but is not a correctness boundary.
- AR-10: R2 adoption + cleanup outbox (AD-12) — upload to Poll-scoped temporary keys; images exposed only after D1 adoption; replacement enqueues the superseded key; deletion writes self-contained cleanup keys to an outbox then hard-deletes the Poll and D1 children in one batch; a same-Worker `scheduled()` handler drains the outbox every 15 minutes and deletes unadopted temp keys older than 24h.
- AR-11: Canonical Poll references (AD-13) — one reserved-slug registry shared by routing and slug validation; generated references carry ≥96 random bits, URL-safe; canonical URLs never change; reserved set includes `/`, `/creator/*`, `/discover`, `/sign-in`, `/assets/*`, `/api/*`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml`, and per-Poll sub-paths `results` and `manifest`.
- AR-12: Voter-blind telemetry and recovery (AD-15) — structured Workers Logs (request ID, operation, stable result/error code, duration, provider outcome); never tokens, voter digests, Comments, ballot content, or Voter Codes; D1 Time Travel is the recovery floor; reconcile R2 from D1 ownership records after restore.
- AR-13: Admission-control semantics (AD-16) — Cloudflare Rate Limiting bindings are permissive best-effort throttles keyed by user/session digest/Poll/operation; Turnstile validation is server-side and fails closed on missing/invalid/duplicate/expired/unverifiable tokens, before the Vote transaction; only D1 constraints decide duplicates and code redemption.
- AR-14: Tighten-only lifecycle enforcement (AD-17) — immediately-open Polls, post-first-Vote immutability of question/options/type, enable-only Security Toggles, and Comment rules (plain text, one per Vote, accepted in the Vote transaction, deletable only by owner or administrator) enforced server-side.
- AR-15: Cost ceiling binds topology (AD-18) — any dependency with an additional mandatory monthly fee requires a new architecture decision and explicit cost-ceiling change.
- AR-16: Meeting response commands (AD-20) — `CreateMeetingResponse` creates the Vote, claims, and code redemption and returns a random first-party revision capability (digest stored with the Vote); `ReviseMeetingResponse` requires that capability, replaces only availability rows, increments `representation_version`, and never re-claims or re-redeems; D1 triggers enforce effective-open inside the transaction.
- AR-17: Result authorization precedes projection (AD-21) — every result/Comment/Manifest/export query takes a `ViewerContext` and authorizes before reading private facts; result and Manifest responses never enter shared caches (`private, no-store` for creator-only/not-yet-visible); discovery cards contain only public fields in a separate cache namespace.
- AR-18: CSRF boundary (AD-22) — one delivery middleware rejects state-changing requests whose Origin and Fetch Metadata are not same-origin; authenticated creator/admin forms additionally require a session-bound CSRF token; Better Auth keeps its own CSRF/OAuth-state protections; no route may bypass the middleware.
- AR-19: Consistency conventions — POST → 303 on success; 422 re-render with preserved values and inline field errors; Zod at delivery boundaries with domain invariants re-enforced; stable application error codes mapped once; UTC Unix ms in D1, RFC 3339 on the wire, IANA timezone only where civil time matters (Meeting Polls); snake_case D1, kebab-case files, no environment lookup in domain modules; one structured log record per operation.
- AR-20: Test architecture — `tests/unit` (pure domain and tabulation), `tests/integration` (workerd + local D1/R2 adapter contracts), `tests/e2e` (Playwright user journeys); fast-check available for property-based testing (IRV tabulator is the natural target).
- AR-21: Deferred decisions (do not build speculatively) — Voter Codes and VPN Blocking implementation wait for the first real Poll that needs them; XLSX writer selection deferred to the export story (must implement the export port and run inside workerd); Durable Object WebSockets, D1 read replication, discovery ranking/search, account deletion, and analytics vendor all have named revisit triggers.

### UX Design Requirements

UX-DR1: Design token system — implement the complete DESIGN.md frontmatter token set (colors, typography, motion, breakpoints, spacing, zero-radius shapes, component tokens) as the single styling source; both color modes ship; light mode resolves by `-dark`→`-light` suffix swap with exactly three explicit `…Light` exceptions (`results-bar.leaderMarkerColorLight`, `availability-cell.yesGlyphColorLight`, `overlay.scrimLight`); mode follows OS preference with a locally-persisted manual override; gold fills bind to `solar-*`, gold ink to `solar-ink-*`, and every focus outline binds to `focus-ring-*` (2px outline, 2px offset).
UX-DR2: `poll-option` component — 48px full-width rows with bottom hairlines; visually-hidden native radio/checkbox inputs with the row as `<label>` and decorative `::before` markers (`·`/`◆`, `[ ]`/`[×]`); whole row is the tap target; selection is the only gold on the voting surface besides the vote button; reused as the three-way Visibility Setting chooser and the two-way listing control with consequence lines.
UX-DR3: `results-bar` component (the signature) — 34/38px square bars on 1px baseline rules; low-alpha wash fill with 2px full-opacity leading edge; label and `47% · 122` value cluster inside the bar in text color; leader carries gold wash/edge plus the `◆` marker; exact tie withdraws all gold and `◆` and shows `TIED`; multi-select Polls show `{n} VOTERS · {m} SELECTIONS` above the group; renders instantly at final width on load, animates only on change; never reorders; never renders a percentage without its raw count; the Voter's own choice renders as a text-only `YOUR BALLOT` line, never a second gold.
UX-DR4: Motion system — exactly five primitives (`bar-transition` 480ms, `spark` 180ms, `count-up` 400ms, `leader-crossfade` 240ms, `pulse` 2400ms on `{motion.ease}`); synchronized settle across all bars; coalescing to latest value (animations never queue); leader change cross-fades gold between bars with the `◆` moving; `prefers-reduced-motion` snaps every state change instantly without losing information; idle is still; nothing else in the product animates.
UX-DR5: `chart-form-toggle` — `BARS · PIE` text toggle above the Tally; bars default on every load; per-viewer, not persisted; pie renders static percentages with a `◆`-marked legend and no motion of any kind including on live update.
UX-DR6: `security-toggle` — 40×20px square track/knob switch; whole row is the hit area with name and body-size description inside the `<label>`; locked state (tighten-only) keeps full-strength track color, dims the knob, and adds a `LOCKED` text label — no opacity as a state mechanism; UI reflects server-enforced locking.
UX-DR7: `trust-badge` — label-caps-lg line above the vote button mapping active Toggles to Voter-terms copy (`ONE VOTE PER BROWSER`, `ONE VOTE PER NETWORK`, `INVITE CODE REQUIRED`, `HUMAN CHECK ON SUBMIT`, `NO VPN OR DATACENTER CONNECTIONS`); absent entirely when all Toggles are off; stacks one item per line (never truncates or abbreviates); persists onto the Tally; no shield/lock iconography or "verified"/"secure" claims.
UX-DR8: Vote button contract — exactly one `button-primary` per screen (always the vote action on the voting surface); disabled until the Poll Type's minimum is met with a label-caps hint naming what unlocks it; in-flight swaps label to `COUNTING…` and disables (no spinner, no second POST); re-enables at normal label on any failure; disabled state uses `dim`, never `faint`.
UX-DR9: `share-action` — text-labelled `SHARE` button in secondary metrics beside the always-visible, selectable canonical URL; Web Share API when available, clipboard copy otherwise, confirming `LINK COPIED` beside the control (persists until next interaction, posts one polite announcement, never a toast); fully functional without JavaScript (the URL is there as text); on create confirmation, voting page, and Tally.
UX-DR10: `sign-in` — centered column with two full-width text-labelled `button-secondary` choices (`CONTINUE WITH GOOGLE` / `CONTINUE WITH GITHUB`), server-posted so sign-in works without JavaScript; no vendor logos or brand colors; caption noting voting never needs an account; denial/cancel returns with the Voice-and-Tone line and nothing lost; expired sessions redirect with a return address; the product prompts sign-in before the create form, not at publish time.
UX-DR11: `poll-card` + Discover — row pattern (Newsreader title, caption metadata line, hairline separation, whole row one tap target) reused on the creator list, landing page, and `/discover`; Discover shows only open Listed Polls newest-first with `NEWER`/`OLDER` pagination (real links, 48px targets, exhausted end dim and inert, ~20/page); skeleton rows without shimmer on load; error keeps loaded rows and offers retry; empty state is a recruiting surface with a create prompt; never infinite scroll, never a card grid.
UX-DR12: `listing-badge` + `listing-control` — `UNLISTED`/`LISTED`/`DELISTED` text badges (word carries state, color annotates: dim/entropy/alarm); creation-time opt-in reuses the single-select chooser with consequence lines; Poll detail offers the same two-way control; Delisted renders the control read-only with the moderation line; changeable at any time (discovery is presentation, not integrity).
UX-DR13: `comment` composer and list — composer is one optional text field plus optional display name directly above the vote button, part of the Vote (cap ~500 chars, countdown only in the last 50); absent when Comments are disabled; list is read-only, newest first, no threading/reactions/avatars; visible exactly where the Tally is visible; Creator sees a delete affordance, others none.
UX-DR14: `input` / `input-code` — no boxes: transparent fields with bottom rules (gold on focus, alarm on error), label-caps labels always present (no placeholder-as-label); validation on submit only (never on blur), inline message beneath the field, rest of the form preserved; never a tooltip, modal, or top-of-form summary; `input-code` is 20px/0.3em uppercase, trimmed and upper-cased as typed, validated server-side atomically with the Vote, and never autofocused.
UX-DR15: `live-indicator` + connection state — 6px pulsing gold dot beside `LIVE` (the one round thing); replaced in place by the lost-connection notice (`Not receiving updates. The counts shown are from {time}.` in label-caps-lg text color) when the subscription drops; restored and announced once on reconnect; bars hold last values while disconnected and snap to current on resume; decorative, never a control.
UX-DR16: `overlay` system — exactly three (delete-Poll confirm, delete-Comment confirm, Voter Code panel), none stack; scrim + flat panel with top/bottom hairlines, no shadow or scale-in; focus trapped inside, `Esc` always closes, scrim-click dismisses the confirmations but not the code panel; focus returns to the invoking control on close; page behind does not scroll.
UX-DR17: Accessibility floor — every action keyboard-completable; focus order follows reading order; 2px/2px focus ring everywhere via the focus-ring token; on every post-submit render (Counted, already-voted, VPN-blocked, bad code, CAPTCHA fail, rate-limited, failed, and OAuth returns) the outcome line is `tabindex="-1"`, first in the main landmark, receives focus on load, and the document `<title>` leads with the outcome; Tally totals are one polite `aria-live` region announcing aggregate change, leader changes ("Pizza now leading, 47 percent"), `TIED`, and connection loss/restore — never per-bar chatter; option accessible names carry state and value; no icon-only controls anywhere; state never color alone; 48px tap targets on voting-surface controls, 44px elsewhere; no gestures required (rank builder is tap-to-assign, not drag).
UX-DR18: Voice and Tone copy — implement the § Voice and Tone key-moments table verbatim as the product's message catalog (vote confirmations per Visibility Setting, both duplicate-rejection variants, closed/late/offline/failure states, Voter Code errors, CAPTCHA/rate-limit lines, creator validation errors, lock messages, code generation states, sign-in failure/expiry, share confirmation, Discover states, delisted notice); copy is layout-neutral (never says where things are); no exclamation marks, no emoji, no "Oops!".
UX-DR19: State patterns — ballot preservation is absolute (submission failure, offline, CAPTCHA failure, rate-limit, and out-of-bounds all return the ballot intact: selections, ranks, availability, Comment, display name, typed code); already-voted distinguishes session vs. IP causes with distinct messages and keeps the Poll readable with the Tally per Visibility; deleted Polls 404 with no tombstone (indistinguishable from nonexistence); direct nav to `/{link}/results` renders the After-Close/Creator-Only explanation shape (not a 404, no counts leaked); `/{link}/manifest` before close renders a "publishes when the Poll closes" shape; Tally cold-load renders skeleton bars on baseline rules (no shimmer) resolving without animation; empty Poll shows zero-width bars plus the empty-state line.
UX-DR20: Turnstile integration — rendered only when CAPTCHA is on, immediately above the vote button; `appearance: "interaction-only"`; `theme` binds to the resolved color mode including manual override; never blocks reading the Poll or gates page load; its chrome is the sanctioned exception to the zero-radius/shadow rules.
UX-DR21: `rank-builder` (Phase 2) — tap-to-assign ranking (tap assigns next rank, tap again unranks and compacts positions below); no drag; partial Ballots valid; vote button disabled at zero ranks only; summary line `RANKED {n} OF {total} · UNRANKED OPTIONS COUNT AS NO PREFERENCE` doubles as the polite live region; each option's accessible name states its rank and action.
UX-DR22: `round-table` (Phase 2) — every completed Round rendered in sequence, each with a one-line plain-language statement of the elimination rule that fired (including batch elimination and backward tie-break); eliminated options stay struck-through in `faint` from their Round onward; winner's final-Round cell is gold; unresolved state shows tied options with a 2px entropy left rule and no gold; never collapses or paginates Rounds; Manifest link sits directly beneath the Rounds on close.
UX-DR23: Availability grid (Phase 3) — each slot is a `radiogroup` of three named radios (Yes / If need be / No; cycle-on-tap is retired); 48×48px cells with glyph + wash carrying state together (`✓` gold, `~` entropy, `×` dim — never faint for No, `·` faint for unanswered); display name required; a returning Voter's row is pre-filled and editable while open; column totals below with a 2px gold top rule on the best column(s), ties highlighted together.
UX-DR24: Timezone handling (Phase 3) — slots authored in the Creator's stated timezone, stored as absolute instants; Voters see local times with the source time as a caption subline; date shifts flagged with literal `+1 day` text tinted entropy; a label-caps-lg line states the timezone in use with a manual override; the Creator's grid renders in the Creator's timezone.
UX-DR25: Responsive layout — mobile-first single column scaling by widening, never rearranging; two columns at `lg` on exactly two surfaces (post-vote Tally: ballot left / bars right; creator surface: list left / detail right); availability grid becomes a true matrix at `lg`; nothing appears only at large breakpoints or hides at small ones; 20px mobile / 48px desktop margins, 68ch measure; voter surface is server-rendered HTML with hand-written JS only for selection state, rank builder, availability grid, Turnstile, chart-form toggle, share enhancement, and the live subscription.
UX-DR26: Landing page + Demo Poll — Newsreader opening statement, short technical build account, repository link, create entry, and Discover link; the Demo Poll renders inline as a complete votable Poll (same components, not a screenshot or reduced version) with all states handled inline (already-voted shows the live Tally; mid-reset shows the empty state; question: "Best day for a long weekend?", no Deadline).

### FR Coverage Map

FR-1: Epic 1 - Creator sign-in (Google/GitHub OAuth, owned-Polls scoping)
FR-2: Epic 1 - Create a Poll (live immediately, all settings at creation)
FR-3: Epic 1 - Custom Links (root-path slugs, reserved-set rejection)
FR-4: Epic 1 - Deadlines and closing (effective-state auto-close, manual close)
FR-5: Epic 1 - Edit and delete (description editable, post-Vote lock, hard delete)
FR-6: Epic 1 - Single-select voting
FR-7: Epic 1 - Multi-select voting (min/max bounds)
FR-8: Epic 5 - Ballot casting (partial Ballots, no skipped ranks)
FR-9: Epic 5 - IRV tabulation (exact deterministic rules)
FR-10: Epic 5 - Per-Round results and Ballot Manifest
FR-11: Epic 6 - Image options (R2 upload, adoption, alt text)
FR-12: Epic 7 - Propose time slots
FR-13: Epic 7 - Availability voting (local timezones, revisable)
FR-14: Epic 7 - Availability grid (yes-ranked totals, tie highlighting)
FR-15: Epic 2 - Per-poll Security Toggles (tighten-only; default enforced from Epic 1)
FR-16: Epic 2 - Duplicate-vote checks (session + IP; claims schema lands in Epic 1)
FR-17: Epic 8 - Voter Codes (deferred until a real Poll needs it)
FR-18: Epic 2 - CAPTCHA on the vote action (Turnstile, fail closed)
FR-19: Epic 8 - VPN Blocking (deferred until a real Poll needs it)
FR-20: Epic 1 - Visibility Settings (Live / After Close / Creator-Only)
FR-21: Epic 1 - Live-updating charts (versioned conditional polling)
FR-22: Epic 4 - Export (CSV and XLSX)
FR-23: Epic 3 - Opt-in public discovery (Unlisted/Listed/Delisted)
FR-24: Epic 4 - Vote-attached Comments (composer, list, moderation)
FR-25: Epic 3 - Landing page
FR-26: Epic 3 - Demo Poll (CAPTCHA + Session Checks, creator reset)
FR-27: Epic 3 - Public repository (baseline README lands in Story 1.1)
FR-28: Epic 1 - Share a Poll (create-confirmation, voting, and results surfaces)

## Epic List

**Cross-cutting rule:** NFR-1..NFR-11 and the cross-cutting UX contracts (UX-DR1 tokens, UX-DR17 accessibility floor, UX-DR18 voice/tone, UX-DR19 state patterns) bind every epic; stories carry them as acceptance criteria — there is no separate polish or accessibility epic.

### Epic 1: Core Polling Loop (Phase 1)
Anyone can sign in with Google or GitHub, create a Multiple-Choice Poll (custom link, deadline, visibility), share its canonical link from every key surface, and watch trustworthy live results arrive — the complete StrawPoll-replacement loop. Closes the SM-7 gate; SM-1 (Justin's own real polls, which per UJ-1 use CAPTCHA and IP Checks) completes with Epic 2.
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-20, FR-21, FR-28
**Implementation notes:** Story 1.1 scaffolds from the official Cloudflare Astro Workers starter (AD-2) with environments, migrations, the design-token system (UX-DR1), the test harness and CI gates (AR-20, AR-3), the AD-22/AR-18 CSRF middleware (one delivery boundary — same-origin Origin/Fetch-Metadata rejection plus session-bound CSRF tokens on authenticated forms — in place before the first mutation route ships), and the shared component primitives (buttons, inputs, label-caps, `poll-option`, `results-bar`, `overlay`, focus-ring binding) as reusable token-bound components — later epics consume, never restyle. The vote story implements the complete AD-7 transaction shape from day one — `submission_id` idempotency, the duplicate-claim and code-redemption schema, the Comment contribution port, `representation_version` — with Session Checks enforced as the baked-in default (FR-15's default), the secret-keyed HMAC digest adapter and first-party browser token (AD-8/AR-6 — session claims are digests from the first vote, never raw tokens), and the baseline rate-limit bindings (NFR-7, AR-13) landing with the foundation. The first result endpoints implement the full AR-17 contract (`ViewerContext` authorization before projection, `private, no-store` on non-public responses). Epics 2 and 3 extend policy and surface; they never reshape this transaction. Three de-risking rules: the Poll Type strategy contract (AD-3/AD-23) is paper-validated against all four known types (ranked ballots, image media adoption, meeting availability + revision) before it freezes; `representation_version` increments go through one shared-kernel helper called by every command (never hand-rolled per epic); and Better Auth on workerd (full OAuth round-trip, local + staging) is validated in the earliest foundation stories, before any surface that assumes it. Story 1.1's acceptance criteria include a real README (product, stack, run instructions; no secrets in history) so the public repo is never an empty scaffold — FR-27's presentable bar closes in Epic 3. The results-bar and motion stories (UX-DR3/4) sequence late in the epic, after the vote and results plumbing is stable, so the signature component is built on a settled floor.

### Epic 2: Vote Security & Trust Surfaces (Phase 1)
Creators dial protection per poll — session checks, IP checks, CAPTCHA — with tighten-only locking, and voters see what protects the count via the trust badge and legible, distinct rejection messages. This epic closes the SM-2 gate — a publicly shared Poll verifiably withstands a duplicate-voting attempt — and completes SM-1: with CAPTCHA and IP Checks available, Justin's real polls (UJ-1) run here instead of StrawPoll.
**FRs covered:** FR-15, FR-16, FR-18
**Implementation notes:** Toggle surface and locking UI (UX-DR6), fail-closed Turnstile (AR-13, UX-DR20), trust badge (UX-DR7), session-vs-IP rejection copy (UX-DR18/19). Builds on Epic 1's claims schema and digest adapter; adds the IP normalization variant (IPv4 full address / IPv6 /64 per AR-6) and the toggle policy layer.

### Epic 3: Public Face — Discovery, Landing & Demo (Phase 1)
The platform earns strangers: the opt-in Discover directory with administrator delisting, the landing page that explains the product, the pinned votable Demo Poll, and the presentable public repository. Sequenced ahead of Comments & Export because it is the only Phase 1 epic with a human waiting on it (SM-6, SM-8).
**FRs covered:** FR-23, FR-25, FR-26, FR-27
**Implementation notes:** Depends on Epic 2 — the Demo Poll runs with CAPTCHA on (FR-26). Listing state machine and moderation (AD-5), sitemap generation, poll-card/pagination patterns (UX-DR11/12), landing page with inline Demo Poll (UX-DR26). Discovery adds only the separate public cache namespace (AR-17); result-endpoint authorization already exists from Epic 1. FR-27's presentable-repo bar (architecture notes, polished README) closes here; the baseline README exists from Story 1.1. Epics 3 and 4 remain mutually independent and may be swapped if priorities change.

### Epic 4: Comments & Export (Phase 1)
Voters humanize known-group polls with vote-attached comments (creator-moderated, per-poll disableable), and creators own their data via CSV/XLSX export.
**FRs covered:** FR-24, FR-22
**Implementation notes:** The composer joins Epic 1's vote form and fills the Comment contribution port already present in the AD-7 transaction. Export implements per-type row shapes through the AD-3 strategy port, so later Poll Types (Epics 5–7) bring their own export projections without reopening the exporter. XLSX writer selection deferred to the export story (AR-21). Sequences after Epic 2 so the composer joins a finished vote path.

### Epic 5: Ranked-Choice Polls (Phase 2)
Communities run verifiable ranked votes: tap-to-rank ballots with automatic compaction, exact deterministic IRV with every Round displayed, and the Ballot Manifest anyone can recompute the winner from.
**FRs covered:** FR-8, FR-9, FR-10
**Implementation notes:** New Poll Type strategy behind the AD-3 contract; one pure IRV tabulator shared by live view, closed result, export, and tests (AR-7) — natural fast-check property-test target (AR-20); rank-builder (UX-DR21) and round-table (UX-DR22).

### Epic 6: Image Polls (Phase 2)
Creators run visual polls with uploaded image options and captions, voting exactly like Multiple-Choice.
**FRs covered:** FR-11
**Implementation notes:** New strategy plus the R2 media pipeline — temporary keys, adoption, cleanup outbox, scheduled drain (AR-10); alt text required at upload blocks publication (UX-DR17); square image plates (UX-DR2).

### Epic 7: Meeting Polls (Phase 3)
Friends pick a meeting time across timezones: slot builder, three-state availability grid in each Voter's local time, revisable responses, and yes-ranked totals that surface the best slot without auto-committing it.
**FRs covered:** FR-12, FR-13, FR-14
**Implementation notes:** `CreateMeetingResponse` / `ReviseMeetingResponse` command split with the revision capability token (AR-16); radiogroup grid cells (UX-DR23); timezone rendering with `+1 day` flags and manual override (UX-DR24).

### Epic 8: Invite-Only & VPN Protection (Deferred)
Invite-only polls admit exactly the invited via one-time Voter Codes, and VPN Blocking rejects datacenter egress — built when the first real Poll needs them (PRD §7.4), completing UJ-4 and SM-3.
**FRs covered:** FR-17, FR-19
**Implementation notes:** Extends Epic 2's toggle stack; redemption uses the `voter_code_redemptions` insert model already shaped in Epic 1's transaction (AR-5); code panel overlay (UX-DR16), `input-code` (UX-DR14), VPN heuristics per the PRD addendum (best-effort ASN/datacenter identification).

## Epic 1: Core Polling Loop

Anyone can sign in with Google or GitHub, create a Multiple-Choice Poll (custom link, deadline, visibility), share its canonical link from every key surface, and watch trustworthy live results arrive — the complete StrawPoll-replacement loop. Closes the SM-7 gate; SM-1 (Justin's own real polls, which per UJ-1 use CAPTCHA and IP Checks) completes with Epic 2.

### Story 1.1: Project Foundation & Deployable Skeleton

As Justin (site operator),
I want the project scaffolded from the official Cloudflare Astro Workers starter with environments, CI, migrations, the CSRF boundary, and the design-token system in place,
So that every later story builds on a deployable, tested, secure floor instead of inventing infrastructure mid-feature.

**Exit criterion (binary):** this story is done when the styled placeholder page is live on staging *and* production, having passed the full deploy gate (tests → build → staging migration → smoke). Every AC below is scaffolding toward that signal.

**Acceptance Criteria:**

**Given** a fresh clone of the repository,
**When** `pnpm install`, `pnpm test`, and `pnpm build` are run,
**Then** all succeed on the pinned stack (Node 24.18.0, TypeScript 7.0.2, Astro 7.1.5, `@astrojs/cloudflare` 14.1.6, Wrangler 4.115.0, Vitest 4.1.10 + `@cloudflare/vitest-pool-workers`, Playwright, fast-check) scaffolded from the official Cloudflare Astro Workers starter,
**And** `wrangler.jsonc` is the binding truth and enables `nodejs_compat`.

**Given** the three environments (local, staging, production),
**When** the app is deployed,
**Then** each uses distinct Worker names, D1 databases, R2 buckets, and secrets,
**And** production deploys only after tests, build, staging migration, and a staging smoke check pass (AR-3).

**Given** the migrations directory,
**When** a numbered `NNNN_description.sql` migration is added,
**Then** it applies forward-only to local, staging, and production D1 in that order, and out-of-order or edited historical migrations are rejected.

**Given** any state-changing HTTP request whose `Origin` or Fetch Metadata is not same-origin,
**When** it reaches the Worker,
**Then** the single delivery middleware rejects it before any handler runs (AD-22/AR-18) — in place before the first mutation route exists.

**Given** the deployed placeholder page,
**When** viewed with OS dark and light preferences,
**Then** the DESIGN.md token set renders both modes correctly (suffix-swap rule with its three exceptions), a manual mode override persists locally, and the base layout uses the token spacing, typography, and zero-radius rules (UX-DR1).

**Given** the public repository,
**When** a visitor reads it,
**Then** a real README covers what the product is, the stack, and how to run it, and no secrets or personal data exist anywhere in the history (FR-27 baseline).

**Given** any application operation,
**When** it completes,
**Then** the telemetry adapter emits one structured Workers Logs record — request ID, operation, stable result or error code, duration, provider outcome — and never records tokens, voter digests, Comments, ballot content, or Voter Codes (AD-15/AR-12),
**And** D1 Time Travel is documented as the database recovery floor, with R2 reconciled from D1 ownership records after any restore.

### Story 1.2: Creator Sign-In with Google or GitHub

As a prospective Creator,
I want to sign in with Google or GitHub in seconds,
So that I can create and manage my own Polls without a new account or password.

**Acceptance Criteria:**

**Given** a signed-out visitor at `/sign-in`,
**When** the page renders,
**Then** it shows two full-width, text-labelled `button-secondary` choices — `CONTINUE WITH GOOGLE` and `CONTINUE WITH GITHUB` — each a server-posted action that works without JavaScript, with no vendor logos or brand colors, and a caption noting that voting never needs an account (UX-DR10).

**Given** a visitor completes the OAuth round-trip successfully (validated on workerd, local and staging — de-risk rule #3),
**When** they return to the app,
**Then** Better Auth has created a session in D1 and an internal, provider-independent user ID,
**And** the OAuth `(provider, provider_account_id)` pair maps to that internal ID and is never used as an ownership key (AD-4),
**And** the outcome render follows the post-submit contract: outcome line first in the main landmark, `tabindex="-1"`, focused on load, document `<title>` leading with the outcome (UX-DR17).

**Given** a visitor cancels or is denied at the provider,
**When** they return,
**Then** they land at the sign-in entry with "That didn't sign you in. Nothing was created, and nothing was lost." and no account or session exists.

**Given** an unauthenticated request to any creator-surface route,
**When** it is received,
**Then** it is denied with a redirect to `/sign-in` carrying a return address, and after sign-in the Creator lands back where they started (FR-1),
**And** the return address is validated as a same-origin relative path — never an absolute URL or scheme; a violating value falls back to `/creator` (no open redirect through the auth flow).

**Given** a Creator whose session has expired,
**When** they act on a creator route,
**Then** they are redirected to sign-in with "You've been signed out." and returned to their prior location after re-auth.

**Given** the OAuth apps this story depends on,
**When** environments are provisioned,
**Then** per-environment Google and GitHub app setup (redirect URIs, client IDs, secrets stored as Worker secrets) is documented in the README as part of this story — six apps across three environments is real work that must not block silently.

### Story 1.3: Create a Multiple-Choice Poll

As a Creator,
I want to create a Multiple-Choice Poll with my question, options, visibility, and optional deadline,
So that my Poll is live and votable the moment I publish it.

**Acceptance Criteria:**

**Given** a signed-in Creator on `/creator/new`,
**When** they submit a question, two or more options, a Visibility Setting, and an optional Deadline,
**Then** `CreatePoll` commits the Poll, its options, and its generated reference in one D1 batch (AD-3) — a failed batch leaves no reachable Poll,
**And** the Poll is immediately open and votable at a root-path link containing at least 96 random bits, URL-safe (AD-13),
**And** the create-confirmation page shows the full canonical URL (FR-2).

**Given** the creation form,
**When** the Visibility Setting is chosen,
**Then** the chooser renders as three `poll-option` single-select rows — Live, After Close, Creator-Only — each with its consequence line beneath (UX-DR2), defaulting per the form's initial state,
**And** the new Poll records Session Checks on as the baked-in default (FR-15's default, enforced from Story 1.5's transaction).

**Given** invalid input — zero options, one option, or a Deadline in the past,
**When** the form is submitted,
**Then** the route re-renders with status 422, the exact Voice-and-Tone message inline beneath the offending field ("A Poll needs options." / "One option isn't a Poll." / "That Deadline has already passed."), and every other field preserved (AR-19, UX-DR14); success responds POST → 303.

**Given** oversized creation input,
**When** the option count or the question/option/description length exceeds server-enforced sensible caps,
**Then** the submission is rejected 422 with the field named — protecting page weight and D1 batch limits on a public-signup surface. Caps `[ASSUMPTION]`: at most 30 options; question ≤ 280 characters; option label ≤ 100; description ≤ 5,000.

**Given** any creator-supplied text — question, options, description,
**When** it renders on any surface,
**Then** it is escaped plain text; no rich-HTML path exists for any user-supplied content, because on a public-signup platform Creators are untrusted input too (NFR-8 extended, AR-19).

**Given** the Poll Type strategy contract defined in this story,
**When** it is frozen,
**Then** a written design check validates it against all four known Poll Types' needs — ranked ballots, image media adoption, meeting slots/availability + revision (de-risk rule #1).

### Story 1.4: Custom Links

As a Creator,
I want to give my Poll a readable custom link like `/team-lunch`,
So that the URL itself is memorable and shareable.

**Acceptance Criteria:**

**Given** a Creator assigning a Custom Link at creation,
**When** the slug contains only lowercase letters, digits, and hyphens and is unclaimed and unreserved,
**Then** `polls.oddspark.dev/{custom-link}` resolves to the Poll and the random reference is replaced as the canonical URL (FR-3).

**Given** a slug already in use,
**When** submitted,
**Then** the form re-renders with "`{slug}` is taken. Pick another." inline, everything else preserved.

**Given** a slug in the reserved set (`/`, `/creator/*`, `/discover`, `/sign-in`, `/assets/*`, `/api/*`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml`, `results`, `manifest`),
**When** submitted,
**Then** it is rejected with "`{slug}` is reserved by the application itself. Pick something less structural.",
**And** routing and slug validation import the same single reserved-slug registry (AD-13).

### Story 1.5: Cast a Vote That Counts Exactly Once

As a Voter,
I want to open a Poll link, pick an option, and submit — once,
So that my vote counts and nobody's duplicate attempt (including mine) changes the Tally.

**Acceptance Criteria:**

**Given** a Voter opening `/{link}` on a phone,
**When** the page loads,
**Then** the question and options render server-side with no client framework payload (NFR-5), each option a 48px `poll-option` row — a visually-hidden native radio with the row as its label and the `·`/`◆` marker decorative (UX-DR2) — and the vote button disabled with a label-caps hint until a selection exists (UX-DR8).

**Given** a selected option and an idle Poll,
**When** the Voter submits,
**Then** the server commits the Vote, its selection, the session duplicate claim, and the `representation_version` increment in one constrained D1 batch (AD-7),
**And** the confirmation renders "Counted." with the post-submit focus contract (outcome line focused, `<title>` leading with the outcome).

**Given** a submission with zero selections (or a forged multi-selection on a single-select Poll),
**When** it reaches the server,
**Then** it is rejected server-side regardless of client hints (FR-6), with the ballot preserved.

**Given** the same browser attempting a second Vote,
**When** it submits,
**Then** the session claim's unique constraint rejects it, the Voter sees "You've already voted here. Enthusiasm noted; the Tally is unchanged.", the Poll stays readable with options rendered read-only, and the Tally is unchanged (FR-16 session path).

**Given** a browser retry replaying the same `submission_id` with an identical payload,
**When** it arrives,
**Then** the stored outcome is returned without re-validation; a reused `submission_id` with a different payload returns `IDEMPOTENCY_CONFLICT` (AD-7).

**Given** any accepted or rejected Vote,
**When** duplicate identities are persisted,
**Then** only secret-keyed HMAC digests scoped to (Poll, check kind) are stored — never raw session tokens or IPs — with keys in Worker secrets, and no digest appears in logs or projections (AD-8/AR-6),
**And** the first-party browser token is issued as a cookie on voting-page render; a submission arriving without one on a Session-Checks Poll is rejected with the retry idiom and the ballot preserved — never accepted unclaimed.

**Given** a Poll whose Deadline has passed (or that was closed),
**When** a Vote is submitted,
**Then** the D1 trigger aborts the insert because effective state is closed at transaction time (AD-11), and the Voter sees "This Poll closed while you were deciding — {when}. Your Vote wasn't recorded."

**Given** a Poll deleted while a Vote is in flight,
**When** the transaction runs,
**Then** foreign keys abort the entire batch — no partial Vote facts survive — and the Voter lands on the plain 404, because the Poll no longer exists (AD-7).

**Given** vote submissions arriving from one client at abusive rates,
**When** the baseline rate-limit bindings engage,
**Then** submissions are throttled per client without any human Voter ever encountering the limit (NFR-7, AR-13).

### Story 1.6: Voting-Page States & Resilience

As a Voter,
I want the voting page to keep my ballot safe through failures, offline moments, and in-flight submits — and to tell me when the Poll closes,
So that I never rebuild a ballot the product lost and never get surprised by a deadline.

**Acceptance Criteria:**

**Given** an open Poll with a Deadline,
**When** the voting page renders,
**Then** the Deadline shows as a local datetime, switching to a countdown under 24 hours (UX-DR19).

**Given** a submission in flight,
**When** the Voter has activated the vote button,
**Then** its label swaps to `COUNTING…` and it disables — a second activation cannot produce a second POST — while the ballot and options stay fully legible, and it re-enables at its normal label on any failure (UX-DR8, UX-DR19).

**Given** a submission failure of any kind (network error, validation, rejection),
**When** the page re-renders,
**Then** the Voter's ballot is preserved exactly — selection, any typed text — and the failure message appears above the vote button; a Voter never reconstructs a ballot the product lost (UX-DR19).

**Given** a Voter who goes offline,
**When** they attempt to submit (or the connection event fires),
**Then** the page shows "No connection. Your ballot is safe on this page; nothing has been sent yet.", the ballot is held, the button re-enables, and the loaded page remains fully readable offline — only submission is affected (UX-DR19).

### Story 1.7: Multi-Select Voting

As a Creator,
I want to let Voters pick several options with optional min/max bounds,
So that "choose your top three" polls work without becoming a survey.

**Acceptance Criteria:**

**Given** a Creator enabling multi-select at creation,
**When** they optionally set min/max bounds,
**Then** the bounds default to 1-to-all and are stored with the Poll (FR-7),
**And** creation validates `min ≤ max ≤ option count` — a configuration that would make the Poll unvotable is rejected 422 inline, since options lock after a first Vote that could never arrive.

**Given** a Voter on a multi-select Poll with a configured max,
**When** they reach the max,
**Then** unselected rows go non-interactive with the caption line "Pick up to {max}. {n} chosen.", and below a configured min the vote button stays disabled with "Pick at least {min}." (UX-DR2),
**And** checkbox rows use the same native-input construction with `[ ]`/`[×]` markers.

**Given** a submission outside the configured bounds (client hints bypassed),
**When** it reaches the server,
**Then** it is rejected with the violated bound named and the ballot returned intact (FR-7, UX-DR19).

**Given** a multi-select Tally,
**When** it renders,
**Then** it reports per-option counts plus a `{n} VOTERS · {m} SELECTIONS` label-caps-lg line above the bar group, so option counts summing past the Voter count reads as intended (UX-DR3).

### Story 1.8: Results View with Visibility Settings

As a Voter or Creator,
I want to see the Tally rendered per the Poll's Visibility Setting,
So that results are visible to exactly the audience the Creator chose.

**Acceptance Criteria:**

**Given** an open Poll with Visibility **Live**,
**When** anyone with the link opens `/{link}/results`,
**Then** the Tally renders as `results-bar` blocks — 34/38px bars on 1px baseline rules, wash fill with a 2px leading edge, label left and `{pct}% · {count}` inside, the leader carrying gold wash/edge plus the `◆` marker, an exact tie withdrawing all gold and `◆` under a `TIED` line (UX-DR3),
**And** all counts and percentages are computed server-side from accepted Vote facts via SQL projection (AD-9, NFR-6).

**Given** a Voter who has just voted,
**When** the confirmation and Tally render,
**Then** their own choice appears as a text-only `YOUR BALLOT` line — never a second gold on the surface.

**Given** Visibility **After Close** on an open Poll,
**When** a Voter who voted (or anyone hitting `/{link}/results` directly) looks,
**Then** they see the confirmation/explanation shape — "Results open when the Poll closes — {deadline, local}." — with the question, no counts, no totals, nothing leaking the result's shape (FR-20, UX-DR19),
**And** a Poll with no Deadline (manual-close-only) renders the no-timestamp variant — "Results open when the Poll closes." — same shape, no hole in the sentence.

**Given** Visibility **Creator-Only**,
**When** anyone but the authenticated owning Creator requests results,
**Then** they see "These results go to the Creator only." with no counts, while the owner sees the full Tally,
**And** every result query authorizes a `ViewerContext` before reading private facts, and creator-only or not-yet-visible responses are served `private, no-store` (AD-21/AR-17).

**Given** a Poll with no Votes,
**When** the Tally renders,
**Then** zero-width bars sit on their baseline rules with labels and the empty-state line ("No Votes yet. Yours would be the first, which is a kind of power."), and a cold load shows skeleton bars at the correct count with no shimmer, resolving without animation (UX-DR19).

### Story 1.9: Live-Updating Results

As a Poll watcher,
I want the Tally to update by itself while the Poll is open,
So that I never reach for refresh and never trust stale numbers unknowingly.

**Acceptance Criteria:**

**Given** an open Tally in one browser and a Vote cast in another,
**When** the Vote is accepted,
**Then** the first viewer's counts update within a few seconds without a reload (FR-21), via conditional polling of one versioned result projection on a 3-second cadence, only while the page is visible (AD-10).

**Given** any command that changes a visible Poll representation,
**When** it commits,
**Then** it increments `representation_version` through the single shared-kernel helper (de-risk rule #2), and the response validator combines that version with effective open/closed state so crossing a Deadline invalidates caches without a scheduled write (AD-24).

**Given** a viewer not entitled to the Tally (After Close before close, Creator-Only for non-creators),
**When** they request the refresh/version endpoint,
**Then** it applies the same `ViewerContext` authorization as the full result query and returns no version signal at all — vote-arrival timing and volume never leak through a ticking validator (AR-17).

**Given** a hidden tab,
**When** the viewer returns (or network connectivity returns),
**Then** polling resumes with an immediate refresh and the display snaps to current values without replaying missed changes.

**Given** a failed refresh,
**When** it first occurs,
**Then** the live indicator is replaced in place by "Not receiving updates. The counts shown are from {time}." (label-caps-lg, text color), the last known Tally is preserved, retries back off up to 30 seconds, and reconnection restores the indicator and announces "Updates resumed." once on the polite live region (UX-DR15/17).

**Given** an open Poll,
**When** its Tally is on screen,
**Then** the 6px gold live dot pulses beside `LIVE`, and when the Poll closes, polling stops and the indicator is replaced by `CLOSED`.

### Story 1.10: Motion System & Chart Toggle

As a Poll watcher,
I want vote arrivals to animate with the product's five motion primitives,
So that watching an opinion take shape feels alive — the product's signature moment.

**Acceptance Criteria:**

**Given** a Vote arriving on an open bar Tally,
**When** the update lands,
**Then** the affected bar's width transitions over 480ms on the spec easing while every other bar settles simultaneously (one synchronized settle, never a cascade), the changed bar's leading edge sparks 2px→4px→2px over 180ms timed with the width change, and counts tick over 400ms in monospace with zero reflow (UX-DR4).

**Given** updates arriving faster than one animation window,
**When** they land,
**Then** they coalesce into a single transition to the latest value — animations never queue or chain.

**Given** a leadership change,
**When** it occurs,
**Then** the new leader cross-fades blue→gold over 240ms while the deposed leader fades gold→blue concurrently and the `◆` moves with the gold; an exact tie withdraws gold and `◆` from every bar under `TIED`.

**Given** `prefers-reduced-motion: reduce`,
**When** any of the five primitives would fire,
**Then** every state change lands instantly and completely — widths snap, numbers snap, spark omitted, leader colors change on the frame, live dot holds steady. Reduced motion never reduces information (UX-DR4/17).

**Given** the `BARS · PIE` chart-form toggle,
**When** a viewer switches to PIE,
**Then** the same values render as static percentages with a `◆`-marked legend, no motion of any kind including on live updates, the choice does not persist across loads, and initial page paint never animates in either form (UX-DR5),
**And** on a Voter's own successful submission, their bar sparks as the confirmation renders — the one moment the product exists to deliver.

### Story 1.11: Creator Dashboard

As a Creator,
I want a dashboard listing my Polls with at-a-glance status and counts,
So that I can monitor everything I'm running from one place.

**Acceptance Criteria:**

**Given** a signed-in Creator at `/creator`,
**When** the page renders,
**Then** it lists only that Creator's Polls as `poll-card` rows — question title, caption metadata line (type · votes · closing time), live indicator on open Polls, `CLOSED` label-caps-lg on closed ones — newest first with live Polls above closed, each whole row one tap target to the Poll detail (UX-DR11).

**Given** a Creator with no Polls,
**When** `/creator` renders,
**Then** it shows "No Polls yet. The empty state, working as intended." plus the create action.

**Given** a Creator attempting to view or act on another Creator's Poll,
**When** the request reaches the server,
**Then** it is denied by ownership checks against the internal user ID — route hiding is never the authorization (NFR-3, AD-4).

**Given** a viewport at the `lg` breakpoint or wider,
**When** the creator surface renders,
**Then** it splits two-column — Poll list left, selected Poll detail right — while below `lg` it remains single-column with no component hidden or added (UX-DR25).

### Story 1.12: Close, Edit & Delete

As a Creator,
I want to close my Poll on my schedule, edit its description, and delete it entirely,
So that I control its lifecycle without ever invalidating votes already cast.

**Acceptance Criteria:**

**Given** an open Poll,
**When** the Creator closes it manually (or its Deadline passes),
**Then** effective state is closed for every subsequent read and command — computed from `closed_at`/`deadline` at request time, never dependent on a scheduler (AD-11) — later Votes are rejected with the closed message, and the Tally serves per the Visibility Setting (FR-4).

**Given** a Poll with at least one Vote,
**When** the Creator views the edit surface,
**Then** the question, options, and Poll Type render as read-only text with "Locked — the first Vote has been cast. The description is still yours to edit.", while the description remains editable at any time (FR-5, AD-17).

**Given** the Creator chooses delete,
**When** the confirmation overlay opens,
**Then** it shows "Delete \"{question}\"? This removes the Poll and all {n} Votes in it. The link stops resolving. There is no undo." with focus trapped inside, `Esc` and scrim-click dismissing, and focus returning to the invoking control on close (UX-DR16).

**Given** a confirmed deletion,
**When** it executes,
**Then** the Poll and all D1-owned children are hard-deleted in one batch and the link immediately returns a plain 404 — no tombstone, indistinguishable from a Poll that never existed (FR-5, UX-DR19).

### Story 1.13: Share a Poll

As a Creator or Voter,
I want a Share action beside the Poll's canonical URL on the confirmation, voting, and results surfaces,
So that spreading a Poll takes one tap and never requires hunting for the link.

**Acceptance Criteria:**

**Given** the create-confirmation, voting page, or Tally view,
**When** it renders,
**Then** a text-labelled `SHARE` button in `button-secondary` metrics sits beside the canonical URL, which is always visible as selectable text — the surface is fully functional without JavaScript (FR-28, UX-DR9).

**Given** a browser with the Web Share API,
**When** `SHARE` is activated,
**Then** the native share sheet opens with the canonical URL; without the API, the URL is copied and `LINK COPIED` renders beside the control in label-caps, persisting until the next interaction — not a toast — with one polite live-region announcement.

**Given** any share,
**When** the URL is shared,
**Then** it is the canonical link, which never changes, results are never gated behind sharing, and no vendor-specific social buttons exist anywhere (FR-28),
**And** on the voting surface the Share action never competes with the vote button as a primary action.

## Epic 2: Vote Security & Trust Surfaces

Creators dial protection per poll — session checks, IP checks, CAPTCHA — with tighten-only locking, and voters see what protects the count via the trust badge and legible, distinct rejection messages. This epic closes the SM-2 gate — a publicly shared Poll verifiably withstands a duplicate-voting attempt — and completes SM-1: with CAPTCHA and IP Checks available, Justin's real polls (UJ-1) run here instead of StrawPoll.

### Story 2.1: Per-Poll Security Toggles

As a Creator,
I want to enable or disable each protection independently on my Poll,
So that a friends poll stays frictionless while a public poll resists abuse — my choice, per Poll.

**Acceptance Criteria:**

**Given** the creation form and the Poll detail,
**When** the Security Toggles render,
**Then** each is a `security-toggle` row — 40×20px square track and knob, name in label-caps, a one-line body-size description of what the Toggle costs the Voter, the whole row the hit area with name and description inside the `<label>` (UX-DR6),
**And** a new Poll opens with Session Checks on and every other Toggle off (FR-15).

**Given** a Poll with all Toggles off,
**When** a Voter submits,
**Then** the Vote submits with no challenge, no code, and no duplicate check (FR-15),
**And** enabled Toggles compose — any combination enforces all enabled checks.

**Given** a Poll with at least one accepted Vote,
**When** the Creator attempts to change Toggles,
**Then** an off Toggle can still be enabled but an on Toggle cannot be disabled — enforced server-side, with the UI reflecting it (FR-15, AD-17),
**And** the locked row keeps its full-strength on-track color, drops the knob to `dim`, and shows `LOCKED` beside the name — never opacity as the state mechanism (UX-DR6),
**And** the surface explains: "Votes are in. Protections can tighten from here, not loosen."

**Given** a Toggle enabled mid-Poll,
**When** subsequent Votes arrive,
**Then** the new check applies to them only — no Vote already cast is invalidated.

### Story 2.2: IP Checks

As a Creator running a public poll,
I want repeat votes from the same network connection blocked,
So that ballot-stuffing from one machine across browsers doesn't corrupt my results.

**Acceptance Criteria:**

**Given** a Poll with IP Checks on,
**When** a second Vote arrives from the same IP — even from a different browser,
**Then** it is rejected by the IP claim's unique constraint inside the vote transaction, and the Tally is unchanged (FR-16),
**And** IPv4 matches on the full address and IPv6 on the /64 prefix, normalized before digesting (AR-6).

**Given** the rejection,
**When** the Voter sees it,
**Then** the message is the IP-specific one — "Someone on this connection already voted. The Creator turned on one-vote-per-network, and it can't tell roommates apart…" — never the same-browser message; the two causes are never conflated (UX-DR19).

**Given** a Poll with Session Checks on and IP Checks off,
**When** multiple Voters behind one shared IP each vote from their own browsers,
**Then** every one of them succeeds while same-browser repeats are still blocked (FR-16).

**Given** any IP-derived data,
**When** it is persisted or logged,
**Then** only the secret-keyed HMAC digest scoped to (Poll, check kind) exists — the raw address appears in no table, no log, no export, and no surface, including the Creator's (NFR-4, AD-8).

### Story 2.3: CAPTCHA on the Vote Action

As a Creator running a publicly shared poll,
I want a human check on the vote action,
So that scripted ballot-stuffing fails while real Voters barely notice.

**Acceptance Criteria:**

**Given** a Poll with the CAPTCHA Toggle on,
**When** the voting page renders,
**Then** the Turnstile widget sits immediately above the vote button with `appearance: "interaction-only"` (absent until a challenge is required) and `theme` bound to the resolved color mode including manual override; it never blocks reading the Poll or gates page load (UX-DR20).

**Given** a Vote submission on a CAPTCHA-enabled Poll,
**When** the token is missing, invalid, duplicate, expired, or unverifiable,
**Then** the server rejects the Vote before the transaction runs — failing closed (FR-18, AR-13),
**And** rejection is server-side; hiding the widget client-side changes nothing.

**Given** a failed challenge,
**When** the page re-renders,
**Then** the Voter sees "The human check didn't pass. Try it again — it's usually just a fluke.", the widget resets, the vote button re-enables, and the entire ballot survives intact (UX-DR19).

**Given** the Turnstile iframe,
**When** it renders,
**Then** its chrome is the one sanctioned exception to the zero-radius and shadow rules and is not restyled — the product's accessibility responsibility stops at the iframe boundary.

### Story 2.4: Trust Badge

As a public Voter,
I want to see what protections are active before I participate,
So that I can believe the count this Poll produces.

**Acceptance Criteria:**

**Given** a Poll with one or more Toggles on,
**When** the voting page renders,
**Then** a label-caps-lg trust badge sits above the vote button listing each active protection in the Voter's terms — `ONE VOTE PER BROWSER`, `ONE VOTE PER NETWORK`, `INVITE CODE REQUIRED`, `HUMAN CHECK ON SUBMIT`, `NO VPN OR DATACENTER CONNECTIONS` — with a small entropy glyph and a hairline above, no border, no chip (UX-DR7).

**Given** a Poll with every Toggle off,
**When** the voting page renders,
**Then** the badge is absent entirely — it never says "no protections" (SM-C1).

**Given** badge items that overflow a 375px viewport,
**When** they render,
**Then** items stack one per line in order, each line keeping the first line's left edge with the glyph hanging outside the text column — never truncated, never abbreviated.

**Given** the Tally view,
**When** it renders,
**Then** the badge persists there so a reader evaluating the numbers sees what produced them,
**And** no "verified"/"secure" claims and no shield or lock iconography appear anywhere.

## Epic 3: Public Face — Discovery, Landing & Demo

The platform earns strangers: the opt-in Discover directory with administrator delisting, the landing page that explains the product, the pinned votable Demo Poll, and the presentable public repository. Sequenced ahead of Comments & Export because it is the only Phase 1 epic with a human waiting on it (SM-6, SM-8).

### Story 3.1: Listing Control — Opt Into Discovery

As a Creator,
I want my Poll Unlisted by default with an explicit opt-in to the public directory,
So that nothing I make is ever public without my say-so, and foot traffic is one choice away.

**Acceptance Criteria:**

**Given** any newly created Poll,
**When** it is created,
**Then** its discovery state is Unlisted — reachable by link, absent from the directory, sitemaps, and every index (FR-23),
**And** `discovery_state` persists separately from `result_visibility` (AD-5).

**Given** the creation form and the Poll detail,
**When** the listing control renders,
**Then** it reuses the `poll-option` single-select chooser — **Unlisted** ("reachable only by link; absent from Discover and sitemaps") and **Listed** ("appears on Discover and in sitemaps while the Poll is open") — with consequence lines beneath each (UX-DR12),
**And** the Creator can move between Unlisted and Listed at any time; discovery is presentation, not integrity.

**Given** a creator `poll-card` or Poll detail,
**When** it renders,
**Then** a label-caps-lg `listing-badge` shows the state as a word — `UNLISTED` in dim, `LISTED` in entropy, `DELISTED` in alarm — the word carrying the state, color only annotating (UX-DR12),
**And** only Discovery-module commands may write listing state (AR-1).

### Story 3.2: Discover Catalog & Sitemap

As a visitor,
I want to browse open public Polls and vote in one without ever receiving a link,
So that the platform is usable from a cold start (SM-8).

**Acceptance Criteria:**

**Given** `/discover`,
**When** it renders,
**Then** it lists only effectively open, Listed Polls, newest first, as unchanged `poll-card` rows — question, metadata line, live indicator, whole row one tap target — never a card grid (FR-23, UX-DR11),
**And** discovery cards contain only explicitly public fields and are served from a cache namespace separate from result responses (AR-17).

**Given** more Polls than one page,
**When** the catalog paginates,
**Then** `NEWER` / `OLDER` render as real links at 48px targets (~20 per page), the exhausted end dim and inert — never infinite scroll,
**And** loading renders skeleton rows without shimmer, an error keeps loaded rows with a retry and "The directory didn't load.", and an empty catalog reads "Nothing here yet. Polls appear when their Creators opt them in. Yours could be the first." with a create prompt.

**Given** the sitemap and robots endpoints,
**When** they are requested,
**Then** `sitemap.xml` contains Listed, effectively open Polls and the public surfaces only — Unlisted and Delisted Polls appear in no sitemap or index — and closing or unlisting a Poll drops it from the sitemap (FR-23).

### Story 3.3: Administrator Delisting

As the Administrator,
I want to remove any Poll from the public directory,
So that the directory stays worth browsing without touching anyone's Poll, Votes, or links.

**Acceptance Criteria:**

**Given** the Administrator (an application-level role on the internal user, not a separate auth surface),
**When** they delist any Poll,
**Then** it leaves Discover and the sitemap immediately but remains fully reachable by link, with ownership, Visibility Setting, and Vote data unchanged (FR-23, AD-5).

**Given** a Delisted Poll's Creator,
**When** they view the Poll detail,
**Then** the listing control renders read-only with the `DELISTED` badge and "Delisted by the Administrator. The link still works and Votes still count; the Poll no longer appears on Discover. Only the Administrator can reverse this.",
**And** only the Administrator can clear Delisted — the Creator's Unlisted/Listed control stays inert until then.

**Given** a Voter opening a Delisted Poll by link,
**When** the page renders,
**Then** it is indistinguishable from any other Poll — no banner, no notice; moderation is not the Voter's business (UX-DR19).

**Given** a non-Administrator Creator,
**When** they attempt a delist or clear-delist command,
**Then** it is denied server-side — moderation is an explicit capability, never inferred from ownership (NFR-3).

**Given** the Administrator capability itself,
**When** it is assigned,
**Then** assignment is a documented out-of-band operation (seed migration or console update against the internal user ID) — deliberately, no in-product grant surface exists (AD-4).

### Story 3.4: Landing Page

As a demo visitor,
I want the root URL to tell me what this is, how it's built, and where to go next,
So that within a minute I know whether to vote, browse, create, or read the code (UJ-5).

**Acceptance Criteria:**

**Given** a visitor at `/`,
**When** the page renders,
**Then** it opens with one Newsreader statement of what the platform is, followed by a short technical account of how it's built (Workers, D1, R2, Turnstile, Better Auth) in the monospaced instrument voice, the repository link, the create entry, and the link to Discover (FR-25, UX-DR26),
**And** the opening statement contains no stack vocabulary — the technical build account is a separate, following block — so the plain-language/technical split is checkable rather than aspirational.

**Given** any visitor,
**When** they want to act,
**Then** Discover and the sign-in/create entry are reachable from the landing page without a shared link (FR-25),
**And** the page holds the single-column, widen-don't-rearrange layout at every breakpoint (UX-DR25).

### Story 3.5: Demo Poll

As a demo visitor,
I want to cast a real vote on the landing page and watch the bars move,
So that the product demonstrates itself — no screenshot, no video, the actual thing (UJ-5's climax).

**Acceptance Criteria:**

**Given** the landing page,
**When** the pinned Demo Poll renders,
**Then** it is a complete, votable Poll inline — the same `poll-option` rows, vote button, trust badge, and `results-bar` group as any `/{link}` page, never a reduced version (UX-DR26),
**And** the Demo Poll ("Best day for a long weekend?", no Deadline) runs with CAPTCHA and Session Checks on and IP Checks off, so shared and CGNAT addresses are never falsely blocked (FR-26).

**Given** a returning visitor who already voted,
**When** the landing page renders,
**Then** the already-voted rejection renders inline with the live Tally beneath it — live bars, not a dead form.

**Given** the Creator on the Demo Poll's detail surface,
**When** they reset its Votes,
**Then** all Votes clear and the Poll passes through the normal empty state — zero-width bars, the empty-state line, no separate "resetting" state — so a visitor arriving mid-reset sees a Poll with no Votes yet, which is true (FR-26),
**And** the Demo Poll is designated by an explicit configuration reference to one Poll (mechanism chosen in-story and documented); the reset action appears only on the designated Poll's detail surface.

### Story 3.6: Presentable Repository

As a technical evaluator arriving from the demo,
I want the public repository to explain the product, the architecture, and how to run it,
So that the code itself completes the portfolio argument (FR-27, SM-6).

**Acceptance Criteria:**

**Given** the public repository,
**When** a technical reader evaluates it,
**Then** the README covers what the product is, why it exists, the stack, and how to run it locally, and architecture notes sufficient to evaluate the work are present (linking or summarizing the architecture spine's decisions),
**And** the landing page's repository link resolves to it (FR-25).

**Given** the full repository history,
**When** audited,
**Then** no secrets, tokens, or personal data exist in any commit (FR-27).

## Epic 4: Comments & Export

Voters humanize known-group polls with vote-attached comments (creator-moderated, per-poll disableable), and creators own their data via CSV/XLSX export.

### Story 4.1: Comment With Your Vote

As a Voter in a known-group poll,
I want to attach a short comment and my name to my vote,
So that the result carries a human voice, not just a count.

**Acceptance Criteria:**

**Given** a Poll with Comments enabled,
**When** the voting page renders,
**Then** one optional text field and one optional display-name field render as part of the Vote — never a separate submission — in the canonical reading order question → options → Comment → challenge → vote button, so the composer sits above the Turnstile challenge when one renders (FR-24, UX-DR13/17),
**And** the character cap (~500) counts down visibly only in the last 50 characters.

**Given** a Vote submitted with a Comment,
**When** it is accepted,
**Then** the Comment commits inside the same AD-7 transaction via the contribution port — one Comment maximum per Vote, no Comment possible without a Vote,
**And** the Comment passes the same Security Toggles as the Vote it belongs to (FR-24).

**Given** a Creator who disabled Comments on their Poll,
**When** the voting page renders,
**Then** the composer is entirely absent — no message, no placeholder (UX-DR18).

**Given** any Comment or display name,
**When** it renders on any surface,
**Then** it is plain text, escaped on render — Voter input can never execute as script (NFR-8).

### Story 4.2: Comment List & Moderation

As a Poll reader,
I want to read comments exactly where the Tally is visible — and as the Creator, to remove any that don't belong,
So that comments enrich results without becoming an unmoderated mess.

**Acceptance Criteria:**

**Given** a Poll with Comments,
**When** the Tally is visible to a viewer (per the Visibility Setting),
**Then** Comments render there too — newest first, body in `body-lg` with the display name above in label-caps (falling back to `ANONYMOUS`), no threading, no reactions, no avatars (FR-24, UX-DR13),
**And** where the Tally is withheld (After Close before close, Creator-Only for non-creators), Comments are withheld with it (AD-21).

**Given** the owning Creator viewing Comments,
**When** each Comment renders,
**Then** they see a delete affordance that no other reader sees; deleting opens the confirmation overlay (focus trapped, `Esc` closes, focus returns on close) and removal increments `representation_version` (UX-DR16, AD-24).

**Given** the Administrator,
**When** they view any Poll's Comments,
**Then** they can delete any Comment anywhere — a separate explicit capability, not creator permission (FR-1, NFR-3).

### Story 4.3: CSV Export

As a Creator,
I want to download my Poll's raw Votes and Tally as CSV,
So that my data is mine to keep and analyze.

**Acceptance Criteria:**

**Given** a signed-in Creator on their Poll detail,
**When** they activate the CSV export,
**Then** a direct download starts with no configuration dialog — one row per Vote (selections, timestamp, Comment and display name if present) plus the Tally (FR-22),
**And** the export is served only on the creator surface, only to the owning Creator (NFR-3).

**Given** any export,
**When** its contents are inspected,
**Then** no IP address, session identifier, digest, or any voter-identifying enforcement datum appears (NFR-4).

**Given** the export implementation,
**When** it produces rows,
**Then** row shapes come from each Poll Type's projection port (AD-3), so later types add their own shapes without reopening the exporter.

### Story 4.4: XLSX Export

As a Creator,
I want the same export as a spreadsheet file,
So that the data opens cleanly in Excel or Sheets without an import wizard.

**Acceptance Criteria:**

**Given** the Poll detail's export controls,
**When** the Creator activates XLSX,
**Then** a direct download produces a valid `.xlsx` containing the same rows and Tally as the CSV — identical data, identical privacy guarantees (FR-22, NFR-4).

**Given** the XLSX writer selected in this story (AR-21),
**When** it runs,
**Then** it executes inside workerd behind the export port, changing no domain or persistence rules,
**And** two plain buttons — CSV and XLSX — sit side by side on the creator surface (UX-DR13's export row).

## Epic 5: Ranked-Choice Polls

Communities run verifiable ranked votes: tap-to-rank ballots with automatic compaction, exact deterministic IRV with every Round displayed, and the Ballot Manifest anyone can recompute the winner from.

### Story 5.1: Cast a Ranked Ballot

As a Voter,
I want to rank options in my order of preference by tapping,
So that my full opinion counts — not just my first choice — with no drag-and-drop gymnastics.

**Acceptance Criteria:**

**Given** a Creator on `/creator/new`,
**When** they choose the Ranked-Choice Poll Type,
**Then** the type registers through the existing strategy contract (AD-3) — creation, shared settings, and lifecycle all behave as in Epic 1, with ballots persisted as normalized relational facts, never opaque JSON.

**Given** a Voter on a Ranked-Choice voting page,
**When** they tap an unranked option,
**Then** it takes the next available rank, shown in the marker gutter in entropy `data` type; tapping a ranked option unranks it and compacts every rank below so positions are never skipped (FR-8, UX-DR21),
**And** no gesture is required — ranking is tap-to-assign, keyboard `Space`-to-assign.

**Given** the summary line `RANKED {n} OF {total} · UNRANKED OPTIONS COUNT AS NO PREFERENCE`,
**When** any rank changes,
**Then** it posts exactly one polite live-region announcement of the new state, and each option's accessible name carries its rank and action ("Pizza, rank 2 of 4, activate to unrank") (UX-DR17/21).

**Given** a partial ranking (any subset, minimum one),
**When** submitted,
**Then** it is accepted as a valid Ballot; the vote button is disabled at zero ranks only (FR-8),
**And** the server independently rejects any Ballot ranking the same option twice or skipping rank positions — the control prevents it, the server enforces it.

### Story 5.2: Deterministic IRV Tabulation

As a Poll reader,
I want the winner computed by exact, reproducible instant-runoff rules,
So that the outcome can be defended — and recomputed — by anyone (SM-4).

**Acceptance Criteria:**

**Given** a set of accepted Ballots,
**When** the tabulator runs,
**Then** each Round counts every active Ballot toward its highest-ranked non-eliminated option; an option holding more than 50% of active Ballots wins and tabulation stops; otherwise the fewest-votes option is eliminated (FR-9).

**Given** a group of options tied for fewest,
**When** elimination is decided,
**Then** the group is batch-eliminated only when its combined votes are less than the next-lowest remaining option's votes (safe batch elimination); the worked check holds: with A=40, B=30, C=30, B and C are not batch-eliminated,
**And** an unsafe tie is broken backward — compared in the most recent earlier Round where the tied options differed, eliminating the option(s) with fewer votes there.

**Given** tied options identical in every completed Round,
**When** no backward tie-break resolves them,
**Then** tabulation halts and reports the Poll unresolved at that Round with standing counts and the tied options named — a terminal result styled as a result, never an arbitrary elimination and never an error (FR-9, UX-DR19).

**Given** a Ballot whose ranked options are all eliminated,
**When** subsequent Rounds run,
**Then** it becomes exhausted and leaves the active count, tracked per Round.

**Given** the same set of Ballots,
**When** tabulated any number of times,
**Then** the sequence of Rounds and the outcome are identical — no randomness anywhere (fast-check property tests cover determinism, safe batch elimination, and the majority invariant),
**And** exactly one pure tabulator serves the live view, the closed result, the export, and the tests (AD-9/AR-7).

### Story 5.3: Per-Round Display & Ballot Manifest

As a skeptical reader,
I want every Round shown and every anonymized Ballot published at close,
So that I can recompute the winner by hand — the result is shown, not asserted.

**Acceptance Criteria:**

**Given** a Ranked-Choice Tally,
**When** it renders,
**Then** the `round-table` shows every completed Round in sequence — per-option counts, who was eliminated, exhausted-Ballot counts — each Round carrying a one-line plain-language statement of the rule that produced its elimination, including batch elimination and the backward tie-break when they fire (FR-10, UX-DR22),
**And** eliminated options stay in the table struck through in `faint` from their Round onward, the winner's final-Round cell is gold, Rounds never collapse or paginate, and the unresolved state marks tied options with a 2px entropy left rule and no gold.

**Given** a Ranked-Choice Poll that closes,
**When** the Tally publishes,
**Then** the Ballot Manifest — every Ballot's rankings in canonical order, stripped of all voter data and timestamps — is available at `/{link}/manifest` wherever the Tally is visible, sufficient to independently recompute every Round and the outcome (FR-10, AD-9),
**And** the Manifest link sits directly beneath the Rounds, labelled plainly.

**Given** `/{link}/manifest` before close,
**When** requested,
**Then** it renders the not-yet shape — the question, "The Ballot Manifest publishes when the Poll closes — {deadline, local}.", and a link back to the Poll — a real route, not a 404 (UX-DR19).

**Given** the Creator's export on a Ranked-Choice Poll,
**When** it runs,
**Then** Ballot rows arrive through the type's projection port — one row per Vote with its full ranking — without the exporter itself changing (AD-3).

## Epic 6: Image Polls

Creators run visual polls with uploaded image options and captions, voting exactly like Multiple-Choice.

### Story 6.1: Upload Image Options

As a Creator,
I want to upload one image per option with a caption and alt text,
So that my Poll's choices are the pictures themselves.

**Acceptance Criteria:**

**Given** a Creator building an Image Poll on `/creator/new`,
**When** they upload an image per option,
**Then** JPEG, PNG, and WebP are accepted with a ~5 MB per-image cap enforced at upload (FR-11),
**And** uploads land at Poll-scoped temporary R2 keys, and an image becomes servable only after `CreatePoll`'s D1 batch adopts it — a failed creation leaves no reachable Poll and no adopted media (AD-12).

**Given** an option image missing its alt text,
**When** the Creator attempts to publish,
**Then** publication is blocked with the field named — the one place the creator surface blocks on an accessibility requirement, because a Voter cannot choose between images they can't perceive (UX-DR17).

**Given** an upload that fails,
**When** the form re-renders,
**Then** it shows "`{filename}` didn't upload. The rest of the form is intact — try that one again." with every other field and upload preserved (UX-DR18/19).

### Story 6.2: Vote on an Image Poll

As a Voter,
I want to compare image options and pick by tapping the picture,
So that choosing between visuals is direct — the image is the option.

**Acceptance Criteria:**

**Given** an Image Poll voting page,
**When** it renders,
**Then** each option is a square-cropped, square-cornered image plate at full column width with its caption below and the same marker gutter — the image is part of the tap target, never opening a lightbox (UX-DR2),
**And** each image renders with its alt text, and adopted images are served on both the voting page and results view (FR-11).

**Given** single- or multi-select configuration,
**When** a Voter selects and submits,
**Then** selection, bounds, submission, confirmation, duplicate rejection, and the Tally behave exactly as Multiple-Choice — same native inputs, same AD-7 transaction, same `results-bar` Tally (FR-11).

### Story 6.3: Media Cleanup Lifecycle

As Justin (site operator),
I want superseded, deleted, and abandoned images cleaned out of R2 automatically,
So that storage never accumulates orphans and deleting a Poll truly removes it.

**Acceptance Criteria:**

**Given** a Creator replacing an option's image before the first Vote,
**When** the replacement commits,
**Then** the D1 reference updates and the superseded R2 key is enqueued for cleanup in the same batch — every adopted media record singly owns an immutable R2 key (AD-12).

**Given** an Image Poll deletion,
**When** it executes,
**Then** self-contained cleanup keys are written to the outbox (no Poll foreign key) and the Poll plus all D1 children hard-delete in one batch — the link 404s immediately while R2 objects drain asynchronously (AD-12).

**Given** the same-Worker `scheduled()` handler,
**When** it runs every 15 minutes,
**Then** it drains due outbox rows idempotently and deletes unadopted temporary keys older than 24 hours; request handlers may invoke the same drain via `waitUntil`, but the Cron Trigger owns retries (AD-12).

## Epic 7: Meeting Polls

Friends pick a meeting time across timezones: slot builder, three-state availability grid in each Voter's local time, revisable responses, and yes-ranked totals that surface the best slot without auto-committing it.

### Story 7.1: Propose Time Slots

As a Creator,
I want to propose candidate time slots in my own timezone,
So that my group can react to concrete times instead of debating in the abstract.

**Acceptance Criteria:**

**Given** a Creator building a Meeting Poll on `/creator/new`,
**When** they add slots in the slot builder,
**Then** each row takes a date, start, and end in the Creator's timezone with that timezone stated explicitly, rows added one at a time (FR-12, UX-DR24),
**And** slots may fall on different dates and carry different durations within one Poll — with a minimum of two slots, since slots are the Poll's options (FR-12 via FR-5's rule), rejected 422 in the same idiom as the options minimum,
**And** slots persist as absolute instants (UTC ms) plus the Creator's IANA timezone, so daylight-saving transitions resolve at render (AR-19).

**Given** a slot whose end precedes its start,
**When** the form is submitted,
**Then** it re-renders 422 with "This slot ends before it starts. Check the times." inline and the rest of the form preserved.

**Given** a Meeting Poll with at least one Vote,
**When** the Creator views the slots,
**Then** they are locked entirely — slots are the Poll's options under FR-5's rule (FR-12).

### Story 7.2: Mark Availability

As a Voter,
I want to answer yes / if-need-be / no per slot in my own local time, under my name,
So that I answer in seconds without doing timezone math (SM-C1).

**Acceptance Criteria:**

**Given** a Voter opening a Meeting Poll,
**When** the grid renders,
**Then** each slot is a `radiogroup` of three named radios — Yes / If need be / No — with `Tab` moving between slots, arrows selecting within one, the slot's local time as the group's accessible name, and 48×48px cells carrying state as glyph plus fill together (`✓` gold on wash, `~` entropy on wash, `×` dim unfilled, `·` faint for unanswered) — never color alone, no cycle-on-tap (FR-13, UX-DR23).

**Given** a Voter in a different timezone than the Creator,
**When** slots render,
**Then** each shows the Voter's local time with the Creator's original as a caption subline ("created 15:00–16:00 EST"), a slot landing on a different calendar date is flagged with literal `+1 day` text tinted entropy, and a label-caps-lg line above the grid states the timezone in use with a manual override (FR-13's worked example is the literal contract, UX-DR24).

**Given** a submission,
**When** the Voter submits,
**Then** a display name is required (the grid is attributed), and `CreateMeetingResponse` creates one Vote, establishes duplicate claims, and passes the same Security Toggles as any Vote — returning a random first-party revision capability whose digest is stored with the Vote (AD-20/AR-16),
**And** the confirmation reads "Saved. Change it any time while the Poll is open."

### Story 7.3: Revise Your Availability

As a returning Voter,
I want to change my answers while the Poll is open,
So that a remembered conflict doesn't poison the schedule — without my revision counting as a second Vote.

**Acceptance Criteria:**

**Given** a Voter returning to an open Meeting Poll in the same browser session,
**When** the page renders,
**Then** their own row is pre-filled and editable — the only editable Vote in the product — while a different device renders as a new Voter (FR-13).

**Given** a revision submission,
**When** `ReviseMeetingResponse` runs,
**Then** it requires the stored revision capability, replaces only that Vote's availability rows, and increments `representation_version` — it never creates new duplicate claims and never redeems a Voter Code again (AD-20/AR-16),
**And** D1 triggers enforce effective-open state inside the transaction, so a revision against a just-closed or just-deleted Poll aborts cleanly.

**Given** a Poll that has closed,
**When** a returning Voter views it,
**Then** their row renders read-only with the closed message — revision ends at close.

### Story 7.4: Availability Grid Tally

As the Creator,
I want a Voters × slots grid with ranked totals,
So that the best slot appears from the answers — and I make the final call, not the system.

**Acceptance Criteria:**

**Given** a Meeting Poll Tally,
**When** it renders,
**Then** it shows the Voters × slots grid — Voter display names down the side, slots across the top, every cell a glyph and wash — with per-slot totals beneath in `data` type, computed server-side by SQL projection (FR-14, AD-9),
**And** below `lg` the grid renders one row per slot with three targets; at `lg` and up it becomes the true matrix (UX-DR25).

**Given** the slot ranking,
**When** totals are computed,
**Then** slots rank by count of *yes*, ties break by count of *if-need-be* (tie-break weight only, never a fraction of a yes), and slots still tied all take the 2px gold top rule together (FR-14).

**Given** any final state,
**When** the grid presents the best slot(s),
**Then** the system never auto-commits a meeting time — the grid informs, the Creator picks (FR-14),
**And** the Creator's own grid view always renders in the Creator's timezone, labelled, matching the slots as written (UX-DR24).

## Epic 8: Invite-Only & VPN Protection (Deferred)

Invite-only polls admit exactly the invited via one-time Voter Codes, and VPN Blocking rejects datacenter egress — built when the first real Poll needs them (PRD §7.4), completing UJ-4 and SM-3.

### Story 8.1: Generate & Manage Voter Codes

As a Creator running an invite-only vote,
I want to generate a batch of one-time codes and track their redemption,
So that I control exactly who can vote and know how many invitations are still live.

**Acceptance Criteria:**

**Given** a Poll with the Voter Codes Toggle on,
**When** the Creator generates N codes on `/creator/{link}/codes`,
**Then** the generate action disables with the label `GENERATING…` (no spinner), and the list appears in the code panel overlay — monospaced, one copy action for the whole set (FR-17, UX-DR16),
**And** the copy confirmation "`{n}` codes copied." renders in label-caps beside the action and persists until the panel closes — never a toast.

**Given** the code panel,
**When** it is open,
**Then** focus is trapped inside, `Esc` closes, the scrim is **not** click-to-dismiss (a stray tap must not lose an uncopied list), and focus returns to the invoking control on close (UX-DR16).

**Given** codes that have been redeemed,
**When** the panel renders,
**Then** a label-caps-lg line reads `{redeemed} OF {total} REDEEMED`, each redeemed code is struck through, and no voter data of any kind is shown against a redeemed code — only that it was used (NFR-4, UX-DR19),
**And** the Creator can generate additional batches at any time while the Poll is open; the list and the redeemed count reflect the combined set.

### Story 8.2: Vote With a Voter Code

As an invited Voter,
I want my code to admit exactly my one vote,
So that the invite list is the electorate — no more, no less (SM-3).

**Acceptance Criteria:**

**Given** a Poll requiring Voter Codes,
**When** a Voter opens it,
**Then** the question and options are fully readable without a code — only submission is gated — and the `input-code` field (20px, 0.3em tracking, uppercase, trimmed and upper-cased as typed) sits above the options, deliberately not autofocused (UX-DR14/19).

**Given** a submission with a valid unused code,
**When** the transaction runs,
**Then** redemption is an insert into `voter_code_redemptions` keyed uniquely by `code_id` inside the same AD-7 batch as the Vote — atomic, so concurrent submissions of one code yield exactly one accepted Vote, and exactly N Votes are possible from N codes (FR-17, AR-5, NFR-9).

**Given** a missing, invalid, or already-used code,
**When** submitted,
**Then** the Vote is rejected with the matching message — "This Poll needs a Voter Code…", "That code doesn't work on this Poll…", or "That code has already been used. Each one works exactly once." — and the Voter's entire ballot, including any ranking, survives intact (UX-DR18/19),
**And** codes are validated only server-side at submit, never on blur — a pre-submission "looks valid" check would be a lie,
**And** codes carry at least 40 bits of entropy — `[ASSUMPTION]` 8 characters from an unambiguous uppercase alphabet, hand-transcribable per `input-code`'s design — making enumeration infeasible under the permissive, best-effort rate-limit floor (AR-13).

**Given** the trust badge on a code-gated Poll,
**When** it renders,
**Then** `INVITE CODE REQUIRED` appears in the protection list (UX-DR7).

### Story 8.3: VPN Blocking

As a Creator running a high-stakes public poll,
I want votes from VPN and datacenter IPs rejected,
So that cheap anonymous ballot-stuffing gets harder — accepting that this protection is best-effort.

**Acceptance Criteria:**

**Given** a Poll with the VPN Blocking Toggle on,
**When** a Vote arrives from an IP identified as VPN/datacenter egress (best-effort: `request.cf` metadata and datacenter/ASN heuristics per the PRD addendum),
**Then** it is rejected at submit — never at page load; the Poll stays fully readable (FR-19, UX-DR19),
**And** the same request is accepted when the Toggle is off.

**Given** a blocked Voter,
**When** the rejection renders,
**Then** it reads "This Poll doesn't take Votes from VPNs or datacenter networks. The Creator turned that on to keep the count honest. Turning the VPN off and reloading should do it — and apologies if you weren't doing anything clever." — naming the mechanism and who enabled it (UX-DR18).

**Given** the feature's quality bar,
**When** it is evaluated,
**Then** "blocks obvious datacenter/VPN egress" passes and StrawPoll-grade coverage is explicitly not required — the Toggle is opt-in per stakes precisely because false positives on legitimate Voters are the worse failure (SM-C2),
**And** `NO VPN OR DATACENTER CONNECTIONS` appears in the trust badge when on (UX-DR7).
