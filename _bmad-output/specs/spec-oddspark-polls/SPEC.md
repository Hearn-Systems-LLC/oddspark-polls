---
id: SPEC-oddspark-polls
companions:
  - ../../planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md
  - ../../planning-artifacts/prds/prd-oddspark-polls-2026-07-28/addendum.md
  - ../../planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Oddspark Polls

## Why

A pain, an opportunity, and a mandate combined. Pain: StrawPoll gates the features that make a poll trustworthy and shareable (CAPTCHA, custom links) behind a $28/mo Pro tier, while those same capabilities are free on the Cloudflare platform — so Justin's own polls need a replacement. Opportunity: open that replacement to everyone — small business owners, web developers, independent entrepreneurs, and millennial Internet nerds — who must be able to create, vote on, discover, and share Polls. Mandate: the site is a public demonstration of Justin's craft, with an open-source repository and a live Demo Poll. The core value is trustworthiness: results creators and voters can believe.

## Capabilities

- **CAP-CREATOR-SELF-SERVICE**
  - **intent:** Anyone can sign in with Google or GitHub and create, configure, monitor, close, and delete their own Polls.
  - **success:** A creator other than Justin completes sign-in, create, share, and vote collection with no operator involvement; unauthenticated creator-route requests are denied; one creator cannot mutate another's Polls.
- **CAP-VOTE-MULTIPLE-CHOICE**
  - **intent:** A voter answers a single- or multi-select Poll in seconds from a shared link.
  - **success:** Out-of-bounds submissions are rejected client- and server-side; the Tally reports per-option counts and voter count.
- **CAP-VOTE-RANKED-CHOICE**
  - **intent:** Voters rank options and the system computes a deterministic instant-runoff winner with per-round transparency.
  - **success:** Identical Ballots always yield identical Rounds; anyone can recompute the outcome from the per-Round display and the published anonymized Ballot Manifest.
- **CAP-VOTE-IMAGE**
  - **intent:** A creator can run a Poll whose options are uploaded images with optional captions.
  - **success:** Images are served on voting and results views; format and size caps are enforced at upload.
- **CAP-VOTE-MEETING**
  - **intent:** A group finds a meeting time by marking yes/no/if-need-be across proposed slots, each voter in their own timezone, revisable while the Poll is open.
  - **success:** Slots render in voter-local time; the grid ranks by yes count with if-need-be tie-break; a voter revises their own availability without a duplicate Vote.
- **CAP-VOTE-SECURITY**
  - **intent:** Per-Poll Security Toggles (IP Checks, Session Checks, Voter Codes, CAPTCHA, VPN Blocking) compose independently to match each Poll's stakes.
  - **success:** Concurrent submissions never produce more accepted Votes than the rules allow; code redemption is atomic; toggles are tighten-only after the first Vote; new Polls default to Session Checks only.
- **CAP-RESULTS**
  - **intent:** Creators and permitted viewers see server-computed, live-updating Tallies, and creators can export raw data.
  - **success:** A Vote appears in open viewers' charts without reload; Live / After Close / Creator-Only visibility is enforced; CSV and XLSX export is available on the creator surface.
- **CAP-DISCOVER**
  - **intent:** Anyone can browse open listed Polls; creators opt Polls into the directory; the administrator can delist.
  - **success:** A new Poll never appears in discovery without explicit opt-in; the directory shows only effectively open listed Polls; delisting preserves ownership, visibility, and Vote data.
- **CAP-SHARE**
  - **intent:** Anyone can share a Poll from its create-confirmation, voting, and results surfaces.
  - **success:** A visible, text-labelled Share action with native share sheet and copy fallback exists on all three surfaces; the canonical URL never changes; results are never gated behind sharing.
- **CAP-COMMENTS**
  - **intent:** A voter can attach one plain-text Comment to their Vote.
  - **success:** At most one Comment per Vote under the Vote's Security Toggles; Comments follow Tally visibility; the creator or administrator can delete any Comment.
- **CAP-DEMO-SURFACE**
  - **intent:** A visitor can evaluate the product and its craft via the landing page, a live Demo Poll, and the public repository.
  - **success:** The landing page explains the product and links the repository, Discover, and the create entry; the Demo Poll is votable by any visitor with CAPTCHA and Session Checks.

## Constraints

- Cloudflare end-to-end (Workers, D1, R2, Turnstile, Better Auth with Google/GitHub); total fixed platform cost stays within USD 0–5/month — any feature breaching the ceiling is out of scope by definition.
- Voters are always anonymous; no voter accounts, and voter identifiers persist only as secret-keyed digests used solely for duplicate checks — never displayed, exported, or logged.
- Every new Poll is unlisted by default; listing is an explicit creator opt-in; discovery never exposes a Tally the Poll's Visibility Setting restricts.
- All Tally computation is server-side from retained raw Vote facts; ranked-choice tabulation is fully deterministic with a published anonymized Ballot Manifest.
- Voter-facing surfaces are lightweight, server-rendered, and mobile-first; no heavy client framework payload; the product reads as a casual poll card, never a survey form.
- All Poll and Vote data lives in Justin's own Cloudflare account; no third party holds poll history.
- Architecture invariants AD-1 through AD-24 (hexagonal modular monolith, D1-owned facts, single Vote transaction, digest privacy, CSRF boundary, outbox media cleanup) bind every implementation; see the adopted `ARCHITECTURE-SPINE.md` companion.

## Non-goals

- Teams, workspaces, or roles beyond the single Administrator.
- Monetization of any kind — no ads, tiers, or billing.
- Embeds, webhooks, notifications, or a public REST API.
- Custom themes, branding, or domains beyond polls.oddspark.dev.
- PDF export.
- Email invites, automated distribution, or vendor social buttons.
- Migration of existing StrawPoll data.
- Multi-question survey features — one question per Poll.

## Success signal

Justin's next real poll runs on polls.oddspark.dev instead of StrawPoll (Phase 1 gate). A publicly shared Poll verifiably withstands a duplicate-voting attempt (Phase 1 gate). A creator other than Justin completes the self-service loop unaided (Phase 1 gate). Ranked-choice results are recomputable by hand from the per-Round display and Ballot Manifest (Phase 2 gate). A Voter finds and votes in a Poll through Discover without receiving a link.

## Open Questions

- Creator account deletion: what happens to a deleted creator's owned Polls and their Vote data is unspecified in both the PRD and the architecture spine; must be decided before public launch.
