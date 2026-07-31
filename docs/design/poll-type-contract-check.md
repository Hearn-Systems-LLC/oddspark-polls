# Poll Type Strategy Contract — Design Check (de-risk rule #1)

Story 1.3 freezes the AD-3 Poll Type contribution contract
(`src/shared/application/index.ts`, `POLL_TYPE_CONTRACT_VERSION = 1`). Epic 1's
first de-risk rule requires a written check that the contract fits **all four
known Poll Types before it freezes** — this document is that check.

## The contract under check

```ts
interface PollTypeStrategy<TCreateInput, TCreationFacts, TSubmission,
                           TValidatedSubmission, TPersistedFacts,
                           TResultProjection> {
  type: PollType;                       // multiple_choice | ranked_choice | image | meeting
  contractVersion: 1;
  create(input, { nowMs }): Result<TCreationFacts>;
  validateSubmission?(submission, facts): Result<TValidatedSubmission>;   // Story 1.5
  persistFacts?(validated): TPersistedFacts;                              // Story 1.5
  projectResults?(facts: TPersistedFacts): TResultProjection;             // Story 1.8
}
```

Load-bearing properties:

1. **`create` returns normalized relational facts, not SQL and not JSON blobs.**
   The Polls application command owns the one D1 batch (AD-3): it converts the
   strategy's facts plus the shared fields (question, visibility, deadline,
   reference) into batch statements. Strategies never touch delivery or D1.
2. **Generics per type.** Each type declares its own fact shapes; the shared
   kernel constrains only the port signatures, so a new type never reshapes the
   command or another type's facts.
3. **Ports arrive with their consuming stories.** `validateSubmission` /
   `persistFacts` join the AD-7 vote transaction in Story 1.5;
   `projectResults` joins the AR-17 result surfaces in Story 1.8. They are
   declared now so their position in the contract is frozen; a contract change
   after freeze requires a version bump plus moving the compile-time consumer
   test (`tests/unit/shared-kernel.test.ts`). All three are optional members
   on purpose — a minimal strategy exposing only `create` must satisfy the
   interface until those stories land. The freeze covers the port shapes and
   `create`; the consumer test pins both the minimal and the
   fully-implemented shapes.

## Check against the four known types

### 1. Multiple-Choice (Epic 1, this story; multi-select Story 1.7)

- `create`: labels → ordered `{ label, position }` option facts. Fits — the
  reference implementation (`src/modules/polls/types/multiple-choice.ts`).
- Multi-select (1.7) adds min/max bounds to `TCreateInput`/`TCreationFacts`
  — a widening of that type's own generics, no contract change.
- `validateSubmission`: selected option IDs vs persisted options + single/multi
  mode. `persistFacts`: vote-selection rows. `projectResults`: per-option
  counts + voter count. All fit the signatures.

### 2. Ranked-Choice ballots (Epic 5)

- `create`: same option facts as multiple-choice (candidates are labels with
  positions). Fits.
- `validateSubmission`: an *ordered* ranking with automatic compaction —
  `TSubmission` is an ordered list, `TValidatedSubmission` a compacted ballot.
  Fits because submission shapes are per-type generics.
- `persistFacts`: ballot + ranked-selection rows (relational, AR-friendly for
  the Ballot Manifest). `projectResults`: IRV rounds from the one pure
  tabulator (AD-9) — the strategy delegates to it. Fits.

### 3. Image polls with media adoption (Epic 6)

- The stress case for `create`: image options reference **R2 temporary keys
  that must be adopted inside the same creation batch** (AD-3 names "adopted
  media records" in the batch). The contract holds because `create` returns
  *facts* — `{ label, position, mediaKey, altText }` — and the Polls command
  maps media facts to `media_object` adoption rows in the one batch. The
  strategy itself still never touches R2; the R2 adapter pre-stages temp keys
  before `CreatePoll` runs, and the cleanup outbox (AR-10) reaps unadopted
  keys. Required alt text is a `create`-level validation. Fits without a
  contract change.

### 4. Meeting polls — slots, availability, revision (Epic 7)

- `create`: slot facts (`{ startsAtMs, endsAtMs, timeZone }` rows) instead of
  option labels — per-type generics absorb this. The `PollTypeCreateContext`
  carries `nowMs`; civil-time meaning travels *inside* the type's own input
  (IANA zone per AR/Consistency time rules). Fits.
- `validateSubmission`: a three-state availability grid per slot. Fits.
- **Revision (AR-16)** is the stress case: `ReviseMeetingResponse` replaces an
  earlier submission. Revision is a *command* concern (a second application
  command holding the revision capability token) — it reuses the same
  `validateSubmission` + `persistFacts` ports on the strategy; the contract
  does not need a revision port. Fits.

## Sanctioned refinements (no contract bump)

Recorded 2026-07-31 (Story 1.5 review): **per-type validation-facts narrowing
is a sanctioned refinement of the frozen contract.** The shared interface
types `validateSubmission(submission, facts)` against the creation-facts
generic, but validation actually runs against the Poll's *persisted* shape —
option ids exist only after the creation batch assigns them. A poll-type
module may therefore narrow the port for its own implementation (e.g.
`MultipleChoiceValidationFacts` requiring option ids while
`MultipleChoiceCreationFacts` stays id-less, via `Omit` + redeclaration in
`src/modules/polls/types/multiple-choice.ts`) **without bumping
`POLL_TYPE_CONTRACT_VERSION`**, as long as:

1. the shared `PollTypeStrategy` interface itself is unchanged, and
2. the narrowing lives in the poll-type module, never in the shared kernel.

A change that alters the shared interface's port shapes remains a version
bump plus moving the compile-time consumers together, per the verdict below.

## Verdict

Contract version 1 **freezes**. All four types fit through per-type generics;
the two stress cases (media adoption in the create batch, meeting revision)
resolve in the command layer without reshaping the ports. Future widening that
would break a signature requires bumping `POLL_TYPE_CONTRACT_VERSION` and
updating the compile-time consumers together (AD-23).
