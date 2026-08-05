---
baseline_commit: a002caba9c184bbf38ec3dff6b2127d34b3d5273
baseline: "origin/main @ a002caba9c184bbf38ec3dff6b2127d34b3d5273 (Story 3.5 done)"
dependency_story: 3-5-demo-poll
epic: "3 — Public Face: Discovery, Landing & Demo"
---

# Story 3.6: Presentable Repository

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a technical evaluator arriving from the demo,
I want the public repository to explain the product, the architecture, and how to run it,
So that the code itself completes the portfolio argument (FR-27, SM-6).

## Acceptance Criteria

Verbatim from `_bmad-output/planning-artifacts/epics.md` § Story 3.6 (lines 812–827):

1. **Given** the public repository, **When** a technical reader evaluates it, **Then** the README covers what the product is, why it exists, the stack, and how to run it locally, and architecture notes sufficient to evaluate the work are present (linking or summarizing the architecture spine's decisions), **And** the landing page's repository link resolves to it (FR-25).

2. **Given** the full repository history, **When** audited, **Then** no credentials, tokens, runtime or user data, or unrelated or accidental personal data exist in any commit, **And** intentional public GitHub commit attribution is permitted (FR-27).

## Tasks / Subtasks

- [x] Task 1: Turn the existing README into an evaluator-first product and run guide without losing operational truth (AC: #1)
  - [x] UPDATE `README.md`; do not replace it wholesale. Keep the accurate environment, OAuth, masked provisioning, Turnstile privacy, Demo recovery, administration, migration, and deploy sections. Add a short opening sequence that answers, in order: what Oddspark Polls is, why it exists, what is shipped now, how to try the live product, and where the roadmap goes.
  - [x] State current capability in an explicit shipped/planned matrix. Shipped: Multiple-Choice (including multi-select), Session/IP checks, Turnstile, rate limiting, sharing, live Results, lifecycle, Discovery/moderation, landing, and Demo. Planned/backlog: Comments, CSV/XLSX export, Ranked, Image, Meeting, Voter Codes, and VPN Blocking unless the implementation-time repository proves otherwise. R2 being configured is infrastructure, not proof that Image Polls ship.
  - [x] Correct the headline's dead-link risk: the currently live production Worker is `https://oddspark-polls.hearnsystems.workers.dev`; `polls.oddspark.dev` remains the product/custom-domain identity but is not a working destination until actually bound. Re-query before editing and never present a planned domain as live.
  - [x] Add the carried-forward active-product/dogfood map: landing Demo → Discover or sign-in → create → canonical Poll → vote → Results/share, with the concrete public/creator routes a reader needs. Keep internal auth callbacks and operator-only endpoints in the technical reference rather than the primary tour.
  - [x] Make local setup executable from a fresh clone: pinned Node/pnpm prerequisites; `pnpm install`; masked local provisioning through `scripts/provision-auth-secrets.zsh` (never pasted values); `pnpm migrate:local`; `pnpm dev`; focused/full tests; and the distinction between local-flavored `pnpm build` and the shipping `pnpm build:production` artifact.
  - [x] Replace the incomplete manual-gate example with the exact repository order: `pnpm migrations:guard` → `pnpm test` → `pnpm check` → `pnpm test:e2e` → `pnpm types` → binding drift check → `pnpm build:production` → `git diff --check`. Keep staging/production migrations, preflight, deploy, smoke, and authorization clearly outside ordinary local verification.
  - [x] UPDATE `package.json` metadata only where it is stale: remove the unbound live-domain claim from `description`; set `repository` to `{ "type": "git", "url": "https://github.com/Hearn-Systems-LLC/oddspark-polls.git" }` and `homepage` to `https://github.com/Hearn-Systems-LLC/oddspark-polls`; keep `private: true`. Do not change package versions, scripts, dependencies, module type, or release version for presentation.

- [x] Task 2: Make the authoritative architecture easy to evaluate and reconcile public documentation with the real tree (AC: #1)
  - [x] Add a compact README Architecture section that links directly to `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md`. Summarize, rather than duplicate, the decisions a reviewer needs: one Astro Worker as a hexagonal modular monolith (AD-1); server-rendered progressive enhancement (AD-2); D1 fact ownership and legal write paths (AD-6/AD-19); constrained voting/privacy (AD-7/AD-8); isolated environments and staged promotion (AD-14); voter-blind telemetry (AD-15); and auth-before-projection (AD-21).
  - [x] UPDATE the spine's Structural Seed and comments to match the merged tree: include `src/lib`, `src/layouts`, `src/styles`, the cache and Demo seams, and the actual middleware chain responsibility. Preserve the spine as the single architecture source; do not add a second `docs/architecture.md` or copy its full decision text into README.
  - [x] Reconcile every README stack/binding/environment/build claim against `package.json`, `pnpm-lock.yaml`, `wrangler.jsonc`, `.github/workflows/deploy.yml`, and current routes. The lockfile/config/workflow win over old prose. No dependency upgrade, binding, migration, provider, secret, or deployment-topology change belongs to this story.
  - [x] UPDATE `docs/administration.md` or `docs/recovery.md` only if a link or statement is stale. Preserve their no-identifiers/no-credentials contract and do not duplicate them into README.
  - [x] UPDATE `_bmad-output/implementation-artifacts/deferred-work.md` as a truth ledger: mark only demonstrably resolved entries resolved with evidence (at minimum Playwright-in-CI, production smoke, Story 3.5 header extraction, and Structural Seed drift after the spine fix); correct moved file references; retain genuine open items without implementing them. Triage **every** remaining open ledger item with the retrospective taxonomy (`blocks-3`, `nice`, or `3+`) and a named owner, explicitly including the three carried Epic 2 harness items; do not silently delete or opportunistically implement them.
  - [x] Record the README dogfood-map and deferred-ledger follow-through in this story's completion notes. Leave the unrelated untracked Epic 1/Epic 2 retrospective artifacts and their mirrored `sprint-status.yaml` action-item rows to the retrospective workflow; Story 3.6 must not adopt, stage, or partially reconcile those user-owned files.

- [x] Task 3: Complete the repository-link journey, including the UX-specified Poll footer, from one canonical presentation source (AC: #1)
  - [x] Preserve the exact public repository destination `https://github.com/Hearn-Systems-LLC/oddspark-polls`. At implementation time prove the GitHub repository is still public, defaults to `main`, and is reachable; a local `href` assertion alone is not resolution evidence.
  - [x] Keep Story 3.4/3.5 landing behavior intact: plain-language statement, separate technical account, repository entry, smoke marker, embedded Demo, create/Discover entries, responsive order, `private, no-store`, supported methods, and exact copy contracts. Do not redesign the landing page.
  - [x] Close the inherited `EXPERIENCE.md` Information Architecture requirement that the public repository is reached from the landing page **and Poll footer**. Add one understated text-labelled repository entry to the public voting and Results surfaces only; do not turn the header into navigation or add it to creator/operator/auth pages.
  - [x] UPDATE `DESIGN.md` and `EXPERIENCE.md` narrowly to define the footer component, exact surfaces and exclusions, source order, focus treatment, target size, and no-JavaScript behavior. The repository entry appears on canonical public voting and every existing Poll Results state (including hidden Results), but not on 404, embedded Demo, creator, auth, administration, or moderation surfaces.
  - [x] Centralize the public repository URL in one exact presentation seam: a shared public-repository link/footer component or presentation-config constant consumed by landing, voting, and Results. Keep Astro/provider types out of domain modules; this is presentation configuration, not Poll policy.
  - [x] The footer entry is a real link labelled in words, keyboard reachable in reading order, at least 44px high, visibly focused with the existing tokenized 2px/2px outline, and styled with existing label/hairline/whitespace tokens. It opens in the same tab, has no icon-only/color-only meaning, adds no JavaScript, and retains the same mobile/dark and desktop/light silhouette.
  - [x] Do not add a `LICENSE`, `CONTRIBUTING`, `SECURITY`, or `CODE_OF_CONDUCT` file without an explicit owner decision about licensing/contact/governance. Public source is not permission to invent an open-source license.

- [x] Task 4: Audit all reachable history for credentials and prohibited personal data without disclosing candidate values (AC: #2)
  - [x] Apply the owner-approved FR-27 policy: intentional public GitHub author/committer attribution for project work is permitted. Continue to audit author/committer metadata, signatures, trailers, and messages so unrelated or accidental personal data is not mistaken for permitted attribution; this is not a blanket commit-metadata allowlist. The governing PRD and Epic 3 Story 3.6 were formally amended through the BMad product workflow on 2026-08-04.
  - [x] Establish a reproducible remote audit boundary, preferably in an outside-the-worktree mirror: fetch/prune the authoritative remote heads and tags, record safe ref names/tips, reachable commit count, and a deterministic digest of the sorted commit-ID set; reconcile the remote refs again after scanning. Scanning only `HEAD`, the current tree, or the latest five commits does not satisfy this AC.
  - [x] Run an established full-history detector, not a home-grown regex as sole evidence. Planning-time research found Gitleaks `v8.30.1` current on 2026-08-04 and the local binary absent; at implementation time verify/pin the release and binary checksum, identify the default/config ruleset, and run the equivalent of `gitleaks git --redact=100 --log-opts="--all" <repository>`. Record the exact command, tool/version, checksum/config identity, audited ref-set digest, exit code, and finding-class counts—never match text or secret values. Keep any redacted report in a permission-restricted temporary location and destroy it after safe classification.
  - [x] Classify known public/dummy examples narrowly. The official Cloudflare test credential material already documented for local/CI is not a production secret, but any exception must be exact-fingerprint/path/rule scoped. Never allowlist all tests, docs, `.agents`, `_bmad-output`, a filename class, or a provider pattern.
  - [x] Separately audit historical paths and content for forbidden artifacts: `.dev.vars`, `.env*`, private keys/certificates, raw provisioning output, cookies/JWTs, OAuth credentials, capability URLs, internal user/Poll IDs, raw IPs or digests, emails/identities from runtime data, Poll/Vote/Comment/ballot exports, screenshots/logs containing them, and other personal data. `.gitignore` only prevents future additions; it proves nothing about prior commits.
  - [x] Re-query repository security configuration. Planning-time GitHub API evidence showed the public repository's repository-level secret scanning, non-provider patterns, validity checks, and push protection all `disabled`. The reproducible all-remote-ref Gitleaks/content/metadata audit is the required AC #2 evidence; native GitHub controls are defense-in-depth hardening, not a substitute or completion dependency. Enable applicable native controls only with explicit remote-configuration authority, then wait for backfill and verify scan history plus value-hidden alert state without retrieving or printing literal alert secrets. Otherwise record the hardening as separately authorized follow-up, not an AC failure.
  - [x] If any real credential/token ever entered history, stop at `NO-GO`, revoke/rotate it before any other remediation, and do not mark the story complete because the current file was deleted. If any prohibited personal data remains, stop at `NO-GO`; intentional public GitHub commit attribution is permitted and is not a finding. History rewriting/force-push, branch/tag replacement, clone invalidation, and alert resolution are destructive shared-state operations requiring separate explicit authorization and coordination; dev-story has no implicit authority to perform them.
  - [x] Re-run the full audit after any separately authorized remediation and before completion. Do not commit scanner reports, candidate values, GitHub alert payloads, temporary clones, or user-identifying evidence.

- [x] Task 5: Add focused repository-contract and browser proof without creating brittle prose tests (AC: #1, #2)
  - [x] ADD a focused unit/source-contract test (for example `tests/unit/public-repository-contract.test.mjs`) that checks structural invariants only: the README's architecture link resolves to a tracked file; the README exposes the product-tour/local-run/full-gate commands; package/landing/footer repository URLs agree statically; and no sensitive report path is tracked. A local test cannot prove a production URL or repository is currently reachable. Do not snapshot paragraphs or assert incidental wording.
  - [x] UPDATE `tests/unit/landing-page.test.mjs` only as needed for the centralized repository-link seam. Preserve the exact opening/build-account/smoke-marker contracts and prove the landing link remains explicit.
  - [x] UPDATE `tests/e2e/vote.spec.mjs`, `tests/e2e/results.spec.mjs`, and the existing landing contract for the Poll-footer link on `/{reference}` and `/{reference}/results`, including hidden-results states where the Poll still exists and the explicit exclusions above. Prove same-tab navigation target, focus visibility, ≥44px target, source order, no overflow, and no new console/network failures. Do not test GitHub availability from routine CI; perform one explicit external reachability check as completion evidence.
  - [x] Capture inspected browser proof under `test-results/story-3-6-presentable-repository-proof/` at 375px dark and 1280px light only because rendered Poll surfaces change. Show the footer on voting and Results, with keyboard focus and the existing Poll content intact; never capture auth state, cookies, identifiers, secret-scanning screens, or audit findings.
  - [x] Render-review the README on GitHub (or a faithful local renderer): headings are scannable, tables fit, Mermaid diagrams/relative links resolve, commands are copyable, and current-versus-roadmap claims are unambiguous. The repository page itself is the visual artifact; do not manufacture a separate brochure.
  - [x] UPDATE `CHANGELOG.md` under `[Unreleased]` for the evaluator-facing README/architecture journey, Poll-footer repository entry, and future secret-history guard/config once actually present. Do not claim a GitHub security control was enabled unless verified remotely.

- [x] Task 6: Run the exact gate, maintain evidence, and preserve local/remote boundaries (AC: all)
  - [x] Under Node `24.18.0` and pnpm `11.17.0`, run the complete local gate in repository order: `pnpm migrations:guard`, `pnpm test`, `pnpm check`, `pnpm test:e2e`, `pnpm types`, `git diff --exit-code worker-configuration.d.ts`, `pnpm build:production`, and `git diff --check`. Record fresh totals/results; Story 3.5's 1,251 Vitest / 153 Playwright totals are historical only. Do not misstate this as the exact current GitHub Actions job: its test/build job presently ends at `pnpm build:production`, while the local story gate adds the final diff check.
  - [x] Run a Markdown/relative-link check and the value-redacted all-refs history audit separately from the application gate. A green application suite cannot substitute for AC #2.
  - [x] Keep this story's Dev Agent Record, File List, Change Log, history-audit summary, and `sprint-status.yaml` current. No `TODO`, skipped/only test, placeholder, undocumented deferral, secret/candidate value, or prohibited runtime/user identifier may remain; intentional public GitHub commit attribution is permitted, while unrelated or accidental personal data remains prohibited.
  - [x] Preserve the two unrelated untracked Epic 1/Epic 2 retrospective files already in the worktree; stage only explicit Story 3.6/status/product paths. Do not commit, push, enable remote controls, rewrite history, deploy, or merge unless separately authorized.

## Dev Notes

### Decisions resolved at story-creation time (binding unless Justin reopens one before dev-story)

| # | Gap | Decision |
|---|---|---|
| D1 | Is this a replacement README? | No. The merged README already owns accurate operational detail. Reorder/polish it around evaluator questions and preserve credential-safe setup, environment, administration, and recovery truth. |
| D2 | How much architecture belongs in README? | A concise map of load-bearing decisions plus a direct link to the authoritative spine. Fix the spine's stale Structural Seed; do not create a second architecture document. |
| D3 | Does “what the product is” permit roadmap overclaiming? | No. Separate shipped Phase 1 behavior from planned ranked/image/meeting/comments/export work. Re-query the implementation at dev time. |
| D4 | Is the unbound custom domain a live README link? | No. Use the current production Worker as the live target and label `polls.oddspark.dev` as product identity/planned custom domain until binding evidence changes. |
| D5 | Does Story 3.6 touch application UI? | Only the missing UX-specified public Poll footer repository link and the minimum central presentation seam. No domain, persistence, Demo, Discovery, auth, or result policy change. |
| D6 | How is full-history cleanliness proved? | All fetched refs, an established detector with full redaction, separate historical-path/content and metadata review, and GitHub native scan/status evidence. HEAD-only checks and home-grown regex alone are insufficient. |
| D7 | What personal data is forbidden? | Intentional public GitHub author/committer attribution for project work is permitted by the owner-approved FR-27 amendment. Credentials, tokens, runtime/user/voter/operator data, identifiers, cookies, IPs/digests, Poll/Vote content, capability URLs, and unrelated or accidental personal data remain prohibited. Signatures, trailers, and messages still require classification rather than a blanket metadata allowlist. |
| D8 | What happens on a real finding? | `NO-GO`; rotate/revoke real credentials first. Any rewrite/force-push is a separately authorized incident, never an ordinary dev-story subtask. Prohibited-personal-data findings remain blockers; permitted public GitHub commit attribution does not. |
| D9 | Do we add a third-party secret-scanning Action? | Not by default. A pinned, redacted Gitleaks audit of a reproducible remote-ref mirror plus separate content/metadata review is AC evidence. GitHub native controls are defense-in-depth and require separate authority; an organization-licensed/action integration requires a separate data/licensing decision. |
| D10 | Is a license/governance bundle implied by “presentable”? | No. Do not invent licensing, security-contact, contribution, or conduct policy. Record the current public-source posture truthfully and leave policy choice to the owner. |

### Architecture, privacy, and presentation guardrails

- **AD-1:** repository-link UI is presentation only. Do not create a domain “repository” concept or move policy into Astro routes.
- **AD-2:** the Poll footer is server-rendered, functional without JavaScript, and uses no hydrated framework or enhancer.
- **AD-14:** README environment/deploy claims must preserve local/staging/production isolation, `wrangler.jsonc` binding truth, and staging-before-production promotion.
- **AD-15 / privacy:** no audit output may disclose tokens, provider data, voter data, submitted references, identities, internal IDs, or candidate secret strings. Log/report only safe classification metadata.
- **README truth hierarchy:** current source/config/workflow and the architecture spine outrank old README/retrospective text. The story does not silently rewrite released history or immutable migrations to make documentation agree.
- **External-state honesty:** repository visibility, link resolution, GitHub security configuration, scan completion, and alerts are live facts. Query them at completion; do not infer them from local source or this planning-time snapshot.

### Current implementation inventory (merged baseline)

- `README.md` already covers stack, environment separation, OAuth/secret provisioning, local setup, deploy, migrations, administration, design, recovery, and project layout. It lacks a real “why,” current-vs-roadmap summary, evaluator tour/dogfood path, direct architecture-spine link, and complete local gate; its headline links the not-yet-bound custom domain.
- `src/components/landing-intro.astro` already links the exact GitHub repository, and `tests/unit/landing-page.test.mjs` plus `tests/e2e/landing.spec.mjs` pin that destination. Preserve the landing content and smoke marker.
- `src/pages/[reference].astro` and `src/pages/[reference]/results.astro` have no repository footer. Their delivery/result behavior is established and must remain unchanged around the new presentation-only entry.
- `ARCHITECTURE-SPINE.md` is authoritative and substantial, but its Structural Seed omits real merged folders and understates middleware responsibilities.
- `.gitignore` excludes `.dev.vars*`, `.env*`, Wrangler/local outputs, logs, and Turnstile provisioning output. This is prevention for the working tree, not historical proof.
- `.github/workflows/deploy.yml` checks out full history and runs the full deploy gate, but no committed value-redacted full-history secret scan currently blocks deployment.
- Planning-time GitHub verification on 2026-08-04 found `Hearn-Systems-LLC/oddspark-polls` public on `main`, with repository-level secret scanning/push protection reported disabled. Re-query before using either fact as completion evidence.

### Previous-story and Git intelligence

- Story 3.5 is done on `main` at `a002caba`. It centralized public voting delivery in `src/lib/poll-delivery.ts` and `src/components/poll-voting-surface.astro`, added no dependency/migration, and completed privacy-safe staging/production preflight and smoke. Story 3.6 must not reopen or duplicate those seams.
- Story 3.4 established the landing repository link, exact copy, mode/focus behavior, token-derived smoke marker, and one-column proof. Its link test currently mocks GitHub reachability; Story 3.6 adds separate live reachability evidence rather than making CI network-dependent.
- Recent reviews repeatedly required authoritative re-read, value-safe logs, exact gates, and no completion claims from local-only evidence. Apply the same discipline to GitHub configuration/history.
- Epic 1 and Epic 2 retrospectives both carry the README active-path action; Epic 2 also carries deferred-work triage. This story owns documenting/classifying them, not opportunistically fixing every deferred code item.
- The current worktree includes unrelated untracked `epic-1-retro-2026-08-03.md` and `epic-2-retro-2026-08-03.md`; preserve and do not broad-stage them.

### Current platform specifics (verified 2026-08-04)

- Runtime versions remain lock/config owned: Node `24.18.0`, pnpm `11.17.0`, TypeScript `7.0.2`, Astro `7.1.5`, `@astrojs/cloudflare` `14.1.6`, Better Auth `1.6.25`, Zod `4.4.3`, Wrangler `4.115.0`, Vitest `4.1.10`, Playwright `1.62.0`, and fast-check `4.9.0`. Story 3.6 upgrades none of them.
- Context7 was unavailable during story creation. Official current documentation was used as the recorded fallback: Cloudflare confirms `secrets.required` is the declaration/type/deploy source and warns against sensitive `vars`; GitHub documents public-repository secret scanning, push-protection limits, value-hiding alert APIs, and rotation/removal requirements; Gitleaks documents `git` history mode and `--redact=100`.
- Gitleaks `v8.30.1` was the latest stable release queried from the official repository on 2026-08-04, but was not installed locally. Verify the release/checksum again before use; do not add it as an application dependency.
- GitHub native scanning is useful defense-in-depth but is not the AC gate. A regex/entropy detector alone cannot prove absence of prohibited personal data; the completion claim requires the reproducible Gitleaks, historical content/path, and metadata layers in Task 4.

### Testing requirements

- Keep source-contract assertions structural and stable; do not make README punctuation or paragraph order a unit-test API.
- Existing landing, vote, results, auth, Discovery, Demo, smoke, and deploy tests are regression coverage. The footer must not change cache headers, canonical URLs, robots policy, Tally authorization, Share behavior, focus outcomes, or Poll delivery.
- Browser proof is required because public Poll UI changes. Inspect both modes/viewports and report console/network state; do not ask the user to eyeball it.
- The history scan is security evidence, not a test fixture. Never commit a real/candidate secret to prove the detector.
- A public GitHub URL check is a one-time completion check, not a routine CI dependency.

### Scope fences — do not build here

- No new Poll capability, API, database table, migration, binding, secret, provider, cache, queue, scheduled job, deployment environment, or package dependency.
- No landing redesign, site-wide navigation, SPA/hydration, analytics, badges, marketing screenshot gallery, generated docs site, or duplicate architecture document.
- No domain/custom-domain binding, DNS change, production deploy, GitHub setting mutation, secret-alert resolution, history rewrite, force-push, branch/tag deletion, or merge without separate authority.
- No license/governance/contact choice by assumption.
- No cleanup of unrelated deferred product behavior while updating the public ledger.

### Project Structure Notes

- Expected UPDATE: `README.md`, `package.json`, `CHANGELOG.md`, `src/components/landing-intro.astro` (only to consume the shared link seam), `src/pages/[reference].astro`, `src/pages/[reference]/results.astro`, `tests/unit/landing-page.test.mjs`, `tests/e2e/vote.spec.mjs`, `tests/e2e/results.spec.mjs`, `DESIGN.md`, `EXPERIENCE.md`, `ARCHITECTURE-SPINE.md`, `deferred-work.md`, this story, and `sprint-status.yaml`.
- Expected NEW: one small presentation component/seam for the public repository link/footer; `tests/unit/public-repository-contract.test.mjs`; `test-results/story-3-6-presentable-repository-proof/*.png` if proof files remain committed by project convention.
- Conditional only: `.gitleaks.toml`/`.gitleaksignore` for exact classified false positives; `.gitignore` for a demonstrated local report path. Broad allowlists are forbidden.
- Expected UNCHANGED: application modules/adapters, middleware behavior, `wrangler.jsonc`, generated binding types, migrations/manifest, deployment scripts, Demo/Discovery behavior, and dependency versions.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Epic 3 and § Story 3.6, lines 164–167 and 694–827]
- [Source: `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md` § Vision, FR-25–FR-27, Cross-Cutting NFRs, Phase 1, and Success Metrics]
- [Source: `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/addendum.md` § Platform stack, § Phasing rationale, and § Competitive grounding]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` AD-1, AD-2, AD-6–AD-8, AD-14, AD-15, AD-19, AD-21, Stack, Structural Seed, and Capability Map]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md` § Information Architecture, § Interaction Primitives, § Responsive & Platform, § Accessibility Floor, and UJ-5]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md` § Typography, § Layout & Spacing, and § Do's and Don'ts]
- [Source: `_bmad-output/implementation-artifacts/3-5-demo-poll.md` Dev Notes and Dev Agent Record]
- [Source: `_bmad-output/implementation-artifacts/epic-1-retro-2026-08-03.md` § Active product paths and Action items]
- [Source: `_bmad-output/implementation-artifacts/epic-2-retro-2026-08-03.md` § Previous retro follow-through and Action items]
- [Source: `README.md`, `package.json`, `.gitignore`, `.github/workflows/deploy.yml`, `src/components/landing-intro.astro`, `src/pages/[reference].astro`, and `src/pages/[reference]/results.astro`]
- [External: GitHub Docs, Secret scanning detection scope — https://docs.github.com/en/code-security/reference/secret-security/secret-scanning-scope]
- [External: GitHub Docs, REST API endpoints for secret scanning — https://docs.github.com/en/rest/secret-scanning/secret-scanning]
- [External: GitHub Docs, Push protection — https://docs.github.com/en/code-security/concepts/secret-security/push-protection]
- [External: Cloudflare Workers Docs, Wrangler configuration / secrets — https://developers.cloudflare.com/workers/wrangler/configuration/#secrets]
- [External: Gitleaks official repository, history scan/redaction — https://github.com/gitleaks/gitleaks]

## Dev Agent Record

### Agent Model Used

OpenAI GPT-5 (Codex)

### Implementation Plan

- Reconcile evaluator-facing documentation and package metadata against executable configuration.
- Centralize the public repository URL in a server-rendered presentation component and add it to canonical Poll voting/Results surfaces with explicit exclusions.
- Prove the journey structurally and in Chromium, then audit the complete reachable history with pinned, fully redacted tooling plus independent path/content/metadata classification.
- Run the repository's exact local gate and hand the implementation to independent review without performing remote mutations.

### Debug Log References

- The default sandbox denied Wrangler's user log path and localhost listeners (`EPERM`). The affected Vitest integration, Playwright, Wrangler types, and production-build commands were rerun with approved local-test permissions; no product defect was inferred from the sandbox restriction.
- Gitleaks initially classified one generated SHA-256 entry in `_bmad/_config/files-manifest.csv` as `generic-api-key`. Manual value-hidden classification proved it was a manifest content hash; `.gitleaksignore` contains only that exact commit/path/rule/line fingerprint. The final redacted scan is clean.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- The owner-approved 2026-08-04 FR-27 amendment permits intentional public GitHub commit attribution. The completed value-hidden audit found no credential, token, runtime/user data, or unrelated/accidental personal-data blocker; GitHub-native hardening remains separately authorized defense-in-depth.
- README now leads with an evaluator-ready product account, truthful shipped/planned scope, live Worker, dogfood route map, fresh-clone setup, exact local gate, and a direct architecture-spine entry while preserving masked provisioning, environment, migration, administration, recovery, and deployment truth.
- One presentation-only Astro component owns the exact GitHub URL. Landing, canonical voting, and existing-Poll Results consume it; embedded Demo, 404, creator, auth, administration, and moderation surfaces remain excluded. Focus, geometry, reading order, same-tab behavior, no-JavaScript rendering, responsive containment, and clean console/network behavior are covered.
- Browser proof was inspected at 375px dark and 1280px light for both voting and Results. The focused proof suite passed 5/5; the full Playwright suite passed 154/154.
- The deferred-work ledger now records resolved evidence and classifies every open item, including all three carried Epic 2 harness items, as `nice` or `3+` with a named owner; no unrelated deferred implementation was adopted.
- Live verification on 2026-08-04 confirmed the GitHub repository is public, reachable, and defaults to `main`; the production Worker is reachable. Repository-level secret scanning, non-provider patterns, validity checks, and push protection remain disabled and were not mutated.
- Audit boundary: permission-restricted bare mirror of the one advertised remote head and zero tags, plus the unpushed Story HEAD; 89 reachable commits at implementation scan. Sorted commit-set digest: `7c4576972d712f9ba8c0e31e38b81317860200da13385a3b398f7615fe5b8a9e`. Remote ref-set digest before terminal reconciliation: `6345c843d58369d920f7213e39f0832a893cd4e386337f3733e3df813e2d690d`.
- Established detector: Gitleaks `8.30.1`, official Darwin arm64 release archive, SHA-256 `b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5`, embedded default rules, exact `.gitleaksignore` fingerprint, `--redact=100 --log-opts=--all`; exit `0`, prohibited secret findings `0`. No candidate value was printed or committed.
- Independent historical classification found zero forbidden environment paths, key/certificate paths, scanner-report paths, runtime exports, logs/raw outputs, JWTs, or capability URLs. One credentialed-URL pattern is confined to a unit-test fixture; 27 unique email-shaped values are reserved/test examples in tests, a schema migration, and a historical Story; IP literals are confined to networking implementation/configuration, documentation, generated binding types, and tests. Eighteen image paths are committed proof/public/design assets, not runtime captures.
- Metadata classification covered all 89 implementation-scan commits: three intentional public author attributions, 20 author/committer differences, 20 signed commits, zero co-author trailers, zero sign-off trailers, and zero email-shaped commit-message lines. Intentional public project attribution is permitted; no unrelated attribution was found.
- Exact local gate under Node `24.18.0` / pnpm `11.17.0`: migration guard 11/11; Vitest 85 files / 1,255 tests; TypeScript check; Playwright 154/154; Wrangler type generation; binding drift check; production build; and `git diff --check` all passed. The unit suite's repository contract also validates the Markdown architecture link and absence of tracked audit reports.
- No dependency, migration, binding, secret, provider, deployment, remote security setting, history, tag, branch, license, or governance policy was changed.

### File List

- `.gitignore`
- `.gitleaksignore`
- `CHANGELOG.md`
- `README.md`
- `_bmad-output/implementation-artifacts/3-6-presentable-repository.md`
- `_bmad-output/implementation-artifacts/bmad-dev-auto-result-3-6-rerun.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/epic-3-context.md`
- `_bmad-output/implementation-artifacts/spec-3-6-presentable-repository.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/.memlog.md`
- `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md`
- `package.json`
- `src/components/landing-intro.astro`
- `src/components/poll-voting-surface.astro`
- `src/components/public-repository-link.astro`
- `src/pages/[reference]/results.astro`
- `test-results/story-3-6-presentable-repository-proof/results-1280-light.png`
- `test-results/story-3-6-presentable-repository-proof/results-375-dark.png`
- `test-results/story-3-6-presentable-repository-proof/voting-1280-light.png`
- `test-results/story-3-6-presentable-repository-proof/voting-375-dark.png`
- `tests/e2e/landing.spec.mjs`
- `tests/e2e/results.spec.mjs`
- `tests/e2e/vote.spec.mjs`
- `tests/unit/landing-page.test.mjs`
- `tests/unit/public-repository-contract.test.mjs`

## Change Log

- 2026-08-04: Created the comprehensive implementation brief from Epic 3, FR-27/SM-6, the architecture/UX spines, Story 3.5, current repository/GitHub state, and retrospective/deferred-work carryovers; status set to `ready-for-dev`.
- 2026-08-04: Applied the owner-approved FR-27 amendment permitting intentional public GitHub commit attribution while retaining credential, runtime/user-data, and unrelated/accidental-personal-data prohibitions; resolved the author-metadata policy gate.
- 2026-08-04: Implemented evaluator documentation, the shared public Poll repository footer, architecture/UX/deferred-ledger reconciliation, structural and browser proof, and a pinned value-hidden all-history audit; exact local gate passed and status advanced to `review`.
