# Review — adversarial-general — DW-119 `landing-footer` amendments

Lens: attack the design decision itself. What breaks or embarrasses this footer in
production, and what will a hostile reviewer flag in the implementing story?
Scope: the amendments to `DESIGN.md` (§ Layout & Spacing lg bullet; `public-repository-link`;
new `landing-footer`) and `EXPERIENCE.md` (IA row, four-entry paragraph, Component Patterns
rows, Responsive table, Poll-footer paragraph), reviewed against the full spines and the
current implementation (`src/components/landing-intro.astro`, `src/pages/index.astro`,
`src/components/public-repository-link.astro`).

## Per-category verdicts

- Decision soundness (a footer at all): **adequate.** Consolidating three orphaned action
  blocks plus attribution into one full-width band is defensible and matches oddspark.dev's
  idiom. The decision survives attack; the details below are where it bleeds.
- Copy & IA coherence: **broken.** The build-account sentence that anchors the repository
  link was not amended with the move, and the UJ-5 narrative still promises the link "right
  there" in the second paragraph.
- Landing-variant integration (demo-first / 503): **thin.** The amendment specifies the
  footer only for the happy path; the two variants the spine itself makes the most noise
  about are unaddressed, and the Responsive table now contradicts the demo-first ordering.
- Accessibility semantics: **thin.** `<nav>` wraps a non-navigation attribution, the nav is
  unlabeled, and the byline link's target height is unspecified against the system's own
  44px floor.
- Type & legibility (.78em wordmark, dim→text): **adequate.** Within the system's measured
  floors; one low finding on hover affordance subtlety.
- Responsive discipline (widen-don't-rearrange): **strong.** The footer renders at every
  width and only wraps — no component appears at lg, nothing hidden below sm. The lg-bullet
  edit correctly places it outside both columns at full shell width.
- Poll-footer conflict check: **strong.** The amendment explicitly fences the two footers
  apart (`EXPERIENCE.md:279-281`), keeps `VIEW THE PUBLIC REPOSITORY` on Poll surfaces, and
  reuses the shared `public-repository-link` seam. No rule collision.
- Story implementability: **thin.** Phase tagging and story ownership are inconsistent, and
  two render-critical decisions (503 footer, byline target height) are left to the
  implementer to guess.

## Findings

### [high] The orphaned sentence: "The code is public — see the repository."

`src/components/landing-intro.astro:16` — the build-account copy ends with "The code is
public — see the repository.", immediately followed by the `PublicRepositoryLink` the
amendment is evicting to the footer. Neither spine amends this sentence. After the move,
"see the repository" is a pointer with no proximate referent: in the demo-first
rejected-vote variant (`EXPERIENCE.md:217`, Demo region first inside `<main>`) the footer
sits below the *entire* votable Demo; in the 503 variant its presence is undefined (see
next finding). Worse, the spine's own rule — "no copy in the product describes where
anything is on the page" (`EXPERIENCE.md:283`, the lesson of "Results below") — is exactly
what this sentence now violates by implication. A hostile reviewer calls this the same
class of defect the spine already burned once.

*Fix:* in the same story, amend the build-account copy to end at "The code is public."
(the footer link carries the action), and record the copy change in `EXPERIENCE.md §
Voice and Tone` and the UJ-5 narrative, which still says technical readers "get the second
[paragraph] and the repository link" (`EXPERIENCE.md:435`) and that the link is "right
there" (`EXPERIENCE.md:438`).

### [high] The byline link has no target size; the 44px floor is silently exempted

`DESIGN.md:651` specifies 48px targets for the three entropy links and nothing for the
byline — an inline `{typography.body}` 14px text + `.78em` SVG link, which as specified
renders a ~20px-tall hit region. The system's floor is explicit: "Minimum 48px tap targets
on every voting-surface control … 44px elsewhere" (`EXPERIENCE.md:249`), and the sibling
repository entry is required to be "at least 44px high" (`EXPERIENCE.md:306`). The only
external attribution in the product — the link the business most wants clicked — is the
one link that fails the floor by default. An implementer following the spec literally
ships a WCAG 2.5.8 failure on the highest-traffic page.

*Fix:* add "the byline link carries a 44px minimum target" to the `landing-footer`
component entry, with the padding absorbed into the band so the visual line-height is
unchanged.

### [high] `<nav>` landmark wraps non-navigation content, unlabeled

`EXPERIENCE.md:177` — "A `<nav>` landmark below the landing grid … plus the Hearn byline."
The byline is attribution, not navigation; putting it inside `<nav>` means a screen-reader
landmark rotor announces the page's *only* navigation landmark (the header is explicitly
"brand chrome rather than shared navigation," `EXPERIENCE.md:61`) and its first item is an
off-site link to the builder's studio. That is both a semantics defect and, on a product
whose entire pitch is trust, a mild embarrassment: the "navigation" of the site leads
off-site. The nav is also given no accessible name, and the Poll-footer rules just above
state the repository entry "introduces no … new landmark navigation system"
(`EXPERIENCE.md:253-256`) — the landing footer now does exactly that, without the spine
saying why the asymmetry is intended.

*Fix:* make the band a `<footer>` (contentinfo) containing the byline and an inner
`<nav aria-label="Landing">` scoped to the three links; or drop the `<nav>` entirely and
let four links in a footer be links.

### [medium] 503 and demo-first variants: footer behavior undefined, and the Responsive table now contradicts the demo-first order

The 503 "Demo unavailable" variant (`EXPERIENCE.md:220`) renders "the complete Demo region
first inside `<main>`" with the line "The rest of Oddspark Polls is still here." — and the
footer's CREATE A POLL / DISCOVER POLLS links *are* the rest. The amendment never says the
footer renders on the 503 page, so the story must guess whether a private/no-store error
response carries chrome. Meanwhile the amended Responsive row (`EXPERIENCE.md:268`) asserts
one fixed order — "statement, then build notes, then the Story 3.5 Demo Poll, then the
`landing-footer`" — which directly contradicts the demo-first variant where "the complete
Demo region [is] first inside `<main>` … the statement/build/action blocks follow"
(`EXPERIENCE.md:217`). The footer row claims "after all main content in source and focus
order," which is the only variant-safe statement; the table row should defer to it.

*Fix:* one sentence in the `landing-footer` EXPERIENCE row: "Renders last in `<main>` in
every landing variant, including demo-first and the 503 Demo-unavailable surface." Reconcile
the Responsive table row to say "then the Demo Poll (first in the demo-first variant), then
the `landing-footer`."

### [medium] Phase and story ownership inconsistent: "Phase 3" component carrying Phase 1 content

`DESIGN.md:647` tags `landing-footer` "(landing page only, Phase 3)", while the IA row keeps
the landing page — footer included — in Phase 1 (`EXPERIENCE.md:39`), and the four-entry
paragraph says Story 3.4 (Phase 1) ships create/Discover/repository with the container move
attributed to "DW-119" (`EXPERIENCE.md:61`). An implementer cannot tell from the spines
whether DW-119 is a new story, an amendment to Story 3.4, or deferred to Phase 3 — and
"Phase 3" reads like a deferral signal on a feature described as just-added and approved.
This is precisely the kind of ambiguity that produces a half-built footer (links moved,
byline deferred, or vice versa).

*Fix:* align the phase tag with the IA table (or name the owning story explicitly in the
component heading, as other entries do).

### [medium] The only external link in the product points off-site, same-tab, from the highest-traffic page — and the risk is undocumented

The byline link to `https://hearn.systems` (`DESIGN.md:651`) is the product's sole external
attribution, on `/`, opening in the same tab with `rel="noopener"` (not `noreferrer` — every
visitor who clicks it leaks the landing URL as Referer to the builder's server; consistent
with the product's same-tab convention but worth a conscious choice on a privacy-pitch
product). The production-embarrassment scenario: `hearn.systems` lapses, is re-registered,
or serves a parked page, and the trust-pitch landing page now funnels visitors to it. No
spine or story currently owns monitoring or a removal path for that link. This is an
accepted-risk decision dressed as a spec detail.

*Fix:* the implementing story should record the same-tab/referrer choice as deliberate, and
either name an owner for the link's liveness or note the removal path in
`deferred-work.md`/the story's acceptance criteria.

### [low] `.78em` wordmark at dim: legible, but the hover lift is the system's weakest affordance

At `{typography.body}` 14px, `.78em` is a ~11px-tall wordmark in `{colors.dim-dark}` —
5.09:1 on void / 4.84:1 on panel (`DESIGN.md:438`), and `dim-light` holds the analogous
floor in light mode, so both modes are within the measured floor. The flagged weakness is
the hover: dim→text is a subtler delta than the entropy→text lift the footer links use, on
the smallest text in the band, with no underline. It matches oddspark.dev verbatim, which
is the amendment's defense, and it costs little.

*Fix:* optional — consider matching the byline hover to the entropy-link lift treatment or
adding the standard hairline underline on hover; at minimum, verify both modes in the
story's proof screenshots (which the story owes anyway).

### [low] Two repository labels for one destination

`VIEW REPOSITORY` in the landing footer vs `VIEW THE PUBLIC REPOSITORY` on Poll surfaces
(`DESIGN.md:637-639`). The shared-seam design is good; the label divergence is defensible
(the Poll label's extra words earn their keep off the landing context) but a hostile
reviewer will ask why one destination has two names, and `public-repository-link.astro:10`
already branches on `surface`. No change required — the story should simply not "unify"
them without a spine amendment.

*Fix:* none required; note in the story that the divergence is specified, not drift.

## Summary

The footer decision itself survives adversarial review: it consolidates scattered entries,
reuses existing idioms, respects the widen-don't-rearrange discipline, and is cleanly
fenced from the Poll footer. What fails is the seam work around it: the build-account
sentence orphaned by the move, the byline link's missing target size, the `<nav>` semantics,
and the undefined behavior in the two landing variants the spine treats as first-class.
All four high/medium items are one-paragraph spine amendments plus story acceptance
criteria — cheap now, embarrassing in production.
