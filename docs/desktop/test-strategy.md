# Elef Desktop — Test Strategy (testing seam)

Status: draft v3 (revised 2026-10-02). Implements the preference: one suite of user flows verified on web and desktop, tiered for speed, no divergent suites. Every quality scenario in [requirements.md](requirements.md) maps to a tier here.

## 1. Structure: shared scenarios, two runner dialects

- **Scenarios** are shared functions defined once against a small UI adapter. `edit-and-preview` opens a deck, edits source, waits for auto-save, exercises session undo/redo with each version persisted, uploads an image through the media controller, and verifies the rendered preview; `library-and-graph` checks document filtering and opening a linked document from the graph; `external-edit-conflict` changes the source outside the editor and verifies the disk version survives the conflict flow. The desktop native smoke also opens a generated `.elef` archive through the running app's single-instance file-open path and verifies the imported folder bytes. Remaining flows are snippet-insert, math-input, elef-export, hostile-deck-neutralized, and update-cycle. Each shared function must run through both adapters unless its browser-only or shell-only scope is documented.
- **Web adapter:** Playwright Test drives the Rails app in Chromium. **Desktop adapter:** WebdriverIO drives the real Tauri binary through its embedded WebDriver provider. Both adapters call the same scenario definitions; their page-object operations use their runner's normal APIs.
- The Tauri WebDriver bridge in CI does not reliably focus CodeMirror for keyboard input. Its page object updates the live editor through the existing input-proxy controller, which runs the same CodeMirror update, auto-save, preview, and conflict handlers. The web runner exercises keyboard input; desktop keyboard feel still needs the real-device acceptance check.
- **Platform constraint:** [Tauri documents WebDriver for desktop automation](https://v2.tauri.app/develop/tests/webdriver/), while Playwright's CDP attachment is Chromium-specific. The desktop runner exercises the actual WKWebView/WebKitGTK and native command backend; the web runner exercises Rails in Chromium. This is the user's selected WebdriverIO trade-off for retaining Tauri.
- **Linux desktop session:** T2 runs under `dbus-run-session` because Tauri's single-instance plugin registers through the user D-Bus session. The `.elef` launch smoke verifies the expected D-Bus name before it starts the second process.
- **Isolation:** the app enables the WebdriverIO command plugin and embedded server only with the explicit `webdriver` Cargo feature, a separate E2E Tauri config, an E2E-only frontend directory, and a test-only capability. The production config, default Cargo features, and production frontend do not include those hooks.
- **Current evidence:** Linux and macOS CI run the shared web and desktop edit/save/undo/redo/media/preview, library/graph, and external-edit-conflict scenarios. The desktop suite also opens and closes the new-deck dialog through the native menu accelerator, and exercises `.elef` import via the running app's file-open path. The T0 Rust suite kills a child at four save points, 50 runs per point; the matrix passed locally and is part of both platform CI jobs. Update-install fault injection and the full performance matrix remain release gates.
- **Divergence guard:** a scenario that exists in only one runner without a documented reason fails review.

## 2. Tiers

| Tier | What | When | Verifies |
|---|---|---|---|
| T0 | Unit and component: Rust core tests (safe write, path guard, archive, source-file rule, document graph, asset validation, four-point child-process save-kill matrix); JS unit tests including raw-byte media transport; **renderer fixture suite** (Node, against the bundle); thin Ruby test that the mini_racer wrapper returns the same HTML as the bundle; transport contract tests | Every change, fast path | QS-2, QS-3 (Rust), QS-4, QS-5, QS-10, QS-11 |
| T1 | Playwright: shared scenarios vs **web** (Rails test server) | PRs | QS-1 (web leg) |
| T2 | WebdriverIO: the same scenario functions vs the **real Tauri binary**, through its test-only embedded WebDriver provider on Linux and macOS; native menu/dialog smoke | PRs | QS-1 (shared edit/save/undo/redo/preview and library/graph flows) |
| T3 | Native smoke: install, launch, menus, dialogs, updater dry-run, and hostile fixtures | PRs / release | QS-4, QS-5, QS-8 |
| CI fitness | Architecture rules as automated checks (§6) | Every change | QS-7, T5/T8 controls |

T0 and frontend component tests provide fast feedback; T1 and T2 gate PRs on both target OSes. The current shared scenarios verify opening a deck, editing source, auto-save, session undo/redo, media upload and preview, document filtering, graph navigation, and an external-edit conflict. The remaining listed flows are planned coverage, not implied by those scenarios. Process-kill save fault injection runs in T0; update-install fault injection remains a T3 release gate.

## 3. Renderer fixtures: one renderer, two phases

The JS Markdown block renderer and slide/document structure/editor-map builder are shared (ADR-007); Rails calls them through MiniRacer and desktop calls them from its worker. Node tests exercise the desktop output, and Rails model/controller tests exercise the map through MiniRacer. A normalized final projection markup fixture gate across Rails partials and desktop HTML is still open. The Ruby fallback uses Rouge while JS uses Highlight.js, so initial block output comparison must normalize only the documented highlighter markup differences.

- **Phase 1 — cutover gate.** Comparison is **normalized**: strip highlighter spans and classes and compare text plus document structure, or compare a canonical token stream. Allowed diffs are enumerated (highlighter markup only); anything else fails. 100% normalized pass is required before the Ruby renderer is deleted.
- **Phase 2 — after cutover.** Expected outputs are regenerated from the JS renderer and comparison becomes **exact**. The normalization machinery is retired, not maintained.
- Mermaid output is not a Node fixture concern (needs a DOM): fixtures assert the placeholder; diagrams render in T1/T2 scenarios.
- The thin Ruby wrapper test stays permanently: it guards the wiring, not the rendering.

## 4. Fixtures

- **Temp-dir libraries:** every E2E test builds a fresh library (decks, images, `elef.json` variants, and the nasty cases: missing manifest, multiple `.md`, case-only, canonical-normalization, and full-casefold collisions, duplicate UUIDs, `talk (conflicted copy).md`, read-only folder).
- **Scale:** generated library of 1,000 decks plus a 50 MB deck. Budgets are measured against these.
- **Hostile:** script-payload Markdown, `javascript:` links, traversal paths, zip-slip archives, symlink-entry archives, zip-bombs, pathological Markdown for render limits.
- **Transport contract tests:** same input → same output shape against the Rails endpoint and the desktop handler.
- **Determinism:** fixtures never depend on wall-clock, locale, or the developer's home directory.

## 5. Fault injection (QS-2, QS-3)

**Current implementation status:** T0 runs a child process paused at four save points (before writing the temp file, mid-write, after flush and before rename, and after rename), kills it, and verifies that the source is wholly old or wholly new and that the next open removes leftover save temps. Each point runs 50 times. The Rust workspace test passed locally; the same suite is part of Linux and macOS desktop CI. This simulates process termination, not physical power loss. A separate 50-save measurement asserts that the p95 interval from the final matching fingerprint check to rename is below 250 ms. Unit coverage and the shared real-binary external-edit scenario exercise conflict handling; this is not an exhaustive permutation proof for every possible external-writer ordering. The check/rename window remains a documented residual race and is disclosed in the editor.

## 6. Architecture fitness functions (CI)

Automated checks that keep the architecture from drifting:
- Ruby `Source::HtmlRenderer` is absent after cutover; Rails and desktop load a renderer bundle with the same hash (QS-7).
- Tauri capability file equals the command table in [transport-adapter.md](transport-adapter.md); no wildcard fs or shell permission.
- Shipped CSP equals the policy recorded in [security.md](security.md); `script-src` has no `unsafe-inline` / `unsafe-eval`.
- The test-only WebdriverIO plugins, global Tauri API, and frontend initializer do not enter the default production build or capability.
- `elef-core` has no dependency on Tauri crates.
- Live feature flags match the register in [delivery-plan.md](delivery-plan.md); each has a removal condition.
- `cargo audit` and `npm audit` pass or have a dated, recorded exception.

## 7. Performance measurement

Protocol per [requirements.md](requirements.md) §8: release build, fresh process, p95 over ≥20 runs, scale fixtures. Linux perf truth is WebKitGTK, notably slower than Chromium for scrolling and large CodeMirror documents; T1's Chromium does not cover it, so the T2 desktop leg runs on real Linux hardware. Images go through the asset protocol and rendering runs in a worker — both are tested, not assumed.

## 8. Policies

- **Flakes:** quarantine on the second flake; fix or delete within the PR; no permanently quarantined tests.
- **Affected-first:** T0 selects by changed packages; shared T1/T2 scenarios and native T3 checks run on the PR gate.
- **Coverage is not a goal;** scenarios and quality-scenario measures are.
