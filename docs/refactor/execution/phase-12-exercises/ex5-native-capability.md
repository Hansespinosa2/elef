# P12-07 exercise 5 — new native capability (route only, do not implement)

**Report:** on desktop, the dock/taskbar icon should show a badge dot while
any deck has unsaved changes, clearing on save. (Route the request to its
owner and proof commands; if any part looks mis-scoped on inspection, still
name where each behavior lives and what would prove it.)

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

- Owners: `apps/desktop/frontend/src` adapter (badge state → Tauri call) +
  a capability-declared Tauri command in `apps/desktop/src-tauri`; the
  dirty-state itself stays owned by `WorkSession` in
  `packages/client/src/session` (the adapter reads opaque values).
- Host-specific (desktop): dock/taskbar badges exist only on the native
  platform; the web host has no such surface.
- Proof: `npm test --prefix apps/desktop/frontend`, `cargo test
  --manifest-path Cargo.toml -p local-store --locked` if storage touched,
  then `bin/check quick` and `bin/check affected`.
