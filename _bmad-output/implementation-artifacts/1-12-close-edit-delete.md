---
context_creation_commit: de8430731bf8ef3c2325e421961a97abafe84a27
implementation_baseline_commit: 51c54048e95dd900dd0d6e28deb2b91e3d8118ce
baseline_commit: 51c54048e95dd900dd0d6e28deb2b91e3d8118ce
dependency_story: 1.11
dependency_state_at_context_creation: review-unmerged
---

# Story 1.12: Close, Edit & Delete

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Context provenance: context_creation_commit remains de843073… . Implementation baseline is origin/main @ 51c54048e95dd900dd0d6e28deb2b91e3d8118ce (PR #9 merge of Story 1.11). Branch story/1-12-close-edit-delete cut from that SHA. -->

## Story

As a Creator,
I want to close my Poll on my schedule, edit its description, and delete it entirely,
so that I control its lifecycle without ever invalidating votes already cast.

## Acceptance Criteria

1. **Given** an open Poll, **When** its Creator manually closes it or its Deadline passes, **Then** every subsequent read and command treats it as closed — effective state is computed from closed_at and deadline at request time, never delegated to a scheduler — later Votes receive the closed response, and the final Tally follows the Visibility Setting (FR-4, AD-11).
2. **Given** a Poll with at least one Vote, **When** the Creator views the edit surface, **Then** the question, options, and Poll Type render as read-only text with "Locked — the first Vote has been cast. The description is still yours to edit.", while the description remains editable at any time (FR-5, AD-17).
3. **Given** the Creator chooses delete, **When** the confirmation overlay opens, **Then** it shows "Delete \"{question}\"? This removes the Poll and all {n} Votes in it. The link stops resolving. There is no undo." with focus trapped inside, Esc and scrim-click dismissing, and focus returning to the invoking control on close (UX-DR16).
4. **Given** a confirmed deletion, **When** it executes, **Then** the Poll and all D1-owned children are hard-deleted in one batch and the link immediately returns a plain 404 — no tombstone, indistinguishable from a Poll that never existed (FR-5, UX-DR19).
5. **Given** a Poll with no accepted Votes, **When** its Creator saves the editable definition, **Then** question, ordered options, multi-select mode, optional min/max bounds, and description are validated with the creation rules and replaced atomically; **And given** the first Vote wins the race, **When** that save reaches D1, **Then** no definition field, option row, or representation version changes and the edit surface returns the locked state (derived from FR-5, AD-17, AD-24, and Story 1.7's explicit Story 1.12 handoff). The only Poll Type implemented in Epic 1 is Multiple Choice, so it remains truthful read-only text rather than offering unimplemented conversions.

## Tasks / Subtasks

- [x] Task 0: Begin implementation from the real merged predecessor baseline (dependency for all ACs)
  - [x] Finish Story 1.11 review and merge it before writing Story 1.12 product code. Story 1.11 is the direct UI predecessor and was uncommitted at context creation; its current route, types, tests, and line numbers are provisional.
  - [x] Fetch origin, verify the merged origin/main SHA, cut story/1-12-close-edit-delete from that exact commit in a fresh context/worktree, and replace this file's implementation_baseline_commit plus provenance comment with the full 40-character SHA. Keep context_creation_commit as historical provenance. Never implement on the dirty Story 1.11 worktree or infer the baseline from local conversation state.
  - [x] Re-read AGENTS.md, this story, the merged Story 1.11 artifact/review findings, sprint-status.yaml, and the final diff from the recorded baseline before editing. Preserve unrelated work and stage only explicit Story 1.12 files.

- [x] Task 1: Add provider-free Poll lifecycle/definition commands and shared validation (AC: #1, #2, #4, #5)
  - [x] NEW src/modules/polls/poll-lifecycle.ts and UPDATE src/modules/polls/index.ts to export four narrow application commands/ports: closePoll, updatePollDefinition, updatePollDescription, and deletePoll. Routes parse and map; the Polls module owns lifecycle/integrity policy; the D1 adapter implements persistence (AD-1, AD-19).
  - [x] Every command takes branded PollId and the authenticated internal UserId from server context. No command accepts owner identity, Poll ID, current status, Vote count, or canonical reference from submitted form data (AD-4, NFR-3).
  - [x] ClosePoll uses one request-scoped nowMs and the shared effectivePollStatus rule. A real manual transition is one-way, sets closed_at_ms to nowMs, and increments representation_version with updated_at_ms atomically. An already manually closed or deadline-closed Poll is an idempotent success: never overwrite the original closure time and never increment the version again. There is no reopen command and no scheduler.
  - [x] Extract/reuse one Multiple-Choice definition validator from CreatePoll rather than duplicating policy. updatePollDefinition and creation share: trimmed question/options/description; blank option removal; at least 2 and at most 30 options; question 280, option 100, description 5,000 Unicode-code-point caps; duplicate-option rejection; multi-select flag plus integer/order/option-count bounds; and the existing exact field copy. Creation-only visibility, Deadline, reference, and idempotency rules stay outside this helper.
  - [x] updatePollDefinition is allowed only while no accepted Vote exists. It can replace question, ordered options, multi-select mode, optional min/max bounds, and description in one logical change. The current strategy registry implements only multiple_choice: display Poll Type as read-only and reject any forged alternate type rather than persisting an enum whose strategy is not shipped.
  - [x] updatePollDescription reuses that validator's exact description normalization: trim leading/trailing whitespace, normalize blank to null, count Unicode code points, and enforce POLL_CAPS.maxDescriptionLength. It remains available after the first Vote and after close.
  - [x] Description updates are allowed before or after the first Vote and before or after close. A value identical to the stored normalized value is an idempotent success with no version increment; a real visible change increments representation_version and updated_at_ms in the same persistence operation (AD-24).
  - [x] Classify the normalized delta before persistence. A true no-op succeeds without D1 writes/version changes. A description-only delta delegates to updatePollDescription, remains legal if a Vote races, and does not churn option IDs. Any question/options/multi-select/bounds delta uses updatePollDefinition, includes the submitted description atomically, and contributes exactly one incrementRepresentationVersion descriptor.
  - [x] Once any Vote exists, updatePollDefinition returns stable poll_definition_locked with the exact lock line and contributes no persistence rows. The owner count shown on the page is presentation only; the D1 port re-enforces no-Vote at mutation time. Submitted definition keys on update-description, close, or delete intents are strictly rejected with 422, never silently ignored.
  - [x] Map failures once into stable safe application codes/messages: shared per-field definition/description validation; poll_definition_locked; non-enumerating poll_not_found for missing/non-owned resources; and distinct generic persistence failures for close, edit, and delete. Never expose SQL/provider details and never log question or description text.
  - [x] Unit tests cover explicit close, Deadline equality, already-closed idempotence, the complete shared definition-validation matrix, definition no-op/change contributions, unsupported Poll Type, description blank/cap/code points, description after Vote/close, locked definition, branded ownership input, and stable safe errors.

- [x] Task 2: Implement owner-scoped, atomic D1 persistence without a migration (AC: #1, #2, #4, #5)
  - [x] UPDATE src/adapters/d1/index.ts with lifecycle persistence beside the existing Poll repository. At implementation baseline, no production close/edit/delete writer exists; preserve create, reference resolution, Story 1.11 owner list/detail reads, Vote persistence, and Results projections.
  - [x] Manual close must be one owner-qualified, effective-open-guarded UPDATE that coalesces the lifecycle field and shared representation-version contribution: WHERE id = PollId AND owner_user_id = UserId AND closed_at_ms IS NULL AND (deadline_ms IS NULL OR deadline_ms > nowMs). Set closed_at_ms, updated_at_ms, and representation_version together. Do not run a guarded field update followed by an unconditional version update: a foreign Poll would receive a version bump even when the first statement changed zero rows.
  - [x] Definition replacement is one D1 batch whose every mutating statement carries an equivalent owner plus NOT EXISTS accepted-Vote guard. The parent UPDATE sets question/description/multi-select/bounds, updated_at_ms, and the single version increment; the option DELETE is correlated through that same qualified Poll; each option INSERT is INSERT ... SELECT guarded by that same qualified/no-Vote predicate. Never guard only the first statement and then delete/insert children unconditionally: if a Vote wins, cascading option deletion would destroy accepted selections.
  - [x] No-op is exclusively the command's normalized pre-check and never calls this batch. Inspect the first guarded statement's change count: if zero, perform an owner-qualified re-read to distinguish missing/non-owner from a now-locked first-Vote race; no later statement may have changed a row. If edit wins, D1 commits the complete new definition before a Vote can linearize. If Vote wins, the complete edit is inert and returns poll_definition_locked.
  - [x] Replace option rows for every integrity-definition change, even when labels stay stable, so a ballot loaded against an older question/configuration cannot commit silently after edit. Do not replace them for a description-only change. A stale in-flight Vote that validated old option IDs and loses the race must roll its entire batch back and map to poll_definition_changed, not the false poll_deleted 404. On a D1 FK failure, re-read the Poll and selected option reachability: missing Poll maps PollGone; existing Poll with missing selected options maps the new stable changed-definition outcome; unrelated malformed-state FK failure stays generic.
  - [x] Description edit likewise coalesces description, updated_at_ms, and representation_version into one owner-qualified statement only when the normalized value actually changes. The command still contributes incrementRepresentationVersion; the adapter maps that descriptor into the guarded provider statement rather than hand-rolling version policy in the route.
  - [x] For zero-row close/edit outcomes, distinguish owner-visible idempotence from missing/non-owner through an owner-qualified read, without weakening the identical 404 contract. Re-check the row at the persistence boundary; a preceding page GET is not mutation authorization.
  - [x] Delete through a prepared, owner-qualified DELETE FROM poll WHERE id = ? AND owner_user_id = ? submitted as the story's single D1 batch. Verify the Poll statement changed exactly one row; zero means the same missing/non-owned result. Do not pre-increment representation_version for a row that is being removed.
  - [x] Rely on the shipped foreign keys and ON DELETE CASCADE to remove the current aggregate atomically: poll_option, poll_reference, vote, vote_selection, and voter_claim, including submission/payload idempotency facts held on vote rows. Re-scan forward migrations after Story 1.11 merges and add every then-current Poll-owned child to the integration assertion. The direct Wrangler child-first cleanup in tests/e2e/creator-session.mjs is a fixture workaround, not production precedent.
  - [x] Preserve the Story 1.4 ratified deletion decision: a deleted custom reference is re-claimable because poll_reference is a cascading child. Do not add a retired-slug table, deleted_at column, public tombstone, or permanent reservation. The deleted URL is a plain 404 until and unless a later Poll claims that reference.
  - [x] Preserve the existing close/delete race boundaries. The vote_poll_open_guard trigger and foreign keys decide transaction-time truth: Vote-first may commit and is preserved by a later close (or removed by a later delete); close-first rejects the Vote as closed; delete-first rejects it as gone. No partial Vote, selection, or claim may survive.
  - [x] No schema, migration, manifest, binding, generated Worker type, or dependency change is expected. If implementation reveals a real schema requirement, add a new forward migration and checksum it; never edit 0004, 0006, 0008, or their existing manifest hashes.
  - [x] Workerd integration tests prove both-owner isolation, full definition replacement/no-op/lock behavior, effective-open guards, exactly-once version changes, unchanged-description behavior, every current cascade, zero/many-Vote deletion, and both deterministic orderings of Vote versus definition-edit/close/delete. Foreign-owner and Vote-first attempts assert every definition field, option/selection row, updated_at_ms, and representation_version remain byte-for-byte unchanged.

- [x] Task 3: Turn the Story 1.11 creator detail into the lifecycle surface (AC: #1, #2, #3, #5)
  - [x] UPDATE src/pages/creator/polls/[pollId].astro after Story 1.11 merges. Keep Cache-Control: private, no-store as the first response policy and on every early return; expand its GET/HEAD-only method gate intentionally to GET, HEAD, and POST. Preserve the owner-only read, owner-concealing 404, selected Poll row, list-first DOM order, 320px/1fr desktop grid, mobile stack, creation flash, canonical link, monitor floor, and live-results link.
  - [x] Use native forms posting to the same canonical creator-detail route with hidden csrf_token and a strict intent union: add-option (non-mutating no-JS rerender), update-definition, update-description, close, delete. Read PollId only from the route and UserId only from Astro.locals.requestContext.principal. Central middleware remains responsible for same-origin/session-CSRF enforcement; no lifecycle bypass or separate client API is allowed.
  - [x] Parse only string FormData values at the delivery boundary. Invalid intent/shape or definition/description validation renders status 422 with every safe submitted edit value preserved, exact inline field messages, aria-invalid/aria-describedby wiring, and no summary/modal error. Missing/non-owned is the same plain 404; safe infrastructure failure is 500.
  - [x] Successful definition update, description update, close, and delete use POST to 303. **Ratified outcome contract:** definition, description, and close redirect to the same detail as ?outcome=poll-updated, ?outcome=description-updated, and ?outcome=poll-closed; delete redirects to /creator?outcome=poll-deleted. Render flat messages "Poll updated.", "Description updated.", "Poll closed.", and "Poll deleted." respectively. The outcome line is first in main, tabindex="-1", focused after render, and the document title leads with the outcome (UX-DR17). No toast.
  - [x] With zero accepted Votes, render one update-definition form reusing the Create Poll question/options/One-or-Several/min/max/description primitives and exact inline errors. NEW src/components/poll-definition-fields.astro (or an equivalently focused shared component) and NEW src/scripts/poll-definition-form.ts should be consumed by both create and edit rather than copying a second option editor. UPDATE src/pages/creator/new.astro and src/scripts/create-poll-form.ts only as required to preserve creation behavior while extracting the shared fields/enhancer.
  - [x] The shared no-JS option floor remains complete on edit: ADD OPTION posts add-option, preserves every field, adds one bounded row or the existing helper note, and performs no domain mutation. The enhancer adds/removes/renumbers rows, preserves 2–30 limits, clamps bounds only on explicit stable shrink, and prevents duplicate submissions; edit's pending label is SAVING… with no spinner.
  - [x] Poll Type renders as escaped read-only MULTIPLE CHOICE before and after Votes because no alternate strategy ships yet. With at least one Vote, question, ordered options, type, multi-select mode, and effective bounds all render as read-only text and add the exact line "Locked — the first Vote has been cast. The description is still yours to edit." Only description remains an input.
  - [x] If a first Vote wins after the editable page rendered, update-definition returns 422 with no partial change, re-reads the current definition/count, switches to the locked view, and preserves the submitted description in the still-editable textarea. Do not display submitted question/options as if they were saved.
  - [x] Use the existing input/textarea language throughout: visible labels, 44px minimum target, server validation, escaped text, and no placeholder-as-label or set:html.
  - [x] An effectively open Poll gets a text-labelled CLOSE POLL secondary action posting intent=close directly. Once effectively closed, the control disappears or is inert and the truthful CLOSED state remains. There is no close confirmation overlay, reopen affordance, window.confirm, or destructive styling for close: the UX overlay set is closed and only delete is confirmed.
  - [x] Keep edit/close/delete controls inside the selected detail pane. Never add secondary actions to poll-card; its entire row remains exactly one link. A close redirect naturally moves the Poll into the closed group; a delete redirect naturally removes the row through Story 1.11's one-query owner list.
  - [x] UPDATE src/pages/creator/index.astro only for the new poll-deleted outcome, preserving signed-in flash, empty/populated lists, one primary create action, no-store behavior, sorting, and snapshot counts. Resolve every open Story 1.11 review finding before inheriting this surface; do not build Story 1.12 around its provisional defects.
  - [x] Set requestContext.pollId only after ownership succeeds. Normalize GET/POST /creator/polls/:pollId in telemetry so the internal UUID never appears in the operation label; if Story 1.11 review has not already fixed it, UPDATE src/adapters/telemetry/index.ts, src/middleware.ts, and tests/unit/telemetry.test.ts. Never log question, description, canonical reference, CSRF token, or submitted values.

- [x] Task 4: Complete the reusable destructive button and overlay interaction (AC: #3)
  - [x] NEW src/components/button-destructive.astro using the documented secondary metrics with mode-collapsed alarm text/border, 48px minimum height, zero radius, and the global 2px/2px focus ring. UPDATE src/styles/tokens.css with a small --btn-destructive-* family bound to --color-alarm; preserve --color-solar-dark exactly because the deploy smoke extracts it.
  - [x] The DELETE POLL invoker is secondary, not destructive. button-destructive appears only as the final confirmation action behind the overlay. UPDATE src/components/button-secondary.astro minimally if it must forward id, aria-haspopup, aria-controls, or data hooks; do not clone its visual CSS into the page.
  - [x] UPDATE the existing src/components/overlay.astro rather than creating a poll-specific dialog. Render the same dialog DOM in both states: on the base detail it is hidden/inert and absent from the accessibility tree but available for JavaScript interception; ?confirm=delete renders it open for the no-JS path. Keep its mode-aware scrim, flat panel, top/bottom hairlines, zero shadow/scale, heading-md title, and reusable slots; add unique id, aria-modal, aria-labelledby, aria-describedby, and explicit open/dismiss hooks.
  - [x] NEW src/scripts/overlay.ts as a small generic progressive enhancer. On open, remember the invoker, prevent background scroll, focus the safe initial control (Cancel), and trap forward/backward Tab inside the panel. Close on Esc, Cancel, or a click on the confirmation scrim itself; clicks inside the panel do not dismiss. Every close path restores body scrolling and focus to the exact invoker. Never stack overlays.
  - [x] Provide a complete no-JavaScript floor: DELETE POLL is a real link to the same detail with ?confirm=delete; that GET server-renders the same dialog open; Cancel is a real link back to the base detail; confirm is a regular POST form. JavaScript prevents the link navigation only when the hidden dialog/enhancer is ready, then opens that DOM. It is never required to delete or cancel.
  - [x] Split the exact confirmation into an escaped heading and description without changing catalog wording: Delete "{question}"? / This removes the Poll and all {n} Votes in it. The link stops resolving. There is no undo. Preserve Votes literally for every count unless the authoritative UX/AC is amended. The count is server-computed from accepted vote rows for display only; it is never accepted as authorization or deletion scope.
  - [x] Unit/source-contract tests bind the tokens, forbid raw HTML and hard-coded colors, prove the destructive component is used only inside confirmation, and verify the overlay's labelling/hooks. Browser tests, not source regexes alone, own focus containment, Esc, scrim, scroll lock, and focus-return proof.

- [x] Task 5: Preserve public Vote, Results, and missing-state contracts (AC: #1, #4, #5)
  - [x] Reuse src/shared/domain/index.ts effectivePollStatus everywhere. Deadline passage remains request-time state with no materializing write. Do not introduce a stored status enum, cron, alarm, queue, or client clock as authority.
  - [x] Prove a manual close immediately causes subsequent Vote POSTs to take the established closed response, keeps all accepted Votes unchanged, removes public vote affordances, and renders CLOSED. A Deadline exactly equal to now is closed.
  - [x] Prove Result visibility after close without weakening privacy: Live remains visible; After Close becomes visible; Creator-Only stays owner-authorized. Hidden/missing projections remain tally/version/validator-free and private, no-store. Do not pre-read private tally/version data before authorization.
  - [x] Prove manual close changes the live Results validator once through representation_version, /results/live reports closed, the visible-only poller stops, and the live indicator settles on CLOSED. Deadline crossing invalidates through effective status without a write.
  - [x] Prove delete makes the canonical base route and its /results, /results/live, and /manifest children ordinary missing resources with no tombstone or deleted-specific copy. Existing live tabs treat 404 as terminal and reload into the truthful missing page; preserve that Story 1.9 behavior.
  - [x] UPDATE src/adapters/d1/index.ts, src/modules/voting/index.ts, and src/pages/[reference].astro for the option-edit race described in Task 2. Add stable poll_definition_changed and voice-consistent copy: "This Poll changed while you were deciding. Your Vote wasn't recorded — review the options and try again." Map it explicitly in outcomeFromError, re-read/render the current Poll as 422, preserve only selections whose IDs still exist, never call an existing Poll deleted, and never accept a ballot against the former definition. This is an assumption-derived failure line; record the final wording in the Dev Agent Record.
  - [x] Otherwise preserve src/modules/results, public result authorization, and results-live.ts unless a failing regression demonstrates that the established contract cannot observe the new owner-scoped mutation. Any necessary change stays thin and receives a focused regression test.
  - [x] Preserve future AD-12 extension seams: when Image Poll media exists, DeletePoll will contribute self-contained R2 cleanup-outbox keys in the same batch before cascading D1 rows. Do not create speculative media tables, outbox rows, R2 calls, or Cron work in Story 1.12.

- [x] Task 6: Prove the complete lifecycle and close the repository gate (AC: all)
  - [x] NEW tests/integration/creator-poll-lifecycle-route.integration.test.ts against the real middleware chain: signed-out redirect, session-CSRF rejection, valid token, strict POST intents, private no-store on 200/303/405/422/404/500, owner/non-owner behavior, complete field preservation, and safe failure copy.
  - [x] NEW tests/e2e/creator-poll-lifecycle.spec.mjs using the seeded Better Auth harness and one-worker serial D1 conventions. Drive the production UI/route for close/edit/delete; fixture helpers may arrange starting state but direct closePoll/deletePoll SQL must not substitute for proving the actual capability.
  - [x] E2E cases: pre-Vote question/options/multi-select/bounds/description edit; no-JS ADD OPTION; definition-edit-first versus Vote-first outcomes; stale ballot changed-definition recovery; description before/after Vote and after close; exact locked copy/read-only definition; manual/Deadline closure; late-Vote rejection; After Close versus Creator-Only; zero/many-Vote deletion; dashboard move/removal; canonical 404; non-owner concealment; keyboard-only operation; and JavaScript-disabled confirmation/delete.
  - [x] Overlay E2E: hidden dialog absent from the accessibility tree before open; open from keyboard; initial focus on Cancel; Tab and Shift+Tab containment; Esc, Cancel, and scrim dismissal; panel click non-dismissal; background scroll lock; focus return after every enhanced close path; escaped hostile question text; and the exact {n} Votes copy. No console/page errors except the harness's exact intentional document-404 filter.
  - [x] Browser proof is mandatory: capture console-clean 375px dark and 1280px light views of the post-Vote locked edit surface, open delete overlay, and closed detail; also capture the creator list after deletion. Store proof in the established test-results convention and record exact paths in the Dev Agent Record.
  - [x] Add explicit reference-reuse proof: delete a custom-link Poll, create a replacement with the same slug, and prove the canonical URL resolves the replacement. UPDATE CHANGELOG.md under Unreleased for the user-visible lifecycle controls and remove/mark resolved the deferred-work.md bounds-lock handoff only after D1 race tests prove it. Do not leave a source TODO.
  - [x] Intentionally update inherited tests/unit/poll-card.test.mjs and tests/e2e/creator-dashboard.spec.mjs after all Story 1.11 findings land: the former currently pins detail-surface absence assertions and the latter owns inherited detail/no-JS/browser contracts. Preserve poll-card itself as one link with no actions.
  - [x] Run narrow red/green tests while implementing, then the repository gate in documented order: pnpm migrations:guard; pnpm test; pnpm check; pnpm test:e2e; pnpm types; git diff --exit-code worker-configuration.d.ts; pnpm build:production. Record exact totals and browser evidence; never check a task based on an artifact-reported predecessor run.

### Review Findings

- [x] [Review][Patch] Add optimistic representation-version checking for concurrent zero-Vote definition edits and return an explicit 422 conflict that reloads the current definition (medium) [src/modules/polls/poll-lifecycle.ts:397]
- [x] [Review][Patch] Reject definition edits for stored non-Multiple-Choice Poll types (high) [src/modules/polls/poll-lifecycle.ts:40]
- [x] [Review][Patch] Return not_found when the owner-qualified DELETE changes zero rows instead of reporting a false success (medium) [src/adapters/d1/index.ts:501]
- [x] [Review][Patch] Make same-value description writes idempotent at the persistence boundary under races (medium) [src/adapters/d1/index.ts:386]
- [x] [Review][Patch] Submit the owner-qualified hard delete through the required single D1 batch (medium) [src/adapters/d1/index.ts:501]
- [x] [Review][Patch] Map the shared representation-version descriptor instead of ignoring and hand-rolling it (medium) [src/adapters/d1/index.ts:345]
- [x] [Review][Patch] Complete the required integration matrix for ownership, edit/close/delete race orderings, and every current cascade child (medium) [tests/integration/poll-lifecycle-adapter.integration.test.ts:294]
- [x] [Review][Patch] Load lifecycle parent fields, Vote count, and options from one consistent database snapshot (medium) [src/adapters/d1/index.ts:295]
- [x] [Review][Patch][Chunk 2] Reload the persisted definition when a first Vote wins an edit or no-JS ADD OPTION race; never render rejected draft question/options as locked truth (high) [src/pages/creator/polls/[pollId].astro:161]
- [x] [Review][Patch][Chunk 2] Strictly parse lifecycle FormData: reject File-valued or duplicate singleton fields, forbidden-key presence, and over-ceiling option arrays before any mutation (high) [src/pages/creator/polls/[pollId].astro:68]
- [x] [Review][Patch][Chunk 2] Exercise the real lifecycle page handler and required intent/status/ownership/preservation matrix instead of testing middleware with a stubbed next response (high) [tests/integration/creator-poll-lifecycle-route.integration.test.ts:46]
- [x] [Review][Patch][Chunk 2] Render the stored Poll Type truthfully and keep unsupported definitions read-only while preserving description edits (medium) [src/components/poll-definition-fields.astro:46]
- [x] [Review][Patch][Chunk 2] Use the request-scoped nowMs for lifecycle commands, status, freshness, list ordering, and card projection (medium) [src/pages/creator/polls/[pollId].astro:62]
- [x] [Review][Patch][Chunk 2] Make Create consume the extracted shared definition fields so create/edit markup and accessibility behavior cannot drift (medium) [src/pages/creator/new.astro:260]
- [x] [Review][Patch][Chunk 2] Put SAVE CHANGES first in edit-form DOM submit order so implicit Enter saves instead of adding an option (medium) [src/components/poll-definition-fields.astro:127]
- [x] [Review][Patch][Chunk 2] Do not re-enable lifecycle submit controls on an unconditional 10-second timer or non-restored pageshow while the original POST may still be active (medium) [src/scripts/poll-definition-form.ts:258]
- [x] [Review][Patch][Chunk 2] Treat a missing final lifecycle snapshot as concurrently deleted and render the ordinary 404 instead of a stale detail page (medium) [src/pages/creator/polls/[pollId].astro:407]
- [x] [Review][Patch][Chunk 2] Show effective min/max defaults in the locked multi-select definition when stored bounds are null (medium) [src/components/poll-definition-fields.astro:79]
- [x] [Review][Patch][Chunk 2] Mark option and multi-select groups aria-invalid when their group validation fails (medium) [src/components/poll-definition-fields.astro:101]
- [x] [Review][Patch][Chunk 2] Give enhanced REMOVE option controls the required 44px minimum target (medium) [src/components/poll-definition-fields.astro:226]
- [x] [Review][Patch][Chunk 3] Complete the required lifecycle E2E matrix, including a real late-Vote POST/count proof, both edit/Vote orderings, stale-ballot recovery, post-close description, Deadline/visibility behavior, many-Vote delete, child-route 404s, non-owner concealment, and focused dashboard removal (high) [tests/e2e/creator-poll-lifecycle.spec.mjs:135]
- [x] [Review][Patch][Chunk 3] Prove the complete overlay interaction contract in Playwright: hidden accessibility tree, keyboard open, Tab/Shift+Tab containment, scrim and Cancel dismissal, panel non-dismissal, scroll restoration, every focus-return path, nonzero Vote copy, and HTML-hostile escaped text (high) [tests/e2e/creator-poll-lifecycle.spec.mjs:214]
- [x] [Review][Patch][Chunk 3] Replace the conditional lifecycle-suite test.skip with a hard prerequisite failure so the required Story 1.12 evidence can never silently disappear (high) [tests/e2e/creator-poll-lifecycle.spec.mjs:17]
- [x] [Review][Patch][Chunk 3] Capture the required 375px dark and 1280px light lifecycle screenshots for locked edit, open delete overlay, closed detail, and post-delete dashboard, then record exact proof paths (high) [tests/e2e/creator-poll-lifecycle.spec.mjs:135]
- [x] [Review][Patch][Chunk 3] Initialize server-rendered open overlays with their real invoker and clear the confirm URL on every enhanced close so focus restores and refresh does not reopen a dismissed dialog (medium) [src/scripts/overlay.ts:126]
- [x] [Review][Patch][Chunk 3] Close an already-open overlay through its controller before opening another so body scroll and focus state cannot become orphaned (medium) [src/scripts/overlay.ts:41]
- [x] [Review][Patch][Chunk 3] Drive the no-JavaScript delete floor through the real DELETE POLL and Cancel links before confirming deletion (medium) [tests/e2e/creator-poll-lifecycle.spec.mjs:301]
- [x] [Review][Patch][Chunk 3] Add focused GET/POST/trailing-slash telemetry regressions proving creator Poll UUIDs never enter operation labels (medium) [src/adapters/telemetry/index.ts:97]
- [x] [Review][Patch][Chunk 3] Make the destructive-button exclusivity test scan production consumers instead of checking only the intended detail page (low) [tests/unit/overlay.test.mjs:58]
- [x] [Review][Patch][Chunk 3] Mark the now-resolved overlay, submit-restore, and option-FK deferred entries resolved with current Story 1.12 references (low) [_bmad-output/implementation-artifacts/deferred-work.md:61]

## Dev Notes

### Binding Scope Decisions

| Decision | Story 1.12 contract | Why |
|---|---|---|
| Editable Poll fields | With zero Votes: question, options, multi-select flag/bounds, and description. After the first Vote: description only | FR-5's lock transition, AD-24's pre-Vote edit rule, and Story 1.7's explicit 1.12 handoff |
| Poll Type | MULTIPLE CHOICE stays read-only in Epic 1 | It is the only implemented strategy; offering Ranked/Image/Meeting would persist unsupported state |
| Definition after first Vote | Question, options, Poll Type, multi-select flag and min/max are immutable; exact lock line renders | AD-17, enforced again inside the D1 mutation batch |
| Manual close | One-way direct secondary POST; idempotent when already effectively closed; no overlay or reopen | FR-4 plus the UX rule that exactly two confirmation overlays exist |
| Description/version | Normalize like create; increment once only on a real visible change | AD-24; no-op commands must not manufacture live updates |
| Delete | Owner-qualified hard delete; cascades every current D1 child; no tombstone | FR-5, AD-12, UX-DR19 |
| Deleted reference | Re-claimable after cascade | Ratified Story 1.4 decision; retirement would require the forbidden tombstone/reservation store |
| Success destinations | Edit/close return to detail; delete returns to /creator; focused outcome lines | Existing POST-to-303 and UX-DR17 patterns |
| Result visibility, discovery, security, Deadline edits | Out of scope | Owned by Stories 1.8, 3.1, Epic 2, or unspecified; do not smuggle them into lifecycle forms |

### Product and UX Contract

- The lifecycle surface is the selected Poll detail delivered by Story 1.11. The implemented route is /creator/polls/{internal PollId}, despite the UX spine's conceptual /creator/{link}; do not replace it with a second detail route or expose actions in list rows.
- Closed means closed for every read and command when closed_at_ms is present or deadline_ms is less than or equal to the request's nowMs. Existing accepted Votes stay immutable. Closing changes access to After Close Results but never changes Creator-Only authorization.
- The exact lock line and delete copy are acceptance data, not paraphrase prompts. Creator text is untrusted and Astro-escaped. Required text never uses faint color.
- Three overlays exist in the complete UX: Poll delete, Comment delete, and Voter Codes. Story 1.12 completes the shared primitive for Poll delete; it does not add a close dialog or a fourth overlay.
- Overlay visuals: mode-aware scrim; flat panel; top/bottom hairlines; no shadow, scale, gradient, box, or rounded-card invention; title in heading-md; Cancel secondary; confirm destructive. Focus is 2px with 2px offset, text-labelled, keyboard-complete, and state is never color alone.
- Creator controls have at least 44px targets; the documented button primitives are 48px. No icon-only controls, toast, spinner, hover-only affordance, or window.confirm. Description failure is inline and the submitted value survives.
- The closed public Poll renders options read-only, no selection markers or Vote button, the established closed line, and a Tally only when Visibility permits. Deleted routes use the same plain 404 as never-existing resources.

### Architecture Guardrails

- AD-1/AD-19: Polls owns lifecycle policy; Astro is an inbound adapter; D1 is an outbound adapter. No SQL, effective-state rule, or ownership decision lives in the page.
- AD-4/NFR-3: every final mutation is qualified by internal PollId plus internal UserId. Route hiding and a preceding owner read are not authorization.
- AD-6/AD-7: D1 is the source of truth. Use prepared statements and constraints; do not implement read-then-write ownership, application-only cascade, or client authority.
- AD-11: one effectivePollStatus helper and one request-scoped nowMs. No scheduler and no deadline materialization.
- AD-12: current Poll deletion is relational cascade. Future media cleanup writes self-contained outbox keys before deletion; an outbox row must never carry a Poll FK. That future requirement shapes the command seam but adds no Story 1.12 schema.
- AD-17: accepted Votes only tighten lifecycle. Definition is editable before the first accepted Vote and locked transactionally afterward; description is presentation and remains editable. Bounds follow question/options/type because changing them would invalidate accepted multi-select ballots.
- AD-22: central CSRF order stays request context → telemetry → session → CSRF → creator guard. Better Auth mount exceptions do not apply to lifecycle POSTs.
- AD-24: a real manual close or description change increments the single representation_version in the same atomic provider operation. Deadline crossing is encoded in the validator's effective state, not a scheduled write.
- Consistency: success is POST to 303; validation is 422 with preserved safe input; stable app codes never expose SQL; filenames are kebab-case; domain timestamps are UTC Unix milliseconds; telemetry emits one privacy-safe record.
- Destructive concurrency: never split an owner guard from unconditional follow-up writes. A zero-change guarded statement followed by an unconditional version or child mutation is a cross-owner integrity defect even if the UI first loaded the right Poll.

### Existing Code That Must Be Preserved

- src/adapters/d1/index.ts currently owns Poll create/read/reference, Story 1.11 owner projections, atomic Vote batches, version reads, and Results projection. Add lifecycle methods without duplicating the repository or changing existing result privacy order.
- src/modules/polls/index.ts currently owns CreatePoll and re-exports focused helpers; it is already large. Put lifecycle code in a focused sibling and re-export it. Extract only the description policy needed for true reuse; do not churn unrelated creation policy.
- src/pages/creator/new.astro and src/scripts/create-poll-form.ts own the working server/JavaScript option editor, multi-select chooser, bounds, exact copy, and no-JS ADD OPTION floor. Extract shared definition fields/behavior rather than creating a divergent edit form; preserve creation's Deadline/timezone/publish-only behavior.
- src/pages/creator/polls/[pollId].astro is Story 1.11's provisional GET/HEAD, no-store, owner-scoped list/detail surface. Expand it rather than replace it, and re-check the merged review version before applying line-based guidance.
- src/pages/creator/index.astro owns signed-in outcome, empty/populated dashboard, sorting, and create action. Add one delete outcome without rebuilding the page.
- src/components/overlay.astro is a static, conditionally rendered role=dialog shell with visual tokens only. It does not yet trap focus, dismiss, lock scroll, or restore focus; completing those behaviors is new work.
- src/components/button-secondary.astro supports basic button/link props but not the invoker's full aria/data hooks. Extend the primitive narrowly if needed instead of page-local button CSS.
- src/styles/tokens.css already collapses light/dark colors into runtime variables and defines primary/secondary/input/overlay tokens. Add destructive aliases against --color-alarm; do not add mode-specific component overrides when collapsed vars suffice.
- src/shared/application/index.ts already exports incrementRepresentationVersion. Commands contribute it; adapters map it. Do not create a second version helper.
- src/shared/domain/index.ts already exports effectivePollStatus. Do not create a route-local status function or stored status column.
- src/modules/voting/index.ts and createVotePersistence currently map every D1 FK failure to PollGoneError. Definition edits make an option-FK race reachable; refine that mapping through a post-failure Poll/option reachability read so an existing changed Poll gets poll_definition_changed, while a truly deleted Poll keeps the plain 404.
- src/middleware.ts and src/adapters/telemetry/index.ts currently normalize dynamic public :reference routes, but the context-creation snapshot did not normalize /creator/polls/:pollId. Normalize the internal ID path if the 1.11 review still leaves that gap.
- tests/e2e/creator-session.mjs has direct close/delete fixture helpers because Wrangler CLI cleanup cannot assume foreign-key pragmas. Those helpers arrange test state only and are not the production deletion design.

### Previous Story and Git Intelligence

- Story 1.11 was uncommitted at context creation and is still Status: review. An adversarial review subsequently added open architecture, query, focus/order, sizing, semantics, source-contract, and E2E findings; resolve them all before merge. Its implementation reported 676 unit/integration tests and 9 focused dashboard E2E tests, but those results are artifact-reported and its screenshot directory was absent. Re-run everything after the reviewed merge.
- Story 1.11 establishes: one-link poll-card rows with no secondary actions; a single owner-grouped list query; effective-open sorting; list-first detail DOM order; 320px/1fr at 1024px; aria-current selection; private no-store; and a monitor link to the existing Results surface. Lifecycle work must preserve all of it.
- Story 1.10's review found race-sensitive E2E fixture writes; combine related fixture setup in one D1 invocation when a live poller could see intermediate states.
- Story 1.9 makes live 404 terminal, combines representation_version with effective status, and requires hidden Results to omit tally/version/validators. Close/delete regressions must keep those privacy and terminal-state corrections.
- Story 1.7 explicitly handed bounds editing/locking enforcement UI to Story 1.12. That predecessor decision plus AD-24 resolves the apparent Story/IA ambiguity: build the pre-Vote definition editor, guard every option mutation against accepted Votes, then render the exact locked state.
- Story 1.4 explicitly ratified deleted-Poll slug reuse as re-claimable because deletion is indistinguishable from nonexistence and a retirement store would be a tombstone. Preserve that accepted decision even though the earlier PRD adversarial review recommended retirement.
- Recent baseline commits: de84307 merged Story 1.10; 9874210 fixed a poller-observable E2E write race; 5f3f1bd recorded Story 1.10 review; 83ec14c implemented Story 1.10; ca3713e merged Story 1.9.

### Current Technical Information

- Pinned repository stack: Node 24.18.0, pnpm 11.17.0, TypeScript 7.0.2, Astro 7.1.5 with @astrojs/cloudflare 14.1.6, Better Auth 1.6.25, Zod 4.4.3, Wrangler 4.115.0, Vitest 4.1.10 with @cloudflare/vitest-pool-workers, Playwright 1.62, and fast-check 4.9. Story 1.12 needs no new package.
- Current Cloudflare D1 documentation, resolved through Context7, confirms that DB.batch accepts prepared query/non-query statements and commits the sequence atomically; ON DELETE CASCADE remains active for declared foreign keys. Use prepared statements and the shipped constraints rather than manual child cleanup in production.
- Current Astro documentation, resolved through Context7, confirms server-rendered pages can branch on Astro.request.method, read native form bodies with Astro.request.formData(), return custom Response objects/statuses, and use ordinary forms as a complete baseline. The repository's hand-built Response redirects remain preferred because they preserve private no-store headers.
- No library upgrade, new Cloudflare service, new endpoint, or runtime binding is part of this story. If package versions drift before implementation, run Context7 again against the merged package versions rather than relying on this snapshot.

### Project Structure Notes

- Expected NEW files: src/modules/polls/poll-lifecycle.ts; src/components/poll-definition-fields.astro (or equivalent shared extraction); src/scripts/poll-definition-form.ts; src/components/button-destructive.astro; src/scripts/overlay.ts; tests/unit/poll-lifecycle.test.ts; tests/unit/overlay.test.mjs; tests/integration/poll-lifecycle-adapter.integration.test.ts; tests/integration/creator-poll-lifecycle-route.integration.test.ts; tests/e2e/creator-poll-lifecycle.spec.mjs.
- Expected UPDATE files after Story 1.11 merges: src/modules/polls/index.ts; src/adapters/d1/index.ts; src/modules/voting/index.ts; src/pages/[reference].astro; src/pages/creator/new.astro; src/scripts/create-poll-form.ts; src/pages/creator/polls/[pollId].astro; src/pages/creator/index.astro; src/components/overlay.astro; src/components/button-secondary.astro if hooks require it; src/styles/tokens.css; tests/unit/voting.test.ts; tests/integration/votes-adapter.integration.test.ts; tests/unit/poll-card.test.mjs; tests/e2e/creator-dashboard.spec.mjs; CHANGELOG.md; deferred-work.md.
- Conditional telemetry updates if predecessor review has not fixed the dynamic ID: src/adapters/telemetry/index.ts; src/middleware.ts; tests/unit/telemetry.test.ts.
- Existing tests likely requiring intentional updates: Story 1.11 detail/source contracts and dashboard E2E expectations once lifecycle controls legitimately exist. Keep poll-card's one-link/no-actions contract unchanged.
- Expected PRESERVE/no change: db/migrations/*; db/migrations.manifest.json; wrangler.jsonc; worker-configuration.d.ts; package.json/pnpm-lock.yaml; Better Auth configuration; public Results authorization order; Vote digest/rate-limit policy except safe stale-definition mapping; discovery, security-toggle, export, Comment, share, and media capabilities.
- Do not create docs/decisions, build_log.md, a second lifecycle route/API, a second overlay component, or provider imports inside src/modules.

### Testing Requirements

- Node unit tests own shared creation/edit definition validation, lifecycle policy, stable errors, version contributions, changed-definition Vote mapping, and component/source contracts.
- Workerd integration tests own D1, foreign keys/cascades, real middleware/CSRF, ownership, status codes, and deterministic transaction orderings.
- Playwright owns keyboard/focus/scroll behavior, JavaScript-disabled floor, responsive visual proof, public route transitions, and console cleanliness.
- Test names read as behavior prose. No skipped/only/stub tests or TODOs. Every new function and route behavior receives a same-commit test.
- For races, prove both legal serializations rather than asserting nondeterministic timing. Definition-edit-first invalidates the stale option IDs and returns changed-definition on the Vote; Vote-first leaves every edit row/version untouched and locks the creator surface. Close/delete retain the existing trigger/FK outcomes.
- Apply local migrations before E2E as the harness expects. No auth-provider round trip is required because auth code does not change; seeded sessions exercise lifecycle delivery.

### References

- [Source: _bmad-output/planning-artifacts/epics.md:542-564 — Story 1.12 statement and four acceptance blocks; :330-370 — Vote transaction/races; :426-487 — visibility and live Results; :518-540 — Story 1.11 predecessor; :1046-1064 — future media cleanup]
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md:86-120 — FR-1 through FR-5; :301-310 — ownership/privacy NFRs]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md:46-92 — AD-1 through AD-4; :171-201 — AD-9 through AD-11; :267-276 — AD-17; :290-328 — module/cache ownership; :355-367 — AD-24; :370-407 — consistency conventions; :477-504 — capability ownership]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md:47-62 — creator IA and exact overlay count; :117-120 — exact copy; :151-160 — input/button/overlay behaviors; :172-186 — closed/deleted states; :219-264 — interaction/accessibility; :332-343 — UJ-1 closure]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md:258-280 — button tokens; :390-400 — overlay tokens; :497-526 — layout/rules; :588-610 — button use; :663-698 — overlay and Don't list]
- [Source: _bmad-output/implementation-artifacts/1-11-creator-dashboard.md — provisional predecessor behavior/evidence/open review findings; 1-9-live-updating-results.md — validator/live terminal state; 1-7-multi-select-voting.md:78-108,145-165 — definition/bounds edit handoff; 1-4-custom-links.md:99-105 — ratified deletion/reference decision; deferred-work.md:15-18 — multi-select bounds lock handoff]
- [Source: src/shared/domain/index.ts:30-51 — effectivePollStatus; src/shared/application/index.ts:26-44 — shared version descriptor; src/adapters/d1/index.ts — Poll/Vote/Results repository; src/pages/creator/new.astro — no-store/FormData/422/303/CSRF precedent; src/pages/creator/polls/[pollId].astro — Story 1.11 detail]
- [Source: db/migrations/0004_polls.sql — Poll/options/reference schema and cascades; db/migrations/0006_votes.sql — Vote/selection/claim cascades and open trigger; db/migrations/0008_multi_select.sql — bounds]
- [Source: AGENTS.md — environment, verification gate, testing, Git, migration, middleware, privacy, and documentation rules]
- [Source: Cloudflare D1 Worker API, https://developers.cloudflare.com/d1/worker-api/d1-database/#batch — current atomic batch API; D1 foreign keys, https://developers.cloudflare.com/d1/sql-api/foreign-keys/ — current cascade behavior]
- [Source: Astro forms, https://docs.astro.build/en/recipes/build-forms/ — current SSR FormData pattern; Astro on-demand rendering, https://docs.astro.build/en/guides/on-demand-rendering/ — custom status/Response behavior]

## Dev Agent Record

### Agent Model Used

Grok 4.5 (implementation); GPT-5 Codex (review fixes)

### Debug Log References

- Baseline: origin/main @ 51c54048e95dd900dd0d6e28deb2b91e3d8118ce (PR #9 Story 1.11 merge). Branch story/1-12-close-edit-delete cut from that SHA.
- Unit: 600 passed (pnpm test:unit). Integration: 135 passed. pnpm test total: 735.
- E2E: 116 passed in 9.3 minutes in the complete Playwright suite.
- Gate: migrations:guard ok; pnpm test 735; pnpm check; pnpm test:e2e 116; pnpm types; worker-configuration.d.ts clean; pnpm build:production ok on Node 24.18.0.
- poll_definition_changed copy (final wording): "This Poll changed while you were deciding. Your Vote wasn't recorded — review the options and try again."

### Completion Notes List

- Implemented provider-free lifecycle commands (closePoll, updatePollDefinition, updatePollDescription, deletePoll) with shared definition validation extracted to definition.ts for create+edit parity.
- D1 owner-scoped atomic close/definition/description/delete; definition batch re-checks no accepted Vote on every statement; delete relies on FK CASCADE; custom reference re-claimable.
- Creator detail expanded to POST lifecycle surface: intents add-option/update-definition/update-description/close/delete; outcomes poll-updated/description-updated/poll-closed/poll-deleted; locked definition copy after first Vote.
- Shared poll-definition-fields + poll-definition-form enhancer; destructive button tokens; overlay focus trap/Esc/scrim/scroll lock/focus return; no-JS ?confirm=delete floor.
- Vote path maps option-FK races to poll_definition_changed (not false 404); telemetry normalizes /creator/polls/:pollId.
- Deferred bounds-lock handoff marked resolved; CHANGELOG Unreleased updated.
- Review chunk 1 hardened lifecycle integrity: stored Poll Type guards, consistent snapshots, descriptor-driven timestamps, idempotent description races, optimistic definition conflicts, batched delete semantics, and complete D1 race/ownership/cascade proofs.
- Review chunk 2 hardened the inbound lifecycle surface: strict FormData decoding, persisted-state race rerenders, one request clock, concurrent-delete handling, truthful unsupported-type locking, shared Create/Edit fields, implicit-submit safety, BFCache-only restoration, accessible validation/targets, and real Astro-page integration coverage.
- Review chunk 3 completed browser-observable lifecycle proof, hardened the shared overlay's server-open and single-active-controller behavior, made required E2E setup fail closed, expanded telemetry and destructive-consumer regressions, and closed the superseded deferred-work entries.
- Visual proof: `test-results/story-1-12-lifecycle-proof/locked-edit-375-dark.png`, `test-results/story-1-12-lifecycle-proof/locked-edit-1280-light.png`, `test-results/story-1-12-lifecycle-proof/delete-overlay-375-dark.png`, `test-results/story-1-12-lifecycle-proof/delete-overlay-1280-light.png`, `test-results/story-1-12-lifecycle-proof/closed-detail-375-dark.png`, `test-results/story-1-12-lifecycle-proof/closed-detail-1280-light.png`, `test-results/story-1-12-lifecycle-proof/post-delete-dashboard-375-dark.png`, and `test-results/story-1-12-lifecycle-proof/post-delete-dashboard-1280-light.png`.

### File List

- _bmad-output/implementation-artifacts/1-12-close-edit-delete.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/deferred-work.md
- CHANGELOG.md
- src/modules/polls/definition.ts
- src/modules/polls/poll-lifecycle.ts
- src/modules/polls/index.ts
- src/modules/voting/index.ts
- src/adapters/d1/index.ts
- src/adapters/telemetry/index.ts
- src/lib/creator-lifecycle-form.ts
- src/pages/creator/new.astro
- src/pages/creator/polls/[pollId].astro
- src/pages/creator/index.astro
- src/pages/[reference].astro
- src/components/poll-definition-fields.astro
- src/components/button-destructive.astro
- src/components/button-secondary.astro
- src/components/overlay.astro
- src/scripts/poll-definition-form.ts
- src/scripts/create-poll-form.ts
- src/scripts/edit-poll-form.ts
- src/scripts/overlay.ts
- src/styles/tokens.css
- tests/unit/poll-lifecycle.test.ts
- tests/unit/creator-lifecycle-form.test.ts
- tests/unit/overlay.test.mjs
- tests/unit/poll-card.test.mjs
- tests/unit/telemetry.test.ts
- tests/unit/voting.test.ts
- tests/integration/poll-lifecycle-adapter.integration.test.ts
- tests/integration/creator-poll-lifecycle-route.integration.test.ts
- tests/e2e/creator-poll-lifecycle.spec.mjs
- tests/astro-components.d.ts
- tsconfig.json
- vitest.integration.config.ts

### Change Log

- 2026-08-02: Implemented Story 1.12 close/edit/delete lifecycle end-to-end; status → review.
- 2026-08-02: Resolved all eight code-review chunk 1 findings; status → in-progress pending review chunks 2 and 3.
- 2026-08-02: Resolved all twelve code-review chunk 2 findings; full gate green; status remains in-progress pending review chunk 3.
- 2026-08-02: Resolved all ten code-review chunk 3 findings; complete deploy-equivalent gate and visual proof green; status → done.
