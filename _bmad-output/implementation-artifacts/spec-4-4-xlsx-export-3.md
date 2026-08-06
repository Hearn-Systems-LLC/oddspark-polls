---
title: 'Story 4.4: XLSX Export — Delivery Contract Still Unresolved'
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

**Problem:** Creators still lack the promised XLSX ownership export, but the governing contract requires an unbounded, complete synchronous workbook that cannot be made reliably safe inside Cloudflare Workers' fixed 128 MB isolate limit.

**Approach:** Preserve Story 4.3's owner authorization, privacy allowlist, one-snapshot semantics, and canonical data model, but do not restore XLSX source or dependency work until one Worker-compatible delivery contract is selected and reconciled across the governing artifacts.

## Boundaries & Constraints

**Always:** Keep XLSX transport-only unless a ratified streaming or durable design deliberately replaces the materialized source boundary; authorize ownership before reading private facts; preserve logical parity with CSV; omit internal identifiers and enforcement data; keep voter text and Poll correlation out of telemetry; prove runtime behavior in workerd and the production bundle.

**Block If:** No ratified choice exists between bounded synchronous, genuinely streamed, and durable asynchronous delivery; bounded delivery lacks an exact cap, enforcement point, worksheet-overflow rule, and oversize response; streamed delivery lacks permission to send bytes before completion, partial-failure semantics, and a snapshot-consistent bounded-memory source; or asynchronous delivery lacks lifecycle, authorization, storage, expiry, retry, cleanup, and UX rules.

**Never:** Restore the reverted fully buffered SheetJS implementation; invent a Poll-size limit; truncate rows; weaken authorization, privacy, Tally coherence, or CSV behavior; promise a safe 500 after streamed bytes begin; or add bindings, migrations, storage, queues, jobs, or service topology without a ratified contract.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Ordinary owner export | Owned Poll within the selected model's proven envelope | `.xlsx` contains canonical Votes, Tally, and Summary | Conceal foreign/missing Polls and emit no private partial artifact |
| Large export | Dataset approaches memory, worksheet, or selected product bound | Follow one explicit ratified policy without silent loss | Bounded: stable oversize response; streamed: explicit partial-failure semantics; asynchronous: durable failed state |
| Serialization failure | Failure before or after delivery begins | Outcome follows the selected delivery model | Never claim an application 500 can replace bytes already sent |

</intent-contract>

## Code Map

- `src/lib/export-delivery.ts` -- current owner-authorized export composition root.
- `src/modules/results/export.ts` -- fully materialized `CanonicalExportDataset`; streaming would require an intentional contract redesign.
- `src/adapters/d1/export/multiple-choice.ts` -- one-statement `.all()` projection that materializes Vote, option, and selection collections before transport.
- `src/pages/creator/polls/[pollId]/export.csv.ts` -- current direct-download concealment, headers, HEAD, and safe-failure behavior.
- `_bmad-output/planning-artifacts/{epics.md,prds,architecture,ux-designs}` -- governing product, architecture, and immediate-download UX contracts that require reconciliation.

## Tasks & Acceptance

**Execution:**
- [ ] `_bmad-output/planning-artifacts/epics.md`, PRD, architecture spine, UX experience, and `epic-4-context.md` -- select and reconcile exactly one delivery model before implementation resumes.
- [ ] `src/modules/results/export.ts`, `src/adapters/d1/export/multiple-choice.ts` -- for streaming or asynchronous delivery, define a snapshot-consistent bounded-memory source rather than wrapping the existing arrays.
- [ ] XLSX adapter, route, UI, telemetry, dependency attribution, tests, and public docs -- derive implementation from the ratified contract and prove the chosen boundary under measured workerd load.

**Acceptance Criteria:**
- Given one ratified delivery model, when Story 4.4 is replanned, then its size, memory, snapshot, failure, authorization, privacy, worksheet-overflow, and UX semantics are complete and mutually coherent.
- Given the implementation under measured workerd load, when an owner exports ordinary and boundary-sized Polls, then every promised canonical row is delivered according to the ratified model without silent truncation or private leakage.

## Spec Change Log

## Review Triage Log

## Design Notes

Current repository code materializes D1 facts and the canonical tables before transport. Cloudflare's current Workers guidance retains a 128 MB isolate limit and recommends streaming large bodies or offloading large datasets. The prior measured SheetJS attempt peaked near 385 MB RSS for only 50,000 rows and five columns. A reduced worksheet-limit test can prove continuation naming and ordering, but cannot prove the actual Excel boundary or arbitrary Poll-size safety.

No acceptance criterion requires a human-only action outside the repository. Selecting and reconciling a delivery model is a product/architecture decision, so `awaiting-operator` and `operator_actions` would misclassify the current state.

## Verification

**Manual checks:**
- Confirmed clean, intent-matching `story/4-4-xlsx-export` at `3f4d856` before this decision record.
- Confirmed no XLSX dependency, adapter, route, UI control, or tests exist in the live tree.
- Confirmed no governing artifact selects a bound, streamed failure model, or asynchronous lifecycle after the prior block.
- Confirmed Story 4.3 still materializes the complete D1 projection and canonical dataset before serialization.

## Auto Run Result

Status: blocked

Blocking condition: intent gaps.

Unanswered decisions:

1. Select bounded synchronous, genuinely streamed, or durable asynchronous XLSX delivery.
2. For bounded delivery, define the exact cap, snapshot-safe enforcement point, worksheet-overflow policy, and stable user-visible oversize response.
3. For streamed delivery, permit bytes before completion, define partial-download failure semantics, and authorize a snapshot-consistent bounded-memory source redesign.
4. For asynchronous delivery, define initiation, status, authenticated download, storage, expiry, retry, cleanup, failure UX, and queue/R2/service-binding topology.
5. Reconcile the choice across the PRD, epics, architecture, UX experience, Epic 4 context, and Story 4.4 before source work.

Evidence: three synchronous read-only audits independently found no ratified delivery model; the current code fully materializes export facts; Cloudflare still documents a 128 MB isolate limit; and the earlier representative SheetJS measurement exceeded that ceiling by roughly three times. No outside-repository human-only action is owed.
