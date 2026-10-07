# Elef Autonomous Refactor v9

This bundle is the complete source set for the autonomous Elef refactor campaign and its repository-native agent bootstrap.

## What is authoritative

- `docs/refactor/CONSTITUTION.md` — lean campaign-wide authority and architecture freeze.
- `docs/refactor/phases/*.md` — phase-specific executable contracts.
- `docs/refactor/status.template.json` — resumable machine-state template.

## Bootstrap material

- `bootstrap/AUTONOMOUS-AGENT-BOOTSTRAP-PROMPT.md` — give this once to a capable coding agent after placing the bundle in the repository.
- `bootstrap/templates/AGENTS.md` and `bootstrap/templates/skills/*` — reference implementations for the bootstrap agent to reconcile/install, not parallel sources of architectural truth.

The bootstrap agent should install skills under `.agents/skills/`, reconcile root `AGENTS.md`, validate that a fresh agent can respond correctly to `go`, commit the agent-system bootstrap separately, then continue the campaign.

## Normal owner interaction after bootstrap

`go`

The repository state, not chat history, must be sufficient to resume.

## Execution environment

The intended autonomous implementation machine is a Linux container with approximately 8 GB RAM. The constitution distinguishes warm fast-feedback budgets from cold bootstrap cost and from user-facing product-performance budgets. macOS/signing/owner-device checks remain explicit release gates rather than simulated PASSes.
