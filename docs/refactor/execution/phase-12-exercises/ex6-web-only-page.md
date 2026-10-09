# P12-07 exercise 6 — web-only page (route only, do not implement)

**Report:** the owner wants an admin word-count dashboard page on the web
app: per-work totals plus a 30-day trend, visible only to admins. (Route the
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

- Owners: `apps/web/app/` (controller + view + query object/service);
  shared styling only from `apps/web/app/assets`; word counting itself
  should reuse `packages/work-model` structure rather than re-parsing.
- Host-specific (web): an admin server-rendered page has no desktop
  counterpart; nothing ships in `packages/client`.
- Proof: `bin/rails test test/path_to_focused_test.rb` (from `apps/web/`),
  then `bin/check quick` and `bin/check affected`.
