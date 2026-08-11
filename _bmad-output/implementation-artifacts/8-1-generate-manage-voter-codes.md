---
baseline_commit: 9e7a4fd59b898e81b8e68660e4ba0cbd76b5ed39
---

# Story 8.1: Generate & Manage Voter Codes

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Ultimate context engine analysis completed 2026-08-11 — comprehensive developer guide created from the complete Epic 8, PRD, architecture, UX, current code, migration, test, telemetry, and recent-Git context. -->

## Story

As a Creator running an invite-only vote,
I want to generate a batch of one-time codes and track their redemption,
so that I control exactly who can vote and know how many invitations are still live.

## Acceptance Criteria

1. **Generate and copy a batch.** **Given** a Poll with the Voter Codes Toggle on, **when** its Creator generates N codes on `/creator/{link}/codes`, **then** the generate action becomes non-interactive with the exact label `GENERATING…` and no spinner, and the combined code list appears in the Voter Code panel overlay — monospaced, with one copy action for the whole displayed set (FR-17, UX-DR16). The exact inline confirmation `{n} codes copied.` renders in label-caps beside the action, is announced politely, persists until the panel closes, and is never a toast.
2. **Protect the code panel interaction.** **Given** the Voter Code panel is open, **when** the Creator uses it, **then** focus is trapped inside, `Esc` and the explicit `CLOSE` action close it, the scrim does **not** dismiss it, the page behind does not scroll, overlays never stack, and focus returns to the invoking control on every close path (UX-DR16).
3. **Track all batches without exposing voters.** **Given** generated codes, including codes later redeemed by Story 8.2, **when** the panel renders, **then** a label-caps-lg line reads `{redeemed} OF {total} REDEEMED`, redeemed codes are struck through, and the projection exposes only code text plus used/unused state — never a Vote ID, person, IP/session identity, display name, Comment, ballot, or redemption timestamp (NFR-4, UX-DR19). The Creator can append more batches only while the Poll is effectively open and Voter Codes remain enabled; the ordered list and counts always reflect the combined persisted inventory.

## Tasks / Subtasks

- [ ] Task 1 — Ratify the Voter Code fact model and add migration `0018` (AC: 3)
  - [ ] **Required architecture checkpoint before migration/code:** update the architecture spine and obtain explicit approval for the recoverable-code decision. Record why reopen/copy requires recoverable normalized plaintext under the current architecture; the owner-only read path; `private, no-store`; exclusion from telemetry, errors, URLs, exports, HTML data attributes, and operational logs; D1 Time Travel/restore implications; Poll-delete cascade/retention behavior; and that encryption requires a separate key-generation/rotation/recovery/binding/deployment decision. If this decision is not approved, halt — do not improvise a key or implement plaintext storage.
  - [ ] In that same architecture update, make Voting the owner of code inventory/redemptions, add the concrete tables to the ER/fact map, and narrow the deferred row so only Story 8.2 enforcement and Story 8.3 VPN Blocking remain deferred. Do not claim invite-only admission is complete in 8.1.
  - [ ] Add `db/migrations/0018_voter_codes.sql` with normalized, Poll-owned facts: `voter_code` (`id`, `poll_id`, opaque retry `batch_id`, stable `position`, recoverable uppercase `code`, `created_at_ms`) and architecture-named `voter_code_redemptions` (`code_id` primary/unique, `vote_id` unique, `redeemed_at_ms`). Use snake_case, UTC Unix ms, foreign keys with Poll/Vote cascades, `UNIQUE (poll_id, code)`, `UNIQUE (poll_id, batch_id, position)`, and code length/alphabet checks.
  - [ ] Add D1 guards so a redemption can only join a Code and Vote from the same Poll and one Vote cannot consume multiple codes. Add insert-time guards with distinct stable abort messages for missing/effectively closed Poll, disabled Voter Codes, and the 1,000-code total cap. Compare Deadline to database time with the existing migration idiom `CAST(unixepoch('subsec') * 1000 AS INTEGER)`, never caller `created_at_ms`. The cap guard must count committed plus earlier same-batch rows so concurrent novel batches serialize at the boundary and the losing D1 batch rolls back to zero inserted rows.
  - [ ] Regenerate `db/migrations.manifest.json` with `pnpm migrations:checksum`, then run `pnpm migrations:guard`. Never edit migrations `0001`–`0017`.
- [ ] Task 2 — Provider-free generation and management policy in Voting (AC: 1, 3)
  - [ ] Add `src/modules/voting/voter-codes.ts` and re-export it from `src/modules/voting/index.ts`; add branded `VoterCodeId` to `src/shared/domain/index.ts` (AD-19/AD-23). Keep Astro, D1, environment access, and Web APIs behind injected ports.
  - [ ] Implement strict batch-count policy and safe copy: default 25; whole integers `1..100` per batch; maximum 1,000 persisted codes per Poll. Invalid or over-total requests return stable application error codes plus inline safe copy. `[ASSUMPTION]` These bounds cover UJ-4's 25-code case while bounding D1 batch work and the required complete-list UI; change them only with capacity evidence and corresponding UX/tests.
  - [ ] Implement the ruled result contract exactly: `voter_code_count_invalid` → `422` / `Enter a whole number from 1 to 100.`; `voter_code_generation_closed` → `422` / `This Poll is closed. Existing codes are still available.`; `voter_code_generation_disabled` → `422` / `Turn on Voter Codes before generating a batch.`; `voter_code_limit_reached` → `422` / `This Poll can have up to 1,000 Voter Codes.`; `voter_code_batch_conflict` → `409` / `That generation request changed. Reload and try again.`; `voter_code_generation_exhausted` → `503` / `Codes weren’t generated. Try again.`; and unknown persistence failures → `voter_code_generation_failed`, `500`, with that same safe copy. Exact retry replay and new success both use the `303` PRG. Ownership concealment retains the existing `404` contract.
  - [ ] Generate eight characters from the exact 32-symbol alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` using injected cryptographically secure random bytes; eight independent 5-bit symbols provide exactly 40 bits and avoid `0`, `1`, `I`, and `O`. Use rejection-free `byte & 31`; never `Math.random`, timestamps, sequential values, or UUID substrings as the code.
  - [ ] Model generation as an imperative command with ports for owner-qualified state, existing-batch lookup, combined inventory projection, and atomic persistence. Require owner, Voter Codes enabled, and effective-open state in policy for useful errors, while retaining D1's race guard. Generation does **not** increment `representation_version`: code inventory is private management state, and Story 8.2's accepted Vote already increments the Poll version.
  - [ ] Make a retried POST idempotent with a server-generated canonical lowercase `crypto.randomUUID()` `batch_id`, strictly parsed as a full UUID. Preserve it on `422`; issue a fresh one on each new GET and after successful PRG; never put it in a URL or log. UUIDs are permitted for this idempotency key — the ban on UUID substrings applies to the voter-facing code.
  - [ ] Pin command precedence: owner-qualify first, then look up `(poll_id, batch_id)`. Exact stored N returns the existing batch even if the Poll later closed, crossed its Deadline, disabled the Toggle, or reached the cap; different N returns `voter_code_batch_conflict`. Only a novel batch evaluates toggle/open/cap and generates. Produce N unique in-memory values and persist exactly N or zero. On a random collision, retry the whole uncommitted set at most three times; never silently return fewer codes.
- [ ] Task 3 — Purpose-shaped D1 adapter (AC: 1, 3)
  - [ ] Add `src/adapters/d1/voter-codes.ts` rather than extending the 3,860-line general adapter. Resolve a canonical Poll reference plus authenticated internal owner ID before reading code facts; missing/non-owner targets are indistinguishable.
  - [ ] Return a purpose-shaped projection ordered by `created_at_ms`, `batch_id`, then `position`, containing only Poll display facts, code text, and `redeemed: boolean`. The join may use `voter_code_redemptions`, but Vote IDs/timestamps and all voter facts must be stripped inside the adapter.
  - [ ] Persist the retry batch and all N codes atomically using the repository's tested D1 prepared-statement/batch pattern. Interpret constraint failures narrowly: idempotent replay reloads the original batch; random-code collision regenerates the whole set; open/toggle guard maps to a stable unavailable result; unknown failures return safe copy without logging SQL/bind values or raw exception text that could contain a code.
  - [ ] After Task 1's explicit architecture approval, store recoverable normalized code text in D1 because the literal combined-list/reopen AC cannot be served from a digest alone. Keep it behind owner authorization, `private, no-store`, and no-log/no-URL boundaries. Do **not** repurpose `BETTER_AUTH_SECRET` or `VOTE_DIGEST_SECRET`; at-rest encryption requires its own architecture, rotation, recovery, binding, and deployment decision.
- [ ] Task 4 — Owner-only route, strict form, entry point, and telemetry (AC: 1, 3)
  - [ ] Add `src/lib/voter-code-form.ts`: accept only `csrf_token`, `intent=generate`, `count`, and one canonical lowercase UUID `batch_id`; reject duplicate keys, `File` values, unknown keys, malformed/non-integer counts, and non-canonical batch IDs. Preserve the submitted count and same batch ID on a `422`.
  - [ ] Add `src/pages/creator/[reference]/codes.astro` as the specific route ahead of the existing `creator/[...path].astro` fallback. Support `GET`, `HEAD`, and `POST`; return `405` with `Allow` otherwise; apply `private, no-store` to every render/redirect/error; redirect signed-out users with the full validated return path; conceal missing/non-owner Polls as `404`; set `requestContext.pollId` only after owner-qualified resolution.
  - [ ] Keep the route a thin inbound adapter: centralized middleware owns same-origin/session-bound CSRF; Zod/strict form parsing owns the boundary; Voting policy owns generation rules; the D1 adapter owns storage. Successful generation uses `POST → 303 → GET /creator/{encoded-reference}/codes?panel=codes`; query/redirect state contains no code or batch secret.
  - [ ] Update `src/pages/creator/polls/[pollId].astro` only at the lifecycle-action seam: when authoritative persisted `voterCodes` is on, render `MANAGE VOTER CODES` linking through the Poll's encoded canonical reference. Preserve the existing owner gate, security-toggle form, Demo controls, exports, Meeting tally, and unrelated lifecycle behavior.
  - [ ] Normalize the new operation in `src/adapters/telemetry/index.ts` as method-qualified `GET|HEAD|POST /creator/:reference/codes` before the generic reference rule; add `batchId` and `batch_id` to `FORBIDDEN_KEYS`; retain the fixed six-field telemetry record and prove it contains no submitted reference, code, batch ID, form body, or raw exception text. Do not emit a second log from the route.
- [ ] Task 5 — Code-management surface, reusable overlay extension, and clipboard enhancement (AC: 1, 2, 3)
  - [ ] Build the route as a server-rendered management surface with the Poll question, a real back link, a labelled `NUMBER OF CODES` numeric input (default 25), `GENERATE CODES`, and a local `VIEW CODES` invoker when inventory exists. The `?panel=codes` GET opens the panel server-side; closing returns focus to that local invoker. Without JavaScript, generation, validation, visible/selectable codes, and real-link close/back navigation remain complete; manual selection is the copy fallback.
  - [ ] Add `src/components/voter-code-panel.astro` on the existing `Overlay`. Extend `src/components/overlay.astro` with an explicit `dismissOnScrim`/panel-kind contract whose default preserves scrim dismissal for delete/reset/comment confirmations; update `src/scripts/overlay.ts` to honor only the opt-out, retain `Esc`, focus trap/return, no stacking, inert state, and scroll restoration, and expose a close signal so code-copy feedback resets only when the panel closes.
  - [ ] Render `{redeemed} OF {total} REDEEMED` exactly; render every combined code in stable order in Courier Prime `data-lg`; strike redeemed entries and keep them readable in `dim`, not `faint`. Copy exactly the complete displayed list, including struck redeemed codes, one code per line; `{n}` in `{n} codes copied.` is the number actually copied.
  - [ ] Add `src/scripts/voter-codes.ts` as isolated progressive enhancement: suppress duplicate generation submission; change only the submit label to exact `GENERATING…`; use no spinner or new motion; do not disable successful hidden/input controls required for native serialization. Clipboard success produces one adjacent `aria-live="polite"` label and persists until panel close; clipboard denial leaves the visible list and UI usable and never claims success.
  - [ ] Make the flat tokenized panel viewport-safe at 375×812: capped block size, internally scrolling code list, always-reachable `COPY ALL CODES` and `CLOSE`, no horizontal overflow. Preserve the overlay's panel background, top/bottom hairlines, zero radius, no shadow/scale-in, 44px+ creator targets, 2px/2px token focus, and identical light/dark silhouette.
  - [ ] Ruled state behavior: existing inventory remains owner-viewable/copyable after close or direct navigation while the Toggle is off, but no generation form/action is rendered; the normal Poll-detail entry remains conditional on the Toggle being on. Codes do not expire, revoke, delete, regenerate, gain recipient metadata, or become person-linked in this story.
- [ ] Task 6 — Tests, documentation, and full gate (all ACs)
  - [ ] Unit: generator alphabet/length/40-bit mapping with injected bytes; strict N/form boundary; caps; retry idempotency/divergent-count conflict; collision retry/exhaustion; effective-open/toggle policy; no version increment. Add component/source tests for exact copy, semantic dialog labels, redeemed strikethrough, token-only styling, no raw HTML, toast, spinner, or animation.
  - [ ] Overlay/script regression: code-panel scrim never dismisses; legacy confirmation scrims still do; `Esc`, forward/backward Tab containment, no stacking, body scroll lock/restore, invoker focus return, copy confirmation lifetime, clipboard failure, and serialization-safe double-submit behavior.
  - [ ] Workerd/D1: schema checks/FKs/cascades/cross-Poll guards; one code↔one redemption; one Vote consumes at most one code; owner/toggle/open guards including close/Deadline races; exact all-or-none N; concurrent distinct batches near 1,000 prove one winner and zero rows from the loser; exact replay after close, Deadline, Toggle-off, and cap still returns the stored batch; divergent replay conflicts; stable combined order/count; projection exposes no voter facts. Follow `applyD1Migrations` and FK-ordered cleanup conventions.
  - [ ] Route integration: real auth middleware and session CSRF; signed-out return path; `404` ownership concealment; `405`/`Allow`; HEAD; `private, no-store`; `303` success and `422` preservation; no code/reference/batch leakage in URL, error, request context, or telemetry; hostile Poll text remains Astro-escaped.
  - [ ] Playwright: from Poll detail enable Voter Codes, navigate by keyboard, generate 25, observe one `GENERATING…` submission and `0 OF 25 REDEEMED`; verify focus trap, scrim non-dismiss, `Esc`/Close and focus return; copy 25 newline-delimited codes and exact persistent `25 codes copied.`; close/reopen clears confirmation; seed one redemption and see only one struck code plus `1 OF 25 REDEEMED`; append a second batch; close Poll and prove generation unavailable. Capture and inspect 375px dark and desktop light proof with no overflow or console/page errors; retain existing delete/reset scrim behavior.
  - [ ] Add the user-visible capability under `CHANGELOG.md` → `[Unreleased]`, while stating honestly that voter-side code enforcement arrives in Story 8.2. Update any README feature-status wording only if it currently claims a different capability state.
  - [ ] Gate: `pnpm migrations:checksum && pnpm migrations:guard && pnpm test && pnpm check`; `pnpm test:e2e`; `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check`.

## Dev Notes

### Critical context

- **There is no Voter Code persistence today.** `poll.voter_codes_enabled` was added by migration `0009`, the toggle is already parsed/persisted/rendered, and architecture describes future `voter_code_redemptions`, but migrations `0001`–`0017` contain neither inventory nor redemption tables. Story 8.1 creates both so its management projection is real and Story 8.2 can perform the already-ratified unique `code_id` insert without reshaping the schema.
- **The feature trigger is now real.** Epic 8 was deferred until a real Poll needed it. This story opens only generation/management; SM-3 is not satisfied until 8.2 gates submission and redeems atomically.
- **Planning route versus current owner route is intentional.** The AC's `/creator/{link}/codes` uses the canonical public reference. Current Poll detail remains `/creator/polls/{pollId}`. Use the specific canonical-reference codes route and link to it from detail; do not expose internal Poll IDs in the new URL or refactor existing owner routes.
- **No new dependency is needed.** Use Workers `crypto.getRandomValues`, Astro SSR, existing D1 bindings, and the existing overlay/clipboard patterns. Stack pins remain Node 24.18.0, pnpm 11.17.0, TypeScript 7.0.2, Astro 7.1.5, `@astrojs/cloudflare` 14.1.6, Zod 4.4.3, Wrangler 4.115.0, Vitest 4.1.10, workerd pool 0.19.0, and Playwright 1.62.0.
- **Current-doc check.** Context7 resolved Cloudflare Workers to `/websites/developers_cloudflare_workers`; its available result confirmed prepared `D1Database` access but returned no match for the focused `batch()` atomicity query. Do not invent new platform semantics from that absence: use the repository's established tested batch pattern and prove all-or-none, replay, and guard behavior against real workerd/D1 integration tests.
- **Source snapshot discipline.** The recorded baseline is the Story 7.4 implementation commit. Context creation occurred on `story/7-4-availability-grid-tally` with user-owned, pre-existing Story 7.4 review/retrospective changes, plus this Story 8.1 artifact and sprint transition. At development start, inspect branch/status before any mutation and halt until the intended Epic 7 checkpoint/integration state is established. Never reset, clean, stash, checkout, cherry-pick, commit, or otherwise relocate that mixed work automatically. Once resolved, implement only from `story/8-1-generate-manage-voter-codes` at the user-selected baseline and keep its commit scoped to Story 8.1.

### Ruled defaults and HTTP result contract

- `batch_id` is a canonical lowercase UUID used only as an opaque POST retry key. A GET and every successful PRG mint a fresh value; a recoverable validation response preserves the submitted value. It never appears in a URL, telemetry record, log, or client-visible data attribute.
- Owner qualification precedes retry lookup. An exact `(poll_id, batch_id, N)` replay returns the already-stored batch and redirects with `303`, even if the Poll subsequently closed, crossed its Deadline, disabled Voter Codes, or reached 1,000. A same-batch different-N replay is `voter_code_batch_conflict` / `409`. Only a novel batch evaluates current open/toggle/cap eligibility.
- Every non-success render is `private, no-store`, uses the stable code/status/copy named in Task 2, and preserves only safe submitted state needed to retry. D1 trigger messages are internal stable identifiers (`voter_code_poll_closed`, `voter_code_toggle_disabled`, `voter_code_total_cap`); map them narrowly and never expose raw SQLite text.
- The count default is 25, the accepted batch range is `1..100`, and the persisted total cap is 1,000. The database uses its own Unix-ms clock for open-state guards and enforces the cap under concurrent novel batches; HTTP prechecks provide friendly copy but are not the integrity boundary.

### Architecture and security guardrails

- **AD-1/AD-19:** Voting owns code inventory and redemption. The Astro route may map HTTP only; do not put generation, authorization, caps, open-state, or collision policy in it. Do not add code generation to Poll lifecycle merely because the Toggle lives on `poll`.
- **AD-6/AD-7:** D1 is the sole fact source. Story 8.2 will insert `voter_code_redemptions(code_id, vote_id, ...)` in the same constrained Vote batch. Do not reserve a code with a mutable `used` flag or zero-row update; the unique insert is the concurrency boundary.
- **AD-15:** Raw codes are bearer credentials. They never appear in telemetry, console logs, errors, analytics, exports, URLs, query parameters, request-context fields, HTML data attributes, or test snapshots/proof filenames. A Creator-authorized HTML text node and explicit clipboard payload are the only browser exposures.
- **AD-17:** Voter Codes may be enabled after Votes exist but never disabled once enabled on a voted Poll. Earlier non-code Votes remain valid; N new codes mean at most N later code redemptions, not N total historical Votes. Story 8.2 owns that enforcement wording.
- **AD-20:** Initial Meeting responses may redeem a code in 8.2; Meeting revisions must never redeem again. Do not modify revision code in 8.1.
- **AD-22:** The existing middleware chain already protects `/creator/*`; do not add a bypass or duplicate CSRF implementation. Authentication alone is insufficient — every read/write is owner-qualified in application/adapter boundaries.
- **AD-24:** Generation changes private inventory, not the linked voting/results representation. No Poll version bump. A future redemption accompanies a Vote, whose existing transaction supplies the version increment.

### Existing seams to extend — do not reinvent

| File | Current state | Story 8.1 change / preservation |
| --- | --- | --- |
| `src/modules/polls/poll-security.ts` | Complete five-toggle metadata plus tighten-only command | Reuse untouched; do not build another toggle policy. |
| `src/pages/creator/polls/[pollId].astro` | Owner concealment, `private, no-store`, authoritative toggle rendering, lifecycle actions | Add only the canonical-reference management link; preserve all existing forms, result/export/Demo/Meeting behavior. |
| `src/components/overlay.astro` | Reusable semantic dialog; every consumer currently behaves as a confirmation | Add an explicit scrim-dismiss opt-out defaulting to today's behavior; keep token anatomy. |
| `src/scripts/overlay.ts` | No stacking, focus trap, `Esc`, scroll lock, focus return; scrim dismissal is unconditional | Gate only the scrim close and provide a close/reset signal; do not fork a second overlay controller. |
| `src/scripts/share-action.ts` | Clipboard permission/fallback and duplicate-activation precedent | Follow its controller idiom, but keep code copying in a code-specific enhancer. |
| `src/adapters/telemetry/index.ts` | One normalized method-qualified operation and sensitive-field denylist | Add the codes-route shape before generic reference matching; never log the real reference/code. |
| `src/components/trust-badge.ts` / `src/modules/voting/index.ts` CastVote path | Deliberately do not enforce Voter Codes yet | Leave voter input, admission, redemption, rejection copy, and `INVITE CODE REQUIRED` for 8.2. |

### Scope boundaries

- In: owner-authorized inventory generation, retry safety, combined persisted list, redemption-state projection, manual-copy fallback, clipboard enhancement, exact overlay behavior, schema ready for atomic redemption.
- Out: voter code input/validation, Vote rejection copy, atomic redemption writes, trust-badge enforcement, VPN detection, email invites, recipient assignment, delivery tracking, revocation, deletion, expiry, per-code names, teams, public API, or a replacement Security Toggle framework.
- Do not associate codes with intended or actual people. “Redeemed” is a boolean fact on this surface, not an audit trail.

### Recent Git intelligence

- The current feature pattern is one story branch and one logical feature commit containing story/tracker, migration/domain/adapter/delivery/UI, user-facing changelog, and unit/integration/E2E evidence. Review remediation is a separate scoped `fix(...)` commit. Do not push or merge without explicit user instruction.
- Story 7.4 (`9e7a4fd`) confirms the repository accepts purpose-shaped modules plus real-D1 and browser proof, while recent review fixes show why read-only state, native form serialization, and accessible non-color state need explicit tests.

### Project Structure Notes

- NEW: `db/migrations/0018_voter_codes.sql`, `src/modules/voting/voter-codes.ts`, `src/adapters/d1/voter-codes.ts`, `src/lib/voter-code-form.ts`, `src/pages/creator/[reference]/codes.astro`, `src/components/voter-code-panel.astro`, `src/scripts/voter-codes.ts`, focused unit/integration/E2E specs.
- UPDATE: `db/migrations.manifest.json`, `src/shared/domain/index.ts`, `src/modules/voting/index.ts`, `src/pages/creator/polls/[pollId].astro`, `src/components/overlay.astro`, `src/scripts/overlay.ts`, `src/adapters/telemetry/index.ts`, associated overlay/telemetry tests, `ARCHITECTURE-SPINE.md`, `CHANGELOG.md`.
- No expected change: `src/modules/polls/poll-security.ts`, middleware/CSRF, `src/lib/poll-delivery.ts`, voter-facing pages/components, trust badge, rate-limit/Turnstile, Meeting revision, exports, Worker bindings/types, or README setup.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Requirements Inventory FR-15/FR-17, AR-1/5/12/13/14/18/19/20/21, UX-DR16/18; Epic 8 and Story 8.1 lines 1192–1216; Stories 8.2–8.3 lines 1218–1264]
- [Source: `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md` — UJ-4 lines 39–45; Voter Code definition lines 54–65; FR-15/FR-17 lines 196–221; NFRs lines 304–318; §7.4 and SM-3 lines 348–356]
- [Source: `_bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/addendum.md` — demand-driven phase boundary lines 29–31]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md` — AD-1, AD-6/7, AD-15–17, AD-19/20, AD-22–24; Consistency Conventions; Structural Seed; ER/fact map; FR-15–19 capability map; Deferred]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md` — Typography, Shape/Elevation, `overlay`; `_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md` — surface map line 51, Voice and Tone lines 101–127, component patterns lines 160–175, state table lines 226–228, accessibility lines 247–311, UJ-4 lines 421–430]
- [Source: `db/migrations/0006_votes.sql`, `db/migrations/0009_security_toggles.sql`; `src/modules/polls/poll-security.ts`; `src/pages/creator/polls/[pollId].astro`; `src/components/overlay.astro`; `src/scripts/overlay.ts`; `src/scripts/share-action.ts`; `src/adapters/telemetry/index.ts`; `tests/unit/overlay.test.mjs`; `tests/integration/creator-poll-lifecycle-route.integration.test.ts`; `tests/e2e/creator-poll-lifecycle.spec.mjs`]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List
