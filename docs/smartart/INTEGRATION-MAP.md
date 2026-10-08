# Elef Art v1 Integration Map

Phase 0 audit for Constitution v6.0. The branch was clean before the constitution copy was added.

## Repository baseline

- Branch: `feat/list-smartart-v1`, tracking `origin/dev`.
- HEAD: `26d6ad247e5b55dfa63589d16af9a8f250f2c51c`.
- Initial legacy search: no existing `:::art`, `art{flow}`, `art-flow`, `data-elef-art`, or SmartArt implementation under `app/`, `desktop/`, `test/`, `script/`, or existing docs. Matches for `.new-work-chevron` belong to the unrelated new-work menu.

## Current integration points

| Concern | Current implementation | Art integration point |
|---|---|---|
| Shared source map and editor ownership | `app/javascript/lib/document_map.js`: `buildEditorStructure`, `editorBlocks`, `editorDirective`, `editableRegion` | Resolve exact Art candidates and source ranges alongside existing block/directive mapping. `renderer.js` and the Rails MiniRacer bundle already consume this map. |
| Canonical Markdown tokenization and HTML | `app/javascript/lib/renderer.js`: configured `markdown-it` instance, `renderMarkdownBlock`, `renderPreview` | Derive root list type, direct item count, density, and unsupported content from markdown-it tokens; render the shared Art wrapper from the same Rails-owned module. |
| Rails editor preview | `app/helpers/application_helper.rb#shared_editor_projection` → `Source::JavascriptRenderer.editor_preview` → `vendor/javascript/elef-renderer.bundle.js` | The bundle calls the same `renderPreview` and map implementation used by desktop. |
| Desktop frontend renderer | `app/javascript/lib/renderer_global.js`; built by `script/build_renderer.mjs` and consumed by `desktop/frontend/build.mjs` | Reuse Rails-owned JS. Do not add a desktop renderer copy. |
| Saved document source model | `app/lib/source/document.rb`: `parse`, `slide_metadata`, `parse_blocks`, `markdown_blocks`; called by `Work#parsed_document` | Teach the Rails saved-document model to consume Art metadata from the shared source map and keep diagnostics visible. Avoid a second Markdown-list parser. |
| Saved document HTML and editing projection | `app/lib/source/block_renderer.rb`; `Document#preview_html`; `app/views/documents/_content.html.erb` | Render Art through the shared renderer for saved, editable, and print document paths. |
| Saved presentation HTML and print | `app/views/presentations/_slide.html.erb`, `PresentationsHelper#render_markdown`, `Source::Renderer` | Pass the resolved Art modifier into the shared renderer; preserve fixed-host metadata on the actual bounded region. |
| Presentation editor projection | `renderer.js#renderPresentation`; `presentation_canvas_controller.js` currently only handles slide scaling | Mark actual bounded regions and attach one presentation-level Art lifecycle controller. |
| Document pagination | `app/javascript/controllers/document_pages_controller.js`: `pageUnits`, `flowBlock`, `splitBlock`, `splitGroupedChildren`, `childFragment`, `mergeFlowFragment` | Treat `[data-elef-art-root]` as a root-list pagination unit, split only between its direct `<li>` nodes, preserve continuation starts, and keep a too-tall item atomic. |
| Visual block operations | `app/javascript/controllers/visual_editor_controller.js#blockSourceRange`, delete handling and map updates; `presentation_editor_controller.js#deleteBlock` / `moveBlock` | Include Art source range in the existing operation range for its target list. |
| `:` authoring palette | `app/lib/authoring_registry.rb`, `app/lib/snippets/catalog.rb`, `app/javascript/controllers/snippet_palette_controller.js` | Add the single `:art` directive entry. |
| Editor warnings | `app/views/works/_warnings.html.erb`, `PreviewController` warning rendering, `Source::Document::warnings` | Surface stable Art diagnostics through the established warning list. |
| Parity tests | `test/e2e/scenarios/`; adapters in `desktop/e2e/`; JavaScript unit tests in `test/javascript/` | Add shared semantics assertions and verify the web and desktop adapters where the local environment permits. |

## Baseline checks before feature changes

- `npm run test:javascript` after `npm ci`: **334 passed, 0 failed** (Node v26.10.0; the repository documentation names Node 22 for CI).
- `ELEF_USE_SQLITE=1 bin/rails test`: **343 runs, 2,725 assertions, 0 failures, 0 errors, 0 skips**. This used the documented isolated Rails test database compatibility mode after PostgreSQL was found unavailable at `127.0.0.1:5432`.
- `bin/rails test` with the configured PostgreSQL adapter: **blocked before test execution**; Active Record could not connect to `127.0.0.1:5432`; `pg_isready` reported no response and no listener was present.
- `npm test --prefix desktop/frontend`: **26 passed, 0 failed**.
- `npm run test:unit --prefix desktop/e2e`: **7 passed, 0 failed**.
- `cargo test --manifest-path desktop/Cargo.toml -p elef-core --locked`: **40 passed, 0 failed**.
- `python3 script/check_frontend_ownership.py`: **passed**.
- `python3 desktop/scripts/check_architecture.py`: **blocked by an incomplete local frontend dependency tree**; expected `desktop/frontend/node_modules/@tauri-apps/api/window.js` is absent.
- Full `npm test --prefix desktop/e2e` is not safe to run in this checkout: port 3000 already has a listener, and the endpoint check failed the TLS handshake. The harness starts its own Rails test server on that port.
