---
name: independent-phase-review
description: Use only when an Elef refactor phase claims readiness for PASS and must be independently verified from fresh context.
---

# Independent phase review

Create a genuinely fresh review context using the best available isolated agent mechanism. Release implementation-heavy processes first; review need not run simultaneously.

Give the reviewer only:
- core constitution;
- active phase contract;
- status;
- frozen execution plan;
- base and candidate SHAs;
- diff/repository at candidate HEAD;
- existing machine evidence or permission for read-only reruns.

Do not provide implementer reasoning.

The reviewer independently evaluates every phase criterion and permanent invariant and returns:
`Criterion | PASS/FAIL/BLOCKED | exact evidence | finding | required fix`
plus final `Result: PASS|FAIL|BLOCKED(reason)`.

If fresh context is genuinely unavailable, return `BLOCKED(reviewer-unavailable)`. Never self-certify.
