# Addendum: oddspark-polls Brief

Detail that informs downstream documents (PRD, architecture) but doesn't belong in the brief body.

## StrawPoll Feature/Tier Inventory (researched 2026-07-28)

**Poll types (all tiers):** multiple choice (single/multi-select), image poll, ranked-choice poll (IRV), meeting poll.

| Feature | Free | Basic | Pro | Business |
|---|---|---|---|---|
| Price/mo (standard · annual promo) | $0 (ad-supported) | $8 · ~$4 | **$28 · ~$14** ($336/yr std) | $52 · ~$26 |
| Unlimited polls/participants | ✓ | ✓ | ✓ | ✓ |
| Ads removed | ✗ | ✓ | ✓ | ✓ |
| Ad-free votes/mo | — | 500 | 5,000 | 50,000 |
| Email invites/mo | 50 | 500 | 5,000 | 50,000 |
| Custom poll links | ✗ | ✗ | ✓ | ✓ |
| Custom themes | ✗ | ✗ | ✓ | ✓ |
| CAPTCHA protection | ✗ | ✗ | ✓ | ✓ |
| Remove StrawPoll branding | ✗ | ✗ | ✓ | ✓ |
| Shared workspaces | ✗ | ✗ | 1 (3 members) | 3 (10 members) |
| Custom logo in header | ✗ | ✗ | ✗ | ✓ |
| Custom CSS | ✗ | ✗ | ✗ | ✓ |
| Priority support | ✗ | ✗ | ✓ | ✓ |

*Ad removal appears capped by the ad-free vote quota row: votes beyond the monthly quota likely see ads (unverified).*

*Note: "StrawPoll Meetings" appears in some listings at the same annual prices as the tiers above — possibly the same product under a different marketing page. Treat these figures as a single unverified source, not confirmed pricing.*

**Not tier-gated** (all tiers): webhooks, email notifications, embeds, permissions system, custom image upload.

**Vote security (all tiers):** IP-duplication checking, unique per-participant codes, VPN blocking (default on). CAPTCHA is Pro and Business only.

**Results:** show immediately / after close / creator-only; deadline auto-close; live bar/pie charts.

**Exports:** CSV and XLSX. No PDF export.

### Absent from StrawPoll

Each item below is "not found in StrawPoll's public documentation" — evidence quality noted per item.

- **Comments** — no comments feature documented on the marketing or create pages (may exist undocumented). A vote-attached comment would be *beyond* parity, not a parity requirement.
- **Public REST API** — webhooks only; no REST endpoints documented.
- **Custom domains** — custom poll *links* only (path-level), not customer-owned domains.

## What's Actually Hard to Clone (research assessment)

- **Anti-cheat stack** is the real moat: IP-duplication checking + VPN/proxy blocking + per-participant codes + CAPTCHA gating. The poll UI itself is straightforward CRUD.
- **CAPTCHA**: StrawPoll's Pro-gated CAPTCHA is a paid third-party dependency for StrawPoll; Cloudflare Turnstile is free on this project's platform — the single biggest economic argument for the build.
- **Exports** are easy; a reliable webhook/API delivery system is not (and was cut from scope).
- **IRV tabulation** is a modest but nontrivial algorithm: elimination rounds and tie-breaking rules must both be specified explicitly.

## Options Considered: Open-Source Alternatives (rejected)

| Project | Coverage | Why rejected |
|---|---|---|
| Rallly | Doodle-style meeting polls, MIT-licensed, Docker-first | Schedule-polls only; no general polling, no ranked choice |
| LimeSurvey | Full survey platform, self-hostable | Survey-oriented and heavy; no poll-card UX; no anti-cheat/CAPTCHA vote security out of the box |
| OpenVoter | Formal voting methods (ranked choice) | Election-methodology focus, not casual polling; engine still maturing per its own README |
| SurveyJS | OSS form/survey UI library | A building block (BYO backend), not a turnkey poll app |

**Conclusion:** no OSS project combines casual poll UX + vote-fraud prevention + meeting polls + ranked choice. Building this fills a genuine gap.

## Phasing & Downstream Notes (parked)

- Phasing suggestion for PRD: multiple-choice polls + IP/session/Turnstile anti-cheat first; ranked choice and image polls as follow-on phases; meeting polls last, since the availability grid and timezone handling share little code with the other poll types. Voter codes and VPN blocking when first needed by a real poll.
- VPN blocking approach candidates: datacenter ASN lists, IP-reputation feeds, `request.cf` metadata on Workers.

## Sources

**StrawPoll features and pricing:** [pricing](https://strawpoll.com/pricing/) · [create](https://strawpoll.com/create/) · [Capterra listing](https://www.capterra.com/p/214974/StrawPoll/)

**OSS alternatives:** [selfh.st Rallly spotlight](https://selfh.st/post/20230220-rallly/) · [OpenVoter GitHub](https://github.com/robinrowe/OpenVoter) · [opensource.com Doodle alternatives](https://opensource.com/article/22/4/open-source-alternatives-doodle-polls)
