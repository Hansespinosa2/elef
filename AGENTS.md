# Agent execution guidance

## Tauri E2E tests

- Start with `git status --short` and identify the smallest targeted test.
- Use `npm run test:e2e -- --mochaOpts.grep='...'` for a focused run.
- The E2E runner reuses the existing debug binary. Rebuild explicitly with `npm run test:e2e:build` or `WDIO_BUILD=1 npm run test:e2e`.
- Do not run the full Tauri suite before a focused test passes.
- Before any command expected to take more than two minutes, state the command and why it is necessary.
- If a command produces no useful output for two minutes, stop it and report the blocker rather than recreating fixtures or restarting planning.
- Treat an existing implementation spec as the source of truth; do not restart planning when it already identifies the next unchecked task.
