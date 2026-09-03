---
title: 'Verify seeded samples and fix math layout'
type: 'feature'
created: '2026-09-02'
status: 'done'
review_loop_iteration: 0
baseline_commit: '8595f5b'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The sample workflow has coverage for creating records, but browser tests do not prove that representative samples render their important content. Visual inspection also shows the seeded display equation laid out incorrectly because the generated KaTeX markup lacks the CSS rules that give display math its block and inline-math layout.

**Approach:** Add browser-level assertions for the loaded sample library and representative saved preview, strengthen server-side assertions for raw source and rendered features, and add the minimal KaTeX layout stylesheet needed by the existing Ruby renderer.

## Boundaries & Constraints

**Always:** Keep raw Markdown canonical, keep the shared sample builder as the only sample-data source, preserve code-block math protection, and test observable browser output rather than implementation internals where possible.

**Ask First:** None.

**Never:** Do not replace KaTeX, add a client-side math renderer, introduce screenshot-baseline infrastructure, or change Markdown parsing semantics.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Sample preview | Loaded `code-and-math` sample | Inline and display math are visible, display math is block-level, and code remains literal | Existing math-error fallback remains visible for invalid TeX |
| Sample source | Loaded sample record | Persisted source exactly matches the declared raw Markdown | Fail the test if source is transformed |
| Browser library | Empty library, click sample button | All representative sample titles appear after the redirect | Surface normal request failures |
| Feature preview | Loaded sample records | Code, table, image, link, layout, theme, and empty-slide examples remain observable | Fail assertions rather than silently skipping |

</frozen-after-approval>

## Code Map

- `app/assets/stylesheets/application.css` -- global presentation styles; add the KaTeX display/inline layout rules missing from the current output.
- `app/lib/presentations/markdown_renderer.rb` -- existing server-side KaTeX integration and code-block exclusion boundary; do not replace it.
- `app/lib/presentations/sample_data.rb` -- canonical representative sources and sample identities used by all entry points.
- `app/views/presentations/_slides.html.erb` -- shared saved-preview rendering surface tested by browser and request assertions.
- `test/models/presentation_test.rb` -- renderer and source-parity unit coverage.
- `test/controllers/presentations_controller_test.rb` -- saved-preview HTML and seed-entrypoint request coverage.
- `test/system/presentations_test.rb` -- Selenium browser workflows; add visible sample rendering and computed display-math layout checks.

## Tasks & Acceptance

**Execution:**
- [x] `app/assets/stylesheets/application.css` -- add minimal KaTeX layout styles -- make generated display equations visually structured without changing the renderer.
- [x] `test/models/presentation_test.rb`, `test/controllers/presentations_controller_test.rb` -- assert sample raw-source parity and rendered feature output -- prevent weak token-only coverage.
- [x] `test/system/presentations_test.rb` -- load samples in the browser and inspect a math sample preview and computed display layout -- protect the end-to-end workflow.

**Acceptance Criteria:**
- Given the seeded code-and-math presentation, when its saved preview opens in a browser, then inline math and display math are visible and display math computes to `display: block`.
- Given a loaded sample, when its record is reloaded, then its source equals the canonical sample source exactly.
- Given an empty library, when the user loads samples, then all five representative sample titles appear.
- Given the sample previews, when rendered, then code remains literal, math is not reported as an error, and tables/media/links/layout/theme/empty-slide coverage remains observable.

## Design Notes

KaTeX’s Ruby gem emits the structural HTML and inline sizing styles, but not the browser stylesheet. The fix should stay deliberately small: provide the layout-critical selectors used by the generated output rather than vendoring an unrelated client-side math stack.

## Verification

**Commands:**
- `bin/rails test test/models/presentation_test.rb test/controllers/presentations_controller_test.rb test/system/presentations_test.rb` -- expected: all targeted tests pass.
- `bin/rails zeitwerk:check` -- expected: reports no autoloading errors.
- `git diff --check` -- expected: no whitespace errors.

## Suggested Review Order

**KaTeX layout**

- Clips accessibility MathML while preserving visual output.
  [`application.css:232`](../../app/assets/stylesheets/application.css#L232)

- Makes display equations block-level and centered.
  [`application.css:242`](../../app/assets/stylesheets/application.css#L242)

**Representative sample verification**

- Proves the browser starts empty and loads every sample.
  [`presentations_test.rb:4`](../../test/system/presentations_test.rb#L4)

- Verifies computed browser layout and literal code-block dollar signs.
  [`presentations_test.rb:17`](../../test/system/presentations_test.rb#L17)

- Covers persisted source parity and representative server-rendered features.
  [`presentation_test.rb:80`](../../test/models/presentation_test.rb#L80)
