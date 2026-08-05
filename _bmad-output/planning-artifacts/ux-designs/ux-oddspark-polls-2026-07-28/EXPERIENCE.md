---
name: Oddspark Polls
status: final
updated: 2026-08-04
sources:
  - /Volumes/fast/Github/oddspark-polls/_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md
  - /Volumes/fast/Github/oddspark-polls/_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/addendum.md
  - /Volumes/fast/Github/oddspark-polls/_bmad-output/planning-artifacts/briefs/brief-oddspark-polls-2026-07-28/brief.md
  - /Volumes/fast/Github/oddspark-polls/_bmad-output/planning-artifacts/briefs/brief-oddspark-polls-2026-07-28/addendum.md
  - oddspark.dev (live extraction, 2026-07-28) — .working/oddspark-desktop.png, .working/oddspark-mobile.png
---

# Oddspark Polls — Experience Spine

Requirements, journeys, glossary, and phasing are inherited by reference from the PRD and brief above. This document holds the experience decisions; `DESIGN.md` holds the visual identity. Where they overlap, `DESIGN.md` owns appearance and this file owns behavior. Both spines win on conflict with any referenced image or mock.

Component names in this file are the frontmatter token names from `DESIGN.md` — `poll-option`, `results-bar`, `availability-cell`, and so on — so a visual spec and a behavioral rule can be joined by name rather than by inference.

## Foundation

**Mobile-first responsive web**, one domain, `polls.oddspark.dev`. No native apps, no embeds, no custom domains (PRD §6).

**No UI system is named.** The sources name none, and the voter surface has a hard constraint against one: "No heavy client framework payload on the voter surface" (PRD §5). The voting and results surfaces are server-rendered HTML with a small amount of hand-written JavaScript — enough for selection state, the rank builder, the availability grid, the chart-form toggle, the Turnstile widget, the share enhancement, and the live-results subscription, and nothing more. There is no component library to inherit from, so `DESIGN.md § Components` is the whole component contract. `[ASSUMPTION: the creator surface, which is not bound by the payload constraint and is used only by authenticated Creators, may use heavier tooling if the architecture phase wants it — but it renders from the same tokens and looks like the same product.]`

**Three audiences** (PRD §2.1, §3 Glossary). What matters here is what each one implies for the design:

- **Creator** — anyone who signs in with Google or GitHub (Better Auth, FR-1). Sign-in is a rendered, in-product flow with a provider choice, not an infrastructure gate — see § Information Architecture and UJ-6. A Creator sees and manages only their own Polls; one Creator cannot touch another's. The **Administrator** (Justin, the site operator) is a Creator with one additional capability: delisting any Poll and deleting any Comment anywhere.
- **Voter** — anonymous, no account. Two contexts, one surface: the **Voter (known group)**, who should meet zero friction, and the **Voter (public)**, who should see that the Poll visibly resists ballot-stuffing. The difference between them is entirely a matter of which Security Toggles the Creator set — the voting page's structure is identical.
- **Demo visitor** — arrives from Justin's portfolio, a search, or the Discover catalog, and should conclude within a minute that this is a polished product worth using. Reads the landing page, becomes a Voter on the Demo Poll, and may go on to become a Creator.

**Both color modes ship**, following the OS preference with a manual override. See `DESIGN.md § Colors`.

## Information Architecture

Every surface below traces to a stated need; the journey column names the journey that lands there.

| Surface | Route | Reached from | Purpose | Journey | Phase |
|---|---|---|---|---|---|
| Landing page | `/` | Portfolio link, direct, search | What the platform is, how it was built, repo link, create entry, and Discover; the pinned Demo Poll joins in Story 3.5 (FR-25) | UJ-5, UJ-6, UJ-7 | 1 |
| Sign-in | `/sign-in` | Landing create entry, any creator route when signed out, an expired session | Google/GitHub OAuth choice (FR-1); returns the Creator to where they started, including mid-create | UJ-6 | 1 |
| OAuth callback | `/api/auth/*` | Provider redirect | Completes or abandons sign-in; denial or cancel returns to the sign-in entry with an explanation (FR-1) | UJ-6 | 1 |
| Discover | `/discover` | Landing page | Public catalog of open, Listed Polls, newest first, paginated, with accepted-Vote attendance but no Tally shape (FR-20, FR-23) | UJ-7 | 1 |
| Voting page | `/{link}` | A shared Poll link, Discover | Cast a Vote in this Poll; renders per Poll Type (FR-6, 7, 8, 11, 13) | UJ-2, UJ-3, UJ-4, UJ-7 | 1 |
| Vote confirmation | `/{link}` (post-submit state) | Submitting a Vote | Confirm the Vote landed; show or withhold the Tally per Visibility Setting (FR-20) | UJ-2 | 1 |
| Tally view | `/{link}/results` | Voting page, direct link | Live charts, Rounds, availability grid, Comments (FR-20, 21) | UJ-1, UJ-2 | 1 |
| Ballot Manifest | `/{link}/manifest` | Tally view, on close only | Published Ballots, rankings only, no voter data (FR-10) | UJ-4 | 2 |
| Creator — Poll list | `/creator` | Post-sign-in and post-create redirects | The signed-in Creator's own Polls, live and closed, with at-a-glance counts (FR-1) | UJ-1, UJ-6 | 1 |
| Creator — Poll creation | `/creator/new` | Poll list, landing create entry, return from sign-in | Question, options, Poll Type, Security Toggles, Visibility Setting, Discovery Setting, Deadline, Custom Link (FR-2, FR-23) | UJ-1, UJ-3, UJ-4, UJ-6 | 1 |
| Creator — Poll detail | `/creator/{link}` | Poll list row | Monitor, edit description, close, delete, export, moderate Comments, reset Demo Poll (FR-4, 5, 22, 24, 26) | UJ-1 | 1 |
| Administrator — Discovery moderation | `/creator/moderation` | Direct link, or return from the existing sign-in flow | Find exactly one Poll by its link or reference; Delist it from public enumeration or clear the hold without changing the Poll, Votes, owner, link, or Visibility Setting (FR-23) | UJ-1 | 1 |
| Creator — Voter Codes | `/creator/{link}/codes` | Poll detail | Generate N codes, view and copy the list for distribution (FR-17) | UJ-4 | Deferred* |
| Creator — Export | `/creator/{link}/export.csv`, `.xlsx` | Poll detail | Raw Votes and Tally download (FR-22) | UJ-1 | 1 |
| Slot builder | Section within `/creator/new` | Poll creation, Meeting Poll type | Candidate slots: date, start, end, in the Creator's timezone (FR-12) | UJ-3 | 3 |
| Image upload | Section within `/creator/new` | Poll creation, Image Poll type | One image per option, optional captions (FR-11) | UJ-2 (image ballot) | 2 |
| Public repository | External URL | Landing page, Poll footer | README, architecture notes (FR-27) | UJ-5 | 1 |

\* Voter Codes (FR-17) and VPN Blocking (FR-19) are "added when first needed by a real poll" (PRD §7). They are specified here because UJ-4 depends on them, but they are not Phase 1 surfaces.

**Route rules.** Custom Links live at the root path — `polls.oddspark.dev/team-lunch` (FR-3). Polls without a Custom Link get a short random ID at the same level. Because Polls occupy the root namespace, the reserved set must be rejected at Custom Link assignment: `/`, `/creator` and everything beneath it, `/discover`, `/sign-in`, `/assets/*`, `/api/*` (including the auth routes under `/api/auth/*`), `/favicon.ico`, `/robots.txt`, `/sitemap.xml`, and the two per-Poll sub-paths `results` and `manifest`. `[ASSUMPTION: `/creator` is the creator surface's path segment; the sources require only that it is reserved, not what it is called.]`

**Discovery is opt-in per Poll** (FR-23). `/discover` is the only public enumeration of Polls that exists: effectively open, Listed Polls, newest first, paginated. Every new Poll starts **Unlisted** — reachable by link, absent from the catalog, sitemaps, and indexes. The Creator can move a Poll between Unlisted and **Listed** at any time, as an explicit opt-in at creation or afterward; Listed Polls appear on Discover and in sitemaps while the Poll is open. The Administrator can **Delist** any Poll, and only the Administrator can clear Delisted. Unlisted and Delisted Polls remain reachable by link. The Poll list at `/creator` enumerates only the signed-in Creator's own Polls. The landing header retains the `polls.oddspark.dev` label, product title, tagline, and mode toggle as brand chrome rather than shared navigation. Its target four-entry discipline is the Demo Poll, repository, create entry, and Discover: Story 3.4 ships the latter three with no placeholder, and Story 3.5 inserts the real Demo Poll immediately after the build account.

**Administrator moderation is fixed and non-enumerating.** `/creator/moderation` is the only operator surface; there is no `/admin`, second login, all-Poll browser, moderation history, reason, appeal, or notification flow. The Administrator pastes one bare reference or same-origin, one-segment Poll URL. An alias resolves to the canonical target, and the result exposes only the escaped question, canonical voting link, effective open/closed state, and Discovery state. A successful `DELIST` or `CLEAR DELISTED` follows POST→303→GET with the canonical reference and one bounded outcome token. The redirected GET re-reads D1 before showing success, so the query string never asserts state by itself.

The lookup and action are ordinary server-rendered GET and POST forms and work completely without JavaScript. JavaScript may improve focus placement but owns no parsing, authorization, state transition, redirect, or success truth. Signed-out access uses the existing validated `/sign-in?return=/creator/moderation` flow; any signed-in non-Administrator receives a non-cacheable 403 before lookup, so target existence is never disclosed. Ordinary Creator and Voter journeys do not gain an operator control.

**Depth is two levels.** Landing → Poll, Discover → Poll, or Poll list → Poll detail. Nothing nests deeper. There are no modals except three confirmations (delete a Poll, delete a Comment, reset Demo Poll) and one panel (the Voter Code list), and none of them stack. The chart-form control on the Tally changes a view in place and is not a navigation step.

## Voice and Tone

The voice is **wry**: dry, understated, delivered flat. It is the voice of something that has watched a lot of polls happen and is not surprised by any of them. Aesthetic posture and the brand's personality live in `DESIGN.md § Brand & Style`.

**Two brace syntaxes appear in these spines and they are not the same thing.** `{path.to.token}` — a dotted path resolving against `DESIGN.md`'s frontmatter — is a design token reference and is never rendered to a user. `{deadline, local}`, `{slug}`, `{question}`, `{n}`, `{when}`, `{time}`, `{A}`, `{B}`, `{max}`, `{min}`, `{total}`, `{link}` — single undotted words, mostly in this section — are copy placeholders filled at render time. If it has a dot in it, it's a token.

**Principles**

1. **The joke is never at the Voter's expense.** A blocked or duplicate Voter is having a slightly bad moment. Wit at that moment lands as a sneer. The wryness in a rejection message points at the situation, or at the product, never at the person reading it.
2. **Clarity outranks the joke, always.** Every rejection says plainly *what happened*, *why*, and *whether the Voter can do anything about it*. If a sentence would be clearer without the wit, cut the wit. Trustworthiness is the product's core value (PRD §1); a cute error message that leaves someone confused about whether their Vote counted costs more than it earns.
3. **State facts, don't cheer.** "Counted." not "Thanks for voting! 🎉". No exclamation marks, no emoji, no second-person enthusiasm, no "Oops!".
4. **The system speaks about itself in the third person and doesn't apologise for working.** Duplicate blocking is the product doing its job, not an error.
5. **Name the Creator's choices as the Creator's choices.** When a protection turns someone away, say who turned it on. It is honest and it moves the frustration to the right address.
6. **Copy is layout-neutral.** A line that describes where something is on the page is wrong on half the breakpoints. Say *what* is happening, not *where* it is.

**Key moments**

| Moment | Copy |
|---|---|
| Vote recorded, results visible | **Counted.** Results are live, updating as they arrive. |
| Vote recorded, After Close | **Counted.** Results open when the Poll closes — {deadline, local}. You'll find out when everyone else does. |
| Vote recorded, Creator-Only | **Counted.** These results go to the Creator only. |
| Vote in flight | (button label only) **COUNTING…** |
| Vote submission failed | **That didn't land.** The Vote wasn't recorded and your ballot is still here, exactly as you left it. Try again — and if it keeps failing, the Poll will still be here in a minute. |
| Offline | **No connection.** Your ballot is safe on this page; nothing has been sent yet. |
| Availability saved (Meeting Poll) | **Saved.** Change it any time while the Poll is open. |
| Already voted — Session Checks | **You've already voted here.** Enthusiasm noted; the Tally is unchanged. |
| Already voted — IP Checks | **Someone on this connection already voted.** The Creator turned on one-vote-per-network, and it can't tell roommates apart. If that's you, ask them to send you the results instead. |
| Poll closed, results visible | **This Poll closed {when}.** The final Tally is below. |
| Poll closed, results hidden | **This Poll closed {when}.** Nothing further to decide. |
| Vote submitted after close | **This Poll closed while you were deciding** — {when}. Your Vote wasn't recorded. |
| VPN blocked | **This Poll doesn't take Votes from VPNs or datacenter networks.** The Creator turned that on to keep the count honest. Turning the VPN off and reloading should do it — and apologies if you weren't doing anything clever. |
| Voter Code missing | **This Poll needs a Voter Code.** The Creator hands them out; we can't issue one. |
| Voter Code invalid | **That code doesn't work on this Poll.** Check for a typo — codes are short and unforgiving. |
| Voter Code already used | **That code has already been used.** Each one works exactly once. Either someone got there first, or you did. |
| CAPTCHA failed | **The human check didn't pass.** Try it again — it's usually just a fluke. |
| Empty Poll, no Votes yet | **No Votes yet.** Yours would be the first, which is a kind of power. |
| Empty Poll, Voter has voted and is alone | **One Vote so far. It's yours.** |
| Results URL, After Close, Poll still open | **Results open when the Poll closes — {deadline, local}.** |
| Results URL, Creator-Only | **These results go to the Creator only.** |
| IRV unresolved tie | **Unresolved at Round {n}.** {A} and {B} are tied, and have been tied in every Round before this one. Rather than eliminate one at random, the count stops here. Standing counts below. |
| Rate-limited | **Too many Votes from here, too quickly.** Give it a minute. If you're a person, this shouldn't have happened, and we're sorry it did. |
| Comments disabled | (no message — the composer is simply absent) |
| Live connection lost | **Not receiving updates.** The counts shown are from {time}. |
| Live connection restored | **Updates resumed.** |
| Creator: no Polls yet | **No Polls yet.** The empty state, working as intended. |
| Creator: Custom Link taken | **`{slug}` is taken.** Pick another. |
| Creator: Custom Link reserved | **`{slug}` is reserved by the application itself.** Pick something less structural. |
| Creator: no options | **A Poll needs options.** Add at least two. |
| Creator: one option | **One option isn't a Poll.** Add at least one more. |
| Creator: Deadline in the past | **That Deadline has already passed.** The Poll would close before anyone saw it. |
| Creator: image upload failed | **`{filename}` didn't upload.** The rest of the form is intact — try that one again. |
| Creator: slot ends before it starts | **This slot ends before it starts.** Check the times. |
| Creator: delete confirmation | **Delete "{question}"?** This removes the Poll and all {n} Votes in it. The link stops resolving. There is no undo. |
| Creator: Toggle locked | **Votes are in.** Protections can tighten from here, not loosen. |
| Creator: options locked | **Locked — the first Vote has been cast.** The description is still yours to edit. |
| Creator: generating codes | **Generating {n} codes…** |
| Creator: codes copied | **{n} codes copied.** |
| Creator: codes redeemed | **{redeemed} of {total} redeemed.** |
| Sign-in cancelled or denied | **That didn't sign you in.** Nothing was created, and nothing was lost — the create form is right where you left it. |
| Session expired | **You've been signed out.** Sign back in to pick up where you left off. |
| Share: link copied | **Link copied.** |
| Discover: no listed Polls yet | **Nothing here yet.** Polls appear when their Creators opt them in. Yours could be the first. |
| Discover: failed to load | **The directory didn't load.** Try again — everything that was on screen is still there. |
| Creator: Poll delisted | **Delisted by the Administrator.** The link still works and Votes still count; the Poll no longer appears on Discover. Only the Administrator can reverse this. |
| Administrator: lookup and actions | **FIND POLL** · **DELIST** · **CLEAR DELISTED** |
| Administrator: invalid or empty submitted target | **Enter a valid Poll link or reference from this site.** |
| Administrator: target not found | **This Poll doesn't exist.** |
| Administrator: target load failed | **The Poll couldn't be loaded. Try again.** |
| Administrator: capability denied | **Administrator access required.** |
| Administrator: clear against a non-Delisted Poll | **This Poll isn't Delisted.** |
| Administrator: delist succeeded | **Poll delisted.** |
| Administrator: clear succeeded | **Delisting cleared.** |
| Administrator: persistence not confirmed | **The moderation change couldn't be confirmed. Reload before trying again.** |

**A note on the confirmation line.** "Results are live, updating as they arrive." is the canonical wording, chosen to be layout-neutral. The key-screen mocks surfaced that the earlier phrasing — "Results below, updating as they arrive" — is simply false at `{breakpoints.lg}`, where the Tally sits *beside* the confirmation in the two-column layout rather than below it. A responsive copy variant ("below" single-column, "beside" two-column) would also work and is rejected as more machinery than the sentence is worth.

## Component Patterns

Behavioral only. Visual specs live in `DESIGN.md § Components`, under the same token names used in the first column.

| Component | Surface | Behavioral rules |
|---|---|---|
| `poll-option` — Option row (single-select) | Voting page | Tapping anywhere on the row selects it; the whole row is the target, never just the marker. The row is a `<label>` wrapping a visually-hidden native `<input type="radio">`, so roles, checked state, group arrow-keys and `Space` come from the platform; the `◆` / `·` marker is a decorative `::before` and is not part of the accessible name. Selecting a new option deselects the previous one. Nothing submits on selection — the Vote is a separate deliberate action (FR-6). Zero selections leaves the vote button disabled with a `{typography.label-caps}` hint. |
| `poll-option` — Option row (multi-select) | Voting page | Same native-input construction with `<input type="checkbox">`. Tapping toggles. When a `max` is configured and reached, unselected rows go non-interactive with a `{typography.caption}` line above the group: `Pick up to {max}. {n} chosen.` When below a configured `min`, the vote button stays disabled and the same line reads `Pick at least {min}.` Bounds are re-enforced server-side; the client hint is a courtesy, not the check (FR-7). |
| `poll-option` — Image option | Voting page, Phase 2 | Identical selection behavior. The image is part of the tap target. Never opens a lightbox — the image is the option, not a gallery item. Alt text is required (see § Accessibility Floor). |
| `poll-option` — Visibility Setting chooser | Creator — creation | Three exclusive choices reusing the single-select row, with their consequences spelled out beneath each: Live ("anyone with the link watches the count move"), After Close ("Voters see a confirmation until the Poll closes"), Creator-Only ("only you ever see the Tally"). Changeable at any time, including after the first Vote — visibility is presentation, not integrity. `[ASSUMPTION: the tighten-only rule is scoped to Security Toggles; the sources place no lock on the Visibility Setting.]` |
| `results-bar` — Results bar | Tally view, vote confirmation | Renders instantly at final width on load and animates only on change. Order is fixed. Leadership is carried by the `◆` marker in the value cluster as well as by gold; `TIED` withdraws both. Full choreography is in § Live Results & Motion — this row exists so the component is findable from both spines, not to duplicate it. |
| `chart-form-toggle` — Chart form toggle | Tally view | Switches the Tally between `BARS` (default) and `PIE`. **Per-viewer and not persisted server-side**; `[ASSUMPTION: the choice does not persist at all — every fresh load starts on bars.]` `PIE` renders the same values as static percentages with a legend: no width animation, no spark, no count-up, **no leading-edge motion of any kind**, and the leader is carried by the `◆` marker in the legend rather than by movement. Live updates still arrive in the pie view; they land as a re-render at the new values, not as an animation. Switching back to `BARS` re-enters the animated form at current values without replaying anything. |
| `rank-builder` — Rank builder | Voting page, Phase 2 | Tapping an unranked option assigns it the next available rank; tapping a ranked option unranks it and **compacts the ranks below it** so positions are never skipped (FR-8). No option can hold two ranks and no rank can be duplicated, because rank is assigned by the control rather than typed. Partial Ballots are valid — a Voter may submit having ranked one option or all of them. The vote button is disabled at zero ranks only. Each option is a button whose accessible name states its rank and its action ("Pizza, rank 2 of 4, activate to unrank"), and every rank change posts one polite announcement of the new summary — the `RANKED {n} OF {total} · UNRANKED OPTIONS COUNT AS NO PREFERENCE` line is that live region. Without it, compaction is a silent bulk renumber and a screen-reader user would have to re-traverse every row to discover what changed. |
| `availability-cell` — Availability grid | Voting page, Phase 3 | **Each slot is a `radiogroup` of three named radios — Yes / If need be / No** — which is what the desktop layout already renders as three discrete targets. `Tab` moves between slots, arrows select within a slot, state is announced natively, and the group's accessible name is the slot's local time. The mobile layout is the same three radios in one row per slot; **cycle-on-tap is retired** — a four-step cycle that can land back on "unanswered" is slow, easy to overshoot, and has no honest ARIA state (`aria-checked="mixed"` would describe *if-need-be* as partially-yes, which it is not). Unanswered is the initial state and is reachable only by not answering. A display name is required before submitting, since the grid is attributed (FR-13). While the Poll is open, a returning Voter's own row is pre-filled and editable — this is the only Vote in the product that can be changed (FR-13). |
| `security-toggle` — Security Toggle | Creator — creation, Poll detail | Before the first Vote, freely on and off. After the first Vote, **tighten-only**: an off Toggle can still be switched on, an on Toggle is locked and cannot be switched off (FR-15). Locking is enforced server-side; the UI reflects it rather than implementing it. A new Poll opens with Session Checks on and everything else off (FR-15). Turning a Toggle on mid-Poll takes effect for subsequent Votes only and never invalidates a Vote already cast. The whole row is the hit area, name and description inside the `<label>`. |
| Live results subscription | Tally view, vote confirmation | Opens when a Tally renders and a Poll is open; closes on close, on navigation, and when the tab is hidden. No refresh button and no "new results available" prompt — updates arrive or the connection is reported lost (FR-21). See § Live Results & Motion. |
| `comment` — Comment composer | Voting page | One optional text field plus one optional display name, sitting directly above the vote button — part of the Vote, not a separate submission (FR-24). It cannot be submitted alone; there is no comment action on a Tally. Absent entirely when the Creator has disabled Comments. Character cap `[ASSUMPTION: 500]`, counted down only in the last 50. |
| `comment` — Comment list | Tally view | Read-only, newest first, no threading, no reactions. Visible exactly where the Tally is visible, per the Visibility Setting. The Creator sees a delete affordance on each; every other reader sees none (FR-24). |
| `input-code` — Voter Code entry | Voting page | A single uppercase field above the options. **Not focused on load** — autofocus would drop a screen-reader user into an edit field before the Poll question has been announced, on the surface where the question is the entire point, and the field sits above the options and is hard to miss anyway. Trimmed and upper-cased as typed. Validated server-side on submit, never on blur — a code is redeemed atomically with the Vote, so a "looks valid" check before submission would be a lie (FR-17). |
| `input` — Form field | Creator — creation, Poll detail; voting page | Validated on submit, never on blur, with the message inline beneath the field and the rest of the form preserved. Never a tooltip, never a modal, never a summary block at the top. The label above the field is always present — placeholder-as-label is not used anywhere. |
| `button-primary` — Vote button | Voting page | The "vote button" throughout this document is `button-primary`, and there is exactly one per screen. Disabled until the Poll Type's minimum is met, with a `{typography.label-caps}` hint above saying what unlocks it. On submit it becomes non-interactive and its label swaps to `COUNTING…`; a second activation cannot produce a second POST. It re-enables at its normal label on any failure. `button-secondary` and `button-destructive` appear only in overlays and on the creator surface, never as a competing action on the voting page. |
| `turnstile` — Turnstile widget | Voting page | Sits immediately above the vote button, below the Comment composer — the last thing before the action it protects. Rendered only when CAPTCHA is on for that Poll, and with `appearance: "interaction-only"`, so it is absent until a challenge is actually required. `theme` binds to the **resolved** color mode, including when that came from the manual override rather than the OS preference. Never blocks reading the Poll and never gates page load. Validated server-side (FR-18). Its chrome, focus ring, and announcements are Cloudflare's; see `DESIGN.md § Components → turnstile` for the sanctioned shape exception. |
| `trust-badge` — Trust badge | Voting page, Tally view | Lists the protections active on this Poll in the Voter's terms; absent entirely when every Toggle is off. Stacks one item per line rather than truncating when it doesn't fit. Full copy mapping and rules in § Trust Surfaces. |
| `poll-card` — Poll card | Creator — Poll list, landing page, Discover | The whole row is one tap target leading to Poll detail; there are no secondary actions inside the row and the live indicator is decorative rather than interactive. Sorted newest-created first with live Polls above closed ones `[ASSUMPTION: the sources don't specify an order]`. Closed Polls carry `CLOSED` and stay in the list — nothing is archived away. |
| `round-table` — Round table | Tally view, Phase 2 | Renders every completed Round in sequence, each with a one-line plain-language statement of the rule that produced its elimination, including the batch-elimination and backward-tiebreak rules when they fire (FR-9). Eliminated options stay in the table, struck through, from their Round onward — a reader checking the count by hand needs the rows that lost. Never collapses or paginates Rounds. |
| `overlay` — Overlay | Delete confirmations, Demo reset confirmation, Voter Code panel | Four exist and none stack. Focus moves into the panel on open and is trapped there; `Esc` always closes; the scrim is clickable to dismiss on the three confirmations and **not** on the Voter Code panel, where a stray tap would lose an ungenerated list. On close by any means, **focus returns to the control that opened it**. The page behind does not scroll while an overlay is open. |
| `live-indicator` — Live indicator | Voting page, Tally view, Poll card | Present whenever a Poll is open. Replaced in place by the lost-connection notice when the subscription drops, and restored on reconnection. Decorative — never a control. |
| Slot builder | Creator — creation, Phase 3 | Rows of date + start + end, added one at a time, in the Creator's timezone with the timezone stated. Slots may fall on different dates and carry different durations (FR-12). Locked entirely after the first Vote. |
| Export | Creator — Poll detail | Two buttons, CSV and XLSX, direct download, no configuration dialog. Available on the creator surface only (FR-22). |
| `share-action` — Share action | Create confirmation, voting page, Tally view | A text-labelled `SHARE` control sitting beside the Poll's canonical URL, which is always rendered as visible, selectable text — the no-JavaScript baseline is "the URL is right there; copy it," and the surface is fully functional without JavaScript by construction (FR-28). With JavaScript, the control invokes the Web Share API (the device's native share sheet) where available and copies the link to the clipboard otherwise, confirming with a `{typography.label-caps}` `LINK COPIED` line beside the control that persists until the next interaction — not a toast. The confirmation posts one polite live-region announcement, in the same idiom as the codes-copied confirmation. The action never gates the Tally behind sharing and never renders vendor-specific social buttons. On the voting surface it is a `button-secondary`, never a competing primary action. |
| `public-repository-link` — Repository entry | Landing build account; canonical public voting and non-404 Results | One shared presentation seam renders the exact public repository destination. On Poll surfaces it follows Share in source and focus order, opens in the same tab, works without JavaScript, and uses a text label with a 44px minimum target and the standard focus outline. The Poll footer is absent from the embedded landing Demo, 404, creator, auth, administration, and moderation surfaces. |
| `sign-in` — Sign-in entry | Landing create entry, `/sign-in` | Two full-width, text-labelled choices — `CONTINUE WITH GOOGLE` and `CONTINUE WITH GITHUB` — each a server-posted action, so sign-in works without JavaScript. Denial or cancel at the provider returns here with the § Voice and Tone line; nothing is created and nothing is lost. An expired session redirects here carrying a return address, and after re-auth the Creator lands back where they were — including mid-create. Because unsaved form content may not survive the round trip without JavaScript, the product prefers prompting sign-in **before** the create form rather than at publish time (FR-1). |
| `listing-control` — Discovery control | Creator — creation, Poll detail | At creation, an explicit opt-in reusing the `poll-option` single-select chooser idiom (like the Visibility Setting chooser): **Unlisted** (the default — "reachable only by link; absent from Discover and sitemaps") or **Listed** ("appears on Discover and in sitemaps while the Poll is open"). On the Poll detail, the same two-way choice with the current state shown as a `listing-badge`. The three states: **Unlisted** (link only; the default for every new Poll), **Listed** (on Discover while open), **Delisted** (removed from the directory by the Administrator; the control goes read-only with the delisted line, and only the Administrator can clear it). Changeable at any time — like the Visibility Setting, discovery is presentation, not integrity (FR-23). |
| `listing-badge` — Listing state badge | Creator — Poll list, Poll detail | A `{typography.label-caps-lg}` text badge — `UNLISTED`, `LISTED`, or `DELISTED` — on each creator `poll-card` and on the Poll detail. The word carries the state, never color alone; colors in `DESIGN.md § Components → listing-badge`. |
| `poll-card` — Discovery listing row | Discover | The `poll-card` pattern unchanged: question, metadata line (`MULTIPLE CHOICE · 122 VOTES · CLOSES IN 3H`), live indicator, whole row one tap target leading to the Poll. Discover shows only open, Listed Polls, so every row is live and none carries `CLOSED`. No secondary actions inside the row. |
| `pagination` — Pagination | Discover | Newest-first pages of fixed size `[ASSUMPTION: 20 per page; the sources don't specify]`. `NEWER` / `OLDER` text-labelled controls — real links, keyboard-operable, 48px targets — with the end-of-list control rendered dim and inert. Never infinite scroll (§ Interaction Primitives bans it). Loading renders skeleton `poll-card` rows at the correct count with no shimmer, matching the Tally's cold-load idiom; error renders the § Voice and Tone line with a retry, keeping any already-loaded rows on screen; empty renders the empty-catalog line with a create prompt. |

## State Patterns

*Rendered reference: [`mockups/key-voting.html`](mockups/key-voting.html) shows the live voting page in both modes; [`mockups/key-tally.html`](mockups/key-tally.html) shows the live Tally on a dark phone and a light desktop.*

| State | Surface | Treatment |
|---|---|---|
| Poll live | Voting page | Options interactive, vote button enabled, live indicator present, Deadline shown as a countdown under 24h and as a local datetime above it. |
| Submit in flight | Voting page | The vote button label swaps to `COUNTING…` and the button disables; the ballot, Comment, and every option row go non-interactive but stay fully legible. **No spinner** — the state is type, not an invented indicator. A second tap cannot produce a second POST. |
| Submission failed | Voting page | **The ballot is preserved exactly** — selection, ranks, availability, Comment text, display name, and typed Voter Code all survive. The failure message replaces nothing; it appears above the vote button, which re-enables at its normal label. A Voter never has to reconstruct a ballot the product lost. |
| Offline | Voting page | Detected on submit attempt and on the connection event. The message states that nothing has been sent, the ballot is held, and the button re-enables. The page is fully readable offline once loaded; only submission is affected. |
| Poll closed | Voting page | Options render read-only with no markers. No vote button. Closed message per § Voice and Tone. Tally below if the Visibility Setting allows (FR-4). |
| Poll deleted | Any Poll route | The link stops resolving — a plain 404 (FR-5). No tombstone, no "this poll was deleted" page; a deleted Poll leaves no trace, which is the point. |
| Visibility: Live | Tally view | Results visible to anyone with the link, before and after voting, updating without refresh (FR-20). |
| Visibility: After Close, Poll open, has voted | Vote confirmation | Confirmation only, **never the Tally** (FR-20). This surface shows the Deadline and no counts. If the Creator separately opted the Poll into Listed discovery, its Discover row may still show aggregate accepted-Vote attendance; that public total reveals no option, percentage, selection, round, or Comment shape. |
| Visibility: After Close, Poll closed | Tally view | Full Tally, Comments, and (Phase 2, Ranked-Choice) the Ballot Manifest, all published together at close. |
| Visibility: Creator-Only | Vote confirmation | Voter sees only that their Vote counted. The Tally is served to the authenticated Creator alone (FR-20). |
| Direct nav to `/{link}/results`, After Close, Poll open | Tally view | A page reusing the voter-confirmation copy — **"Results open when the Poll closes — {deadline, local}"** — with the Poll question and no vote affordances and no counts. `[ASSUMPTION: chosen over a 404 and over a redirect. It leaks nothing the Poll page at `/{link}` doesn't already leak — that the Poll exists, its question, and its Deadline — and it answers the reader's actual question instead of implying the link is broken.]` |
| Direct nav to `/{link}/results`, Creator-Only | Tally view | The same shape: question, **"These results go to the Creator only."**, no counts, no vote affordances. `[ASSUMPTION: as above.]` The authenticated Creator reaching the same URL gets the full Tally. |
| Direct nav to `/{link}/results`, no such Poll | — | Plain 404, identical to a deleted Poll. Nonexistence and deletion are indistinguishable by design. |
| Direct nav to `/{link}/manifest` before close | Ballot Manifest | The Manifest publishes only at close. Before then the route renders the same not-yet shape — question, the line **"The Ballot Manifest publishes when the Poll closes — {deadline, local}."**, and a link back to the Poll. Not a 404: the route is real and will resolve later. |
| Already voted | Voting page | Two independent causes, two distinct messages (FR-16): a Session Checks match says *this browser*, an IP Checks match says *this connection* — a Voter blocked by a roommate's Vote must not be told they personally already voted. Either way the rejection replaces the vote button, the Poll and options stay on screen read-only, and the Tally shows if the Visibility Setting allows. A duplicate Voter is not punished with a blank page. |
| Voter Code required | Voting page | Code field above the options; the Poll is fully readable without a code. Only the submission is gated. |
| VPN blocked | Voting page | Blocked at submit, not at load (FR-19). The Voter reads and chooses normally; the explanation appears in place of the confirmation. |
| CAPTCHA failed | Voting page | Selection and Comment text are preserved. The widget resets and the vote button re-enables. Never clears the ballot. |
| Rate-limited | Voting page | Selection preserved, vote button disabled for a short cooldown with the count visible. Should be unreachable by a human (PRD §5). |
| Out-of-bounds selection | Voting page | Prevented client-side by the bounds hint and rejected server-side. If it reaches the server, the ballot returns intact with the violated bound named. |
| Loading (Tally, cold) | Tally view | Skeleton bars at the correct count and height, filled to zero width, sitting on their `{components.results-bar.baselineRule}` hairlines with labels present, no shimmer. The hairline is what makes the skeleton visible at all — `void`→`panel` is 1.05:1 and a track alone would be a blank field. Resolves by painting final widths **without animation** — the animation belongs to change, not to arrival. |
| Empty Poll (no Votes) | Tally view | Bars at zero on their baseline rules with labels, plus the empty-state line. The chart's shape is visible before it has data, so the surface doesn't jump when the first Vote lands. |
| Voter's own ballot on the Tally | Tally view, vote confirmation | Rendered as a **text-only `YOUR BALLOT` line** — `{typography.label-caps}` label, choice in `{typography.body}` — never as echoed option rows carrying the gold `◆`. On the Tally the leader bar owns gold; two golds on one surface is the failure this rule prevents. See `DESIGN.md § Colors`, "Gold rarity, and the two-golds rule." |
| Chart form: pie | Tally view | Same values, static percentages, legend with the `◆` on the leader. No motion of any kind, including on live update. Bars remain the default on every fresh load. |
| IRV unresolved | Tally view, Phase 2 | All completed Rounds render normally; the final Round shows standing counts with the tied options marked and no winner declared (FR-9). This is a terminal state, not an error, and is styled as a result. |
| Live connection lost | Tally view | The lost-connection notice replaces the live indicator, stating the timestamp of the last known counts. Bars hold their last values and do not animate. Reconnection restores the indicator, announces once, and snaps to current values. |
| Landing page: Demo Poll live | Landing page | The pinned Demo Poll renders as a complete, votable Poll inline — the same `poll-option` rows, the same vote button, Share action, trust truth, and the same `results-bar` group. The options are `Friday`, `Monday`, `Either works` in that order, and the authorized live Tally before a Vote is real D1 truth, including the all-zero state. Not a screenshot and not a reduced version. In the embedded editable Demo, bars use entropy wash/edge, a unique leader keeps a non-gold `◆` plus accessible leading state, and exactly one trust badge lives with the ballot. Once read-only, canonical gold leadership and Tally-owned trust treatment return. |
| Landing page: Demo Poll already voted | Landing page | The already-voted rejection renders inline with the live Tally, exactly as it would on `/{link}`. A returning visitor sees the live bars rather than a dead form. Because this is outcome-bearing, the complete Demo region first inside `<main>` carries the focused rejection and leads the document title; the statement/build/action blocks follow once, without duplication. |
| Landing page: Demo Poll closed | Landing page | Should not occur — the Demo Poll has no Deadline `[ASSUMPTION]`. If it does, the closed state renders inline with the final Tally and no vote affordance. |
| Landing page: Demo Poll mid-reset | Landing page | A reset clears Votes (FR-26) and the Poll passes through the empty state. The empty-Poll line and zero-width bars on their baseline rules render as normal; there is no separate "resetting" state and no spinner. A visitor arriving mid-reset sees a Poll with no Votes yet, which is true. |
| Landing page: Demo unavailable | Landing page | Missing, malformed, unresolved, definition/security-drifted configuration or an initial Tally failure returns private/no-store `503` with the complete Demo region first inside `<main>`, title `Demo unavailable — Oddspark Polls`, focused heading `DEMO UNAVAILABLE`, body `The live Demo is unavailable right now. The rest of Oddspark Polls is still here.`, and secondary `TRY AGAIN`. It never guesses or exposes the failed invariant. |
| Landing page: JavaScript unavailable | Landing page | The Demo question, `Friday`, `Monday`, `Either works`, and current Tally remain readable. The ballot states `JavaScript is required for the human check on this Poll.` No Vote is accepted without server-side Siteverify proof; this surface has no CAPTCHA bypass or tokenless retry loop. |
| Creator: reset Demo confirmation | Creator Poll detail | This is the fourth confirmation. Server-open `?confirm=reset-demo` supplies title `RESET DEMO POLL?`, body `This permanently clears every Vote from the landing-page Demo Poll. The public link stays the same.`, real cancel link `KEEP VOTES`, destructive action `RESET VOTES`, and enhanced pending label `RESETTING…`. The no-JavaScript cancel/POST flow is complete. Verified success is `DEMO POLL RESET`; a typed URL or already-empty Poll cannot forge it. |
| Creator: empty Poll list | `/creator` | Empty-state line plus the create action. |
| Creator: creation validation | `/creator/new` | Validated on submit, inline beneath the offending field, everything else in the form preserved. Covers: no options, one option, a Deadline already past, a Custom Link taken or reserved, an image that failed to upload (Phase 2), and a slot whose end precedes its start (Phase 3). Copy for each is in § Voice and Tone. Never a summary error block at the top of the form and never a modal. |
| Creator: options locked | Creator — Poll detail | Question, options, and Poll Type render as read-only text with the locked message. Description stays an editable field (FR-5). |
| Creator: Voter Codes generating | `/creator/{link}/codes` | The generate action disables with the label `GENERATING…`, matching the vote button's in-flight idiom. No spinner. |
| Creator: Voter Codes copied | `/creator/{link}/codes` | One copy action for the whole set; on success a `{typography.label-caps}` confirmation appears beside it and persists until the panel closes. Not a toast — toasts are banned. |
| Creator: Voter Codes partly redeemed | `/creator/{link}/codes` | A `{typography.label-caps-lg}` line above the list reads `{redeemed} OF {total} REDEEMED`, and each redeemed code is struck through in the list. The Creator needs to know how many invitations are still live before deciding to generate more. No voter data is shown against a redeemed code — only that it was used (PRD §5). |
| Discover: loading | `/discover` | Skeleton `poll-card` rows — title-length text bars and metadata lines on their hairlines, at the correct count, no shimmer — resolving by painting real rows without animation, matching the Tally's cold-load rule. |
| Discover: empty | `/discover` | The empty-catalog line plus a create prompt. Not a dead end: the empty catalog is a recruiting surface for the next listed Poll. |
| Discover: error | `/discover` | The failure line with a retry action; any previously loaded rows stay on screen. |
| Creator: Poll delisted | `/creator`, Poll detail | The `DELISTED` badge with the moderation line; the listing control renders read-only. The Poll itself is unaffected — the link resolves, Votes count, the Tally obeys the Visibility Setting. |
| Visitor: delisted Poll by link | Voting page, Tally view | Renders exactly as any open Poll — delisting removes the Poll from the catalog and sitemaps, never from its URL. No banner, no notice to the Voter: moderation is not the Voter's business. |
| Administrator: initial lookup | `/creator/moderation` with no query | `ADMINISTRATOR`, `Moderation`, the explanatory line, one `POLL LINK OR REFERENCE` field, and `FIND POLL`; no target, outcome, or error. Reading and Tab order begin at the top with no forced focus jump. |
| Administrator: invalid or empty submitted lookup | `/creator/moderation` | The safe invalid-target line renders without echoing the rejected value. Focus moves to the alert; the form remains ahead of it in document order. Malformed, duplicate, oversized, unsupported-origin, credentialed, fragmented, or multi-segment input all use this state. |
| Administrator: target not found | `/creator/moderation` | Plain not-found copy, no partial target facts and no distinction between a missing and deleted Poll. Focus moves to the error line. |
| Administrator: target found | `/creator/moderation?target={canonical-reference}` | Escaped question as the focused target heading, then canonical voting link, `LIFECYCLE`, `DISCOVERY`, and one 44px text action: `DELIST` unless currently Delisted, otherwise `CLEAR DELISTED`. No owner, Visibility Setting, options, Tally, Comments, ballots, history, or reason. |
| Administrator: moderation succeeded | Canonical POST→303→GET | The redirect carries only canonical `target` and `outcome=delisted|cleared`. After fresh truth matches that token, focus moves to `Poll delisted.` or `Delisting cleared.`; a forged or stale token produces no success line. The refreshed target remains below it. |
| Administrator: persistence error or invalid clear | `/creator/moderation` after POST | The target stays in view, no success is implied, and focus moves to the exact error line. Reload precedes a retry when persistence was not confirmed. |
| Administrator: signed out | `/creator/moderation` | `303` to the existing sign-in entry with the validated return address `/creator/moderation`; no target is parsed first. |
| Creator: Administrator route forged | `/creator/moderation` | Non-cacheable `403` with `Administrator access required.` before target parsing or lookup. Owning the target Poll changes nothing. |
| Administrator: JavaScript unavailable | `/creator/moderation` | The GET lookup, strict POST action, canonical 303 redirect, fresh success/error render, and keyboard operation all remain complete. No spinner, toast, confirmation, or client-owned state is missing. |
| Session expired mid-create | Creator — creation | Redirect to the sign-in entry with a return address; after re-auth the Creator returns to the in-progress form. Without JavaScript, unsaved form content may be lost — which is why the create entry prompts sign-in up front rather than at publish time. |

## Interaction Primitives

- **Tap to act.** Minimum 48px tap targets on every voting-surface control (option rows, availability cells, the vote button, the chart-form toggle), 44px elsewhere. Rows are targets edge to edge.
- **No gesture is required for anything.** No swipe, no long-press, no drag. The rank builder is tap-to-assign specifically so that ranking works without drag-and-drop — drag is the conventional ranking interaction and it is a poor one on a phone and an inaccessible one everywhere.
- **Keyboard.** Every interactive element is reachable by `Tab` in reading order. Option rows are native radio/checkbox semantics and respond to `Space`; arrow keys move within a single-select group. `Enter` on the vote button submits. `Esc` closes the three confirmations and the code panel. There are no keyboard shortcuts — this is a surface people visit once.
- **Focus** is always visible: a 2px outline offset 2px in the focus-ring token, resolving per mode, never removed and never replaced with a color change alone. See `DESIGN.md § Colors`.
- **Public Poll footers follow the action they qualify.** On canonical voting
  and non-404 Results, the repository entry follows the Share block in both
  source and focus order. It introduces no script, focus jump, new landmark
  navigation system, or external-tab behavior.
- **Motion primitives.** Five, and only five: the `results-bar` width transition (`{motion.bar-transition}` on `{motion.ease}`), the leading-edge spark (`{motion.spark}`), the count-up (`{motion.count-up}`), the leader cross-fade (`{motion.leader-crossfade}`), and the live-indicator pulse (`{motion.pulse}`). Nothing else in the product animates — no page transitions, no fades on mount, no scroll effects, no skeleton shimmer, and nothing at all in the pie view.
- **Reduced motion** (`prefers-reduced-motion: reduce`) covers all five: widths snap, numbers snap, the spark is omitted, **the leader's fill and edge change color instantly rather than cross-fading**, and the live dot holds steady at full opacity. Every change of *state* survives; only the interpolation is dropped. Updating continues at full fidelity. Reducing motion must never reduce information.
- **Live-update cadence.** A Vote cast elsewhere appears in an open viewer's Tally within a few seconds and without a page reload (FR-21). The transport is the architecture phase's decision (PRD §9); the experience requirement is only that no one ever reaches for refresh, and that a broken connection announces itself rather than silently showing stale numbers.
- **Banned everywhere:** infinite scroll, carousels, toast notifications, hover-only affordances, auto-advancing anything, confirmation dialogs on non-destructive actions, "are you sure" on submitting a Vote, spinners, and any interstitial between opening a link and reading the question.

## Responsive & Platform

*Rendered reference: [`mockups/key-voting.html`](mockups/key-voting.html) at 375px; [`mockups/key-tally.html`](mockups/key-tally.html) shows both the phone single column and the desktop two-column Tally.*

| Breakpoint | Behavior |
|---|---|
| below `{breakpoints.sm}` (default) | One column. Landing: statement, then build notes, then the Story 3.5 Demo Poll; until then the actions follow the build notes with no empty slot. Voting: question, options, Comment, challenge, vote button, then Tally below. Availability grid becomes one row per slot with three targets per row. |
| `{breakpoints.sm}` to below `{breakpoints.lg}` | Same single column, wider margins, longer measure. No structural change. |
| `{breakpoints.lg}` and up | Two columns on exactly two surfaces: the post-vote Tally (ballot left, live bars right, so the Voter sees their choice and the movement at once) and the creator surface (Poll list left, selected Poll detail right). The availability grid becomes a true Voters × slots matrix. Everything else stays centered and single-column — a wider viewport buys air, not density. |

The layout **scales by widening, not by rearranging**. No component appears only at a large breakpoint and nothing is hidden at a small one; the desktop layout is the mobile layout with two blocks placed side by side, which is precisely what oddspark.dev does.

The moderation surface is one centered column at every viewport. On a phone the lookup field and `FIND POLL` stack; from the small breakpoint upward they share one row, while the target panel remains question → wrapping canonical link → two compact fact columns → action. Long allowed references wrap inside the measure, controls stay at least 44px high, and neither the 375px nor desktop silhouette permits horizontal overflow. The operator page uses the same light/dark tokens and adds no new component or token contract.

The public Poll footer stays inside the existing Poll measure at every
viewport. Mobile dark and desktop light use the same Share → repository order,
hairline rhythm, and one-column footer silhouette; the repository label wraps
if necessary rather than creating horizontal overflow.

Because the Tally can sit *beside* the confirmation rather than below it, **no copy in the product describes where anything is on the page** — see § Voice and Tone.

**The voter surface stays lightweight** (PRD §5). Server-rendered HTML, no framework payload, hand-written JavaScript only where interaction genuinely requires it: selection state, the rank builder, the availability grid, the Turnstile widget, the chart-form toggle, the share enhancement, and the live-results subscription. A Voter on a phone on a poor connection reads the question and votes without waiting for a bundle. Everything specified in this document must survive that constraint — if a pattern here can't be built inside it, the pattern is wrong, not the constraint.

## Accessibility Floor

Behavioral. Contrast values and the `faint`-token restriction live in `DESIGN.md § Colors`. The bar is the PRD's: "keyboard navigation, sensible contrast, alt text on Image Poll images" (PRD §5) — pragmatic craft, not formal WCAG certification `[ASSUMPTION, carried from PRD §10]`.

- **Keyboard.** Every action in the product is completable with a keyboard alone, including ranking (tap-to-assign is `Space`-to-assign) and the availability grid (each slot is a radiogroup: `Tab` between slots, arrows within a slot).
- **Focus order** follows reading order on every surface: question → options → Comment → challenge → vote. The four confirmations and panels are the only focus traps: delete Poll, delete Comment, Demo reset, and Voter Code panel. `Esc` always leaves; confirmation scrims dismiss while the code-panel scrim does not; **focus returns to the invoking control** when any closes, by any means; and the page behind does not scroll. Demo reset retains the same behavior in its server-open no-JavaScript baseline with `KEEP VOTES` as a real cancel link.
- **Post-submit focus and announcement.** Voting is a server round-trip on a server-rendered page, so a screen-reader user otherwise lands at the top of a fresh document and has to hunt for the result of the most consequential action in the product. On **every** post-submit render — Counted, already-voted, VPN-blocked, bad code, CAPTCHA failure, rate-limited, submission-failed — the outcome line is a `tabindex="-1"` element, is the first content in the main landmark, and **receives focus on load**. The document `<title>` leads with the outcome: `Counted — {question}`, `Already voted — {question}`. The `aria-live` region below does not cover this: it announces *changes* to an already-rendered region, not the state of a new document.
- **Native controls under decorative markers.** Option rows are visually-hidden native `<input type="radio">` / `<input type="checkbox">` elements with the row as the `<label>`; the `·` / `◆` / `[ ]` / `[×]` markers are drawn from the label's `::before` and are decorative. Without this the markers are spoken as punctuation — "middle dot, Pizza", "left bracket, times, right bracket, Pizza" — and every role, name, checked state, and group behavior has to be hand-built in ARIA.
- **Alt text on Image Poll images is required at upload** (FR-11, Phase 2). The Creator cannot publish an Image Poll with an image missing its alt text — this is the one place the creator surface blocks on an accessibility requirement, and it blocks because a Voter cannot choose between images they can't perceive. `[ASSUMPTION: the PRD requires alt text but not that its absence blocks publication.]`
- **Live results announce.** The Tally's totals line is an `aria-live="polite"` region announcing aggregate change — `122 votes` — not every bar on every update. Announcing each option's new percentage on every arriving Vote would make the surface unusable with a screen reader. `[ASSUMPTION: the sources don't specify live-region granularity.]`
- **Leader changes announce on the same region.** A leadership change is the product's climax and it is otherwise announced to nobody — a screen-reader user hears "122 votes… 123 votes…" and never learns the lead moved. Leader changes are rare relative to Votes, so: "Pizza now leading, 47 percent." `TIED` announces the same way when gold and the `◆` are withdrawn. This is additive to the aggregate line and does not reintroduce per-bar chatter.
- **Connection state announces both ways.** The lost-connection notice announces once, and reconnection announces once — "Updates resumed" — on the same polite region. A reader told the numbers are stale must also be told when they are fresh again. The notice itself renders in `{typography.label-caps-lg}` `{colors.text-dark}` rather than 11px `dim`: it is a warning, not structural annotation.
- **Rank changes announce.** Unranking compacts every rank below it in one silent bulk change; the `RANKED {n} OF {total}` line serves as a polite live region posting one summary announcement per change, and each option's accessible name carries its rank and its action.
- **State is never color alone.** Availability cells, Security Toggles, eliminated options, selected options, and **the leading bar** all carry a glyph or text label alongside their color. The leading bar is the least obvious of these: `solar-wash` and `entropy-wash` differ by 1.12:1 composited, so hue alone could not carry it and the `◆` does the work.
- **The empty and skeleton Tally are legible without tone.** Each `results-bar` sits on a 1px `rule` baseline, so the bar group reads as ruled bands whether or not it has data — `void`→`panel` alone is 1.05:1 and would render both states as blank fields.
- **Selection is announced with its consequence.** An option's accessible name includes its state and, on the Tally, its value: "Pizza, selected" / "Pizza, 47 percent, 122 votes, leading."
- **Every control has a text label.** No icon-only buttons anywhere in the product — including the chart-form toggle, which is the words `BARS` and `PIE`.
- **The new public controls meet the same floor.** The sign-in choices are text-labelled buttons that name the provider and the action (`CONTINUE WITH GOOGLE`); the share action is a text-labelled `SHARE` button whose `LINK COPIED` confirmation posts one polite announcement; the listing control is a native single-select choice at creation, with the current state carried as a text badge; pagination controls are real links labelled `NEWER` / `OLDER` at 48px targets. Nothing new is icon-only, keyboard-inaccessible, or conveyed by color alone.
- **The public repository entry is ordinary navigation.** Its word label is the
  accessible name; it is keyboard reachable after Share, at least 44px high,
  opens in the same tab, and keeps the tokenized 2px/2px focus treatment in
  both modes. No JavaScript is required to reveal or activate it.
- **Post-submit focus applies to the new flows too.** A returned-from-OAuth render — signed in, denied, or expired — follows the same contract as every other post-submit render: the outcome line is a `tabindex="-1"` element, first in the main landmark, focused on load, and the document `<title>` leads with the outcome: `Signed in — Oddspark Polls`, `That didn't sign you in — Oddspark Polls`.
- **Moderation focus follows the result.** Initial load leaves document reading order undisturbed. A valid lookup focuses the target question; a safe lookup or mutation error focuses its alert; the canonical post-action redirect focuses the freshly verified success line. Document order remains lookup field → `FIND POLL` → outcome/target → canonical link → `DELIST` or `CLEAR DELISTED`; after a focused success line, the next interactive targets are the canonical link and action. Every control has a visible tokenized focus outline and at least a 44px target, and the same server-rendered focus targets remain when JavaScript is unavailable.
- **The Voter Code field is not autofocused**, so the Poll question is announced before a screen-reader user is dropped into an edit field.
- **Third-party accessibility stops at the iframe.** The Turnstile widget's focus ring, contrast, and announcements are Cloudflare's. Binding `theme` to the resolved mode and `appearance: "interaction-only"` is the whole of what the product controls, and it is not restyled.

## Live Results & Motion

The signature of the product. `DESIGN.md § Components → results-bar` specifies the appearance; this is the choreography.

**The subscription.** A Tally on an open Poll subscribes on render. It closes when the tab is hidden and, on return, reopens and snaps to current values without replaying the changes it missed — a Voter coming back to a tab should see the truth, not a highlight reel.

**On a Vote arriving:**

1. The affected bar's width transitions to its new value over `{motion.bar-transition}`. Every *other* bar transitions simultaneously, because percentages move even when counts don't. One synchronized settle, never a cascade.
2. The changed bar's leading edge sparks — 2px to 4px and back over `{motion.spark}` — timed to start with the width transition, so the brightening reads as the cause of the movement.
3. Counts and percentages tick to their new values over `{motion.count-up}`. Monospaced digits mean nothing shifts position while they run.
4. The total line above the group ticks with them, and announces (see § Accessibility Floor).

**Coalescing.** If Votes land faster than one animation window, they merge into a single transition to the latest value. Animations never queue and never chain; the bar is always heading to the current truth, from wherever it currently is.

**Leader changes.** When the leading option changes, the new leader's fill and leading edge cross-fade blue → gold over `{motion.leader-crossfade}` while the deposed leader cross-fades gold → blue over the same duration, both concurrent with the width transition. The `◆` marker moves with the gold, appearing in the new leader's value cluster and leaving the old one. The lead visibly *moves* from one bar to another. On an exact tie for the lead, gold and the `◆` are withdrawn from every bar and the `TIED` label appears — the product never picks a winner it can't defend.

**Under reduced motion**, the leader change is instant rather than absent: the fill, the edge, and the `◆` all change on the frame. The state must survive; only the `{motion.leader-crossfade}` interpolation is dropped.

**Order never changes.** Bars stay in the option order the Creator authored, permanently. `[ASSUMPTION: no live re-sorting; the sources don't address it.]` Two reasons: reordering under a reader's eyes makes the surface unreadable at exactly the moment they're paying most attention, and a stable order is what lets someone check the numbers against the Ballot Manifest by hand (FR-10's "a reader can recompute the winner").

**The pie view does not animate.** When `{components.chart-form-toggle}` is set to `PIE`, updates arrive and land as a re-render at the new values — no width motion, no spark, no count-up, no cross-fade. Motion is the bar view's argument, and a rotating pie is not a substitute for it. Bars are the default on every load for exactly this reason.

**Idle is still.** When nothing is changing, nothing moves except the live dot. The stillness is what makes the movement mean something.

**The Voter's own moment.** On a successful submission, the confirmation and the Tally render together, and the Voter's own bar sparks. This is the one animation the product exists to deliver and it should be the first thing they see — and the outcome line takes focus as it renders, so it is the first thing they *hear*, too. Under reduced motion the same bar is simply already at its new value with the confirmation above it.

## Trust Surfaces

The PRD requires a public Poll to *visibly* resist ballot-stuffing (PRD §2.1) and names trustworthiness as the core value. That has to be legible on the page, not just true in the database.

**The trust badge.** Above the vote button, a `{typography.label-caps-lg}` line naming the protections active on this Poll, in the Voter's terms rather than the Creator's:

| Toggle | Reads as |
|---|---|
| Session Checks | `ONE VOTE PER BROWSER` |
| IP Checks | `ONE VOTE PER NETWORK` |
| Voter Codes | `INVITE CODE REQUIRED` |
| CAPTCHA | `HUMAN CHECK ON SUBMIT` |
| VPN Blocking | `NO VPN OR DATACENTER CONNECTIONS` |

**When every Toggle is off, the badge is absent entirely.** It does not say "no protections" — that is an invitation, and it also contradicts the frictionless-for-friends posture the all-off state exists to serve (PRD §8, SM-C1). Silence is the correct rendering of an unprotected Poll.

**The badge never truncates.** With two or more Toggles the line overflows a 375px viewport, so items stack one per line in order, each line holding the same left edge as the first. Abbreviating or eliding a trust claim would defeat the only thing the badge is for; see `DESIGN.md § Components → trust-badge` for the alignment spec.

**The badge persists onto the Tally**, so a reader evaluating the numbers can see what produced them. This is the trust surface's real job: it explains the Tally's provenance to someone who wasn't there when it was set up.

**Rules.**

- Never claim more than is true. No "verified", no "secure", no shield or lock iconography. The badge lists mechanisms; the reader draws the conclusion.
- Never display an IP address or a session identifier anywhere, to anyone, including the Creator (PRD §5). They exist only to enforce duplicate checks and appear in no export.
- Rejection messages are trust surfaces too. Every one names the mechanism that stopped the Vote and who enabled it (see § Voice and Tone). A rejection the Voter doesn't understand undermines the trust the mechanism was supposed to build.
- For Ranked-Choice Polls (Phase 2), the per-Round table and the Ballot Manifest are the strongest trust surfaces in the product. The Manifest link sits directly beneath the Rounds on close, labelled plainly, and the Rounds carry a one-line explanation of the rule that produced each elimination — including the batch-elimination and backward-tiebreak rules when they fire (FR-9).

## Timezone Handling

Meeting Polls only (FR-12, FR-13). Everywhere else in the product, times are rendered in the reader's local timezone with no ceremony.

- The Creator authors slots in the Creator's timezone, labelled explicitly in the slot builder. `[ASSUMPTION: slots are stored as absolute instants, so daylight-saving transitions resolve correctly at render rather than needing handling in the UI.]`
- A Voter sees every slot in their own device timezone, with the source time as a `{typography.caption}` subline: **`Thu 14 Aug · 21:00–22:00`** above **`created 15:00–16:00 EST`**. FR-13's worked example — 15:00 EST rendering as 21:00 for a CET Voter with the source timezone noted — is the literal contract.
- When local rendering lands a slot on a **different calendar date** than the Creator's, the shift is called out on the row rather than left for the Voter to notice: the literal text `+1 day`, tinted with the entropy accent. The words carry it; the color is decoration on top of them. This is the single most likely way a Meeting Poll produces a wrong answer.
- A `{typography.label-caps-lg}` line above the grid states the timezone in use — `TIMES SHOWN IN CENTRAL EUROPEAN TIME · FROM YOUR DEVICE` — with a manual override for anyone travelling or scheduling on someone else's behalf. `[ASSUMPTION: the override exists; the sources require only automatic local rendering.]`
- The Creator's availability grid always renders in the Creator's timezone, labelled, so that the grid the Creator reads matches the slots the Creator wrote.

## Key Flows

### UJ-1. Justin runs a public poll.

1. Justin opens `/creator` — he signed in with GitHub weeks ago and the session is still valid, so there is no sign-in step to perform. A signed-out Creator would pass through the sign-in entry first (see UJ-6).
2. He hits create. The form is one column: question, options added one row at a time, Poll Type, then Security Toggles with Session Checks already on.
3. He turns on CAPTCHA and IP Checks. Each explains what it costs the Voter as he flips it.
4. He sets Visibility to Live, sets a Deadline, and types `team-lunch` into the Custom Link field. It's free.
5. He publishes. There is no draft state — the Poll is live and accepting Votes the moment it exists (PRD §4.1). It is Unlisted by default, and he leaves it that way. The full canonical URL is on screen with the Share action beside it — one tap to open the native share sheet or to copy.
6. He shares the link and leaves the Tally open in a tab.
7. **Climax:** the first Vote lands. The bar's leading edge sparks, the width settles over half a second, the count ticks up, and every other bar shifts to accommodate it. Then another. Then two at once, coalesced into one movement. Nothing else on the page moves — the stillness around it is what makes the bars feel alive. Justin isn't monitoring a system; he's watching an opinion take shape.
8. The Deadline passes. The Poll auto-closes, the live indicator is replaced by `CLOSED`, and the final Tally stands. Export is one button away.

*Failure:* `team-lunch` is taken, or is a reserved path → inline message beneath the field per § Voice and Tone, everything else in the form preserved.

### UJ-2. A public voter votes once.

1. Priya opens the shared link on a phone. The question renders immediately — server-rendered, no framework payload, no interstitial.
2. Beneath it, tappable option rows. Above the vote button, the trust badge: `ONE VOTE PER NETWORK · HUMAN CHECK ON SUBMIT`. She knows what kind of Poll this is before she participates in it.
3. She taps an option. The row's marker goes gold. Nothing submits yet.
4. She adds a Comment — optional, right there, part of the Vote.
5. She passes the Turnstile challenge and submits. The button reads `COUNTING…` while the request is in flight.
6. The confirmation reads **Counted.**, takes focus, and the Tally renders with her own bar sparking. Her own choice is named on a `YOUR BALLOT` line; the gold on this surface belongs to whichever option is leading, not to hers.
7. Curious, she opens the link again in the same browser. The Poll and its options render as before, but the vote button is replaced by: *"You've already voted here. Enthusiasm noted; the Tally is unchanged."* The results are still visible below it.
8. **Climax:** she tries from a different browser on the same connection and is told that someone on this network already voted, and that the Creator enabled that. The counts below her haven't moved. The rejection is *legible*: she can see the mechanism, she can see it worked, and she can see the number it protected. This is the moment the product earns the word trustworthy.

*Failure:* Turnstile fails → the ballot and the Comment survive intact, the widget resets, she tries again. A network failure at submit behaves the same way: the ballot is held, nothing was recorded, and the button comes back.

**Image Polls ride this flow** (FR-11, Phase 2). The only difference is the ballot: option rows are square image plates with captions, alt text is present because the Creator could not publish without it, and the image is part of the tap target rather than a gallery item. Selection, Comment, challenge, submission, confirmation, and both duplicate-rejection paths are identical.

### UJ-3. Friends pick a meeting time. *(Phase 3)*

1. Justin creates a Meeting Poll and builds five slots in the builder — dates, start and end times, in his timezone, stated.
2. He leaves every Security Toggle off except the Session Checks default. No CAPTCHA, no codes. These are four friends.
3. He sends the link.
4. A friend in Berlin opens it. Above the grid: `TIMES SHOWN IN CENTRAL EUROPEAN TIME · FROM YOUR DEVICE`. Each slot shows her local time with Justin's original beneath it, and the Thursday-evening slot is flagged `+1 day` because in her timezone it isn't Thursday any more.
5. She enters her name and answers the five rows — yes, yes, if-need-be, no, yes — three targets per row, one tap each, no gestures, no drag.
6. She submits. **Counted.** Under a minute, zero challenges, exactly as SM-C1 requires.
7. She remembers a conflict, reopens the link, and finds her row pre-filled and editable. She flips one slot to no. This is the only Vote in the product that can be changed, and it changes without ceremony.
8. **Climax:** the grid fills in as the other three answer — Voters down the side, slots across the top, every cell a glyph and a wash. Beneath the columns, the totals, and above the winning column a gold rule. The answer isn't computed and announced; it *appears*, and Justin picks it. The system never commits the meeting time (FR-14).

*Failure:* two slots tie on yes and on if-need-be → both columns take the gold rule. Nothing is picked for him.

### UJ-4. An invite-only ranked-choice vote. *(Phase 2 + deferred Voter Codes)*

1. Justin creates a Ranked-Choice Poll for a community decision and turns on Voter Codes.
2. He generates 25 codes. The list appears in a panel, monospaced, one copy action for the whole set, with `0 OF 25 REDEEMED` above it. He distributes them out of band — the product sends nothing (PRD §6).
3. Marcus, holding one of the codes, opens the link. The question and options are fully readable; only the submission is gated. The code field sits above the options.
4. He ranks: tap an option, it takes rank 1; tap another, rank 2. He changes his mind and untaps rank 2 — the ranks below compact automatically, because a Ballot cannot skip positions (FR-8), and the `RANKED 3 OF 7` line announces the new state rather than leaving him to re-read the list. He ranks four of seven options and stops; a partial Ballot is valid.
5. He enters his code and submits. The code redeems atomically with the Vote — exactly 25 Votes are possible from 25 codes, no matter who submits when.
6. **Climax:** the Poll closes and the Tally shows every Round in sequence — per-option counts, who was eliminated, how many Ballots exhausted, and a plain sentence naming the rule that produced each elimination. Beneath it, the Ballot Manifest: every Ballot's rankings, no voter data, no timestamps. A reader can take the Manifest, run the rules by hand, and arrive at the same winner. The result isn't asserted; it's *shown*, and that is the whole argument for the product.

*Failure:* a used code → *"That code has already been used. Each one works exactly once."* The ranking survives, so a Voter with a second valid code doesn't rebuild it. If the count reaches a tie that persists through every completed Round, the Tally reports **unresolved** with standing counts and the tied options named, rather than eliminating one at random (FR-9).

### UJ-5. A visitor evaluates the demo.

1. Dana follows a link from Justin's portfolio to `polls.oddspark.dev`.
2. The landing page opens with one Newsreader statement of what the platform is, then a short technical account of how it's built — Workers, D1, R2, Turnstile, Better Auth — in the same monospaced instrument voice as the rest of the product. Non-technical readers get the first paragraph; technical readers get the second and the repository link (FR-25).
3. In Story 3.5, the Demo Poll joins below that, pinned and live: **"Best day for a long weekend?"** Not a screenshot, not a video — the actual product, votable from the landing page.
4. She sees `Friday`, `Monday`, `Either works` and the live Tally before a Vote. She votes. CAPTCHA on, Session Checks on, IP Checks off, so shared and CGNAT addresses don't lock out an entire office (FR-26). Without JavaScript the Poll stays readable and says `JavaScript is required for the human check on this Poll.`; it never pretends to accept a Vote without Siteverify.
5. **Climax:** the bars animate. That's it — that's the demo. Inside forty seconds of arriving, she's read what the product is, cast a real Vote, and watched a real live chart move, with the repository link right there for whoever wants to check the work.

*Failure:* the Demo Poll has drifted stale or lopsided → the Creator resets its Votes from the Poll detail surface (FR-26), and a visitor arriving mid-reset simply sees a Poll with no Votes yet.

The Demo Poll question is **"Best day for a long weekend?"** — a Multiple-Choice question that is universally answerable, needs no context, and is mildly seasonal, so a reset has a natural occasion. This closes PRD §9's second open question. `[ASSUMPTION: reset cadence — when the distribution goes stale or the season turns. The PRD leaves cadence open and this is a light guess rather than a requirement.]`

### UJ-6. A new creator signs in and publishes.

1. Maya runs a small bakery. She lands on `polls.oddspark.dev` — a friend sent her the Discover page — and hits the create entry on the landing page.
2. She isn't signed in, so the product asks first, before showing her a form: two text-labelled choices, Google or GitHub. She picks Google; the OAuth round-trip takes seconds. Asking up front is deliberate — an expired session mid-create can cost unsaved form content on a no-JavaScript render, so the product never lets her invest in a Poll she might lose.
3. Back on the create form, returned to exactly where she started, she writes **"Which muffin should we bake next?"** and adds four options.
4. The discovery control sits with the other settings: **Unlisted** is already selected — reachable only by link. She reads the consequence line under **Listed** — appears on Discover and in sitemaps while the Poll is open — and opts in. Her first Poll, and she'd like the foot traffic.
5. She publishes. The confirmation shows the full canonical URL with the Share action beside it. On her phone, `SHARE` opens the native share sheet and the link goes to her Instagram followers. On a desktop browser without the Web Share API, the same control would copy the link and confirm `LINK COPIED`. Either way the URL was on screen as text the whole time.
6. **Climax:** later, from `/creator` — her dashboard, her Polls only — she opens the live Tally and watches the first Votes land: the leading edge sparks, the width settles, the count ticks up. The muffin race is on, and it's hers.

*Failure:* she cancels at the Google consent screen → back at the sign-in entry with *"That didn't sign you in. Nothing was created, and nothing was lost."* No account, no Poll, no penalty. A session expiring mid-create would route through sign-in with a return address; the up-front prompt makes that case rare by design.

### UJ-7. A visitor discovers a poll to vote in.

1. A stranger browsing the site opens **Discover** from the landing page.
2. The catalog lists open, Listed Polls newest first — question, type, accepted-Vote attendance, closing time — each row one tap target. Attendance is public because the Creator opted into Listed discovery; no option/round counts, percentages, selections, or Comments cross that boundary. One looks fun; they open it. The catalog is the only enumeration that exists: everything Unlisted or Delisted stays reachable by link and invisible here.
3. The Poll renders exactly as a linked Poll would — question, options, trust badge, vote button. They vote in seconds. **Counted.**
4. On the results view they tap `SHARE`. The native share sheet opens — or, on a browser without it, the link copies with a confirmation — and the canonical link goes into a group chat, without leaving the page. The results were never gated behind the share; the share is just easy.
5. **Climax:** a friend from the group chat opens the link, votes, and the bar moves while both of them are watching. A Poll neither of them made is now their entertainment, and it took no account, no app, and no setup on either side.

*Failure:* Discover fails to load → the failure line with a retry, and anything already rendered stays on screen. An empty catalog renders the empty-state line and a create prompt — a recruiting surface, not a dead end.

## Inspiration & Anti-patterns

- **Lifted from oddspark.dev:** the entire visual and structural posture — one focal object on a dark field, hairlines instead of containers, monospaced instrument labels, generous stillness. The polls product is the same instrument pointed at a different subject, and the identity transfer is verbatim, not "inspired by." (One deliberate deviation: `dim` is lightened to clear the contrast floor. See `DESIGN.md § Colors`.)
- **Lifted from Doodle:** the availability grid, named upstream as the model (PRD §4.5, FR-13 — "matching Doodle's model"). Voters down the side, slots across the top, three states per cell, totals underneath, the human picks the winner.
- **Lifted from StrawPoll:** the poll-card simplicity — one question, tappable options, immediate results, no account, no setup, live from creation. This is the thing being replaced, and the thing worth keeping.
- **Rejected — the survey-form feel.** A named NFR: the product "reads as a casual poll card — one question, tappable options, instant results — never as a survey form. This is the exact gap no OSS alternative fills… and losing it would forfeit the product's category" (PRD §5). Concretely, this bans: multi-page or stepped voting, progress bars through a question set, section headings inside a Poll, required-field asterisks, "Question 1 of N", and any second question.
- **Rejected — upsell surfaces of every kind.** No tiers, no "upgrade for CAPTCHA", no plan comparison, no usage meters, no branding-removal offer, no vote quota. The product's entire competitive argument is that trust features are not a paid tier (BRIEF), and a single upsell affordance would forfeit it.
- **Rejected — dark patterns.** No pre-checked options, no confirm-shaming on cancel, no artificial urgency beyond the Creator's real Deadline, no email capture anywhere, no "share to see results" gate. The Tally is governed by the Visibility Setting and by nothing else.
- **Rejected — ad clutter and engagement machinery.** No ads, no related polls, no trending feed, no social buttons, no cookie banner beyond what the law actually requires (nothing is stated as required — PRD §5 has no regulatory requirements). Unlisted is the default and means what it says (FR-23): only Polls a Creator explicitly opts in appear on Discover, and a Delisted Poll comes off the catalog while staying reachable by link.
- **Rejected — celebration.** No confetti, no checkmark animation, no "thanks for voting!" interstitial. The results bar moving is the reward.
