# Elef Art v1 Integration Map

Phase 0 audit for Constitution v6.0. The branch was clean before the constitution copy was added.

## Repository baseline

- Branch: `feat/list-smartart-v1`, tracking `origin/dev`.
- HEAD: `26d6ad247e5b55dfa63589d16af9a8f250f2c51c`.
- Initial legacy search: no existing `:::art`, `art{flow}`, `art-flow`, `data-elef-art`, or SmartArt implementation under `app/`, `desktop/`, `test/`, `script/`, or existing docs. Matches for `.new-work-chevron` belong to the unrelated new-work menu.

## Current integration points

| Concern | Current implementation | Art integration point |
|---|---|---|
| Shared source map and editor ownership | `app/javascript/lib/document_map.js`: `buildEditorStructure`, `editorBlocks`, `slideMetadata`, `markdownBlocks`; `app/javascript/lib/editor_block_ranges.js`: `blockOperationStart` | `resolveArtBindings` supplies directive/target ranges to both editor mapping and rendering. Art IDs and diagnostics remain in the editor map, not Markdown. |
| Canonical Markdown tokenization and HTML | `app/javascript/lib/art_source.js`: `analyzeArtList`; `app/javascript/lib/renderer.js`: `renderArtBlock`, `renderMarkdownBlock`, `renderPreview` | markdown-it token output determines root mode, direct item count, density, and unsupported content. One Rails-owned `renderArtBlock` is used in document and presentation projections. |
| Rails editor preview | `app/helpers/application_helper.rb#shared_editor_projection` → `Source::JavascriptRenderer.editor_preview` → `vendor/javascript/elef-renderer.bundle.js` | The bundle calls the same `renderPreview` and map implementation used by desktop. |
| Desktop frontend renderer | `app/javascript/lib/renderer_global.js`; built by `script/build_renderer.mjs` and consumed by `desktop/frontend/build.mjs` | Reuse Rails-owned JS. Do not add a desktop renderer copy. |
| Rails editor preview | `app/helpers/application_helper.rb#shared_editor_projection` → `Source::JavascriptRenderer.editor_preview` → `vendor/javascript/elef-renderer.bundle.js` | The bundle calls the same `renderPreview` and source map implementation as the desktop build. Art is implemented in this path. |
| Desktop frontend renderer | `app/javascript/lib/renderer_global.js`; `script/build_renderer.mjs`; `desktop/frontend/build.mjs` | Reuses Rails-owned renderer sources and the exact `markdown-it@14.3.2` dependency. No Art-specific desktop source copy. |
| Saved document source model | `app/lib/source/document.rb`: `parse`, `slide_metadata`, `parse_blocks`, `markdown_blocks`; called by `Work#parsed_document` | Still needs Art integration so server-rendered saved-document and print paths use canonical Art semantics and diagnostics. |
| Saved document HTML and editing projection | `app/lib/source/block_renderer.rb`; `Document#preview_html`; `app/views/documents/_content.html.erb` | Still needs shared Art rendering for saved, editable, and print document paths. |
| Saved presentation HTML and print | `app/views/presentations/_slide.html.erb`, `PresentationsHelper#render_markdown`, `Source::Renderer` | Still needs shared Art rendering and fixed-host state in saved and print paths. |
| Presentation editor projection | `renderer.js#renderPresentation`; `app/javascript/controllers/art_layout_controller.js` | The shared projection marks `.slide-region` or `.slide-content` hosts and uses one presentation-level controller for the batched fixed-layout lifecycle. |
| Document pagination | `app/javascript/controllers/document_pages_controller.js`: `pageUnits`, `flowBlock`, `splitArtBlock`, `artFragments`, `childFragment`, `mergeFlowFragment` | Art bypasses generic text splitting, splits at direct root `<li>` nodes, and continues ordered numbering. Forced geometry tests and idempotence checks remain to be added. |
| Visual block operations | `app/javascript/lib/editor_block_ranges.js#blockOperationStart`; `visual_editor_controller.js#blockSourceRange`; `presentation_editor_controller.js#deleteBlock` / `moveBlock` | Art source range now participates in existing block operation boundaries; integration tests for actual editor delete/move transactions remain. |
| `:` authoring palette | `app/lib/authoring_registry.rb`, `app/lib/snippets/catalog.rb`, `app/javascript/data/default_authoring_registry.json`, `app/javascript/controllers/snippet_palette_controller.js` | The built-in `:art` entry inserts exactly `:::art` with a zero-argument schema. |
| Editor warnings | `document_map.js#artDiagnosticMessage`, `PreviewController` warning rendering, `art_layout_controller.js#setDiagnostic`, `document_pages_controller.js#markArtItemTooTall` | Source and runtime Art warnings use stable diagnostic codes and the existing editor warning list. |
| Parity tests | `test/e2e/scenarios/`; adapters in `desktop/e2e/`; JavaScript unit tests in `test/javascript/` | Source, layout, rendering, and authoring unit coverage is in progress; browser parity and canonical geometry fixtures remain. |

## Baseline checks before feature changes

- `npm run test:javascript` after `npm ci`: **334 passed, 0 failed** (Node v26.10.0; the repository documentation names Node 22 for CI).
- `ELEF_USE_SQLITE=1 bin/rails test`: **343 runs, 2,725 assertions, 0 failures, 0 errors, 0 skips**. This used the documented isolated Rails test database compatibility mode after PostgreSQL was found unavailable at `127.0.0.1:5432`.
- `bin/rails test` with the configured PostgreSQL adapter: **blocked before test execution**; Active Record could not connect to `127.0.0.1:5432`; `pg_isready` reported no response and no listener was present.
- `npm test --prefix desktop/frontend`: **26 passed, 0 failed**.
- `npm run test:unit --prefix desktop/e2e`: **7 passed, 0 failed**.
- `cargo test --manifest-path desktop/Cargo.toml -p elef-core --locked`: **40 passed, 0 failed**.
- `python3 script/check_frontend_ownership.py`: **passed**.
- `python3 desktop/scripts/check_architecture.py`: baseline was blocked by an incomplete local frontend dependency tree; see current validation below.
- Full `npm test --prefix desktop/e2e` is not safe to run in this checkout: port 3000 already has a listener, and the endpoint check failed the TLS handshake. The harness starts its own Rails test server on that port.

## Current validation after the first implementation milestone

- `npm run renderer:build && npm run test:javascript`: **369 passed, 0 failed** before authoring/ownership changes.
- `npm run test:javascript`: **372 passed, 0 failed** after `:art` authoring and range-helper tests.
- `ELEF_USE_SQLITE=1 bin/rails test test/lib/authoring_registry_test.rb`: **5 runs, 23 assertions, 0 failures, 0 errors, 0 skips**.
- `npm run build --prefix desktop/frontend`: **passed** after adding the pinned shared `markdown-it@14.3.2` dependency.
- `npm test --prefix desktop/frontend`: **26 passed, 0 failed**.
- `npm run test:unit --prefix desktop/e2e`: **7 passed, 0 failed**.
- `python3 script/check_frontend_ownership.py`: **passed**.
- `python3 desktop/scripts/check_architecture.py`: **passed** after installing the locked desktop frontend dependencies and building the static bundle.
