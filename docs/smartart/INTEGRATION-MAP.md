# Elef Art v1 Integration Map

Phase 0 audit and current implementation map for [Constitution v6.0](CONSTITUTION.md).

## Baseline and repository audit

- Branch: `feat/list-smartart-v1`, based on `dev` at `26d6ad247e5b55dfa63589d16af9a8f250f2c51c` before Art implementation.
- Agent instructions and doctrine reviewed: repository `AGENTS.md`, `ELEF-DOCTRINE.md`, `docs/architecture.md`, and `docs/development.md`.
- Initial search across `app/`, `desktop/`, `test/`, `script/`, and docs found no existing Art renderer, `data-elef-art` state, `art{flow}` syntax, snake layout, or SmartArt feature. `.new-work-chevron` is unrelated.
- Baseline JavaScript suite: 334 passed.
- Baseline Rails suite using isolated SQLite compatibility mode: 343 tests, 2,725 assertions, no failures/errors/skips. The configured PostgreSQL test endpoint was unavailable at `127.0.0.1:5432`.
- Baseline desktop frontend: 26 tests passed; desktop E2E unit tier: 7 passed; Rust core: 40 passed; frontend ownership check passed.

## Current integration points

| Concern | Current implementation | Art integration |
|---|---|---|
| Source grammar and binding | `app/javascript/lib/art_source.js#resolveArtBindings` | A shared line/context resolver recognizes exact root Art directives, barriers, modifiers, diagnostics, and source ranges. `analyzeArtList` derives meaning from markdown-it tokens. |
| Editor source map | `app/javascript/lib/document_map.js#buildEditorStructure`, `editorBlocks`, `markdownBlocks` | Both visual editing and preview projections consume the resolver's binding result. Art source ranges stay metadata; only target Markdown is sent to Markdown parsing. |
| Canonical Markdown parser and semantic renderer | `app/javascript/lib/renderer.js#renderArtBlock`, `renderMarkdownBlock`, `renderPreview` | One Rails-owned renderer preserves native root/nested lists, derives root mode/density, detects unsupported content, and emits the DOM state enums. |
| Rails editor preview | `app/helpers/application_helper.rb#shared_editor_projection` → `app/lib/source/javascript_renderer.rb#editor_preview` → `vendor/javascript/elef-renderer.bundle.js` | Calls the shared renderer and editor map. The vendor bundle is generated from Rails-owned sources. |
| Saved document model/rendering | `app/lib/source/document.rb#parse_blocks`, `markdown_blocks`, `parsed_block`; `app/lib/source/block_renderer.rb#render` | Ruby model obtains binding metadata from `Source::JavascriptRenderer`; saved, editable, and print paths use shared Art rendering. |
| Saved presentation and print | `app/helpers/presentations_helper.rb#render_markdown`; `app/views/presentations/_slide.html.erb`; `app/lib/source/renderer.rb` | Shared Art rendering supplies complete fallback/status markup. Presentation content host is marked fixed and positioned. |
| Desktop consumer | `app/javascript/lib/renderer_global.js`; `script/build_renderer.mjs`; `desktop/frontend/build.mjs` | Tauri bundles Rails-owned JS and the pinned `markdown-it@14.3.2`; no desktop-specific Art renderer or CSS copy. |
| Document pagination | `app/javascript/controllers/document_pages_controller.js#splitBlock`, `splitArtBlock`, `artFragments`, `childFragment`, `mergeFlowFragment` | Art is an atomic pagination unit split only between direct root items. Remainder numbering uses explicit `start`, including zero. Oversized single items remain intact and emit `ART_ITEM_TOO_TALL`. |
| Fixed presentation lifecycle | `app/javascript/controllers/art_layout_controller.js`; `app/javascript/lib/art_layout.js` | One presentation-level controller batches decisions and reads, uses CSS custom properties for the width decision, applies the containment oracle, and performs at most one horizontal-to-vertical fallback pass. |
| Shared CSS tokens/layout | `app/assets/stylesheets/tokens.css`; `app/assets/stylesheets/components/art.css` | One token source drives Peer basis, Sequence eligibility, spacing, radius, padding, and typography. CSS supplies Peer wrapping, native Sequence markers, and logical/decorative connectors. |
| Block ownership | `app/javascript/lib/editor_block_ranges.js#blockOperationStart`; `visual_editor_controller.js#blockSourceRange`; `presentation_editor_controller.js#deleteBlock`, `moveBlock` | Existing source-range operations include the Art directive with its root list. Visual move/delete integration is covered by a browser system test. |
| `:` authoring | `app/lib/authoring_registry.rb`; `app/lib/snippets/catalog.rb`; `app/javascript/data/default_authoring_registry.json` | `:art` inserts only `:::art`; its argument schema is empty. |
| Diagnostics | `app/javascript/lib/document_map.js#artDiagnosticMessage`; `app/javascript/controllers/preview_controller.js`; `art_layout_controller.js#setDiagnostic`; `document_pages_controller.js#markArtItemTooTall` | Stable codes are exposed in rendered DOM and hydrated into the existing editor warning list. |
| Tests and parity harness | `test/javascript/art_source.test.js`, `art_generated.test.js`, `art_layout.test.js`, `renderer.test.js`; `test/system/art_test.rb`, `test/system/presentations_test.rb`; `desktop/e2e/` | Binding corpus, 400 seeded cases, layout/renderer checks, pagination and lifecycle browser checks, block operations, and Rails/Tauri adapter harness locations are identified. |
| Traceability | `docs/smartart/VERIFICATION.json`; `script/check_art_traceability.py` | Every numbered constitution requirement maps to a test or named static assertion; CI rejects duplicate/missing IDs and stale verification references. |

## Baseline failures and external environment

- Configured PostgreSQL tests could not start because nothing listened on `127.0.0.1:5432`; baseline Rails tests were run with the repository's isolated SQLite compatibility mode.
- The full desktop E2E parity harness starts its own Rails test server on port 3000. Repository instructions prohibit running it alongside the existing user server. The local port-3000 listener did not complete the required HTTPS handshake at baseline; current endpoint/process evidence is recorded in `VERIFICATION.json` after the final environment check.

## Implementation commits

- `b8ed9cb` Add shared Elef Art source and rendering
- `6c77635` Integrate Elef Art with saved content and authoring
- `c213a12` Harden Art fit and pagination diagnostics
- `f2e5dad` Keep Art ownership scoped to its root list
- `55d6184` Add Elef Art geometry and parity coverage
- `564102f` Verify bounded Art fallback lifecycle

The canonical two- and three-column fixture measurements reveal conflicts between FIX-06/FIX-07's expected `ready` state and the mandatory whole-host containment rule. The implementation preserves the host oracle and reports explicit no-fit; details are in `VERIFICATION.json` and the fixture tests.
