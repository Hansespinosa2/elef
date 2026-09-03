---
title: 'Add representative presentation seeds'
type: 'feature'
created: '2026-09-02'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: '6692e6d'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A new or test database does not contain realistic presentations, making it difficult to inspect the rendered application manually or exercise representative browser workflows. The seed data should demonstrate the Markdown features Elef actually supports, including LaTeX math.

**Approach:** Create one idempotent application-level seed builder that is callable from `db:seed` and from an explicit “Load sample presentations” library action. Seed a varied, labeled set of database-backed presentations covering supported Markdown, layouts, themes, code, math, tables, media, links, front matter, and slide edge cases.

## Boundaries & Constraints

**Always:** Raw Markdown remains the only canonical presentation source. The seed builder must be reusable by both entry points, idempotent on repeat runs, safe to invoke explicitly, and use only currently supported parser/renderer behavior. Sample records should be recognizable as examples and should not overwrite unrelated user presentations.

**Ask First:** None.

**Never:** Do not auto-populate on every page load, add a second fixture/seed implementation, introduce unsupported Markdown features, change presentation parsing semantics, or add React/Tauri behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Seed command | `bin/rails db:seed` | Creates the complete labeled sample set | Propagate database/validation errors |
| Repeated seed | Existing sample records from a prior run | Reuses or updates only records owned by the sample dataset; count does not grow | Propagate errors |
| Library action | Authenticated-free library page, explicit button click | Creates/reuses the same sample set and redirects to the library with a success notice | Surface request failure as an error response |
| Existing user data | Unrelated presentations already exist | Preserves unrelated records | N/A |
| Feature coverage | Sample Markdown includes supported syntax and separators inside code | Parser and preview render expected examples without changing canonical source | Existing renderer behavior handles invalid TeX visibly |

</frozen-after-approval>

## Code Map

- `db/seeds.rb` -- Rails seed entry point; currently empty and should delegate to the shared builder.
- `app/models/presentation.rb` -- canonical persisted record and derived document interface; sample sources must satisfy its validations and remain raw Markdown.
- `app/lib/presentations/document.rb` -- slide segmentation, front matter, theme, layout metadata, and fenced-code handling that the dataset must exercise.
- `app/lib/presentations/markdown_renderer.rb` -- Redcarpet/Rouge/KaTeX rendering pipeline; confirms inline and display LaTeX are supported.
- `app/controllers/presentations_controller.rb` -- library boundary where the explicit sample-loading action belongs.
- `config/routes.rb` -- presentation routes; add a collection route for the library action.
- `app/views/presentations/index.html.erb` -- library UI; add a clear sample-data button and success affordance without making it automatic.
- `test/models/presentation_test.rb` -- existing parser and renderer parity coverage; add focused sample dataset assertions where appropriate.
- `test/controllers/presentations_controller_test.rb` -- request coverage for library and mutation boundaries; cover creation, idempotency, and preservation of unrelated records.
- `test/system/presentations_test.rb` -- Selenium workflow coverage; verify the button makes sample presentations visible and representative.

## Tasks & Acceptance

**Execution:**
- [x] `app/lib/presentations/sample_data.rb` -- define the single idempotent sample dataset builder and stable ownership marker -- keeps `db:seed` and the UI on one implementation.
- [x] `db/seeds.rb` -- invoke the shared builder -- makes standard Rails database setup produce representative records.
- [x] `config/routes.rb`, `app/controllers/presentations_controller.rb`, `app/views/presentations/index.html.erb` -- add an explicit library action using the builder and display feedback -- makes manual inspection one click.
- [x] `test/models/presentation_test.rb`, `test/controllers/presentations_controller_test.rb`, `test/system/presentations_test.rb` -- test dataset coverage, repeatability, preservation, and browser behavior -- protects the shared workflow.

**Acceptance Criteria:**
- Given an empty database, when `bin/rails db:seed` runs, then a labeled set of presentations exists covering core Markdown, layouts/themes, code, LaTeX math, tables/media/links, and slide/front-matter edge cases.
- Given the sample set already exists, when either the seed command or library button runs again, then no duplicate sample presentations are created.
- Given unrelated presentations exist, when sample data is loaded, then unrelated records and their source remain unchanged.
- Given the library is open, when the user clicks “Load sample presentations,” then the same shared builder runs and the library shows the sample records with a success notice.
- Given a sample presentation is opened, when its preview is rendered, then its source remains raw Markdown and supported LaTeX is rendered through the existing KaTeX pipeline.

## Design Notes

Use a stable sample identity separate from user-visible titles so titles can remain readable while repeat runs reliably find the owned records. Prefer a small service/module with explicit records over Rails fixtures: it is callable from both a Rake seed invocation and a controller action, and it keeps the dataset close to the product domain.

## Verification

**Commands:**
- `bin/rails test test/models/presentation_test.rb test/controllers/presentations_controller_test.rb test/system/presentations_test.rb` -- expected: all targeted tests pass.
- `bin/rails db:seed` -- expected: completes successfully and is safe to run twice.
- `bin/rails zeitwerk:check` -- expected: reports no autoloading errors.
