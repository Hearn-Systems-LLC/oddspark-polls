---
title: 'D1 Moderation Mapper Defense'
type: 'bugfix'
created: '2026-08-06T05:00:00-04:00'
status: 'done'
baseline_revision: '317eecb06569c0a10d2ba949bb34c7482e5a9a27'
final_revision: '3465ce6a51103b8f231e8082723d7a46ea59c4a6'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** The Administrator moderation target mapper accepts corrupt empty Poll questions and canonical references. Separately, an owner-qualified Delisted listing refusal can lose its required explanation and become a missing or generic error page when the creator detail route's later lifecycle read returns no row or throws.

**Approach:** Make the D1 mapper fail closed on empty required strings, and retain a route-local Delisted policy resolution only after the owner-qualified command establishes it. Use that resolution solely as a rendering fallback when the subsequent lifecycle read fails, without weakening the normal ownership/existence checks.

## Boundaries & Constraints

**Always:** Preserve the existing owner-qualified initial detail gate and Discovery command; keep the response private/no-store; render the exact Delisted explanation and inert listing control after an established `poll_delisted` result; reject corrupt mapper projections with the existing stable error; add real-D1 integration coverage.

**Block If:** Correct behavior would require changing authorization, Discovery state semantics, schema, or the exact Delisted product copy.

**Never:** Edit `_bmad-output/implementation-artifacts/deferred-work.md`; treat a failed lifecycle read as proof of Delisted before `poll_delisted` is established; globally swallow owner/lifecycle lookup failures; trim or broaden string validation beyond empty values; add migrations, dependencies, bindings, or public API changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid moderation target | Non-empty question and canonical reference | Return the existing minimal target record | No error expected |
| Empty question | D1 row has `question = ''` | Return no corrupt target | Reject with `Malformed moderation target projection` |
| Empty canonical reference | Canonical D1 row has `reference = ''` | Return no corrupt target | Reject with `Malformed moderation target projection` |
| Delisted second read returns null | Owner POSTs a forged listing update; command resolves `poll_delisted`; final lifecycle read returns null | Keep 422, owned detail, exact Delisted explanation, and inert control | Do not convert to 404 |
| Delisted second read throws | Same established policy result; final lifecycle read rejects | Keep 422 and the same Delisted rendering fallback | Do not expose the cause or replace the page with a generic error |
| Ordinary second read failure | No established `poll_delisted` result | Preserve existing missing/error behavior | Never infer Delisted |

</intent-contract>

## Code Map

- `src/adapters/d1/index.ts` -- `createModerationPersistence().findTargetByReference` maps the minimal Administrator moderation projection and owns malformed-row rejection.
- `src/pages/creator/polls/[pollId].astro` -- owner-qualified detail route, listing command dispatch, final lifecycle refresh, and Delisted read-only rendering.
- `tests/integration/moderation-persistence.integration.test.ts` -- real-D1 moderation mapper contracts, including schema-valid corrupt empty strings.
- `tests/integration/creator-poll-lifecycle-route.integration.test.ts` -- real route coverage for listing refusal, injected lifecycle failures, status, copy, and inert controls.

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/d1/index.ts` and `tests/integration/moderation-persistence.integration.test.ts` -- reject zero-length `question` and `canonical_reference` values in the existing mapper guard and prove both corrupt projections fail closed while valid targets remain unchanged.
- [x] `src/pages/creator/polls/[pollId].astro` -- record Delisted state only from an owner-qualified `poll_delisted` command result; make the final lifecycle read preserve the known owned Poll and force Delisted rendering when that read returns null or throws, while leaving all other failure paths unchanged.
- [x] `tests/integration/creator-poll-lifecycle-route.integration.test.ts` -- inject null and rejected second lifecycle reads after an authoritative Delisted refusal; assert 422, exact copy, no missing-state copy, no mutable listing controls, unchanged D1 state/version, and normal behavior outside the guarded fallback.

**Acceptance Criteria:**
- Given a valid moderation target, when it is resolved by alias, then its existing minimal canonical projection is unchanged.
- Given an empty persisted question or canonical reference, when the moderation target mapper reads it, then it rejects with `Malformed moderation target projection` and returns no partial target.
- Given an owned Delisted Poll and a forged creator listing update, when the command resolves `poll_delisted` and the later lifecycle read returns null or throws, then the response remains private 422 and shows the exact Delisted explanation with an inert listing section.
- Given any route path without an owner-qualified `poll_delisted` result, when its final lifecycle read fails, then the route does not infer Delisted or weaken its existing authorization and missing/error behavior.
- Given the completed change, when repository status and diff are inspected, then the deferred-work ledger is byte-for-byte untouched and no unrelated files are included.

## Spec Change Log

## Review Triage Log

### 2026-08-06T05:14:00-04:00 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 1, medium 1, low 2)
- defer: 0
- reject: 4
- addressed_findings:
  - `[high]` `[patch]` Guarded the immediate owner-detail refresh after an authoritative `poll_delisted` result so its exception cannot replace the required 422 Delisted explanation before the final lifecycle read.
  - `[medium]` `[patch]` Let a successful fresh lifecycle snapshot outrank the Delisted fallback and added an Administrator-clear-wins regression.
  - `[low]` `[patch]` Added explicit coverage proving ordinary thrown lifecycle failures remain outside the Delisted fallback.
  - `[low]` `[patch]` Tightened ledger and changed-path verification to compare against the captured baseline revision.

### 2026-08-06T05:29:45-04:00 — Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 12
- addressed_findings:
  - none

## Design Notes

The fallback flag represents an already-resolved policy outcome, not a substitute for a database read. It may override only the listing presentation state after the command has performed its owner-qualified lookup; it must not authenticate the request, resurrect a Poll on ordinary reads, or suppress unrelated failures.

## Verification

**Commands:**
- `pnpm test:integration -- tests/integration/moderation-persistence.integration.test.ts tests/integration/creator-poll-lifecycle-route.integration.test.ts` -- expected: focused real-D1 mapper and route tests pass.
- `pnpm migrations:guard && pnpm test && pnpm check && pnpm test:e2e && pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` -- expected: exact repository gate passes with no binding drift or diff errors.
- `git diff --exit-code 317eecb06569c0a10d2ba949bb34c7482e5a9a27 -- _bmad-output/implementation-artifacts/deferred-work.md` -- expected: ledger remains untouched since the captured baseline.
- `git diff --name-only 317eecb06569c0a10d2ba949bb34c7482e5a9a27` -- expected: only the scoped implementation, tests, and this run spec changed.

## Auto Run Result

Status: done
Summary: Completed follow-up review for D1 moderation target mapper and creator poll detail route Delisted fallback defense.
Files changed:
- `_bmad-output/implementation-artifacts/spec-d1-moderation-mapper-defense.md`: Appended follow-up review triage log, set followup_review_recommended to false, set status to done.
Review findings breakdown:
- Patches applied: 0
- Items deferred: 0
- Items rejected: 12 (all false positives / noise / spec-mandated behaviors)
Follow-up review recommendation: false
Verification performed:
- `pnpm test:integration -- tests/integration/moderation-persistence.integration.test.ts tests/integration/creator-poll-lifecycle-route.integration.test.ts`: Passed (35 test files, 404 tests passing across full integration suite)
Residual risks: None identified.


