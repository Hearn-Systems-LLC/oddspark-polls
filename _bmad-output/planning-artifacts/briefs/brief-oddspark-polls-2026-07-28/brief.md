---
title: oddspark-polls — StrawPoll replacement on Cloudflare
status: final
created: 2026-07-28
updated: 2026-07-28
---

# Product Brief: oddspark-polls

## What This Is

A personal polling platform at **polls.oddspark.dev**, running on Cloudflare, that replaces StrawPoll for Justin's own use. One creator (Justin), many voters — some invited privately by link, some arriving from public shares. It matches StrawPoll's core product where it matters and deliberately drops the parts that only exist to sell subscription tiers.

## Why

Justin periodically needs to run polls and wants a solid, trustworthy platform for them. StrawPoll has the right product, but the features that make polls trustworthy and shareable — CAPTCHA protection, custom links — sit behind a Pro tier at **$28/mo ($336/yr)**. Meanwhile, Cloudflare already provides the expensive parts for free: Turnstile is the CAPTCHA StrawPoll charges for, and Access covers creator auth.

Research confirmed no existing open-source project combines casual poll UX, vote-fraud prevention, meeting polls, and ranked choice in one package — the gap is real (see `addendum.md`).

## Users

- **Creator**: Justin only. No public sign-ups, no teams. Creator auth ensures nobody else can make polls on the domain.
- **Voters**: Two distinct audiences, selected per poll —
  - *Known small groups* (friends, colleagues, communities) reached by direct link, where trust is high and friction should be near zero.
  - *Public internet voters* from open shares, where duplicate voting and abuse are real threats.

This split drives the central design requirement: **security is a per-poll dial, not a global setting.**

## Feature Scope

### Poll types (full StrawPoll parity)
- Multiple choice — single- and multi-select
- Ranked choice with instant-runoff (IRV) tabulation
- Image polls (options are uploaded images)
- Meeting/date polls (Doodle-style availability grid)

### Vote security (per-poll toggles)
- IP + browser-session duplicate-vote checks
- Unique one-time voter codes for invite-only polls
- Cloudflare Turnstile CAPTCHA on the vote action
- VPN/datacenter-IP blocking for public polls

### Results & sharing
- Visibility controls per poll: live results, results after close, or creator-only
- Polls are unlisted — no public directory or browse index
- Deadlines with auto-close
- Live-updating bar/pie charts
- CSV/XLSX export of raw votes and tallies
- Custom readable poll links (e.g., `polls.oddspark.dev/team-lunch`)
- Comments — voters can leave one alongside their vote (likely beyond StrawPoll parity; see `addendum.md`)

### Explicitly out of scope
Teams/workspaces, ad handling, branding removal, email-invite quotas, embeds, webhooks/notifications, custom themes, public REST API, PDF export, custom domains beyond polls.oddspark.dev. StrawPoll itself lacks a public API and PDF export, so these are not parity gaps.

All four security pillars — no duplicate votes, unlisted polls, data ownership, creator auth — are non-negotiable.

## Platform & Constraints

- **Cloudflare end-to-end.** [ASSUMPTION] Workers for the app, D1 for poll/vote storage, R2 for image-poll uploads, Turnstile for CAPTCHA, Cloudflare Access for creator auth.
- **Data ownership.** All poll data lives in Justin's own Cloudflare account — no third party holds the poll history.
- [ASSUMPTION] Live results use polling or Durable Objects/WebSockets — the choice is deferred to the architecture phase; this brief requires only that results update without manual refresh.
- [ASSUMPTION] VPN blocking is heuristic (datacenter ASN/IP-reputation lists), accepted as best-effort rather than StrawPoll-grade — the one feature where parity is approximate.
- [ASSUMPTION] Target running cost is $0–5/mo (free tiers or the $5 Workers Paid plan).
- [ASSUMPTION] No migration of existing StrawPoll data is needed; the platform starts empty.

## Success Criteria

- Justin's next real poll runs on polls.oddspark.dev instead of StrawPoll, as does every poll after it.
- A publicly shared poll withstands a duplicate-voting attempt (IP/session/CAPTCHA verifiably block repeat votes).
- An invite-only poll using unique codes admits exactly the invited voters and no one else.
- Ranked-choice results tabulate correctly, including elimination rounds and ties.
- Monthly cost stays within the [ASSUMPTION] $0–5 target.

## Risks & Open Questions

- **Scope is large.** Four poll types plus a four-mechanism anti-cheat stack is weeks of work, not a weekend. [ASSUMPTION] Phasing is acceptable and belongs in the PRD; a suggested order is in `addendum.md`.
- **VPN blocking quality** — best-effort heuristics may frustrate legitimate voters; the per-poll toggle mitigates.
- **IRV tie-breaking and elimination rules** need explicit specification in the PRD, or results lose trustworthiness — the core value of the project.
- **Meeting polls are a different UX** (availability grids, timezones) and share little code with the other three types.
