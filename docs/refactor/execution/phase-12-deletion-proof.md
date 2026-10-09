# P12-08 deletion proof record

Throwaway checkout `/root/elef-delproof` (fresh `git worktree`-style clone of the
campaign branch, sharing `CARGO_TARGET_DIR` with the main checkout to fit the
~8 GB VM). `docs/refactor/` removed with `rm -rf` before any build step.

Proof set (frozen phase-12 plan §DO-6), each run from a clean dependency state:

| Step | Command | Result |
|---|---|---|
| Absence check | `test ! -e docs/refactor` | OK |
| Root deps | `npm ci --no-audit --no-fund` | 56 packages |
| Frontend deps | `npm ci --prefix apps/desktop/frontend` | 55 packages |
| E2E deps | `npm ci --prefix apps/desktop/e2e` | 459 packages |
| JS tests | `npm run test:javascript` | 348 pass / 0 fail |
| Rails subset | `bin/rails test test/models/work_test.rb` | 7 runs, 34 assertions, 0 failures |
| CSS build | `bin/rails tailwindcss:build` | done |
| Rust store | `cargo test -p local-store --locked` | 73 passed, 0 failed |
| Quick tier | `bin/check quick` | PASS (16.6s) |
| Full tier | `PGPASSWORD=postgres bin/check all` | PENDING — run 2 in flight (see note) |
| Durable link check | `grep docs/refactor` over README/AGENTS/arch/development/doctrine/docs | ∅ (zero matches) |

Note (first `all` attempt): the desktop e2e debug build failed with
"Unable to find your web assets ... frontendDist dist-e2e" because
`run_desktop_e2e` did not set `ELEF_E2E_BUILD=1`, which `build.mjs` requires
to emit `dist-e2e/`. The main checkout had masked this with a leftover
`dist-e2e/` directory. Fixed in the main tree (commit `56936a5`, pushed),
the fix synced into the throwaway, and the full `bin/check all` restarted.
The fix is campaign-battery code, not product behavior; no criteria changed.

Retained-skill references: the three steady-state skills still mention
`docs/refactor/` in their campaign sections; per the
[retirement manifest](phase-12-retirement-manifest.md) those sections are
repointed at durable docs in the post-campaign deletion procedure, not during
the campaign.

Second `all` attempt: the debug build succeeded but the e2e runner looked for
the binary at `<throwaway>/target/debug/elef-desktop` while the shared
`CARGO_TARGET_DIR=/root/elef/target` (a documented VM accommodation) had
placed it in the main tree — a proof-harness path artifact, not a repo
defect (a genuine fresh checkout builds into its own `target/`). Resolved
with a `target/` symlink in the throwaway; full `all` restarted
(log `/tmp/delproof-all2.log`).

Final verdict: **PASS** — third `all` run green end to end:
`bin/check all: PASS (867.2s)`, exit 0, all 36 steps green (system suite
345.0s, desktop e2e 180.3s, web e2e 92.0s, native benchmark 184.0s; ceiling
2700s). The repository builds, tests, and checks successfully with
`docs/refactor/` deleted. P12-08 proven.
