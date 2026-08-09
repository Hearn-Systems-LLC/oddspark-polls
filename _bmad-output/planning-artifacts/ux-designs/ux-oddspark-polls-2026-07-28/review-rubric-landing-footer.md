# Review — Rubric lens: DW-119 `landing-footer` amendments

Scope: mechanical coverage of the amendments to `DESIGN.md` and `EXPERIENCE.md`
(diff vs. committed spine). Reviewed against both full spines, the components
frontmatter block, and the DW-119 ledger entry. No edits made.

*Update: both high findings below were resolved in the spines after this review
was written; resolution notes inline. Verdicts reflect the state at review time.*

## Per-category verdicts

| Category | Verdict |
|---|---|
| Token resolution (`{…}` references in new text) | **thin** → resolved — all color/type/spacing/breakpoint tokens resolved; `{components.landing-footer}` (2 uses) resolved to nothing, now downgraded to backticks |
| `landing-footer` naming & dual-file specs | **adequate** → strong — name consistent everywhere; real specs in both files; the phase-tag contradiction is fixed |
| Canonical order & spine voice | **strong** — inserted adjacent to `public-repository-link` in both files; voice matches |
| Bloat check on new prose | **adequate** — spec-dense, two jargon/loose phrases |
| Cross-file consistency (4 EXPERIENCE spots vs. DESIGN) | **adequate** — IA row, discipline paragraph, Component Patterns row, both Responsive rows + Poll-footer paragraph all agree with DESIGN on geometry, labels, a11y, and wrap behavior; phase and one dangling reference leaked through (phase since fixed) |

## Findings

### [high — RESOLVED] `{components.landing-footer}` is a dangling token reference
`DESIGN.md:510` and `DESIGN.md:637`. Every other `{components.X}` reference in
the spine resolves into the `components:` frontmatter block (e.g.
`{components.share-action.confirmationLabel}`, `{components.pagination}`,
`{components.overlay.scrimDark}`). The frontmatter block has no
`landing-footer` entry (checked lines 156–402). `public-repository-link` is the
precedent for a heading with no frontmatter — and prose refers to it with
backticks, never `{components.public-repository-link}`. An implementer (or a
token-checking tool) following the reference hits nothing.
*Fix:* either add a `landing-footer:` frontmatter block (link typography/color,
48px minHeight, focusOutline, byline gap — mirroring `pagination:`) or downgrade
both references to backtick `` `landing-footer` `` naming.
*Resolution: both references downgraded to backtick `landing-footer` per the
public-repository-link precedent.*

### [high — RESOLVED] Phase contradiction: `landing-footer` tagged Phase 3, everything around it says Phase 1
`DESIGN.md:647` heading read "(landing page only, Phase 3)". But
`public-repository-link` — explicitly Phase 1 — now "renders inside
`{components.landing-footer}`" on the landing page (`DESIGN.md:637`), and the IA
landing row (`EXPERIENCE.md:39`) keeps Phase 1 while describing the footer as
part of the landing purpose. If the footer is Phase 3, a Phase 1 landing has no
specified home for `VIEW REPOSITORY`, `CREATE A POLL`, or Discover. The
implementing story cannot tell which phase ships the band.
*Fix:* retag the heading Phase 1 (the IA row and the moved entries are all
Phase 1), or spell out the Phase 1 fallback presentation.
*Resolution: heading retagged Phase 1, matching the IA row and the moved entries.*

### [medium] "The retired Create/Browse blocks" is a dangling backward reference
`DESIGN.md:649` — "the same presentation the retired Create/Browse blocks
carried". Neither spine now specifies those blocks anywhere (removed by this
amendment; no other occurrence in either file). The claim "adds no new link
style to the system" is unverifiable from the spine alone — the entropy-link
hover idiom (`entropy-dark` → `text-dark`) has no other surviving spec;
`pagination:` frontmatter carries no hover token. The same gap makes the
44px/48px split on the shared `public-repository-link` presentation (44px on
Poll surfaces `DESIGN.md:641`, 48px in the footer `DESIGN.md:649`) look
unmotivated.
*Fix:* state the footer link spec as self-contained (it nearly is) and drop the
appeal to the retired blocks, or name `pagination` as the living carrier of the
idiom and give it the hover token.

### [low] "decorative-adjacent" is jargon with no operational content
`EXPERIENCE.md:177` — "The wordmark SVG is decorative-adjacent but never
`aria-hidden` — it is the attribution." The load-bearing fact is the second
clause; "decorative-adjacent" borrows a11y vocabulary without meaning anything
testable.
*Fix:* cut to "The wordmark SVG is never `aria-hidden` — it is the attribution."

### [low] "The footer" is now ambiguous in the `public-repository-link` closing line
`DESIGN.md:644-646` — "The embedded landing Demo and creator, auth,
administration, moderation, and not-found surfaces never render the footer."
Pre-amendment "the footer" meant the Poll footer unambiguously; with
`landing-footer` in the system and the landing page now rendering *a* footer,
the sentence needs the qualifier. EXPERIENCE's §Responsive Poll-footer paragraph
(`EXPERIENCE.md:279-281`) already draws exactly this distinction, so the fix is
one word.
*Fix:* "never render the Poll footer."

## What checks out

- All other `{token}` references in new text resolve: `{spacing.section-gap}`,
  `{spacing.measure-wide}`, `{spacing.1}`, `{typography.label-caps}`,
  `{typography.body}`, `{colors.entropy-dark}`, `{colors.text-dark}`,
  `{colors.dim-dark}`, `{breakpoints.sm}`, `{breakpoints.lg}` — all present in
  the frontmatter block.
- Naming is uniform: `` `landing-footer` `` in backticks everywhere in
  EXPERIENCE; heading and Component Patterns row carry the same canonical name;
  the Poll-footer paragraph explicitly disambiguates the two footers.
- Canonical order kept: new entry/row sits immediately after
  `public-repository-link` in both files, matching the shared-identifier
  adjacency convention; no existing entries reordered.
- Voice kept: terse spec prose, `[ASSUMPTION]` tags inline in the established
  style, widen-don't-rearrange reaffirmed rather than violated (wrap-only below
  `{breakpoints.sm}`, nothing hidden, nothing breakpoint-exclusive).
- Same-tab external-link convention held on both files (`rel="noopener"`, same
  tab); a11y specs agree across files (`role="img"`, `aria-label="Hearn."`,
  accessible name "built by Hearn."); no-color-alone not implicated (text
  labels carry all links).
- Four-entry discipline paragraph (`EXPERIENCE.md:61`) is internally coherent:
  entries unchanged, only the container moved.
- Responsive rows agree with DESIGN on wrap order, 48px targets, and
  full-width-below-grid at lg; mobile order (byline first, links stacked)
  matches `DESIGN.md:653`.
