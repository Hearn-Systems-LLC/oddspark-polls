---
title: 'Story 3.6: Presentable Repository'
type: 'feature'
created: '2026-08-04'
status: 'done'
baseline_revision: 'd1ff258353cfff04979b71c8d8503a54ee7b77b8'
final_revision: '5a53bfc85f14450817c5bf4dddebcb0898613418'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/3-6-presentable-repository.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md'
warnings: [multiple-goals, oversized]
---

<intent-contract>

## Intent

**Problem:** The public repository does not yet complete the portfolio argument: its README blurs shipped and planned capabilities, architecture prose has drifted from the tree, and canonical public Poll pages lack the repository footer required by UX. Repository history still requires a reproducible audit for credentials, tokens, runtime/user data, and unrelated or accidental personal data.

**Approach:** Reconcile public documentation with executable configuration, centralize one presentation-only repository link across landing/voting/Results, add structural and browser proof, and run a reproducible value-hidden all-ref audit. Apply the owner-approved FR-27 policy that permits intentional public GitHub commit attribution while prohibiting credentials, tokens, runtime or user data, and unrelated or accidental personal data.

## Boundaries & Constraints

**Always:** Preserve the exact repository destination; keep the footer server-rendered, same-tab, keyboard reachable, at least 44px high, and excluded from Demo/404/creator/auth/operator surfaces. Treat configuration, lockfile, workflow, and current routes as implementation truth; keep the architecture spine authoritative. Keep audit output value-hidden and preserve unrelated history and artifacts.

**Block If:** Any real credential or prohibited personal data is detected; classification cannot distinguish intentional public GitHub project attribution from unrelated or accidental personal data; or remediation would require rotation, history replacement, force-push, remote-setting mutation, deployment, or an owner licensing/governance decision without explicit authority.

**Never:** Add a license/governance bundle, dependency, migration, binding, capability, custom-domain change, landing redesign, navigation system, hydrated footer, broad scanner allowlist, committed scanner report, secret value, runtime/user identity or identifier in repository content or audit evidence, or remote mutation. Intentional public GitHub commit attribution is permitted. Do not rewrite or force-push history under this workflow.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Public voting | Valid canonical Poll | Footer follows Share and links to the repository in the same tab | Poll delivery behavior and headers remain unchanged |
| Public Results | Visible or hidden existing Poll | Footer renders after Share without exposing aggregate facts | `not_found` renders no footer |
| Embedded/excluded surface | Landing Demo, creator, auth, administration, or moderation | No public Poll footer | Landing repository entry remains present |
| History audit | Stable fetched heads/tags and redacted established detector | Record only ref/commit digests, exit code, and finding-class counts | Any real credential or prohibited personal data is `NO-GO`; intentional public GitHub commit attribution is permitted |

</intent-contract>

## Code Map

- `README.md` -- evaluator-first product, tour, setup, gate, and architecture entry point.
- `package.json` -- public repository metadata and authoritative scripts/versions.
- `src/components/public-repository-link.astro` -- single presentation seam for URL, inline link, and Poll footer.
- `src/components/landing-intro.astro` -- existing landing repository consumer with pinned copy.
- `src/components/poll-voting-surface.astro` -- canonical voting consumer; `embedded` excludes the Demo.
- `src/pages/[reference]/results.astro` -- valid visible/hidden Results consumer; excludes `not_found`.
- `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/{DESIGN,EXPERIENCE}.md` -- footer interaction contract.
- `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` -- structural seed and middleware truth.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- resolved evidence plus owner/taxonomy ledger.
- `tests/unit/public-repository-contract.test.mjs` -- stable repository/documentation invariants.
- `tests/e2e/{landing,vote,results}.spec.mjs` -- inclusion, exclusion, order, focus, geometry, and no-JS proof.

## Tasks & Acceptance

**Execution:**
- [x] `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md`, `_bmad-output/planning-artifacts/epics.md`, and `_bmad-output/implementation-artifacts/3-6-presentable-repository.md` -- record the owner-approved policy permitting intentional public GitHub commit attribution while retaining all prohibited-data classes -- make AC #2 coherent before code changes.
- [x] `README.md` and `package.json` -- add the evaluator sequence, shipped/planned matrix, live Worker, route tour, fresh-clone setup, exact local gate, architecture link, and correct repository metadata while retaining operational truth.
- [x] `src/components/public-repository-link.astro`, `src/components/landing-intro.astro`, `src/components/poll-voting-surface.astro`, and `src/pages/[reference]/results.astro` -- centralize and render the accessible repository entry on only the required public surfaces.
- [x] `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/{DESIGN,EXPERIENCE}.md` and `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` -- document the footer and reconcile structural/middleware seams.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` and `CHANGELOG.md` -- resolve only proven items, classify every remaining item by owner and `nice`/`3+`, and record user-visible changes.
- [x] `tests/unit/public-repository-contract.test.mjs`, `tests/unit/landing-page.test.mjs`, and `tests/e2e/{landing,vote,results}.spec.mjs` -- prove stable documentation/link contracts and all footer states without external CI dependency.
- [x] `test-results/story-3-6-presentable-repository-proof/*.png` -- capture focused 375px dark and 1280px light voting/Results evidence with clean console/network observations and no sensitive state.
- [x] `_bmad-output/implementation-artifacts/3-6-presentable-repository.md` -- record the reproducible remote boundary, redacted detector identity/result, metadata/content classification, external reachability, full local gate, File List, and honest `PENDING`/`NO-GO` status.

**Acceptance Criteria:**
- Given a technical evaluator visits the public repository, when they read and run the documented tour, then current product scope, architecture, local setup, and exact verification path are truthful and executable.
- Given any existing canonical public Poll, when voting or Results renders in supported states, then the understated accessible repository footer appears after Share, while every specified excluded surface remains footer-free.
- Given all authoritative remote heads and tags, when the value-hidden history audit completes against an unchanged ref-set, then no credential, token, runtime/user data, or unrelated or accidental personal data remains, while intentional public GitHub commit attribution is accepted; otherwise AC #2 and the story remain `PENDING`/`NO-GO`.

## Spec Change Log

- 2026-08-04: Implemented all execution tasks, completed the value-hidden history audit and exact local gate, and advanced the artifact to independent review.
- 2026-08-04: Applied eight review patches, reran the full local gate, and finalized the auto-run artifact with follow-up review recommended.

## Review Triage Log

### 2026-08-04 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 3, low 5)
- defer: 0
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` Made the all-ref audit reproducible, recorded the safe remote ref/tip and post-scan equality, and required every detector/content/metadata layer to repeat after the final review commit.
  - `[medium]` `[patch]` Redacted generated canonical Poll references from committed browser proof and narrowed the proof allowlist to the four approved filenames.
  - `[medium]` `[patch]` Added Creator-Only hidden-state, auth/creator/operator exclusion, and Results network-failure coverage around the shared footer.
  - `[low]` `[patch]` Broadened the tracked scanner-report guard to recognize audit/scan/report directories and generic report basenames within them.
  - `[low]` `[patch]` Proved the canonical repository URL occurs in exactly one Astro presentation source.
  - `[low]` `[patch]` Added the omitted `src/shared/*` domain/application seam to the evaluator project map.
  - `[low]` `[patch]` Corrected the exact `key-screens` trigger explanation for the sole Gitleaks fingerprint.
  - `[low]` `[patch]` Made the local-gate source contract assert the required command order inside the verification section.

## Design Notes

The shared component owns presentation configuration only. Footer placement stays outside live-tally and Share replacement regions; the voting consumer uses `!embedded`, and Results renders it only inside the existing non-404 branch. This avoids changing Poll policy, authorization, or live reconciliation.

The product baseline is Story 3.5 at `a002caba`; current `origin/main` is `cf7891e` after planning commits. The final history audit must cover authoritative remote heads/tags plus the committed final local Story HEAD, because the story branch is intentionally unpushed. Historical Story 1.1 and readiness-report wording remains a dated record rather than an active requirement.

## Verification

**Commands:**
- `pnpm migrations:guard && pnpm test && pnpm check && pnpm test:e2e && pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` -- expected: complete local story gate passes in repository order.
- `git ls-files` plus a Markdown relative-link check -- expected: architecture link resolves and no scanner report is tracked.
- Pinned Gitleaks `v8.30.1` against a permission-restricted all-ref mirror with `--redact=100` -- expected: value-hidden clean result for prohibited credential and personal-data classes.

**Manual checks (if no CLI):**
- Render README on GitHub or a faithful renderer; verify scannability, relative links, table fit, copyable commands, and unambiguous current-versus-roadmap claims.
- Inspect focused voting/Results screenshots in both required modes/viewports and record clean console/network observations.

**Fresh implementation results (Node 24.18.0 / pnpm 11.17.0):**
- Migration guard: 11/11 files checksummed; Vitest: 85 files / 1,255 tests passed; post-review Playwright: 155/155 passed.
- TypeScript check, Wrangler type generation, binding drift check, production build, and whitespace check passed.
- Focused voting/Results browser proof passed 5/5 with inspected 375px dark and 1280px light screenshots; console/network observations were clean.
- Gitleaks 8.30.1 fully redacted all-history scan passed with zero prohibited findings after one exact generated-manifest-hash false-positive fingerprint; independent path/content/metadata classification found no prohibited data blocker.
- GitHub repository and production Worker reachability were verified read-only. Native GitHub secret controls remain disabled and separately authorized; no remote state was mutated.

## Auto Run Result

Status: done; implementation and review-driven evidence hardening are complete.

Resolved condition: on 2026-08-04 the owner formally permitted intentional public GitHub commit attribution under FR-27. Credentials, tokens, runtime/user data, and unrelated or accidental personal data remain prohibited. The authoritative PRD, Epic 3 Story 3.6, implementation brief, and this intent contract now agree; no history rewrite is required solely for intentional attribution.

Value-hidden continuity evidence: the authoritative public remote advertised one head and no tags with 84 reachable commits at the blocked planning pass. Attribution metadata remains an audit classification input, not a prohibited finding by itself. No remote mutation, history rewrite, dependency installation, or unredacted secret scan was performed during policy reconciliation.

Implementation result: the permission-restricted mirror plus unpushed Story HEAD contained 89 reachable commits at the implementation scan. Pinned Gitleaks 8.30.1 exited `0` with zero prohibited findings under full redaction and an exact generated-manifest-hash false-positive fingerprint. Separate historical path/content/metadata review found no credential, token, runtime/user-data, or unrelated/accidental-personal-data blocker. The exact local gate passed, browser proof was inspected, and the Story reached independent review. Review then redacted generated Poll references from proof, strengthened surface/network/repository contracts, narrowed proof-file tracking, corrected evaluator prose, and recorded the exact terminal audit procedure. No remote mutation, deploy, history rewrite, or security-setting change was performed.

Files changed: evaluator-facing README/package/architecture/UX/deferred-ledger documentation; one shared server-rendered repository-link component and its landing/voting/Results consumers; structural and browser tests; four redacted proof screenshots; one exact Gitleaks fingerprint; and BMad story/status evidence.

Review findings: eight patches applied (three medium, five low), no items deferred, and three low-consequence findings rejected after direct evidence showed an existing After-Close assertion, a completed 91-commit Gitleaks/metadata pass, and no bearer capability URL. The remaining final-HEAD content-classification gap is addressed by repeating every audit layer after the review commits. Follow-up review is recommended because the review changed security evidence, committed binary proof, and multiple E2E contracts.

Verification: the post-review exact gate passed (migrations 11/11, Vitest 85 files/1,255 tests, Playwright 155/155, TypeScript, generated-binding drift, production build, and whitespace checks). Review-focused unit coverage passed 56 files/946 tests; focused E2E coverage passed for excluded surfaces, Creator-Only Results, and both proof journeys after one expected live-request cancellation was explicitly classified. Both required redacted proof silhouettes were inspected. The terminal value-hidden audit remains required after the final review commit.

Residual risk: GitHub-native secret scanning and push protection remain disabled and require separate remote-setting authority. They are defense-in-depth, not an AC substitute. No push, deploy, or remote mutation occurred.
