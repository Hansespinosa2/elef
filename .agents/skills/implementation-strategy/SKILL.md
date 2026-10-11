---
name: implementation-strategy
description: Use before any nontrivial architecture, runtime, contract, persistence, package, or shared-product-behavior change. Classifies the semantic owner and fixes scope, deletions, rollback triggers and proof commands.
---

# Implementation strategy

Decide from repository authority, not memory. Sources, in authority order: `ELEF-DOCTRINE.md` (intent) → `docs/architecture.md` (boundaries/ownership/dependency direction, contract law, package rules) → `docs/development.md` and `docs/desktop/**` (workflow, runbooks) → current code (evidence of reality).

## Steps

1. **Verify facts first.** Every assumption the change relies on gets file/command evidence from the current tree (paths, entry points, tests, CI jobs, consumers). Unknowns become explicit open questions or blockers, never guesses.
2. **Classify each change** by semantic owner using `docs/architecture.md`: `spec`, `contracts`, `work-model`, `renderer`, `client` (`application/`, `features/`, `session/`, `ui/`), `local-store`, web host, desktop host, `ops`, `tooling`. Mark each as *shared* (one implementation, inherited by both hosts) or *host-specific* (justify with a concrete platform/capability difference).
3. **Package test.** Before creating any package/crate/top-level directory, apply the package-admission rules in `docs/architecture.md` item by item, in writing. Size, importance, symmetry or hypothetical reuse are not drivers. Default: a module inside its semantic owner.
4. **Preserve behavior.** List the user-visible behavior that must not change, and the exact existing tests/scenarios/fixtures that prove it. A behavior change is allowed only if the change request names it.
5. **Scope the moves.** Separate structural moves from behavior changes (separate commits). Name every deletion and every temporary compatibility path with owner, reason and deletion condition.
6. **Risks and rollback.** Concrete rollback triggers (e.g. a data-safety test fails, perf probe >10% regression, contract conformance diverges between adapters) and the rollback reference (last green sha).
7. **Proof.** Map every requirement to the command/test/review checklist that will prove it, and the tier (`quick`/`affected`/`all`/CI/human gate). Name fixed fixture sets for any visual/subjective check.

## Output

A short owner/scope/proof note in the commit message or PR description is enough; update durable docs only if an enduring rule changes (`$docs-sync`).

## Stop conditions

- Two rules conflict and cannot be reconciled → surface to the owner as a blocker; do not reinterpret rules to fit.
- Never grow architecture allowlists, weaken tests/baselines, or move frozen boundaries to make a plan work.
