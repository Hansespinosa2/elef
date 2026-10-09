# P10-04 exercise 1 — shared feature (route only, do not implement)

**Request:** users want a "duplicate slide" action in the presentation editor
that works identically on web and desktop.

**Task:** using only the durable repository docs (`ELEF-DOCTRINE.md`,
`docs/architecture.md`, `docs/development.md`, `docs/desktop/**`) plus the
code they point to, answer:

1. Which path owns this change (the single place to implement it)?
2. Shared or host-specific, and why in one sentence?
3. The exact proof commands to run after the change (copy them from the docs).

**Rules:** read-only; no edits, no commits, no pushes, no running heavy
suites (naming the commands is the deliverable — do not execute them).
Answer in under 5 minutes of wall-clock from receiving this task.

## Expected answer (for grading; not shown to the solver)

- Owner: `packages/client` (presentation editor feature; structural op via
  `packages/work-model` if implemented as a source transform).
- Shared: one product behavior on both hosts (constitution one-product rule;
  durable code map: client is the host-neutral interactive UI).
- Proof: `npm test --prefix packages/client` (and `npm test --prefix
  packages/work-model` if touched), then `bin/check quick` and
  `bin/check affected` per the repo cycle.
