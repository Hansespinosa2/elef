# Elef Desktop — Test Strategy (testing seam)

Status: draft v3 (2026-10-01). Implements the preference: one suite of user flows verified on web and desktop, tiered for speed, no divergent suites. Every quality scenario in [requirements.md](requirements.md) maps to a tier here.

## 1. Structure: one suite, two runner dialects

- **Scenarios** are the "one suite": named user flows defined once against page objects (LibraryPage, EditorPage, …). Initial set: open-deck, type-and-autosave, undo-redo-session, insert-image, source-visual-toggle, snippet-insert, math-input, elef-export-import, external-edit-conflict, hostile-deck-neutralized, update-cycle.
- **Runners** (two dialects): Playwright for web; WebdriverIO for the Tauri binary. Playwright is CDP-first and cannot drive `tauri-driver` (W3C WebDriver), so the same spec files cannot run on both. Page objects have one implementation per runner; scenarios are shared.
- **Divergence guard:** a scenario that exists in only one runner without a documented reason fails review.

## 2. Tiers

| Tier | What | When | Verifies |
|---|---|---|---|
| T0 | Unit and component: Rust core tests (safe write, path guard, archive, source-file rule); JS unit tests; **renderer fixture suite** (Node, against the bundle); thin Ruby test that the mini_racer wrapper returns the same HTML as the bundle; transport contract tests | Every change, fast path | QS-3 (Rust), QS-4, QS-5, QS-10, QS-11 |
| T1 | Playwright: scenarios vs **web** (Rails dev server) | Every change (< ~5 min) | QS-1 (web leg) |
| T1m | Playwright **mock tier**: desktop frontend served locally, Tauri IPC mocked. Fast desktop UI flows without the binary; honest about being UI-only, not backend truth | Every change | QS-1 (desktop UI) |
| T2 | WebdriverIO: scenarios vs the **real Tauri binary** via `tauri-driver` (Linux CI) and `tauri-plugin-webdriver` (embedded driver, including macOS). Includes the perf leg and network-blocked run | PRs | QS-1, QS-3, QS-6, QS-9, QS-12 |
| T3 | Native smoke: install, launch, menus, dialogs, updater dry-run, hostile fixtures, `kill -9` mid-save fault injection | PRs / release | QS-2, QS-4, QS-5, QS-8 |
| CI fitness | Architecture rules as automated checks (§6) | Every change | QS-7, T5/T8 controls |

Fast feedback per change is T0 + T1 + T1m; the real-binary tier (T2 + T3) gates PRs. macOS desktop E2E is the weak spot (no official driver); T2 on macOS uses the embedded driver, supplemented by the manual first-device check in [delivery-plan.md](delivery-plan.md).

## 3. Renderer fixtures: one renderer, two phases

There is one renderer (ADR-007); the fixture suite tests the JS bundle directly in Node, with no bridge between implementations. Fixture *expected outputs* initially come from the Ruby suite. Rouge (Ruby) and Shiki (JS) emit different token HTML, so byte comparison would fail forever during cutover.

- **Phase 1 — cutover gate.** Comparison is **normalized**: strip highlighter spans and classes and compare text plus document structure, or compare a canonical token stream. Allowed diffs are enumerated (highlighter markup only); anything else fails. 100% normalized pass is required before the Ruby renderer is deleted.
- **Phase 2 — after cutover.** Expected outputs are regenerated from the JS renderer and comparison becomes **exact**. The normalization machinery is retired, not maintained.
- Mermaid output is not a Node fixture concern (needs a DOM): fixtures assert the placeholder; diagrams render in T1/T2 scenarios.
- The thin Ruby wrapper test stays permanently: it guards the wiring, not the rendering.

## 4. Fixtures

- **Temp-dir libraries:** every E2E test builds a fresh library (decks, images, `elef.json` variants, and the nasty cases: missing manifest, multiple `.md`, case-only and Unicode-equivalent collisions, duplicate UUIDs, `talk (conflicted copy).md`, read-only folder).
- **Scale:** generated library of 1,000 decks plus a 50 MB deck. Budgets are measured against these.
- **Hostile:** script-payload Markdown, `javascript:` links, traversal paths, zip-slip archives, symlink-entry archives, zip-bombs, pathological Markdown for render limits.
- **Transport contract tests:** same input → same output shape against the Rails endpoint and the desktop handler.
- **Determinism:** fixtures never depend on wall-clock, locale, or the developer's home directory.

## 5. Fault injection (QS-2, QS-3)

Rust core exposes test hooks that pause or abort at named points in a save: (a) before temp write, (b) mid temp write, (c) after flush before rename, (d) after rename. T3 kills the process at each point, ≥50 runs per point, then asserts the source file is wholly old or wholly new and no temp file blocks the next open. The conflict interleaving test drives every ordering of external write, edit, and autosave against a real temp directory (T0 Rust) and once end to end (T2).

## 6. Architecture fitness functions (CI)

Automated checks that keep the architecture from drifting:
- Ruby `Source::HtmlRenderer` is absent after cutover; Rails and desktop load a renderer bundle with the same hash (QS-7).
- Tauri capability file equals the command table in [transport-adapter.md](transport-adapter.md); no wildcard fs or shell permission.
- Shipped CSP equals the policy recorded in [security.md](security.md); `script-src` has no `unsafe-inline` / `unsafe-eval`.
- `elef-core` has no dependency on Tauri crates.
- Live feature flags match the register in [delivery-plan.md](delivery-plan.md); each has a removal condition.
- `cargo audit` and `npm audit` pass or have a dated, recorded exception.

## 7. Performance measurement

Protocol per [requirements.md](requirements.md) §8: release build, fresh process, p95 over ≥20 runs, scale fixtures. Linux perf truth is WebKitGTK, notably slower than Chromium for scrolling and large CodeMirror documents; T1's Chromium does not cover it, so the T2 desktop leg runs on real Linux hardware. Images go through the asset protocol and rendering runs in a worker — both are tested, not assumed.

## 8. Policies

- **Flakes:** quarantine on the second flake; fix or delete within the PR; no permanently quarantined tests.
- **Affected-first:** T0/T1/T1m select by changed packages on PRs; T2/T3 always run in full on the PR gate.
- **Coverage is not a goal;** scenarios and quality-scenario measures are.
