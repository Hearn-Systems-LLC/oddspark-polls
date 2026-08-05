---
title: 'Story 4.4: XLSX Export'
type: 'feature'
created: '2026-08-05T13:44:08-04:00'
status: 'blocked'
baseline_revision: 'a4fa2ad899683c4c2f829555addeeeaa66ad1133'
final_revision: '2bd081baa86ded4d30ce929129fbaebc98dba490'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
warnings:
  - oversized
---

<intent-contract>

## Intent

**Problem:** Creators can download the canonical export only as CSV, which still requires import choices in spreadsheet applications and leaves the promised XLSX ownership path incomplete.

**Approach:** Add a workerd-compatible XLSX transport adapter and sibling owner-only download route that consume Story 4.3's unchanged canonical `VOTES`, `TALLY`, and `SUMMARY` dataset, then expose CSV and XLSX as adjacent direct controls.

## Boundaries & Constraints

**Always:** Reuse `queryD1OwnerExport` so authorization, one-snapshot projection, ordering, alignment, Tally reconciliation, and the privacy allowlist remain identical to CSV; create literal string or numeric cells only; preserve RFC 3339 timestamps and hostile formula-shaped text without CSV apostrophe neutralization; emit a valid workbook with `VOTES`, `TALLY`, and `SUMMARY` worksheets in that order, using numbered continuation sheets with repeated headers rather than truncating if a table exceeds XLSX's row limit; generate the complete workbook before returning bytes; keep GET/HEAD/error/cache/request/telemetry behavior aligned with CSV; execute serialization and round-trip parsing inside workerd; pin SheetJS CE 0.20.3 from its authoritative tarball and include its required Apache-2.0 attribution.

**Block If:** Workerd execution or the production bundle cannot meet the current Worker startup/build constraints; correctness requires changing domain, Poll Type, canonical projection, D1 persistence, adding a binding/credential/migration, silently truncating, inventing a Poll size limit, or switching to an asynchronous export; or the selected dependency cannot be pinned and attributed safely.

**Never:** Re-query D1 or recompute Tally in the XLSX adapter; export internal IDs, alignment keys, claims, digests, browser/session/IP material, OAuth identity, or other enforcement data; authorize from submitted identity or public Results visibility; create formulas, macros, hyperlinks, external references, client-side generation, a dialog, PDF, styling policy, or Poll Type switches in XLSX/HTTP code; edit committed migrations or weaken CSV behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner download | Owned Poll, any status or visibility | `200` `.xlsx`; canonical tables become ordered worksheets with exact logical cells | No error expected |
| Empty/rich export | Zero Votes or Unicode, multiline, numeric, and formula-shaped cells | Header-only `VOTES`, zero-inclusive Tally/Summary; text stays text with no formula and numbers stay numeric | No mutation or lossy coercion |
| Worksheet capacity | More rows than one XLSX worksheet can represent | Numbered continuation sheets repeat the header and preserve every row once and in order | Never truncate or emit an invalid range |
| Concealed target | Missing Poll or another owner | Identical private `404` before private projection | No attachment or correlation leak |
| Invalid request/failure | Signed out, HEAD, unsafe method, malformed facts, import/write failure | Guard redirect; bodyless HEAD parity; `405`; or safe no-partial `500` | Preserve `Allow`, no-store, nosniff, request ID, and privacy-safe telemetry |

</intent-contract>

## Code Map

- `src/modules/results/export.ts`, `src/lib/export-delivery.ts` -- unchanged canonical dataset and owner-authorized D1 composition root.
- `src/adapters/xlsx/index.ts` -- new dynamically loaded SheetJS workbook serializer and worksheet-capacity policy.
- `src/lib/export-http.ts`, `src/pages/creator/polls/[pollId]/export.{csv,xlsx}.ts` -- shared safe response metadata and sibling delivery endpoints.
- `src/pages/creator/polls/[pollId].astro` -- adjacent no-script creator export controls.
- `src/adapters/telemetry/index.ts` -- bounded XLSX route-operation normalization with no Poll or cell correlation.
- `tests/{unit,integration,e2e}` -- semantic round-trip, workerd route, privacy, interaction, and visual proof.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `pnpm-lock.yaml`, `THIRD_PARTY_NOTICES.md` -- pin SheetJS CE 0.20.3 from the official tarball, record required attribution, and avoid the stale public-registry release.
- [x] `src/adapters/xlsx/index.ts`, `tests/unit/xlsx-export.test.ts`, `tests/integration/xlsx-export-adapter.integration.test.ts` -- dynamically import the writer, map canonical tables to fixed/continued worksheets, and prove semantic round-trip, exact text/numeric cell types, no formula fields, input immutability, empty data, and real workerd execution.
- [x] `src/lib/export-http.ts`, `src/pages/creator/polls/[pollId]/export.csv.ts`, `src/pages/creator/polls/[pollId]/export.xlsx.ts`, `tests/integration/xlsx-export-route.integration.test.ts` -- share safe filename/base headers and add owner-only GET/bodyless HEAD/405 XLSX delivery with identical concealment and safe no-partial failures.
- [x] `src/pages/creator/polls/[pollId].astro`, `src/adapters/telemetry/index.ts`, `tests/unit/telemetry.test.ts` -- render `EXPORT CSV` then `EXPORT XLSX` side by side with existing focus/target tokens and normalize GET/HEAD XLSX operations without UUIDs or Poll correlation.
- [x] `tests/e2e/xlsx-export.spec.mjs`, `playwright.config.ts` -- prove authenticated keyboard download, safe filename, parsed rich/empty workbook semantics, every status/visibility combination, no dialog/navigation, CSV-to-XLSX focus order, narrow/light/dark layout, screenshots, and a clean console.
- [x] `README.md`, `CHANGELOG.md`, `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md`, `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md`, `_bmad-output/implementation-artifacts/epic-4-context.md` -- record XLSX as shipped, the selected writer/attribution, route topology, unchanged canonical seam, direct two-control experience, and remove the resolved deferred decision.
- [x] `_bmad-output/implementation-artifacts/spec-4-4-xlsx-export.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml` -- run the full Node 24.18.0 gate, inspect the scoped diff and bundle output, record evidence honestly, and synchronize BMad state without claiming remote release.

**Acceptance Criteria:**
- Given an authenticated Creator on an owned Poll detail, when they activate `EXPORT XLSX`, then a direct no-dialog `.xlsx` attachment contains every canonical Vote, complete Tally, and Summary from the same snapshot as CSV under every Poll status and Results visibility.
- Given empty, rich, hostile, or worksheet-capacity data, when the workbook is parsed, then every canonical cell appears exactly once in order with its string/number meaning preserved, no cell is a formula, and no private/enforcement fact exists.
- Given a signed-out, non-owner, missing, malformed, unsafe-method, HEAD, or writer-failure request, when the route handles it, then authorization precedes projection, foreign/missing targets are concealed, no partial workbook escapes, and safe method/cache/content/request headers and telemetry remain intact.
- Given the creator Poll detail at desktop and narrow widths in both modes, when export controls are inspected and keyboard-operated, then plain CSV and XLSX links are adjacent in source/focus order, keep 48px targets without overflow, and neither opens a configuration dialog or navigates the page.
- Given implementation and production output are inspected, when XLSX is generated, then SheetJS loads dynamically and runs inside workerd behind the existing export seam without changing Results, Poll Type, D1, bindings, migrations, or canonical persistence rules.

## Spec Change Log

## Review Triage Log

### 2026-08-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 1, medium 2, low 3)
- defer: 0
- reject: 10: (high 0, medium 2, low 8)
- addressed_findings:
  - `[high]` `[patch]` Protected every literal or overlapping `_xHHHH_` token before SheetJS writes shared strings, preserving valid voter text instead of silently decoding it as an OOXML escape.
  - `[medium]` `[patch]` Returned the writer's `ArrayBuffer` directly to the response instead of copying the complete generated workbook a second time.
  - `[medium]` `[patch]` Added an explicit 16,384-column XLSX boundary so an impossible future projection fails closed rather than emitting an invalid worksheet range.
  - `[low]` `[patch]` Rejected carriage returns before writing so corrupt non-canonical line endings cannot be silently normalized to LF.
  - `[low]` `[patch]` Rejected unpaired UTF-16 surrogates before writing so malformed text cannot be silently replaced with `U+FFFD`.
  - `[low]` `[patch]` Reused safe base headers on the route-level signed-out fallback, retaining `nosniff` alongside no-store.

### 2026-08-05 — Review pass
- intent_gap: 1: (high 1, medium 0, low 0)
- bad_spec: 1: (high 0, medium 1, low 0)
- patch: 2: (high 0, medium 1, low 1)
- defer: 0
- reject: 4: (high 0, medium 1, low 3)
- addressed_findings:
  - none

## Design Notes

SheetJS CE 0.20.3 is selected because its current official distribution supports ESM, array-of-arrays worksheets, XLSX byte output, and documents dynamic import as the Cloudflare Worker startup-limit workaround. Normal files contain exactly `VOTES`, `TALLY`, and `SUMMARY`; only a hard worksheet row overflow adds `VOTES 2`, `VOTES 3`, and so on. Each continuation repeats the canonical header, so spreadsheet applications open every row without invalid ranges or silent loss.

## Verification

**Commands:**
- `source /Users/justin/.nvm/nvm.sh && nvm use && pnpm migrations:guard && pnpm test && pnpm check` -- migration history, unit/integration/workerd behavior, and types pass on Node 24.18.0.
- `pnpm test:e2e` -- downloads, accessibility interaction, responsive light/dark proof, and console checks pass.
- `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` -- binding types do not drift, the shipping artifact builds within current limits, and the patch is clean.

**Implementation gate (2026-08-05):** Node 24.18.0 and pnpm 11.17.0;
migration guard `12/12`; Vitest `99` files / `1,384` tests; Playwright
`164/164`; TypeScript, generated binding drift, production build, and
`git diff --check` green. The production build emits SheetJS as a separate
`821K` lazy server chunk. Fresh 1280px light and 375px dark XLSX-control
captures were manually inspected from isolated Playwright output. Full-suite
proof side effects outside Story 4.4 were restored or moved to Trash. No push,
remote CI, staging, or production verification was performed.

**Post-review gate (2026-08-05):** Node 24.18.0 and pnpm 11.17.0;
migration guard `12/12`; Vitest `99` files / `1,385` tests; Playwright
`164/164`; TypeScript, generated binding drift, production build, and
`git diff --check` green after the six review patches. The focused XLSX
browser proof also passed `2/2`; fresh 1280px light and 375px dark captures
were inspected and retained under `test-results/story-4-4-xlsx-export-proof/`.

## Auto Run Result

Status: blocked

Blocking condition: intent gap in intent contract.

The fresh review established that the synchronous fully buffered export cannot
satisfy the contract's real worksheet-capacity case inside Cloudflare Workers'
128 MB per-isolate memory ceiling. The contract simultaneously requires more
than 1,048,575 data rows to continue without truncation, requires the complete
workbook before returning bytes, and forbids a Poll-size limit or asynchronous
export. A representative 50,000-row, five-column write already peaked near
385 MB RSS; the reduced-row-limit unit test proves continuation naming and
ordering but not production feasibility at the actual XLSX boundary.

Per the intent-gap branch, all Story 4.4 implementation, dependency,
documentation, test, and screenshot changes were reverted in the working tree
to baseline `a4fa2ad899683c4c2f829555addeeeaa66ad1133`. This spec remains as the
blocked decision record. No existing deferred-work entry was modified and no
new deferred item was added.

Other deduplicated findings were lower in the cascade and therefore not
applied: HEAD performs a complete workbook generation before discarding the
body; writer failures overload `resultsLookupFailed`; public documentation
claims XLSX is shipped without remote release evidence; and four hardening or
distribution observations were rejected as non-actionable for this pass.

Verification before reversion: focused XLSX/telemetry unit tests passed `39/39`,
focused workerd integration tests passed `9/9`, migration guard passed `12/12`,
the full Vitest gate passed `99` files / `1,385` tests, TypeScript passed, and
`git diff --check` was clean. Residual risk is explicit: XLSX export is absent
until the intent chooses a bounded synchronous contract or an asynchronous or
streaming architecture compatible with the Worker limit.
