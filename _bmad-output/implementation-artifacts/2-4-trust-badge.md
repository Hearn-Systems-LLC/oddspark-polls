---
baseline_commit: baff488424a01231663a931b3c3bc09bdf85e55f
---

# Story 2.4: Trust Badge

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a public Voter,
I want to see what protections are active before I participate,
So that I can believe the count this Poll produces.

## Acceptance Criteria

Verbatim from `_bmad-output/planning-artifacts/epics.md` § Story 2.4 (lines 669–692):

1. **Given** a Poll with one or more Toggles on, **when** the voting page renders, **then** a label-caps-lg trust badge sits above the vote button listing each active protection in the Voter's terms — `ONE VOTE PER BROWSER`, `ONE VOTE PER NETWORK`, `INVITE CODE REQUIRED`, `HUMAN CHECK ON SUBMIT`, `NO VPN OR DATACENTER CONNECTIONS` — with a small entropy glyph and a hairline above, no border, no chip (UX-DR7).

2. **Given** a Poll with every Toggle off, **when** the voting page renders, **then** the badge is absent entirely — it never says "no protections" (SM-C1).

3. **Given** badge items that overflow a 375px viewport, **when** they render, **then** items stack one per line in order, each line keeping the first line's left edge with the glyph hanging outside the text column — never truncated, never abbreviated.

4. **Given** the Tally view, **when** it renders, **then** the badge persists there so a reader evaluating the numbers sees what produced them, **and** no "verified"/"secure" claims and no shield or lock iconography appear anywhere.

**Scope interpretation locked by this story (see Dev Notes § Enforced-only rendering):** "each active protection" means each Toggle that is both **enabled and enforced**. Today the enforced set is Session Checks, IP Checks, and CAPTCHA. Voter Codes and VPN Blocking persist as columns but enforce nothing (FR-17/FR-19 deferred to Epic 8, Story 2.1 decision D1) — a voter-facing badge claiming `INVITE CODE REQUIRED` while no code is requested would violate the § Trust Surfaces rule "Never claim more than is true." All five voter-terms strings ship in the copy map (AC #1's vocabulary is complete and tested); Epic 8 stories 8.2/8.3 flip their toggles into the enforced set when enforcement lands.

## Tasks / Subtasks

- [x] Task 1: Pure badge logic + copy catalog (AC: 1, 2)
  - [x] Create `src/components/trust-badge.ts` (co-located pure-logic module, `live-indicator.ts` / `poll-card.ts` precedent): export `TRUST_BADGE_COPY: Record<SecurityToggle, string>` with all five voter-terms strings, `ENFORCED_TOGGLES: readonly SecurityToggle[]` = `["sessionChecks", "ipChecks", "captcha"]` (comment: FR-17/FR-19 deferred; Epic 8 adds `voterCodes`/`vpnBlocking`), and `trustBadgeItems(toggles: PollSecurityToggles): string[]` returning voter-terms strings for enabled+enforced toggles in `SECURITY_TOGGLES` array order.
  - [x] Key everything by `SecurityToggle` from `src/shared/domain/index.ts` — never a badge-local string list, never branch on rendered copy (AD-23; Story 2.1 decision D2).
  - [x] Unit tests `tests/unit/trust-badge.test.ts`: exact five strings; output order matches `SECURITY_TOGGLES` order; empty array when all off; empty array when only unenforced toggles on; enforced set is exactly the three.
- [x] Task 2: `trust-badge.astro` component + tokens (AC: 1, 2, 3)
  - [x] Create `src/components/trust-badge.astro`: JSDoc citing Story 2.4 / UX-DR7; `interface Props { toggles: PollSecurityToggles; class?: string }`; renders **nothing at all** (no wrapper, no hairline) when `trustBadgeItems()` is empty; `data-trust-badge` hook on the root.
  - [x] Markup: root container with hairline above; `▪` glyph (U+25AA) in its own column, `aria-hidden="true"`, `--color-entropy`, 11px (`--type-label-caps-size`); items in label-caps-lg treatment — `--font-machine`, `--type-label-caps-lg-size` (12px), `--type-label-caps-lh`, `--type-label-caps-ls`, `text-transform: uppercase`, `--color-text` (NOT the 11px `dim` `.label-caps` class — see Dev Notes § Component spec).
  - [x] Wrapping per AC #3: glyph in its own grid/flex column so wrapped lines align with the text column; each item `white-space: nowrap`; items joined with `·` when they fit one line, stacking one per line when they don't (recommended approach in Dev Notes § Wrapping).
  - [x] Add `--trust-badge-*` token group to the unsuffixed `:root` component block of `src/styles/tokens.css`, binding only to existing collapsed vars (`--color-text`, `--color-entropy`, `--color-rule`, `--space-2`, `--space-3`, `--space-hairline`). No new `-dark`/`-light` pairs, no fourth `…Light` exception, do not touch `--color-solar-dark`.
  - [x] Source-contract test `tests/unit/trust-badge.test.mjs` (template: `tests/unit/live-indicator.test.mjs`): token bindings present; no raw hex, no `opacity:`, no `set:html`, no `border-radius`, no `box-shadow`, no `text-overflow`; glyph `aria-hidden`; `▪` present; no `transition`/`animation` (idle is still).
- [x] Task 3: Voting-page composition (AC: 1, 2)
  - [x] In `src/pages/[reference].astro`, render `<TrustBadge toggles={...}>` on the **writable ballot branch only**, immediately **before** the `.vote-action` div (after `fieldset.poll-options`, inside the form). Hard ordering constraint: badge → vote-hint → Turnstile → `VOTE` button. Story 2.3 AC #4 is binding: "no trust line may sit between the challenge and button."
  - [x] Build the `PollSecurityToggles` record from the `PollPage` booleans (`sessionChecksEnabled` → `sessionChecks`, etc.). The 422 CAPTCHA-failure re-render path already re-reads `poll` (line ~565), so the badge self-corrects on toggle races (AD-17) with no extra work — verify, don't add plumbing.
  - [x] Integration tests: extend `tests/integration/vote-route.integration.test.ts` (the existing AstroContainer harness — do NOT create a second route harness): badge present with session-only default; document order badge → turnstile → button on a CAPTCHA poll; badge absent when all toggles off; badge absent markup entirely (no empty container/hairline).
- [x] Task 4: Results projection extension (AC: 4)
  - [x] Extend `ResultsAccessEnvelope` (`src/modules/results/index.ts:30-39`) with `securityToggles: PollSecurityToggles`, and thread it onto the `visible` branch of `ResultsView`. Extend the envelope doc comment (lines 23–29): toggles are safe Poll configuration, not a result fact — same argument as `multiSelectEnabled` (AD-19: Results owns no facts).
  - [x] Map the five `*_enabled` columns in the results SELECT at `src/adapters/d1/index.ts:1036` (adapter maps to the projection schema; never publishes rows — AD-23).
  - [x] Hidden branches (`after_close_hidden` / `creator_only_hidden`) do NOT carry the badge — the badge explains visible numbers; the explanation shapes stay as they are.
  - [x] Contract tests change together with the schema (AD-23): update `tests/integration/results-adapter.integration.test.ts` and confirm `tests/integration/live-results-route.integration.test.ts` still passes (live payload is unchanged — the badge is server-rendered, never live-patched).
- [x] Task 5: Tally composition on both surfaces (AC: 4)
  - [x] Add optional `toggles?: PollSecurityToggles` prop to `src/components/results-tally.astro`; render `<TrustBadge>` after the bars region (mockup order: bars → badge; `key-tally.html`), margin-top 24px (`--space-6`). Voting-page instance uses 32px above (`--space-7` if it exists, else nearest token — verify scale in `tokens.css`).
  - [x] Post-vote instance (`[reference].astro:1098-1114`): `poll` is already in scope — pass the record. `/results` route (`src/pages/[reference]/results.astro`): pass from the extended `visible` view.
  - [x] Live-reconciler safety: `src/scripts/results-live.ts:128-148` mutates only `[data-live-*]`/`[data-tally-final]` nodes, so a badge inside `[data-results-tally]` survives refresh. Add an integration/E2E regression assertion that the badge is still attached after a live update cycle.
  - [x] Desktop grid hazard: at `lg`, `.poll-shell[data-post-vote="true"]` places every child explicitly and `.results-tally` is `display: contents` (`[reference].astro:1309-1377`) — the badge becomes a direct grid child. Add an explicit `grid-column`/`grid-row` rule placing it with the bars in the right column. Check whether `/results` has an equivalent explicit-placement grid and handle it the same way.
- [x] Task 6: E2E, proof, gate (AC: 1, 2, 3, 4)
  - [x] `tests/e2e/trust-badge.spec.mjs`: badge above the button on a session-only poll; absent on an all-off poll (assert **attachment/count**, not `toBeVisible()` — zero-height empty containers read as hidden, Story 2.3 lesson); 375px with 2+ toggles → each item on its own line, aligned left edges, no ellipsis; persists on the post-vote Tally and on `/results`; the strings `verified`/`secure` and any shield/lock glyph appear nowhere.
  - [x] Computed-style assertions (Story 2.1 review lesson — DOM presence is vacuous for a styling contract): `font-size: 12px`, `color` = resolved `--color-text`, `border-top` = 1px solid resolved `--color-rule`, glyph color = resolved `--color-entropy`, in dark AND light.
  - [x] Screenshot proof under `test-results/story-2-4-trust-badge-proof/`: 375px dark + 1280px light minimum; visually inspect. Remember `pnpm migrate:local` before local E2E; vote via custom link + `label.poll-option` click (2.1 lesson).
  - [x] Merge gate, exact order (Node 24.18.0 / pnpm 11.17.0): `pnpm migrations:guard` → `pnpm test` → `pnpm check` → `pnpm test:e2e` → `pnpm types` → `git diff --exit-code worker-configuration.d.ts` → `pnpm build:production`. Record fresh totals (2.3 baseline: 892 tests).

## Dev Notes

### Why this story is small but load-bearing

The badge is the product's core trust claim (DESIGN.md § Components → trust-badge: "it is the product's core trust claim, which is information rather than structure"). It closes Epic 2's trust-surface arc: 2.1 built the toggles, 2.2/2.3 built the enforcement, 2.4 makes enforcement *legible* to the voter. Downstream stories assert on this exact component: the Demo Poll renders it (epics.md:800), Epic 8 asserts `INVITE CODE REQUIRED` (epics.md:1204-1206) and `NO VPN OR DATACENTER CONNECTIONS` (epics.md:1228). Build the vocabulary complete; render the enforced subset.

### Enforced-only rendering (scope decision)

- `voterCodesEnabled` / `vpnBlockingEnabled` persist (`db/migrations/0009_security_toggles.sql`) and are enableable through both creator forms (`src/pages/creator/new.astro`, `src/pages/creator/polls/[pollId].astro`) but enforce **nothing** — Story 2.1 decision D1 accepted that risk for the *creator-facing* toggle rows. The badge is *voter-facing*: § Trust Surfaces "Rules" (EXPERIENCE.md:315) — "Never claim more than is true. No 'verified', no 'secure', no shield or lock iconography. The badge lists mechanisms; the reader draws the conclusion."
- Therefore `trustBadgeItems()` filters to `ENFORCED_TOGGLES ∩ enabled`. An "active protection" is one actually protecting the count.
- The alternative (render every enabled toggle) was considered and rejected: it would show `INVITE CODE REQUIRED` on a poll that requests no code — a literally false statement to a voter, and worse than silence. If product direction flips this, the change is one constant.
- Epic 8 flips: 8.2 adds `voterCodes` to `ENFORCED_TOGGLES` when redemption enforces; 8.3 adds `vpnBlocking`.

### Data: toggle state is already plumbed on the voting page — and NOT on /results

- `PollPage` (`src/adapters/d1/index.ts:44-63`) already carries all five booleans: `sessionChecksEnabled`, `ipChecksEnabled`, `voterCodesEnabled`, `captchaEnabled`, `vpnBlockingEnabled`. The voting route binds `let poll: PollPage | null` at `[reference].astro:88` (re-read at ~565 after the CAPTCHA/definition-change race). **No new plumbing for the voting page.**
- Canonical keys: `SECURITY_TOGGLES = ["sessionChecks","ipChecks","voterCodes","captcha","vpnBlocking"] as const`, `SecurityToggle`, `PollSecurityToggles` — `src/shared/domain/index.ts:29-37`. The comment at lines 27-28 names this story; `tests/unit/shared-kernel.test.ts:28` pins the array order under the test name "declares the five Security Toggles in trust-badge vocabulary order" — **badge item order is already locked by an existing test.**
- `snapshotSecurityToggles()` in `src/modules/polls/poll-security.ts` converts `*Enabled` booleans → keyed record, but only for `PollLifecycleSnapshot`. Build the record from `PollPage` inline (or add a small mapper); do not reshape `PollPage`.
- **`/results` has no toggle state today.** `queryResults` builds `ResultsView` from `ResultsAccessEnvelope` (`src/modules/results/index.ts:30-39`: `pollId`, `question`, `resultVisibility`, `ownerUserId`, `deadlineMs`, `closedAtMs`, `multiSelectEnabled`, `canonicalReference`); the backing SELECT (`src/adapters/d1/index.ts:1036`) selects no toggle columns. Task 4 is the real non-obvious cost of AC #4.
- Do NOT read from `VotingPollSnapshot` (`src/modules/voting/index.ts`) — that is the internal enforcement snapshot (three fields only), not a presentation source.
- AD-24 is already satisfied: `updatePollSecurityToggles` bumps `representation_version` on toggle change (`poll-security.ts:185`), with the 2.1 decision-log rationale naming "trust badge in 2.4." Do NOT add a second bump.
- AD-8 / NFR-4: the badge names mechanisms only. No digest, IP, or session identifier may appear in any projection or markup.

### Placement contract (hard ordering constraints)

Voting page (`src/pages/[reference].astro`):

- The ballot region has **three mutually exclusive branches** (lines 1006-1097): read-only options / `compactCounted` / writable form. Only the writable branch has a vote button — the badge renders there, immediately before `.vote-action` (lines 1072-1095: vote-hint → conditional `<Turnstile>` → `<ButtonPrimary class="vote-button">VOTE`).
- Resulting document order: question → options → **badge** → hint → challenge → `VOTE`. This simultaneously satisfies UX-DR7 ("above the vote button"), UX-DR20 / EXPERIENCE.md's turnstile row ("the last thing before the action it protects"), and Story 2.3 AC #4 (binding, already implemented: "no trust line may sit between the challenge and button"). The mockup (`key-voting.html`) shows badge *between* Turnstile and button — the mockup is stale; the spine + 2.3's implemented AC win.
- On the already-voted / closed surfaces the badge arrives via the Tally instance only (AC #4). `compactCounted` without a visible tally gets no badge — there is no vote button and no numbers to explain. There is **no comment composer yet** (Epic 4) — do not build a slot for it.

Tally (both surfaces):

- Mockup order inside the tally: bars → **badge** → (future comments), `margin-top: 24px` (voting-page instance: 32px). Render via `results-tally.astro` so both surfaces share one implementation.
- Badge lives inside `[data-results-tally]` — safe: the reconciler (`src/scripts/results-live.ts:128-148`) mutates only `[data-live-*]`/`[data-tally-final]` nodes. (The share-block's outside-the-tally comment at `[reference].astro:1115-1116` predates this analysis; verify with the Task 5 regression assertion rather than relocating.)
- Desktop grid: badge becomes a direct grid child under `.poll-shell[data-post-vote="true"]` at `lg` because `.results-tally` is `display: contents` — explicit placement rule required (travels with the bars in the right column; EXPERIENCE.md § Responsive: two-column post-vote Tally is ballot left / bars right).

### Component spec (DESIGN.md frontmatter `components.trust-badge`, lines 365-373 + § Components prose, line 645)

```yaml
trust-badge:
  typography: '{typography.label-caps-lg}'   # Courier Prime 12px / 400 / lh 1.4 / ls 0.18em / uppercase
  color: '{colors.text-dark}'
  iconColor: '{colors.entropy-dark}'          # ▪ glyph; #6e8fb8 dark / #3d6491 light via suffix swap
  gap: '{spacing.2}'                          # 8px
  borderTop: '{spacing.hairline} solid {colors.rule-dark}'  # 1px; #1D242C / #D8DEE4
  paddingY: '{spacing.3}'                     # 12px
  wrap: 'one item per line'
  truncate: never
```

- Glyph is `▪` U+25AA BLACK SMALL SQUARE (from the approved mockups — the prose only says "a small glyph"), rendered at 11px (one step below the 12px text), `align-items: baseline`, `aria-hidden="true"` (matches `live-indicator.astro`'s dot). Entropy blue, never gold — "Entropy blue is data"; gold is rationed to consequence.
- **The mockups render the badge at the wrong token.** They use `.label-caps` (11px, `dim`) — the spine mandates label-caps-lg at 12px in `text`. That variant was created by the accessibility review *specifically for this badge* (`review-accessibility.md:51`: it "crosses into essential information at: the trust badge"). Build to the spine: 12px, `--color-text`. There is no `.label-caps-lg` class and no single token — it is a four-property recipe (`--font-machine` + `--type-label-caps-lg-size`:77 + `--type-label-caps-lh`:75 + `--type-label-caps-ls`:76 + uppercase); `.results-tally-summary` in `results-tally.astro` is the canonical usage to copy.
- No border, no chip, no box, no background — a hairline above and that's all. Hairlines never enclose. Zero radius, zero shadow, no opacity as a state mechanism, no motion (five primitives are closed; idle is still), no inline hex (walker test enforces).

### Wrapping (AC #3)

DESIGN.md: items that don't fit one line at 375px "stack one per line, in order. Each line keeps the same left edge as the first — the glyph hangs outside the text column so wrapped lines align with the text above them rather than with the glyph." This closes the open `.memlog.md:24` issue ("trust badge wraps at 375px with 2 toggles"). Recommended CSS-only approach:

- Root: `display: grid; grid-template-columns: auto 1fr; column-gap: var(--trust-badge-gap)` — glyph column + text column. Left edges of wrapped lines align automatically.
- Text column: `<ul>` reset, `display: flex; flex-wrap: wrap; column-gap: var(--space-2)`; each `<li>` `white-space: nowrap` so an item never breaks internally.
- Separator: `li:not(:last-child)::after { content: " ·" }` (trailing, so a stacked line never *begins* with punctuation). Single fitting line reads `ONE VOTE PER BROWSER · HUMAN CHECK ON SUBMIT` (UJ-2's canonical form); stacked lines each end with a trailing `·` except the last. If review prefers no separators when stacked, that refinement needs a container query — do not reach for JS; the badge must be correct with zero client JavaScript (AD-2).
- Never `text-overflow: ellipsis`, never `overflow: hidden` on the text column, no abbreviation ever. In practice two items overflow 375px at this type size, so the stacked form is the common mobile rendering.

### Copy catalog (single source, keyed by code)

EXPERIENCE.md § Trust Surfaces table (lines 299-305) — the copy authority (DESIGN.md's `ONE VOTE PER BROWSER · CAPTCHA` example is stale against it):

| Toggle key | Voter-terms string |
|---|---|
| `sessionChecks` | `ONE VOTE PER BROWSER` |
| `ipChecks` | `ONE VOTE PER NETWORK` |
| `voterCodes` | `INVITE CODE REQUIRED` |
| `captcha` | `HUMAN CHECK ON SUBMIT` |
| `vpnBlocking` | `NO VPN OR DATACENTER CONNECTIONS` |

These strings exist nowhere in `src` yet. `ONE VOTE PER NETWORK` was reserved by 2.2's scope fence; `HUMAN CHECK ON SUBMIT` by 2.3's. Precedents: `VOTE_COPY` (voting), `LIFECYCLE_COPY` (poll-lifecycle), `RESULTS_COPY` (results), `SECURITY_TOGGLE_META` (creator-facing toggle copy, `poll-security.ts:33-60` — "Keyed by toggle key so policy never branches on rendered copy"). `TRUST_BADGE_COPY` in the co-located `trust-badge.ts` follows the same rule. Store strings uppercase as canonical copy; CSS `text-transform: uppercase` is belt-and-braces for the type treatment, not the copy source.

### Accessibility

- Static informational text: no control, no focus stop, no live region, no announcement. It is deliberately absent from the focus order "question → options → Comment → challenge → vote" (EXPERIENCE.md § Accessibility Floor) — keep it that way; it must not compete with the post-submit outcome-line focus.
- Words carry the entire meaning; the glyph is decoration (`aria-hidden="true"`), satisfying "state is never color alone" by construction. Without `aria-hidden`, `▪` is spoken as "black small square."
- Contrast: text at 12px `--color-text` (12.34:1 void dark / 15.26:1 light); do not let it drift to `dim` or 11px — that regression was the accessibility review's high-severity finding. Hairline's 1.24:1 is documented-accepted for rules.
- Use a semantic list (`<ul>`/`<li>`) so screen readers announce item count; no `role` gymnastics needed.

### What must NOT change

- `src/components/security-toggle.astro`, the creator create/detail routes, and creator toggle copy (2.1 owns; "no expected change" continuity from 2.3).
- The AD-7 vote transaction, `VotingPollSnapshot`, and any enforcement path — this story is presentation plus one projection-schema addition.
- The live-results payload/protocol (`results-live.ts` and its endpoint) — the badge is server-rendered and never live-patched.
- `representation_version` semantics (already bumped on toggle change).
- `--color-solar-dark` (deploy smoke test reads it); the `-dark`→`-light` suffix-swap rule (exactly three `…Light` exceptions exist; the badge adds none).
- Turnstile placement ("the last thing before the action it protects") and 2.3's e2e/captcha suite expectations.

### Previous story intelligence (2.1 → 2.3)

- Two-pass norm: dev implementation + adversarial `bmad-code-review` in fresh context.
- 2.1 review forced **computed-style browser proof** because DOM-presence assertions were judged vacuous for a styling contract — the badge is a styling contract; bake computed-style assertions in from the start.
- 2.2 review themes: single-source contracts, render from persisted truth (never a rejected draft), branded ports. The badge renders from the persisted `poll`/envelope — never from form state.
- 2.3 lessons directly reusable here: Playwright treats zero-height empty containers as hidden (assert attachment, not visibility, for the all-off case); local D1 needs `pnpm migrate:local` before E2E; E2E votes via custom link + `label.poll-option` click; conditional-render guard pattern to copy is the `<Turnstile>` guard (`poll.captchaEnabled && env key checks`).
- `tokens.css` untouched since 2.1's `--security-toggle-*` block — 2.4 is the first Epic 2 story to reopen it; follow that block's structure exactly.
- No new `src/scripts/*.ts` file is needed (badge is static markup — the architecturally correct outcome under AD-2). If one somehow becomes necessary, it needs `export {}` (tsc global-script merge trap).

### Git intelligence

Recent pattern (PRs #12–#14, one branch + PR per story: `story/2-4-trust-badge` expected): each Epic 2 story landed as one `feat(...)` commit touching component + page + module + adapter + all three test layers + README/AGENTS/CHANGELOG + sprint-status. 2.3's commit shows the current shape of `[reference].astro` composition and the test-layer split this story extends. No dependency changes in any Epic 2 story — none here either.

### Tech stack (no new dependencies, no web research required)

Node 24.18.0 · pnpm 11.17.0 · TypeScript 7.0.2 · Astro 7.1.5 · `@astrojs/cloudflare` 14.1.6 · Wrangler 4.115.0 · Vitest 4.1.10 · `@cloudflare/vitest-pool-workers` 0.19.0 · Playwright 1.62.0 · fast-check 4.9.0 · Zod 4.4.3. The badge uses zero client JavaScript, zero new packages, and only existing design tokens.

### Testing requirements

Three layers, strict separation ("never move pure-logic tests into integration"):

| Layer | File | What it proves |
|---|---|---|
| unit (node) | `tests/unit/trust-badge.test.ts` | mapping strings exact, order = `SECURITY_TOGGLES`, all-off → empty, unenforced-only → empty |
| unit walker | `tests/unit/trust-badge.test.mjs` | token bindings, no raw hex/opacity/radius/shadow/ellipsis/motion, `aria-hidden` glyph, render-site ordering regexes (template: `live-indicator.test.mjs`) |
| integration (workerd) | extend `vote-route.integration.test.ts` + `results-adapter.integration.test.ts` | badge in document order badge→challenge→button; absent all-off; envelope carries toggles; live route regression |
| e2e (Playwright) | `tests/e2e/trust-badge.spec.mjs` | 375px stacking + left-edge alignment, computed styles dark+light, tally persistence on both surfaces, attachment-not-visibility for absence, no verified/secure/shield/lock anywhere |

`tests/unit/no-raw-html.test.mjs` picks up the new component automatically. `tests/astro-components.d.ts` already declares `*.astro` modules for AstroContainer imports. Commands: `pnpm test` / `test:unit` / `test:integration` / `test:e2e` / `check`. Screenshot proof to `test-results/story-2-4-trust-badge-proof/`, 375 dark + 1280 light minimum.

### Project Structure Notes

- NEW: `src/components/trust-badge.astro`, `src/components/trust-badge.ts`, `tests/unit/trust-badge.test.ts`, `tests/unit/trust-badge.test.mjs`, `tests/e2e/trust-badge.spec.mjs`.
- UPDATE: `src/pages/[reference].astro`, `src/pages/[reference]/results.astro`, `src/components/results-tally.astro`, `src/modules/results/index.ts`, `src/adapters/d1/index.ts`, `src/styles/tokens.css`, `tests/integration/vote-route.integration.test.ts`, `tests/integration/results-adapter.integration.test.ts`, plus README/AGENTS/CHANGELOG/sprint-status per story-close convention.
- No migrations, no wrangler/env changes, no `worker-configuration.d.ts` drift (gate asserts it).
- Component conventions (uniform across `live-indicator`/`security-toggle`/`poll-card`/`turnstile`): JSDoc with story + UX-DR citation stating what the component owns and does not own; `interface Props` with `class?: string` escape hatch; `class:list={["trust-badge", className]}` + `data-trust-badge`; scoped `<style>` with `trust-badge-*` class prefix; `[hidden] { display: none }` guard if the component sets `display`.

### References

- Requirements: `_bmad-output/planning-artifacts/epics.md` — Story 2.4 (669-692), UX-DR7 (98), FR-15/16/17/18/19 (35-39), Epic 2 notes (159-162), downstream badge assertions (800, 1204-1206, 1228)
- UX: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md` — frontmatter components.trust-badge (365-373), § Components trust-badge (645-649), label-caps-lg (491), § Don'ts/Do's; `EXPERIENCE.md` — § Trust Surfaces (295-316), § Component Patterns (153-154), § Accessibility Floor (249-260), § Responsive (234), UJ-2 (348); mockups `key-voting.html` (173-182, 242-245), `key-tally.html` (164-173); `review-accessibility.md:51` (origin of label-caps-lg)
- Architecture: `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` — AD-2, AD-8, AD-17, AD-19, AD-21, AD-23, AD-24, § Stack, § Structural Seed, Capability Map "trust surfaces" row
- Prior stories: `_bmad-output/implementation-artifacts/2-1-per-poll-security-toggles.md` (decisions D1/D2/D4, review findings), `2-2-ip-checks.md` (copy reservation, review findings), `2-3-captcha-on-the-vote-action.md` (AC #4 ordering constraint, Debug Log traps, scope fence naming 2.4)
- Code: `src/shared/domain/index.ts:27-37`, `src/modules/polls/poll-security.ts:33-60,185`, `src/adapters/d1/index.ts:44-63,1036`, `src/modules/results/index.ts:23-39`, `src/pages/[reference].astro:88,565,1006-1097,1072-1095,1098-1121,1256-1261,1309-1377`, `src/components/results-tally.astro`, `src/scripts/results-live.ts:128-148`, `src/styles/tokens.css:20,37,75-77,109,373`, `tests/unit/shared-kernel.test.ts:28`, `tests/unit/live-indicator.test.mjs`

## Dev Agent Record

### Agent Model Used

Kimi Code CLI (kimi-k2.5), bmad-dev-story workflow, 2026-08-03.

### Debug Log References

- Walker test authoring trap: the render-site ordering regex must match the exact source shape (`{pollToggles && <TrustBadge … />}` expression wrapper), not the bare component tag — first draft failed on the expression container.
- `pnpm check` caught the schema change's blast radius: `tests/unit/results.test.ts` envelope factory needed `securityToggles` added when `ResultsAccessEnvelope` gained the required field (contract tests change together with the schema, AD-23).
- E2E absence assertion trap (new, dev-mode-specific): Vite inlines an imported component's `<style>` block into `<head>` even when the component renders nothing — an all-off page's full HTML therefore contains the string `trust-badge` in stylesheet text. Absence assertions must scope to `<main>` markup (attachment/count), matching the Story 2.3 zero-height-container lesson one layer up.
- First full-suite E2E run needed >10 minutes; run Playwright via `pnpm exec playwright test <spec>` for focused reruns (the `pnpm test:e2e -- <filter>` form did not narrow the run).

### Completion Notes List

- Task 1: `src/components/trust-badge.ts` ships the full five-string voter-terms copy catalog keyed by `SecurityToggle`, `ENFORCED_TOGGLES` = session/ip/captcha (FR-17/FR-19 deferred; Epic 8 flips), and `trustBadgeItems()` filtering to enabled ∩ enforced in `SECURITY_TOGGLES` order. 7 unit tests pin strings, order, all-off → empty, unenforced-only → empty.
- Task 2: `src/components/trust-badge.astro` renders a semantic list in label-caps-lg (12px, `--color-text` — not the 11px dim class), entropy `▪` glyph one type step down in its own grid column, hairline above, trailing-`·` separators, zero client JS; renders nothing at all when the enforced set is empty. `--trust-badge-*` token group added to the single `:root` component block binding only collapsed runtime vars — no new mode-suffixed pairs, `--color-solar-dark` untouched. 16 walker assertions pin the styling contract.
- Task 3: badge renders on the writable ballot branch only, immediately before `.vote-action` — document order badge → hint → Turnstile → `VOTE` (Story 2.3 AC #4 honored; mockup's badge-between-challenge-and-button confirmed stale). Toggles record built inline from `PollPage` booleans; the AD-17 422 re-read keeps it current with no new plumbing. 3 integration tests on the existing vote-route harness (presence, ordering, total absence).
- Task 4: `ResultsAccessEnvelope` + `ResultsView.visible` gained `securityToggles` (safe Poll configuration, same argument as `multiSelectEnabled`); adapter SELECT maps the five `*_enabled` columns; hidden branches unchanged; live payload untouched (badge is server-rendered, never live-patched — `live-results-route` suite still green).
- Task 5: `results-tally.astro` takes optional `toggles` and renders the badge after the bars inside `[data-results-tally]` (reconciler mutates only `[data-live-*]`/`[data-tally-final]` — pinned by walker assertion and an E2E live-cycle test). 24px rise by default; post-vote instance 32px (`--space-8`; no `--space-7` exists). Desktop post-vote grid places the badge col 2 / row 6 with the bars; Share yields to row 7. `/results` has no explicit-placement grid (single column) — no rule needed there.
- Task 6: 5 Playwright proofs — badge above button with computed styles in dark AND light (12px text, 1px rule hairline, entropy glyph), total absence on all-off (attachment, `<main>`-scoped), 375px two-item stacking with aligned left edges and no truncation, persistence on post-vote Tally + `/results`, survival of a real live update cycle, and no `verified`/`secure`/shield/lock anywhere. Screenshot proof (5 shots) under `test-results/story-2-4-trust-badge-proof/`, visually inspected.

### File List

NEW:
- `src/components/trust-badge.ts`
- `src/components/trust-badge.astro`
- `tests/unit/trust-badge.test.ts`
- `tests/unit/trust-badge.test.mjs`
- `tests/e2e/trust-badge.spec.mjs`
- `test-results/story-2-4-trust-badge-proof/` (5 screenshots)

MODIFIED:
- `src/pages/[reference].astro`
- `src/pages/[reference]/results.astro`
- `src/components/results-tally.astro`
- `src/modules/results/index.ts`
- `src/adapters/d1/index.ts`
- `src/styles/tokens.css`
- `tests/integration/vote-route.integration.test.ts`
- `tests/integration/results-adapter.integration.test.ts`
- `tests/unit/results.test.ts`
- `CHANGELOG.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/2-4-trust-badge.md`

## Change Log

- 2026-08-03: Implemented Story 2.4 (Trust Badge) — badge logic + copy catalog, component + tokens, voting-page and both Tally compositions, results projection extension, three test layers, screenshot proof. Gate: migrations:guard ✓ → 920 unit/integration tests ✓ (2.3 baseline 892, +28) → tsc ✓ → 144 e2e ✓ → types + binding-drift ✓ → build:production ✓ (Node 24.18.0 / pnpm 11.17.0).

### Review Findings

- [x] [Review][Patch] **Safari/VoiceOver strips `<ul>` list semantics** — the `.trust-badge-items` element has `list-style: none` + `display: flex` without `role="list"`, which causes VoiceOver on Safari to lose list item count announcement and navigation. Add `role="list"` to the `<ul>`. [src/components/trust-badge.astro:73]
- [x] [Review][Patch] **`PollSecurityToggles` mapped in two places with duplication risk** — `[reference].astro:845-853` and `d1/index.ts:1065-1070` both hand-map `*Enabled` booleans to `securityToggles` keys. A sixth toggle or a rename requires identical updates in both sites. [src/pages/[reference].astro:845, src/adapters/d1/index.ts:1065]
- [x] [Review][Patch] **`voteButtonIndex` regex is over-broad** — `/>\s*VOTE\s*<\/button>/` matches anywhere in the full HTML string including script bodies, attribute values, and comments. Scope to exclude script/comment content or use a DOM parser. [tests/integration/vote-route.integration.test.ts:1152]
- [x] [Review][Patch] **No test exercises the `class` prop escape hatch** — `trust-badge.astro` declares `class?: string` and `ResultsTally` uses `class="results-tally-badge"`, but zero tests assert the custom class renders on the element. The E2E computed-style assertions miss `margin-top` spacing overrides (32px post-vote, 24px results), so a token-scale change could silently regress spacing. [src/components/trust-badge.astro:21, tests/e2e/trust-badge.spec.mjs:128-150]
- [x] [Review][Defer] **SQL injection vector in E2E `seedPoll`** — template-literal SQL with `reference` parameter across all E2E specs. Deferred, pre-existing pattern. [tests/e2e/trust-badge.spec.mjs:95]
- [x] [Review][Defer] **Walker test fragility** — source-code string scanning assertions (`not.toContain("background")`, `not.toMatch(hex)`) break on unrelated refactors. Deferred, pre-existing pattern from `live-indicator.test.mjs`. [tests/unit/trust-badge.test.mjs]
- [x] [Review][Defer] **`afterAll` cleanup silently leaks on failure** — for-loop over `seededUserIds` calls `cleanupCreator` without try/catch; one failure skips all remaining IDs. Deferred, pre-existing pattern in every E2E spec. [tests/e2e/trust-badge.spec.mjs:73-76]
