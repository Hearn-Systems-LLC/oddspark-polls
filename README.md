# oddspark-polls

A free, full-featured polling app — StrawPoll's paid-tier feature set with no paywall.

- **Deploy target:** Cloudflare, at `polls.oddspark.dev`
- **Build method:** [BMad Method](https://bmadcode.com/) v6.10.0, with the
  [bmad-loop](https://github.com/bmad-code-org/bmad-loop) orchestrator driving the
  implementation phase.

The product scope, architecture, and stack are defined by the BMad planning
artifacts under `_bmad-output/`, not by this README. Nothing here is
implementation yet.

## Workflow status

| Phase | Step | Skill | Status |
|---|---|---|---|
| 1 — Analysis | Product Brief | `bmad-product-brief` | next |
| 2 — Planning | PRD (required) | `bmad-prd` | |
| 2 — Planning | UX | `bmad-ux` | |
| 3 — Solutioning | Architecture (required) | `bmad-architecture` | |
| 3 — Solutioning | Epics & Stories (required) | `bmad-create-epics-and-stories` | |
| 3 — Solutioning | Readiness check (required) | `bmad-check-implementation-readiness` | |
| 4 — Implementation | Sprint planning (required) | `bmad-sprint-planning` | |
| 4 — Implementation | Autonomous build | `bmad-loop run` | |

Run each planning step in a fresh context window.

## bmad-loop

The orchestrator is configured and preflighted. It drives **claude** for the dev
pass and **codex** for the independent review pass (`.bmad-loop/policy.toml`,
gitignored — machine-specific).

```bash
bmad-loop validate --project .    # preflight
bmad-loop run --dry-run           # print the plan, spawn nothing
bmad-loop run                     # execute the sprint queue
bmad-loop tui                     # dashboard
```

`bmad-loop run` requires `_bmad-output/implementation-artifacts/sprint-status.yaml`,
which `bmad-sprint-planning` produces. Until then there is no story queue to run.

### One-time, per machine

Spawned sessions cannot answer first-run dialogs, so accept them by hand once:

- `claude` — launch once in this directory, accept workspace trust + hooks approval.
- `codex` — launch once in this directory, accept workspace trust, then
  "Hooks need review" → **Trust all and continue**. Untrusted hooks silently never fire.
