# Phase 0 plan — Baseline and factual verification

Status: FROZEN at 2026-10-07 (hash recorded in `docs/refactor/status.json`)
Phase contract: `docs/refactor/phases/00-baseline.md` (sha256 `57a5419cace79af009b9b2889cd0aa8cd481b1de561a582214d8adea883394ce`)
Phase base: `88f61a7a8ffd7c276bafcf06eee09c36a8adf134`

## 1. Verified facts

| Fact | Evidence (file:line or command → result) |
|---|---|
| Campaign branch and remote | `git branch --show-current`, `git status --short --branch`, `git fetch --no-tags origin`, `git rev-parse HEAD origin/feat/refactor-desktop-and-web` → `feat/refactor-desktop-and-web`; local HEAD equals remote at `22efe0d2f8fd0f7a868f37c85e3a9a2d5413d175`. Draft campaign PR #136 targets `dev`, verified with `gh pr view 136 --json ...`. |
| Campaign base and pre-refactor ancestry | `git show -s --format='%H %P %s' 88f61a7...` → base `88f61a7a8ffd7c276bafcf06eee09c36a8adf134` has parent `b266299838deddec2d00fef80f6c5bbebb4c607e`; that merge's second parent is `f9e00e026ab4249d99dc2fe0816ace6e3e5331db`. `git merge-base --is-ancestor f9e00e0... 88f61a7...` exits 0. The named `feat/desktop-app-v1` branch is no longer published; its merged tip remains present as the merge parent. |
| Resume state and current diff | `campaign_state.py reconstruct`, `validate`, `git diff --stat 88f61a7...HEAD`, and `git diff --name-only ...` → earliest unproven phase is 0; no Phase 0 plan, gate, or review exists; phase remains PLAN; changed paths since base are agent-workflow/docs setup and contain no product code. The current Phase 00 contract hash matches status. |
| Actual execution environment | `campaign_state.py probe` → Linux x86_64, 7,966 MB RAM, 0 MB swap, 4 CPUs, 35,339 MB free disk at freeze preparation, display `none`; Node 22.23.2/npm 10.9.8, Ruby 3.3.8, Cargo/rustc 1.99.0, Python 3.12.14; Chromium and PostgreSQL clients are absent. The saved status previously described a different runner and is corrected by `campaign_state.py set-env`. |
| Native runner capability | `campaign_state.py probe` → unavailable because `tauri-driver`, `WebKitWebDriver`, and `xvfb-run` are absent. `.github/workflows/ci.yml` installs the Linux WebKit/display dependencies and runs WebDriverIO under D-Bus and Xvfb; the exact-HEAD CI run below completed that job successfully. |
| Locked toolchains and workspaces | `.ruby-version` is 3.4.3; `.github/workflows/ci.yml` sets Node 22, Ruby from `.ruby-version`, and stable Rust. `Dockerfile` uses Ruby 3.4 Trixie and installs `nodejs` for asset compilation; `Gemfile.lock` pins Rails 8.1.3.1 and MiniRacer/libv8-node. Root `package.json` and `package-lock.json` own Rails JavaScript; desktop has separate frontend/E2E lockfiles and a Cargo workspace at `desktop/Cargo.toml`. There is no root Cargo workspace or `apps/`, `packages/`, `crates/`, `spec/`, `tests/`, `tooling/`, or `ops/` directory. |
| Local dependency readiness | `test -d node_modules`, `test -d desktop/frontend/node_modules`, `test -d desktop/e2e/node_modules`, and `bundle check` → all dependency directories are absent and locked Ruby gems are missing. Local Ruby is 3.3.8 while the repository pins 3.4.3. |
| CI jobs and OS tiers | `.github/workflows/ci.yml` has Linux desktop-fast, Ruby/JS scans, PostgreSQL Rails tests, SQLite tests, Rails system tests, full Linux Tauri/WebDriver, production/development smoke, and macOS 15 Tauri plus renderer jobs. No workflow path filters are present. Exact-HEAD run `37601674921` (2026-10-07, HEAD `22efe0d...`) succeeded; job durations are recorded from `gh run view 37601674921 --json jobs`. `desktop-fast` took 34 s, full Linux desktop 15m42s, macOS desktop 13m10s, Rails system tests 7m40s, Rails tests 48s, and overall run about 16m. |
| Existing architecture/ownership checks | `script/check_frontend_ownership.py` enforces one-way ownership from Rails-owned shared frontend sources into the desktop build and guards forbidden duplicate/shared imports. `desktop/scripts/check_architecture.py` checks Tauri command/capability/CSP policy, production-vs-test permissions, feature flags, and renderer bundle identity. `test/architecture/source_language_boundaries_test.rb` guards Rails source-language ownership and shared rendering. There is no root `bin/check` command yet. |
| Current renderer owners and runtime paths | `script/build_renderer.mjs` bundles `app/javascript/lib/renderer_global.js` and its modules into `vendor/javascript/elef-renderer.bundle.js`. `app/lib/source/javascript_renderer.rb` calls that bundle through MiniRacer for Rails server-side render/model operations; the Ruby renderer remains a fallback. `desktop/frontend/src/renderer-worker.js` loads the same bundle in a web worker. |
| Renderer fixtures and browser runners | `test/javascript/renderer_fixtures.test.js` runs the 14 input/output rows in a Node VM; fixture SHA-256 values are inputs `f4e96603b40eb2f5a6c92791827aab59e5979f3d5ccc52babcfe913911bdbfe2`, outputs `0ada6d346642d7d27007d4fa1cb81295af45bf36ad29727715b489cd11957e62`. The Playwright web project uses Chromium, and the Tauri project uses WebdriverIO. The current fixture test is not a single three-runtime Node/Chromium/Tauri conformance suite. |
| Shared workflow scenarios | `test/e2e/scenarios/` contains 14 modules: `appearance`, `authoring-palettes`, `authoring-settings`, `document-page-aspect-ratio`, `edit-and-preview`, `external-edit-conflict`, `hostile-deck`, `insert-image`, `library-and-graph`, `library-create-delete`, `media-fixture`, `presentation-mode`, `undo-redo-session`, and `vim-relative-line-numbers`. `desktop/e2e/run.mjs`, `playwright.config.js`, and `wdio.conf.js` adapt those flows to web and native hosts. |
| Outside-file updates and recovery | `app/javascript/lib/file_library_application.js` polls `readSourceSnapshot` every 2 seconds while a desktop deck is open. `desktop/crates/elef-core/src/lib.rs` fingerprints selected source files, detects stale writes, uses atomic replacement and retains the current disk source in conflicts. Shared save flow supports reload, keep-local, and merge choices; `external-edit-conflict.js` exercises the workflow. ADR-008 documents the remaining check-to-rename race and its 250 ms p95 ceiling. |
| Graph identity and metadata | `app/lib/document_links/graph.rb` passes database IDs, titles, URLs, portable keys, aliases, and source to the shared renderer. `app/javascript/lib/document_links.js` resolves explicit `document:` keys, IDs, aliases, and titles while leaving ambiguous metadata unresolved. ADR-010 stores portable `elef_document_key` and `elef_aliases` in Markdown front matter; desktop deck UUIDs live in `elef.json`. |
| Desktop ADR inventory and documented gaps | `docs/desktop/adr/README.md` lists 10 ADRs: 001, 005, 006, 008, 010 accepted; 002, 003, 004, 007, 009 proposed. Open issues name web/desktop Preview and Present differences, missing desktop fork actions, deferred lineage, shared renderer parity/rollback evidence, device acceptance, and production updater-key custody. ADR-001's former last-write-wins rule is explicitly superseded by ADR-008; the current desktop data/transport guides describe the amended behavior. |
| Current host layout, routes, and deployment | `config/routes.rb` gives Rails the root library and web routes for settings, search, snippets, math shortcuts, documents, presentations, history, export, publishing, and media. `app/views/layouts/application.html.erb` is the web layout; `app/views/desktop_host.html` is the static desktop shell packaged by `desktop/frontend/build.mjs`. `docs/mac-mini-deployment.md` documents the machine-local watcher and dev/prod paths; watcher install scripts are referenced as host-side operations and are not present in this checkout. CI gates deployment-ref publication on exact tested-tree attestation via `scripts/verify-deployment-authorization` and `scripts/publish-deployment-ref`. |
| Desktop URLs and web-only pages | `desktop/src-tauri/tauri.conf.json` registers `.elef` file association and an HTTPS updater endpoint. No custom deep-link plugin or URL protocol handler appears in the Tauri config or dependencies. Rails routes include history/export/publish/fork and server-backed library/settings operations that do not have corresponding desktop URLs. |
| Framework-neutral modules and Stimulus glue | `app/javascript/controllers/` has 40 controller files and `app/javascript/lib/` has 37 modules. Rails owns both; controllers connect DOM/Stimulus behavior, while library, save, renderer, link, graph, and adapter-flow modules contain reusable behavior. Desktop supplies host adapters in `desktop/frontend/src/`; the ownership checker records the current dependency direction. |
| Current HTML insertion/sanitization | `app/javascript/lib/preview_sanitizer.js` parses preview output, applies element/attribute/protocol allowlists, then replaces the live container children. Other `innerHTML` uses include static view templates, KaTeX, Mermaid SVG, graph edge markup, and PPTX staging. The current source has more than one HTML insertion site; Phase 00 records these without changing the security boundary. |
| Current generated build references | Tracked Rails artifacts at this source revision are `vendor/javascript/elef-renderer.bundle.js` SHA-256 `bfcb4693b07684d54526e2e3a564735f1323d3ccbcdb24fc7c4c79f3fa73c9fe` and `app/assets/builds/tailwind.css` SHA-256 `35eed9a0dc2ebb06d6661e80250fe962cc44c3c494a4d401377dcd3051883de1`. The desktop `dist/` is generated and absent in the clean checkout. Exact-HEAD CI run `37601674921` passed Rails renderer/Tailwind builds, desktop frontend build, Linux desktop package, macOS Apple Silicon package, Rails tests, and host scenarios; this identifies `22efe0d...` as the reproducible pre-migration rollback build source. |
| Existing product performance probes and ceilings | The Linux/macOS `desktop/e2e/benchmark-native.mjs` runs 20 fresh release processes over cold start, 100-slide open, and 1,000-deck library; hard budgets are 1,500/300/500 ms p95. Exact-HEAD artifacts report Linux medians 879/1,277/373.5 ms and p95 906/1,314/455 ms (100-slide open misses); macOS medians 2,259.5/1,082.5/140.5 ms and p95 2,442/1,209/196 ms (cold start and 100-slide open miss). `script/benchmark_shared_renderer.rb` measures a 100-slide renderer input; run 37601674921 logged Apple Silicon cold preview 161.65 ms, JS block p95 24.2 ms, JS projection p95 98.47 ms, Ruby fallback block p95 41.47 ms. The Rust core test enforces a 250 ms p95 fingerprint-check-to-rename ceiling. |
| CI product artifact identity | Exact-HEAD CI run `37601674921` succeeded on the current checked-out SHA and produced `native-performance-linux.json` and `native-performance-darwin.json`; the baseline records their run URL, source SHA, runner OS/architecture, medians, p95 values, and existing misses. This is the comparable product-performance baseline until owner-approved replacement. |

Open questions / unknowns (each is a blocker or has a resolution step):

- Local cold-bootstrap and warm fast/affected proxy timings are not measured. In DO, install only locked user-space dependencies, measure the cold install separately, then measure the existing desktop-fast command set and a named shared-renderer affected command warm. `bin/check quick` and `affected` do not exist yet; record proxy names and do not claim these are canonical tier timings.
- The local runner cannot exercise WebKit/Tauri because the exact native tools are missing. Use the exact-HEAD Linux/macOS CI jobs as build/runtime evidence and record local unavailability; do not emulate native PASS.
- The local Ruby version does not match `.ruby-version`; the exact-HEAD CI run used Ruby 3.4.3. Local Rails commands are conditional on access to the locked Ruby runtime and gems; the baseline must record the actual resolution and avoid claiming a local Rails pass if unavailable.

## 2. Scope

In scope:

- Add `docs/refactor/baseline.md` and `docs/refactor/baseline.json` with source-linked facts, exact environment, check inventory, scenario and fixture hashes, current CI job timing, performance samples, cold bootstrap, warm named proxies, and build rollback identity.
- Add root `bin/check` as a dependency-free command interface. Implement only the Phase 00 read-only gate; ensure `quick`, `affected`, `all`, `arch`, `fresh`, `docs`, and `perf` exist and return nonzero with a clear not-yet-implemented message.
- Make `bin/check phase 0 --json` consume `ELEF_GATE_STATUS_PATH` when present and validate the immutable snapshot's base, phase, plan hash, contract hash, status digest, and exact checkout HEAD. Without a gate snapshot, reject a stale candidate rather than editing status or inventing a head.
- Correct campaign status environment fields from the current probe, record state reconstruction, and advance the committed PLAN freeze to DO with the frozen plan hash.
- Rebuild and compare current Rails renderer/Tailwind and desktop frontend outputs using locked dependencies. Record the exact build commands, artifact hashes, source candidate, CI proof, and local limitations.

Non-goals:

- No product code moves, runtime/contract edits, package additions, build-system changes, UI changes, or behavior changes.
- No changes to current tests, fixture bytes, CI requirements, performance budgets, architecture allowlists, or deployment behavior.
- No system-level toolchain installation. User-space locked dependency setup is allowed; native/macOS evidence comes from the exact-candidate CI jobs already available.

## 3. Ownership classification

| Change | Semantic owner (constitution §4) | Shared or host-specific (+ concrete reason) |
|---|---|---|
| `bin/check` and Phase 00 proof logic | `tooling` / repository `bin/` | Host-neutral repository validation consumed by both hosts and campaign gates. |
| `baseline.md`, `baseline.json`, status reconstruction | `docs/refactor` campaign evidence | Describes the current product and proof sources; it is not product runtime behavior. |

Package admission: not applicable. No package, crate, workspace, or architectural directory is added.

## 4. Behavior to preserve

| Behavior | Proving test/scenario/fixture |
|---|---|
| Renderer outputs and editor maps remain byte/structure compatible | `test/javascript/renderer_fixtures.test.js`, 14 input/output fixture rows, and exact-HEAD CI `renderer-macos` and desktop jobs. |
| Shared workflows continue to run on web and Tauri | All 14 modules under `test/e2e/scenarios/`, exercised by Playwright and WebdriverIO in exact-HEAD CI. |
| Desktop external edits, save conflicts, and local draft preservation remain safe | `test/e2e/scenarios/external-edit-conflict.js`, desktop core tests in `desktop/crates/elef-core/src/lib.rs`, and ADR-008. |
| Rails routes/layout, static Tauri shell, and generated artifacts stay at the baseline revision | Exact-HEAD CI build jobs and the tracked renderer/Tailwind hashes in Section 1. |

Intended behavior changes: none; Phase 00 is factual and tooling-only.

## 5. Work breakdown

1. Record the reconstruction facts and correct only the stale execution-environment fields; keep current phase 0 PLAN and base SHA unchanged.
2. Freeze this plan by recording its SHA-256 in status, transitioning PLAN to DO, validating prospectively, and committing that checkpoint before implementation.
3. Install the locked JS/Ruby dependencies needed by available local checks without changing lockfiles; capture cold-bootstrap duration and distinguish unavailable locked Ruby/native prerequisites.
4. Measure warm named fast/affected proxies on this 8 GB-class runner. Record command, runtime versions, repetitions, median, cache state, and exit status; do not label proxies as `bin/check` tiers.
5. Add the read-only `bin/check` skeleton and baseline records. Record source hashes and current CI evidence; verify the current built outputs can be reproduced from the selected baseline source.
6. Run the implemented Phase 00 checks, then inspect the full candidate diff, status, and generated artifacts. Commit a coherent candidate before preparing its isolated gate.

Structural moves and behavior changes are not applicable; no product structure moves and no behavior changes are permitted in this phase.

## 6. Deletions and temporary compatibility

| Item | Owner | Reason | Deletion condition |
|---|---|---|---|
| None | — | Phase 00 introduces factual records and a repository check interface only. | — |

## 7. Risks and rollback triggers

| Risk | Trigger | Response |
|---|---|---|
| Baseline check can report PASS for another source tree | Status/gate snapshot head, plan, base, or contract differs from the detached candidate | Fail closed; fix the checker before a candidate is selected. |
| Verification mutates its checkout | Repeating Phase 00 changes tracked/untracked source state or generated artifacts | Fix the read-only check/build-to-temp flow and rerun on the same SHA. |
| Baseline claims exceed evidence | A toolchain, CI run, fixture, or timing value cannot be tied to a command/source SHA | Mark it unavailable with exact evidence; do not infer PASS. If P00 criteria cannot be met, return through ACT with a precise finding. |
| Existing desktop performance budget misses disappear from the record | JSON differs from the immutable CI artifacts or is omitted | Restore the artifact-derived values and preserve the original budget unchanged. |
| Resource pressure or OOM during cold install/build | Measured process/resource failure on the 4-CPU, no-swap runner | Serialize jobs, preserve caches, reduce build concurrency, and rerun without deleting user data or caches. |
| Any product behavior or baseline fixture changes | Product paths or fixture bytes differ from the frozen source without a Phase 00 criterion | Stop and revert only the phase-owned change to `88f61a7a8ffd7c276bafcf06eee09c36a8adf134`; retain unrelated work. |

Rollback reference: Phase 00 base `88f61a7a8ffd7c276bafcf06eee09c36a8adf134`; the exact current working-build source is `22efe0d2f8fd0f7a868f37c85e3a9a2d5413d175`, with successful exact-HEAD CI run `37601674921`.

## 8. Proof map

| Criterion / invariant | Proof (command, test, CI job, reviewer checklist) | Tier | Environment needs |
|---|---|---|---|
| P00-01 | `bin/check phase 0 --json` validates campaign base, immutable gate snapshot head, phase state, contract hash, and frozen plan hash against detached `HEAD`; reviewer checks the same identity in the report and ACT status. | phase 0 + review | Python 3; exact candidate checkout |
| P00-02 | Reviewer maps every Phase 00 fact in `baseline.md` to its listed source/command/CI evidence and confirms unresolved facts have explicit resolution/blocker records. | review | Read-only fresh context; GitHub CI evidence references |
| P00-03 | `baseline.json` records renderer fixture hashes/count, scenario names/count, architecture checks, measured CI job durations, Linux/macOS product metrics, environment, native capability, cold install time, and warm named proxy timings. Recompute source fixture/artifact hashes and compare. | phase 0 + review | Node 22 for local JS; Ruby 3.4.3 for Rails; native metrics from exact-HEAD CI artifact |
| P00-04 | `bin/check` command table smoke: all required names are recognized; implemented Phase 00 command returns its real verdict; every not-yet-implemented tier exits nonzero and prints its state. | quick / phase 0 | Python 3; no service |
| P00-05 | Run `bin/check phase 0 --json` twice in the same immutable gate checkout; both exit 0 with one `ELEF_PHASE_0=PASS` line and identical source status; verify `git status --porcelain` and `git diff --exit-code` are unchanged. | phase 0 | Detached gate worktree; no database or protected server |
| P00-06 | Exact source SHA, CI run/job identity, renderer/Tailwind hashes, desktop bundle hash, and documented reproduction commands identify both rollback builds; reviewer checks successful exact-candidate Rails and Linux/macOS desktop build jobs. | phase 0 + review | Current exact-HEAD CI run; local Node/Ruby builds when toolchains permit |
| I01, I16, I17 applicability | No package, architectural boundary, or client feature module is created or moved; reviewer checks the diff and the recorded current violations without expanding any allowlist. | review | Repository diff |
| I06, I07, I09, I13, I14 | No behavior/budget/fixture weakening; baseline and status match commands and exact candidate; missing capabilities remain explicit; no compatibility path is added. `git diff --check`, Phase 00 gate, and reviewer inventory verify this. | quick / phase 0 + review | Repository checkout |

Fixed fixture sets / finite reviewer checklists required by the contract:

- Renderer fixtures: the 14 rows in `test/javascript/fixtures/renderer-inputs.json` and `renderer-outputs.json`, exact SHA-256 values recorded above.
- Shared scenarios: all 14 named modules in Section 1, with web and native runner structure checked from `desktop/e2e/`.
- HTML boundary: all `innerHTML`, `insertAdjacentHTML`, and `dangerouslySetInnerHTML` occurrences in `app/javascript`, `desktop/frontend/src`, and `app/views`; identify renderer output paths separately from static/KaTeX/Mermaid-generated markup.
- Deployment: routes, both root shells, Dockerfiles, all `.github/workflows` triggers/jobs, deployment authorization/publication scripts, and the Mac mini runbook's host-side watcher references.
- Data safety: source polling, snapshot/hash validation, atomic save, conflict resolution, local draft recovery, external-edit scenario, and the documented check-to-rename residual race.

Human gates touched (constitution §8): none.

## 9. Re-plan log

Initial plan; no re-plan entries.
