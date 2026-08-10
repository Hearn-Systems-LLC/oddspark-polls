---
title: 'Copy to clipboard when the share URL text is activated'
type: 'feature'
created: '2026-08-09'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'ce0f4e7cddeacdf2ed6fcdcedf873c6da71484a1'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On poll Share blocks, clicking the canonical URL text only selects it (`user-select: all`); a voter who clicks the obvious target — the URL itself — gets no copy feedback and must notice the separate SHARE control.

**Approach:** Extend the existing share progressive enhancer so that, when the browser proves clipboard capability, activating the URL text also runs the same copy path as SHARE (same controller, same `LINK COPIED` live-region confirmation), while remaining plain selectable text for everyone else. Amend the `share-action` contract in EXPERIENCE.md one line to bless the new trigger.

## Boundaries & Constraints

**Always:**
- No-JS floor untouched: the URL stays visible, selectable text; without JavaScript nothing about the block changes (AD-2).
- Bind copy-on-text-activation only when capability is `clipboard` (desktop idiom). Never bind it to the Web Share API path — a share sheet popping when a user tries to select text is surprising.
- Reuse `createShareActionController` — one copy path, one pending guard, one confirmation idiom. No parallel clipboard code.
- `user-select: all` behavior persists: activation still selects the text; copy is additive.
- The URL text must not become a button/link in markup; keyboard and screen-reader paths stay on the existing SHARE control (EXPERIENCE.md § `share-action`).
- Mouse/pointer activation only — selection via keyboard or touch-drag must not fire a copy.
- EXPERIENCE.md § Component Patterns `share-action` amended in the same commit (one sentence: with JavaScript and clipboard capability, activating the URL text also copies and confirms `LINK COPIED`).

**Ask First:**
- Any temptation to also bind the `navigator.share` capability to the URL text.
- Any change to the SHARE control's own behavior, placement, or copy.

**Never:**
- No framework, no new dependencies, no new tokens, no toast/snackbar (the confirmation is the existing persistent `LINK COPIED` line).
- No changes to the canonical URL content, the voting/results surfaces' structure, or `share-action.astro`'s no-JS markup contract beyond what the enhancer needs.
- No copy on surfaces where the SHARE trigger stays hidden (capability `none`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clipboard-capable click | JS on, `navigator.clipboard.writeText` present, user clicks URL text | Text still selects; URL copied; one `LINK COPIED` polite announcement | N/A |
| Share-only device | JS on, `navigator.share` present, no clipboard | URL text click selects only (no share sheet); SHARE control unchanged | N/A |
| No capability | JS on, neither API present | SHARE stays hidden; URL text click selects only | N/A |
| Copy rejected | clipboard `writeText` rejects (permission) | No confirmation shown; URL remains selected/visible; console silent | Existing controller `failed` path |
| Rapid repeat clicks | Second click while first copy pending | Ignored by the existing pending guard; no double announcement | Controller returns `pending` |
| No JavaScript | enhancer never runs | URL selects on click; nothing else | N/A |

</frozen-after-approval>

## Code Map

- `src/scripts/share-action.ts` — the enhancer; `enhanceRoot` wires the SHARE trigger today. Add a pointer-activation listener on `[data-share-url-text]` when `capability === "clipboard"`, calling the same `activate(url)`.
- `src/components/share-action.astro` — markup: `.canonical-url[data-share-url-text]` is the activation target; `[data-share-confirmation]` the live region. Markup change only if a hook is needed (cursor styling is optional; if added, use existing tokens).
- `tests/unit/share-action.test.mjs` — unit contract for detection/controller; extend for the URL-text binding logic if extracted.
- `tests/e2e/share-action.spec.mjs` — e2e: add coverage that clicking the URL text copies and announces `LINK COPIED`, and that selection still occurs.
- `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md` (line ~175) — one-sentence `share-action` contract amendment.
- `CHANGELOG.md` — `## [Unreleased]` (Added): one user-facing line.

## Tasks & Acceptance

**Execution:**
- [x] `src/scripts/share-action.ts` — bind pointer activation on `[data-share-url-text]` to the shared controller when capability is `clipboard` — one copy path, no markup contract change
- [x] `tests/unit/share-action.test.mjs` — cover the binding decision (bound on clipboard capability; not bound on share-only/none) and the matrix's error paths — behavior prose-style test names
- [x] `tests/e2e/share-action.spec.mjs` — clicking URL text copies + announces once + text still selected; share-only stub does not bind — real-browser proof of the enhancer wiring
- [x] `EXPERIENCE.md` + `CHANGELOG.md` — one-sentence contract amendment and one Added line — keep spine and changelog in sync with behavior

**Acceptance Criteria:**
- Given a clipboard-capable desktop browser on any poll Share block, when the user clicks the canonical URL text, then the URL is on the clipboard, the text remains selected, and exactly one polite `LINK COPIED` announcement is posted.
- Given a share-only (Web Share API, no clipboard) or no-capability browser, when the user clicks the URL text, then it behaves exactly as before — selection only, no sheet, no announcement.
- Given no JavaScript, when the page renders, then the Share block is byte-identical in behavior to today.

## Design Notes

Bind in `enhanceRoot` next to the existing trigger wiring, after the capability check:

```ts
if (capability === "clipboard") {
  const urlText = root.querySelector<HTMLElement>("[data-share-url-text]");
  urlText?.addEventListener("click", () => { void activate(url); });
}
```

`user-select: all` already handles selection on the same click; the copy rides along. A `cursor: copy` hint on the enhanced URL text is a token-free optional nicety — implementer's call, set only from the enhancer (e.g. `urlText.style.cursor = "copy"`) so the no-JS floor never advertises an affordance it can't deliver.

## Verification

**Commands:**
- `pnpm test -- tests/unit/share-action.test.mjs` — expected: all pass
- `pnpm test:e2e -- tests/e2e/share-action.spec.mjs` — expected: all pass
- `pnpm check` — expected: clean

**Manual checks (if no CLI):**
- On a local dev server results page, click the URL text: clipboard holds the URL (paste to verify), text is selected, `LINK COPIED` appears beside SHARE. Inspect a screenshot of the result.

## Spec Change Log

### Iteration 1 — adversarial review amendments (2026-08-09)

- **Finding — gating excluded share-preferred desktops.** The approved design note bound URL-text copy only when `capability === "clipboard"`, which is `share`-preferred: on desktop browsers exposing both `navigator.share` and `navigator.clipboard` (e.g. desktop Safari), capability resolves to `share` and the URL text would never copy — silently dropping the feature on a primary desktop target.
- **Resolution (Justin).** Bind URL-text copy whenever `operations.copy` exists (clipboard present), regardless of whether `navigator.share` also exists. The SHARE trigger keeps its share-first behavior; the URL text NEVER opens a share sheet — the text path uses a copy-only `createShareActionController` over the same presentation idiom.
- **Finding — pointer-only guard gap.** The frozen boundary "Mouse/pointer activation only — selection via keyboard or touch-drag must not fire a copy" was not enforced: any synthesized `click` (keyboard/AT, `detail === 0`), non-mouse pointer, or drag-to-select gesture would have copied.
- **Amended.** `enhanceRoot` now (a) skips clicks with `event.detail === 0`, (b) records `pointerType` on `pointerdown` and skips non-mouse activations, (c) skips when the pointer moved more than 4px between `pointerdown` and `click`. Unit tests cover both-APIs binding (copy fires, share never called), each guard, and a source-reading wiring guard tying `[data-share-url-text]` to `.canonical-url` in `share-action.astro`; e2e adds a both-APIs variant (clipboard granted, `navigator.share` stubbed and never called).
- **KEEP (invariants carried forward).** Shared `createShareActionController` reuse (no parallel clipboard logic), silent failure paths (no console output on rejection), no share-sheet-on-text ever, no-JS floor byte-identical (no markup contract change; cursor hint is JS-only).

## Suggested Review Order

**Enhancer binding (the feature)**

- The gate: URL-text copy binds whenever clipboard write exists, share-first trigger untouched
  [`share-action.ts:170`](../../src/scripts/share-action.ts#L170)
- Copy-only controller for the text path — a share sheet can never open from the text
  [`share-action.ts:176`](../../src/scripts/share-action.ts#L176)
- Pointer-only guards: keyboard/AT clicks, touch pointers, and drag-selection never copy
  [`share-action.ts:184`](../../src/scripts/share-action.ts#L184)
- JS-only affordance hint, so the no-JS floor never advertises copy it can't deliver
  [`share-action.ts:174`](../../src/scripts/share-action.ts#L174)

**Contract and docs**

- Spine amendment blessing the new trigger while pinning the unchanged no-JS baseline
  [`EXPERIENCE.md:175`](../../_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md#L175)

**Tests and proof**

- Both-APIs unit test: text copies, share never called — the desktop-Safari regression guard
  [`share-action.test.mjs:365`](../../tests/unit/share-action.test.mjs#L365)
- Wiring guard ties the hand-rolled DOM double to the real component markup
  [`share-action.test.mjs:518`](../../tests/unit/share-action.test.mjs#L518)
- E2E: clipboard granted + share present — text click copies without invoking share
  [`share-action.spec.mjs:186`](../../tests/e2e/share-action.spec.mjs#L186)
- Inspected proofs, both modes plus mobile layout
  [`url-click-copied-1280-light.png`](../../test-results/spec-share-url-click-copy-proof/url-click-copied-1280-light.png)
