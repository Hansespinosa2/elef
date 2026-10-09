# P12-07 exercise 7 — new editor behavior (route only, do not implement)

**Report:** the editor should show a live word-count status bar that updates
as the user types, in both the web app and the desktop app. (Route the
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

- Owners: `packages/client` editor feature slice (status-bar UI fed by
  `packages/work-model` counts); the web Stimulus adapter and the Tauri
  adapter only mount it.
- Shared: identical editor chrome on both hosts from one implementation;
  no host branch.
- Proof: `npm test --prefix packages/client`, `npm test --prefix
  packages/work-model`, then `bin/check quick` and `bin/check affected`.
