---
title: 'Add a real Tauri navigation regression test'
type: 'bugfix'
created: '2026-08-18'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: 'b696f8810b7d8c6bcf5c04077987e4246ad388b1'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The existing ArrowUp/ArrowDown coverage runs in jsdom and uses mocked geometry, so it cannot prove the behavior users experience in Elef's Tauri WebView: native caret movement, real layout, focus, and editor scrolling. This allowed a synthetic test to be presented as validation of the actual bug.

**Approach:** Add a debug-only Tauri WebDriver bridge and a WebdriverIO end-to-end test that launches Elef, enters a deliberately overflowing multi-slide document through the real UI, sends trusted keyboard input, and asserts the caret/focus/scroll behavior in the running Tauri WebView. Keep the existing Vitest tests for pure DOM/state logic, but do not treat them as a substitute for this regression.

## Boundaries & Constraints

**Always:** Run the E2E app in debug mode only; keep the WebDriver plugin out of release builds; isolate each test with a fresh app process or reset state; drive the existing accessible UI rather than adding production-only test controls; assert observable WebView state including active slide, selection location, and scroll position; preserve the canonical Markdown source and existing browser/Tauri application behavior.

**Ask First:** None for the agreed Tauri-level regression harness. If the chosen WebDriver plugin cannot build against the current Tauri version or requires a platform-specific workaround, stop and report the incompatibility before substituting another harness.

**Never:** Do not delete or weaken existing jsdom coverage; do not use browser-only smoke tests as acceptance evidence; do not add a production fixture hook or test-only behavior to the shipped UI; do not hard-code Retina-dependent pixel coordinates as the sole assertion; do not change ArrowDown behavior merely to make a synthetic test pass.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| OVERFLOWING_BLOCK | Tauri app with a long paragraph whose rendered content exceeds the slide viewport and a following slide | Repeated Down input first reaches the current block's meaningful end without increasing the editor's internal scroll unexpectedly, then moves to the next block/slide | Fail with captured active element, selection, scroll metrics, and slide markup |
| ORDINARY_LINE_MOVEMENT | Caret in the middle of a wrapped paragraph | Native Down movement remains available and does not jump to a block boundary prematurely | Fail with selection offsets and geometry diagnostics |
| SLIDE_BOUNDARY | Caret at the final meaningful position of a non-final slide | Down focuses the next slide and places the caret at its start | Fail with active-slide class and selection diagnostics |
| CLEANUP | E2E process exits or test fails | Tauri process and WebDriver session are terminated without changing user files | Surface cleanup failures rather than swallowing them |

</frozen-after-approval>

## Code Map

- `src-tauri/Cargo.toml:11-18` -- add `tauri-plugin-wdio-webdriver = "1.3.0"` only under debug assertions; `cargo search` confirms the package exists.
- `src-tauri/src/main.rs:3-9` -- initialize the WebDriver plugin behind `#[cfg(debug_assertions)]`, while retaining the dialog and filesystem plugins for normal app behavior.
- `src-tauri/tauri.conf.json:4-15` -- existing debug build/dev URL, window size, and CSP used by the test process; avoid production configuration changes unless the plugin requires a documented capability.
- `package.json:6-33` -- add WebdriverIO runner/service dependencies and a dedicated `test:e2e` command; the existing `test` script must remain Vitest-only.
- `wdio.conf.ts` (new) -- configure the local runner, Tauri service, debug binary lifecycle, timeout, and `tests/e2e/**/*.spec.ts` discovery.
- `tests/e2e/arrow-navigation.spec.ts` (new) -- use accessible editor controls to create the long multi-slide fixture, send real keyboard events, and collect selection/scroll diagnostics from the WebView.
- `src/components/PresentationPreview.tsx:164-223, 561-616` -- read-only behavior contract under test: selection offsets, visible-bottom geometry guard, block navigation, and slide-boundary focus.
- `tests/integration/presentation-preview.test.tsx:442-522` -- retain existing jsdom logic tests, but document that the geometry test uses mocks and is not Tauri acceptance evidence.

## Tasks & Acceptance

**Execution:**
- [x] `src-tauri/Cargo.toml`, `src-tauri/src/main.rs` -- add and debug-gate the WebDriver plugin -- expose only a development test transport.
- [x] `package.json`, `wdio.conf.ts` -- add the WebdriverIO Tauri runner and deterministic app lifecycle -- make the real test runnable with one command.
- [x] `tests/e2e/arrow-navigation.spec.ts` -- implement the overflowing paragraph, ordinary wrapped-line, and slide-boundary scenarios -- assert real focus, selection, and scroll state.
- [x] `tests/integration/presentation-preview.test.tsx` -- retain and label mocked-geometry coverage -- prevent future claims that jsdom validates Tauri behavior.

**Acceptance Criteria:**
- Given a debug Tauri build, when the E2E command starts, then Elef launches in a real Tauri WebView and the WebDriver session connects without browser-only substitution.
- Given a long overflowing paragraph, when trusted Down keys are sent at the visible bottom, then the E2E test observes the actual caret/scroll behavior and fails if the caret remains visually stationary while the editor scrolls.
- Given the caret at the end of a non-final slide, when Down is pressed, then the next slide becomes the real focused editing element and the selection is at its start.
- Given the caret in the middle of a wrapped paragraph, when Down is pressed, then the test verifies ordinary native line movement is not intercepted as a block jump.
- Given any E2E failure, when diagnostics are collected, then the failure includes slide count/classes, active element, selection anchor/offset, and relevant scroll/client rectangles.
- Given a release build, when the application is compiled, then the debug-only WebDriver dependency and plugin are absent from the release configuration.

## Spec Change Log

## Design Notes

The real regression must be asserted through state observable in the WebView, not a fixed screen coordinate. The test should record `document.activeElement`, the selection anchor and offset, the edited slide's `scrollTop`, `scrollHeight`, `clientHeight`, and bounding rectangles before and after each key. Use a stable fixture entered through the existing source editor or editing surface; do not add a hidden global fixture loader solely for tests.

## Verification

**Commands:**
- `npm run test:e2e` -- expected: the Tauri WebDriver suite launches Elef and passes the real ArrowDown scenarios.
- `npm test -- --run tests/integration/presentation-preview.test.tsx` -- expected: existing jsdom logic coverage still passes.
- `npm run build` -- expected: TypeScript and production frontend build pass without test-only runtime code.
- `cargo build --manifest-path src-tauri/Cargo.toml` -- expected: debug Tauri build compiles with the WebDriver plugin.
- `git diff --check` -- expected: no whitespace errors.
