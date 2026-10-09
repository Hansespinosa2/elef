# P10-04 exercise 2 — web-only bug (route only, do not implement)

**Report:** on the web presentation page, the Download PPTX button stays
enabled while an export is being prepared, so double-clicks can fire
overlapping exports. (Route the report to its owner and proof commands; if
the report looks inaccurate on inspection, still name where the behavior
lives and what would prove it.)

**Task:** using only the durable repository docs (`ELEF-DOCTRINE.md`,
`docs/architecture.md`, `docs/development.md`, `docs/desktop/**`) plus the
code they point to, answer:

1. Which path owns this behavior?
2. Shared or host-specific, and why in one sentence?
3. The exact proof commands to run after a fix (copy them from the docs).

**Rules:** read-only; no edits, no commits, no pushes, no running heavy
suites (naming the commands is the deliverable — do not execute them).
Answer in under 5 minutes of wall-clock from receiving this task.

## Expected answer (for grading; not shown to the solver)

- Owner: `app/javascript/controllers/pptx_export_host_controller.js` (Rails
  host adapter for the shared export engine: button/download/status edges).
- Host-specific (web): download transport + button behavior exist only on the
  web host; the shared engine lives in `packages/client/src/features/export`.
- Proof: `npm run test:javascript`, `bin/rails test
  test/system/pptx_export_test.rb`, then `bin/check quick` and
  `bin/check affected`.
