# Epic 4 Context: Comments & Export

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Humanize known-group Polls by letting Voters attach an optional short Comment and display name to an accepted Vote while preserving the Poll's security, visibility, and moderation boundaries. Complete creator data ownership with private, direct CSV and bounded synchronous XLSX exports that carry equivalent Vote and Tally data without exposing enforcement identities.

## Stories

- Story 4.1: Comment With Your Vote
- Story 4.2: Comment List & Moderation
- Story 4.3: CSV Export (shipped)
- Story 4.4: XLSX Export (implemented; release evidence pending)

## Requirements & Constraints

- A Vote may carry at most one optional Comment and optional display name. A Comment cannot be submitted independently, must pass the same Security Toggles as its Vote, and must commit or roll back with that Vote. A failed Vote leaves no Comment, an exact accepted replay creates no duplicate, and the composer is absent when Comments are disabled.
- Comments follow Tally visibility: viewers see them only when they may see results. Lists are complete and newest first, and discovery projections never contain Comments. The Poll owner may delete Comments on their Poll; the Administrator may delete any Comment through a distinct capability.
- Comment bodies and display names are plain text, escaped on every surface, and excluded from operational telemetry. A Comment is limited to 500 UTF-16 code units, a display name to 80, and a blank Comment discards its name.
- Creator exports contain one row per accepted Vote with the Poll Type's response data, RFC 3339 timestamp, and current Comment/name when present, plus the complete server-computed Tally. CSV and in-range XLSX must represent the same canonical data; PDF is out of scope.
- Export is owner-only and authorized server-side before any Vote, selection, Comment, or Tally read. Internal IDs, IP or session identifiers, HMAC digests, duplicate claims, and all other enforcement data must not cross the export boundary.
- XLSX is a complete synchronous download only through 1,000 accepted Votes. At 1,001 or more it returns HTTP `409`, no attachment, and exactly `XLSX export supports up to 1,000 accepted votes. Download CSV for larger Polls.` CSV remains available and no partial dataset or workbook is produced.
- The voter surface remains server-rendered and lightweight. All controls must be keyboard operable, visibly focused, text-labelled, and usable without a heavy client framework.

## Technical Decisions

- Poll Types are strategies with a required export projection. Generic CSV and XLSX transports consume one format-neutral canonical dataset, allowing later Ranked, Image, and Meeting Poll types to add row shapes without adding Poll Type switches to the exporters.
- Persist the optional Comment as a one-to-zero-or-one child of the Vote in the constrained Vote batch alongside type facts, duplicate claims, optional code redemption, and the Poll's representation-version increment. A storage guard rechecks that Comments remain enabled so a concurrent disable cannot leave mismatched Vote and Comment state.
- The Comments capability canonicalizes input and owns the legal owner and Administrator deletion commands; Voting owns the persisted Comment fact. A successful deletion removes only the Comment and increments `representation_version` once in the same guarded transaction. Denied, stale, failed, or no-op deletions change neither.
- Results projections authorize visibility before reading private facts. Visible Tallies and Comments come from one snapshot; owner moderation may additionally expose Comment IDs, while the Administrator's exact-reference projection exposes Comments without granting Tally, Vote, owner, or security access.
- Export separately requires the authenticated internal Poll owner before projection. One type-specific D1 driver reads accepted raw rows and the complete Tally from one snapshot, uses IDs only for joins and deterministic ordering, and strips them before the Poll Type projector and transport boundary.
- XLSX runs inside workerd behind the export port. After authorization, one snapshot-consistent D1 statement reads at most 1,001 accepted Votes; the extra Vote is only an oversize sentinel and causes the query to return no Vote or selection rows. In-range workbooks contain exactly `VOTES`, `TALLY`, and `SUMMARY`; Vote, worksheet-row, or worksheet-column overflow fails closed before response bytes begin.
- Browser mutations use the shared same-origin CSRF boundary. Authenticated owner and Administrator moderation additionally require the session-bound CSRF token and application-level ownership or live-role checks.

## UX & Interaction Patterns

- Voting-page reading and focus order is question, options, Comment composer, challenge when enabled, then Vote. The composer is part of the Vote, not a separate action; its Comment counter appears only for the last 50 characters.
- Preserve selections, Comment, and display name through validation, CAPTCHA, rate-limit, offline, and operational failures. During submission they remain legible but non-interactive while the Vote action reads `COUNTING…`.
- Render each Comment as reading text with an uppercase display-name label or `ANONYMOUS`, separated by a hairline. Do not add avatars, bubbles, threading, reactions, replies, truncation, or an empty-list placeholder.
- Comment deletion uses the standard accessible confirmation: focus trap, `Esc` and scrim dismissal, background scroll lock, focus return to the invoking control, and a complete no-JavaScript form path.
- Creator Poll detail presents plain CSV and XLSX direct-download controls side by side with no configuration dialog. Oversized XLSX activation yields the stable CSV-fallback response and no attachment.

## Cross-Story Dependencies

- Comments extend the existing Vote form, security stack, atomic acceptance transaction, result visibility, and representation-version contracts.
- Comment moderation depends on persisted vote-attached Comments and the existing owner and Administrator authorization boundaries.
- CSV establishes the canonical export dataset and Poll Type projection seam; XLSX reuses that dataset and adds only the bounded workerd transport and 1,001st-Vote sentinel, preserving CSV behavior.
- Future Poll Type epics supply their own export projections while inheriting the shared Comment, authorization, privacy, and visibility rules.
