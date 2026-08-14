---
name: Oddspark Polls
description: The oddspark.dev visual identity applied to a polling product — dark-native, monospaced, hairline-ruled, with one gold focal accent and results bars that are the whole point.
status: final
updated: 2026-08-09
sources:
  - /Volumes/fast/Github/oddspark-polls/_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md
  - /Volumes/fast/Github/oddspark-polls/_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/addendum.md
  - /Volumes/fast/Github/oddspark-polls/_bmad-output/planning-artifacts/briefs/brief-oddspark-polls-2026-07-28/brief.md
  - /Volumes/fast/Github/oddspark-polls/_bmad-output/planning-artifacts/briefs/brief-oddspark-polls-2026-07-28/addendum.md
  - oddspark.dev (live extraction, 2026-07-28) — .working/oddspark-desktop.png, .working/oddspark-mobile.png
colors:
  void-dark: '#0B0D10'
  void-light: '#F5F7F9'
  panel-dark: '#101419'
  panel-light: '#FFFFFF'
  rule-dark: '#1D242C'
  rule-light: '#D8DEE4'
  text-dark: '#C6CFD8'
  text-light: '#1A2028'
  dim-dark: '#78848F'
  dim-light: '#5A6773'
  faint-dark: '#3D4750'
  faint-light: '#9AA6B2'
  entropy-dark: '#6E8FB8'
  entropy-light: '#3D6491'
  entropy-wash-dark: 'rgba(110, 143, 184, 0.22)'
  entropy-wash-light: 'rgba(61, 100, 145, 0.16)'
  solar-dark: '#C9A227'
  solar-light: '#C9A227'
  solar-hover-dark: '#D9B33A'
  solar-hover-light: '#D9B33A'
  solar-ink-dark: '#C9A227'
  solar-ink-light: '#8A6D10'
  solar-ink-on-wash-light: '#6E560B'
  solar-wash-dark: 'rgba(201, 162, 39, 0.24)'
  solar-wash-light: 'rgba(201, 162, 39, 0.28)'
  on-solar-dark: '#0B0D10'
  on-solar-light: '#0B0D10'
  focus-ring-dark: '#C9A227'
  focus-ring-light: '#8A6D10'
  alarm-dark: '#B8705E'
  alarm-light: '#9A4B33'
typography:
  display:
    fontFamily: Newsreader
    fontSize: 40px
    fontWeight: '400'
    lineHeight: '1.15'
    letterSpacing: -0.01em
  display-mobile:
    fontFamily: Newsreader
    fontSize: 30px
    fontWeight: '400'
    lineHeight: '1.2'
  poll-question:
    fontFamily: Newsreader
    fontSize: 26px
    fontWeight: '400'
    lineHeight: '1.3'
  heading-lg:
    fontFamily: Newsreader
    fontSize: 24px
    fontWeight: '400'
    lineHeight: '1.25'
  heading-md:
    fontFamily: Newsreader
    fontSize: 19px
    fontWeight: '400'
    lineHeight: '1.35'
  body:
    fontFamily: Courier Prime
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.65'
  body-lg:
    fontFamily: Courier Prime
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.7'
  label-caps:
    fontFamily: Courier Prime
    fontSize: 11px
    fontWeight: '400'
    lineHeight: '1.4'
    letterSpacing: 0.18em
  label-caps-lg:
    fontFamily: Courier Prime
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.4'
    letterSpacing: 0.18em
  button:
    fontFamily: Courier Prime
    fontSize: 13px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.22em
  data:
    fontFamily: Courier Prime
    fontSize: 14px
    fontWeight: '700'
    lineHeight: '1.2'
  data-lg:
    fontFamily: Courier Prime
    fontSize: 20px
    fontWeight: '700'
    lineHeight: '1.1'
  caption:
    fontFamily: Courier Prime
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.5'
motion:
  bar-transition: 480ms
  spark: 180ms
  count-up: 400ms
  leader-crossfade: 240ms
  pulse: 2400ms
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)'
breakpoints:
  sm: 640px
  lg: 1024px
rounded:
  sm: 0
  DEFAULT: 0
  md: 0
  lg: 0
  xl: 0
  full: 9999px
spacing:
  hairline: 1px
  unit: 8px
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '8': 32px
  '10': 40px
  '14': 56px
  '20': 80px
  gutter-mobile: 20px
  gutter-desktop: 32px
  margin-mobile: 20px
  margin-desktop: 48px
  section-gap: 56px
  measure: 68ch
  measure-wide: 1280px
# Light-mode resolution rule: a component token that references a `-dark` color
# resolves in light mode by swapping the suffix to `-light`, EXCEPT where an
# explicit `…Light` twin is bound on the component. The exceptions below are the
# complete set; see § Colors, "Light-mode resolution".
components:
  poll-option:
    minHeight: 48px
    paddingX: '{spacing.4}'
    paddingY: '{spacing.3}'
    borderRadius: '{rounded.DEFAULT}'
    borderBottom: '{spacing.hairline} solid {colors.rule-dark}'
    typography: '{typography.body}'
    color: '{colors.text-dark}'
    markerColor: '{colors.faint-dark}'
    markerColorSelected: '{colors.solar-ink-dark}'
    hoverBackground: '{colors.panel-dark}'
    focusOutline: '2px solid {colors.focus-ring-dark}'
    focusOutlineOffset: 2px
  results-bar:
    height: 34px
    heightDesktop: 38px
    gap: '{spacing.1}'
    borderRadius: '{rounded.DEFAULT}'
    baselineRule: '{spacing.hairline} solid {colors.rule-dark}'
    trackBackground: '{colors.panel-dark}'
    fill: '{colors.entropy-wash-dark}'
    fillLeader: '{colors.solar-wash-dark}'
    leadingEdgeWidth: 2px
    leadingEdgeWidthSpark: 4px
    leadingEdge: '{colors.entropy-dark}'
    leadingEdgeLeader: '{colors.solar-ink-dark}'
    leaderMarker: '◆'
    leaderMarkerColor: '{colors.solar-ink-dark}'
    leaderMarkerColorLight: '{colors.solar-ink-light}'
    labelTypography: '{typography.body}'
    valueTypography: '{typography.data}'
    countTypography: '{typography.caption}'
    paddingX: '{spacing.3}'
    transitionDuration: '{motion.bar-transition}'
    transitionEasing: '{motion.ease}'
    countUpDuration: '{motion.count-up}'
    sparkDuration: '{motion.spark}'
    leaderCrossfadeDuration: '{motion.leader-crossfade}'
  chart-form-toggle:
    typography: '{typography.label-caps}'
    color: '{colors.dim-dark}'
    colorCurrent: '{colors.solar-ink-dark}'
    separator: '·'
    gap: '{spacing.2}'
    borderBottom: '{spacing.hairline} solid {colors.rule-dark}'
    paddingY: '{spacing.2}'
    minHeight: 48px
    focusOutline: '2px solid {colors.focus-ring-dark}'
    focusOutlineOffset: 2px
  security-toggle:
    trackWidth: 40px
    trackHeight: 20px
    knobSize: 16px
    borderRadius: '{rounded.DEFAULT}'
    trackOff: '{colors.rule-dark}'
    trackOn: '{colors.solar-wash-dark}'
    knobOff: '{colors.text-dark}'
    knobOn: '{colors.solar-ink-dark}'
    trackLocked: '{colors.solar-wash-dark}'
    knobLocked: '{colors.dim-dark}'
    lockedLabelTypography: '{typography.label-caps}'
    lockedLabelColor: '{colors.dim-dark}'
    labelTypography: '{typography.label-caps}'
    descriptionTypography: '{typography.body}'
    descriptionColor: '{colors.dim-dark}'
    hitArea: row
  availability-cell:
    size: 48px
    borderRadius: '{rounded.DEFAULT}'
    border: '{spacing.hairline} solid {colors.rule-dark}'
    yesBackground: '{colors.solar-wash-dark}'
    yesGlyphColor: '{colors.solar-ink-dark}'
    yesGlyphColorLight: '{colors.solar-ink-on-wash-light}'
    ifNeedBeBackground: '{colors.entropy-wash-dark}'
    ifNeedBeGlyphColor: '{colors.entropy-dark}'
    noBackground: transparent
    noGlyphColor: '{colors.dim-dark}'
    emptyGlyphColor: '{colors.faint-dark}'
    bestColumnRule: '2px solid {colors.solar-ink-dark}'
    focusOutline: '2px solid {colors.focus-ring-dark}'
    focusOutlineOffset: 2px
  comment:
    paddingY: '{spacing.3}'
    borderTop: '{spacing.hairline} solid {colors.rule-dark}'
    bodyTypography: '{typography.body-lg}'
    bodyColor: '{colors.text-dark}'
    nameTypography: '{typography.label-caps}'
    nameColor: '{colors.dim-dark}'
  button-primary:
    background: '{colors.solar-dark}'
    hoverBackground: '{colors.solar-hover-dark}'
    color: '{colors.on-solar-dark}'
    typography: '{typography.button}'
    paddingX: '{spacing.6}'
    paddingY: '{spacing.4}'
    minHeight: 48px
    borderRadius: '{rounded.DEFAULT}'
    border: none
    textTransform: uppercase
    pendingLabel: 'COUNTING…'
    disabledColor: '{colors.dim-dark}'
    focusOutline: '2px solid {colors.focus-ring-dark}'
    focusOutlineOffset: 2px
  button-secondary:
    background: transparent
    color: '{colors.text-dark}'
    typography: '{typography.button}'
    paddingX: '{spacing.6}'
    paddingY: '{spacing.4}'
    minHeight: 48px
    borderRadius: '{rounded.DEFAULT}'
    border: '{spacing.hairline} solid {colors.rule-dark}'
    hoverBorder: '{spacing.hairline} solid {colors.dim-dark}'
    textTransform: uppercase
    disabledColor: '{colors.dim-dark}'
    focusOutline: '2px solid {colors.focus-ring-dark}'
    focusOutlineOffset: 2px
  button-destructive:
    background: transparent
    color: '{colors.alarm-dark}'
    typography: '{typography.button}'
    minHeight: 48px
    borderRadius: '{rounded.DEFAULT}'
    border: '{spacing.hairline} solid {colors.alarm-dark}'
    focusOutline: '2px solid {colors.focus-ring-dark}'
    focusOutlineOffset: 2px
  input:
    background: transparent
    color: '{colors.text-dark}'
    typography: '{typography.body}'
    minHeight: 44px
    paddingY: '{spacing.2}'
    borderRadius: '{rounded.DEFAULT}'
    border: none
    borderBottom: '{spacing.hairline} solid {colors.rule-dark}'
    borderBottomFocus: '{spacing.hairline} solid {colors.solar-ink-dark}'
    borderBottomError: '{spacing.hairline} solid {colors.alarm-dark}'
    placeholderColor: '{colors.faint-dark}'
    labelTypography: '{typography.label-caps}'
    labelColor: '{colors.dim-dark}'
    focusOutline: '2px solid {colors.focus-ring-dark}'
    focusOutlineOffset: 2px
  input-code:
    typography: '{typography.data-lg}'
    letterSpacing: 0.3em
    textTransform: uppercase
    borderBottom: '{spacing.hairline} solid {colors.rule-dark}'
  rank-builder:
    rankTypography: '{typography.data}'
    rankColor: '{colors.entropy-dark}'
    unrankedGlyph: '–'
    unrankedGlyphColor: '{colors.faint-dark}'
    summaryTypography: '{typography.label-caps-lg}'
    summaryColor: '{colors.text-dark}'
    rowMinHeight: 48px
  poll-card:
    background: transparent
    paddingY: '{spacing.6}'
    borderTop: '{spacing.hairline} solid {colors.rule-dark}'
    titleTypography: '{typography.poll-question}'
    metaTypography: '{typography.caption}'
    metaColor: '{colors.dim-dark}'
    statusTypography: '{typography.label-caps-lg}'
    statusColor: '{colors.dim-dark}'
  share-action:
    background: transparent
    color: '{colors.text-dark}'
    typography: '{typography.button}'
    paddingX: '{spacing.6}'
    paddingY: '{spacing.4}'
    minHeight: 48px
    borderRadius: '{rounded.DEFAULT}'
    border: '{spacing.hairline} solid {colors.rule-dark}'
    hoverBorder: '{spacing.hairline} solid {colors.dim-dark}'
    textTransform: uppercase
    urlTypography: '{typography.body}'
    urlColor: '{colors.text-dark}'
    confirmationLabel: 'LINK COPIED'
    confirmationTypography: '{typography.label-caps}'
    confirmationColor: '{colors.text-dark}'
    focusOutline: '2px solid {colors.focus-ring-dark}'
    focusOutlineOffset: 2px
  listing-badge:
    typography: '{typography.label-caps-lg}'
    unlistedColor: '{colors.dim-dark}'
    listedColor: '{colors.entropy-dark}'
    delistedColor: '{colors.alarm-dark}'
  sign-in:
    headingTypography: '{typography.heading-lg}'
    providerButton: '{components.button-secondary}'
    providerGap: '{spacing.3}'
    noteTypography: '{typography.caption}'
    noteColor: '{colors.dim-dark}'
  pagination:
    typography: '{typography.label-caps}'
    color: '{colors.entropy-dark}'
    colorDisabled: '{colors.dim-dark}'
    gap: '{spacing.6}'
    minHeight: 48px
    focusOutline: '2px solid {colors.focus-ring-dark}'
    focusOutlineOffset: 2px
  live-indicator:
    dotSize: 6px
    borderRadius: '{rounded.full}'
    dotColor: '{colors.solar-ink-dark}'
    labelTypography: '{typography.label-caps}'
    labelColor: '{colors.dim-dark}'
    pulseDuration: '{motion.pulse}'
    lostTypography: '{typography.caption}'
    lostColor: '{colors.text-dark}'
  trust-badge:
    typography: '{typography.label-caps-lg}'
    color: '{colors.text-dark}'
    iconColor: '{colors.entropy-dark}'
    gap: '{spacing.2}'
    borderTop: '{spacing.hairline} solid {colors.rule-dark}'
    paddingY: '{spacing.3}'
    wrap: 'one item per line'
    truncate: never
  round-table:
    borderCollapse: collapse
    cellPaddingY: '{spacing.3}'
    rowBorder: '{spacing.hairline} solid {colors.rule-dark}'
    headerTypography: '{typography.label-caps}'
    headerColor: '{colors.dim-dark}'
    cellTypography: '{typography.data}'
    eliminatedColor: '{colors.faint-dark}'
    eliminatedDecoration: line-through
    winnerColor: '{colors.solar-ink-dark}'
    tiedRule: '2px solid {colors.entropy-dark}'
  turnstile:
    theme: 'resolved color mode'
    appearance: 'interaction-only'
    borderRadius: 'vendor default — sanctioned exception to {rounded.DEFAULT}'
    marginY: '{spacing.4}'
  overlay:
    scrimDark: 'rgba(11, 13, 16, 0.82)'
    scrimLight: 'rgba(26, 32, 40, 0.36)'
    background: '{colors.panel-dark}'
    borderRadius: '{rounded.DEFAULT}'
    borderTop: '{spacing.hairline} solid {colors.rule-dark}'
    borderBottom: '{spacing.hairline} solid {colors.rule-dark}'
    boxShadow: none
    paddingY: '{spacing.6}'
    paddingX: '{spacing.5}'
    titleTypography: '{typography.heading-md}'
---

# Oddspark Polls — Design Spine

**This spine wins on conflict with any referenced image.** The screenshots in `.working/` and the key-screen mocks in `mockups/` are evidence and illustration; where either disagrees with a value or rule stated here, this document is correct and the image is stale.

## Brand & Style

Oddspark Polls is the polling product wearing the oddspark.dev face. The parent site is a single dark field with one glowing object in it, a monospaced instrument panel around the edges, and hairlines instead of boxes. Nothing is decorated; everything is labelled. That posture transfers directly: **a poll is one focal object on a quiet dark field, with the machinery legible around it.**

*Visual reference:* [`.working/oddspark-desktop.png`](.working/oddspark-desktop.png) shows the parent site at desktop width — the centered focal sun, the instrument-panel header readout (`● C1.1 · SUN NOW`), the hairline section rules, and the generous side air the layout section mirrors. [`.working/oddspark-mobile.png`](.working/oddspark-mobile.png) shows the same page at phone width, which is where the single-column, widen-don't-rearrange discipline is visible.

The style is **instrument-panel minimalism** — technical, calm, unhurried, closer to an observatory readout than to a SaaS dashboard. Monospace for anything the machine knows (options, counts, labels, codes, timestamps); a serif only for the things a human wrote (the poll question, page titles). No cards, no shadows, no rounded corners, no gradients. Whitespace does the grouping that borders would do elsewhere.

Two accents carry all the meaning the layout doesn't. **Entropy blue is data** — links, counts, bar fills, anything the system computed. **Solar gold is consequence** — the button you press, the option you picked, the slot that won, the poll that's live. Gold appears rarely enough that when it shows up, you look at it. This is the sun in the middle of oddspark.dev, redeployed as a UI rule.

The product must read as a *casual poll card* — one question, tappable options, instant results — and never as a survey form (PRD §5, a named NFR). The calm here is the calm of something well-built, not the calm of enterprise beige. Where that tension shows up in copy it resolves as **wry**: dry, understated, delivered flat, never zany or pun-heavy. Microcopy patterns and the full example set live in `EXPERIENCE.md § Voice and Tone`.

**Both modes ship.** Dark is the native mode and is inherited from oddspark.dev. Light is derived and must feel like the same instrument in a lit room — same two accents, same hairlines, same three-step text hierarchy, same square corners. `[ASSUMPTION: mode follows the OS preference by default with a manual override persisted locally; there is no mode-choice prompt on first visit.]`

## Colors

The palette is deliberately small: one background, one raised surface, one hairline, three greys of text, two accents. Every token exists in a `-dark` and a `-light` form.

**Naming note, deviating from the spec's usual bare/`-dark` convention:** both modes carry an explicit suffix, because neither one is "the default."

*Visual reference:* every dark-mode hex below was sampled from [`.working/oddspark-desktop.png`](.working/oddspark-desktop.png) — the page field, the panel tone behind the header readout, the hairline rules, the three text greys, and both accents. [`.working/oddspark-mobile.png`](.working/oddspark-mobile.png) confirms the same values hold at phone width. The derived light palette was judged against the key-screen mocks, not against these images.

**Light-mode resolution.** A component token that references a `-dark` color resolves in light mode by swapping the suffix to `-light`. That rule is complete *except* where a component binds an explicit `…Light` twin, which then wins. There are three such exceptions: `results-bar.leaderMarkerColorLight` and `availability-cell.yesGlyphColorLight` are the same problem — gold on a light field — and `overlay.scrimLight` is the light-mode scrim. Everything else swaps.

**Dark mode — inherited from oddspark.dev:**

- `{colors.void-dark}` `#0B0D10` — the page. Nearly black with a blue cast. Never pure `#000`.
- `{colors.panel-dark}` `#101419` — the only raised surface tone. Results-bar tracks, hover fills, overlay bodies. One step up from void and no more; there is no second elevation. It is a *tonal* step, not a perceptual one (1.05:1) — anywhere a surface has to be legible as a shape rather than a shade, a hairline does the work. See `{components.results-bar.baselineRule}`.
- `{colors.rule-dark}` `#1D242C` — hairlines. The single structural device in the system: section dividers, table rows, option separators, input underlines.
- `{colors.text-dark}` `#C6CFD8` — primary reading text. Soft off-white, never `#FFF`.
- `{colors.dim-dark}` `#78848F` — secondary: labels, metadata, timestamps, helper text, the second line of anything. **One deliberate deviation from verbatim inheritance:** oddspark.dev's `--dim` is `#67737F`, which measures 4.02:1 on void and 3.82:1 on panel. `dim` carries the trust badge, the live-indicator label, poll-card metadata, comment attribution, table column heads, and toggle descriptions — all essential information, much of it at 11–12px. `#78848F` clears the floor at **5.09:1 on void** and **4.84:1 on panel** and is still visibly the middle step of the three.
- `{colors.faint-dark}` `#3D4750` — tertiary: placeholders, unanswered availability cells, decorative glyphs. **Not for text a user needs to read** — it measures 2.05:1 on void by design. Disabled controls and closed-Poll status do not use it; see `{components.button-primary.disabledColor}` and `{components.poll-card.statusColor}`.
- `{colors.entropy-dark}` `#6E8FB8` — the data accent. Links, counts, bar leading edges, the *if-need-be* state, anything computed.
- `{colors.solar-dark}` `#C9A227` — the action accent, **as a fill only**: primary button backgrounds, wash fills, the availability *yes* fill. Used sparingly on purpose: if two golds are visible in one viewport, one of them is wrong.
- `{colors.solar-ink-dark}` `#C9A227` — the action accent **as ink**: every gold glyph, marker, rule, edge, underline, and dot. Identical to `solar-dark` in dark mode and deliberately a separate token, because it is not identical in light mode. See below.
- `{colors.focus-ring-dark}` `#C9A227` — the focus outline color, referenced by every component's `focusOutline`. 8.04:1 on void.

**Light mode — derived, not extracted.** These values were designed here rather than sampled from oddspark.dev, which is dark-only; they are decisions, and they were approved against the rendered key-screen mocks. Treat them as binding; there is no source to check them against.

- `{colors.void-light}` `#F5F7F9` — cool paper, not warm cream. The blue cast of void, inverted.
- `{colors.panel-light}` `#FFFFFF` — raised surfaces go *up* to white, preserving the one-step void→panel relationship dark mode has.
- `{colors.rule-light}` `#D8DEE4` — hairlines, same weight and same role.
- `{colors.text-light}` `#1A2028`, `{colors.dim-light}` `#5A6773`, `{colors.faint-light}` `#9AA6B2` — the same three-step hierarchy at the same perceptual spacing.
- `{colors.entropy-light}` `#3D6491` — the blue accent darkened to stay readable as link text on paper. Same hue family; do not substitute a different blue.
- `{colors.solar-light}` `#C9A227` — identical to dark. Gold as a *fill* is unchanged in both modes, which keeps the primary button pixel-identical across modes and holds the brand constant.
- `{colors.solar-ink-light}` `#8A6D10` — gold as *ink*. `#C9A227` type on paper measures 2.25:1 and is not readable; `#8A6D10` measures **4.57:1 on void-light** and **4.91:1 on white**. Every glyph, marker, rule, edge, underline, and dot that is gold in dark mode uses this in light mode.
- `{colors.solar-ink-on-wash-light}` `#6E560B` — the one place `solar-ink-light` isn't enough: a gold glyph sitting on `solar-wash-light` over white measures 3.91:1. `#6E560B` on the same composite measures **5.57:1**. Used by `{components.availability-cell.yesGlyphColorLight}` and nowhere else. Dark mode needs no equivalent — `solar-ink-dark` on `solar-wash-dark` is already fine.
- `{colors.focus-ring-light}` `#8A6D10` — the focus outline in light mode. `solar-light` as a ring would be 2.25:1 against paper, below the 3:1 a focus indicator needs to exist at all; `#8A6D10` clears it at 4.57:1. Shape is unchanged: a 2px square outline at 2px offset. **Every component object that can take focus binds its `focusOutline` to the focus-ring token rather than to `solar` directly**, so the light-mode ring is correct by construction rather than by remembering.
- `{colors.on-solar-dark}` and `{colors.on-solar-light}` are both `#0B0D10` — void text on a gold fill, in both modes.

**Gold rarity, and the two-golds rule.** Gold means *consequence*, and exactly one thing per surface may carry it. On the voting surface that is the Voter's selected option and the vote button. On the Tally it is **the leading bar, and only the leading bar** — a Voter's own ballot is never echoed back to them as gold-marked option rows next to a gold leader bar. It renders instead as a single text-only `YOUR BALLOT` line above or beside the bar group, set in `{typography.label-caps}` `{colors.dim-dark}` with the choice itself in `{typography.body}` `{colors.text-dark}`, carrying no `◆` and no gold at all. Two golds on one surface is the failure mode this rule exists to prevent. Cross-referenced from `EXPERIENCE.md § State Patterns`.

**Embedded editable Demo exception.** The combined landing surface contains a selected ballot, its primary `VOTE` action, and a simultaneously visible Tally. In that embedded editable Demo only, every bar retains the normal entropy wash/edge; a unique leader keeps the non-gold `◆` and accessible leading state, while an exact tie keeps neither marker nor leader and says `TIED`. The ballot owns exactly one trust badge and the nested Tally suppresses its duplicate. Once the ballot is read-only, canonical gold leadership and Tally-owned trust treatment return. This changes no token and no canonical Tally behavior.

**Washes.** `{colors.entropy-wash-dark}` and `{colors.solar-wash-dark}` (and their light twins) are the low-alpha fills used inside results bars and availability cells. They are alpha values, not opaque hexes, so they composite correctly over both `void` and `panel`. A wash never carries *body* text-contrast responsibility: labels sitting on a wash use `{colors.text-dark}` and stay readable because the wash is thin (8.59:1 over `entropy-wash-dark`, 7.67:1 over `solar-wash-dark`).

**Glyph-on-wash is the exception**, and its combinations are load-bearing, so they are measured rather than asserted. `{colors.entropy-dark}` on `entropy-wash-dark` over `panel-dark` is **4.05:1**; `{colors.solar-ink-dark}` on `solar-wash-dark` over `panel-dark` is **4.55:1**; `{colors.solar-ink-on-wash-light}` on `solar-wash-light` over white is **5.57:1**. The entropy pair clears the 3:1 non-text bar but sits under 4.5:1 and is accepted at that value, because the availability state it carries is never conveyed by the glyph's color alone — the glyph shape and the fill carry it together.

**Alarm.** `{colors.alarm-dark}` `#B8705E` / `{colors.alarm-light}` `#9A4B33` `[ASSUMPTION: no error color exists on oddspark.dev; derived as a desaturated brick in the same muted family rather than a saturated red]`. Used for destructive confirmation (deleting a Poll) and for rejection-state headings. Deliberately *not* loud — a duplicate-vote rejection is the product working correctly, not a system failure, and must not look like one. Measured at 5.11:1 / 4.86:1 dark and 5.70:1 / 6.13:1 light.

**Contrast floor** (PRD §5, "sensible contrast"). These are measured against `void` and `panel` in each mode, not asserted:

| Pair | Dark | Light |
|---|---|---|
| `text` on void / panel | 12.34 / 11.72 | 15.26 / 16.39 |
| `dim` on void / panel | 5.09 / 4.84 | 5.40 / 5.80 |
| `entropy` on void / panel | 5.82 / 5.53 | 5.70 / 6.12 |
| `solar-ink` on void / panel | 8.04 / 7.64 | 4.57 / 4.91 |
| `focus-ring` on void / panel | 8.04 / 7.64 | 4.57 / 4.91 |
| `on-solar` on `solar` / `solar-hover` | 8.04 / 9.69 | 8.04 / 9.69 |
| `alarm` on void / panel | 5.11 / 4.86 | 5.70 / 6.13 |

Every one clears 4.5:1 in both modes. `faint` does not (2.05:1 dark, 2.48:1 light) and is restricted to placeholders, unanswered cells, and decorative glyphs whose meaning is carried elsewhere.

**Hairline visibility is a decision, not an oversight.** `rule-dark` on `void-dark` is 1.24:1 and `rule-light` on `void-light` is 1.26:1 — far below 3:1. Reaching 3:1 would put `rule` near `#5A6670` and destroy the identity the whole system is built on. Hairlines separate static content rather than identifying controls, and no control's boundary depends on one: option rows are carried by the 48px rhythm and the fixed marker gutter, results bars by their baseline rule and fill extent. Accepted deliberately at this value.

## Typography

Two families, straight from oddspark.dev, doing two distinct jobs. *Visual reference:* both are legible in [`.working/oddspark-desktop.png`](.working/oddspark-desktop.png) — Newsreader in the page's opening statement, Courier Prime in the header readout and every label around it — with the letterspaced-uppercase label treatment most visible in [`.working/oddspark-mobile.png`](.working/oddspark-mobile.png).

**Courier Prime** is the machine voice and carries the overwhelming majority of the interface: body text at `{typography.body}` 14px, option labels, counts, metadata, buttons, form fields, codes, table cells. Being monospaced, it gives tabular figures for free — vote counts and percentages never reflow as they tick, which the results bar depends on.

**Newsreader** at regular weight is the human voice: the poll question (`{typography.poll-question}`), page and section titles, the landing page's opening statement. Its job is to make the one thing a person actually wrote look like a person wrote it, on a page otherwise built out of readouts. Never bold it; the parent site never does.

**Label discipline.** `{typography.label-caps}` — uppercase, 11px, 0.18em tracking, in `{colors.dim-dark}` — is the system's structural annotation: section headers, field labels, toggle names, table column heads, the live indicator. This is the single most identity-carrying type detail on oddspark.dev. Use it liberally, and never substitute a sentence-case label for it.

**`{typography.label-caps-lg}` is the same treatment for labels that carry information rather than structure** — same family, same caps, same 0.18em tracking, at 12px and in `{colors.text-dark}` rather than `dim`. Uppercase plus heavy tracking removes word-shape, which is fine when a reader is scanning for position and costly when they are reading for content. Use it for: the trust badge, `TIED`, the lost-connection notice, `CLOSED`, `RANKED {n} OF {total}`, the `122 VOTERS · 208 SELECTIONS` line, and the timezone line. The two variants are indistinguishable at a glance; only the reading load changes.

**Ramp:** `display` (40px, dropping to `display-mobile` 30px below `{breakpoints.sm}`) → `poll-question` 26px → `heading-lg` 24px → `heading-md` 19px → `body-lg` 16px → `body` 14px → `caption` 12px → `label-caps-lg` 12px → `label-caps` 11px. `data` and `data-lg` are the bold-weight Courier Prime reserved for numbers that matter: percentages, vote counts, round tallies, availability totals, Voter Codes.

**`body-lg` is for any multi-sentence block on any surface**, not just landing-page prose. Courier Prime's x-height is roughly 0.42em, so 14px monospace has the apparent size of about 11px in a humanist sans, and monospace removes the word-shape cues that make sustained prose fast. That is fine for option labels, counts, timestamps, and codes — short, glanceable, and better tabular. It is not fine for the rejection and explanation copy in `EXPERIENCE.md § Voice and Tone` (the IP-check and VPN messages run three sentences), for comment bodies, or for Security Toggle descriptions, which are the whole point of the toggle and are set in `body` rather than `caption` for that reason.

Body copy caps at `{spacing.measure}` 68ch.

## Layout & Spacing

An 8px base unit. Mobile margins are `{spacing.margin-mobile}` 20px; desktop opens to `{spacing.margin-desktop}` 48px with content centered and capped, mirroring the parent site's generous side air.

**Mobile-first, single column, scaling by widening rather than rearranging.** oddspark.dev's desktop layout is its mobile layout with the second block moved beside the first, and this product follows the same discipline: no layout gains a component at a larger breakpoint, and nothing is hidden at a smaller one.

- below `{breakpoints.sm}` — one column. Poll question, options, then results stacked below.
- `{breakpoints.sm}` to below `{breakpoints.lg}` — one column, wider margins; results still below options.
- `{breakpoints.lg}` and up — two columns wherever a live Tally or a second block earns the width: the post-vote surface (ballot left, live Tally right); any poll surface whose Tally is visible alongside the vote form (form and context left, live Tally right); the standalone Results route (question and context left, Tally right); the landing page (statement and build notes left, Demo Poll right — with the Demo Poll's own vote-form/Tally split inside its column — and the `landing-footer` spanning the full shell width below the grid, outside both columns); and the creator surface (Poll list left, selected Poll's detail right). Wide shells cap at `{spacing.measure-wide}` 1280px so ultra-wide windows still buy air, not density. Everything else stays single-column and centered.

`{spacing.section-gap}` 56px separates major blocks and is where a hairline goes if one is needed. Related items sit 8–16px apart. **Whitespace is the grouping mechanism.** If something looks ungrouped, add space before you add a rule, and add a rule before you ever add a box.

## Elevation & Depth

There is no elevation. No shadows anywhere, in either mode — not on buttons, not on overlays, not on hover.

Depth is expressed two ways only:

1. **Tone.** `void` → `panel` is the entire z-axis. One step, no second step. A results-bar track, a hover fill, and an overlay body all sit at `panel`; nothing sits above it. The step is 1.05:1 in dark and 1.07:1 in light — real but not perceptual, which is deliberate and which is why nothing that must be *seen* as a shape relies on it alone.
2. **Hairlines.** `{colors.rule-dark}` at 1px separates. A hairline says "these are different things." It never encloses — rules run edge to edge or margin to margin and are never assembled into a rectangle around content. Where a tonal surface would be invisible — the empty or skeleton results bar — the hairline is what makes it a shape; see `{components.results-bar.baselineRule}`.

Overlays (delete confirmation, the Voter Code list) dim the page with `{components.overlay.scrimDark}` in dark and `{components.overlay.scrimLight}` in light `[ASSUMPTION]`, then place the panel content flat on top with a single top and bottom hairline. No shadow, no scale-in.

## Shapes

**Zero radius, everywhere.** `{rounded.DEFAULT}` is `0` and so are `sm` through `xl`. Buttons, inputs, results bars, images, availability cells, overlays: square. This is inherited from oddspark.dev's STRIKE button and is not negotiable — a single rounded corner reads as a different product.

`{rounded.full}` exists for exactly one thing: the 6px live-indicator dot, which is a light rather than a container. Image Poll images (Phase 2) are square-cropped and square-cornered, presented as plates rather than cards.

The one sanctioned exception is `{components.turnstile}`, a third-party iframe whose chrome is Cloudflare's and is not ours to restyle. See its entry below.

## Components

Each heading leads with the frontmatter token name, which is the canonical identifier shared with `EXPERIENCE.md § Component Patterns`.

### `poll-option` — Poll option (voting surface, Phase 1)

*Rendered: [`mockups/key-voting.html`](mockups/key-voting.html), both modes at 375px.*

A full-width row, minimum 48px tall, separated from its neighbours by a bottom hairline. Not a bordered box, not a card. Label in `{typography.body}` `{colors.text-dark}`, left-aligned, with a fixed-width marker gutter at its left edge.

The marker is a monospace glyph rather than a visible native radio or checkbox: `·` unselected in `{colors.faint-dark}`, `◆` selected in `{colors.solar-ink-dark}` for single-select; `[ ]` / `[×]` for multi-select. **The control underneath is still a native `<input type="radio">` or `<input type="checkbox">`, visually hidden, with the row as its `<label>`; the marker is drawn from the label's `::before` and is decorative.** That is what keeps the glyphs out of the accessible name — `·`, `◆`, `[ ]` and `[×]` would otherwise be spoken as punctuation — while giving roles, checked state, arrow-key group navigation and `Space` for free. The visual spec is unchanged by this; only the implementation is pinned.

Hover fills the row `{colors.panel-dark}` — a near-no-op at 1.05:1, and deliberately so; the focus outline, not the hover fill, is what carries the affordance. Focus draws `{components.poll-option.focusOutline}` offset 2px outside the row. Selection is the *only* place gold appears on the voting surface besides the vote button, so the thing you chose is unmistakable.

Image Poll options (Phase 2) replace the label with a square image plate at full column width, caption below in `{typography.caption}`, and the same marker gutter.

**The Visibility Setting chooser reuses this component.** It is the product's only three-way exclusive control and it needs no new one: three `poll-option` rows on the creator surface with single-select markers, each carrying its consequence line beneath the label in `{typography.body}` `{colors.dim-dark}`.

### `results-bar` — Results bar (the signature component, Phase 1)

*Rendered: [`mockups/key-tally.html`](mockups/key-tally.html) — dark phone and light desktop two-column.*

This is what the product is for. Everything else can be quiet; this has to be worth watching.

**Anatomy.** One 34px-tall (38px desktop) square block per option, stacked 4px apart, each sitting on a `{components.results-bar.baselineRule}` 1px `{colors.rule-dark}` baseline. The baseline is not decoration: `void`→`panel` is 1.05:1, so a track with no fill would otherwise be invisible, and the cold-load skeleton and the empty-Poll zero state both depend on the bar group reading as ruled bands before it has data. The track is `{colors.panel-dark}`. The fill is a low-alpha wash — `{colors.entropy-wash-dark}` — growing from the left edge, with a **2px full-opacity `{colors.entropy-dark}` leading edge** at its right terminus. The leading edge is the component's whole trick: the wash gives you the shape, the bright edge gives you the position, and the edge is what your eye tracks when it moves.

Label and value sit *inside* the bar, vertically centered: option label left in `{typography.body}`; at the right, the percentage in `{typography.data}` followed by the raw count in `{typography.caption}` — `47% · 122`. **Both stay `{colors.text-dark}`**, including the count: the count is differentiated from the percentage by the `caption` size step, never by color. (There is deliberately no `countColor` token — `dim` inside a bar measures 2.80:1 over `entropy-wash` and 2.50:1 over `solar-wash`.) The wash is thin enough that text reads identically over filled and unfilled regions. On multi-select Polls the Voter count appears once above the bar group as a `{typography.label-caps-lg}` line — `122 VOTERS · 208 SELECTIONS` — because per-option counts summing past the Voter count otherwise looks like a bug (FR-7).

**Leader treatment.** The option currently in first place swaps its fill to `{colors.solar-wash-dark}`, its leading edge to `{colors.solar-ink-dark}`, **and prefixes its value cluster with `{components.results-bar.leaderMarker}` `◆` in `{colors.solar-ink-dark}`** — `◆ 47% · 122`. The marker is the part that matters: composited over `panel-dark`, `solar-wash` and `entropy-wash` differ by 1.12:1 and their leading edges by 1.38:1, so hue alone cannot carry leadership, and bar length cannot rescue it where leadership matters most — a near-tie, where the lengths are indistinguishable. The `◆` is the same glyph a selected option uses, costs one character of width, and needs no box.

Exactly one bar can be gold. On an exact tie for the lead, **no bar is gold and no bar carries the `◆`** — all tied bars stay blue and a `{typography.label-caps-lg}` line above the group reads `TIED`. This makes `TIED` legible as the absence of a mark rather than the absence of a hue. Gold means "this one is winning," and it must never lie.

**The Voter's own ballot is not marked here.** See § Colors, "Gold rarity, and the two-golds rule": on the Tally the leader owns gold, and the Voter's own choice renders as a text-only `YOUR BALLOT` line.

**Motion.** Width transitions over `{motion.bar-transition}` on `{motion.ease}` — fast out of the gate, long settle, no overshoot and no bounce. When a bar's value increases, its leading edge flashes to 4px for `{motion.spark}` and settles back to 2px: the spark. Numbers count up over `{motion.count-up}` in monospace, so digits change in place without a pixel of reflow. A leader change cross-fades over `{motion.leader-crossfade}`.

Those four plus the `{motion.pulse}` live-indicator dot are **the five motion primitives, and the whole of what animates in this product.** They live in the `motion` token group and are referenced by name everywhere — the frontmatter, this section, and `EXPERIENCE.md § Interaction Primitives` — rather than restated as raw durations, so a timing change is one edit. Full choreography, ordering rules, and the reduced-motion contract are in `EXPERIENCE.md § Live Results & Motion`.

**What it must never do:** reorder itself while someone is reading it; animate on initial paint (first render is instantaneous at final width — animation is reserved for *change*); render as a pie by default; or render a percentage without its raw count beside it.

### `chart-form-toggle` — Chart form toggle (Tally, Phase 1)

Two label-caps text options separated by a middot — `BARS · PIE` — sitting above the bar group with a hairline beneath. The current form is `{colors.solar-ink-dark}`; the other is `{colors.dim-dark}`. **No icon**, no segmented control, no pill, no box: it is two words and a rule, in the same idiom as every other label in the system. 48px minimum touch height on the row, `{components.chart-form-toggle.focusOutline}` on focus.

`BARS` is the default and the only animated form. `PIE` exists because FR-21 permits it, and it is a secondary view a reader chooses, never a form the product picks. Behavior — persistence scope, what the pie renders, and what it does *not* animate — is in `EXPERIENCE.md § Component Patterns`.

### `security-toggle` — Security Toggle (creator surface, Phase 1)

A 40×20px square track with a 16px square knob: a switch built out of rectangles, no pill. Off — `{colors.rule-dark}` track, `{colors.text-dark}` knob at left. On — `{colors.solar-wash-dark}` track, `{colors.solar-ink-dark}` knob at right. Name in `{typography.label-caps}`, one-line explanation beneath in `{typography.body}` `{colors.dim-dark}`. Every Toggle explains its own cost to the Voter, because that is the decision the Creator is actually making, and the explanation is set in `body` rather than `caption` precisely because it is the point rather than an annotation.

**The whole row is the hit area.** The name and the description sit inside the `<label>`, so the target is the row rather than the 40×20px track.

**Locked state** — after the first Vote, when a Toggle is on and can no longer be turned off (FR-15 tighten-only): the track holds its **full-strength** on appearance (`{components.security-toggle.trackLocked}`), the knob drops to `{colors.dim-dark}` to remove the affordance without removing the state, and the word `LOCKED` appears beside the name in `{typography.label-caps}` `{colors.dim-dark}`. **There is no opacity mechanism** — a 0.24-alpha wash at 55% opacity computes to 1.21:1 against void, which renders a locked-on Toggle as an empty rectangle, i.e. as its own opposite. The state is carried by text and by knob color, not by a tone. Locked Toggles are never hidden or greyed past legibility; the Creator needs to see what is protecting the Poll even when they can't change it.

### `availability-cell` — Availability grid cell (Meeting Polls, Phase 3)

A 48×48px square with a 1px `{colors.rule-dark}` border, sharing borders with its neighbours in a collapsed grid. The 48px matches the voting-surface tap-target floor in `EXPERIENCE.md § Interaction Primitives`; three 48px targets plus a slot label fit a 320px viewport at the 20px mobile margin.

- **Yes** — `{colors.solar-wash-dark}` fill, `✓` in `{colors.solar-ink-dark}` (light mode: `{colors.solar-ink-on-wash-light}`, the one glyph in the system that needs the deepened on-wash gold).
- **If-need-be** — `{colors.entropy-wash-dark}` fill, `~` in `{colors.entropy-dark}`.
- **No** — no fill, `×` in `{colors.dim-dark}`. **Not `faint`:** *No* is an answer, not an absence, and at 2.05:1 a low-vision Voter cannot distinguish "I declined this slot" from "I haven't answered yet" — which is the difference between a submitted answer and an omission, on the one Vote in the product that can be edited.
- **Unanswered** — no fill, `·` in `{colors.faint-dark}`. This one is correctly the null state and stays faint.

State is carried by glyph *and* fill together, never by color alone. Column totals sit below the grid in `{typography.data}`; the ranked-best column gets a 2px `{colors.solar-ink-dark}` top rule spanning its width. Tied-best columns all get the rule, per FR-14's "highlighted together."

### `comment` — Comment (Phase 1)

Body in `{typography.body-lg}` `{colors.text-dark}` — a comment is a multi-sentence block and takes the 16px step — with an optional display name above in `{typography.label-caps}` `{colors.dim-dark}` (falling back to `ANONYMOUS`), separated from the previous Comment by a top hairline. No avatar, no bubble, no reply affordance — a Comment is a margin note on a Tally, not a thread. The composer and the read-only list share this spec; their differing behavior is in `EXPERIENCE.md § Component Patterns`.

### `button-primary` / `button-secondary` / `button-destructive` — Buttons

- **`button-primary`** — `{colors.solar-dark}` fill, `{colors.on-solar-dark}` text, `{typography.button}` (13px, 700, 0.22em tracking, uppercase), 48px minimum height, generous horizontal padding, zero radius. This is the STRIKE button from oddspark.dev reused verbatim. **One primary button per screen**, and on the voting surface it is always the vote action — the "vote button" referred to throughout `EXPERIENCE.md` is this component.
- **Pending** — while a Vote is in flight, the label swaps to `{components.button-primary.pendingLabel}` `COUNTING…` and the button disables. **No spinner, no progress bar, no invented indicator**: the state is type, like everything else in the system.
- **`button-secondary`** — transparent fill, 1px `{colors.rule-dark}` border, `{colors.text-dark}` text, same type and metrics. Hover lifts the border to `{colors.dim-dark}`.
- **`button-destructive`** — secondary metrics with `{colors.alarm-dark}` text and border. Only ever appears behind a confirmation.
- **Disabled** — `{colors.dim-dark}` text on transparent, no border change. **Not `faint`:** at 2.05:1 the primary action reads as absent rather than as waiting, and disabled is the *first* state a Voter sees on a min-selection or ranked Poll. A `{typography.label-caps}` hint above it says what unlocks it.

### `input` / `input-code` — Inputs

No box. A transparent field with a 1px `{colors.rule-dark}` bottom rule that goes `{colors.solar-ink-dark}` on focus, `{typography.body}` text, `{colors.faint-dark}` placeholder, and a `{typography.label-caps}` `{colors.dim-dark}` label above. 44px minimum height, and the focus ring is `{components.input.focusOutline}` in addition to the underline change — a color change alone is never the focus indicator.

`input-code` is the one exception in metrics: `{typography.data-lg}` 20px with 0.3em letter-spacing, since it's a code being transcribed by hand. Errors put a `{colors.alarm-dark}` bottom rule and a `{typography.caption}` message directly beneath the field. Never a tooltip, never a modal.

Date and time fields in the Slot builder (Phase 3) are the only input types not covered here; they defer with the phase and need a spec before Phase 3 ships.

### `rank-builder` — Rank builder (voting surface, Phase 2)

Rank rows are `poll-option` rows with the marker gutter carrying the rank number in `{typography.data}` `{colors.entropy-dark}` instead of a selection glyph; unranked rows show `–` in `{colors.faint-dark}`. Row minimum height stays 48px.

Above the group, the summary line in `{typography.label-caps-lg}` `{colors.text-dark}`: `RANKED {n} OF {total} · UNRANKED OPTIONS COUNT AS NO PREFERENCE`. It is information rather than structure, which is why it takes the 12px text-color variant, and it doubles as the group's live region (see `EXPERIENCE.md § Accessibility Floor`).

### `poll-card` — Poll card (creator Poll list, landing page, Discover, Phase 1)

Not a card. A row: title in `{typography.poll-question}`, a `{typography.caption}` `{colors.dim-dark}` metadata line (`MULTIPLE CHOICE · 122 VOTES · CLOSES IN 3H`), separated from its neighbours by a top hairline. Live Polls carry the live indicator; closed Polls carry `CLOSED` in `{typography.label-caps-lg}` `{colors.dim-dark}` — a Poll's primary status is essential information, and `faint` at 2.05:1 would break the system's own "no `faint` on text a user has to read" rule.

**The `/discover` catalog reuses this row unchanged** — same title, same metadata line, same hairline rhythm, the whole row one tap target. For an open, Listed Poll, the Vote number is public accepted-Vote attendance even when the Visibility Setting withholds the Tally; it never implies permission to show option/round counts, percentages, selections, or Comments. Discover shows only open, Listed Polls, so every row carries the live indicator and none carries `CLOSED`. The catalog paginates newest-first with `NEWER` / `OLDER` text controls per `{components.pagination}` — label-caps entropy links at 48px targets, the exhausted end rendered `{colors.dim-dark}` and inert. Never infinite scroll, never a card grid.

### `share-action` — Share action (create confirmation, voting page, Tally, Phase 1)

A text-labelled `SHARE` button in `button-secondary` metrics — transparent fill, 1px `{colors.rule-dark}` border lifting to `{colors.dim-dark}` on hover, `{typography.button}` — sitting beside the Poll's canonical URL, which renders as selectable `{typography.body}` `{colors.text-dark}` text. Never `button-primary`: there is one primary action per screen, and on the voting surface it is the vote. The copy confirmation is `{components.share-action.confirmationLabel}` in `{typography.label-caps}` `{colors.text-dark}` beside the control, persisting until the next interaction — the same idiom as the codes-copied confirmation, and not a toast. No vendor logos, no brand colors, no icon-only treatment: the action is a word in the product's own voice, which is also what keeps it honest in both color modes. Behavior — Web Share API enhancement, clipboard fallback, the no-JavaScript baseline — is in `EXPERIENCE.md § Component Patterns`.

### `public-repository-link` — Public repository entry (landing and public Poll footer, Phase 1)

One presentation component owns the repository destination. On the landing
page it renders inside the `landing-footer` as `VIEW REPOSITORY`, and the
build-account copy loses its trailing pointer — it ends at "The code is
public." rather than "see the repository.", because the referent is no longer
adjacent and the product never describes where anything is on the page
(`EXPERIENCE.md § Responsive & Platform`).
On canonical voting and every existing non-404 Results state it renders `VIEW
THE PUBLIC REPOSITORY` after the Share block, separated by one top hairline and
`{spacing.10}` / `{spacing.6}` whitespace. The link uses
`{typography.label-caps}` and `{colors.entropy-dark}`, has a 44px minimum target
on Poll surfaces (48px inside the `landing-footer`, matching its neighbours),
and takes the standard mode-resolved 2px focus outline at 2px offset. It opens
in the same tab, contains no icon or brand color, and has no JavaScript or
hydration behavior. The embedded landing Demo and creator, auth,
administration, moderation, and not-found surfaces never render the footer.

### `landing-footer` — Landing footer (landing page only, Phase 1)

A full-width band closing the landing page, separated from the content above by a single top hairline at `{spacing.section-gap}` distance, sitting inside the page shell (`{spacing.measure-wide}` at lg) rather than either grid column. The band is a `<footer>` landmark containing the byline and a `<nav aria-label="Landing">` — the byline is attribution, not navigation, and does not belong inside the nav landmark. One row: the Hearn byline at the left edge; `CREATE A POLL`, `DISCOVER POLLS`, and `VIEW REPOSITORY` at the right, in that order `[ASSUMPTION: link order and left/right grouping]`. The three links follow the product's text-link idiom — `{typography.label-caps}` `{colors.entropy-dark}` lifting to `{colors.text-dark}` on hover, 48px targets, the standard focus outline — the same idiom `{components.pagination}` uses for its `NEWER` / `OLDER` controls, so the footer adds no new link style to the system.

The byline is the oddspark.dev footer line verbatim: lowercase `built by` in `{typography.body}` `{colors.dim-dark}` followed by one real space and the **Hearn. wordmark SVG** inline (the asset shipped in oddspark.dev's worker, `role="img"`, `aria-label="Hearn."`, `fill: currentColor`, height `.78em`, baseline-aligned, `{spacing.1}`-scale left margin) — the space keeps the link's computed accessible name "built by Hearn." rather than "built byHearn." `[ASSUMPTION: byline type size — the reference renders it at body copy size]`. The whole byline is one link to `https://hearn.systems` with `rel="noopener"`, opening in the same tab like every other footer entry, with a **44px minimum block target** (the product floor for non-voting controls); on hover the entire line — text and wordmark together — lifts to `{colors.text-dark}`. The wordmark is the only image in the product's chrome and the only external attribution anywhere; it never appears on any other surface.

The footer renders on **every** landing variant — intro-first, outcome-bearing (demo-first), and the 503 `demo-unavailable` state: it is page chrome below `<main>`, not part of the Demo region, so a failed Demo never takes the navigation down with it. Below `{breakpoints.sm}` the row wraps: the byline holds the first line and the three links stack beneath it, left-aligned at 48px targets, in the same order `[ASSUMPTION: mobile stacking order]`. Nothing is hidden and nothing is rearranged beyond the wrap — the widen-don't-rearrange discipline holds.

### `listing-badge` — Listing state badge (creator surface, Phase 1)

A `{typography.label-caps-lg}` word — `UNLISTED`, `LISTED`, or `DELISTED` — on each creator `poll-card` and on the Poll detail, beside the Poll's open/closed status. Unlisted renders `{colors.dim-dark}` — the default needs no emphasis. Listed renders `{colors.entropy-dark}` — a data fact about where the Poll appears. Delisted renders `{colors.alarm-dark}` — the one state the Creator must not miss. The word carries the state and the color annotates it; the system's no-color-alone rule applies here as everywhere. The opt-in control at creation reuses the `poll-option` single-select chooser, exactly as the Visibility Setting chooser does, with each state's consequence in a `{typography.body}` `{colors.dim-dark}` line beneath its label; in the Delisted state the control renders read-only with the moderation line.

### `sign-in` — Sign-in entry (Phase 1)

A centered single column, in the same widen-don't-rearrange discipline as everything else: a `{typography.heading-lg}` line, then two full-width `button-secondary` buttons — `CONTINUE WITH GOOGLE` and `CONTINUE WITH GITHUB` — stacked `{spacing.3}` apart, then a `{typography.caption}` `{colors.dim-dark}` note that voting never needs an account. No vendor brand colors and no vendor logos: both buttons are the product's own secondary button with the provider named in words.

### `live-indicator` — Live indicator

A 6px `{colors.solar-ink-dark}` dot — the one round thing in the system — beside `LIVE` in `{typography.label-caps}` `{colors.dim-dark}`. The dot pulses opacity 1.0 → 0.4 → 1.0 over `{motion.pulse}`. Lifted directly from oddspark.dev's `● C1.1 · SUN NOW` header readout. Under reduced-motion it holds at full opacity.

When the live connection is lost, the indicator is replaced in place by the lost-connection notice: `{typography.label-caps-lg}` `{colors.text-dark}` — 12px and full text color rather than 11px `dim`, because it is a warning and the only thing standing between a reader and silently stale numbers, not a structural annotation.

### `trust-badge` — Trust badge (voting surface and Tally, Phase 1)

A `{typography.label-caps-lg}` `{colors.text-dark}` line above the vote button listing the protections active on this Poll — `ONE VOTE PER BROWSER · CAPTCHA` — with a small `{colors.entropy-dark}` glyph. No border, no chip, no box: a hairline above it, and that's all. It takes the 12px text-color label variant because it is the product's core trust claim, which is information rather than structure.

**Wrapping.** When the items don't fit one line at 375px, they **stack one per line**, in order. Each line keeps the same left edge as the first — the glyph hangs outside the text column so wrapped lines align with the text above them rather than with the glyph. **Never truncate and never abbreviate**: a trust claim that ends in an ellipsis is worse than no trust claim, and the whole point of the badge is that a reader can see the complete list of what is protecting this Poll. Behavior and copy rules are in `EXPERIENCE.md § Trust Surfaces`.

### `round-table` — Round table (Ranked-Choice Tally, Phase 2)

A borderless table with hairline row rules. Column heads in `{typography.label-caps}` `{colors.dim-dark}`; cells in `{typography.data}`. Eliminated options render `{colors.faint-dark}` with a strikethrough from the Round of their elimination onward — the strikethrough carries the state and the low ratio is appropriate to a deliberately de-emphasized row. The exhausted-Ballot row is separated by a hairline and labelled in `{typography.label-caps}`. The winning option's final-Round cell is `{colors.solar-ink-dark}`. In the unresolved state no cell is gold and the tied options take a 2px `{colors.entropy-dark}` left rule.

### `turnstile` — Turnstile widget (voting surface, Phase 1)

A third-party Cloudflare embed sitting immediately above the vote button. Three things are specified and nothing else is ours to specify:

- **`theme` binds to the resolved color mode**, including when the mode came from the manual override rather than the OS preference. An unbound widget renders its own light chrome on a `#0B0D10` page.
- **`appearance: "interaction-only"`**, so the widget is absent until a challenge is actually required. This is the same rule the spine already states behaviorally — the challenge never blocks reading the Poll.
- **Its chrome is the one sanctioned exception to `{rounded.DEFAULT}`, and to the shadow and border rules with it.** Do not attempt to restyle a third-party iframe. Its focus ring, contrast, and announcements are Cloudflare's; ours stop at the boundary.

### `overlay` — Overlay (confirmations and the Voter Code panel, Phase 1)

Exactly four exist and none of them stack: delete-Poll confirmation, delete-Comment confirmation, the Voter Code list panel, and the designated Demo reset confirmation. Demo reset opens server-side at `?confirm=reset-demo`, works without JavaScript, and pins title `RESET DEMO POLL?`, cancel `KEEP VOTES`, destructive action `RESET VOTES`, and enhanced pending label `RESETTING…`.

The page dims behind `{components.overlay.scrimDark}` / `scrimLight`; the panel sits flat on top at `{colors.panel-dark}` with a single top and bottom hairline, `{components.overlay.paddingY}` / `paddingX` inside, title in `{typography.heading-md}`. No shadow, no scale-in, no radius. Actions sit at the bottom: `button-secondary` to cancel, `button-primary` or `button-destructive` to proceed. Focus behavior — trap, `Esc`, scrim dismissal, and return to the invoking control — is in `EXPERIENCE.md § Component Patterns` and `§ Accessibility Floor`.

## Do's and Don'ts

**Do**

- Use hairlines and whitespace for every separation. If you're reaching for a bordered box, add 24px of space instead.
- Keep gold rare. One primary button, one leading bar, one selected option — never two golds competing in a viewport. On the Tally the leader owns gold and the Voter's own ballot is text.
- Use `{typography.label-caps}` for every structural label and `{typography.label-caps-lg}` for every label that carries information. The caps and the tracking are the identity; the size step is the reading load.
- Bind gold **fills** to `solar-*` and gold **ink** — glyphs, markers, rules, edges, underlines, dots — to `solar-ink-*`. This is the whole light-mode contract in one sentence.
- Bind every focus outline to `focus-ring-*`, never to `solar-*` directly.
- Keep numbers in Courier Prime so they never reflow while animating, and keep them in `{colors.text-*}` so they read over a wash.
- Ship both modes with the same silhouette. A light screenshot and a dark screenshot must be recognizably the same interface.
- Render every state with glyph *plus* color — availability cells, Toggles, eliminated options, selected options, and the leading bar — never color alone.
- Let the results bar animate on *change* and paint instantly on *load*.
- Reference `{motion.*}` and `{breakpoints.*}` rather than restating durations and pixel widths in prose.

**Don't**

- No rounded corners. Not on buttons, inputs, images, bars, or overlays. The only exceptions are the 6px live dot and the Turnstile iframe's own chrome.
- No shadows, no gradients, no glassmorphism, no gradient text.
- No `#000` background and no `#FFF` body text in dark mode — `{colors.void-dark}` and `{colors.text-dark}` exist for a reason.
- No `{colors.faint-dark}` on text a user has to read — including a closed-Poll status, a disabled button label, or an availability *No*.
- No opacity as a state mechanism. A locked Toggle at 55% opacity reads as off; states are carried by color tokens and by text.
- No card grids. This is not a dashboard.
- No emoji, no illustrations, no mascots, no confetti on a successful Vote. The spark in the results bar is the entire celebration budget.
- No second elevation step. `void` and `panel`, nothing else — and nothing that must be seen as a shape may rely on that step alone.
- No bold Newsreader, and no serif on anything the machine produced.
- No pie chart as the default results form, and no live-update animation in the pie view. FR-21 permits pie; it ships as the secondary half of `{components.chart-form-toggle}`, reached deliberately, rendering static percentages.
- No results bar that reorders itself while it animates.
- No spinner. In-flight states are label swaps.
- No vendor-branded share buttons or social-icon rows. The Share action is one text-labelled button in the product's own idiom, and the canonical URL is always visible beside it.
