# Reconciliation: Brief → PRD

**Inputs:** `briefs/brief-oddspark-polls-2026-07-28/brief.md` + `addendum.md`
**Targets:** `prds/prd-oddspark-polls-2026-07-28/prd.md` + `addendum.md`
**Date:** 2026-07-28

## Verdict

Coverage is high. Every poll type, every security mechanism, every results/sharing feature, every out-of-scope item, and all five success criteria from the brief have an identifiable home in the PRD, and the two strongest qualitative commitments — "friction should be near zero" for known groups and "security is a per-poll dial, not a global setting" — survive verbatim. Six gaps are worth closing before the PRD is finalized; two of them are internal tensions the PRD creates rather than things it forgot.

Excluded as known intentional deltas (per instructions, not reported as gaps): the public demo surface + open-source repo (§4.9, UJ-5, FR-25–27, SM-6), and IP Checks / Session Checks as independent Toggles (FR-16, five Toggles instead of the brief's four bullets).

---

## Gaps

### G1 — SM-3 is a primary success metric for a feature the PRD defers indefinitely (medium-high)

- **Brief location:** §Success Criteria, bullet 3 — "An invite-only poll using unique codes admits exactly the invited voters and no one else." Listed alongside the other four as an unconditional criterion for the project being done.
- **PRD:** SM-3 (§8, Primary) preserves the criterion and points at FR-17. But §7.4 puts Voter Codes in "Added when first needed by a real poll — built when a real Poll actually requires them, not speculatively." A primary success metric therefore depends on a feature that may never be built. The same structure applies more weakly to SM-4 (Ranked Choice, Phase 2), but Phase 2 is at least committed.
- **Note:** the brief's own addendum §Phasing endorses the demand-driven treatment ("Voter codes and VPN blocking when first needed by a real poll"), so the deferral is faithful — it is the *primary* classification of SM-3 that conflicts with it.
- **Suggested placement:** §8 — either demote SM-3 to a conditional/deferred metric ("when a Poll first requires Voter Codes…") or move FR-17 into a committed phase. State which, explicitly.

### G2 — Default states of the Security Toggles are never specified (medium-high)

- **Brief location:** §Users — "*Known small groups* … where trust is high and friction should be near zero"; §Feature Scope — the four security bullets. Brief addendum §Vote security records that StrawPoll ships **VPN blocking default on**, which is exactly the kind of default the brief's friction stance argues against.
- **PRD:** FR-2 says every setting is settable per Poll; FR-15 says each Toggle is independently enable/disable-able. Neither states what a newly created Poll starts with. Yet SM-C1 asserts a default as fact — "Security must never creep into known-group Polls by default — a friend votes in under a minute with zero challenges" — and no FR guarantees it. This is a testable behavior stated only in the metrics section.
- **Suggested placement:** FR-15 Consequences — add "A newly created Poll starts with all five Toggles off; enabling security is always an explicit Creator action." That makes SM-C1 verifiable and closes the loop with the brief's friction commitment.

### G3 — "Casual poll UX" / "poll-card UX" as a design commitment is dropped (medium)

- **Brief location:** §Why — "no existing open-source project combines **casual poll UX**, vote-fraud prevention, meeting polls, and ranked choice"; addendum §Options Considered rejects LimeSurvey specifically for having "no **poll-card UX**" and OpenVoter for being "election-methodology focus, not casual polling"; addendum conclusion — "Building this fills a genuine gap."
- **PRD:** the closest survivors are §6 "Not a survey platform: one question per Poll; no multi-page forms, logic, or branching" (which encodes the *absence* of survey weight) and the §5 Craft bar NFR (which encodes polish). Neither says the product should *feel* casual and lightweight — a quick card, not an instrument. The PRD addendum §Competitive grounding points back to the brief addendum for pricing but does not carry the OSS-gap conclusion, so the reason this product exists in an OSS sense is absent from the PRD entirely.
- **Why it matters:** this is the qualitative property most likely to be silently lost, because an FR list plus a Craft-bar NFR can be fully satisfied by a heavy, form-like UI. It is also the brief of record for the downstream UX phase.
- **Suggested placement:** two edits. (a) §5 Cross-Cutting NFRs — add a design-intent line: "Casual poll-card feel: creating and voting should read as a lightweight card, not a survey instrument; this is the differentiator against LimeSurvey/SurveyJS-class tools." (b) PRD addendum §Competitive grounding — one sentence carrying the brief's conclusion that no OSS project combines casual poll UX + vote-fraud prevention + meeting polls + ranked choice.

### G4 — The "four security pillars are non-negotiable" framing is missing (medium)

- **Brief location:** §Feature Scope, closing line — "All four security pillars — no duplicate votes, unlisted polls, data ownership, creator auth — are non-negotiable."
- **PRD:** all four exist individually (FR-16, FR-23, §5 Data ownership, FR-1), and §7.1 does place all four in Phase 1 — so nothing is currently violated. What is missing is the *priority* statement: that these four are not tradeable against scope, cost, or schedule. In a document whose §7 explicitly defers features and whose §5 makes cost a hard ceiling ("a feature that would breach this ceiling is out of scope by definition"), an unstated non-negotiable is the kind of thing a later phasing decision erodes without anyone noticing.
- **Suggested placement:** §1 Vision, after the trustworthiness paragraph, or as the opening line of §5 — name the four pillars as a set and mark them non-negotiable across all phases.

### G5 — Email invitations: excluded in the brief, silent in the PRD (low-medium)

- **Brief location:** §Explicitly out of scope — "email-invite quotas" (and addendum's tier table, where email invites are a headline StrawPoll capability at every tier: 50–50,000/mo).
- **PRD:** §6 Non-Goals lists teams, monetization, embeds/webhooks/notifications/API, themes/branding/domains, PDF, migration, surveys — but never email invites. "No notifications" arguably implies it, but does not say it. Meanwhile FR-17 has the Creator "view/copy the list [of Voter Codes] for distribution" without ever saying distribution is manual and out-of-product.
- **Why it matters:** email invites are how StrawPoll actually distributes per-participant codes. A reader comparing parity could reasonably assume delivery is in scope; a build phase could pick up an email dependency the brief deliberately excluded.
- **Suggested placement:** §6 — add "No email invitations or in-product delivery of any kind; Poll links and Voter Codes are distributed by the Creator through whatever channel they choose." Optionally echo in FR-17 Consequences.

### G6 — Brief assumptions hardened into PRD facts without being tracked (low)

- **Brief location:** §Platform & Constraints — both the Cloudflare stack (`[ASSUMPTION] Workers / D1 / R2 / Turnstile / Access`) and the target cost (`[ASSUMPTION] $0–5/mo`) carry explicit assumption tags.
- **PRD:** the PRD addendum states the stack under the heading "Platform stack (**confirmed in the brief**, for the architecture phase)" — but the brief did not confirm it, it assumed it. §5 states the cost ceiling as a flat NFR and strengthens it ("a feature that would breach this ceiling is out of scope by definition"). Neither appears in §10 Assumptions Index, and neither appears in the §10 confirmed-and-promoted footnote that tracks the other five promotions.
- **Why it matters:** §10's footnote is the audit trail for assumption→requirement promotions. Two promotions bypassed it, so a reader cannot tell whether the stack and cost were actually confirmed with Justin or silently upgraded.
- **Suggested placement:** §10 footnote — add the platform stack and the $0–5 ceiling to the "Confirmed 2026-07-28 and promoted to plain requirements" list, and change the PRD addendum heading from "confirmed in the brief" to "confirmed 2026-07-28". If either was *not* actually confirmed, index it in §10 as an assumption instead.

---

## Minor / informational (no action strictly required)

- **Custom image upload (poll header image).** Brief addendum §Not tier-gated lists it among StrawPoll's all-tier features. The brief's own scope list never claims it, and the PRD neither includes nor excludes it. Under the brief's "full StrawPoll parity" framing for poll types this is a small ambiguity; a one-line §6 exclusion would close it.
- **API/PDF parity rationale.** Brief §Explicitly out of scope justifies both with "StrawPoll itself lacks a public API and PDF export, so these are not parity gaps." PRD §6 keeps the parenthetical for PDF but not for the API. Cosmetic.
- **Brief risk register not carried forward.** The brief's four risks are all handled (scope→§7, VPN quality→SM-C2, IRV rules→FR-9, meeting-poll divergence→§4.5/§7.3). Nothing lost; noted only so the absence of a §Risks heading in the PRD is not mistaken for an omission.

## Verified present (spot-check of brief commitments)

Poll types: multi-choice single/multi (FR-6, FR-7), IRV (FR-8–10), image (FR-11), meeting (FR-12–14). Security: IP/session (FR-16), Voter Codes (FR-17), Turnstile (FR-18), VPN heuristic (FR-19, with best-effort caveat intact). Results: visibility three-way (FR-20), unlisted (FR-23), deadline auto-close (FR-4), live bar/pie (FR-21), CSV/XLSX raw+tally (FR-22), custom links (FR-3), comments flagged as beyond-parity (§4.8). Out of scope: all ten brief exclusions present in §6 except email invites (G5). Success criteria: all five map to SM-1–SM-5. Deferred decisions: live-results transport (FR-21 + OQ-1 + addendum), VPN mechanism (addendum), phasing order matches the brief addendum's suggestion exactly. Qualitative: "friction should be near zero" (§2.1), "per-poll dial, not a global setting" (§4.6), trustworthiness as core value (§1), "$28/mo Pro tier" economic argument (§1).
