---
name: implementation-strategy
description: Use before starting each Elef refactor phase (to write and freeze docs/refactor/execution/phase-N-plan.md) and before any nontrivial architecture, runtime, contract, persistence, package, or shared-product-behavior change. Classifies the semantic owner and fixes scope, deletions, rollback triggers and proof commands.
---

# Implementation strategy

Decide from repository authority, not memory. Sources, in authority order: `docs/refactor/CONSTITUTION.md` (§2 intent, §3 doctrine + package-admission law, §4 boundaries/ownership/dependency direction, §5 contract law, §6 build/perf, §7 validation + permanent invariants) → the active phase contract → durable docs (`ELEF-DOCTRINE.md`, `docs/architecture.md`, `docs/development.md`, `docs/desktop/**`) → current code (evidence of reality, not authority).

## Steps

1. **Verify facts first.** Every assumption the phase relies on gets file/command evidence from the current tree (paths, entry points, tests, CI jobs, consumers). Unknowns become explicit open questions or blockers, never guesses.
2. **Classify each change** by semantic owner using constitution §4: `spec`, `contracts`, `work-model`, `renderer`, `client` (`application/`, `features/`, `session/`, `ui/`), `local-store`, web host, desktop host, `ops`, `tooling`. Mark each as *shared* (one implementation, inherited by both hosts) or *host-specific* (justify with a concrete platform/capability difference). Use the state-ownership list in §5 for mutable state.
3. **Package test.** Before creating any package/crate/top-level directory, apply the package-admission law (§3) item by item, in writing. Size, importance, symmetry or hypothetical reuse are not drivers. Default: a module inside its semantic owner. Export and graph are not packages by default (§4).
4. **Preserve behavior.** List the user-visible behavior that must not change, and the exact existing tests/scenarios/fixtures that prove it. A behavior change is allowed only if the phase contract names it.
5. **Scope the moves.** Separate structural moves from behavior changes (separate commits). Name every deletion and every temporary compatibility path with owner, reason and deletion condition (invariant 13).
6. **Risks and rollback.** Concrete rollback triggers (e.g. a data-safety test fails, perf probe >10% regression, contract conformance diverges between adapters) and the rollback reference (`phase_base_sha`).
7. **Proof.** Map every phase criterion ID and each relevant permanent invariant to the command/test/review checklist that will prove it, and the tier (`quick`/`affected`/`phase`/`all`/CI/human gate). Name fixed fixture sets for any visual/subjective criterion and finite checklists for reviewer audits when the phase asks for them.

## Output

- **Campaign phase:** write `docs/refactor/execution/phase-N-plan.md` from [references/plan-template.md](references/plan-template.md); `$elef-campaign` freezes it (hash in status) before any production edit.
- **Non-phase change** (post-refactor or within DO): a short owner/scope/proof note in the commit message or PR description is enough; update durable docs only if an enduring rule changes (`$docs-sync`).

## Stop conditions

- The phase contract or constitution cannot be satisfied as written, or two rules conflict → `BLOCKED(criteria-conflict)`; do not reinterpret criteria to fit.
- During DO, reality invalidates the frozen plan → back to PLAN (re-plan section + re-freeze), not improvisation.
- Never grow architecture allowlists, weaken tests/baselines, or move frozen boundaries to make a plan work.

When re-planning, preserve completed legal DO changes and review-round history. Commit entry to PLAN before scope edits, clear the previous frozen-plan hash, and record the exact invalidated assumption, added/removed scope, proof changes and resolution. New production edits wait for the new freeze. A current phase dependency on later work is a sequencing question to resolve from authority, never permission to skip phases.
