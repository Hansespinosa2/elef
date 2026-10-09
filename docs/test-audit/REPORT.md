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

## Phase 2: correct misleading tests

The source-level claims below were checked against the audited tree before editing. The following test changes are in the working branch; no required job, job trigger, verifier, attestation, or release behavior has changed.

| Change | Reason and evidence |
| --- | --- |
| Replaced the two `assert_no_difference { nil }` blocks in `test/lib/tasks/elef_work_rake_test.rb` with assertions around the actual invalid import invocations. | The old blocks executed no application behavior. The replacement still checks the usage error and that no `Work` is created. |
| Removed the two hardcoded `baseline_commit` comparisons in `test/lib/source/presentation_reveals_baseline_test.rb` and the equivalent JS reveal-golden provenance comparison. | Each compared a hardcoded SHA with metadata in the same fixture. The HTML and editor-map output comparisons remain. Fixture SHA metadata is retained as provenance. |
| Deleted `document_sample_data_test.rb`'s report-length fixture test. | It only checked the length and headings of a constant. The other sample-data tests still exercise catalog loading, idempotent seeding, rendering, warnings, and graph behavior. |
| Renamed and strengthened the PPTX service determinism test. | It now constructs two independent `Presentation` and `PptxExport` instances per fixture, compares the complete payloads, and checks an independently specified title and filename. |
| Strengthened “presents from the edit screen without submitting the editor form.” | It changes the source, holds the autosave request, verifies the dirty state, accepts the navigation confirmation, and verifies that the persisted source stayed original. The focused system test passed. |
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

These changes move selected assertions to lower layers and consolidate tests that exercise the same implementation. The phase is incomplete: worker-safety/parallelism work, projection reuse, geometry fixture reduction, and post-change CI measurements remain open. No workflow YAML, required job definition/name/gate, trigger, verifier, attestation, or release rule changed. The desktop E2E runner now invokes the static component browser suite before Rails database fixture setup; the shared web → native → updater sequence and parity scenarios are unchanged.

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

### Phase 3 validation

| Command / check | Result |
| --- | --- |
| `npm run test:javascript` | 444 passed |
| Focused changed Rails controller/model/service suites on disposable SQLite | 173 tests, 1,366 assertions, passed |
| `npm run test:components --prefix desktop/e2e` | 4 standalone headless Chromium tests passed without Rails or a database |
| `npm run test:unit --prefix desktop/e2e` | 10 passed |
| Focused Rails renderer facade fixture loop | 20 tests, 85 assertions, passed |
| Selected remaining print, PDF, presentation styling, Mermaid rendering/editor, and reconnect system tests | 6 tests, 28 assertions, passed on headless Chromium with disposable SQLite |
| Deliberate break checks for moved controller assertions | Published release selection, application body class, and presentation-mode body class mutations each failed the expected controller test; source restored afterward. Earlier targeted break checks for href, print surface, controller token, warning, alignment, Art position, and Art fallback are listed above. |
| Deliberate CSS mutations | Incorrect math shortcut surface color and one-column editor layout each failed the expected standalone component assertion; CSS restored afterward. |
| `git diff --check` | Passed after restoring all deliberate mutations. |

The full system suite, full desktop E2E harness, macOS-native leg, and CI after-change metrics were not rerun in this partial phase. The static component runner was exercised directly; the full `run.mjs` path was not run locally because the E2E harness would compete for the existing development server's port 3000.

## Phase 4: security and correctness coverage (partial)

### Coverage added

| Area | Change |
| --- | --- |
| Remote image SSRF boundary | `RemoteImageFetcher` accepts an address resolver and HTTP factory at construction; its production class method still uses the system resolver and `Net::HTTP`. A new service test drives the real URL validation, DNS classification, redirect recursion, and vetted-address pinning with controlled resolver results and an in-memory HTTP transport. It covers a private redirect destination, a public-to-private DNS change on the second lookup, decimal and hexadecimal loopback host forms, IPv4-mapped IPv6 loopback, rejected schemes/ports/credentials, non-HTTPS redirects, a safe HTTPS redirect, and the redirect-count limit. No DNS lookup or network connection occurs in these tests. |
| PPTX remote image limits and responses | Added service cases for the 10 MB per-image limit, 30 MB aggregate limit, unsupported remote content type, and title-based safe filename generation. |
| GitHub issue URL and API behavior | `GithubIssueCreator` tests now cover the HTTPS/host/repository path allowlist, 401/404/500/503 mappings, and both timeout and socket-error fallback messages. |
| Shared editor data projection | Added a helper test that captures the `editor_preview` call and checks the source/title overrides, presentation mode/id, theme/typography, margin flags, media resolver, remote-media policy, and same-workspace linkable documents/aliases. |
| New-work endpoints | Added request tests for `POST /documents/start` and `POST /presentations/start`, including record creation, redirect target, notice, and default source. |

### Phase 4 validation and mutation evidence

| Command / check | Result |
| --- | --- |
| Focused Rails controllers, helper, GitHub issue, PPTX export, and remote image fetcher suites on disposable SQLite | 110 tests, 1,171 assertions, passed |
| Manual mutant: private-address filter always returns false | Detected by the redirect-to-private and alternate-IP assertions. |
| Manual mutant: protocol/port/userinfo guard removed | Detected by the disallowed URL test before any real network access. |
| Manual mutant: vetted `ipaddr` assignment removed | Detected by direct and redirect tests that assert the selected public address is pinned into the HTTP client. |

The new fetcher seam is only used by focused unit tests; the default production path remains `Addrinfo.getaddrinfo` followed by a `Net::HTTP` connection pinned to the checked address. This phase remains incomplete; archive import, updater, IPC permissions, document persistence, release staleness/fork branches, FolderSync cleanup, renderer fallback, bug-report environment matrix/429 UI, and the other listed gaps remain open.

## Maintainer approval required before workflow changes

No workflow definition or authorization behavior has been changed. Before changing required workflow commands, triggers, or gates, I will present the concrete change set for approval. Decisions needed before merge are:

- Whether to remove duplicate commands from required jobs and split the shared web E2E phase so it runs once, while preserving the Linux/macOS native phases, updater sequence, scenario parity gate, and all required job names.
- Whether to narrow the PR SQLite run to tests with PostgreSQL/SQLite behavior differences, and where the full SQLite compatibility run should remain.
- Whether to move the benchmark out of the PR path. It currently fails the required `desktop` job if it fails, so moving it changes release/deployment authorization gating; the workflow verifier, attestation, and contract tests would need a coordinated update.
- Whether to remove the `ELEF_RENDERER=ruby` fallback if later evidence establishes it is dead. It is currently present and will be tested before any removal proposal.
- Any proposed change to release packaging or updater signature checks. No such change is included in this audit.

## Not yet verified

- Remaining Phase 3 runtime work: shared system-test projection caching, reducing the 84-presentation geometry fixture, splitting the repeated root visits, worker isolation/parallelism experiments, and artifact reuse.
- Phase 1 workflow deduplication and the proposed SQLite/benchmark changes are held for maintainer approval; no job definitions or release gates have changed.
- Phase 4 security/correctness coverage, Phase 5 security mutation campaigns, and Phase 6 repeated-run/CI measurements remain incomplete.
- No post-change timing comparison, three-run stability check, or final PR CI result exists yet. The acceptance targets are therefore not claimed.
