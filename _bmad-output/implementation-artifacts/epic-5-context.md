# Epic 5 Context: Ranked-Choice Polls

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Communities can run trustworthy ranked-choice polls whose ballots are quick and accessible to cast, whose instant-runoff outcome is deterministic, and whose completed count is independently verifiable. The epic preserves the product's casual poll-card feel while exposing enough round and ballot evidence for a skeptical reader to reproduce the result rather than merely trust an asserted winner.

## Stories

- Story 5.1: Cast a Ranked Ballot
- Story 5.2: Deterministic IRV Tabulation
- Story 5.3: Per-Round Display & Ballot Manifest

## Requirements & Constraints

- Ranked-Choice is a first-class Poll Type using the shared creation, lifecycle, ownership, security, visibility, comments, results, and export behavior.
- A Ballot is a strict ordered preference over any non-empty subset of options. Duplicate options and skipped rank positions are invalid, and both delivery and domain boundaries must reject malformed submissions.
- Each count round assigns every active Ballot to its highest-ranked remaining option. A strict majority of active Ballots wins; otherwise the fewest-supported option is eliminated.
- Tied-last options may be batch-eliminated only when their combined count is below the next-lowest remaining count. Unsafe ties look backward to the most recent earlier round in which the tied options differed. If no earlier round distinguishes them, counting ends in an honest unresolved result with standing counts and tied options named. Random elimination is prohibited.
- A Ballot becomes exhausted after all of its ranked options have been eliminated and leaves the active count in later rounds. Identical accepted Ballots must always produce identical rounds and outcomes.
- Results expose every completed round, including per-option counts, eliminations, exhaustion, and a plain-language explanation for each elimination. Rounds do not collapse or paginate.
- At close, the Ballot Manifest publishes canonically ordered rankings sufficient to reproduce the count. It contains no voter data, timestamps, internal identifiers, or ordering that could correlate Ballots with voters. Before close, the manifest route exists but exposes no Ballot facts.
- All tally computation is server-side. Voting remains lightweight, globally fast, keyboard-operable, and usable without a heavy client framework. Voter- or ballot-sensitive data must not enter telemetry or public caches.

## Technical Decisions

- Implement Ranked-Choice behind the shared Poll Type strategy ports for creation, submission validation, fact persistence, result projection, and export projection. Keep business rules in provider-free domain/application code; routes and browser scripts are delivery adapters only.
- Persist accepted Ballots as normalized relational facts in D1, never opaque JSON or stored aggregate rounds. D1 is the sole transactional source of truth; Tallies, manifests, exports, and live updates are projections.
- Accept the Vote, ranked facts, optional Comment, duplicate claims, idempotency record, and representation-version increment in one constrained D1 batch. A partial or malformed Ballot must never persist.
- Use one pure deterministic IRV tabulator for live results, closed results, exports, and tests. Property tests must cover determinism, strict-majority termination, safe batch elimination, backward tie-breaking, unresolved ties, and exhaustion.
- Authorize result and manifest visibility from a provider-free viewer context before reading private facts or building projections. Result and manifest responses are never shared-cacheable; not-yet-visible responses are private and non-cacheable.
- Render functional server HTML first and add isolated vanilla TypeScript only for rank interaction and announcements. Preserve the normal server submission path and independently enforce every Ballot invariant on the server.

## UX & Interaction Patterns

- Ranking is tap-to-assign with no drag gesture. Activating an unranked row assigns the next rank; activating a ranked row removes it and compacts all later ranks. Keyboard users perform the same action with `Space`, and every voting control remains at least 48px high with visible focus.
- Rank numbers appear in the option marker gutter using the data treatment; unranked rows show a faint dash. The summary reads `RANKED {n} OF {total} · UNRANKED OPTIONS COUNT AS NO PREFERENCE`, updates after every change, and emits exactly one polite announcement. Each option's accessible name states its current rank and available action.
- The vote action is disabled only when no option is ranked. The interface communicates that partial rankings are valid and does not imply that unranked options are tied last.
- The round table retains eliminated options with a strikethrough from elimination onward, separates exhausted counts, and highlights only a declared winner's final cell. An unresolved final round uses text and a non-gold marker for tied options; state is never conveyed by color alone.
- The Manifest link appears directly beneath the rounds when publication is authorized. The not-yet route shows the Poll question, local close time, and a link back to the Poll without leaking rankings or counts.

## Cross-Story Dependencies

- Ranked Ballot creation and persistence establish the normalized facts consumed by tabulation, result projection, manifest publication, and export.
- Deterministic tabulation establishes the canonical round model and outcome states rendered by the per-round display and checked against the Manifest.
- Manifest publication depends on Poll close state and the existing result-visibility authorization contract. Owner export depends on the Ranked-Choice export projector but remains governed by the existing creator-only export boundary.
- The epic relies on the already-established shared Poll lifecycle, transactional Vote acceptance, security toggles, idempotency, comments, live result representation versions, and visibility rules; Ranked-Choice must extend those contracts rather than fork them.
