# P12-07 exercise 8 — shared export behavior (route only, do not implement)

**Report:** users want OPML export: the current work's outline downloads as
an `.opml` file from both the web app and the desktop app. (Route the
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

- Owners: `packages/client/src/features/export` (OPML engine over
  work-model structure); host adapters own only their download edges
  (web download transport, desktop save dialog + filesystem write).
- Shared engine with host-specific edges: one outline serializer, two
  delivery transports.
- Proof: `npm test --prefix packages/client`, `npm run test:javascript`
  for the web adapter side, then `bin/check quick` and `bin/check
  affected`.
