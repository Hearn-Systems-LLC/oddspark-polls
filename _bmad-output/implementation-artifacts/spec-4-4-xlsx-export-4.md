---
title: 'Story 4.4: Bounded Synchronous XLSX Export'
type: 'feature'
created: '2026-08-05T23:33:54-04:00'
status: 'in-progress'
baseline_revision: 'bbe49a0194749b119be485286d31eca980ad12e2'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
warnings:
  - oversized
---

<intent-contract>

## Intent

**Problem:** Creators lack a native spreadsheet export, while an unbounded fully buffered workbook cannot be made reliably safe inside Cloudflare Workers' 128 MB isolate limit.

**Approach:** Deliver a complete synchronous XLSX for owned Polls with at most 1,000 accepted Votes. Enforce the bound inside one snapshot-consistent D1 fact statement using a 1,001st-Vote sentinel before canonical rows or workbook bytes are materialized; retain CSV as the larger-Poll path.

## Boundaries & Constraints

**Always:** Authorize ownership before private facts; keep XLSX transport-only; read at most 1,001 accepted Votes in one XLSX-specific D1 statement and snapshot; on oversize return no Vote/selection rows, canonical dataset, or workbook; preserve exact in-range logical parity with CSV's `VOTES`, `TALLY`, and `SUMMARY`; omit internal/enforcement identifiers; keep voter text and Poll correlation out of telemetry; prove the worst-shaped 1,000-Vote case in workerd and the production bundle.

**Block If:** The XLSX path reads or materializes beyond the sentinel; capacity requires another statement; any oversize path constructs private rows or workbook bytes; the maximum valid dataset exceeds the measured Worker envelope; or correctness requires changing CSV semantics, Poll Type policy, D1 persistence, bindings, migrations, or deployment topology.

**Never:** Generate XLSX at 1,001+ Votes; truncate or add continuation sheets; stream response bytes before the complete in-range workbook exists; weaken authorization, privacy, snapshot coherence, or CSV behavior; emit an oversize attachment; add storage, queues, jobs, service bindings, or client-side generation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| In-range owner | Owned Poll with 0–1,000 accepted Votes | `200` attachment with exactly `VOTES`, `TALLY`, `SUMMARY` and CSV-equivalent logical cells | Conceal missing/foreign Polls before projection |
| Oversize owner | Owned Poll with 1,001+ accepted Votes | No attachment; CSV remains available | `409`, no-store, exact text `XLSX export supports up to 1,000 accepted votes. Download CSV for larger Polls.` |
| Hostile/rich cells | Unicode, multiline, OOXML-token-like, or formula-shaped text; integer totals | Literal string/numeric cells only; no formulas, hyperlinks, macros, or lossy coercion | Reject NUL, CR, malformed Unicode, unsafe numbers, and worksheet-boundary violations before writing |
| Invalid/failure request | Signed out, HEAD, unsafe method, malformed facts, writer failure | Guard redirect; bodyless status/header parity; `405`; or safe no-partial `500` | Preserve `Allow`, private no-store, nosniff, request ID, and privacy-safe telemetry |

</intent-contract>

## Code Map

- `src/modules/results/export.ts`, `src/lib/export-delivery.ts` -- shared canonical materializer plus XLSX-specific ready/oversize composition without changing CSV.
- `src/adapters/d1/export/multiple-choice.ts` -- existing unbounded CSV driver and new separately bounded one-statement XLSX fact driver.
- `src/adapters/xlsx/index.ts`, `src/lib/export-http.ts` -- hardened SheetJS transport and shared private-download headers/filenames.
- `src/pages/creator/polls/[pollId]/export.xlsx.ts`, `src/pages/creator/polls/[pollId].astro` -- sibling endpoint and adjacent no-dialog control.
- `src/adapters/telemetry/index.ts` -- `.xlsx` route normalization without Poll/reference/cell data.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/results/export.ts`, `src/lib/export-delivery.ts`, `tests/unit/export.test.ts` -- add a discriminated bounded result and reuse one canonical validator/materializer; return oversize before the Poll Type strategy runs while leaving `queryD1OwnerExport` unchanged.
- [x] `src/adapters/d1/export/multiple-choice.ts`, `tests/integration/xlsx-export-adapter.integration.test.ts` -- add a single-statement driver that authorizes first, limits eligible Votes to 1,001 before canonical ordering, gates every private union branch on capacity, and proves 0/1,000/1,001/>1,001, one `prepare`, no oversize private rows, and in-range CSV parity.
- [x] `src/adapters/xlsx/index.ts`, `package.json`, `pnpm-lock.yaml`, `THIRD_PARTY_NOTICES.md`, `tests/unit/xlsx-export.test.ts` -- pin SheetJS CE 0.20.3 from its official tarball; dynamically import it; validate literal cells and worksheet limits; write exactly three ordered sheets to one in-memory buffer; round-trip rich/empty data without mutating input.
- [x] `src/lib/export-http.ts`, `src/pages/creator/polls/[pollId]/export.csv.ts`, `src/pages/creator/polls/[pollId]/export.xlsx.ts`, `tests/integration/xlsx-export-route.integration.test.ts` -- share safe HTTP policy, preserve CSV bytes, and implement GET/HEAD/405, concealed `404`, exact non-attachment `409`, serializer-not-called oversize proof, and safe writer/projection `500`.
- [x] `src/pages/creator/polls/[pollId].astro`, `src/adapters/telemetry/index.ts`, `tests/unit/telemetry.test.ts`, `tests/e2e/xlsx-export.spec.mjs` -- add adjacent keyboard-usable `EXPORT XLSX`, normalize telemetry, and prove download parsing, source/focus order, no dialog/navigation, oversize behavior, responsive light/dark layout, and clean console.
- [x] `README.md`, `CHANGELOG.md`, `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md`, `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md`, `_bmad-output/implementation-artifacts/epic-4-context.md` -- mark XLSX shipped and keep product, architecture, UX, attribution, and public setup truth synchronized.
- [x] `_bmad-output/implementation-artifacts/spec-4-4-xlsx-export-4.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml` -- record review evidence, run the complete Node 24 gate, inspect the scoped diff, and commit only explicit Story 4.4 paths.

**Acceptance Criteria:**
- Given an authenticated owner and 0–1,000 accepted Votes, when XLSX is activated, then one synchronous private attachment contains exactly the three canonical sheets with CSV-equivalent rows, ordering, Tally, Summary, and privacy guarantees.
- Given 1,001+ accepted Votes, when XLSX is activated, then the one bounded snapshot detects the sentinel and returns the exact `409` without projecting private rows or invoking the workbook writer, while CSV remains unchanged.
- Given 1,000 Votes each with 30 selections, maximum Comment/display-name/option text, when the production XLSX path runs in workerd, then it completes within the supported Worker envelope; 1,001 and any worksheet invariant violation fail closed before response bytes begin.

## Spec Change Log

## Review Triage Log

## Design Notes

The bounded D1 statement must limit the candidate Vote set before ordering so the cap does not require sorting an arbitrarily large Poll. After confirming at most 1,000, it may sort the eligible set by `(created_at_ms, bytewise Vote ID)` for canonical order. Every option, Vote, Comment, selection, Tally, and summary branch must be capacity-gated; oversize may return only a non-private capacity discriminator. SheetJS stays behind a dynamic import and produces a single `ArrayBuffer`; formula-shaped strings remain strings and no second workbook-buffer copy is introduced.

## Verification

**Commands:**
- `source /Users/justin/.nvm/nvm.sh && nvm use && pnpm migrations:guard && pnpm test && pnpm check` -- migration history, unit/integration behavior, workerd maximum-shape proof, and types pass on Node 24.18.0.
- `pnpm test:e2e` -- authenticated download, oversize response, accessibility, responsive visual proof, and console checks pass.
- `pnpm types` then binding drift check, `pnpm build:production`, and `git diff --check` -- generated bindings are unchanged, the shipping artifact builds, and the patch is clean.

**Implementation gate (2026-08-06):** Node 24.18.0; migration guard `12/12`; Vitest `99` files / `1,391` tests; Playwright `164/164`; TypeScript and generated binding drift green; production build and `git diff --check` passed. The workerd suite completed the maximum-shaped `1,000`-Vote by `30`-selection case and proved the `1,001+` sentinel exits before projection or serialization.
