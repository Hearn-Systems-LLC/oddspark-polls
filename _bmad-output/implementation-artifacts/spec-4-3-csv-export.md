---
title: 'Story 4.3: CSV Export'
type: 'feature'
created: '2026-08-05T11:47:25-04:00'
status: 'done'
baseline_revision: '0ee29582c491bd49c8a28792e350e61b356b5c1c'
final_revision: 'd678487e87a7e3b9d090d3b57ccaa32288975b05'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
warnings:
  - oversized
---

<intent-contract>

## Intent

**Problem:** Creators cannot take ownership of accepted Vote data outside Oddspark, and a naive export could leak enforcement identities, race the Tally, or couple future Poll Types to CSV-specific policy.

**Approach:** Add an owner-authorized Results query that builds one format-neutral, snapshot-consistent export dataset through a versioned Poll Type projection port, serialize it with a generic hardened CSV adapter, and expose it as a direct download from the existing creator Poll detail.

## Boundaries & Constraints

**Always:** Authenticate and prove Poll ownership before reading Vote, Comment, selection, or Tally facts; conceal missing and foreign Polls identically; select through a positive allowlist; include exactly one deterministically ordered row per accepted Vote with its Poll Type response, RFC 3339 UTC timestamp, current Comment/name when present, and the complete server-computed Tally including zero-count options and distinct Voter/selection totals; derive Poll Type-specific Vote and Tally shapes from the shared strategy contract; keep the canonical dataset format-neutral for Story 4.4; produce deterministic RFC-style CSV with spreadsheet-formula defenses; return private no-store responses and privacy-safe telemetry; read the raw rows and Tally in one D1 statement/snapshot and emit no partial file.

**Block If:** Correctness would require truncating an export, adding an asynchronous job, dependency, binding, credential, migration, or unsupported product limit; a future Poll Type cannot satisfy the versioned projection contract without an unresolved product decision; or consistent raw rows and Tally cannot be read within one D1 snapshot.

**Never:** Export Vote/Poll/user IDs, submission IDs, payload hashes, claims, digests, browser/session/IP material, OAuth identity, Comment IDs, or any other enforcement datum; authorize from a submitted owner/reference; gate creator export on public Results visibility; put Poll Type switches in D1, CSV, HTTP, or XLSX adapters; add XLSX, PDF, a configuration dialog, a disabled placeholder, client-side generation, or edit committed migrations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner download | Authenticated owner, any visibility/status | `200` attachment; `VOTES`, `TALLY`, and `SUMMARY` tables from one snapshot | No error expected |
| Empty Poll | No accepted Votes | Headers, zero Vote rows, every option at zero, zero Voter/selection totals | Valid download |
| Rich cells | Multi-select, Unicode, comma/quote/LF, formula-shaped text | Stable option-position cells, quoted CRLF CSV, dangerous spreadsheet prefixes neutralized only in CSV | Preserve logical data in canonical dataset |
| Concealed target | Missing Poll or another owner | Identical `404`, no private projection or correlation | `private, no-store` |
| Malformed facts | Cross-Poll/unknown/duplicate selection, invalid timestamp/comment, missing required facts, inconsistent Tally | Emit no partial file | Fail closed with safe `500` |
| Method/auth | `HEAD`, unsafe method, or signed-out visitor | HEAD mirrors GET status/headers without a body; unsafe method is `405`; signed-out returns through creator guard | Preserve `Allow`, no-store, and request ID |

</intent-contract>

## Code Map

- `src/shared/application/index.ts`, `src/modules/polls/types/multiple-choice.ts` -- frozen Poll Type strategy and the type-specific export projection.
- `src/modules/results/export.ts` -- provider-free owner query, canonical dataset, ordering, and invariant validation.
- `src/adapters/d1/index.ts`, `src/adapters/d1/export/multiple-choice.ts` -- purpose-shaped owner envelope and snapshot-consistent export fact read.
- `src/lib/export-delivery.ts` -- Poll Type driver composition kept out of generic HTTP delivery.
- `src/adapters/csv/index.ts` -- generic CSV table serialization, escaping, and formula neutralization.
- `src/pages/creator/polls/[pollId]/export.csv.ts`, `src/pages/creator/polls/[pollId].astro` -- attachment endpoint and plain direct-download control.
- `src/adapters/telemetry/index.ts`, `src/middleware.ts` -- private creator response and normalized telemetry boundaries.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/application/index.ts`, `src/modules/polls/types/multiple-choice.ts`, `docs/design/poll-type-contract-check.md`, `tests/unit/shared-kernel.test.ts`, `tests/unit/polls.test.ts` -- version the frozen contract and add a required typed `projectExport` port whose multiple-choice implementation supplies raw selection cells and zero-inclusive Tally rows in stable option order; update every compile-time consumer rather than adding an exporter-owned switch.
- [x] `src/modules/results/export.ts`, `tests/unit/export.test.ts` -- define the reusable canonical `VOTES`, `TALLY`, and `SUMMARY` dataset and owner-authorized query; validate chronological `(createdAtMs, private internal-id tie-breaker)` ordering, one aligned row per Vote, selection bounds/uniqueness/ownership, Comment/name/timestamp invariants including the `Date.toISOString()` range, and raw/Tally reconciliation without exposing internal tie-breakers.
- [x] `src/adapters/d1/index.ts`, `src/adapters/d1/export/multiple-choice.ts`, `tests/integration/csv-export-adapter.integration.test.ts` -- authorize a minimal owner envelope first, then project only allowed facts and Tally in one D1 statement; prove empty/multi-select/commented data, deterministic ties, concurrent consistency, foreign-option corruption failure, and enforcement sentinels absent from outward structures.
- [x] `src/adapters/csv/index.ts`, `tests/unit/csv-export.test.ts` -- serialize deterministic UTF-8 without BOM using comma delimiters, quoted cells, doubled quotes, preserved embedded LF, CRLF records, and a final CRLF; prefix an apostrophe when leading ASCII whitespace precedes `=`, `+`, `-`, or `@`, without mutating canonical cells.
- [x] `src/pages/creator/polls/[pollId]/export.csv.ts`, `tests/integration/csv-export-route.integration.test.ts` -- implement GET, explicit bodyless HEAD, and 405 delivery with `text/csv; charset=utf-8`, `attachment; filename="oddspark-<safe-reference>.csv"`, `nosniff`, and `private, no-store`; conceal foreign/missing targets and map projection failures to a safe 500.
- [x] `src/pages/creator/polls/[pollId].astro`, `src/adapters/telemetry/index.ts`, `src/middleware.ts`, `tests/unit/telemetry.test.ts` -- add one keyboard-usable `EXPORT CSV` link with no script/dialog, keep all creator outcomes private, and normalize GET/HEAD operations without recording Poll/reference/cell values.
- [x] `tests/e2e/csv-export.spec.mjs`, `playwright.config.ts`, `.gitignore` -- prove the authenticated download event, safe filename, rich/empty content, all visibility/status combinations, keyboard/no-dialog/no-navigation behavior, responsive light/dark presentation, and clean console while isolating rerun output from committed proof.
- [x] `CHANGELOG.md`, `README.md`, `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md`, `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md`, `_bmad-output/implementation-artifacts/epic-4-context.md` -- mark CSV shipped and XLSX planned, and record the versioned export port, format-neutral dataset, real route topology, direct control, one-snapshot rule, and privacy allowlist.
- [x] `_bmad-output/implementation-artifacts/spec-4-3-csv-export.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml` -- run the full Node 24.18.0 repository gate, inspect the final baseline diff for unrelated files and forbidden fields, synchronize story state, record honest evidence, and commit each green logical round with explicit-path staging only.

**Acceptance Criteria:**
- Given a signed-in Creator on an owned Poll detail, when they activate `EXPORT CSV`, then a direct no-dialog attachment contains one raw row per accepted Vote plus the complete Tally from the same D1 snapshot, for open or closed Polls under every Results visibility.
- Given an empty, single-select, or multi-select Poll with optional Comments/names and hostile CSV text, when its export is parsed, then row/order/count/timestamp semantics are deterministic, spreadsheet-safe, and lossless at the canonical dataset boundary.
- Given a signed-out, non-owner, missing, malformed, or unsupported request, when the endpoint handles it, then authorization precedes projection, foreign and missing targets are concealed, no partial/private facts escape, and every response retains safe method/cache/request headers.
- Given implementation and telemetry are inspected, when export data flows from D1 to CSV, then only the positive allowlist crosses the Results projection and no enforcement identity, internal identifier, reference, or voter text reaches the file where forbidden or operational telemetry.
- Given a later Poll Type or Story 4.4 adapter, when it implements or consumes export, then the versioned Poll Type port supplies its row shape and the same format-neutral dataset is reused without reopening generic CSV, XLSX, HTTP, or persistence rules.

## Spec Change Log

## Review Triage Log

### 2026-08-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 1, medium 5, low 1)
- defer: 0
- reject: 6: (high 0, medium 3, low 3)
- addressed_findings:
  - `[high]` `[patch]` Replaced the timestamp-only response witness with identifier-free alignment keys, detecting equal-timestamp row swaps without exposing persistence IDs.
  - `[medium]` `[patch]` Removed internal Poll correlation from export-route telemetry and added a middleware-level assertion that successful export records retain `pollId: null`.
  - `[medium]` `[patch]` Allowed valid domain-level multiline option labels through the canonical dataset and proved them in a successful single-select D1 export.
  - `[medium]` `[patch]` Rejected Poll Type Vote columns that collide with shared `TIMESTAMP`, `DISPLAY NAME`, or `COMMENT` columns.
  - `[medium]` `[patch]` Bound fact drivers to the matching typed strategy and rejected duplicate runtime driver registration.
  - `[medium]` `[patch]` Added the missing successful single-select export coverage with exact row, Tally, and Summary semantics.
  - `[low]` `[patch]` Replaced substring-only serializer assertions with the complete expected CSV byte framing.

### 2026-08-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 3, medium 2, low 1)
- defer: 0
- reject: 5: (high 0, medium 3, low 2)
- addressed_findings:
  - `[high]` `[patch]` Bound each Poll Type response row to its own identifier-free alignment key and bumped the constrained contract to version 5, so equal-timestamp row swaps fail closed.
  - `[high]` `[patch]` Rejected an owner envelope whose Poll ID differs from the requested Poll before any private fact projection can run.
  - `[high]` `[patch]` Rejected NUL-bearing Poll Type cells in projection and CSV serialization, closing the control-stripping spreadsheet-formula bypass without emitting a partial file.
  - `[medium]` `[patch]` Moved Poll Type driver registration into `src/lib/export-delivery.ts`, keeping the generic HTTP endpoint closed to type-specific composition.
  - `[medium]` `[patch]` Constrained custom `TExportProjection` generics to `PollTypeExportProjection` and added a compile-time regression consumer.
  - `[low]` `[patch]` Corrected the architecture source of truth from stale contract version 3 to version 5.

### 2026-08-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 2, medium 1, low 2)
- defer: 0
- reject: 13: (high 0, medium 6, low 7)
- addressed_findings:
  - `[high]` `[patch]` Neutralized formula markers preceded by vertical-tab or form-feed so every leading ASCII-whitespace case is spreadsheet-safe.
  - `[high]` `[patch]` Reused the Polls-owned canonical Custom Link validator so valid leading/trailing-hyphen references no longer make owner exports fail, with adapter and route coverage.
  - `[medium]` `[patch]` Capped canonical timestamps at RFC 3339's four-digit-year boundary so extended-year ISO output fails closed.
  - `[low]` `[patch]` Strengthened the one-snapshot regression to fail if the type-specific fact driver prepares any second statement.
  - `[low]` `[patch]` Updated the frozen-contract compile-time audit to name and describe all five typed ports, including `projectExport`.

## Design Notes

The canonical dataset contains three typed tables: `VOTES` has shared timestamp/Comment/name columns plus Poll Type response columns, `TALLY` has Poll Type rows including zero-count options, and `SUMMARY` has distinct Voter and selection totals. Multiple-select responses use stable `SELECTION 1..N` columns in Poll option order. Contract version 5 binds every type-specific response row to its identifier-free alignment witness and constrains custom projection generics to the shared shape; Poll Type driver registration lives in the delivery composition root rather than HTTP. CSV rendering is a transport concern; the canonical cells remain unescaped and un-neutralized for Story 4.4. The one-statement D1 result is necessarily materialized to validate whole-dataset invariants before any bytes are emitted; unbounded streaming or a product size policy is outside this story unless Worker limits are demonstrated by the required tests.

## Verification

**Commands:**
- `source /Users/justin/.nvm/nvm.sh && nvm use && pnpm migrations:guard && pnpm test && pnpm check` -- migration history, unit/integration behavior, and types pass on Node 24.18.0.
- `pnpm test:e2e` -- direct download, accessibility, responsive visual proof, and console checks pass.
- `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` -- generated bindings do not drift, the shipping artifact builds, and the patch is clean.

**Implementation gate (2026-08-05):** Node 24.18.0 and pnpm 11.17.0; migration guard `12/12`; pre-review Vitest `96` files / `1,357` tests and Playwright `162/162`; review-patched Vitest `96` files / `1,360` tests and focused CSV Playwright `2/2`; TypeScript, generated binding drift, production build, and `git diff --check` green before review, with final post-review build/hygiene confirmation recorded in the Auto Run Result. Full-suite screenshot side effects outside Story 4.3 were restored or moved out of the worktree.

**Follow-up review gate (2026-08-05):** Node 24.18.0; focused Vitest `4` files / `205` tests plus CSV integration `2` files / `15` tests; full Vitest `96` files / `1,366` tests; Playwright `162/162`; migration guard `12/12`; TypeScript, generated binding drift, production build, and `git diff --check` green. Fresh 1280px light and 375px dark CSV-control captures were manually inspected from isolated Playwright output; unrelated full-suite proof side effects were restored or moved out of the worktree.

**Second follow-up review gate (2026-08-05):** Node 24.18.0 and pnpm 11.17.0; migration guard `12/12`; Vitest `96` files / `1,369` tests; Playwright `162/162`; TypeScript, generated binding drift, production build, and `git diff --check` green. Full-suite browser-proof side effects outside Story 4.3 were restored or moved out of the worktree before the scoped commit.

## Auto Run Result

Status: done

### Summary

Completed a second independent follow-up review of Story 4.3 and closed five CSV export edge cases. Spreadsheet neutralization now covers every leading ASCII-whitespace byte, timestamps stay inside RFC 3339's four-digit-year range, valid leading/trailing-hyphen Custom Links export successfully through the Polls-owned validator, the one-statement proof detects any extra prepare, and the frozen-contract audit names all five ports.

### Files changed

- `src/adapters/csv/index.ts`, `tests/unit/csv-export.test.ts` -- cover vertical-tab and form-feed formula prefixes.
- `src/modules/results/export.ts`, `tests/unit/export.test.ts` -- fail closed beyond the RFC 3339 timestamp ceiling.
- `src/modules/polls/index.ts`, `src/adapters/d1/index.ts` -- share canonical Custom Link validation without rejecting domain-valid boundary hyphens.
- `tests/integration/csv-export-adapter.integration.test.ts`, `tests/integration/csv-export-route.integration.test.ts` -- prove one-statement projection and successful boundary-slug delivery.
- `tests/unit/shared-kernel.test.ts` -- correct the five-port compile-time contract audit.
- `_bmad-output/implementation-artifacts/spec-4-3-csv-export.md` -- record triage, verification, final revision, and completion.

### Review

- Applied `5` findings: `2` high, `1` medium, `2` low.
- Deferred `0`; rejected `13` after checking current domain constraints, the explicit HEAD/materialization design, and speculative future-driver or platform-limit claims.
- Follow-up review recommended: `true`, because this pass repaired spreadsheet safety, canonical timestamp correctness, and a valid owner-download failure path.
- The deferred-work ledger was not modified.

### Verification

- Node `24.18.0`; pnpm `11.17.0`; migration guard `12/12`.
- Vitest `96/96` files and `1,369/1,369` tests.
- Playwright `162/162` tests, including both CSV export browser cases.
- TypeScript check passed; generated binding types had no drift; production build and `git diff --check` passed.

### Residual risks

- The intentionally materialized one-snapshot export remains bounded only by the Poll's valid data and Worker limits; this review found no measured threshold or repository evidence that justifies inventing a product cap, truncation, asynchronous job, dependency, or binding.
- HEAD intentionally performs the same validation as GET before returning a bodyless response so its status and headers mirror delivery behavior.
- Local green and committed proof do not establish remote CI, staging, or production deployment; this run did not push.
