# Deferred Work

## Deferred from: code review of 1-1-project-foundation-deployable-skeleton (2026-07-29)

- Playwright e2e not in CI gate — spec gate requires unit+integration only; add when the e2e suite grows.
- Overlay primitive never demonstrated (rendered `open={false}`) — accepted deviation: overlay exists token-bound and opens in later stories; AD-2 forbids the client JS an open demo would need.
- Mode-toggle label goes stale on OS theme change — no `matchMedia("prefers-color-scheme")` change listener [src/scripts/mode-override.ts:52-69].
- `…Light` exception tokens `availability-yes-glyph-light` / `solar-ink-on-wash-light` defined but unconsumed — canonical DESIGN.md tokens consumed by Epic 7 availability-cell [src/styles/tokens.css:41,48-50].
- Structural Seed deviation — `src/lib/`, `src/layouts/`, `src/styles/` not in the seed tree; update ARCHITECTURE-SPINE seed to match the real layout.
- poll-option uses a real `<span>` marker instead of decorative `::before` on the row — visually equivalent [src/components/poll-option.astro].
- results-bar `NaN`/`Infinity` percent unhandled — clamp gives false input-safety; latent until live data arrives [src/components/results-bar.astro:23].

## Deferred from: code review round 2 of 1-1-project-foundation-deployable-skeleton (2026-07-29)

- **Story 1.2 WIP scope** (found in the working tree during re-review; belongs to the active 1.2 session): telemetry middleware is innermost, so creator-guard 303s and session-middleware throws emit no record and carry no `x-request-id`; session middleware has no auth-lookup failure path and drops rotated session cookies on error responses; possible duplicate `set-cookie` on `/api/auth/*` responses; `/admin` counts as a CSRF authenticated-mutation surface but is not covered by the creator guard; `readRequestCsrfToken` buffers entire multipart bodies to read one field; session CSRF token compared with `!==` (non-constant-time) [src/middleware.ts, src/lib/csrf.ts].
- `.astro` files have no type coverage — `check` runs `tsc --noEmit`, which skips `.astro`; restore `astro check` when `@astrojs/check` supports the pinned TS 7 stack.
- `parseJsonc` doesn't handle block comments or BOM — wrangler's own JSONC parser accepts `/* */`; a future block comment in `wrangler.jsonc` fails with an opaque error [scripts/deploy.mjs].
