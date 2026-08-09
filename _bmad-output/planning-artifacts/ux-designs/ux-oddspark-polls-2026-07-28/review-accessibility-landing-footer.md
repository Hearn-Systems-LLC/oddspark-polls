# Accessibility Review — DW-119 Landing Footer Amendments

**Lens:** Accessibility, behavioral audit of the `landing-footer` amendments to DESIGN.md and EXPERIENCE.md.
**Scope:** The diff only, judged against the spines' own rules (contrast floor table, widen-don't-rearrange discipline, no-color-alone rule, same-tab external link convention, Poll footer spec, label-caps entropy-link idiom).
**Note on filename:** the requested full slug exceeds the 255-byte filesystem filename limit; truncated to a valid slug.
**Overall verdict:** Adequate. No critical or high findings. The core accessibility decisions (composed accessible name, `role="img"`, focus order after main, dim contrast, wrap order, no-aria-hidden) are correct and correctly pinned. Two medium ambiguities will surface as implementation questions in the story: the 44px vs 48px repository-link target conflict, and the unspecified byline link target size.

## Per-category verdicts

| Category | Verdict |
|---|---|
| Byline accessible name ("built by Hearn.") + `role="img"` | Adequate (one low whitespace caveat) |
| `nav` landmark necessity and labeling for a 4-link footer | Adequate |
| Focus order placement after main content | Strong |
| Dim byline contrast at its type size, both modes | Strong |
| 48px / 44px target consistency | Thin |
| Wrap behavior preserving reading order | Strong |
| "Never `aria-hidden` the wordmark" | Strong |

## Findings

### [medium] Repository-link target size contradicts itself across the two spines

- **Location:** `EXPERIENCE.md` § Component Patterns, `public-repository-link` row — "uses a text label with a **44px minimum target**"; vs. `DESIGN.md` § Components, `landing-footer` — "The three links reuse the label-caps entropy-link idiom … **48px targets**". DESIGN's `public-repository-link` entry now says the landing rendering lives "inside `{components.landing-footer}`".
- **Impact:** `VIEW REPOSITORY` is one shared presentation seam ("One presentation component owns the repository destination"), but the same component now has two different target floors depending on surface — 48px in the landing footer, 44px on Poll surfaces. The implementing story will have to guess whether the landing instance follows the footer's 48px rule or the component's 44px rule, and whether the component's metrics are now per-instance.
- *Fix:* In the EXPERIENCE `public-repository-link` row, scope the 44px figure to Poll surfaces explicitly (e.g., "On Poll surfaces … 44px minimum target; in the `landing-footer` it takes the footer's 48px target like the other two entries"), or restate the component's target as "44px minimum, 48px where it joins the landing-footer row."

### [medium] Byline link target size is unspecified

- **Location:** `DESIGN.md` § Components, `landing-footer` — "the Hearn byline at the left edge … The whole byline is one link to `https://hearn.systems`". The three nav links get explicit "48px targets"; the byline link — a 14px `body` inline link with a `.78em` SVG — gets no target spec at all.
- **Impact:** An inline link at 14px body copy has a natural target height of roughly the line-height (~20–24px), at or below the WCAG 2.5.8 24px AA minimum and well under the product's own 44/48px floors. Whether the implementer stretches the target to the nav row's height (via padding/flex alignment) or ships a bare inline link is left to chance — the two outcomes differ measurably for motor-impaired users.
- *Fix:* Pin the byline target in the `landing-footer` entry: e.g., "the byline link's tap target spans the full footer row height (48px), matching the three links" or, deliberately, "the byline is an inline attribution link and meets the 24px minimum rather than the 48px chrome floor" — either is defensible, but the choice should be in the spine, not the PR.

### [low] Footer `nav` landmark is unlabeled and the band element is unnamed

- **Location:** `DESIGN.md` § Components, `landing-footer` — "One `<nav>` row"; `EXPERIENCE.md` § Component Patterns, `landing-footer` row — "A `<nav>` landmark below the landing grid".
- **Impact:** Today this is the only `nav` on the landing page (the header is explicitly "brand chrome rather than shared navigation"), so an unlabeled nav is unambiguous — the 4-link footer justifies the landmark, and this is acceptable as written. Two latent risks: (a) if any future nav joins the page, screen-reader users get two indistinguishable "navigation" landmarks; (b) the spec pins the `<nav>` but never says what the band itself is — a `<footer>` (contentinfo) is the idiomatic wrapper and would give AT users the expected "content info" landmark, which the page currently lacks. Implementers may ship `<div><nav>…` and lose that.
- *Fix:* Add one clause to the `landing-footer` entry: the band is a `<footer>` element, and the nav carries `aria-label="Footer"` (or equivalent) so the landmark is named if a second nav ever appears.

### [low] Composed accessible name depends on a whitespace detail

- **Location:** `EXPERIENCE.md` § Component Patterns, `landing-footer` row — "so the link's accessible name is 'built by Hearn.'".
- **Impact:** The name is correct per the accName computation — visible text "built by" plus the SVG's `role="img"` `aria-label="Hearn."` contributes as a text alternative. But plain-text nodes and embedded-element alternatives concatenate without inserted whitespace: if the markup is `built by<svg …/>` with the gap supplied only by the `{spacing.1}` left margin (CSS), the name computes as "built byHearn.". The spec's `{spacing.1}`-scale margin is a *visual* gap; it does not guarantee the *name* gap.
- *Fix:* Add to the byline spec: "a real space character separates `built by` from the wordmark in the markup (the margin is visual only), so the computed name is 'built by Hearn.' verbatim." Optionally note the trailing period in `aria-label="Hearn."` is intentional to match the wordmark.

## Categories verified clean (no findings)

- **`role="img"` correctness.** Correct call. An inline SVG that conveys content needs an accessible name; `role="img"` + `aria-label` is the robust cross-AT pattern (better than `<title>` alone). The wordmark is content — the attribution — not decoration, so the role is honest.
- **Never `aria-hidden` the wordmark.** Correct and load-bearing. Hiding it would reduce the link's accessible name to "built by" — a broken, purposeless link name. The EXPERIENCE row states the reason ("it is the attribution"), which is exactly the rationale an implementer needs. Strong.
- **Dim byline contrast.** The byline is `{typography.body}` (14px) in `{colors.dim-dark}`. 14px is normal text, requiring 4.5:1. The spines' own measured floor (DESIGN.md § Colors, contrast table): `dim` = **5.09:1 on void / 4.84:1 on panel** dark, **5.40 / 5.80** light — every value clears 4.5:1, and the footer sits on `void`. The `.78em` wordmark as a graphic needs only 3:1 and clears it by a wide margin. Hover lift to `{colors.text-dark}` only improves it. `label-caps` links at 11px in `entropy` (5.82/5.70) also clear 4.5:1. Strong.
- **Focus order after main content.** Explicitly pinned in both files ("after all main content in source and focus order"; lg bullet: footer "spanning the full shell width below the grid, outside both columns"). DOM order = visual order = focus order, consistent with the post-submit-focus contract in § Accessibility Floor (outcome line stays first in main; nothing in the footer competes). Strong.
- **Wrap behavior and reading order.** Below `{breakpoints.sm}` the byline holds line one and the three links stack beneath "in the same order … Nothing is hidden and nothing is rearranged beyond the wrap". Since visual order matches source order at every breakpoint, `flex-wrap` with no `order` properties satisfies WCAG 1.3.2 by construction, and the widen-don't-rearrange discipline is correctly invoked. The one thing the story must not do — put the links first in DOM and visually reorder — is implicitly excluded by the pinned order. Strong.
- **Same-tab convention / no-color-alone / focus indicator.** The byline opens in the same tab, matching the established external-link convention, so no new-window announcement is owed. Hover state is a color lift on a link (not state information), and focus uses "the standard focus outline" — the spines' "a color change alone is never the focus indicator" rule holds.
