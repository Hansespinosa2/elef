---
name: docs-sync
description: Use when Elef durable architecture/developer knowledge, an enduring rule/contract/path/command, or refactor campaign state changes, and during Phase 12 cleanup. Keeps one source of truth per fact across durable docs, docs/refactor/, AGENTS.md, skills and code.
---

# Docs sync

Doc homes are defined by `docs/refactor/CONSTITUTION.md` §9. Rule: each fact has exactly one owner; everything else links to it.

| Knowledge | Single home |
|---|---|
| product principles / owner intent | `ELEF-DOCTRINE.md` |
| boundaries, ownership, contracts, change-routing examples | `docs/architecture.md` |
| setup, validation tiers, feature/bug workflow, commands | `docs/development.md` |
| domain runbooks (desktop, deployment, media/printing) | `docs/desktop/**`, `docs/mac-mini-deployment.md`, `docs/presentation-media-and-printing.md` |
| temporary campaign rules, phase contracts, status, plans, reviews | `docs/refactor/**` (marked for coordinated deletion after final technical PASS) |
| contract types and signatures | code in `packages/contracts` (documented by code, not prose) |
| agent routing + safety | `AGENTS.md` (short router) |
| agent workflow | `.agents/skills/*` (no copied architecture/phase truth) |

## When something changes

1. Find the fact's home; edit it there only. Replace any copies elsewhere with a link.
2. When code moves, update paths/commands in durable docs, code and CI references in the same commit — docs must describe reality at every checkpoint (invariant 9). Campaign workflows use the stable root `bin/check` and durable docs for current host paths; keep installed instructions read-only until Phase 12's planned retirement/repointing. An unexpected required workflow correction is an evidenced blocker for the owner.
3. Durable docs describe the current state; target-state rules stay in `docs/refactor/` until a phase makes them true, then are promoted.
4. If a durable doc contradicts the constitution, do not silently rewrite owner intent in `ELEF-DOCTRINE.md`: note the contradiction in the phase evidence and reconcile it when the phase that changes the behavior lands (record the reasoning in the review evidence). If it cannot be reconciled, `BLOCKED(criteria-conflict)`.
5. Update `docs/refactor/status.json` on every campaign state change (via `$elef-campaign` conventions).
6. Check links: `rg -n "docs/refactor" AGENTS.md README.md docs .agents/skills` must list only temporary references you intend to remove by Phase 12.

## Phase 12 cleanup

- Promote every durable rule from the constitution/phase contracts (boundaries, dependency rules, package justifications, validation tiers, change-routing examples, data-safety rules, contract law) into the durable homes above.
- Prove `docs/refactor/` is deletable: in a throwaway worktree delete it and run build/tests/docs checks (P12-08).
- Preserve status, contracts and reviewer machinery until the Phase 12 PASS checkpoint exists. Test deletion plus coordinated retirement in a disposable checkout, record its manifest, and mark retained temporary evidence/machinery for deletion together. Never remove the running campaign skill or reviewer before its final gate.
- Retire campaign-only machinery: `elef-campaign`, `independent-phase-review`, and campaign sections of other skills are removed or marked for deletion with `docs/refactor/`; keep only skills that still reduce steady-state work and point them at durable docs (P12-12). Rewrite `AGENTS.md` as the steady-state router.

Installed skills are the workflow source; setup templates and fallback copies are retired. Keep the bootstrap report factual: recorded claims without commands/outputs or session evidence are historical unverified claims, not validation proof.
