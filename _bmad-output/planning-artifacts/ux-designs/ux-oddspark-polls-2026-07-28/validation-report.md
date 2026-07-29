# Validation Report — oddspark-polls

- **DESIGN.md:** `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md`
- **EXPERIENCE.md:** `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md`
- **Run at:** 2026-07-28T23:45:00-04:00

## Overall verdict

This is a well-shaped, decision-dense spine pair: canonical section order in both files, all five upstream journeys reproduced verbatim with climax beats and failure paths, every `{path.to.token}` reference in both documents resolving mechanically (zero dangling refs across 28 colors, 13 type roles, 15 components), and three invented sections that genuinely earn their place. A downstream consumer can build the dark-mode voter surface from this pair with very few questions.

The contract breaks on the half of the product that was added late. Light mode is fully specified in prose and entirely absent from the machine-readable layer: all 15 component definitions bind `-dark` colors exclusively, no resolution rule is stated, and the obvious suffix-swap produces exactly the gold-as-text the spine forbids. Compounding it, the stated contrast floor is asserted rather than measured and is wrong — `dim` fails 4.5:1 in dark mode at 4.02:1 while carrying the system's most identity-critical type, and the light-mode focus ring lands at 2.25:1 against a promise that focus is "always visible."

The second systemic issue is joinability: DESIGN.md and EXPERIENCE.md name nearly every shared component differently, so the visual contract and the behavioral contract can't be zipped together without a human translating. Fix the light-mode token bindings, the contrast claims, and the component naming, and this pair is genuinely strong.

A second reviewer working the accessibility lens independently recomputed the same three contrast failures — the light-mode focus ring at 2.25:1, the dark-mode `dim` shortfall, and the dark-only component bindings — arriving at the same measured ratios from the same hexes, which raises confidence that these are arithmetic facts rather than reviewer judgment. That review then added defects the rubric walk did not reach: leadership in the Tally is carried by hue alone at a 1.12:1 luminance separation with no glyph, violating the spine's own "glyph plus color" rule; the locked Security Toggle's 55%-opacity treatment renders the on-state as an empty rectangle at 1.21:1, inverting the state the Creator is meant to read; and there is no focus or announcement contract for post-submit outcomes, so a screen-reader user lands at the top of a reloaded document and must hunt for the result of the one irreversible action in the product.

## Category verdicts

- Flow coverage — strong
- Token completeness — thin
- Component coverage — adequate
- State coverage — adequate
- Visual reference coverage — thin
- Bloat & overspecification — strong
- Inheritance discipline — adequate
- Shape fit — strong

## Findings by severity

### Critical (3)

**[Token completeness + Accessibility]** — Component frontmatter binds dark-mode colors exclusively; gold-as-ink has no light-mode binding (§ DESIGN.md frontmatter `components`; § Brand & Style; § Colors)
The `components` frontmatter binds `-dark` colors exclusively — all 15 components, 12 distinct color references, zero `-light` bindings — while the product ships both modes as a committed decision ("Both modes ship"). No resolution rule is stated anywhere, so a consumer source-extracting the frontmatter gets a dark-only component contract. The naive suffix-swap is wrong: `poll-option.markerColorSelected`, `availability-cell.yesGlyphColor`, and `round-table.winnerColor` all resolve to `{colors.solar-dark}`, and swapping to `solar-light` yields #C9A227 gold on #F5F7F9 at **1.92:1** — precisely what `§ Colors` forbids. That the spine handles both modes explicitly in exactly one place (`overlay.scrimDark` / `scrimLight`) proves the suffix-swap convention isn't uniform. The accessibility review reached the same defect from the implementer's side and measured the full swapped set: selected marker **2.25:1**, `leadingEdgeLeader` **2.42:1**, `winnerColor` **2.42:1**, `bestColumnRule` **2.25:1**, input focus underline **2.42:1**, live-indicator dot **2.25:1**. It rated the finding high; carried here at the rubric's critical.
Fix: state the resolution rule explicitly and split the token's two jobs — `solar-*` is a fill only (`#0B0D10` on it verified at **8.04:1**, hover **9.69:1**); every glyph, rule, edge, marker, and underline binds to `solar-ink-*`, with the light twins added. Caveat: `solar-ink-light` on `solar-wash-light` over white is **3.91:1**, so darken the on-wash glyph to `#7A5F0D` (**4.81:1**) or `#6E560B` (**5.57:1**).

**[Token completeness + Accessibility]** — Stated contrast floor is false for `dim` in dark mode (§ DESIGN.md § Colors, "Contrast floor"; § Typography)
The floor claims "`text`, `dim`, `entropy`, `solar-ink`, and `on-solar`-over-`solar` all clear 4.5:1 against their intended backgrounds in both modes." `dim-dark` #67737F is **4.02:1 on `void-dark`** and **3.82:1 on `panel-dark`**. `dim` is not decorative: `§ Typography` assigns it to `label-caps`, called "the single most identity-carrying type detail," at 11px, plus all metadata, timestamps, helper text, and the results-bar raw count — and the accessibility review adds the trust badge, the live-indicator label, the lost-connection notice, comment attribution, table column heads, and toggle descriptions. `dim-light` passes at 5.40:1, so the failure is confined to the mode marked "inherited verbatim, do not tune." Both reviews computed the same ratios independently; the accessibility review rated it high.
Fix: lighten `dim-dark` (roughly #7A8794, or the accessibility review's #78848F at **5.09:1** void / **4.84:1** panel — still visibly the middle step of the three-step hierarchy). If "do not tune" is inviolable, the floor sentence must be rewritten to exclude `dim` and every essential-information role must move to `text-dark`, which is the more invasive fix.

**[Token completeness + Accessibility]** — Light-mode focus ring is effectively invisible at 2.25:1 (§ EXPERIENCE.md § Interaction Primitives; `poll-option.focusOutline`; DESIGN.md § Components → Poll option)
`§ Interaction Primitives` guarantees "a 2px `{colors.solar-dark}` outline offset 2px, never removed," and `poll-option.focusOutline` encodes the same. Under "gold as a fill is unchanged in both modes," that ring in light mode is #C9A227 on #F5F7F9 — **2.25:1** against `void-light` and **2.42:1** against `panel-light`, below the 3:1 non-text minimum. Focus visibility is the one accessibility guarantee both spines make emphatically, keyboard navigation is the first item in the PRD's accessibility bar, and the contrast floor section doesn't cover focus rings at all. Both reviews rated this critical and computed matching ratios.
Fix: promote focus to a mode-aware token — `focus-ring-dark: {colors.solar-dark}` (**8.04:1** on void, verified) and `focus-ring-light: {colors.solar-ink-light}` `#8A6D10` (**4.57:1** on `void-light`, **4.91:1** on white), or entropy-light at 5.70:1. No shape change; it stays a 2px square outline at 2px offset. Add focus rings to the load-bearing combinations the floor covers.

### High (14)

**[Token completeness]** — Glyph-on-wash contrast is unspecified and one combination fails the stated floor (§ DESIGN.md § Colors; `availability-cell`)
`§ Colors` claims "a wash never carries text-contrast responsibility," but `availability-cell` puts glyphs directly on washes: `ifNeedBeGlyphColor` (`entropy-dark`) on `entropy-wash-dark` over `panel-dark` computes to **4.05:1**, and the light-mode equivalent with `solar-ink-light` on `solar-wash-light` is **3.91:1**. Both clear the 3:1 non-text bar but sit under the spine's own 4.5:1 claim, and these glyphs are the entire state signal for Meeting Poll availability (FR-13, FR-14).
Fix: state the glyph-on-wash pairs as load-bearing combinations with their measured ratios, or deepen the glyph colors.

**[Token completeness]** — No motion token group exists, and motion is the product's signature (§ DESIGN.md frontmatter; § Components → Results bar; EXPERIENCE.md § Live Results & Motion)
The four durations (480ms, 400ms, 180ms, 2400ms) and the easing curve are restated in three places — `results-bar` / `live-indicator` frontmatter, `§ Components → Results bar` prose, and `§ Interaction Primitives` / `§ Live Results & Motion`. Worse, the 240ms leader cross-fade exists only in EXPERIENCE.md prose with no DESIGN.md token at all, so EXPERIENCE.md is defining a visual value DESIGN.md should own. Any future timing change has to be made in four places and will drift.
Fix: add a `motion` group to the frontmatter (`bar-transition`, `spark`, `count-up`, `leader-crossfade`, `pulse`, `ease`) and reference it from both files.

**[Token completeness]** — "Three, and only three" motion primitives contradicted twenty lines later (§ EXPERIENCE.md § Interaction Primitives vs § Live Results & Motion)
`§ Interaction Primitives` states "Three, and only three… Nothing else in the product animates," then `§ Live Results & Motion` specifies a fourth — the 240ms blue↔gold leader cross-fade. A developer reading the primitives list as the rule (which is how it's written) will not build the leader transition, and the leader treatment is central to the signature component.
Fix: make it four, or fold the cross-fade into the bar-transition primitive.

**[Component coverage]** — Overlay has a token object but no Components heading and no behavioral row (§ DESIGN.md § Elevation & Depth; EXPERIENCE.md § Component Patterns)
`overlay` has a full frontmatter token object but no `§ Components` heading (it's specified only in passing under `§ Elevation & Depth`) and no row in `§ Component Patterns`. The IA commits to three of them — two confirmations plus the Voter Code panel — and their behavior (focus trap, `Esc`, dismissal, whether the scrim is clickable, what happens to the page behind) is scattered across Interaction Primitives and Accessibility Floor rather than specified as a component.
Fix: add a `§ Components → Overlay` heading in DESIGN.md and an overlay/confirmation row in Component Patterns.

**[State coverage]** — No submit-in-flight, submission-failed, or offline state anywhere (§ EXPERIENCE.md § State Patterns; DESIGN.md § Components → Buttons)
The voting page's entire purpose is one irreversible POST, often from a phone on a poor connection (the stated primary context), and the spines never say what the vote button does between tap and confirmation, whether it disables, or what a Voter sees when the request fails or times out. Double-submission on a slow connection is a trust-critical path in a product whose core value is trustworthiness. `§ State Patterns` covers a lost live-results connection but not a failed vote.
Fix: add in-flight, submission-failed, and offline rows to State Patterns and a button-pending treatment to DESIGN.md.

**[State coverage]** — Direct navigation to `/{link}/results` is undefined when the Tally isn't public (§ EXPERIENCE.md § Information Architecture; § State Patterns)
The IA lists Tally view as its own route reachable by "direct link," and Visibility Setting supports After Close (Poll still open) and Creator-Only — but `§ State Patterns` only covers what a Voter sees on the vote confirmation surface in those modes. A reader who has never voted and pastes the results URL hits an undefined case, and the choice between 404, redirect to the Poll, and a "results aren't public yet" page is a real product decision with leak implications.
Fix: add a permission-denied / not-yet-visible row per Visibility Setting.

**[State coverage]** — The landing page has zero Component Patterns and zero State Patterns rows (§ EXPERIENCE.md § Component Patterns; § State Patterns)
It's a Phase 1 surface, the whole of UJ-5, and the first thing a portfolio visitor sees. Nothing specifies the pinned Demo Poll's embedded state (already voted from this browser, Demo Poll closed, Demo Poll mid-reset), and nothing specifies the landing page's own composition beyond the flow's prose.
Fix: add landing-page rows covering the embedded Demo Poll's states; the visual composition can lean on the pending key-screen mocks.

**[Inheritance discipline]** — Component names differ between the two spines for nearly every shared component (§ DESIGN.md § Components vs EXPERIENCE.md § Component Patterns)
The visual contract and the behavioral contract cannot be joined mechanically. `poll-option` / "Poll option" is "Option row (single-select)" and "Option row (multi-select)" in EXPERIENCE.md; `availability-cell` / "Availability grid cell" is "Availability grid"; `comment` splits into "Comment composer" and "Comment list"; `trust-badge` appears as "The trust badge" in a different section entirely; `results-bar`, `poll-card`, `round-table`, and `input-code` have no EXPERIENCE.md counterpart under any name. A consumer building the option row has to read both files end to end and infer the mapping.
Fix: use the frontmatter token name as the canonical identifier in every heading and table row in both files, with the prose name after it.

**[Accessibility]** — The results-bar count token contradicts the prose two paragraphs above it (§ DESIGN.md § Components → Results bar, `countColor`)
`{components.results-bar.countColor}` is `dim-dark`, and the count sits inside the bar. Over the fills that measures **2.80:1** on `entropy-wash` and **2.50:1** on `solar-wash`. This contradicts the same section's prose: "Both stay `{colors.text-dark}`; the wash is thin enough that text reads identically over filled and unfilled regions."
Fix: delete the `countColor` token and let the count inherit `text-dark`, which measures **8.59:1** / **7.67:1** over the two washes — the prose was right and the token was wrong. Differentiate the count from the percentage with the existing `caption` size step, not with color.

**[Accessibility]** — Leadership in the Tally is carried by hue alone (§ DESIGN.md § Components → Results bar, "Leader treatment")
`solar-wash` vs `entropy-wash` composited over `panel-dark` is `#3C361C` vs `#252F3C` — a luminance ratio of **1.12:1**; the 2px leading edges are **1.38:1** apart. There is no glyph, no text, no weight change. This violates the spine's own Do ("Render every state with glyph plus color") and its own Accessibility Floor, whose list of glyph-carried states conspicuously omits the leader. Bar length does not rescue it: the case where leadership matters most is a near-tie, and the `TIED` rule means "no gold" is itself information the reader must be able to detect.
Fix: prefix the leading bar's value with the `◆` marker already used for a selected option, in `solar-ink`, inside the existing right-hand value cluster — `◆ 47% · 122`. It reuses a system glyph, costs one character of width, needs no box, and makes `TIED` legible as the absence of a mark rather than the absence of a hue.

**[Accessibility]** — Availability "No" and "Unanswered" are distinguished by glyph shape alone at 2.05:1 (§ DESIGN.md § Components → Availability grid cell)
Both are `faint` on no fill — **2.05:1** dark, **2.48:1** light — at a ratio the spine itself declares "below a readable contrast ratio… by design." A voter with low vision cannot tell "I declined this slot" from "I haven't answered yet," which is the difference between a submitted answer and an omission on the one Vote in the product that can be edited.
Fix: `No` is an answer, not an absence — move `noGlyphColor` to `dim` (**5.09:1** at the corrected value). Keep `Unanswered` at `faint`; it is correctly the null state.

**[Accessibility]** — `CLOSED` renders in `faint` at 2.05:1, breaking the spine's own Don't (§ DESIGN.md § Components → Poll card)
`CLOSED` renders in `label-caps` `{colors.faint-dark}` — 11px, letterspaced, uppercase, at **2.05:1**. This is a Poll's primary status and it breaks the Don't: "No `{colors.faint-dark}` on text a user has to read."
Fix: `dim`, matching the metadata line it sits beside.

**[Accessibility]** — No focus or announcement contract for post-submit outcomes (§ EXPERIENCE.md § State Patterns; § Accessibility Floor)
Voting is a server round-trip on a server-rendered page, and nothing says where focus lands or what a screen reader hears after **Counted.**, already-voted, VPN-blocked, bad code, CAPTCHA failure, or rate-limiting. A screen-reader user lands at the top of a reloaded document and must hunt for the result of the most consequential action in the product — including its climax moment. The `aria-live` region specified for the Tally does not help, because it announces changes to an already-rendered region, not the state of a fresh document.
Fix: on every post-submit render, the outcome line is a `tabindex="-1"` element focused on load and is the first content in the main landmark; the document `<title>` leads with the outcome ("Counted — {question}" / "Already voted — {question}"). Add this to `§ Accessibility Floor` as its own bullet alongside "Focus order."

**[Accessibility]** — The availability cell's keyboard model is internally contradictory and has no clean ARIA mapping (§ EXPERIENCE.md § Accessibility Floor)
The spine specifies "each cell is a three-state control reachable by `Tab`, cycled with `Space`, set directly with arrow keys" — but in a grid, arrow keys conventionally move between cells, so the two behaviors collide, and `Tab` landing on every cell of a Voters × slots matrix is a large tab-stop count. Three states also have no honest ARIA state: `aria-checked="mixed"` would describe "if-need-be" as partially-yes, which it is not. A competent implementer will guess, and the guesses diverge.
Fix: model each slot as a `radiogroup` of three named radios — `Yes` / `If need be` / `No` — which the desktop layout already renders as "three discrete targets." `Tab` moves between slots, arrows select within a slot, state is announced natively, and the group's accessible name is the slot's local time. Retire cycle-on-tap on mobile too; a four-step cycle that can land on "unanswered" is both slow and easy to overshoot.

### Medium (23)

**[Token completeness]** — Breakpoint `md` referenced by name but never defined (§ DESIGN.md § Typography; EXPERIENCE.md § Responsive & Platform)
`§ Typography` references "dropping to `display-mobile` 30px below `md`" but no `breakpoints` token group exists and `md` is never defined. EXPERIENCE.md expresses the same breakpoints as raw pixels (`< 640px`, `640–1023px`, `≥ 1024px`), so a consumer has to guess whether `md` is 640 or 768.
Fix: add a `breakpoints` token group and use the names in both files.

**[Token completeness]** — Five defined color tokens are bound to nothing in the machine layer (§ DESIGN.md frontmatter `colors`)
`solar-ink-dark`, `solar-ink-light`, `solar-hover-light`, `solar-wash-light`, and `entropy-wash-light` have no bindings. `solar-ink` is the load-bearing one — it's the rule that makes gold work as text in light mode, and it has no machine representation at all.
Fix: resolves with the light-mode binding fix above.

**[Token completeness]** — Hairlines carry the whole grouping model at 1.25:1 with no stated minimum (§ DESIGN.md § Shapes / § Colors — `rule-dark`, `rule-light`)
Hairlines are "the single structural device in the system" but `rule-dark` on `void-dark` is **1.24:1** and `rule-light` on `void-light` is **1.26:1**, with no stated minimum. Decorative separators are WCAG-exempt, so this isn't a violation — but a 1px line at 1.25:1 is at the perceptual floor on a phone in daylight, which is the primary voting context. The accessibility review reached the same measurements and explicitly declined to flag it, arguing that raising `rule-dark` to 3:1 would destroy the system's identity — while agreeing it should be written down as a decision.
Fix: state a deliberate minimum for structural rules, or note explicitly that hairline visibility is accepted as low because whitespace, not the rule, does the grouping.

**[Component coverage + Accessibility]** — The Turnstile widget has no visual, theming, or accessibility contract (§ EXPERIENCE.md § Component Patterns — "Turnstile widget"; DESIGN.md § Components, absent)
Turnstile has six mentions in EXPERIENCE.md and zero in DESIGN.md. It's a third-party embed in a system whose hardest visual rule is "zero radius, everywhere… a single rounded corner reads as a different product" — and Turnstile renders as a bordered, rounded, shadowed box. There is no theme or size decision for a product shipping both color modes, so it renders its own light chrome on a `#0B0D10` page; and its focus ring, contrast, and announcements are Cloudflare's, not the spine's. Both reviews raised this gap independently at the same severity, one from the visual-contract side and one from the accessibility side.
Fix: add a Turnstile entry to `§ Components` binding `theme` to the resolved color mode (including on manual override, not just OS preference), setting `appearance: "interaction-only"` so the widget is absent until a challenge is required — matching the spine's own "never blocks reading the Poll" rule — and stating size plus the fact that the widget's chrome is the one sanctioned exception to the shape rules.

**[Component coverage]** — The pie chart is a half-made decision (§ DESIGN.md § Do's and Don'ts; EXPERIENCE.md, absent)
`§ Do's and Don'ts` says "FR-21 permits pie; it is a secondary toggle at most, never the default" — which commits to a toggle existing — but EXPERIENCE.md never mentions pie, has no chart-form control in Component Patterns, no toggle in the IA, and no state for the pie view.
Fix: either specify the toggle in EXPERIENCE.md or change the DESIGN.md line to say bar is the only form shipped.

**[Component coverage]** — Visibility Setting has a behavioral row but no visual spec (§ EXPERIENCE.md § Component Patterns; DESIGN.md § Components, absent)
The row describes three exclusive choices with consequence text beneath each, but there is no radio group, segmented control, or choice-card component anywhere in DESIGN.md. It's the only three-way exclusive control in the product.
Fix: add a `§ Components` entry, or state that it reuses `poll-option` markers on the creator surface.

**[Component coverage]** — `poll-card` has a visual spec but no behavioral row (§ DESIGN.md § Components → Poll card; EXPERIENCE.md § Component Patterns, absent)
The IA says the creator Poll list row is what you click to reach Poll detail, and nothing states what the whole-row tap target does, whether the live indicator is interactive, or how closed Polls sort.
Fix: add a Poll card row.

**[State coverage]** — The Poll creation form has no validation states (§ EXPERIENCE.md § State Patterns; § Voice and Tone)
`§ Voice and Tone` supplies copy for Custom Link taken and reserved, but there is nothing for submitting with no options, one option, a Deadline in the past, an image upload failing to R2 (Phase 2), or a slot whose end precedes its start (Phase 3).
Fix: add a creation-form validation block; several of these are one line each.

**[State coverage]** — Ballot Manifest and Voter Codes surfaces have no states (§ EXPERIENCE.md § State Patterns)
The Manifest publishes only on close, so direct navigation before close is undefined; the Codes panel has no state for generation in progress, copy confirmation, or codes already partly redeemed (which the Creator needs to see to know how many invitations are still live).
Fix: add rows for both; the Codes surface is deferred but UJ-4 depends on it.

**[Visual reference coverage]** — Screenshots appear only in the frontmatter `sources` list, never linked inline (§ DESIGN.md frontmatter `sources`; § Brand & Style, § Colors, § Typography)
The screenshots are labelled "oddspark.dev (live extraction, 2026-07-28)" and never linked at the three sections that derive from them, and nothing names what each illustrates or how they differ (desktop vs. mobile is inferable from the filenames alone). A consumer questioning whether `#0B0D10` is right has no pointer from the claim to the evidence.
Fix: add an inline reference line at each of the three sections naming what the image shows.

**[Visual reference coverage]** — No spines-win-on-conflict statement exists in either file (§ DESIGN.md § Colors; EXPERIENCE.md preamble)
EXPERIENCE.md's preamble establishes precedence between the two spines ("DESIGN.md owns appearance and this file owns behavior") but never establishes precedence over the visual references — which matters more than usual here, because DESIGN.md tells consumers the dark values are "inherited verbatim… do not re-derive or nudge," inviting them to treat the screenshots as authoritative over the spine.
Fix: one line in DESIGN.md stating the spine wins on conflict with any referenced image.

**[Visual reference coverage]** — EXPERIENCE.md's `sources` omits the origin it credits in prose (§ EXPERIENCE.md frontmatter `sources`; § Inspiration & Anti-patterns)
`sources` lists only the four planning documents, omitting oddspark.dev and the screenshots — yet `§ Inspiration & Anti-patterns` opens by crediting oddspark.dev for "the entire visual and structural posture… the identity transfer is verbatim." A file that inherits from a source should declare it.
Fix: add the oddspark.dev line to EXPERIENCE.md's `sources`, matching DESIGN.md's.

**[Inheritance discipline]** — EXPERIENCE.md names mode-specific `-dark` tokens in mode-neutral behavioral prose (§ EXPERIENCE.md § Interaction Primitives; § Timezone Handling)
The focus outline and the `+1 day` flag both name `{colors.solar-dark}` / `{colors.entropy-dark}` in rules that apply in both modes. Since EXPERIENCE.md owns behavior and not appearance, these should either be semantic or point at a mode-neutral name.
Fix: resolves alongside the light-mode binding fix; introduce mode-neutral aliases and reference those.

**[Accessibility]** — The reduced-motion contract is incomplete (§ EXPERIENCE.md § Interaction Primitives; § Live Results & Motion)
`§ Interaction Primitives` claims "Three, and only three" motion primitives, but `§ Live Results & Motion` defines five timed behaviors: the 480ms width transition, the 180ms spark, the 2400ms pulse, the 400ms count-up, and the 240ms leader cross-fade. The reduced-motion clause covers widths, numbers, the spark, and the dot — the leader cross-fade is in neither list.
Fix: correct the primitives count to five and add "the leader's fill and edge change color instantly" to the reduced-motion contract. The change of state must survive; only the 240ms interpolation is dropped.

**[Accessibility]** — The signature moment has no screen-reader equivalent (§ EXPERIENCE.md § Accessibility Floor — `aria-live` scope)
`aria-live` is scoped to the aggregate totals line — correct, and the reasoning is sound — but the consequence is that a screen-reader user hears "122 votes… 123 votes…" and never learns that the lead changed hands. The product's climax is a leadership change, and it is announced to nobody.
Fix: leader changes are rare relative to Votes, so announce them on the same polite region: "Pizza now leading, 47 percent." Announce `TIED` the same way when gold is withdrawn. This is additive to the aggregate line and does not reintroduce per-bar chatter.

**[Accessibility]** — The lost-connection notice is structural annotation doing a warning's job (§ EXPERIENCE.md § State Patterns, "Live connection lost")
The notice is a `label-caps` line — 11px, 0.18em tracking, uppercase, `dim` (**4.02:1** at the current value) — and it is the only thing standing between a reader and silently stale numbers. Separately, the spine says the notice "announces once" but never says reconnection announces, so a screen-reader user who is told the data is stale is never told it is fresh again.
Fix: render the notice in `caption` 12px `{colors.text-*}` — it is a warning, not structural annotation — and announce reconnection on the same polite region ("Updates resumed"). The State Patterns row already specifies that reconnection "snaps to current values"; it just needs to say so out loud.

**[Accessibility]** — `void → panel` is not a perceivable step, and three behaviors depend on it (§ DESIGN.md § Elevation & Depth; EXPERIENCE.md § State Patterns)
**1.05:1** in dark (`#101419` on `#0B0D10`), **1.07:1** in light (white on `#F5F7F9`). The results-bar `trackBackground`, the option row's `hoverBackground`, and the cold-load skeleton all depend on it and none will be visible — which contradicts the Empty Poll row's promise that "The chart's shape is visible before it has data."
Fix: don't add a second elevation step — use the system's own device. Give each results bar a 1px `rule` baseline so the bar group reads as ruled bands whether or not it has data; that makes the zero state, the skeleton, and per-option extents legible with a hairline rather than a tone. For option-row hover, accept that the fill is a near-no-op and let the focus outline carry the affordance.

**[Accessibility]** — The locked Security Toggle renders as an OFF toggle (§ DESIGN.md § Components → Security toggle)
The spine specifies the on-appearance "at 55% opacity"; `trackOn` is `solar-wash-dark` at alpha 0.24, so 55% of that is an effective **0.132 alpha → 1.21:1 against void** — an empty rectangle. If the opacity applies to the whole control (the natural reading), the `caption` description drops to **2.00:1**. The Creator looking at a Poll's protections after the first Vote sees the state inverted, which the spine explicitly does not want: "Locked Toggles are never hidden or greyed past legibility."
Fix: drop the opacity mechanism and give locked its own tokens — full-strength `trackOn`, knob in `dim` rather than `solar-ink` (removing the affordance without removing the state), and the word `LOCKED` in `label-caps` beside the name. The state is then carried by text, not by a tone that reads as its own opposite.

**[Accessibility]** — Option-row semantics are under-specified in the way that most often goes wrong (§ EXPERIENCE.md § Interaction Primitives; DESIGN.md § Components → Poll option)
"Radio/checkbox semantics" plus "the marker is a monospace glyph rather than a native radio or checkbox" reads as an instruction to build ARIA widgets by hand, and separately means the marker glyphs (`·`, `◆`, `[ ]`, `[×]`) will be spoken as punctuation ("middle dot, Pizza" / "left bracket, times, right bracket, Pizza").
Fix: two sentences in `§ Component Patterns` — the control is a visually-hidden native `<input type="radio|checkbox">` with the row as its `<label>`, which yields roles, names, checked state, arrow-key group navigation, and `Space` for free; the marker is drawn from the label's `::before` and is decorative. The visual spec is unchanged; only the implementation is pinned.

**[Accessibility]** — The rank builder performs a silent bulk state change (§ EXPERIENCE.md § Component Patterns, FR-8)
Unranking an option "compacts the ranks below it" — one activation silently renumbers every control beneath it, and nothing announces the result. A screen-reader user unranks their second choice and has no way to know what the other four options now hold without re-traversing them.
Fix: each option is a button whose accessible name states its rank and its action ("Pizza, rank 2 of 4, activate to unrank"), and a rank change posts a single polite announcement of the new summary — which the `RANKED {n} OF {total}` line already computes and can serve as the live region.

**[Accessibility]** — 14px Courier Prime is a real problem for the multi-sentence copy (§ DESIGN.md § Typography; EXPERIENCE.md § Voice and Tone)
Courier Prime's x-height is roughly 0.42em, so `body` at 14px has the apparent size of about 11px in a humanist sans, and monospace removes the word-shape cues that make sustained prose fast. Short glanceable strings are fine at 14px and the tabular-figures argument holds. It bites in three places: the rejection and explanation copy in `§ Voice and Tone` (the IP-check and VPN messages run three sentences), Security Toggle descriptions at `caption` 12px, and comment bodies.
Fix: widen `body-lg` 16px from "landing-page prose only" to "any multi-sentence block on any surface," and lift toggle descriptions from `caption` to `body`. The ramp doesn't change, only where its steps are allowed.

**[Accessibility]** — `label-caps` at 11px carries essential information it was not designed for (§ DESIGN.md § Typography — `label-caps`)
Uppercase plus 0.18em tracking removes word-shape entirely, so 11px caps read materially slower than 11px sentence case — acceptable for `QUESTION`, column heads, and field labels. It crosses into essential information at the trust badge, `TIED`, the lost-connection notice, `CLOSED`, `RANKED {n} OF {total}`, `122 VOTERS · 208 SELECTIONS`, and the timezone line.
Fix: add one variant — same family, same caps, same tracking, at 12px in `{colors.text-*}` — for labels that carry information rather than structure. The identity is the caps and the tracking, not the 11px.

**[Accessibility]** — Touch-target contradiction between the two spines (§ DESIGN.md § Components → Availability grid cell, 44px vs EXPERIENCE.md § Interaction Primitives, 48px)
DESIGN.md specifies `size: 44px`, while EXPERIENCE.md specifies "Minimum 48px tap targets on every voting-surface control (option rows, availability cells, the vote button)."
Fix: 48px, and confirm it survives the mobile three-target row — three 48px targets plus a slot label fits a 320px viewport at the 20px mobile margin.

### Low (13)

**[Flow coverage]** — Three of five flow protagonists are unnamed archetypes (§ EXPERIENCE.md § Key Flows, UJ-2, UJ-4, UJ-5)
UJ-2, UJ-4, and UJ-5 protagonists are unnamed archetypes ("a stranger", "a code holder", "someone") where UJ-1 and UJ-3 get named actors. The shape references name every protagonist because a named person is what makes a flow reviewable as a story.
Fix: name the three anonymous protagonists; nothing else in the flow changes.

**[Flow coverage]** — Image Polls have no flow touching them (§ EXPERIENCE.md § Information Architecture, "Image upload" row)
Image Polls (FR-11, Phase 2) are the only feature area with no flow — the IA table's "Image upload" row is the one surface with a `—` in the Journey column. The sources define no UJ for it, so this isn't a miss against upstream, but a Phase 2 story-dev consumer has no narrative for image upload, alt-text entry, or image-option voting end to end.
Fix: either an explicit note that Image Polls ride UJ-2's flow with an image ballot, or a short sixth flow.

**[Component coverage]** — Rank builder's visual spec is one clause inside Poll option (§ DESIGN.md § Components → Poll option)
The `RANKED {n} OF {total}` line, the unranked `–` treatment, and the group affordance have no dedicated spec and no frontmatter tokens.
Fix: promote to its own `§ Components` entry for Phase 2.

**[Component coverage]** — `results-bar` has no Component Patterns row (defensible) (§ EXPERIENCE.md § Component Patterns / § Live Results & Motion)
`§ Live Results & Motion` covers its behavior far better than a table cell could and Component Patterns cross-links to it. Noting only so the omission reads as deliberate.
Fix: none required; confirm the omission is intentional.

**[Component coverage]** — Slot builder has a behavioral row but no visual spec for date/time inputs (§ EXPERIENCE.md § Component Patterns, Slot builder, Phase 3)
Date and time inputs are the only input types in the product not covered by `{components.input}`.
Fix: defer with the phase, but note it.

**[Bloat & overspecification]** — Foundation restates PRD glossary definitions it already inherits by reference (§ EXPERIENCE.md § Foundation)
The section restates the three audiences with quoted PRD §3 glossary definitions across five lines, in a document whose second sentence says personas are inherited by reference. The derived content in those lines (that Cloudflare Access means there's no login screen to design; that the two Voter contexts share one surface) is load-bearing and earns its place; the quoted definitions around it don't.
Fix: keep the derivations, drop the quotes.

**[Bloat & overspecification]** — Editorial voice appears several times per flow rather than once at the climax (§ EXPERIENCE.md § Key Flows)
"Justin isn't monitoring a system; he's watching an opinion take shape," "that is the whole argument for the product," "which is a kind of power." The shape references do allow evocative climax beats, so this is calibration rather than a violation.
Fix: keep one per flow, at the climax.

**[Inheritance discipline]** — "Session Check(s)" / "IP Check(s)" pluralization drifts against the PRD glossary (§ EXPERIENCE.md § Trust Surfaces; § Component Patterns; § Key Flows)
Singular and plural alternate across three sections; the PRD glossary is singular. Cosmetic, but glossary terms are the one vocabulary a consumer greps for.
Fix: pick the plural form the FRs use and apply it uniformly.

**[Shape fit]** — Responsive and Accessibility Floor sit behind the narrative sections (§ EXPERIENCE.md § Responsive & Platform; § Accessibility Floor)
`§ Responsive & Platform` sits last, after Key Flows and Inspiration — later than in either shape reference, both of which place it before the narrative sections. Layout behavior is something a developer reads early and a reviewer reads late. `§ Accessibility Floor` is similarly pushed past three invented sections.
Fix: move Responsive and Accessibility Floor up to sit with the other structural defaults, leaving Inspiration and Key Flows as the closing narrative pair.

**[Accessibility]** — The disabled vote button reads as absent rather than waiting (§ DESIGN.md § Components → Buttons)
`{colors.faint-dark}` text on transparent — **2.05:1**. Disabled controls are WCAG-exempt, so this is inside the bar, but it is the first state a voter sees on a min-selection or ranked Poll.
Fix: `dim` text, keeping the existing `label-caps` hint above it to say what unlocks it.

**[Accessibility]** — The Voter Code field autofocuses ahead of the question (§ EXPERIENCE.md § Component Patterns)
Autofocus drops a screen-reader user into an edit field before the Poll question has been announced, on the one surface where the question is the entire point.
Fix: drop the autofocus, or keep it and give the field an `aria-describedby` pointing at the question so context arrives with the focus. The field already sits above the options and is hard to miss visually.

**[Accessibility]** — Overlay focus return is unspecified (§ EXPERIENCE.md § Accessibility Floor)
Focus is trapped inside the two confirmations and the code panel and `Esc` always leaves — but nothing says focus returns to the control that opened them.
Fix: one clause: focus returns to the invoking control on close, by any means.

**[Accessibility]** — The Security Toggle's hit area is the 40×20px track (§ DESIGN.md § Components → Security toggle)
Well under 44px. Creator-surface, one user, so the impact is small.
Fix: the name and description are inside the `<label>`, making the whole row the target.

## Reviewer files

- `review-rubric.md`
- `review-accessibility.md` (its "Verified claims" table of passing contrast pairs and confirmed non-issues is preserved in the source file rather than reproduced here)
