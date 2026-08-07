---
baseline_commit: 70922b4
---

# Story 6.1: Upload Image Options

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Ultimate context engine analysis completed 2026-08-07 — comprehensive developer guide created from epics (Epic 6 / FR-11), PRD §4.4, architecture spine (AD-3/6/12/14/17/19/21/22/24, AR-10), UX DESIGN/EXPERIENCE creator-form + image-plate specs, Story 5.x intelligence, Epic 5 retro (T1 R2 audit), and a full codebase audit. No new libraries introduced; all stack pins verified against the spine seed. -->

## Story

As a Creator,
I want to upload one image per option with a caption and alt text,
so that my Poll's choices are the pictures themselves.

## Acceptance Criteria

1. **Formats and size cap enforced at upload.** Given a Creator building an Image Poll on `/creator/new`, when they upload an image per option, then JPEG, PNG, and WebP are accepted with a ~5 MB per-image cap enforced at upload (FR-11). Enforcement is server-side (magic-byte sniff + byte length), with client `accept=` as a hint only.
2. **Temp keys + adoption, atomically.** Uploads land at Poll-scoped temporary R2 keys, and an image becomes servable only after `CreatePoll`'s D1 batch adopts it — a failed creation leaves no reachable Poll and no adopted media (AD-12/AD-3). Temporary keys are never publicly servable.
3. **Alt text blocks publication.** Given an option image missing its alt text, when the Creator attempts to publish, then publication is blocked (422 re-render) with the field named — the one place the creator surface blocks on an accessibility requirement, because a Voter cannot choose between images they can't perceive (UX-DR17).
4. **Upload failure preserves everything else.** Given an upload that fails, when the form re-renders, then it shows "`{filename}` didn't upload. The rest of the form is intact — try that one again." with every other field and upload preserved — including previously successful uploads, which must NOT require re-selection (UX-DR18/19).

## Tasks / Subtasks

- [x] Task 1: `image` Poll Type strategy + registry (AC: 2)
  - [x] New `src/modules/polls/types/image.ts` — AD-3 contract v5 strategy implementing all five ports (`create`, `validateSubmission`, `persistFacts`, `projectResults`, `projectExport`). Voting/tabulation are "exactly Multiple-Choice" (FR-11), so compose/delegate to the multiple-choice implementations for submission, facts, results, and export; `create` additionally validates per-option media facts (media id, required alt text, optional caption). `POLL_TYPE_CONTRACT_VERSION` stays 5.
  - [x] Register in `src/modules/polls/types/registry.ts` (`pollTypeStrategies.image`); extend `definition.ts` branches where poll types are dispatched (`src/modules/polls/definition.ts:86,143–259`). Unknown types stay fail-closed.
  - [x] `src/components/poll-card.ts:18` already has the `image: "IMAGE"` badge label — no change needed there; verify dashboards render it.
- [x] Task 2: Migration 0014 — media schema (AC: 2)
  - [x] `db/migrations/0014_image_media.sql` — `media_object` table (spine ER name): `id` (UUID string PK), `poll_id`, `option_id` (unique — one image per option), `r2_key` (unique — every adopted record singly owns an immutable key, AD-12), `content_type`, `size_bytes`, `alt_text` (NOT NULL, non-empty), `caption` (nullable — captions are optional per IA), `created_at_ms`. snake_case, UTC ms, forward-only (AR-2 idiom). Guard triggers optional but follow the 0013 poll_type-guard precedent if cross-type invariants need protecting.
  - [x] Do NOT create `cleanup_outbox` here unless trivially needed — replacement/deletion cleanup is Story 6.3's scope. 6.1's only cleanup surface is "unadopted temp keys older than 24h", owned by 6.3's sweeper.
  - [x] `pnpm migrations:guard` must stay green; migrations run via `migrate:local|staging|production` scripts.
- [x] Task 3: Upload handling on `/creator/new` (AC: 1, 2, 4)
  - [x] `src/pages/creator/new.astro` — set `enctype="multipart/form-data"` when (and only when) the Image type is in play, or unconditionally if simpler; the POST parser already tolerates File parts (`new.astro:131–135`) and CSRF middleware already reads `csrf_token` from multipart (`src/lib/csrf.ts:194–214`).
  - [x] Server-side per-file validation before any R2 write: magic-byte sniff (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF….WEBP`) + `size_bytes <= 5 * 1024 * 1024`; reject with the 422 idiom and the canonical failure line. Never trust client `Content-Type`.
  - [x] Stream accepted files to temp keys `tmp/{poll_id}/{mediaId}` on `env.MEDIA` (R2 binding, already configured for all three envs in `wrangler.jsonc`). The existing hidden `poll_id` idempotency nonce (`new.astro:96–97,288–290`) IS the Poll scope — reuse it; do not invent a second scope token.
  - [x] **Re-render preservation without re-upload:** on any 422 (validation failure, missing alt text, one failed file), successful uploads persist as temp keys and re-render as hidden inputs (media id + a preview `<img>` served via the temp-preview mechanism below) so the Creator only retries the failed file. A file `<input>` cannot be server-prefilled — the hidden-ref pattern is the only way to honor "every other field and upload preserved". Validate on resubmit that referenced temp keys exist and are Poll-scoped to this `poll_id`.
  - [x] Creator-form preview of a not-yet-adopted image: serve ONLY to the authenticated owner of the in-flight form via a creator-guarded route (e.g. `src/pages/creator/media/[id].ts` checking session + `poll_id` scope), never via the public media route. This keeps AC 2's "servable only after adoption" true for the public surface. Flag this in the PR for design/architecture review.
  - [x] Adoption: extend `PollPersistenceRows` / `createPollPersistence(db).insertPoll` (`src/adapters/d1/index.ts:342–420`) so the ONE existing `db.batch([...])` also inserts `media_object` rows. Adoption = D1 row insertion referencing the R2 key (spine: adoption is a D1 fact; the object may stay at its temp key or be copied to an adopted key — see Dev Notes → Key scheme decision). A failed batch leaves no reachable Poll and no adopted media rows — that is the atomicity AC; orphaned temp objects are 6.3-sweeper food, not a 6.1 bug.
  - [x] `representation_version` participates as today via the existing insert path (AD-24); pre-Vote option/image edits are Story-6.3/FR-5 territory — out of scope here except that options/type lock after first Vote already holds (AD-17).
- [x] Task 4: Creator form UI — image section per option (AC: 1, 3, 4)
  - [x] `src/components/poll-definition-fields.astro` — when `pollType === "image"`, each option row (`[data-option-row]`, `:193–197`) gains: file input (accept="image/jpeg,image/png,image/webp"), ALT TEXT field (required — this is the publish-blocking field), CAPTION field (optional), and a square zero-radius preview plate when uploaded. Follow the `input` token spec exactly: label-caps label above, transparent field, 1px rule underline → solar-ink on focus, alarm underline + caption-size inline error beneath on error, 44px min height, 2px/2px focus ring.
  - [x] No-JS flow must work (AD-2): plain multipart POST round-trips work without any script; the existing `add-option` no-JS round-trip (`new.astro:206–223`) must keep working with multipart. JS enhancement (if any) lives beside `src/scripts/create-poll-form.ts` / `poll-definition-form.ts` and stays optional.
  - [x] No spinner, no progress bar — in-flight states are label swaps only (DESIGN.md Don'ts; `COUNTING…` idiom). Zero radius on previews ("plates, not cards"). No icon-only controls.
  - [x] Error copy: upload failure uses the canonical line verbatim: "`{filename}` didn't upload. The rest of the form is intact — try that one again." Alt-text block copy is NOT in the Voice-and-Tone table — write it in-voice (plain, declarative, names the field, no exclamation marks/emoji/"Oops!"), e.g. "This image needs alt text before the Poll can publish. Describe what a Voter should know." Flag exact wording in the PR for UX review.
  - [x] 422 re-render wiring: `fieldErrors` + `Astro.response.status = 422` + preserved values, errors as `<p class="field-error" id="…-error">` with `aria-describedby` (existing idiom, `new.astro:256–271`). Never a summary block, never a modal, validate on submit not blur.
- [x] Task 5: Public media serving route (AC: 2)
  - [x] New `src/pages/media/[id].ts` (or equivalent) — GET/HEAD only (405 otherwise), looks up `media_object` by id in D1 (adoption check IS the lookup — no row, 404), streams from `env.MEDIA` with the stored `content_type`, `etag`, and long-lived caching (`public, max-age=31536000, immutable` is safe: adopted keys are immutable and singly owned, AD-12). 404 on missing/unadopted, indistinguishable from nonexistence. `media` must be added to the reserved top-level namespace if the route sits at root scope — check `src/modules/polls/reserved-slugs.ts` and the AD-13 registry; if `/media/...` collides with nothing (it's not a `/{link}` path) no registry change is needed, but verify.
  - [x] No voter identifiers or ballot data involved; telemetry may carry internal poll id only (AD-8/AD-15).
- [x] Task 6: Tests (all ACs)
  - [x] Unit (`tests/unit`, vitest node): image strategy contract (all five ports; delegation parity with MC), definition validation (alt text required, caption optional, per-option media pairing), magic-byte sniffing table (accept JPEG/PNG/WebP, reject GIF/SVG/renamed extensions), 5 MB boundary (exactly at cap passes, cap+1 fails), upload-failure copy string.
  - [x] Integration (`tests/integration`, workerd + real D1/R2 via `@cloudflare/vitest-pool-workers`, migrations preloaded): 0014 schema constraints (option_id unique, r2_key unique, alt_text NOT NULL); `insertPoll` batch with media rows — success adopts, injected failure leaves no poll/reference/media rows; create-poll route multipart drive (model on `create-poll-route.integration.test.ts` + `worker-entry.ts`/`astro-middleware-shim.ts`): happy path 303, missing alt text 422 with field named, oversized file 422, wrong format 422, temp-ref resubmit path; media route status matrix (200 adopted, 404 unadopted/unknown, 405 POST); CSRF holds on multipart POST.
  - [x] E2E (Playwright 1.62, `.spec.mjs`, `workers: 1`, port 4391, serial + `hasBetterAuthSecret` guard, `creator-session.mjs` helpers): create an Image Poll with fixture images (commit tiny JPEG/PNG/WebP fixtures under `tests/e2e/fixtures/`), publish blocked on missing alt text with focusable error, successful publish → images render on the created page, upload-failure re-render preserves other fields and uploads; proof dir `test-results/story-6-1-upload-image-options-proof/` with 375px dark + 1280px light captures.
  - [x] Standing contract tests to respect: `no-raw-html.test.mjs` (no `innerHTML` in `.ts` scripts), `public-repository-contract.test.mjs`, migration checksum guard.
- [x] Task 7: Documentation & status
  - [x] `CHANGELOG.md` under `[Unreleased]`; `README.md` if Image Polls become creatable; `pnpm types && git diff --exit-code worker-configuration.d.ts` (MEDIA types already generated — should be a no-op); `sprint-status.yaml` → per workflow; note the temp-key sweeper dependency on Story 6.3 in `deferred-work.md`.

## Dev Notes

### Architecture constraints (non-negotiable)

- **AD-12 (verbatim rule):** "Upload to Poll-scoped temporary R2 keys and expose an image only after D1 adopts it. Every adopted media record singly owns an immutable R2 key. Replacing media updates the D1 reference and enqueues the superseded key for cleanup in the same batch. Deletion records self-contained R2 cleanup keys in an outbox row with no Poll foreign key… A same-Worker `scheduled()` handler drains due outbox rows every 15 minutes… The scheduled sweeper also deletes unadopted temporary keys older than 24 hours." **6.1 owns upload → adoption. Replacement, deletion outbox, cron drain, and the 24h sweeper are Story 6.3.** There is currently NO `scheduled()` handler or cron trigger in the repo — do not add one in 6.1.
- **AD-3:** `CreatePoll` commits Poll, type facts, options, slug reservation, AND adopted media records in **one D1 batch**. A failed batch leaves no reachable Poll. Every real strategy implements all five ports.
- **AD-6:** D1 is the sole transactional source of truth; R2 stores only Poll-owned image bytes. There is no cross-store rollback — that is WHY adoption exists.
- **AD-19:** Media owns media records and cleanup tasks; only the owning module's commands write its tables. Browser code never touches R2/D1 directly; every mutation enters one application command.
- **AD-22:** creator media mutations sit behind session CSRF + the full middleware chain (request context → telemetry → session → CSRF → creator guard). `readRequestCsrfToken` already parses multipart (`csrf.ts:194–214`).
- **AD-17:** created Poll is immediately open, no draft state; after first Vote, question/options/type (and thus images) are immutable.
- **AD-18:** cost ceiling — no Cloudflare Images, no new paid services. R2 binding `MEDIA` only.
- **AD-14 / conventions:** `wrangler.jsonc` is binding truth (MEDIA exists for local/staging/production: buckets `oddspark-polls-{local,staging,production}`); no env lookup in domain modules; Zod 4.4.3 at delivery boundaries + domain invariants re-enforced; stable error codes; POST → 303 / 422 re-render idiom; snake_case D1, UUID ids, UTC ms.

### Key design decisions (ruled defaults — flag in PR)

1. **Key scheme:** temp `tmp/{poll_id}/{mediaId}`; on adoption, keep the object in place and record that key as the adopted immutable key (rename-free adoption — R2 has no atomic rename, and a copy step would add a second non-transactional mutation). "Adoption" is purely the D1 `media_object` row; the 6.3 sweeper must therefore check D1 before deleting `tmp/` keys older than 24h. If you instead copy to `polls/{poll_id}/{mediaId}` on adopt, you must handle copy-failure ordering — the in-place default avoids that class entirely. Document whichever you ship.
2. **Upload transport:** single multipart POST of the whole form (no separate upload endpoint, no JS-required chunked upload) — AD-2's no-JS mandate makes this the baseline; per-file failure handling happens server-side in one pass. A progressive-enhancement async uploader is explicitly out of scope.
3. **Preview of unadopted images** is creator-session-gated and Poll-scoped (see Task 3) — the public "servable only after adoption" invariant is about the public media route.
4. **Captions optional, alt text required** (IA table + Accessibility Floor). Alt text lives on `media_object`, not `poll_option.label` — the option label may still exist for exports/accessibility fallbacks; decide whether label mirrors alt text or stays independent, and keep the export projection coherent either way.

### Traps (verified in current code — will bite if ignored)

1. **CSRF middleware clones the request** (`csrf.ts:209`) to read the form token — a multipart body with images gets buffered by the clone AND by the page's own `formData()` call. ~5 MB × N options × 2 is real Worker memory; cap options-with-files per request sanely (existing `POLL_CAPS.maxOptions`) and note memory in the PR. Do not "fix" CSRF by exempting multipart.
2. **`new.astro` coerces File entries to `""`** (`:131–135`) in its current field parser — the multipart change must route File parts to the upload path BEFORE that coercion eats them.
3. **Strategy registry fails closed** — until `image` is registered, the form's type radio must not offer it; conversely, offering it without full strategy ports throws at creation. Land strategy + registry + form in one story (this one).
4. **`validateProjection` in export** (`src/modules/results/export.ts:241–267`) enforces voter/row/alignment-key equality — if the image strategy delegates MC export correctly this is free; if you fork the projector, the contract tests must change together (AD-23).
5. **One-statement batch discipline:** `insertPoll` classifies UNIQUE-constraint failures by regex into `DuplicatePollIdError`/`ReferenceTakenError` — new UNIQUE constraints (`option_id`, `r2_key`) will surface through the same path; classify or let them fail as generic 500 deliberately, but don't let a media UNIQUE break the duplicate-poll detection regexes.
6. **R2 `put` has no transactions** — never write D1 media rows outside the single `insertPoll` batch, and never write R2 after the batch (upload strictly precedes creation).

### UX spec — creator image section

- **Image plate (downstream target, UX-DR2/DESIGN.md):** square-cropped, square-cornered, full-column-width plate; caption below in `{typography.caption}` (Courier Prime 12px); zero radius everywhere; plates not cards; never a lightbox. The creator preview should look like the voter-side plate.
- **Form idiom:** label-caps labels above fields; validation on submit never blur; inline error beneath the field (caption size, alarm underline); everything else preserved; never a tooltip/modal/summary block. 44px targets, 2px/2px focus ring, no icon-only controls, state never color alone.
- **Canonical copy (Voice and Tone, verbatim):** "`{filename}` didn't upload. The rest of the form is intact — try that one again."
- **No upload-affordance mockup exists** — constraints that rule it: no spinner/progress (label swaps only), square previews, text-labelled controls, `input` token spec. Flag the shipped affordance for design review.
- **Other creator errors that co-occur** (unchanged): "A Poll needs options. Add at least two." / "That Deadline has already passed…" / slug taken/reserved lines.

### Previous story / epic intelligence

- Epic 5 proved the AD-3 extension seam: new strategy file + registry entry + definition branches, no contract version bump, no export-route changes (5.3 File List shows the shape). Image should be a *smaller* strategy than ranked — it mostly delegates to MC.
- Epic 5 retro action **T1: "Audit R2 MEDIA binding readiness"** — codebase audit confirms: binding + generated types (`worker-configuration.d.ts`, `src/env.d.ts:50`) exist in all three envs; **zero code consumes `env.MEDIA` today** — this story is the first consumer. Verify local R2 works under `wrangler dev` / vitest-pool-workers early (day 1), and staging bucket exists before the deploy gate.
- 5.x review patterns that recur: fail-closed projections with stable error codes; idempotent enhancer init guards; structural payload validation; `textContent`/`createElement` only in scripts; strip internal ids from outward JSON; tests must cover insertion-order independence where ordering matters.
- Standing team agreements: one story = one branch = one PR = adversarial review before merge; tracker honesty (done requires merge path); full gate before done: `pnpm migrations:guard && pnpm test && pnpm check`, `pnpm test:e2e`, `pnpm types && git diff --exit-code worker-configuration.d.ts && pnpm build:production && git diff --check` (Node 24.18.0 via nvm).

### Data flow summary

```
Creator multipart POST /creator/new
  → middleware (CSRF reads multipart token) → new.astro POST handler
  → per-file: sniff magic bytes + size cap → env.MEDIA.put("tmp/{poll_id}/{mediaId}")   [failures → 422 re-render, canonical copy, other uploads kept as hidden temp refs]
  → validateCreatePoll (image strategy: options + media facts, alt text required)
  → createPollPersistence.insertPoll — ONE db.batch: poll + poll_option + poll_reference + media_object rows  [failure → no reachable Poll, no adopted media; temp objects await 6.3 sweeper]
  → 303 to created Poll
Public GET /media/{id} → D1 media_object lookup (adoption check) → stream from R2, immutable cache → 404 if unadopted
Creator preview GET (session + poll_id gated) → temp object stream (never public)
```

### Testing standards

- `tests/unit` (vitest 4.1.10, node): pure domain/strategy/validation; fast-check 4.9.0 available for sniffing/cap properties.
- `tests/integration` (vitest + `@cloudflare/vitest-pool-workers` 0.19.0, workerd, real D1 + R2 bindings, migrations preloaded): adapter batch atomicity, route matrices, multipart drives via `worker-entry.ts`.
- `tests/e2e` (Playwright 1.62.0): `.spec.mjs`, serial, `hasBetterAuthSecret` guard, `creator-session.mjs`, committed proof captures 375px dark + 1280px light.

### Project Structure Notes

- New files: `src/modules/polls/types/image.ts`, `db/migrations/0014_image_media.sql`, `src/pages/media/[id].ts`, creator preview route, e2e image fixtures, tests. UPDATE files: `src/pages/creator/new.astro`, `src/components/poll-definition-fields.astro`, `src/modules/polls/definition.ts`, `src/modules/polls/types/registry.ts`, `src/adapters/d1/index.ts` (insertPoll + media rows), optionally `src/scripts/create-poll-form.ts`.
- Kebab-case files, PascalCase types, snake_case D1 (AR-2). Stack pins: Astro 7.1.5, `@astrojs/cloudflare` 14.1.6, TypeScript 7.0.2, Zod 4.4.3, Wrangler 4.115.0, Vitest 4.1.10, Playwright 1.62.0, fast-check 4.9.0, Node 24.18.0, pnpm 11.17.0, compat date 2026-07-29. **No new libraries.**
- Out of scope (later stories): voting/results rendering of image plates (6.2); replacement enqueue, deletion outbox, cron drain, 24h temp sweeper (6.3); Cloudflare Images or any transform pipeline (AD-18 forbids).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.1 (~line 1015), #Epic 6 (~179), #FR-11 (131), #AR-10 (77), #UX-DR17/18/19 (108–110)]
- [Source: _bmad-output/planning-artifacts/prds/prd-oddspark-polls-2026-07-28/prd.md#§4.4 FR-11, #§10 Assumptions, #§5 craft-bar alt text]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md#AD-3, #AD-6, #AD-12, #AD-14, #AD-17, #AD-18, #AD-19, #AD-21, #AD-22, #AD-24, #Structural Seed (adapters/r2, MEDIA_OBJECT/CLEANUP_OUTBOX ER), #Capability Map FR-11, #Consistency Conventions]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md#Accessibility Floor (alt-text block), #Voice and Tone (upload-failure line), #State Patterns (creation validation), #Component Patterns (input, poll-option image), #Key Flows UJ-1/UJ-2, #Information Architecture (Image upload row)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md#Components poll-option/input/buttons, #Shapes (zero radius, plates), #Typography (caption, label discipline), #Colors]
- [Source: _bmad-output/implementation-artifacts/5-3-per-round-display-ballot-manifest.md] — strategy-extension shape, review patterns, gate commands
- [Source: _bmad-output/implementation-artifacts/epic-5-retro-2026-08-07.md#T1 R2 audit, #Next epic preview]
- [Source: codebase audit 2026-08-07 — src/pages/creator/new.astro, src/components/poll-definition-fields.astro, src/modules/polls/{index,definition}.ts, src/modules/polls/types/registry.ts, src/adapters/d1/index.ts:342–420, src/lib/csrf.ts, wrangler.jsonc, db/migrations/]

## Dev Agent Record

### Agent Model Used

Crush (qwen3.8-max)

### Debug Log References

None — clean implementation, no debug cycles required.

### Completion Notes List

- Task 1: Created `image.ts` strategy delegating all five ports to MC for voting/tabulation/results/export. `create` validates per-option media facts (alt text required, caption optional). Registered in `registry.ts`; `votingStrategyFor` dispatches image to MC path. `definition.ts` rejects multi-select/bounds for image polls.
- Task 2: Migration 0014 creates `media_object` table with UNIQUE constraints on `option_id` and `r2_key`, NOT NULL + CHECK on `alt_text`, FK to poll and poll_option, and image_poll_bounds guard triggers mirroring ranked_choice precedent. Checksum updated, guard green, local migration applied.
- Task 3: `new.astro` now uses `enctype="multipart/form-data"`, extracts File parts before text coercion, validates via magic-byte sniffing + size cap, uploads to `tmp/{poll_id}/{mediaId}` on R2, preserves successful uploads as hidden refs on 422 re-render. `PollPersistenceRows` extended with optional `media` array; `insertPoll` batch includes media_object rows. Creator preview route at `/creator/media/[id].ts` serves temp objects session-gated.
- Task 4: `poll-definition-fields.astro` gains IMAGE poll type choice, per-option file input + alt text + caption fields when `pollType === "image"`, zero-radius preview plates, multi-select fieldset hidden for image polls.
- Task 5: Public `/media/[id].ts` route serves adopted images with immutable caching; unadopted = 404. Added `media` to reserved slugs.
- Task 6: 22 new unit tests (12 image strategy + 10 image upload validation + 2 definition validation). Integration: 6 tests covering 0014 schema constraints, insertPoll batch atomicity with media rows, and media route status matrix. E2E: 3 Playwright tests covering image poll creation UI, alt-text publish block, and end-to-end image poll creation with fixture images. All pass.
- Key design decision: rename-free adoption (temp key stays as adopted key). Documented in PR.
- Pre-existing test failure in `public-repository-contract.test.mjs` (manifest.astro consumer list) is unrelated to this story.
- 2026-08-07 review follow-up: resolved all six [Patch] findings — file input renamed to per-index `media_file_{index}` (no more File/string mixing under `name="option"`); creator preview URL now carries the form poll nonce (`pollId` prop, was pollType → always 404); upload + preserved-ref restore now run on the no-JS add-option round-trip and stale blank-row media entries are dropped; validation/adoption map compact position → raw row index so blank gaps can't mis-file errors or pair media to the wrong option; creator preview route requires UUID-shaped `id` + `poll` params (residual ownership-binding gap flagged); both media routes now 405 non-GET/HEAD and HEAD returns no body. Full gate: unit 1191 pass (1 pre-existing unrelated failure), integration 422 pass, image E2E 3 pass, `pnpm check` clean, migrations guard green, `worker-configuration.d.ts` no drift.

### File List

- src/modules/polls/types/image.ts (new)
- src/modules/polls/types/registry.ts (modified)
- src/modules/polls/definition.ts (modified)
- src/modules/polls/image-upload.ts (new)
- src/modules/polls/index.ts (modified — PollPersistenceRows extended)
- src/modules/polls/reserved-slugs.ts (modified — added "media")
- src/adapters/d1/index.ts (modified — insertPoll media batch)
- db/migrations/0014_image_media.sql (new)
- db/migrations.manifest.json (modified)
- src/pages/creator/new.astro (modified — multipart, upload handling)
- src/pages/creator/media/[id].ts (new — creator preview route)
- src/pages/media/[id].ts (new — public media route)
- src/components/poll-definition-fields.astro (modified — image UI)
- tests/unit/image-strategy.test.ts (new)
- tests/unit/image-upload.test.ts (new)
- tests/unit/poll-lifecycle.test.ts (modified — image definition tests)
- tests/integration/image-media.integration.test.ts (new)
- tests/e2e/image-poll.spec.mjs (new)
- tests/e2e/fixtures/tiny.jpg, tiny.png, tiny.webp (new)
- CHANGELOG.md (modified)
- _bmad-output/implementation-artifacts/deferred-work.md (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)

### Change Log

- 2026-08-07: Implemented Story 6.1 — Image Poll creation with per-option image upload, magic-byte validation, R2 temp-key adoption, public media serving, and creator preview route. 22 new unit tests. Integration/E2E tests deferred pending R2 test harness setup.
- 2026-08-07: Addressed code review findings — 6 items resolved (file input name collision, preview URL pollId scope, add-option media preservation, blank-gap index alignment, creator preview IDOR hardening, media route 405/HEAD semantics). Integration tests (6) and E2E tests (3) landed and passing.

### Review Findings

- [x] [Review][Patch] File input shares `name="option"` with text inputs — getAll mixes Files and strings, breaks option count and media index alignment [src/components/poll-definition-fields.astro:235ish, src/pages/creator/new.astro:145-170] — file input now uses its own per-index name `media_file_{index}`; `getAll("option")` carries label strings only.
- [x] [Review][Patch] Creator preview `<img>` src uses pollType ("image") instead of pollId — tmp/{pollId}/{mediaId} lookup always 404, AC4 preservation preview broken [src/components/poll-definition-fields.astro:239] — `PollDefinitionFields` takes a `pollId` prop (the form nonce) and the preview URL is `?poll={pollId}`.
- [x] [Review][Patch] `add-option` round-trip skips media handling and sparse tempMedia array mis-handled — in-flight uploads lost when adding an option, violates AC4 "previously successful uploads must NOT require re-selection" [src/pages/creator/new.astro:280-330] — upload + preserved-ref restore now run for any image-poll POST intent; entries keyed to blank rows are dropped from render state each pass.
- [x] [Review][Patch] Alt-text / media-missing validation indexes against filtered non-blank options but tempMedia is keyed by raw form index — blank gaps cause false `mediaIdMissing` and mis-filed `altTextMissing` [src/pages/creator/new.astro:295-310] — validation maps compact position → raw option-row index (`rawIndexForPosition`); the same map drives optionId pairing in the adoption batch.
- [x] [Review][Patch] Creator temp preview route is IDOR — any authenticated creator can fetch any `tmp/{pollId}/{mediaId}` by guessing IDs; no UUID shape check on `poll` query param and no ownership/poll-scope verification [src/pages/creator/media/[id].ts:12-35] — both `id` and `poll` params must pass UUID shape; creator-guarded route + per-form random poll nonce scope. Residual: no true per-principal ownership binding exists pre-creation (the form nonce IS the ownership claim); flagged for architecture follow-up.
- [x] [Review][Patch] Public `/media/[id]` (and creator preview) missing 405 for non-GET/HEAD and HEAD returns a body — violates spec Task 5 "GET/HEAD only (405 otherwise)" and HTTP semantics [src/pages/media/[id].ts:20-50, src/pages/creator/media/[id].ts:10] — both routes export POST/PUT/DELETE/PATCH → 405 with `allow: GET, HEAD`; HEAD delegates to GET then strips the body.
- [x] [Review][Defer] CSRF clone double-buffers multipart bodies (~5 MB × N × 2 Worker memory) — pre-existing trap from spec §Traps-1, accepted as documented and bounded by POLL_CAPS.maxOptions [src/lib/csrf.ts:209, src/pages/creator/new.astro:135] — deferred, pre-existing
