---
baseline_commit: a002caba9c184bbf38ec3dff6b2127d34b3d5273
baseline: "origin/main @ a002caba9c184bbf38ec3dff6b2127d34b3d5273 (Story 3.5 done)"
dependency_story: 3-5-demo-poll
epic: "3 — Public Face: Discovery, Landing & Demo"
---

# Story 3.6: Presentable Repository

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a technical evaluator arriving from the demo,
I want the public repository to explain the product, the architecture, and how to run it,
So that the code itself completes the portfolio argument (FR-27, SM-6).

## Acceptance Criteria

Verbatim from `_bmad-output/planning-artifacts/epics.md` § Story 3.6 (lines 812–827):

1. **Given** the public repository, **When** a technical reader evaluates it, **Then** the README covers what the product is, why it exists, the stack, and how to run it locally, and architecture notes sufficient to evaluate the work are present (linking or summarizing the architecture spine's decisions), **And** the landing page's repository link resolves to it (FR-25).

2. **Given** the full repository history, **When** audited, **Then** no secrets, tokens, or personal data exist in any commit (FR-27).

## Tasks / Subtasks

- [ ] Task 1: Turn the existing README into an evaluator-first product and run guide without losing operational truth (AC: #1)
  - [ ] UPDATE `README.md`; do not replace it wholesale. Keep the accurate environment, OAuth, masked provisioning, Turnstile privacy, Demo recovery, administration, migration, and deploy sections. Add a short opening sequence that answers, in order: what Oddspark Polls is, why it exists, what is shipped now, how to try the live product, and where the roadmap goes.
  - [ ] State current capability in an explicit shipped/planned matrix. Shipped: Multiple-Choice (including multi-select), Session/IP checks, Turnstile, rate limiting, sharing, live Results, lifecycle, Discovery/moderation, landing, and Demo. Planned/backlog: Comments, CSV/XLSX export, Ranked, Image, Meeting, Voter Codes, and VPN Blocking unless the implementation-time repository proves otherwise. R2 being configured is infrastructure, not proof that Image Polls ship.
  - [ ] Correct the headline's dead-link risk: the currently live production Worker is `https://oddspark-polls.hearnsystems.workers.dev`; `polls.oddspark.dev` remains the product/custom-domain identity but is not a working destination until actually bound. Re-query before editing and never present a planned domain as live.
  - [ ] Add the carried-forward active-product/dogfood map: landing Demo → Discover or sign-in → create → canonical Poll → vote → Results/share, with the concrete public/creator routes a reader needs. Keep internal auth callbacks and operator-only endpoints in the technical reference rather than the primary tour.
  - [ ] Make local setup executable from a fresh clone: pinned Node/pnpm prerequisites; `pnpm install`; masked local provisioning through `scripts/provision-auth-secrets.zsh` (never pasted values); `pnpm migrate:local`; `pnpm dev`; focused/full tests; and the distinction between local-flavored `pnpm build` and the shipping `pnpm build:production` artifact.
  - [ ] Replace the incomplete manual-gate example with the exact repository order: `pnpm migrations:guard` → `pnpm test` → `pnpm check` → `pnpm test:e2e` → `pnpm types` → binding drift check → `pnpm build:production` → `git diff --check`. Keep staging/production migrations, preflight, deploy, smoke, and authorization clearly outside ordinary local verification.
  - [ ] UPDATE `package.json` metadata only where it is stale: remove the unbound live-domain claim from `description`; set `repository` to `{ "type": "git", "url": "https://github.com/Hearn-Systems-LLC/oddspark-polls.git" }` and `homepage` to `https://github.com/Hearn-Systems-LLC/oddspark-polls`; keep `private: true`. Do not change package versions, scripts, dependencies, module type, or release version for presentation.

- [ ] Task 2: Make the authoritative architecture easy to evaluate and reconcile public documentation with the real tree (AC: #1)
  - [ ] Add a compact README Architecture section that links directly to `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md`. Summarize, rather than duplicate, the decisions a reviewer needs: one Astro Worker as a hexagonal modular monolith (AD-1); server-rendered progressive enhancement (AD-2); D1 fact ownership and legal write paths (AD-6/AD-19); constrained voting/privacy (AD-7/AD-8); isolated environments and staged promotion (AD-14); voter-blind telemetry (AD-15); and auth-before-projection (AD-21).
  - [ ] UPDATE the spine's Structural Seed and comments to match the merged tree: include `src/lib`, `src/layouts`, `src/styles`, the cache and Demo seams, and the actual middleware chain responsibility. Preserve the spine as the single architecture source; do not add a second `docs/architecture.md` or copy its full decision text into README.
  - [ ] Reconcile every README stack/binding/environment/build claim against `package.json`, `pnpm-lock.yaml`, `wrangler.jsonc`, `.github/workflows/deploy.yml`, and current routes. The lockfile/config/workflow win over old prose. No dependency upgrade, binding, migration, provider, secret, or deployment-topology change belongs to this story.
  - [ ] UPDATE `docs/administration.md` or `docs/recovery.md` only if a link or statement is stale. Preserve their no-identifiers/no-credentials contract and do not duplicate them into README.
  - [ ] UPDATE `_bmad-output/implementation-artifacts/deferred-work.md` as a truth ledger: mark only demonstrably resolved entries resolved with evidence (at minimum Playwright-in-CI, production smoke, Story 3.5 header extraction, and Structural Seed drift after the spine fix); correct moved file references; retain genuine open items without implementing them. Triage **every** remaining open ledger item with the retrospective taxonomy (`blocks-3`, `nice`, or `3+`) and a named owner, explicitly including the three carried Epic 2 harness items; do not silently delete or opportunistically implement them.
  - [ ] Record the README dogfood-map and deferred-ledger follow-through in this story's completion notes. Leave the unrelated untracked Epic 1/Epic 2 retrospective artifacts and their mirrored `sprint-status.yaml` action-item rows to the retrospective workflow; Story 3.6 must not adopt, stage, or partially reconcile those user-owned files.

- [ ] Task 3: Complete the repository-link journey, including the UX-specified Poll footer, from one canonical presentation source (AC: #1)
  - [ ] Preserve the exact public repository destination `https://github.com/Hearn-Systems-LLC/oddspark-polls`. At implementation time prove the GitHub repository is still public, defaults to `main`, and is reachable; a local `href` assertion alone is not resolution evidence.
  - [ ] Keep Story 3.4/3.5 landing behavior intact: plain-language statement, separate technical account, repository entry, smoke marker, embedded Demo, create/Discover entries, responsive order, `private, no-store`, supported methods, and exact copy contracts. Do not redesign the landing page.
  - [ ] Close the inherited `EXPERIENCE.md` Information Architecture requirement that the public repository is reached from the landing page **and Poll footer**. Add one understated text-labelled repository entry to the public voting and Results surfaces only; do not turn the header into navigation or add it to creator/operator/auth pages.
  - [ ] UPDATE `DESIGN.md` and `EXPERIENCE.md` narrowly to define the footer component, exact surfaces and exclusions, source order, focus treatment, target size, and no-JavaScript behavior. The repository entry appears on canonical public voting and every existing Poll Results state (including hidden Results), but not on 404, embedded Demo, creator, auth, administration, or moderation surfaces.
  - [ ] Centralize the public repository URL in one exact presentation seam: a shared public-repository link/footer component or presentation-config constant consumed by landing, voting, and Results. Keep Astro/provider types out of domain modules; this is presentation configuration, not Poll policy.
  - [ ] The footer entry is a real link labelled in words, keyboard reachable in reading order, at least 44px high, visibly focused with the existing tokenized 2px/2px outline, and styled with existing label/hairline/whitespace tokens. It opens in the same tab, has no icon-only/color-only meaning, adds no JavaScript, and retains the same mobile/dark and desktop/light silhouette.
  - [ ] Do not add a `LICENSE`, `CONTRIBUTING`, `SECURITY`, or `CODE_OF_CONDUCT` file without an explicit owner decision about licensing/contact/governance. Public source is not permission to invent an open-source license.

- [ ] Task 4: Audit all reachable history for credentials and personal data without disclosing candidate values (AC: #2)
  - [ ] FIRST resolve the literal author-metadata gate with Justin. The governing AC says **no personal data in any commit**; intentional public attribution is still personal data and is not an implicit exception. Audit author/committer names and emails, signatures, and trailers. If public attribution is meant to be permitted, formally amend FR-27 and Story 3.6 through the appropriate BMad product workflow before claiming the AC. Otherwise, the existing non-noreply metadata requires a separately authorized coordinated history rewrite. Until one path is chosen and completed, AC #2 remains `PENDING`; `.mailmap` cannot change commit objects.
  - [ ] Establish a reproducible remote audit boundary, preferably in an outside-the-worktree mirror: fetch/prune the authoritative remote heads and tags, record safe ref names/tips, reachable commit count, and a deterministic digest of the sorted commit-ID set; reconcile the remote refs again after scanning. Scanning only `HEAD`, the current tree, or the latest five commits does not satisfy this AC.
  - [ ] Run an established full-history detector, not a home-grown regex as sole evidence. Planning-time research found Gitleaks `v8.30.1` current on 2026-08-04 and the local binary absent; at implementation time verify/pin the release and binary checksum, identify the default/config ruleset, and run the equivalent of `gitleaks git --redact=100 --log-opts="--all" <repository>`. Record the exact command, tool/version, checksum/config identity, audited ref-set digest, exit code, and finding-class counts—never match text or secret values. Keep any redacted report in a permission-restricted temporary location and destroy it after safe classification.
  - [ ] Classify known public/dummy examples narrowly. The official Cloudflare test credential material already documented for local/CI is not a production secret, but any exception must be exact-fingerprint/path/rule scoped. Never allowlist all tests, docs, `.agents`, `_bmad-output`, a filename class, or a provider pattern.
  - [ ] Separately audit historical paths and content for forbidden artifacts: `.dev.vars`, `.env*`, private keys/certificates, raw provisioning output, cookies/JWTs, OAuth credentials, capability URLs, internal user/Poll IDs, raw IPs or digests, emails/identities from runtime data, Poll/Vote/Comment/ballot exports, screenshots/logs containing them, and other personal data. `.gitignore` only prevents future additions; it proves nothing about prior commits.
  - [ ] Re-query repository security configuration. Planning-time GitHub API evidence showed the public repository's repository-level secret scanning, non-provider patterns, validity checks, and push protection all `disabled`. The reproducible all-remote-ref Gitleaks/content/metadata audit is the required AC #2 evidence; native GitHub controls are defense-in-depth hardening, not a substitute or completion dependency. Enable applicable native controls only with explicit remote-configuration authority, then wait for backfill and verify scan history plus value-hidden alert state without retrieving or printing literal alert secrets. Otherwise record the hardening as separately authorized follow-up, not an AC failure.
  - [ ] If any real credential/token ever entered history, stop at `NO-GO`, revoke/rotate it before any other remediation, and do not mark the story complete because the current file was deleted. If any personal data remains under the governing literal AC, stop at `NO-GO`. History rewriting/force-push, branch/tag replacement, clone invalidation, and alert resolution are destructive shared-state operations requiring separate explicit authorization and coordination; dev-story has no implicit authority to perform them.
  - [ ] Re-run the full audit after any separately authorized remediation and before completion. Do not commit scanner reports, candidate values, GitHub alert payloads, temporary clones, or user-identifying evidence.

- [ ] Task 5: Add focused repository-contract and browser proof without creating brittle prose tests (AC: #1, #2)
  - [ ] ADD a focused unit/source-contract test (for example `tests/unit/public-repository-contract.test.mjs`) that checks structural invariants only: the README's architecture link resolves to a tracked file; the README exposes the product-tour/local-run/full-gate commands; package/landing/footer repository URLs agree statically; and no sensitive report path is tracked. A local test cannot prove a production URL or repository is currently reachable. Do not snapshot paragraphs or assert incidental wording.
  - [ ] UPDATE `tests/unit/landing-page.test.mjs` only as needed for the centralized repository-link seam. Preserve the exact opening/build-account/smoke-marker contracts and prove the landing link remains explicit.
  - [ ] UPDATE `tests/e2e/vote.spec.mjs`, `tests/e2e/results.spec.mjs`, and the existing landing contract for the Poll-footer link on `/{reference}` and `/{reference}/results`, including hidden-results states where the Poll still exists and the explicit exclusions above. Prove same-tab navigation target, focus visibility, ≥44px target, source order, no overflow, and no new console/network failures. Do not test GitHub availability from routine CI; perform one explicit external reachability check as completion evidence.
  - [ ] Capture inspected browser proof under `test-results/story-3-6-presentable-repository-proof/` at 375px dark and 1280px light only because rendered Poll surfaces change. Show the footer on voting and Results, with keyboard focus and the existing Poll content intact; never capture auth state, cookies, identifiers, secret-scanning screens, or audit findings.
  - [ ] Render-review the README on GitHub (or a faithful local renderer): headings are scannable, tables fit, Mermaid diagrams/relative links resolve, commands are copyable, and current-versus-roadmap claims are unambiguous. The repository page itself is the visual artifact; do not manufacture a separate brochure.
  - [ ] UPDATE `CHANGELOG.md` under `[Unreleased]` for the evaluator-facing README/architecture journey, Poll-footer repository entry, and future secret-history guard/config once actually present. Do not claim a GitHub security control was enabled unless verified remotely.

- [ ] Task 6: Run the exact gate, maintain evidence, and preserve local/remote boundaries (AC: all)
  - [ ] Under Node `24.18.0` and pnpm `11.17.0`, run the complete local gate in repository order: `pnpm migrations:guard`, `pnpm test`, `pnpm check`, `pnpm test:e2e`, `pnpm types`, `git diff --exit-code worker-configuration.d.ts`, `pnpm build:production`, and `git diff --check`. Record fresh totals/results; Story 3.5's 1,251 Vitest / 153 Playwright totals are historical only. Do not misstate this as the exact current GitHub Actions job: its test/build job presently ends at `pnpm build:production`, while the local story gate adds the final diff check.
  - [ ] Run a Markdown/relative-link check and the value-redacted all-refs history audit separately from the application gate. A green application suite cannot substitute for AC #2.
  - [ ] Keep this story's Dev Agent Record, File List, Change Log, history-audit summary, and `sprint-status.yaml` current. No `TODO`, skipped/only test, placeholder, undocumented deferral, secret/candidate value, or prohibited runtime/user identifier may remain; public project attribution is governed by the unresolved AC #2 classification, not silently erased from evidence.
  - [ ] Preserve the two unrelated untracked Epic 1/Epic 2 retrospective files already in the worktree; stage only explicit Story 3.6/status/product paths. Do not commit, push, enable remote controls, rewrite history, deploy, or merge unless separately authorized.

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
| D7 | What personal data is forbidden? | Apply the literal AC until the governing requirements are formally amended: personal data includes author/committer names and emails, signatures, and trailers as well as runtime/user/voter/operator data, identifiers, credentials, tokens, cookies, IPs/digests, Poll/Vote content, and capability URLs. Owner intent alone does not create an exception. |
| D8 | What happens on a real finding? | `NO-GO`; rotate/revoke real credentials first. Any rewrite/force-push is a separately authorized incident, never an ordinary dev-story subtask. Personal-data findings remain blockers unless the governing requirement is formally amended. |
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
- GitHub native scanning is useful defense-in-depth but is not the AC gate. A regex/entropy detector alone cannot prove absence of all personal data; the completion claim requires the reproducible Gitleaks, historical content/path, and metadata layers in Task 4.

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

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Planning-time baseline is ready, but AC #2 remains implementation-time `PENDING` until the literal author-metadata requirement is either satisfied or formally amended and the reproducible all-remote-ref audit passes without disclosing values. GitHub-native hardening remains separately authorized defense-in-depth.

### File List

- `_bmad-output/implementation-artifacts/3-6-presentable-repository.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (updated to `ready-for-dev`; repaired pre-existing Story 3.5 indentation defect)

## Change Log

- 2026-08-04: Created the comprehensive implementation brief from Epic 3, FR-27/SM-6, the architecture/UX spines, Story 3.5, current repository/GitHub state, and retrospective/deferred-work carryovers; status set to `ready-for-dev`.
