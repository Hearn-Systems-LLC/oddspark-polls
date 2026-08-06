---
title: 'Story 4.4: Bounded Synchronous XLSX Export'
type: 'feature'
created: '2026-08-05T23:35:00-04:00'
status: 'blocked'
baseline_revision: '3f4d856'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Creators still lack the promised XLSX ownership export, while an unbounded fully buffered workbook cannot be made reliably safe inside Cloudflare Workers' fixed 128 MB isolate limit.

**Approach:** Deliver a complete synchronous XLSX for owned Polls with at most 1,000 accepted Votes. Enforce the bound inside one snapshot-consistent D1 fact statement using a 1,001st Vote sentinel before canonical rows or workbook bytes are materialized; preserve CSV as the larger-Poll ownership path.

## Boundaries & Constraints

**Always:** Keep XLSX transport-only; authorize ownership before reading private facts; for XLSX, use one D1 fact statement and one snapshot that reads at most 1,001 accepted Votes, treats the extra Vote only as an oversize sentinel, and returns no Vote or selection rows when the cap is exceeded; for in-range Polls preserve exact logical parity with CSV's canonical `VOTES`, `TALLY`, and `SUMMARY`; omit internal identifiers and enforcement data; keep voter text and Poll correlation out of telemetry; prove 1,000/1,001 behavior and worst-shaped in-range data in workerd and the production bundle.

**Block If:** The XLSX path reads or materializes more than 1,001 accepted Votes; capacity is checked in a second statement or outside the fact-projection snapshot; any oversize path constructs private canonical rows or workbook bytes; a max-shaped 1,000-Vote Poll cannot complete within the measured Worker envelope; or implementation requires changing CSV behavior, domain/Poll Type semantics, D1 persistence, bindings, migrations, or deployment topology.

**Never:** Generate XLSX for 1,001 or more accepted Votes; truncate rows; add continuation worksheets; stream response bytes before the complete in-range workbook exists; weaken authorization, privacy, Tally coherence, or CSV behavior; return an attachment or partial workbook on oversize; or add bindings, migrations, storage, queues, jobs, or service topology.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| In-range owner export | Owned Poll with 0–1,000 accepted Votes | Direct `200` `.xlsx` contains exactly `VOTES`, `TALLY`, and `SUMMARY`, with every canonical row and Tally value matching CSV | Conceal foreign/missing Polls and emit no private partial artifact |
| Oversize owner export | Owned Poll with 1,001 or more accepted Votes | No attachment; CSV remains available | HTTP `409`, no-store, exact plain text `XLSX export supports up to 1,000 accepted votes. Download CSV for larger Polls.` |
| Capacity enforcement | Authorized XLSX fact projection reaches the 1,001st Vote in its single D1 snapshot | Return an explicit oversize result without Vote/selection rows, canonical projection, or workbook generation | Never truncate to 1,000 or expose the sentinel as export data |
| Worksheet boundary | Any in-range canonical input violates XLSX row/column invariants | No workbook; the 1,000-Vote contract means continuation sheets are never valid output | Fail closed before response bytes begin |
| Serialization failure | Writer or import failure occurs before delivery | Safe no-partial `500` with established private export headers and telemetry | No attachment or workbook bytes escape |

</intent-contract>

## Code Map

- `src/lib/export-delivery.ts` -- current owner-authorized export composition root.
- `src/modules/results/export.ts` -- format-neutral `CanonicalExportDataset` plus an explicit pre-projection XLSX capacity result.
- `src/adapters/d1/export/multiple-choice.ts` -- XLSX-bounded one-statement projection with the 1,001st-Vote sentinel; preserve the existing unbounded CSV call path.
- `src/pages/creator/polls/[pollId]/export.csv.ts` -- current direct-download concealment, headers, HEAD, and safe-failure behavior.
- `src/pages/creator/polls/[pollId]/export.xlsx.ts` -- bounded sibling download and stable oversize response.
- `_bmad-output/planning-artifacts/{epics.md,prds,architecture,ux-designs}` -- governing product, architecture, and immediate-download UX contracts that require reconciliation.

## Tasks & Acceptance

**Execution:**
- [x] `_bmad-output/planning-artifacts/epics.md`, PRD, architecture spine, UX experience, and `epic-4-context.md` -- ratify and reconcile the 1,000-Vote bounded synchronous delivery contract.
- [ ] `src/modules/results/export.ts`, `src/lib/export-delivery.ts`, `src/adapters/d1/export/multiple-choice.ts` -- add an explicit XLSX capacity outcome and enforce the 1,001st-Vote sentinel inside the single fact-projection snapshot without changing CSV behavior.
- [ ] XLSX adapter, route, UI, telemetry, dependency attribution, tests, and public docs -- implement direct in-range delivery plus the exact `409` response; prove empty, 1,000, 1,001, worst-shaped 1,000-Vote, privacy, failure, and worksheet-invariant behavior in workerd and the complete repository gate.

**Acceptance Criteria:**
- Given an authenticated owner and a Poll with at most 1,000 accepted Votes, when XLSX is activated, then a direct synchronous `200` attachment contains exactly `VOTES`, `TALLY`, and `SUMMARY`, with every canonical row, value, ordering rule, privacy guarantee, and snapshot matching CSV.
- Given an authenticated owner and a Poll with at least 1,001 accepted Votes, when XLSX is activated, then the single bounded D1 statement detects the sentinel and returns HTTP `409` with no attachment, no Vote/selection projection or workbook generation, and exact text `XLSX export supports up to 1,000 accepted votes. Download CSV for larger Polls.` while CSV remains unchanged.
- Given a max-shaped 1,000-Vote Poll using 30 selections and maximum-length exportable text, when the production XLSX path runs in workerd, then it completes inside the supported Worker envelope; 1,001 and any worksheet invariant violation fail closed before bytes begin, without truncation or private leakage.

## Spec Change Log

- 2026-08-05: Human-approved resolution selected bounded synchronous XLSX through 1,000 accepted Votes, a snapshot-safe 1,001st-Vote D1 sentinel, exact HTTP `409` CSV-fallback copy, no continuation worksheets, and unchanged CSV behavior; reconciled the governing PRD, epics, architecture, UX, and Epic 4 context.

## Review Triage Log

## Design Notes

Current repository code materializes D1 facts and the canonical tables before transport. Cloudflare's current Workers guidance retains a 128 MB isolate limit, and the prior measured SheetJS attempt peaked near 385 MB RSS for 50,000 rows and five columns. The approved 1,000-Vote product boundary is deliberately enforced before those arrays exist. Multiple-choice Polls allow at most 30 selections per Vote, Comment bodies are capped at 500 characters, and display names at 80; the implementation must therefore prove the max-shaped 1,000-Vote case rather than extrapolate from average rows.

The cap keeps `VOTES` to at most 1,001 worksheet rows including its header; `TALLY` remains bounded by the Poll Type option contract and `SUMMARY` is fixed. No continuation-sheet policy is needed or permitted. The stable oversize response is a permanent product boundary, not a transient `503`, and CSV is the explicit larger-Poll ownership path.

No acceptance criterion requires a human-only action outside the repository. Selecting and reconciling a delivery model is a product/architecture decision, so `awaiting-operator` and `operator_actions` would misclassify the current state.

## Verification

**Manual checks:**
- Confirmed clean, intent-matching `story/4-4-xlsx-export` before resolution work.
- Confirmed no XLSX dependency, adapter, route, UI control, or tests exist in the live tree.
- Confirmed Story 4.3 still materializes the complete D1 projection and canonical dataset before serialization; its CSV behavior remains outside the XLSX cap.
- Reconciled the approved 1,000-Vote synchronous contract across the PRD, epics, architecture spine, UX experience, Epic 4 context, and this frozen spec on 2026-08-05.

## Auto Run Result

Status: blocked

Resolution approved 2026-08-05: bounded synchronous XLSX through exactly 1,000 accepted Votes, enforced by a 1,001st-Vote sentinel in the single D1 fact-projection snapshot before canonical rows or workbook bytes materialize. Oversize is HTTP `409` with no attachment and exact text `XLSX export supports up to 1,000 accepted votes. Download CSV for larger Polls.`; CSV remains unchanged, worksheet continuation is forbidden, and the orchestrator owns the subsequent status re-arm.
