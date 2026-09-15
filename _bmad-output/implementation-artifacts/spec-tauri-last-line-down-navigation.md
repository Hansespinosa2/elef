---
title: 'Fix Down navigation from the last visual paragraph line'
type: 'bugfix'
created: '2026-08-18'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: '9125b07b0878f6164d62094b547165a77745ca33'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In the Tauri WebView, when the user clicks inside a paragraph on its last visible wrapped line but before the line's end, pressing Down scrolls the application while leaving the caret in place. The existing Tauri E2E coverage does not reproduce this exact click-based interaction, so a green result is not evidence that the user-facing bug is fixed.

**Approach:** Add a failing Tauri WebDriver regression that creates a long paragraph, clicks the real paragraph at the last visual line before its end, records selection and scroll diagnostics, presses a real ArrowDown key, and asserts the caret reaches the end of that visual line without app scrolling. Use that failing reproduction to adjust the editor's navigation behavior, then run the same test and the existing navigation suite to prove the fix.

## Boundaries & Constraints

**Always:** Test through the real Tauri WebView; create the caret with a real paragraph click rather than direct selection injection; use a paragraph long enough to wrap and reach the slide viewport's lower edge; assert selection movement, caret geometry, and scroll changes before and after the key; preserve native movement inside ordinary lines, explicit block transitions, and slide-boundary navigation; keep the test deterministic without fixed Retina-specific coordinates.

**Ask First:** None. If the WebDriver service cannot reliably click a rendered visual line or expose the required selection/scroll state, stop and report the limitation instead of replacing the click with a synthetic selection.

**Never:** Do not use jsdom geometry mocks as acceptance evidence; do not use browser-only smoke tests; do not call `Range.setStart` or inject a selection to arrange the reproduction; do not assert only `defaultPrevented`, CSS classes, or a changed selection without checking the expected visual-line and scroll outcome; do not claim completion from a passing test that does not execute the exact click-then-Down sequence.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| LAST_VISUAL_LINE | Click paragraph on its last rendered line, before line end, then press Down | Caret moves to that line's end; the relevant app/slide scroll position does not advance merely to process the key | Fail with click coordinates, caret rects, selection offsets, and scroll metrics |
| MIDDLE_WRAPPED_LINE | Click paragraph on a non-final wrapped line, then press Down | Caret follows the next visual line without jumping to the paragraph end or another slide | Fail with before/after caret geometry and offsets |
| BLOCK_BOUNDARY | Move to the end of a paragraph and press Down | Existing next-block behavior remains intact | Fail with active slide, block identity, and selection diagnostics |
| CLEANUP | E2E test exits normally or exceptionally | Fixture files and Tauri/WebDriver processes are cleaned up without hiding errors | Surface cleanup failures |

</frozen-after-approval>

## Code Map

- `tests/e2e/arrow-navigation.spec.ts:23-110` -- existing real-WebView fixture, diagnostics, and caret helpers; extend this only with a real click-based setup and richer line/scroll evidence.
- `tests/e2e/arrow-navigation.spec.ts:117-173` -- current overflow, wrapped-line, and slide-boundary scenarios; the new regression must be separate and must not replace the existing cases.
- `wdio.conf.ts:9-45` -- Tauri WebDriver lifecycle and debug build; preserve the real WebView runner and make failures/cleanup observable.
- `src/components/PresentationPreview.tsx:215-260` -- geometry and caret helpers; the current visual-line attempt must be validated against the exact click reproduction rather than assumed correct.
- `src/components/PresentationPreview.tsx:561-616` -- ArrowUp/ArrowDown handler; preserve block and slide boundary behavior while fixing the last-visual-line case.
- `src/components/PresentationPreview.css:51-73` -- fixed slide dimensions, transform scaling, clipping, and typography that determine actual visual-line geometry.
- `tests/integration/presentation-preview.test.tsx:442-522` -- jsdom logic coverage; retain it as non-Tauri coverage and do not use it to satisfy this regression.

## Tasks & Acceptance

**Execution:**
- [ ] `tests/e2e/arrow-navigation.spec.ts` -- add the exact click-on-last-visual-line regression and diagnostics -- ensure it fails against the known-bad behavior before the fix.
- [ ] `src/components/PresentationPreview.tsx` -- fix Down handling for the clicked last visual line -- preserve ordinary, block, and slide navigation.
- [ ] `tests/e2e/arrow-navigation.spec.ts` -- run the same regression after the implementation -- prove the caret reaches the visual-line end without scrolling.
- [ ] `tests/integration/presentation-preview.test.tsx` -- keep jsdom coverage passing -- prevent synthetic geometry from being treated as Tauri evidence.

**Acceptance Criteria:**
- Given a real Tauri paragraph click on its last visual line before the line end, when ArrowDown is pressed, then the caret moves to that visual line's end and the app does not scroll instead.
- Given a real Tauri click on a middle wrapped line, when ArrowDown is pressed, then the caret moves toward the next visual line without jumping to the paragraph end or another slide.
- Given existing paragraph, block, and slide-boundary navigation, when the regression fix is present, then those behaviors remain passing in the Tauri suite.
- Given the regression test runs against the pre-fix behavior, when the click and ArrowDown sequence executes, then the test fails for the observed stationary-caret/scrolling outcome.
- Given any failure, when diagnostics are printed, then they identify the clicked element/coordinates, active element, selection offsets, caret rectangles, slide scroll metrics, and event outcome.

## Spec Change Log

## Design Notes

The click must be derived from the paragraph's real bounding rectangle and line metrics, not a hard-coded screen coordinate. The test should select a click point near the left side of the paragraph at the bottom rendered line, then verify the resulting caret rectangle is on the paragraph's final visual line and not already at its end before sending ArrowDown. This guards against accidentally testing a paragraph-end or block-boundary path.

## Verification

**Commands:**
- `npm run test:e2e -- --mochaOpts.grep='last visual paragraph line'` -- expected: fails before the fix and passes after the fix.
- `npm run test:e2e` -- expected: all Tauri navigation scenarios pass.
- `npm test` -- expected: all Vitest unit/integration tests pass without collecting E2E specs.
- `npm run build` -- expected: production frontend build passes.
- `git diff --check` -- expected: no whitespace errors.
