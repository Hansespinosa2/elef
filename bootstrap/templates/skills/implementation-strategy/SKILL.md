---
name: implementation-strategy
description: Use before a new Elef refactor phase or a nontrivial architecture, runtime, contract, persistence, or shared product behavior change.
---

# Implementation strategy

Use repository authority; do not redesign Elef from memory.

## Produce
For the current change/phase, identify:
- semantic owner (`spec`, `contracts`, `work-model`, `renderer`, `client`, web host, desktop host, `local-store`, ops/tooling);
- shared vs host-specific behavior;
- behavior that must remain unchanged;
- exact scope/non-goals;
- architectural boundaries that must not move;
- deletions/compatibility path and death condition;
- risks/rollback trigger;
- cheapest sound validation and phase-gate evidence.

For campaign phases, write/freeze the execution contract where the constitution requires it.

## Rules
Apply package admission/minimization before adding any package.
Do not use code size or hypothetical reuse as package justification.
If reality invalidates a frozen assumption, stop DO and return to PLAN/ACT rather than improvising architecture.
