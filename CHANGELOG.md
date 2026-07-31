# Changelog

All notable changes to oddspark-polls are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Add user-facing changes under `## [Unreleased]` as you go. The release process promotes that
block to a versioned, dated section — never edit a released section retroactively.

## [Unreleased]

Nothing has been released yet. Everything below has landed on `main` and ships to staging and
production on every merge, but no version has been cut or tagged.

### Added

- Deployable Astro 7 skeleton on Cloudflare Workers with D1, R2, and KV session bindings
  across three environments (local, staging, production).
- Creator sign-in with Google or GitHub via Better Auth, including a creator-surface
  authentication guard that redirects signed-out visitors to `/sign-in` with their return
  address preserved.
- Session-expiry awareness: a returning creator whose session has lapsed is told so, rather
  than being silently treated as a first-time visitor.
- CSRF and same-origin boundary on all state-changing requests, with session-derived token
  verification on authenticated creator and admin mutations.
- Request-scoped telemetry emitting one record per request, with an `x-request-id` header on
  every response so a user can quote it in a report.
- Design-token stylesheet derived from DESIGN.md, with OS-preference light/dark mode and a
  progressive-enhancement toggle that persists the override.
- Six-step deploy gate (tests → build → staging migrate → staging deploy → staging smoke →
  production migrate → production deploy) in GitHub Actions.
- Forward-only D1 migrations with a checksum manifest and a CI guard that rejects edits to
  committed migrations or out-of-order numbering.
- Masked secret-provisioning helper for Better Auth and OAuth credentials that keeps values
  out of command arguments, shell history, and Wrangler logs.
- Multiple-choice poll creation at `/creator/new`: question, two to thirty options, a
  results-visibility setting, and an optional deadline interpreted in the creator's local
  timezone — fully usable without JavaScript.
- Optional Custom Links at poll creation, with normalized root-path URLs, shared
  application-route reservations, collision-safe inline errors, and no second random URL.
- Create-confirmation page showing the poll's canonical link and, when a deadline was set,
  the resolved closing time in UTC.
- Public poll page at the root path (`/{reference}`) rendering the question and options
  server-side; unknown or application-reserved references return a plain 404.
- Case variants of a Custom Link (e.g. `/Team-Lunch`) permanently redirect to the canonical
  lowercase URL; generated random links remain case-sensitive.
- `AGENTS.md` — project instructions for Claude Code and other coding agents.
