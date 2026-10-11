# Elef Art v1 Integration Map

Implementation map for [Constitution v6.0](CONSTITUTION.md). Paths are current;
when Art code moves, update this map in the same commit.

**Status:** normative - enforced by apps/web/script/check_art_traceability.py via docs/smartart/VERIFICATION.json (ART-ARCH-003/004 doc: references require the "Current integration points" marker below).

## Current integration points

| Concern | Current implementation | Art integration |
|---|---|---|
| Source grammar and binding | `packages/work-model/src/art_source.ts#resolveArtBindings` | A shared line/context resolver recognizes exact root Art directives, barriers, modifiers, diagnostics, and source ranges. `analyzeArtList` derives meaning from markdown-it tokens. |
| Editor source map | `packages/work-model/src/document_map.ts#buildEditorStructure`, `editorBlocks`; `packages/renderer/src/renderer.ts` | Both visual editing and preview projections consume the resolver's binding result. |
| Canonical semantic renderer | `packages/renderer/src/renderer.ts#renderArtBlock` | One shared renderer preserves native root/nested lists, derives root mode/density, detects unsupported content, and emits the DOM state enums. Pinned `markdown-it@14.3.2`. |
| Rails editor preview | `apps/web/app/helpers/application_helper.rb#shared_editor_projection` → `apps/web/app/lib/source/javascript_renderer.rb` → `packages/renderer/dist/elef-renderer.bundle.js` | Calls the shared renderer and editor map. The bundle is generated from shared sources. |
| Saved document model/rendering | `apps/web/app/lib/source/document.rb`, `apps/web/app/lib/source/block_renderer.rb` | Ruby model obtains binding metadata from `Source::JavascriptRenderer`; saved, editable, and print paths use shared Art rendering. |
| Saved presentation and print | `apps/web/app/helpers/presentations_helper.rb#render_markdown`; `apps/web/app/views/presentations/_slide.html.erb`; `apps/web/app/lib/source/renderer.rb` | Shared Art rendering supplies complete fallback/status markup. Presentation content host is marked fixed and positioned. |
| Desktop consumer | `packages/renderer`, `packages/editor-runtime`; `apps/desktop/frontend/build.mjs` | Tauri bundles the shared renderer and editor shell; no desktop-specific Art renderer or CSS copy. |
| Document pagination | `packages/editor-runtime/src/controllers/document_pages_controller.ts#splitArtBlock` | Art is an atomic pagination unit split only between direct root items. Remainder numbering uses explicit `start`, including zero. Oversized single items remain intact and emit `ART_ITEM_TOO_TALL`. |
| Fixed presentation lifecycle | `packages/editor-runtime/src/controllers/art_layout_controller.ts`; `packages/editor-runtime/src/lib/art_layout.ts` | One presentation-level controller batches decisions and reads, uses CSS custom properties for the width decision, applies the containment oracle, and performs at most one horizontal-to-vertical fallback pass. |
| Shared CSS tokens/layout | `apps/web/app/assets/stylesheets/tokens.css`; `apps/web/app/assets/stylesheets/components/art.css` | One token source drives Peer basis, Sequence eligibility, spacing, radius, padding, and typography. CSS supplies Peer wrapping, native Sequence markers, and logical/decorative connectors. |
| Block ownership | `packages/work-model/src/document_transforms.ts#blockOperationStart`; `packages/client/src/features/document/document_editor.ts` | Existing source-range operations include the Art directive with its root list. |
| `:` authoring | `apps/web/app/lib/authoring_registry.rb`; `apps/web/app/lib/snippets/catalog.rb`; `apps/web/app/javascript/data/default_authoring_registry.json` | `:art` inserts only `:::art`; its argument schema is empty. |
| Diagnostics | `packages/work-model/src/document_map.ts#artDiagnosticMessage`; editor-runtime preview/art-layout/document-pages controllers | Stable codes are exposed in rendered DOM and hydrated into the existing editor warning list. |
| Tests and parity harness | `packages/work-model/test/art_*.test.ts`; `packages/renderer/test/renderer.test.ts`; `apps/web/test/system/art_test.rb`; `apps/web/test/e2e/scenarios/art-rendering.js`; `apps/desktop/e2e/` | Binding corpus, layout/renderer checks, browser checks, block operations, and shared web/Tauri Art semantic scenarios. |
| Traceability | `docs/smartart/VERIFICATION.json`; `apps/web/script/check_art_traceability.py` | Every numbered constitution requirement maps to a test or named static assertion; CI rejects duplicate/missing IDs and stale verification references. |
