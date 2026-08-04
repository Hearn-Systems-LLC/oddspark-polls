---
title: 'Story 3.6: Presentable Repository'
type: 'feature'
created: '2026-08-04'
status: 'draft'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/3-6-presentable-repository.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md'
warnings: [multiple-goals]
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
- [ ] `README.md` and `package.json` -- add the evaluator sequence, shipped/planned matrix, live Worker, route tour, fresh-clone setup, exact local gate, architecture link, and correct repository metadata while retaining operational truth.
- [ ] `src/components/public-repository-link.astro`, `src/components/landing-intro.astro`, `src/components/poll-voting-surface.astro`, and `src/pages/[reference]/results.astro` -- centralize and render the accessible repository entry on only the required public surfaces.
- [ ] `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/{DESIGN,EXPERIENCE}.md` and `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` -- document the footer and reconcile structural/middleware seams.
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` and `CHANGELOG.md` -- resolve only proven items, classify every remaining item by owner and `nice`/`3+`, and record user-visible changes.
- [ ] `tests/unit/public-repository-contract.test.mjs`, `tests/unit/landing-page.test.mjs`, and `tests/e2e/{landing,vote,results}.spec.mjs` -- prove stable documentation/link contracts and all footer states without external CI dependency.
- [ ] `test-results/story-3-6-presentable-repository-proof/*.png` -- capture focused 375px dark and 1280px light voting/Results evidence with clean console/network observations and no sensitive state.
- [ ] `_bmad-output/implementation-artifacts/3-6-presentable-repository.md` -- record the reproducible remote boundary, redacted detector identity/result, metadata/content classification, external reachability, full local gate, File List, and honest `PENDING`/`NO-GO` status.

**Acceptance Criteria:**
- Given a technical evaluator visits the public repository, when they read and run the documented tour, then current product scope, architecture, local setup, and exact verification path are truthful and executable.
- Given any existing canonical public Poll, when voting or Results renders in supported states, then the understated accessible repository footer appears after Share, while every specified excluded surface remains footer-free.
- Given all authoritative remote heads and tags, when the value-hidden history audit completes against an unchanged ref-set, then no credential, token, runtime/user data, or unrelated or accidental personal data remains, while intentional public GitHub commit attribution is accepted; otherwise AC #2 and the story remain `PENDING`/`NO-GO`.

## Spec Change Log

## Review Triage Log

## Design Notes

The shared component owns presentation configuration only. Footer placement stays outside live-tally and Share replacement regions; the voting consumer uses `!embedded`, and Results renders it only inside the existing non-404 branch. This avoids changing Poll policy, authorization, or live reconciliation.

## Verification

**Commands:**
- `pnpm migrations:guard && pnpm test && pnpm check && pnpm test:e2e && pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` -- expected: complete local story gate passes in repository order.
- `git ls-files` plus a Markdown relative-link check -- expected: architecture link resolves and no scanner report is tracked.
- Pinned Gitleaks `v8.30.1` against a permission-restricted all-ref mirror with `--redact=100` -- expected: value-hidden clean result for prohibited credential and personal-data classes.

**Manual checks (if no CLI):**
- Render README on GitHub or a faithful renderer; verify scannability, relative links, table fit, copyable commands, and unambiguous current-versus-roadmap claims.
- Inspect focused voting/Results screenshots in both required modes/viewports and record clean console/network observations.

## Auto Run Result

Status: resolved; planning may resume.

Resolved condition: on 2026-08-04 the owner formally permitted intentional public GitHub commit attribution under FR-27. Credentials, tokens, runtime/user data, and unrelated or accidental personal data remain prohibited. The authoritative PRD, Epic 3 Story 3.6, implementation brief, and this intent contract now agree; no history rewrite is required solely for intentional attribution.

Value-hidden continuity evidence: the authoritative public remote advertised one head and no tags with 84 reachable commits at the blocked planning pass. Attribution metadata remains an audit classification input, not a prohibited finding by itself. No remote mutation, history rewrite, dependency installation, or unredacted secret scan was performed during policy reconciliation.
