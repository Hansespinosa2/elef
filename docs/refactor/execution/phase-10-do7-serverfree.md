# Phase 10 DO-7 server-free proof (P10-06)

Procedure (all in one shell, `docs/refactor/execution` DO-7 commit):

1. Pre-flight: `ss -ltn | grep -E ':3000|:3100|:4445'` → no listeners;
   `ps aux | grep -E 'rails server|tauri-driver|WebKitWebDriver|elef-desktop|puma.*elef'`
   → no processes. (A pre-existing orphaned campaign test server, PID 3501,
   PPID 1, started 03:10 with `ELEF_USE_SQLITE=1`, was identified and stopped
   via SIGTERM before the pre-flight; it belonged to no live session.)
2. `npm test --prefix packages/client` → 99 pass, 0 fail. The suite mounts
   via `mountElef` + `createFakeHost` (`packages/client/test/helpers.tsx`)
   and runs bundled under plain `node:test` (`run-tests.mjs`).
3. `node tests/host-conformance/run-node.js fake` → 12 pass, 0 fail, no
   `ELEF_CONFORMANCE_RAILS_URL` set.

The client contract suite exercises fully with no Rails or Tauri process.
The Phase 10 gate enforces this shape (pre-flight + both suites green).
