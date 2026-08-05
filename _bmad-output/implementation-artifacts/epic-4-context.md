# Epic 4 Context: Comments & Export

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Humanize known-group Polls by letting a Voter attach one short, optional Comment and display name to the Vote, with visibility and moderation that follow the Poll's existing trust boundaries. Complete creator data ownership by providing direct CSV and XLSX downloads of raw accepted Votes and the computed Tally without exposing duplicate-enforcement identities or other private voter data.

## Stories

- Story 4.1: Comment With Your Vote
- Story 4.2: Comment List & Moderation
- Story 4.3: CSV Export (shipped)
- Story 4.4: XLSX Export (planned)

## Requirements & Constraints

- Comments are configured per Poll. When enabled, the Vote may carry at most one optional Comment and optional display name; a Comment cannot be submitted independently or exist without an accepted Vote. When disabled, the composer is absent without explanatory placeholder copy.
- Comment acceptance is governed by the same submission validation, Security Toggles, duplicate protections, retry semantics, and atomicity as its Vote. A failed Vote must not leave a Comment, and an exact accepted replay must not create another one.
- Comments follow result visibility exactly: anyone permitted to see the Tally may see Comments, while After-Close and Creator-Only restrictions withhold both together. Comments are newest first and are never part of public discovery projections.
- The owning Creator may delete Comments on their Poll. The single Administrator may delete a Comment on any Poll through a separate explicit capability; ownership must never imply administrator authority.
- Comment bodies and display names are plain text and must be escaped wherever rendered. They must not enter operational telemetry.
- CSV and XLSX are direct creator-surface downloads with no configuration dialog. Both contain equivalent data: one row per accepted Vote with the Poll Type's raw response, timestamp, and Comment/display name when present, plus the server-computed Tally.
- Export authorization is enforced server-side against the authenticated internal creator identity and Poll ownership. Exports must omit IP addresses, browser/session identifiers, HMAC digests, duplicate claims, and every other enforcement datum. PDF export is out of scope.
- The voter surface remains server-rendered and lightweight. Comment entry, failure recovery, moderation, and export controls must work within the established keyboard, focus, and no-heavy-client-framework constraints.

## Technical Decisions

- D1 remains the transactional source of truth. Persist the optional Comment in the same constrained batch as the Vote, type-specific facts, duplicate claims, optional code redemption, and the Poll's incremented representation version.
- Keep Comment policy behind its capability contribution port. The voting application command coordinates normalized contributions; routes only validate and map HTTP effects, and adapters must not publish raw database rows.
- Voting owns persisted Comments and their legal write paths. Results owns read-only Tally and export projections; export adapters consume purpose-shaped projection contracts rather than embedding Poll Type switches.
- Each Poll Type supplies its export row shape through the shared strategy contract. Later Ranked, Image, and Meeting Poll implementations add projections without reopening the generic CSV/XLSX exporter.
- Story 4.3's versioned projection supplies identifier-free alignment keys so Results detects type-specific response-row swaps even when Vote timestamps tie. The canonical `VOTES`, `TALLY`, and `SUMMARY` tables stay format-neutral for Story 4.4.
- Authorize the viewer before reading or projecting Comments, Tallies, or exports. Private and not-yet-visible result responses are non-shareable and non-cacheable; discovery caching never contains Comments or result details.
- Deleting a Comment increments the Poll's single representation version in the same transaction so conditional result refreshes cannot retain stale visible Comments. Denied, failed, or no-op mutations must not advance it.
- Browser mutations cross the shared same-origin CSRF boundary; authenticated creator and administrator deletions additionally require the session-bound CSRF token and application-layer ownership or role checks.
- Select an XLSX writer that executes inside workerd behind the export port. It must not change domain or persistence rules, and both file formats must be generated from the same canonical export dataset.
- Preserve the established HTTP conventions: boundary validation, stable safe errors, POST followed by `303` on success, and `422` re-rendering with safe submitted Comment values on validation failure.

## UX & Interaction Patterns

- The voting-page order is question, options, Comment composer, Turnstile challenge when enabled, then the single primary Vote button. The composer has one optional Comment field and one optional display-name field; the roughly 500-character limit counts down only for the final 50 characters.
- Preserve the complete ballot, Comment text, and display name through validation, CAPTCHA, rate-limit, offline, and operational failures. During submission they stay visible but non-interactive while the Vote action reads `COUNTING…`.
- Render Comment bodies as the 16px reading-text style, with the display name above in the uppercase label style or `ANONYMOUS` when absent. Separate entries with a top hairline. Provide no avatars, bubbles, threading, reactions, or reply affordances.
- Creator deletion uses the standard confirmation overlay: visible text action, trapped focus, `Esc` close, dismissible confirmation scrim, locked background scroll, and focus returned to the invoking control.
- On creator Poll detail, show two plain controls side by side: CSV and XLSX. Each starts its download immediately.
- The shipped creator Poll detail currently shows the plain `EXPORT CSV` direct-download control; Story 4.4 adds the sibling XLSX control without a dialog.

## Cross-Story Dependencies

- Story 4.1 extends the existing Vote form, retry model, security stack, and atomic Vote transaction completed by the core polling and vote-security epics.
- Story 4.2 depends on persisted Comments from Story 4.1 and the existing result-visibility and representation-version contracts.
- Story 4.3 establishes the canonical export dataset and Poll Type projection seam; Story 4.4 must reuse that dataset and add only the workerd-compatible XLSX adapter and matching control.
- Future Poll Type epics must supply their own export projections while inheriting the shared Comment, visibility, authorization, and privacy rules.
