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

The per-file system run found a timing-sensitive assertion: `documents_test.rb` expected the transient “Uploading dropped-document.png…” message after the upload had already completed. The baseline full system run passed and three focused repetitions passed, but a later full-suite repeat reproduced the same race once. The drop branch has no artificial network delay, so the transient label was not a stable observable. The final test removes that assertion while retaining immediate preparation state, final success text, source order, rendered preview, attachment count, and saved-state assertions. After the fix, the focused test passed and three full system runs passed. Rails and Node test runners were configured without automatic retries; the exact-tree Actions workflow used attempt 1.

An initial attempt to count Ruby directories ran two Rails processes concurrently against one SQLite file and hit `SQLite3::BusyException: database is locked`. That was an instrumentation collision, not a product test result. I reran the directory suites sequentially against separate SQLite files; 263 core Ruby tests and 98 controller tests passed.

### Prompt claims that were already covered at the audit commit

| Claim | Verified existing coverage | Audit disposition |
| --- | --- | --- |
| Core authoring, presentation, and export have no offline guarantee on Linux/macOS. | At the audit commit, Linux CI allowed loopback only with `iptables` and `ip6tables`, verified an external request failed, then ran the web/native/updater scenarios. macOS CI set `ELEF_E2E_OFFLINE=1`; `offline-macos.js` verified IPv4/IPv6 loopback and denied external IPv4/IPv6, then launched the native runner under Seatbelt. Both required jobs passed in the exact-tree baseline run. | The claim is incorrect for the audited tree. Both OS legs already had offline scenario coverage; the changed workflow still needs a hosted run. |
| `wait_for_fresh_projection` is called 29 times and each call performs a preview POST. | At the audited commit, `rg` finds 29 occurrences: 28 call sites plus the helper definition. The current branch has 27 call sites plus the definition after verified test demotions. The helper only waits for the form's stale-projection attribute to clear; `preview_controller.js` schedules the POST after a source or metadata change. Separate tests use separate records and editor state. | The occurrence count is one higher than the number of calls, and waits do not themselves post. No cross-test projection can safely be reused; no change made. |
| PPTX validity had no artifact-level check. | `test/system/pptx_export_test.rb` already opened the downloaded bytes as a ZIP, parsed `ppt/presentation.xml` and slide XML, checked slide count and dimensions, text, layout geometry, formatting, and embedded media. This test ran as part of the baseline system tier. | The claim is incorrect; no duplicate PPTX validity test was added. |
| Updater interruption, rollback protection, and user-data preservation were exercised only in the long desktop scenario. | At the audit commit, `update_install.rs` already killed child processes at four activation points for both app-file and app-directory installs, checked that the live launch path stayed complete, retained backups when replacement identity changed, and protected unrelated user files during cleanup. The full Rust workspace test ran in the local baseline. | The claim is incorrect. The later Rust coverage added version and install-lease guard tests, while the existing process-interruption and backup tests remain. |
| Rejected updater signatures have no negative test. | `desktop/e2e/updater-fixture-server.mjs` corrupts the signed artifact in `bad-signature` mode; `desktop/e2e/specs/desktop.spec.js` expects the native updater to reject it with a signature error and checks the installed binary and deck source are unchanged. The exact-tree baseline Linux and macOS desktop jobs passed. | Already covered by the native scenario at the audited commit; no duplicate test added. A post-change run still requires CI. |
| Rails had no integration coverage for stale autosave conflicts. | `test/controllers/presentations_controller_test.rb` already submits a newer source, retries with stale lock/revision tokens, and asserts HTTP conflict metadata and recovery source while preserving the committed server source. | The gap was already covered at the audit commit; the existing controller test remains. |
| Source directives had no source/visual parity coverage through editing, save, reopen, and mode switching. | The audited system test changed alignment directives and content in visual mode, then switched modes, but stopped before waiting for persistence or reopening the editor. | Partially correct; extended the existing system test to wait for idle autosave, assert persisted Markdown, reopen, switch modes, and check the rendered alignments. |
| `presentations_test.rb` contained three presentation sample-seed mega-tests. | The audited model file had two sample-data tests. | The stated count was high by one; both were moved to the dedicated sample-data test file. |

## SQLite/PostgreSQL differential matrix

The initial estimate that SQLite reruns the complete non-system suite is correct. Before narrowing it, I searched application SQL, migrations, schema definitions, and test coverage. The app has no PostgreSQL-only query operator in runtime code; the identified adapter-sensitive behavior is concentrated in migration SQL, SQLite's foreign-key connection setting, partial unique indexes, and optimistic locking's adapter-generated update.

| Differential behavior | Source evidence | Focused assertion on both adapters |
| --- | --- | --- |
| Sample-id migration backfill | `20260922003000_add_sample_compatibility_to_works.rb` selects `UPDATE ... FROM` for PostgreSQL and a correlated subquery otherwise. | `sqlite_compatibility_test.rb` runs the migration against a presentation detail and asserts the copied `works.sample_id`. |
| Serialized math-shortcut alias migration | `20260925100000_move_bb_alias_to_bold_math_shortcut.rb` queries a quoted boolean and parses/quotes JSON text through adapter SQL. | The focused test runs the migration on SQLite and checks the source and destination alias arrays after reloading. |
| Foreign-key enforcement and partial unique index semantics | SQLite requires `PRAGMA foreign_keys` enabled on the connection; `works` uses a unique partial index for document titles. | A direct SQL insert checks duplicate documents fail, duplicate presentation titles remain allowed, and an invalid workspace reference is rejected. The `PRAGMA` assertion runs only on SQLite. |
| Optimistic locking | `works.lock_version` is applied by Active Record through adapter-specific updates. | Two SQLite-loaded copies verify that a stale save raises and cannot replace the committed source. |

The new `test/sqlite_compatibility_test.rb` passed locally on a disposable SQLite database (4 tests, 9 assertions, about 0.13 seconds). These four tests also run in the PostgreSQL test job, so both branches of the migration and adapter-level persistence behavior receive the same assertions in CI. Local PostgreSQL was unavailable, so I could not verify that leg on this device. The full SQLite compatibility suite remains in the new weekly scheduled workflow and can also be started manually.

## Phase 1: remove verified duplicate executions

The maintainer approved run-once changes, SQLite narrowing after documenting the differential matrix, and moving the performance measurement out of PR authorization. No required job was removed, renamed, or made conditional, and the 11-job required list and attestation dependency remain unchanged.

| Removed PR execution | Remaining coverage and contract |
| --- | --- |
| The eight explicit deterministic JavaScript invocations in `test` (111 tests in the audited baseline). | `npm run test:javascript` in `desktop-fast` includes all eight files and the full shared JavaScript suite. The contract test rejects those explicit workflow invocations. |
| The extra `npm run test:javascript` copies from `desktop` and `desktop-macos`. | The complete Rails-owned JavaScript suite runs once in `desktop-fast`; each desktop job still rebuilds and consumes the Rails renderer bundle. |
| The extra `npm test --prefix desktop/frontend` copies from `desktop` and `desktop-macos`. | The 26 adapter tests run once in `desktop-fast`; platform jobs still build the frontend and exercise it in native E2E. |
| Linux `elef-core` unit tests from the full-workspace command. | `desktop-fast` runs all `elef-core` tests. Linux runs `elef_desktop_lib` tests; macOS retains full-workspace tests because `elef-core` contains platform-conditional filesystem code. |
| The macOS copy of the web browser scenarios and static component checks. | The Linux E2E runner executes the shared web stage and standalone component checks once, then runs native WebdriverIO and the updater pass in order. macOS sets `ELEF_E2E_SKIP_WEB=1` and runs native WebdriverIO followed by the unchanged updater pass. Shared scenario definitions and the final Linux web/native parity assertion remain. |
| The second Chromium download. | Only the Linux web phase installs Chromium; `~/.cache/ms-playwright` is keyed by OS and `desktop/e2e/package-lock.json`. macOS has no web/component stage and no browser download. |
| The two 20-process benchmark runs and their dedicated measurement-only release builds from required `desktop` jobs. | `native-performance.yml` runs weekly or by manual dispatch on Linux and macOS, with 10 launches per platform. The local benchmark default remains 20. Native performance is declared non-gating in attestation schema v2; the deployment verifier checks that manifest as well as the exact required-job list. Package builds and native/updater security scenarios remain in required CI; signed release packaging in `desktop-release.yml` is unchanged. |

`ci_single_run_test.rb` now checks exact command ownership, the sole web stage and macOS skip, SQLite job scope and scheduled full suite, benchmark placement, required job names/gates, and attestation declarations. The deployment authorization harness now rejects an attestation that omits or changes the required-job manifest or non-gating measurement policy. The verifier's exact-one-and-success rule rejects missing, duplicate, skipped, or failed job records; the harness explicitly exercises failed required jobs and malformed attestation policy.

### Phase 1 validation

| Command / check | Result |
| --- | --- |
| `ruby test/scripts/ci_single_run_test.rb` | Passed; all 11 required job names, event gates, once-only commands and new workflow policies matched. |
| `bash test/scripts/deployment_authorization_test.sh` | Passed; successful run authorized, while missing policy fields, missing jobs/artifact, failed jobs/run, and a mismatched tested tree were rejected. |
| `python3 desktop/scripts/check_architecture.py` | Passed; exactly two scheduled benchmark invocations remain and command allowlist/CSP checks still pass. |
| `python3 script/check_frontend_ownership.py` | Passed after moving static browser fixtures out of `desktop/`; Rails remains the owner of shared UI source. |
| Full non-system Rails suite on disposable SQLite (`bin/rails db:test:prepare test`) | 372 tests, 3,037 assertions, 0 failures, 0 errors, 0 skips; 38.07 seconds. |
| `npm run test:javascript` | 444 tests passed. |
| `npm test --prefix desktop/frontend` | 26 tests passed. |
| `npm run test:unit --prefix desktop/e2e` | 12 tests passed, including parameterized benchmark count validation. |
| `npm run test:components --prefix desktop/e2e` | 4 static headless Chromium component tests passed. |
| `npm run build --prefix desktop/frontend` | Passed. |
| `bin/rails test test/sqlite_compatibility_test.rb` on disposable SQLite | 4 tests, 9 assertions, passed. |
| `cargo test --manifest-path desktop/Cargo.toml --workspace --locked` | 43 `elef-core` tests and 7 `elef_desktop_lib` tests passed. |
| `cargo fmt --manifest-path desktop/Cargo.toml --all -- --check` | Passed. |
| `cargo clippy --manifest-path desktop/Cargo.toml --workspace --all-targets -- -D warnings` | Passed. |

The updated workflow itself has not run on GitHub yet, so there are no after-change PR wall-time or runner-minute measurements. Baseline metrics remain the only CI measurements; the 20% wall-time and 25% runner-minute targets are not claimed. The new weekly workflows and both native platforms need a CI execution to validate runner setup. Local PostgreSQL is unavailable, and native macOS cannot be run on this Linux host.

## Phase 2: correct misleading tests

The source-level claims below were checked against the audited tree before editing. The following test changes are in the working branch; no required job, job trigger, verifier, attestation, or release behavior has changed.

| Change | Reason and evidence |
| --- | --- |
| Replaced the two `assert_no_difference { nil }` blocks in `test/lib/tasks/elef_work_rake_test.rb` with assertions around the actual invalid import invocations. | The old blocks executed no application behavior. The replacement still checks the usage error and that no `Work` is created. |
| Removed the two hardcoded `baseline_commit` comparisons in `test/lib/source/presentation_reveals_baseline_test.rb` and the equivalent JS reveal-golden provenance comparison. | Each compared a hardcoded SHA with metadata in the same fixture. The HTML and editor-map output comparisons remain. Fixture SHA metadata is retained as provenance. |
| Deleted `document_sample_data_test.rb`'s report-length fixture test. | It only checked the length and headings of a constant. The other sample-data tests still exercise catalog loading, idempotent seeding, rendering, warnings, and graph behavior. |
| Renamed and strengthened the PPTX service determinism test. | It now constructs two independent `Presentation` and `PptxExport` instances per fixture, compares the complete payloads, and checks an independently specified title and filename. |
| Strengthened “presents from the edit screen without submitting the editor form.” | It changes the source, holds the autosave request, verifies the dirty state, accepts the navigation confirmation, and verifies that the persisted source stayed original. The focused system test passed. |
| Removed the transient “Uploading dropped-document.png…” assertion from the source-mode image-drop system test. | Unlike the paste branch, the drop branch has no controlled delay, so the upload can complete before the transient label is observed. The test still checks immediate preparation/busy state, final success, insertion order, rendered image, attachment count, and saved state. The corresponding pre-fix assertion failed once in a full system run; the focused test and three post-fix full system runs passed. |
| Renamed five overclaimed tests: “card previews are scaled from their design size by the presentation canvas controller” → “card preview markup exposes presentation canvas dimensions and stage”; “editor wires autosave and keeps new presentations client-only until creation” → “editor markup configures autosave and keeps new presentations client-only”; “tracks stale and current states based on draft source, title, and assets” → “tracks stale and current states based on draft source and title”; “saved document resolution and rendering use shared recursive Art semantics” → “the Ruby document renderer resolves recursive Art directives”; and “Tauri dev and production builds both rebuild the Rails-owned frontend” → “Tauri config points both build hooks at the Rails frontend build command.” | Each new name describes the markup, draft/title comparison, Ruby-only path, or configured command that the body actually checks. |
| Replaced the stylesheet contract's fixed count of 13 imports with a comparison between every `components/*.css` file and the imported component set. | Adding a component stylesheet no longer invalidates an unrelated magic count. |
| Removed the two-page graph-panel style comparison system test and added a static Chromium fixture with expected panel background, border, and shadow values. | Comparing two pages could pass if both were wrong. A deliberate `base.css` background mutation caused the replacement assertion to fail; restoring the CSS made it pass. |
| Added independent geometry expectations to the shared stylesheet browser check. | The check now asserts the 1280×720 logical slide, 16:9 frame, equal two-column widths, A4 page ratio/bounds, document heading size, paragraph line height, and overflow behavior, in addition to stylesheet parity. |
| Moved detailed empty-dollar-pair Backspace cases to the math-controller unit test and changed the shared web and native E2E smoke to send a real keyboard Backspace. | Unit cases cover one and two preceding backslashes plus inline/fenced code. The real web/native keyboard scenarios are committed but were not run locally; the complete native runner is unavailable here. |
| Extracted PPTX generation helpers into `app/javascript/lib/pptx_export.js`; `pptx_export.test.mjs` imports that module directly instead of rewriting the Stimulus controller source. | Rails now pins the new module in `config/importmap.rb`; the desktop consumer build and actual Rails browser download cases passed after that pin was added. Existing browser tests continue to exercise the real download action and inspect the generated package. |
| Deleted `test/javascript/reveal_probes.mjs`. | Repository search found no command or CI step that runs this standalone review probe. |
| Moved duplicate-title validation to `test/models/document_test.rb`, document creation overrides to `documents_controller_test.rb`, and presentation preview immutability to `presentations_controller_test.rb`. | These tests now live at the model or endpoint they exercise. The relocated model/controller suites passed. |

The `find_by!` concern in `test/system/presentations_test.rb` is not a test defect: the focused test passed in Phase 0 (1 test, 5 assertions). The source-level architecture assertions in `test/javascript/shared/desktop_host.test.js` remain as ownership and import-boundary pins; related transport, save-flow, renderer, sanitizer, and frontend adapter behavior has direct unit coverage. No change was made to weaken those architecture checks.

### Phase 2 validation

| Command / test | Result |
| --- | --- |
| `npm run test:javascript` | 439 tests passed |
| `npm test --prefix desktop/frontend` | 26 tests passed |
| `npm run build --prefix desktop/frontend` | Passed after the new shared module import |
| `npm run test:web --prefix desktop/e2e -- --grep 'shared rendering styles preserve slide layouts and document typography|workspace graph panels use the independently specified dark surface colors'` | 2 focused Chromium tests passed; neither navigated to Rails or used a database |
| Deliberate graph-panel background mutation | Replacement test failed on both incorrect panel backgrounds, as intended |
| Focused moved model/controller suite | 74 tests, 753 assertions, passed |
| Other focused changed Ruby suites | 82 tests, 969 assertions, passed |
| Dirty-editor Present system test | 1 test, 6 assertions, passed |
| PPTX draft-download system test | 1 test, 6 assertions, passed after adding the Rails import-map pin |
| PPTX media-attachment system test | 1 test, 4 assertions, passed after adding the Rails import-map pin |
| `python3 script/check_frontend_ownership.py` and `git diff --check` | Passed |

The first real-browser PPTX attempt exposed the missing import-map pin: the controller failed to load and the browser test did not see the success status. Adding the explicit pin fixed the issue; the draft and media browser cases above were rerun and passed. I did not rerun the entire PPTX system-test file after the fix. The new native-host slide-geometry assertion and real keyboard smoke were not executed locally; this Linux checkout does not have the Tauri E2E fixture/binary running, and the macOS leg cannot run on this machine.

## Claims verified for later phases

- The eight explicit JavaScript invocations are duplicated as described; the count is eight, not seven.
- Pure shared JavaScript runs in `desktop-fast`, `desktop`, and `desktop-macos`; desktop adapter tests also run in all three.
- `elef-core` is repeated on Linux and macOS, but platform-conditional code exists, so the macOS copy must stay.
- Both full desktop jobs install Chromium and each runs the web scenarios before its native scenarios.
- The performance benchmark is present twice in the workflow and runs inside required desktop jobs. The architecture check pins its count at two.
- `test/system/presentations_test.rb` line 247 passes as written; no fix is justified from the claimed failure.
- The Ruby renderer fallback is present behind `ELEF_RENDERER=ruby`; static inspection does not establish that it is dead code.

Phase 2 test corrections above are implemented and locally verified at the stated tiers.

## Phase 3: cheaper observation and duplicate coverage (partial)

These changes move selected assertions to lower layers and consolidate tests that exercise the same implementation. Artifact reuse and post-change CI measurements remain open. The proposed projection reuse was skipped after inspection showed the helper only waits for preview work already scheduled by edits; isolated tests use distinct source and editor state. No required job definition, name, gate, or release rule changed. The desktop E2E runner now invokes the static component browser suite before Rails database fixture setup; the shared web → native → updater sequence and parity scenarios are unchanged.

### Demotions and moves

| Removed or shortened browser assertion | Replacement and reason | Break-test evidence |
| --- | --- | --- |
| `test/system/documents_test.rb`: “media transfer handling deduplicates file-list and item entries” | Direct media-controller unit test for file-list precedence and item fallback in `media_transfer.test.mjs`. | Removing the file-list guard made the unit assertion fail. |
| `test/system/documents_test.rb`: “source dragover defensively supports DOMStringList types collections” | Direct controller unit test for `Files`, `preventDefault`, `dropEffect`, and the drop-target class. | Changing the drop effect to `none` made the unit assertion fail. |
| `test/system/documents_test.rb`: “Mermaid source assist ignores mutations after its editor view is destroyed” | Direct Mermaid assistant controller test verifies a destroyed view closes the palette without editing. The separate reconnect browser test remains. | Removing the stale-editor guard made the unit assertion fail. |
| `test/system/presentations_test.rb`: “falls back to local storage when indexeddb cannot read a draft” | Autosave controller unit test stubs a failing IndexedDB transaction and verifies the localStorage record is returned. | Returning `null` from the fallback path made the unit assertion fail. |
| `test/system/presentations_test.rb`: “pasting a local image into the presentation title field does not intercept it” | Media controller unit test verifies a paste outside `.editor-surface` and `.editor-projection` is not prevented and does not upload. | Removing the editor-target guard made the unit assertion fail. |
| `test/system/documents_test.rb`: “navigates resolved document links to previews” | Existing document controller response test now scopes the resolved and unresolved links to `.document-surface`, proving the rendered href and fallback markup. | Breaking the vendor renderer's wiki-link href made the scoped response test fail. |
| `test/system/documents_test.rb`: content assertions in “print view renders paginated document and triggers window.print” | Controller response test now asserts both page headings and print toolbar; the remaining browser test only clicks Print with a `window.print` stub. | Removing the rendered document surface made the controller assertion fail. |
| `test/system/art_test.rb`: “ART-SRC-008 position modifiers stay on an Art block in Rails presentation rendering” | Presentation response test asserts the position classes in the rendered presentation markup. | Removing `position_classes` from the renderer made the response assertion fail. |
| `test/system/presentations_test.rb`: “an unaligned presentation block defaults to Align Left” | Presentation controller test inspects the server-generated editor projection for the selected left option. | Changing the editor default to center made the response assertion fail. |
| `test/system/presentations_test.rb`: “presentation form does not register duplicate media controllers” | Presentation editor markup test counts the server-rendered controller token. | Omitting `media` from the form controller list made the response assertion fail. |
| `test/system/presentations_test.rb`: “saved presentation Art fallback preserves attached media” | Presentation print response test asserts fallback status, asset URL, alt text, and list content. | Changing the renderer's fallback status made the response assertion fail. |
| Warning text in “source mode keeps unsupported presentation directives available,” plus body-class assertions in “keeps Elef UI and presentation surfaces as separate styling zones” | Exact warning text and both application/presentation body classes are asserted in presentation controller responses. | Mutating the warning text and removing either body class made the respective response assertion fail. |
| Draft/published DOM assertions in “print view selects draft content and sizes slides for one landscape page each” | Existing controller response test selects the latest draft and pinned published release. The browser test retains the real print-button action, CDP geometry, and PDF page/image-byte assertions. | Changing the `version=published` selection made the controller test fail. |
| `test/system/unified_workspace_test.rb`: “uses dark Aradia surfaces for math shortcut settings” | Moved to the standalone Chromium component suite using a static HTML fixture; the CSS check no longer starts Rails or a database. | Changing the settings-card background made the component assertion fail. |
| Static CSS/layout checks at the end of `web.spec.js`: “shared rendering styles preserve slide layouts and document typography,” “workspace graph panels use the independently specified dark surface colors,” and “the source editor has matching styles in Rails and the desktop asset bundle” | Moved into `components.spec.js` with fixture-only pages: shared slide/document geometry, graph panel colors, and editor shell geometry. They run in a standalone Playwright configuration before Rails database fixture setup. | Mutating the editor grid to one column made the component parity/geometry assertion fail. Independent expected slide, page, typography, and color values remain. |
| Disk-only folder assertions at the end of the presentation image upload system test | A new controller request test verifies the uploaded asset is written immediately, then saves its Elef reference and checks raw and portable Markdown. The real-browser test still exercises image uploads and rendering in both editor modes. Removed the controller's duplicate explicit sync after confirming the model save callback performs it. | A temporary no-op mutation of `FolderSync.sync!` failed the request test on the missing uploaded asset. The system test name now matches its remaining UI assertions. |
| Fixed 1.2-second sleeps in the autosave ordering/conflict system tests | Replaced both with `wait_for_autosave_idle`, which polls the actual save-flow `dirty` and `saving` state. Request-count and persisted-source assertions remain. | Both focused browser cases passed with the condition-based wait. |

The presentation print system test was renamed to `published presentation print action produces a landscape PDF with one page per slide and attached media`; it still uses Chromium CDP to inspect the generated PDF and retains the print-button smoke. No PDF assertion was demoted.

### Consolidations and reductions

| Change | Evidence/replacement |
| --- | --- |
| Reduced `SourceRendererTest` from 18 tests to four facade-specific tests: resolver error propagation, unresolved asset empty output, attached video markup, and resolver/HTML-safe plumbing. | Fifteen original test bodies were removed because the same renderer is exercised more directly in JS: “renders standard Markdown links with safe URLs,” “blocks unsafe URL schemes in links and renders only link text,” “renders safe images with editor source metadata,” “strips images with unsafe URLs,” “resolves elef-asset image attachments with contain and cover fit,” “renders code blocks with syntax highlighting classes,” “renders a Mermaid fence as a diagram container,” “keeps other fenced code blocks highlighted,” “renders inline and display math via KaTeX,” “renders transpose and inverse commands on canonical styled atoms,” “renders parenthesized inline and bracketed display math via KaTeX,” “renders empty block display math as an editable math atom,” “preserves escaped dollar signs without rendering math,” “leaves math syntax inside code blocks literal,” and “rescues invalid LaTeX into a styled math error element.” The 14-fixture shared JavaScript bundle loop now includes unsafe link schemes (`data:` and `vbscript:`) alongside `javascript:` and explicitly asserts that none become links; a direct JS render test covers all four styled transpose/inverse expressions. The Rails facade parity loop remains in `javascript_renderer_test.rb`. Its duplicate editor-map fetch was removed because the same loop already compares the complete editor map inside the preview result. |
| Merged “untrusted deck names and warnings are inserted as text” and “deck actions carry the selected deck identity” from `test/javascript/library_card.test.js` into `shared/library_card.test.js`; deleted the old file. | Shared card metadata, warning escaping/accessibility, and open/preview/present/rename/delete callbacks are tested against the shared implementation. |
| Merged “library search matches titles without case or canonical Unicode differences” from `shared/library_search.test.js` into `shared/library_filter.test.js`; deleted the old file. | Both files exercised `library_filter.js`; the merged suite tests filtering, normalization, visibility, and no-results state. |
| Combined “a rendered document draws the diagram instead of the fence source” and “a rendered presentation draws the diagram instead of the fence source” into one looped system test; removed “inserting /diagram renders a diagram on the rendered work.” | The document source-mode scenario still covers `/diagram` editing; the render suite covers document and presentation SVG output, while the Mermaid system suite retains editor preview, edit round-trip, and invalid-diagram checks. |
| Moved “sample data covers supported presentation features” and “renders every sample's representative content” into `presentation_sample_data_test.rb`. | The remaining 46 presentation model tests no longer perform 22 full sample presentation creates and KaTeX renders. The prompt estimated three such tests; the audited file had two. The third test removed in this group was “deleting a parent leaves the fork detached and intact,” a duplicate fork-detachment assertion covered more strongly in `persistence_services_test.rb`. |
| Removed “deleting a parent leaves the fork detached and intact” from the presentation model tests. | `persistence_services_test.rb` keeps the fork, origin revision, independence, and parent deletion assertions. |
| Removed two `any?` authoring registry spot checks. | Exact comparison with generated canonical entries and remaining schema/alias tests cover the same entries more strongly. |
| Reduced repeated KaTeX renders in the math shortcut catalog test. | Every alias-to-expansion mapping is still asserted; six representative Greek expressions and one variant render through KaTeX. |
| Reduced the Rake import task tests to CLI/env wiring, exit/output, and count delta. | Stable identity, source round-trip, workspace, and revision behavior remains covered by `persistence_services_test.rb`. |
| Reduced `navigates a large same-day timeline without overlapping slides` from 84 generated presentations to 56 (8 families × 7 nodes). | Both viewport geometry passes, all remaining per-node overlap checks, search, locate, and open assertions remain. The focused test passed before and after; local test time changed from 4.67s to 4.12s, while geometry assertions scaled from 1,712 to 1,144. |
| Split the library card system test that mixed preview geometry, preview routes, menu toggles, and edit navigation into three focused system tests. | Each test now has its own setup and claim; the two preview-to-preview returns and edit-to-library transitions use the visible Library navigation. This addresses the six `visit root_path` calls in one test. The total number of root-route transitions is not reduced, so no runtime saving is claimed. |

### Phase 3 validation

| Command / check | Result |
| --- | --- |
| `npm run test:javascript` | 444 passed |
| Focused changed Rails controller/model/service suites on disposable SQLite | 173 tests, 1,366 assertions, passed |
| `npm run test:components --prefix desktop/e2e` | 4 standalone headless Chromium tests passed without Rails or a database |
| `npm run test:unit --prefix desktop/e2e` | 10 passed |
| Focused Rails renderer facade fixture loop | 20 tests, 85 assertions, passed |
| Selected remaining print, PDF, presentation styling, Mermaid rendering/editor, and reconnect system tests | 6 tests, 28 assertions, passed on headless Chromium with disposable SQLite |
| Focused controller upload/folder-sync request test | 1 test, 7 assertions, passed; a `FolderSync.sync!` no-op mutation caused the missing-file assertion to fail. |
| Focused presentation upload system tests | 2 tests, 25 assertions, passed on headless Chromium with disposable SQLite. |
| Focused library card system tests after splitting | 3 tests, 23 assertions, passed on headless Chromium with disposable SQLite. |
| Focused autosave ordering/conflict system tests | 2 tests, 24 assertions, passed on headless Chromium with disposable SQLite after replacing fixed sleeps with state-based waits. |
| Deliberate break checks for moved controller assertions | Published release selection, application body class, and presentation-mode body class mutations each failed the expected controller test; source restored afterward. Earlier targeted break checks for href, print surface, controller token, warning, alignment, Art position, and Art fallback are listed above. |
| Deliberate CSS mutations | Incorrect math shortcut surface color and one-column editor layout each failed the expected standalone component assertion; CSS restored afterward. |
| `git diff --check` | Passed after restoring all deliberate mutations. |

The full Rails system suite was subsequently rerun three times, as recorded in Phase 6. The full desktop E2E harness, macOS-native leg, and CI after-change metrics remain unverified. The static component runner was exercised directly; the full `run.mjs` path was not run locally because the E2E harness would compete with the existing development server's port 3000.

## Phase 4: security and correctness coverage (partial)

### Coverage added

| Area | Change |
| --- | --- |
| Remote image SSRF boundary | `RemoteImageFetcher` accepts an address resolver and HTTP factory at construction; its production class method still uses the system resolver and `Net::HTTP`. A new service test drives the real URL validation, DNS classification, redirect recursion, and vetted-address pinning with controlled resolver results and an in-memory HTTP transport. It covers a private redirect destination, a public-to-private DNS change on the second lookup, decimal and hexadecimal loopback host forms, IPv4-mapped IPv6 loopback, rejected schemes/ports/credentials, non-HTTPS redirects, a safe HTTPS redirect, and the redirect-count limit. No DNS lookup or network connection occurs in these tests. |
| PPTX remote image limits and responses | Added service cases for the 10 MB per-image limit, 30 MB aggregate limit, unsupported remote content type, and title-based safe filename generation. |
| GitHub issue URL and API behavior | `GithubIssueCreator` tests now cover the HTTPS/host/repository path allowlist, 401/404/500/503 mappings, and both timeout and socket-error fallback messages. |
| Shared editor data projection | Added a helper test that captures the `editor_preview` call and checks the source/title overrides, presentation mode/id, theme/typography, margin flags, media resolver, remote-media policy, and same-workspace linkable documents/aliases. |
| New-work endpoints | Added request tests for `POST /documents/start` and `POST /presentations/start`, including record creation, redirect target, notice, and default source. |
| Ruby renderer fallback | Added environment-scoped tests that select `ELEF_RENDERER=ruby` and exercise Redcarpet HTML filtering, Rouge highlighting, KaTeX rendering, protected math inside code, and the media resolver. |
| Work package request endpoints | Added document and presentation archive download tests that inspect response headers and archive contents, plus multipart `.elef` import requests that verify the imported record and redirect. The service round-trip tests remain the content and asset oracle. |
| Presentation release and fork branches | Added renderer-version and asset-manifest stale-release tests, a dirty-parent fork that verifies the checkpointed origin source and revision id, and the self-parent validation case. |
| Bug report rate-limit UI | Added a plain-module unit test for the explicit 429 guidance and a browser test that exercises the real Stimulus action, checks the message, and confirms expected/actual/steps fields survive the response. |
| Native document save recovery | Extended the Rust crash-at-each-save-point test to reopen the deck after each of 200 process kills and assert it returns exactly the previous complete source or the fully committed replacement. |
| Presentation folder synchronization | Added assertions for the same-size asset write skip, removal after detaching an asset, and the rescue-to-nil path. Existing test-created files stay under the per-process `tmp/storage/presentations` tree and are removed by each test. |
| Legacy release import | The legacy importer request fixture already includes a publication timestamp; assertions now verify the imported legacy renderer version, pinned source revision, timestamp, and stale state. |
| Small service edges | Added `RenderCache.fetch` cache-hit coverage, blank/case/no-match `Snippet.search` cases, CRLF reproduction-step normalization, and a bug-report user-agent matrix for Edge, Opera, Safari, iOS, Android, ChromeOS, Linux, environment build id, and truncation. |
| Hostile-document external-media policy | Web and native adapters now declare `allow-remote` and `reject-remote` explicitly. The shared scenario asserts the web host retains the fixture's remote image source and the native host emits neither external media nor remote requests; an E2E unit test covers both policy outcomes and rejects undeclared policies. The web request remains intercepted and no external request is sent during this test. |
| Source/visual editor persistence parity | Extended the existing document alignment test to assert the exact saved Markdown after visual edits, wait for autosave to become idle, reopen the edit page, and confirm directives still drive visual alignment after switching modes. Comparisons normalize CRLF, which the browser editor exposes in its source field. |
| Stimulus controller logic | Added direct tests for dirty-state ordering/navigation, autofocus without scrolling, and print video cleanup. Nine more tests exercise command search and stale-response handling, snippet ranking, heading-aware page grouping, lineage lane/column layout, Mermaid render-frame coalescing, canvas scaling, and presentation/visual source-map shifts. `math_shortcut_palette` already has direct behavior coverage in `math_shorthand.test.mjs`; `library_search_controller` delegates to `filterLibraryCards`, whose behavior is covered in the shared filter tests. |
| Archive import hardening | The audited tree already rejected traversal, Unix symlink entries, and extreme compression ratios. Added tests for malformed `elef.json`, a declared extraction size above 500 MiB, and Windows drive, backslash traversal, absolute, and control-character member names. The oversize case mutates a tiny ZIP's central-directory size so the guard is exercised without creating or extracting a huge file. |
| Updater guard logic | Extracted the existing version syntax check, exact requested/offered version comparison, and atomic install lease acquisition into helpers used by `install_update`. Added tests for safe, malformed, and overlong versions; a changed offered version; concurrent install rejection; and lease release after scope exit. No updater signature, prompt, staging, or release behavior changed. |
| Tauri IPC capability enforcement | Added a Tauri `MockRuntime` IPC test built from the production `tauri.conf.json` and capability manifest. It invokes the registered `pending_open_elef_count` command successfully from Elef's local origin and verifies rejection from `https://untrusted.example`. This exercises Tauri's runtime ACL resolution with production capability data; it does not substitute for native WebView checks on each OS. |

### Phase 4 validation

| Command / check | Result |
| --- | --- |
| Focused Rails controllers, helper, GitHub issue, PPTX export, and remote image fetcher suites on disposable SQLite | 110 tests, 1,171 assertions, passed |
| `cargo test --manifest-path desktop/Cargo.toml -p elef-core --locked` | 43 tests passed (the audited baseline had 40 `elef-core` tests). |
| `cargo test --manifest-path desktop/Cargo.toml -p elef-desktop --lib --locked` | 7 tests passed, including the remote-origin IPC rejection and updater guard tests. |
| `cargo fmt --manifest-path desktop/Cargo.toml --all -- --check` and `python3 desktop/scripts/check_architecture.py` | Passed after the Rust changes; the capability/architecture check still found 23 commands. |
| Focused Ruby renderer, release/fork, controller, and service suites on disposable SQLite | 165 tests, 1,245 assertions, passed. |
| `node --test test/javascript/editor_lifecycle_controllers.test.mjs` | 4 direct controller logic tests passed. |
| `node --test test/javascript/controller_logic.test.mjs` | 9 direct logic tests passed for command search, snippet ranking, document pagination, lineage layout, Mermaid frame coalescing, canvas scale, and presentation/source map updates. |
| `node --test test/javascript/bug_report_response.test.mjs` | 2 tests passed. |
| `npm run test:unit --prefix desktop/e2e` | 15 passed, including explicit web/native hostile-media policy checks. |
| `test/system/bug_reports_test.rb` on headless Chromium with disposable SQLite | 1 test, 34 assertions, passed. |
| Focused source-directive visual-edit/save/reopen system test on headless Chromium with disposable SQLite | 1 test, 35 assertions, passed. |
| `npm run test:javascript` | 446 tests passed at this phase checkpoint after adding the 429 helper tests; the current-tree count is 459 (see Phase 6). |
| `npm run build --prefix desktop/frontend` | Passed with the new Rails-owned helper imported by the shared controller. |
| `cargo test --manifest-path desktop/Cargo.toml -p elef-core --locked killing_a_process_at_each_save_point_preserves_complete_bytes_and_cleans_temp_files` | Passed; after each of 200 injected process kills, reopening returned the exact complete old or committed source. |
| Full non-system Rails suite on disposable SQLite after the added coverage | 391 tests, 3,167 assertions, 0 failures, 0 errors, 0 skips. |
| `cargo test --manifest-path desktop/Cargo.toml --workspace --locked` | 43 `elef-core` and 7 desktop library tests passed, including archive, update-install interruption, and updater guard cases. |

## Phase 5: security mutation checks (partial)

| Mutation or restore check | Result |
| --- | --- |
| Manual mutant: private-address filter always returns false | Detected by the redirect-to-private and alternate-IP assertions. |
| Manual mutant: protocol/port/userinfo guard removed | Detected by the disallowed URL test before any real network access. |
| Manual mutant: vetted `ipaddr` assignment removed | Detected by direct and redirect tests that assert the selected public address is pinned into the HTTP client. |
| Manual mutant: allow an explicit remote URL in the production `main-capability` | The IPC runtime test failed because the remote command became invokable. The capability file was restored after the experiment. |
| Manual mutant: accept every offered updater version | The exact-version unit test failed on `0.2.0` versus `0.2.1`; the source was restored after the experiment. |
| Manual mutant: accept ZIP member names containing backslashes | The malicious-filename test failed on `nested\\..\\outside.md`; the source was restored after the experiment. |
| Manual mutant: remove the archive control-character check | `archive_import_rejects_malicious_member_filenames` failed on `control/\\u{7f}name.md`; the source was restored. |
| Manual mutant: change the bug-report 429 status guard to 400 | The focused unit test failed because it received the generic server detail instead of the rate-limit guidance; the source was restored. |
| Manual mutant: bypass the declared external-media policy in the shared hostile-deck scenario | The E2E unit case failed for the relevant web or native policy; the scenario source was restored. |
| Manual mutant: remove the exact `github.com` hostname check from `safe_issue_url` | The focused GitHub issue service suite failed on `https://github.com.evil.test/acme/elef/issues/27`; the host check was restored. |
| Manual mutant: remove the HTTPS requirement from `safe_issue_url` | The focused service test failed because `http://github.com/acme/elef/issues/27` was returned as a trusted link; the guard was restored. |
| Restore check: archive malicious filenames | The targeted Rust test passed after restoring the control-character guard (1 test). |
| Restore check: GitHub issue URL allowlist | The focused service suite passed after restoring the HTTPS guard (7 tests, 97 assertions). |

The new fetcher seam is only used by focused unit tests; the default production path remains `Addrinfo.getaddrinfo` followed by a `Net::HTTP` connection pinned to the checked address. Archive import path/manifest/size guards, native interrupted-save reopening, updater version/install locking, production-capability IPC checks, Ruby renderer fallback, work-package request paths, release source/title/asset/renderer staleness, dirty-parent/self-fork validation, folder-sync cleanup, legacy release import, bug-report environment classification, the 429 UI, and explicit host media policies now have the coverage described above. The native IPC test uses Tauri's `MockRuntime` with production capability data; Linux Wry/WebKit and macOS native WebView execution still require post-change CI. Artifact-level PPTX validation, the updater activation/backup safeguards, and stale-presentation autosave conflict handling were already covered at the audit commit and remain covered. The remaining Phase 4 check is running the changed native/web host E2E topology on CI.

The updater signature rejection scenario is present, but I did not mutate the Tauri plugin/config signature-verification path locally. That oracle runs inside native WebDriver scenarios, and the full harness cannot be run alongside the existing development server on port 3000. This is an uncompleted mutation check, not evidence of a surviving mutant; the post-change native CI run remains necessary.

## Phase 6: local repeat validation

Each locally runnable suite below completed three consecutive runs. The system tier was rerun three times after the final system-test edits, serially with `PARALLEL_WORKERS=1`, headless Chromium, and a dedicated SQLite test database. All three current-tree system runs passed, including the three separately isolated library card tests. The JavaScript suite was rerun three times after adding the controller tests; other tiers were unchanged by the subsequent system- or JavaScript-only adjustments. This is a small stability sample, not a statistical flake-rate estimate.

| Suite | Three-run result | Local elapsed times |
| --- | --- | --- |
| Rails system tests (`test/system`) | 229 tests and 5,639 assertions passed on every current-tree run; 0 failures/errors/skips. The baseline had 241 system tests before the verified demotions. | 438.74s, 443.16s, 378.95s |
| Rails system tests with two local workers (diagnostic only; before the library card test split) | After namespacing the PDF probe files, 227 tests and 5,636 assertions passed in all three runs; 0 failures/errors/skips. Median wall time was 210.02s versus 334.59s serial (37% lower on that host revision). | 202.24s, 210.02s, 211.82s |
| Rails non-system tests (`bin/rails test`) | 391 tests and 3,167 assertions passed on every run; 0 failures/errors/skips. | 4.11s, 3.73s, 4.13s |
| Rails-owned JavaScript (`npm run test:javascript`) | 459 tests passed on every current-tree run, including the 13 listed Stimulus controller behaviors. | 1.76s, 1.77s, 1.90s |
| Rust workspace (`cargo test --manifest-path desktop/Cargo.toml --workspace --locked`) | 43 `elef-core` plus 7 desktop library tests passed on every run. | Core test execution: 2.28s, 2.26s, 2.39s |
| Desktop frontend adapters (`npm test --prefix desktop/frontend`) | 26 tests passed on every run. | 0.32s, 0.33s, 0.40s |
| E2E harness unit tests (`npm run test:unit --prefix desktop/e2e`) | 15 tests passed on every run, including host media policy cases. | All three invocations passed. |
| Standalone Chromium components (`npm run test:components --prefix desktop/e2e`) | 4 tests passed on every run without Rails or a database. | 1.8s, 1.6s, 1.7s |

These are local Linux timings and cannot be compared directly to the hosted PR workflow. The workflow changes have not run on GitHub, so there is no post-change CI wall-time, p95, runner-minute, retry, or attestation result. The macOS native WebView and offline leg were not executable on this host. The full desktop harness was not run because the repository instructions prohibit competing with the existing development server on port 3000.

### System-test parallelism audit

Before the two-worker diagnostic, I checked shared databases, files, service state, editor state, and ports. Rails supplies a separate test database to each worker; `Presentations::FolderSync` already uses `Process.pid`; ActiveStorage disk keys are unique; each Capybara server selected its own ephemeral port; and Rails service/controller state is process-local. The concrete collision was `MediaPdfExportTest` writing `tmp/pdfs/origin-screen.png` and fixed PDF probe names. Both paths now include the worker PID. Three two-worker local system runs passed after this change. The Linux CI job remains at `PARALLEL_WORKERS=1`: local results show a wall-time gain, but the requested repeated hosted CI evidence is unavailable, and parallelism does not reduce total runner compute.

## Commit map

- **Phase 0:** `8298ff5` records the audited baseline metrics and inventory.
- **Phase 1:** `dba6a44` removes verified repeated PR test invocations while preserving required jobs.
- **Phase 2:** `18063aa` corrects vacuous and overclaimed assertions; `0a845c1` removes a transient upload-status race while retaining final-state checks.
- **Phase 3:** `777c20b` moves browser assertions to cheaper layers; `efb091e` demotes folder checks and replaces fixed autosave sleeps; `3d4bde2` reduces a large geometry fixture; `5b2422c` namespaces shared PDF artifacts; `4ace9f0` splits the multi-claim library-card system test.
- **Phase 4:** `1836c06` covers SSRF boundaries; `cf024aa` covers archive and updater guards; `2fa433f` adds Rails and native persistence coverage; `e294505` makes host media policy explicit; `16b32d4` verifies source/visual persistence parity; `3b3b437` and `747a68d` add controller logic tests.
- **Phase 5:** `93717e4` and `6ffb4c8` correct verified claims and record mutation results and open checks.
- **Phase 6:** `c2622f1` records repeated local results; `8777f28` records remaining audit gaps. Later system-test runs after `4ace9f0` are included in `6ffb4c8`'s report updates.

## Maintainer approval decisions

The maintainer approved the following workflow decisions in this session, and those changes are implemented with job names and required check membership preserved:

- Run pure JavaScript and frontend adapter suites once, keep one shared web browser stage, preserve Linux/macOS native scenarios and the updater sequence, scope Linux Rust tests to the desktop library, and cache Chromium.
- Narrow PR SQLite coverage after documenting the PostgreSQL/SQLite differential matrix; retain the full SQLite suite on a weekly schedule and manual dispatch.
- Move the 20-launch measurement out of required PR jobs, use a parameterized 10-launch scheduled/manual run, and update the architecture check, CI contract, attestation schema, and deployment verifier together.

No removal of the `ELEF_RENDERER=ruby` path is proposed; it remains live code and must be tested before any future removal request. Release packaging and updater signature checks remain unchanged.

Cross-job artifact reuse remains unimplemented. The renderer bundles are common outputs, while Tauri build outputs are OS-specific. Reusing the renderer bundles would require adding artifact transfer and `needs` dependencies from a producer to existing required jobs; the audit prompt requires maintainer approval before changing a required-job relationship. The baseline timing data does not isolate the renderer build duration, so the expected savings are not established. Approval is needed to add those dependency edges, or the maintainer can leave each platform job building locally.

## Not yet verified

- Remaining Phase 3 runtime work: artifact reuse and hosted CI confirmation before changing system-test worker count. The library card system test with six `visit root_path` calls is split into three focused tests; total root-route transitions are unchanged, so this is a test-isolation improvement rather than a runtime optimization. The proposed projection caching was skipped because `wait_for_fresh_projection` is only a state wait, not a request trigger, and independent tests cannot share editor projections safely.
- The changed GitHub workflows have not executed yet. Local contract tests verify their job names, invocation ownership, required job manifest, attestation policy, and schedule placement, but only CI can validate hosted runner installation and native execution.
- Phase 4 still has post-change platform verification gaps. Both Linux and macOS already run shared scenarios with external network access denied, and both jobs passed in the audited baseline workflow; the changed job topology needs a new hosted run. All 13 controllers in the original no-unit-test list now have logic coverage: new tests cover the eight remaining nontrivial controllers, `math_shortcut_palette` is exercised by `math_shorthand.test.mjs`, and the `library_search` behavior is exercised through its shared `filterLibraryCards` implementation. The hostile-media policy assertions passed as unit tests, but actual web/native host scenarios require a hosted E2E run.
- Phase 5 mutations were detected for SSRF address/protocol/pinning decisions, remote-origin IPC, updater version matching, archive filename/control-character validation, GitHub issue URL hostname/HTTPS validation, bug-report 429 handling, and both external-media host policies. The Tauri updater's bad-signature scenario is covered but its signature-verification boundary was not mutated locally; the native CI run is still required. Other unmutated trust-boundary branches remain open work.
- Phase 6 repeated local checks passed as listed above. The changed hosted workflow, exact required-job attestations on the new tree, macOS native behavior, post-change CI p95/runner-minutes, and the performance acceptance targets remain unverified. The 20% wall-time and 25% runner-minute goals are not claimed.
