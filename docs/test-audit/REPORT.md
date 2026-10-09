# Elef test suite audit

Audit target: `58c991140d42b573ec7488d647aefe80e6733d18` on `dev` (2026-10-09).

## Phase 0: baseline

The supplied worktree was clean but three commits behind `origin/dev`; I fast-forwarded the task branch to the stated audit commit before collecting measurements. No test source, CI job, deployment authorization, or release configuration has been changed in this phase.

The successful PR run [37952940986](https://github.com/Hansespinosa2/elef/actions/runs/37952940986) tested PR 149 head `d258818ab0d057d15500828d89cec86c96148c84`. Its tree hash is identical to the audited `58c9911` tree (`5272e99928fca872486398add37955e2d617589f`). All 11 required jobs and the attestation job succeeded on attempt 1. The workflow ran from 15:36:02 to 15:53:44 UTC: **17m42s wall time** and **48.0 required-job runner-minutes**.

### Verified inventory

| Layer | Observed baseline | Difference from estimate |
| --- | ---: | --- |
| Ruby non-system tests | 364 tests in 40 files | 263 tests in 31 core files, 98 in 7 controller files, and 3 script tests; close to the estimate |
| Ruby system tests | 241 tests in 9 files | Matches the estimate |
| Rails-owned JavaScript | 438 tests: 248 in 20 root files and 190 in 38 `shared` files | The estimated ~534 total is high by 96 |
| Desktop frontend adapter tests | 26 tests in 10 files | Matches the estimate |
| E2E harness unit tests | 10 tests in 3 files | Matches the estimate |
| Rust workspace | 40 `elef-core` tests plus 3 `elef_desktop_lib` tests | 43 total, six above the estimate |

The deterministic block in the `test` job is **eight** invocations: one `bug_report_events.test.mjs` command and seven files in the `node --test` command. All eight files are included in the 438-test `npm run test:javascript` suite run in `desktop-fast`, `desktop`, and `desktop-macos`. Each of those eight currently executes four times per PR; the rest of the shared JavaScript suite executes three times. The desktop adapter suite also runs in all three jobs. `elef-core` runs in `desktop-fast` and in each full workspace job.

`elef-core` contains `cfg(unix)`, `cfg(target_os = "linux")`, and `cfg(target_os = "macos")` branches and platform-specific filesystem code. Deduplicating its tests from the macOS workspace run is therefore not supported by the source audit.

The `find_by!` assertion near line 247 in `test/system/presentations_test.rb` is in “library renames forks and deletes a presentation through its controls.” It passed as a headless one-test run (1 test, 5 assertions). The concern that it is broken is not borne out by execution.

### CI timing

Per-job durations from the exact-tree PR run:

| Required job | Elapsed |
| --- | ---: |
| `desktop` | 16m45s |
| `desktop-macos` | 17m15s |
| `system-test` | 7m55s |
| `production-smoke` | 1m46s |
| `development-smoke` | 1m22s |
| `test` | 54s |
| `renderer-macos` | 47s |
| `desktop-fast` | 29s |
| `sqlite-test` | 24s |
| `scan_js` | 12s |
| `scan_ruby` | 11s |

The exact run's costliest relevant steps were:

| Step | Linux desktop | macOS desktop |
| --- | ---: | ---: |
| OS desktop dependencies | 74s | — |
| npm dependency installs | 6s total | 11s total |
| Rust build-artifact cache step | 117s | 61s |
| Playwright Chromium install | 13s | 12s |
| Build N-1 and N updater fixtures | 213s | 134s |
| Shared web and native E2E stage | 256s | 308s |
| Release binary build for benchmark | 41s | 98s |
| 20-process native benchmark | 121s | 168s |
| Native package build | 94s | 69s |

The E2E stage in each desktop job includes the shared web phase because `desktop/e2e/run.mjs` runs web, native WebDriver, and then the packaged-updater pass in sequence. The benchmark's release build and 20 process launches are inside both required desktop jobs. The job contract test in `test/scripts/ci_single_run_test.rb` checks job names, event gates, attestation dependencies, and publishing permissions, but does not check duplicate test commands.

For context, I measured the 10 most recent successful PR runs with the same 11-job required topology. Job timing data includes actual work from prior attempts and excludes jobs reused from an earlier attempt. Final-attempt active wall time was median **16m49s**, p95 **28m29s**. Runner-minutes across all attempts were median **60.9**, p95 **83.4**. Trigger-to-final-completion time was median **28m29s**, p95 **4h08m31s**; the p95 is dominated by queue/rerun delays, so it is not a clean measure of test-suite execution time. Four of the ten workflows had a prior non-success attempt: two had failed desktop attempts and two had cancelled desktop attempts. This is not a flake rate because cancellation causes and code revisions differ.

Per-job median/p95 runner-minutes across those same 10 PR workflows (including actual repeated work):

| Job | Median / p95 minutes |
| --- | ---: |
| `desktop` | 28.24 / 55.67 |
| `desktop-macos` | 15.37 / 23.27 |
| `system-test` | 6.65 / 7.88 |
| `production-smoke` | 1.65 / 1.76 |
| `development-smoke` | 1.51 / 1.67 |
| `test` | 0.93 / 1.53 |
| `renderer-macos` | 0.81 / 1.31 |
| `sqlite-test` | 0.43 / 1.15 |
| `desktop-fast` | 0.66 / 0.87 |
| `scan_js` | 0.26 / 0.93 |
| `scan_ruby` | 0.28 / 0.93 |

Raw per-file and per-step timings are in [baseline-local-file-timings.csv](baseline-local-file-timings.csv), [baseline-ci-step-timings.csv](baseline-ci-step-timings.csv), [baseline-ci-success-runs.csv](baseline-ci-success-runs.csv), and [baseline-ci-job-attempt-timings.csv](baseline-ci-job-attempt-timings.csv). The CI run sample consists of `37952940986`, `37950169098`, `37948490669`, `37919923291`, `37912530840`, `37878095359`, `37873650312`, `37871323728`, `37866931098`, and `37863401369`.

### Local baseline

The PostgreSQL test configuration points at `127.0.0.1:5432`, but no local PostgreSQL service was active. The PostgreSQL baseline attempt failed immediately with `connection refused`. I did not start a database service or point tests at the live development database. The complete Rails test and system tiers were run against a separate `/tmp` SQLite test database through the repository's `ELEF_USE_SQLITE` test configuration.

| Command / layer | Result |
| --- | --- |
| `bin/rails db:test:prepare test` | 364 tests, 3,147 assertions, pass; 7s process wall time (4.52s Minitest time) |
| `bin/rails test test/system` | 241 tests, 6,257 assertions, pass; 357s; Selenium/headless Chromium; one worker |
| Per-file Rails unit run | 40 files / 364 tests; no failures; median file process 1.27s, p95 3.91s |
| Per-file Rails system run | 9 files / 241 tests; one failure in `documents_test.rb`; see flake note below |
| `npm run test:javascript` | 438 tests, pass; 3s wall time |
| `npm test --prefix desktop/frontend` | 26 tests, pass; <1s wall time |
| `npm run test:unit --prefix desktop/e2e` | 10 tests, pass; <1s wall time |
| Explicit eight-file deterministic JS block | 111 tests, pass; 1s wall time |
| `cargo test -p elef-core --locked` | 40 tests, pass; 14s including initial compilation |
| `cargo test --workspace` | Initial attempt stopped because `desktop/frontend/dist` was absent; after the CI-ordered frontend build, 43 tests passed in 22s |

The full desktop E2E harness was not run locally because the existing development server occupies port 3000. The macOS-native leg cannot run on this Linux host; the exact-tree GitHub macOS job passed. Individual Node test files were run once each; median process time was 0.13s and p95 0.43s. Cold local npm install times were 9s (root), 8s (desktop frontend), and 34s (E2E dependencies).

### Baseline failure and retry evidence

The exact-tree PR run passed on its first attempt. The later push run [37955264358](https://github.com/Hansespinosa2/elef/actions/runs/37955264358) tested the same tree. Its Linux `desktop` job failed in the shared web “library and document graph” scenario after a 60s timeout waiting for the card's Present button; the Linux job stopped before native scenarios. Its macOS desktop job passed. The push run intentionally skipped PR-only jobs; it is not a missing/failed PR attestation. This is one failed and one successful Linux E2E execution on the same tree, so it is a flake candidate, not enough data to assign a stable rate.

The per-file system run found another timing-sensitive result: `documents_test.rb` failed once because it expected the transient “Uploading dropped-document.png…” message after the upload had already completed. The full system run passed, and three focused repetitions of that same test passed. The per-file failure and all three repetitions are recorded in the CSV. Rails and Node test runners were configured without automatic retries; the exact-tree Actions workflow used attempt 1.

An initial attempt to count Ruby directories ran two Rails processes concurrently against one SQLite file and hit `SQLite3::BusyException: database is locked`. That was an instrumentation collision, not a product test result. I reran the directory suites sequentially against separate SQLite files; 263 core Ruby tests and 98 controller tests passed.

## Claims verified for later phases

- The eight explicit JavaScript invocations are duplicated as described; the count is eight, not seven.
- Pure shared JavaScript runs in `desktop-fast`, `desktop`, and `desktop-macos`; desktop adapter tests also run in all three.
- `elef-core` is repeated on Linux and macOS, but platform-conditional code exists, so the macOS copy must stay.
- Both full desktop jobs install Chromium and each runs the web scenarios before its native scenarios.
- The performance benchmark is present twice in the workflow and runs inside required desktop jobs. The architecture check pins its count at two.
- `test/system/presentations_test.rb` line 247 passes as written; no fix is justified from the claimed failure.
- The Ruby renderer fallback is present behind `ELEF_RENDERER=ruby`; static inspection does not establish that it is dead code.

Other 3b–3f claims have not yet been fully checked against the tests or measured by a deliberate break. Phase 2 and later work is not recorded as complete here.

## Maintainer approval required before workflow changes

No required job or authorization behavior has been edited. Before changing required workflow jobs, I will present the concrete change set for approval. Decisions needed before merge are:

- Whether to remove duplicate commands from required jobs and split the shared web E2E phase so it runs once, while preserving the Linux/macOS native phases, updater sequence, scenario parity gate, and all required job names.
- Whether to narrow the PR SQLite run to tests with PostgreSQL/SQLite behavior differences, and where the full SQLite compatibility run should remain.
- Whether to move the benchmark out of the PR path. It currently fails the required `desktop` job if it fails, so moving it changes release/deployment authorization gating; the workflow verifier, attestation, and contract tests would need a coordinated update.
- Whether to remove the `ELEF_RENDERER=ruby` fallback if later evidence establishes it is dead. It is currently present and will be tested before any removal proposal.
- Any proposed change to release packaging or updater signature checks. No such change is included in this audit.

## Not yet verified

- The test corrections, demotions, consolidations, new coverage, and mutation checks in phases 2–5 have not been implemented yet.
- The required workflow changes in phase 1 are held for maintainer approval.
- No post-change timing comparison, three-run stability check, or final PR CI result exists yet. The acceptance targets are therefore not claimed.
