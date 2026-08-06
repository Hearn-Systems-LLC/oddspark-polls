---
title: 'Story 4.4: XLSX Export — Contract Resolution Required'
type: 'feature'
created: '2026-08-05T22:53:50-04:00'
status: 'blocked'
baseline_revision: '7d05cd8'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
warnings:
  - oversized
---

<intent-contract>

## Intent

**Problem:** Creators still lack the promised XLSX ownership export, but the current direct-download contract requires an unbounded, complete workbook that cannot be generated safely inside Cloudflare Workers' fixed memory limit.

**Approach:** Preserve Story 4.3's owner authorization, privacy allowlist, and canonical data semantics, but do not reimplement XLSX until one Worker-compatible delivery contract is selected and reconciled across the governing artifacts.

## Boundaries & Constraints

**Always:** Keep XLSX transport-only; authorize before projecting private facts; preserve the same logical Vote, Tally, and Summary data as CSV; keep internal identifiers, enforcement facts, credentials, and voter text out of telemetry; execute the selected design inside the supported deployment topology with measured workerd evidence.

**Block If:** No ratified choice exists between a bounded synchronous direct download, a genuinely streamed direct download, and durable asynchronous generation; a bounded design lacks an exact cap and oversize response; a streamed design still promises complete pre-generation or a guaranteed safe 500 after response bytes begin; an asynchronous design lacks storage, expiry, authorization, retry, and UX rules; or end-to-end memory safety requires silently changing Story 4.3's fully materialized canonical dataset.

**Never:** Restore the reverted fully buffered SheetJS implementation; invent a Poll/export cap; truncate rows; weaken owner authorization, snapshot semantics, privacy, or CSV behavior; claim a streamed partial ZIP can be replaced with a 500 after headers or bytes are sent; add bindings, migrations, storage, background jobs, or provider topology without a ratified contract.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Ordinary owner export | Owned Poll within the selected design's proven operating envelope | Direct or prepared `.xlsx` contains the canonical Vote, Tally, and Summary data | Conceal foreign/missing Polls and emit no private partial artifact |
| Large export | Dataset approaches Worker memory, XLSX worksheet, or selected product bound | Behavior follows one explicit ratified policy without silent loss | Bounded: stable oversize response; streamed: documented partial-failure semantics; asynchronous: durable failed state |
| Serialization failure | Writer or resource failure occurs before or after delivery begins | Outcome matches the selected delivery model | Never promise a safe 500 after a streamed response has begun |

</intent-contract>

## Code Map

- `src/lib/export-delivery.ts` -- current composition root for owner-authorized canonical export.
- `src/modules/results/export.ts` -- fully materialized `CanonicalExportDataset`; any streaming redesign must deliberately replace this array boundary.
- `src/adapters/d1/export/multiple-choice.ts` -- current one-statement `.all()` projection and in-memory Vote/selection collections.
- `src/pages/creator/polls/[pollId]/export.csv.ts` -- existing concealment, attachment, HEAD, cache, and failure semantics to preserve where compatible.
- `_bmad-output/planning-artifacts/epics.md`, `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md` -- unresolved one-row-per-Vote XLSX promise.
- `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` -- writer selection and measured platform-limit revisit boundary.
- `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md`, `_bmad-output/implementation-artifacts/epic-4-context.md` -- planned direct sibling control and current UX contract.

## Tasks & Acceptance

**Execution:**
- [ ] Governing planning artifacts above -- select and reconcile exactly one delivery contract before source or dependency work resumes.
- [ ] `src/modules/results/export.ts`, `src/adapters/d1/export/multiple-choice.ts` -- if streaming or asynchronous delivery is selected, define a snapshot-consistent bounded-memory source contract instead of silently wrapping the existing materialized arrays.
- [ ] XLSX adapter, route, UI, telemetry, tests, attribution, and public documentation -- derive the implementation only after the contract decision, with focused memory/partial-failure tests and the complete repository gate.

**Acceptance Criteria:**
- Given a ratified delivery model, when Story 4.4 is re-planned, then its size, memory, snapshot, failure, authorization, privacy, UX, and worksheet-overflow semantics are complete and mutually coherent.
- Given the final implementation under measured workerd load, when an owner exports ordinary and boundary-sized Polls, then every promised canonical row is delivered according to the ratified model without silent truncation, private leakage, or an impossible error guarantee.

## Spec Change Log

## Review Triage Log

## Design Notes

Cloudflare Workers currently allow 128 MB per isolate and recommend streaming rather than buffering large bodies. SheetJS CE's XLSX writer packages the workbook in memory. A direct streamed XLSX is mechanically possible with a streaming ZIP/OOXML design, but the current source already materializes all export facts, and once streamed response bytes begin a later failure cannot become a safe 500. The strongest large-export model is therefore either an explicitly bounded synchronous download or durable generation before an authenticated download; choosing between them changes product behavior and cannot be inferred from the current artifacts.

## Verification

**Manual checks:**
- Confirmed clean, intent-matching `story/4-4-xlsx-export` at `7d05cd8`; no XLSX dependency, adapter, route, or tests exist.
- Confirmed the PRD, epic, architecture, UX, epic context, and prior blocked spec contain no later decision selecting a cap, streamed-failure semantics, or asynchronous lifecycle.
- Confirmed Story 4.3 materializes the complete D1 projection and canonical dataset before transport serialization.

## Auto Run Result

Status: blocked

Blocking condition: intent gaps.

Unanswered decisions:

1. Select bounded synchronous, genuinely streamed, or durable asynchronous XLSX delivery.
2. For bounded delivery, define the exact cap, enforcement point, worksheet-overflow policy, and user-visible oversize response.
3. For streamed delivery, permit bytes before completion, define partial-download failure semantics, and authorize a snapshot-consistent iterable source redesign.
4. For asynchronous delivery, define initiation/status/download UX, storage and expiry, owner authorization, retry/failure behavior, and queue/R2/service-binding topology.
5. Reconcile the selected contract across PRD, epics, architecture, UX, epic context, and this story before implementation.

No `operator_actions` key is present because no outside-repository human-only action is owed. `awaiting-operator` would misclassify a product/architecture decision as operational execution.
