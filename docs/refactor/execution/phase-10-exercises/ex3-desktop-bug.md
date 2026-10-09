# P10-04 exercise 3 — desktop/local-store bug (route only, do not implement)

**Report:** renaming a desktop deck to a name with a trailing space creates a
folder the library cannot find after restart. (Route the report to its owner
and proof commands; if the report looks inaccurate on inspection, still name
where the behavior lives and what would prove it.)

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

- Owner: `crates/local-store` (path safety / deck rename; Tauri-independent
  persistence engine).
- Host-specific (desktop persistence): local filesystem layout exists only on
  desktop; the web app persists to PostgreSQL.
- Proof: `cargo test --manifest-path Cargo.toml -p local-store --locked`,
  then `bin/check quick` and `bin/check affected`.
