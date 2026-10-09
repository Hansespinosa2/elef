# P10-04 exercise 1b — shared feature, reseeded (route only, do not implement)

Reseeded after EX-1 attempt 1 exposed stale routing docs (fixed in
`docs/architecture.md`, `docs/development.md`,
`docs/desktop/transport-adapter.md`; original attempt retained in
`phase-10-exercise-transcripts.md`). Same class (shared feature), unseen
prompt.

**Request:** users want "move block up / move block down" keyboard shortcuts
in the document editor, working identically on web and desktop.

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

- Owner: `packages/client` document-editor feature (`features/document`),
  with the structural move expressed through `packages/work-model`
  block-move transforms.
- Shared: one product behavior on both hosts; host-neutral UI/workflows
  belong in the client, pure semantics in work-model.
- Proof: `npm test --prefix packages/client`, `npm test --prefix
  packages/work-model`, then `bin/check quick` and `bin/check affected`.
