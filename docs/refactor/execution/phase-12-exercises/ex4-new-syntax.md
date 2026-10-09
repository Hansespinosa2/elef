# P12-07 exercise 4 — new Work syntax (route only, do not implement)

**Report:** product wants a new `:::poll` block: authors write options as list
items, readers click to vote, and vote counts render inline. (Route the
request to its owner and proof commands; if any part looks mis-scoped on
inspection, still name where each behavior lives and what would prove it.)

**Task:** using only the durable repository docs (`ELEF-DOCTRINE.md`,
`docs/architecture.md`, `docs/development.md`, `docs/desktop/**`) plus the
code they point to, answer:

1. Which paths own each part of this behavior?
2. Shared or host-specific, and why in one sentence?
3. The exact proof commands to run after the change (copy them from the docs).

**Rules:** read-only; no edits, no commits, no pushes, no running heavy
suites (naming the commands is the deliverable — do not execute them).
Answer in under 5 minutes of wall-clock from receiving this task.

## Expected answer (for grading; not shown to the solver)

- Owners: `packages/work-model` (poll structure semantics: options, votes,
  counts), `packages/renderer` (projection: options list + counts HTML);
  interactive voting UI in `packages/client` feature slice; never a host.
- Shared: Work syntax and projection are single implementations both hosts
  inherit; hosts only mount them.
- Proof: `npm test --prefix packages/work-model`, `npm test --prefix
  packages/renderer`, `npm test --prefix packages/client`, then `bin/check
  quick` and `bin/check affected`.
