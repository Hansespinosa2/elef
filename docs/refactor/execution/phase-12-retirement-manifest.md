# Phase 12 retirement manifest (P12-12)

Removed during Phase 12 DO (committed, verified by the phase battery):

| Item | Commit | Verification |
|---|---|---|
| `scripts/elef-agent` (dead retired workflow) | DO-2 | Zero references remain (`grep elef-agent` over `.github/`, durable docs, `AGENTS.md` → ∅); CI YAML valid |
| `apps/web/test/scripts/elef-agent_test.sh` + its CI line | DO-2 | Test's only subject is gone; remaining launcher tests untouched |
| `RANGE_WRAPPER_ALLOW` (dead R8 exception) | DO-2 | `check_boundaries.py` + `--self-test` green; canary still rejects R8 (strictness unchanged) |
| Campaign-router `AGENTS.md` | DO-4 | Rewritten as the steady-state short router (30 lines) |

Marked for deletion together with `docs/refactor/` after final technical PASS
(deletion itself is post-campaign; P12-08 proves the tree builds/tests green
without the marked tree):

| Item | Disposition | Steady-state successor |
|---|---|---|
| `docs/refactor/` (constitution, phases, plans, status, reviews, evidence, exercises, baseline, deferred-reconciliation note) | Delete whole tree | Durable docs already carry every durable rule (P12-06 audit) |
| `.agents/skills/elef-campaign/` | Delete | None (campaign driver) |
| `.agents/skills/independent-phase-review/` | Delete | None (campaign reviewer) |
| Campaign sections of `code-change-verification`, `docs-sync`, `implementation-strategy` | Repoint at durable docs per the docs-sync SSOT table; delete campaign-only paragraphs | The skills' steady-state cores (tier choice, SSOT sync, ownership classification) |
| `bin/check` phase 0–12 gate functions (`check_phase*`, `run_phase*`, `PHASE*_PATH`, snapshots) | Delete campaign audit code | Steady-state tiers: `quick`, `affected`, `all`, `arch`, `fresh` (+ honest `docs`/`perf` stubs) |
| `docs/refactor/deferred-dev-reconciliation.md` | Delete with the tree | The dev port-then-merge plan lives with the owner-led integration (post-campaign) |

Post-campaign deletion procedure (owner or follow-up, after the final PASS
checkpoint exists): `rm -rf docs/refactor/`, remove the two campaign skills,
repoint the three retained skills, delete the phase-gate functions from
`bin/check`, then `bin/check all` green on the result (the P12-08 proof ran
exactly this shape in a throwaway checkout).
