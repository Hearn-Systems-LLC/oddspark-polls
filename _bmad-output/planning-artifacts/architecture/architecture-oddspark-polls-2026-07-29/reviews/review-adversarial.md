# Adversarial Architecture Review

## Final Verification Pass — 2026-07-29

### Final Verdict

**PASS.** All six high-severity seams from the prior verification are resolved;
no critical or high findings remain within this adversarial lens.

| Prior high finding | Final result | Binding amendment |
| --- | --- | --- |
| Meeting revisions race with close/delete | **Resolved** | AD-20 now places effective-open triggers and deletion-protecting foreign keys inside the revision transaction. |
| Result validators miss non-Vote changes | **Resolved** | AD-24 defines one monotonic `representation_version`, enumerates visible mutations, and combines it with effective state at Deadline. |
| Shared IDs, enums, and serialized contracts are ownerless | **Resolved** | AD-23 assigns canonical types and versioned cross-capability contracts to the Shared Kernel and requires contract tests. |
| Poll Type creation lacks a common atomic contract | **Resolved** | AD-3 makes `CreatePoll` the common orchestrator and atomically commits shared, type, slug, and media facts before reachability. |
| Creator ownership permits provider-scoped keys | **Resolved** | AD-4 requires one internal provider-independent creator user ID and forbids OAuth account IDs as ownership keys. |
| Replacing adopted media can orphan the old R2 object | **Resolved** | AD-12 makes adopted keys immutable and singly owned and atomically enqueues the superseded key on replacement. |

This verdict supersedes the earlier verification and initial gate verdicts
retained below as review history.

## Verification Pass — 2026-07-29

### Current Verdict

**FAIL — no critical findings remain, but six high-severity seams are still
open.** The amendment resolves initial Vote acceptance versus close/delete,
result authorization/cache separation, fact ownership, ordinary idempotent
replay, Meeting response identity/code reuse, and deletion/temporary-object
cleanup. It does not yet make every independently built epic compatible.

### Verification of the Prior Top Five

| Prior finding | Result | Evidence in amended spine |
| --- | --- | --- |
| Vote acceptance can race with Poll close/delete | **Resolved for initial Vote creation; Meeting revisions still need the same guard** | AD-7 now uses a D1 insertion trigger plus foreign keys. AD-20 requires an open Poll for revisions but does not make that check atomic with the availability replacement. |
| Restricted results can leak through shared projection/cache identity | **Resolved** | AD-21 centralizes `ViewerContext` authorization, forbids shared result/Manifest caches, and separates discovery cache identity. |
| Fact ownership and legal write paths are undefined | **Resolved** | AD-19 plus the Fact Set table assigns one owner and legal mutation path to every fact family. |
| Meeting updates conflict with duplicate checks and redeemed Voter Codes | **Resolved, except for close-race linearization** | AD-20 separates create from revise, establishes a revision capability, and forbids claim/code recreation. |
| R2 deletion/temp cleanup can strand objects | **Partially resolved** | AD-12 makes the outbox independent, names a retry owner, and sweeps abandoned temporary keys. Replacement of an already adopted image still has no cleanup invariant. |

### Remaining High Findings

#### VH-1 — Meeting revisions still race with close/delete

- **Incompatible pair:** `ReviseMeetingResponse` validates that the Poll is open
  and then replaces availability rows. A concurrent lifecycle command closes or
  deletes the Poll after that validation. AD-20 requires the Poll to “remain
  open,” but only AD-7's Vote-insertion trigger supplies an atomic D1 guard, and
  a revision inserts no Vote.
- **Required spine change:** Require the availability replacement and
  `results_version` increment to be guarded in the same D1 transaction by Poll
  existence and effective-open state, with a concurrent close/delete aborting
  the revision.

#### VH-2 — Result validators still miss non-Vote representation changes

- **Incompatible pair:** Results uses `results_version` as AD-10's ETag. Polls
  changes visibility or closes; a Deadline becomes effective without a write;
  Voting deletes a Comment; or a future Demo reset changes facts. None must
  increment the version, so a compliant conditional endpoint can return `304`
  for a representation that has changed.
- **Required spine change:** Define one representation-revision contract for
  every visible mutation and specify how the validator changes at a Deadline
  without scheduler correctness. AD-21 prevents leakage but does not prevent
  stale authorized views.

#### VH-3 — Shared IDs, enums, and serialized contracts remain ownerless

- **Incompatible pair:** Fact ownership is now clear, but a fact owner can
  publish `after_close` while a consuming epic implements `AFTER_CLOSE`, or
  Results can emit a projection envelope different from the live client. Both
  obey AD-19 because only the owner writes; no AD requires consumers to import
  the owner's canonical contract.
- **Required spine change:** Require each fact owner to publish canonical domain
  value types and application contracts. Adapters map at boundaries;
  capabilities cannot redefine shared IDs, discriminants, port payloads, or
  projection envelopes; breaking changes are versioned.

#### VH-4 — Poll Type creation still lacks a common atomic contract

- **Incompatible pair:** Polls inserts and exposes the common Poll before
  calling `persistFacts`; a Ranked Choice or Image strategy assumes its options
  and type facts become visible atomically with the Poll. AD-19 coordinates
  `CastVote`, not Poll creation, and AD-3 still names ports without defining
  their transaction semantics.
- **Required spine change:** Make one Poll-creation application command own the
  common transaction. Common Poll facts and required strategy facts become
  visible atomically, using one canonical Poll Type discriminant and option/slot
  identity through Vote, Tally, Manifest, and export.

#### VH-5 — Resource ownership still accepts provider identities as creator keys

- **Incompatible pair:** Identity maps a session to Better Auth's local user ID
  while Polls stores an OAuth provider subject as its “authenticated creator
  ID.” Both satisfy AD-4 and AD-19, but provider linking or switching changes the
  apparent Poll owner.
- **Required spine change:** Bind ownership to one opaque,
  application-scoped `CreatorId`; only Identity may map sessions/provider
  accounts to it. Domain and application commands must never use provider
  subjects as owner keys, and admin grants need the same principal authority.

#### VH-6 — Replacing adopted media can orphan the prior R2 object

- **Incompatible pair:** Media adopts a new temporary key for an option before
  its first Vote. Polls changes the option's media reference, which AD-17 permits
  before the first Vote. The old object is neither an abandoned temporary key
  nor part of Poll deletion, so AD-12's two cleanup paths never select it.
- **Required spine change:** Make adopted keys immutable and singly owned.
  Replacing media must atomically adopt the new D1 ownership record and enqueue
  the superseded key in the independent cleanup outbox.

### Verification Recommendation

Apply VH-1 through VH-6, then re-run this reviewer. The previous Critical
findings C-1 and C-2 may be treated as closed once VH-1 is added as the remaining
non-insert variant of C-1.

## Initial Gate Verdict

**FAIL.** The topology is coherent, but the spine does not yet bind the
cross-capability ownership, authorization, and mutation-linearization contracts
needed for independently built epics to compose safely. Literal compliance can
still produce accepted Votes after closure, leak restricted results through
projections, strand R2 objects, or make later Poll Types incompatible with the
first one.

## Critical

### C-1 — Poll closure/deletion and Vote acceptance have no shared linearization point

- **Incompatible pair:** The lifecycle epic checks ownership and commits
  `closed_at` (or hard-deletes the Poll) in its command. The voting epic reads an
  effectively open Poll, performs Turnstile and other external checks, then
  executes AD-7's constrained `batch()`. Each epic enforces AD-11 when its
  command begins and each mutation enters one application command, but a close
  or delete during the external-check gap can still be followed by an accepted
  Vote.
- **Why literal compliance is insufficient:** AD-7 requires conditional
  constraints but does not explicitly make Poll existence and effective-open
  state part of the D1 acceptance guard. AD-11 requires every command to enforce
  effective state but does not say that enforcement must occur at the
  acceptance linearization point.
- **Required spine change:** Tighten AD-7/AD-11 so close, delete, Meeting update,
  and Vote acceptance are mutually ordered by a D1 guard in the same atomic
  mutation. A Vote is accepted only if its final guarded mutation observes the
  Poll present and effectively open; no prior route/application read can satisfy
  that invariant.
- **Disposition:** **Autofix.** This is a correctness invariant, not an
  implementation choice.

### C-2 — Result authorization and cache identity can diverge and disclose restricted results

- **Incompatible pair:** The results epic correctly checks
  `result_visibility` before producing a Tally. The projection/cache epic keys
  its versioned representation only by Poll ID plus `results_version`, as AD-10
  suggests, and reuses it for public, voter, and creator requests. Both obey the
  current ADs, yet a representation computed for the owner can be served or
  revalidated on an anonymous request for a Creator-Only or not-yet-closed
  Poll.
- **Why literal compliance is insufficient:** AD-5 separates visibility from
  discovery, but no AD designates one authorization policy as the mandatory
  gate before every Tally, Comment, Manifest, export, discovery-card field, and
  conditional response. The HTTP convention only makes Unlisted responses
  non-cacheable; Listed does not mean its results are public.
- **Required spine change:** Establish one owner for a `CanViewResults` policy
  using principal, effective Poll state, and `result_visibility`. Require every
  result-derived projection and validator to pass through it. Public and
  principal-scoped representations must have disjoint cache identities, and
  restricted results must never enter a shared cache or a discovery projection.
- **Disposition:** **Autofix.** This closes an authorization boundary.

## High

### H-1 — Fact ownership is not assigned, so several capabilities may write the same rows

- **Incompatible pair:** The Poll lifecycle epic owns the Poll row and its
  lifecycle fields. The voting epic directly increments `results_version`; the
  discovery epic directly changes `discovery_state`; the moderation epic also
  delists; and deletion removes their records. Every mutation is an application
  command using D1, so all comply with AD-1, AD-5, AD-6, and the Mutation
  convention, while independently chosen SQL and invariants collide.
- **Why literal compliance is insufficient:** “D1 owns facts” chooses the
  system of record, not the capability that owns each fact family or the only
  legal write path.
- **Required spine change:** Assign exactly one owning capability to Poll
  lifecycle/configuration, type facts, Vote facts, Comments, listing intent,
  moderation state, identity, media ownership, and cleanup work. Non-owners
  mutate through owner commands/ports; cross-owner atomic use cases have one
  named transaction coordinator rather than shared-table writes.
- **Disposition:** **Autofix.**

### H-2 — Cross-capability IDs, enums, and projection envelopes have no canonical owner

- **Incompatible pair:** A creator epic publishes a Poll with string literals
  such as `after_close` and a naked UUID. A results epic models the same state as
  `AFTER_CLOSE`, wraps the ID in its own branded type, and emits a different
  `results_version` shape than the live client expects. Each follows the naming,
  identifier, and validation conventions, but their contracts do not compose.
- **Why literal compliance is insufficient:** AD-3 names four ports without
  binding their signatures or semantic owners. The conventions constrain
  spelling styles, not the canonical discriminants, value types, serialized
  shapes, or compatibility rules shared across capabilities.
- **Required spine change:** Require each fact owner to publish the canonical
  domain value types and application port contracts used by all consumers.
  Provider/HTTP adapters map at the edge; capabilities may not redefine shared
  IDs, lifecycle/visibility/type enums, or projection envelopes. Contract
  changes must be additive or versioned.
- **Disposition:** **Autofix.**

### H-3 — Poll Type strategy names do not define creation or persistence atomicity

- **Incompatible pair:** The Poll lifecycle epic inserts the common Poll and
  immediately exposes its root URL, then calls a strategy's `persistFacts`.
  The Image or Ranked Choice epic assumes common and type-specific facts arrive
  atomically and that all option IDs already exist when its strategy runs. Both
  implement AD-3's named ports, but one can expose an open Poll with no usable
  options or a partially stored Ballot schema.
- **Why literal compliance is insufficient:** The four port names do not say
  who owns the stable Poll Type discriminant, canonical option/slot identity,
  transaction boundaries, or the ordering between common and type-specific
  facts.
- **Required spine change:** Tighten AD-3 so the application orchestrator owns
  shared lifecycle/security and the transaction boundary, while the selected
  strategy owns only its type-specific validation, facts, and deterministic
  projection. Common Poll facts and required type facts become visible
  atomically. The same canonical option/slot IDs must flow through Vote,
  Tally, Manifest, and export contracts.
- **Disposition:** **Autofix.**

### H-4 — Creator ownership can be keyed to mutually incompatible identities

- **Incompatible pair:** The auth adapter maps a session to Better Auth's local
  user ID. A creator-management epic stores the OAuth provider subject as
  `creator_id`; a second provider or account-linking flow then produces a
  different owner key. Both address commands by an “authenticated creator ID”
  as AD-4 requires, yet the same person can lose access to their Polls or one
  provider subject can be interpreted in another provider's namespace.
- **Why literal compliance is insufficient:** AD-4 separates identity from
  authorization but never defines the stable application principal or forbids
  provider claims from becoming resource ownership keys.
- **Required spine change:** Tighten AD-4 to make one opaque, application-scoped
  `CreatorId` the sole Poll owner key. Only the auth adapter maps sessions and
  provider accounts to it; domain/application code never receives provider
  subjects. Bind admin capability grants to the same principal model and name
  the grant authority.
- **Disposition:** **Autofix.**

### H-5 — Creator listing intent and administrative moderation can overwrite each other

- **Incompatible pair:** The creator epic writes `discovery_state=listed` when
  an owner opts in. The moderation epic writes
  `discovery_state=unlisted` when an administrator delists. Both are expressly
  allowed by AD-5, but the owner's next edit can silently relist a moderated
  Poll, or moderation can erase the owner's intent so it does not return after
  a hold is lifted.
- **Why literal compliance is insufficient:** One `discovery_state` is asked to
  represent two owners and two independent policies.
- **Required spine change:** Split owner listing intent from administrative
  moderation eligibility. Effective discovery is their conjunction plus
  lifecycle/policy eligibility, computed by one discovery policy. Neither owner
  may mutate the other's fact.
- **Disposition:** **Autofix.**

### H-6 — `submission_id` uniqueness does not define idempotent retry semantics

- **Incompatible pair:** A vote endpoint treats a duplicate `submission_id` as
  an “already voted” error. Another returns the originally accepted outcome so
  a browser retry after a lost response succeeds idempotently. A third accepts
  the same ID with a changed Ballot until a duplicate constraint fires. All use
  a unique ID per Poll as AD-7 requires, but their user-visible and integrity
  behavior differs.
- **Why literal compliance is insufficient:** Uniqueness prevents a second row;
  it does not bind the ID to an immutable command, define conflict behavior, or
  say how an accepted response is recovered.
- **Required spine change:** Define `submission_id` as an idempotency key for one
  immutable normalized vote command. A retry with the same key and same command
  returns the original accepted result without re-consuming claims or a Voter
  Code; the same key with different normalized content is a stable conflict.
- **Disposition:** **Autofix.**

### H-7 — Meeting availability updates are incompatible with the common Vote-security contract

- **Incompatible pair:** The Meeting epic models an update as another CastVote
  using the same session. The security epic sees the existing Session claim or
  already-redeemed Voter Code and rejects it as a duplicate, exactly as AD-7,
  AD-8, AD-16, and AD-17 direct. Alternatively, the Meeting epic bypasses those
  checks and silently creates a second authority path to Vote facts.
- **Why literal compliance is insufficient:** AD-6 permits a session-scoped row
  update but does not define how that identity is established, how an update is
  authorized, which admission checks repeat, whether a code is re-consumed, or
  whether the update increments the live representation revision.
- **Required spine change:** Add a distinct Meeting-update command contract.
  The original accepted Vote establishes the update authority; subsequent
  updates target exactly that Vote, never create another duplicate claim or
  redeem another code, still require an effectively open Poll, and atomically
  revise availability plus the result representation version.
- **Disposition:** **Autofix.**

### H-8 — `results_version` does not cover all observable result changes

- **Incompatible pair:** The voting epic increments `results_version` only for
  accepted Votes, exactly as AD-7/AD-10 state. The lifecycle and comments epics
  close a Poll, let a Deadline become effective, delete a visible Comment,
  change visibility, or update Meeting availability without touching it. The
  live results endpoint legitimately returns `304` for the old validator, so a
  viewer misses closure, an After-Close Tally, a Ballot Manifest, Comment
  removal, or changed availability.
- **Why literal compliance is insufficient:** The spine equates Vote count
  changes with representation changes. Deadline closure is deliberately not
  required to materialize, so a D1-only integer cannot by itself validate the
  representation.
- **Required spine change:** Replace the Vote-only rule with a monotonic result
  representation revision advanced by every persisted result-visible mutation.
  Define how the conditional validator changes at an effective Deadline even
  without a scheduled write, and require close/visibility/Comment/Meeting/reset
  operations to invalidate the appropriate representation.
- **Disposition:** **Autofix.**

### H-9 — The cleanup outbox can be deleted by the cascade it is meant to survive

- **Incompatible pair:** The schema epic follows the ER seed and makes
  `CLEANUP_OUTBOX` a Poll child with `ON DELETE CASCADE`. The deletion epic
  follows AD-12 and hard-deletes the Poll plus all D1-owned children in the same
  batch after inserting the outbox row. Both are literal readings of the spine,
  but the committed cleanup work disappears with the Poll and R2 bytes remain
  forever.
- **Why literal compliance is insufficient:** “Self-contained keys” does not
  say that the outbox has an independent lifetime, and the ER diagram visually
  encourages the destructive foreign-key relationship.
- **Required spine change:** State that cleanup work is independently owned,
  contains immutable object keys, survives Poll deletion, and cannot cascade
  from Poll. The deletion transaction must commit durable cleanup work before
  making the Poll unreachable; workers delete only the listed Poll-owned keys
  idempotently.
- **Disposition:** **Autofix.**

### H-10 — Temporary and replaced R2 objects have no terminal cleanup path

- **Incompatible pair:** The media epic uploads to Poll-scoped temporary keys
  and waits for creation/adoption. The Poll editor replaces an image before the
  first Vote or the browser abandons creation. Neither path performs Poll
  deletion, so AD-12's deletion outbox never exists; both epics obey AD-12 while
  temporary or superseded objects accumulate and threaten the cost ceiling.
- **Why literal compliance is insufficient:** AD-12 defines adoption and Poll
  deletion, but not expiration of never-adopted objects or replacement of an
  adopted object.
- **Required spine change:** Give every temporary object an expiry/cleanup
  marker and require a bounded sweeper independent of Poll deletion. Replacing
  an adopted object must atomically transfer D1 ownership and enqueue the old
  key. Adopted keys are immutable and belong to exactly one Poll option.
- **Disposition:** **Autofix.**

## Medium

### M-1 — Result-visibility transitions after creation are unspecified

- **Incompatible pair:** The creator epic treats `result_visibility` as editable
  at any time because AD-17's lock list omits it. The results epic assumes it is
  immutable because caches, voter expectations, and the original creation
  contract are built around one setting. Both obey every AD.
- **Required spine change:** Decide whether visibility is immutable,
  tighten-only, or freely mutable, and define its projection invalidation and
  effect on already open result pages. If product input has not settled this,
  add it as an explicit open question rather than leaving silence.
- **Disposition:** **Discuss**, then add or defer with a revisit condition.

### M-2 — Voter Code storage cannot satisfy both redemption and creator retrieval without a decision

- **Incompatible pair:** The security epic stores only one-way code digests,
  following the privacy posture. The creator epic expects to reopen and copy the
  generated list, following FR-17. Both can comply with AD-7 and AD-15 because
  the spine only forbids codes in telemetry; their contracts are incompatible.
- **Required spine change:** Before the Voter Code epic, choose one-time display
  with digest-only storage, encrypted recoverable codes with a named key owner,
  or another explicit contract. Bind comparison, display, export, and key
  rotation behavior at that point.
- **Disposition:** **Defer** as an architectural decision with the same revisit
  trigger as Voter Code implementation.

### M-3 — Preview topology is bound but not decided

- **Incompatible pair:** CI maps every pull-request preview to the shared staging
  Worker and state. Another epic provisions a per-branch Worker but points OAuth
  and canonical links at production because there is no preview binding/base
  URL contract. Both can claim AD-14 compliance because its rule enumerates only
  local, staging, and production despite “preview” appearing in Binds.
- **Required spine change:** Either declare that deployable previews do not
  exist, or define preview Worker/state isolation, OAuth callback policy,
  canonical host configuration, indexing/discovery suppression, and teardown.
- **Disposition:** **Autofix** with an assumption if no product choice is
  available.

### M-4 — Expand-contract names a pattern but not the multi-release compatibility rule

- **Incompatible pair:** A Poll epic deploys code that requires a newly expanded
  column immediately after its own migration. A Results epic still on the
  previous release writes the old shape during rollout. Both call their change
  “expand-contract,” yet mixed-version traffic can lose or misread data.
- **Required spine change:** Bind migrations to a release sequence: additive
  schema first, code compatible with old and new shapes, backfill/dual behavior
  where required, then destructive contract only after no deployed code depends
  on the old shape. Name one migration owner for the single Worker release.
- **Disposition:** **Autofix.**

### M-5 — Demo reset conflicts with immutable accepted Vote facts

- **Incompatible pair:** The public-demo epic implements the PRD's reset action
  by deleting accepted Votes. The voting/results epics enforce AD-6's immutable
  Vote facts. The Capability Map claims FR-26 is governed, but the two units
  cannot both deliver their assigned requirement under the current rule.
- **Required spine change:** Explicitly reject/defer Demo reset, or define it as
  deletion and recreation of a designated Demo Poll with a new internal Poll ID
  and stable public reference rather than mutation of accepted Vote facts.
- **Disposition:** **Discuss** because the source marks reset as an assumption;
  the spine must still decide or defer it.

## Low

No low-severity findings. The remaining gaps are cross-epic contracts or
integrity/security boundaries and should not be demoted to local implementation
detail.

## Recommended Gate Action

Apply C-1, C-2, and H-1 through H-10 before finalizing. Resolve or explicitly
defer M-1, M-2, M-3, and M-5 with named revisit conditions; tighten AD-14 for
M-4. Re-run lint and the independent reviewers after the spine is re-distilled.
