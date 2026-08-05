---
title: 'Story 4.2: Comment List & Moderation'
type: 'feature'
created: '2026-08-05T00:55:35-04:00'
status: 'in-review'
baseline_revision: '78a32724c780187c842732f7f5271be85b3c1830'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
warnings:
  - oversized
---

<intent-contract>

## Intent

**Problem:** Accepted vote Comments are persisted but never projected, so authorized readers cannot see them and neither Poll owners nor the Administrator can remove abusive entries.

**Approach:** Extend the authorized Results projection with a newest-first plain-text Comment list, add owner moderation on visible Results and a separate exact-reference Administrator projection on the existing operator surface, and delete through Voting-owned commands that atomically advance the Poll representation version.

## Boundaries & Constraints

**Always:** Authorize ordinary Comment reads before projection using the same visibility decision as the Tally; keep the Administrator's cross-Poll read/delete ability confined to live-role-guarded, non-enumerating `/creator/moderation`; order the complete list by `(created_at_ms DESC, id DESC)`; expose only purpose-shaped Comment fields; escape at Astro render boundaries; recheck owner or live Administrator authority inside the D1 mutation; delete only the Comment and increment `representation_version` exactly once in the same transaction; require same-origin and session-bound CSRF; preserve GET/HEAD Results and POST→303→GET mutation conventions; keep logs free of Comment text, display name, Comment ID, and submitted reference.

**Block If:** Correct implementation requires weakening result visibility, exposing Vote/security identity, editing committed migration `0012`, adding a dependency/binding/credential, introducing Comment enumeration, or changing the single-Administrator model.

**Never:** Treat ownership as Administrator authority; show Administrator controls on ordinary Results; add replies, reactions, avatars, rich text, pagination/truncation, soft-delete/history/reasons, or delete the owning Vote; let hidden Results read Comments or emit a validator derived from them; put Comment mutation policy in Results, Discovery, Astro routes, or client JavaScript.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Visible list | Live, closed After-Close, or owner-visible Creator-Only Results | Full list follows Tally, newest first; absent name renders `ANONYMOUS`; text stays inert | Malformed stored rows fail closed |
| Hidden list | Open After-Close or non-owner Creator-Only viewer | No Comment query, content, moderation ID, or Comment-derived validator | Preserve the existing hidden Results response |
| Owner delete | Owner confirms one Comment on authorized Results | Comment alone disappears; version advances once; canonical Results reloads | Missing/stale target is safe not-found; failed mutation changes nothing |
| Administrator delete | Live Administrator exact-reference lookup targets any Poll Comment | Separate operator projection and command delete it without granting creator ownership | Revoked role is authorization-denied before disclosure/mutation |
| Concurrent/live change | Two deletes race or another viewer has Results open | One delete and one version increment win; live representation removes stale Comment | Loser is a no-op/not-found; bounded reload prevents stale moderation UI |

</intent-contract>

## Code Map

- `src/modules/results/index.ts` -- visibility-first Results and live projection contracts.
- `src/modules/comments/index.ts` -- Comment-owned read DTOs, copy, and owner/Administrator delete commands.
- `src/adapters/d1/index.ts` -- coherent Tally/Comment projections and guarded delete transactions.
- `src/pages/[reference]/results.astro`, `src/lib/poll-delivery.ts`, `src/components/poll-voting-surface.astro` -- authorized Tally delivery surfaces.
- `src/pages/creator/moderation.astro`, `src/pages/creator/comments/delete.ts` -- fixed Administrator lookup/action and owner mutation endpoint.
- `src/components/comment-list.astro`, `src/components/overlay.astro`, `src/scripts/overlay.ts`, `src/scripts/results-live.ts` -- SSR list, confirmation, focus, and live invalidation.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/domain/index.ts`, `src/modules/comments/index.ts`, `src/modules/results/index.ts` -- define branded/purpose-shaped Comment views and separate owner/Administrator commands; keep visibility authorization ahead of projection and mutation policy provider-free.
- [x] `src/adapters/d1/index.ts` -- project the complete ordered list with the Tally/version coherently and implement owner/live-role-guarded atomic deletions with safe race classification; do not change schema.
- [x] `src/components/comment-list.astro`, `src/pages/[reference]/results.astro`, `src/lib/poll-delivery.ts`, `src/components/poll-voting-surface.astro` -- render escaped lists on every visible Tally surface, owner-only delete affordances, anonymous fallback, and no empty placeholder.
- [x] `src/lib/comment-moderation-form.ts`, `src/pages/creator/comments/delete.ts`, `src/pages/creator/moderation.astro`, `src/middleware.ts`, `src/adapters/telemetry/index.ts` -- add strict fixed-field owner deletion and extend the exact-reference operator desk with separate Comment moderation, CSRF/PRG, privacy-safe errors, and fixed redacted operations.
- [x] `src/pages/[reference]/results/live.ts`, `src/scripts/results-live-core.ts`, `src/scripts/results-live.ts`, `src/scripts/overlay.ts` -- validate Comment payloads and trigger one bounded reload on Comment changes while preserving overlay trap, Escape/scrim close, scroll lock, and focus return.
- [x] `tests/unit/`, `tests/integration/` -- cover visibility-before-read, ordering/ties, malformed/plain-text projection, command separation, strict forms, owner/admin/role-revocation authorization, rollback, missing/concurrent deletion, exact version changes, telemetry redaction, and live invalidation.
- [x] `tests/e2e/` -- prove direct/post-vote lists, visibility matrices, owner and Administrator deletion, no-JS and keyboard overlays, live stale removal, hostile text, responsive light/dark screenshots, and a clean console.
- [x] `CHANGELOG.md`, `README.md`, `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md`, `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md` -- record shipped lists, the Voting-owned moderation seam, operator-purpose projection, and updated exact-reference operator state.

**Acceptance Criteria:**
- Given a viewer can see a Poll's Tally, when any Results surface renders or refreshes, then its complete Comment list renders newest first with safe required typography and anonymous fallback; given the Tally is withheld, no Comment fact is projected.
- Given the owning Creator views Comments, when they confirm deletion with or without JavaScript, then the shared accessible overlay/PRG flow removes only that Comment and advances the representation version exactly once.
- Given the live Administrator uses the fixed exact-reference operator surface, when they inspect and delete a Comment on any Poll, then the separate capability succeeds without ownership or enumeration; a non-Administrator or revoked role learns no target facts and mutates nothing.
- Given denial, stale input, failure, or concurrent deletion, when the command completes, then no protected fact or version changes; given success, open viewers cannot retain the deleted Comment after conditional refresh.
- Given tests, telemetry, Discovery, and public HTML are inspected, when hostile Comment data and moderation identifiers pass through the feature, then text is inert and private Vote/security facts, Comment IDs, bodies, names, and submitted references never cross forbidden boundaries.

## Spec Change Log

## Review Triage Log

### 2026-08-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 0, medium 10, low 3)
- defer: 0
- reject: 3: (high 0, medium 1, low 2)
- addressed_findings:
  - `[medium]` `[patch]` Removed duplicate, inert no-JavaScript delete invokers so each Comment exposes exactly one usable native confirmation control without JavaScript.
  - `[medium]` `[patch]` Derived owner and Administrator success redirects from the D1-returned canonical reference instead of a submitted return target.
  - `[medium]` `[patch]` Removed forgeable owner Results deletion-outcome query messages; the freshly absent Comment is now the success truth.
  - `[medium]` `[patch]` Removed forgeable Administrator deletion-outcome query messages while preserving the separately verified Discovery outcome contract.
  - `[medium]` `[patch]` Removed the Comment outcome query branch, eliminating simultaneous unrelated status claims on the operator surface.
  - `[medium]` `[patch]` Removed the competing Comment outcome autofocus path so operator focus remains deterministic.
  - `[medium]` `[patch]` Included public creation timestamps in live Comment structural comparison so identical-text replacements invalidate stale owner controls.
  - `[medium]` `[patch]` Made the live payload validator reject unknown top-level fields, including accidental owner moderation projections.
  - `[medium]` `[patch]` Redirected signed-out or expired Comment mutation attempts to safe GET `/creator` instead of the POST-only endpoint.
  - `[medium]` `[patch]` Classified Comment deletion as sensitive/no-store at the middleware CSRF boundary and added missing, mismatched, and cross-origin rejection proof.
  - `[low]` `[patch]` Added positive live-route proof that public Comment fields ship without owner projections or Comment identifiers.
  - `[low]` `[patch]` Added fixed-operation and forbidden Comment-identifier telemetry assertions for the new mutation route.
  - `[low]` `[patch]` Restored resolved Poll correlation before existing Discovery moderation can return early from the extended operator route.

## Design Notes

Administrator Comment moderation is a purpose-specific exception to ordinary Results visibility, not a new Results entitlement: the existing non-enumerating operator lookup rechecks the live role before loading a target's Comments and exposes no Tally, Vote, owner, or security facts. Ordinary Results continue to show Comments exactly where the Tally is visible, and only an owner receives delete targets there. The full list is intentional because no truncation or pagination contract exists.

## Verification

**Commands:**
- `pnpm migrations:guard && pnpm test && pnpm check` -- all schema, unit, workerd integration, and type checks pass.
- `pnpm test:e2e` -- browser behavior, accessibility, screenshots, live invalidation, and console proof pass.
- `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` -- bindings remain stable and the shipping artifact builds cleanly.
