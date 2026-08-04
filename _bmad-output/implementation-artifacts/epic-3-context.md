# Epic 3 Context: Public Face — Discovery, Landing & Demo

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make Oddspark useful and credible to a stranger arriving without a shared Poll link: creators can explicitly publish Polls into a moderated public directory, visitors can understand the product and vote in a real demonstration, and technical evaluators can inspect a clean public repository. This is both a cold-start acquisition surface and the product's portfolio-quality public face.

## Stories

- Story 3.1: Listing Control — Opt Into Discovery
- Story 3.2: Discover Catalog & Sitemap
- Story 3.3: Administrator Delisting
- Story 3.4: Landing Page
- Story 3.5: Demo Poll
- Story 3.6: Presentable Repository

## Requirements & Constraints

- Every Poll starts Unlisted. Only an explicit creator choice may make it Listed; Unlisted and Delisted Polls remain reachable by their canonical links but must be absent from public enumeration, sitemaps, and indexes.
- Discover contains only effectively open, Listed Polls, newest first. Its public projection is limited to the question, Poll Type, canonical voting link, Deadline, open state, and aggregate accepted-Vote attendance. Listing never grants access to option counts, percentages, selections, rounds, Comments, result visibility, owner identity, or internal identifiers.
- Discovery state is independent of result visibility and Poll integrity. Administrator delisting removes enumeration only; it cannot change ownership, link reachability, lifecycle, visibility, representation, or Vote data. Moderation authority is an explicit server-owned capability, never inferred from Poll ownership.
- The landing page must explain the product in plain language before presenting its technical build account, link the public repository, and provide direct entries to Discover and sign-in/create.
- The designated Demo Poll is the real voting experience embedded on the landing page, not a screenshot or reduced imitation. It uses CAPTCHA and Session Checks, leaves IP Checks off to avoid shared-address false positives, shows live results as authorized, and supports a creator-only reset that returns it through the normal empty state.
- The public repository must have a README covering what the product is, why it exists, its stack, and local operation, plus enough architecture context for technical evaluation. No secret, token, or personal data may exist anywhere in repository history.
- Public surfaces must meet the portfolio craft bar: polished responsive presentation, keyboard operability, sensible contrast, text alternatives for images, and honest failure and empty states.

## Technical Decisions

- Browser surfaces are server-rendered Astro with functional HTML and working POST-redirect-GET flows without JavaScript; isolated vanilla TypeScript enhancement is added only where interaction requires it.
- Hexagonal boundaries remain mandatory: delivery routes map HTTP, application commands coordinate use cases, domain modules own policy without framework or provider imports, and adapters implement persistence or platform ports.
- D1 is the sole transactional source of truth. Discovery owns the `unlisted | listed | delisted` state machine and all legal writes to it. Actual listing transitions advance a separate catalog revision; they do not advance the Poll representation version.
- Administrator delist and clear operations must recheck the live internal role and atomically commit the state change with a private, monotonically ordered moderation action. Repeated delist is a no-op; clearing restores the creator's prior Listed or Unlisted choice, falling back to Unlisted when legacy history is unusable.
- Discovery cards are an allowlisted projection in a cache namespace separate from result responses. Result authorization and result caching must never be reused as catalog authorization.
- The Demo Poll is designated by explicit configuration under a stable canonical reference. Reset is a narrowly sanctioned aggregate replacement coordinated by Demo policy and a purpose-built D1 adapter; it preserves stable option identities and refuses when current or historical Discovery moderation facts exist.
- Canonical Poll references share the root namespace, so reserved application routes must remain collision-safe. The fixed moderation surface resolves one Poll at a time and must not become an all-Poll administrative browser.

## UX & Interaction Patterns

Use the established mobile-first, single-column layout that widens without rearranging. Discover reuses the existing full-row `poll-card` pattern rather than a card grid; `NEWER` and `OLDER` are real keyboard-operable links with 48px targets, exhausted controls are visibly inert, and infinite scroll is prohibited. Loading uses still skeleton rows, failures retain already loaded rows with retry, and the empty directory recruits visitors to create a Poll.

Listing selection reuses the existing single-select Poll option pattern with consequence copy. Creator surfaces show textual `UNLISTED`, `LISTED`, or `DELISTED` badges so color is never the sole state cue; Delisted makes the creator control read-only. A voter following a Delisted Poll's link sees the ordinary Poll experience with no moderation notice. The embedded Demo reuses the complete ballot, trust, sharing, and result patterns and handles already-voted, unavailable, JavaScript-disabled, and post-reset empty states as truthful first-class states.

## Cross-Story Dependencies

Listing state and creator opt-in establish the eligibility rules consumed by Discover, sitemap generation, and administrator moderation. The catalog's projection, revision, and cache behavior must react to creator listing changes and administrator holds without coupling to result visibility. The landing page establishes the explanation and action structure before the live Demo is inserted, and its repository link depends on the repository being public and presentable. Demo reset depends on the ordinary Poll, voting, security, result, and creator-authorization contracts rather than introducing a parallel demo implementation.
