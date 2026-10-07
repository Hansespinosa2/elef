---
name: elef-campaign
description: Use when asked to go, continue, resume, finish, or autonomously run the Elef v9 refactor campaign from its current verified phase.
---

# Elef campaign

## Inputs
Read `AGENTS.md`, `docs/refactor/CONSTITUTION.md`, `docs/refactor/status.json`, the active phase contract, the frozen plan if one exists, and the phase diff. Load other docs only when the current task requires them.

## Workflow
1. Validate branch/worktree safety and status against git/review/PASS evidence.
2. If state is stale or missing, reconstruct the earliest unproven phase.
3. If no frozen valid plan exists, invoke `$implementation-strategy`.
4. Implement only the frozen phase scope.
5. Use `$code-change-verification` throughout iteration.
6. When phase-ready, invoke `$independent-phase-review` in fresh context.
7. ACT on every finding: implementation defect → fix; plan defect → re-plan; defined conflict/gate → BLOCKED; all criteria → PASS.
8. On PASS, emit the constitution's machine marker, update status, create a checkpoint commit, and advance immediately.
9. Continue until final technical PASS or a defined blocker.

## Resource rule
On the ~8 GB Linux container, serialize heavyweight workloads and release them before review. Fresh review must be isolated, not simultaneous.

## Completion
The skill completes only at final technical campaign PASS or a constitution-defined BLOCKED state. Do not stop merely because one phase or one attempt finished.
