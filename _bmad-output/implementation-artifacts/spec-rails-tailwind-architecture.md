---
title: 'Establish Rails Tailwind styling architecture'
type: 'refactor'
created: '2026-09-02'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: 'a6e0e58'
context:
  - '/Users/andresespinosa/Documents/GitHub/elef/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Elef's Rails UI currently relies on one hand-written stylesheet,
while the application needs a maintainable styling architecture that agents can
change safely and that keeps Elef's own theme separate from presentation themes.

**Approach:** Install the official `tailwindcss-rails` integration and migrate
all Rails-owned application UI to Tailwind. Retain only intentionally scoped
presentation CSS for generated Markdown, Rouge, KaTeX, slide geometry,
presentation mode, and deck themes; remove obsolete runtime and styling
artifacts and harden KaTeX assets.

## Boundaries & Constraints

**Always:** Keep Rails as the only product runtime, preserve raw Markdown as
canonical, retain Rails views with Hotwire/Stimulus and importmap, preserve
current visual behavior and accessible selectors, scope application UI under
`.elef-app`, scope rendered decks under `.presentation-surface`, use explicit
Tailwind mappings for derived states, vendor complete official KaTeX CSS and
matching fonts, and add regression tests for workflows, math layout, and style
isolation. Commit coherent slices frequently with concise subjects and no
co-author trailers.

**Ask First:** Any visual redesign, changed color/typography tokens, changed
presentation rendering semantics, or introduction of React, TypeScript, or a
new CSS/component framework.

**Never:** Do not keep parallel Vite/React/Tauri/WebdriverIO product paths, do
not replace generated presentation CSS wholesale with brittle Tailwind
selectors, do not add a presentation theme switcher, and do not introduce
autosave or client-rendered React behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rails UI | Library, editor, forms, notices, responsive layouts | Tailwind-generated styles preserve existing layout, states, and accessibility | Build fails clearly on invalid CSS |
| Deck rendering | Markdown, Rouge, KaTeX, themes, presentation mode | Scoped presentation styles preserve slide geometry and rendered output | Rendering tests expose regressions |
| Theme isolation | Elef UI styling and deck theme coexist | UI theme changes do not alter deck theme; deck theme does not alter UI | Browser test fails on cross-boundary leakage |
| Obsolete artifacts | Old Vite/React/Tauri/WebdriverIO or unused CSS files | No product path references them | Search/build catches orphaned references |
| KaTeX math | Fractions, scripts, limits, MathML, fonts | Complete visual and accessible math layout renders correctly | Browser assertions fail on missing structure/assets |

</frozen-after-approval>

## Code Map

- `Gemfile` and `Gemfile.lock` -- Rails dependencies; add `tailwindcss-rails`
  and regenerate the lockfile using Bundler.
- `app/assets/stylesheets/application.css` -- current combined application and
  presentation stylesheet; split ownership while preserving rendering rules.
- `app/views/layouts/application.html.erb` -- global Elef UI shell; add the
  application styling boundary and Tailwind entrypoint.
- `app/views/layouts/presentation.html.erb` and
  `app/views/presentations/*.html.erb` -- presentation and library surfaces to
  classify as Elef UI or presentation output.
- `app/javascript/controllers/*` -- Stimulus behavior and selectors that must
  remain stable.
- `test/controllers/presentations_controller_test.rb`,
  `test/models/presentation_test.rb`, and `test/system/presentations_test.rb` --
  existing Rails regression coverage, including browser math assertions.
- `config/initializers/assets.rb`, `app/assets/config/manifest.js`, and
  `config/environments/*` -- Propshaft asset paths and precompile behavior.
- Root `package.json`, Vite/Tauri configuration, and legacy source directories
  if present -- inspect before deleting; remove only files proven obsolete.

## Tasks & Acceptance

**Execution:**
- [x] `Gemfile`, `Gemfile.lock`, Rails Tailwind configuration -- add the
  official integration and verify Propshaft/build wiring.
- [x] `app/views/layouts/application.html.erb` and Rails-owned views -- migrate
  application chrome, library, forms, editor controls, notices, and responsive
  layout to Tailwind under `.elef-app`.
- [x] `app/assets/stylesheets/application.css` and asset entrypoints -- retain
  only scoped presentation infrastructure, including Markdown, Rouge, slide
  geometry, presentation mode, and deck themes.
- [x] KaTeX stylesheet/font assets -- replace the partial manual subset with the
  complete official assets and preserve accessible MathML behavior.
- [x] Obsolete root runtime/style artifacts -- remove unreferenced Vite, React,
  Tauri, WebdriverIO, and stale Tailwind files without deleting Rails behavior.
- [x] Rails tests and documentation -- add style-isolation and rendering
  regression coverage and document the ownership boundary and commands.

**Acceptance Criteria:**
- Given the Rails app is built, when Tailwind compiles, then the application UI
  is styled successfully through the Rails asset pipeline.
- Given the library, editor, preview, and presentation routes, when users
  interact with them at supported viewport sizes, then existing behavior and
  accessibility affordances remain intact.
- Given an Elef UI theme and a deck theme, when both render together, then their
  styles remain isolated by their ownership boundaries.
- Given representative Markdown and KaTeX samples, when rendered in headless
  Chrome, then fractions, scripts, limits, and accessible MathML layout are
  correct.
- Given the repository after migration, when obsolete runtime references are
  searched and the Rails suite runs, then no stale product path remains and all
  relevant tests pass.

## Design Notes

Tailwind is appropriate for stable Rails-owned markup because classes are
explicit at the call site. Generated Markdown and KaTeX DOM require descendant
selectors, precise positioning, and third-party contracts, so those styles
remain custom but are scoped under `.presentation-surface`. Dynamic theme and
layout values must use explicit mappings rather than interpolated Tailwind
class names that the scanner cannot detect.

## Verification

**Commands:**
- `bundle check` -- expected: dependencies are installed.
- `bin/rails zeitwerk:check` -- expected: autoloading succeeds.
- `bin/rails test test/models/presentation_test.rb test/controllers/presentations_controller_test.rb test/system/presentations_test.rb` -- expected: relevant Rails tests pass.
- `bin/rails assets:precompile` -- expected: Tailwind and Propshaft compile successfully.
- `git diff --check` -- expected: no whitespace errors.
