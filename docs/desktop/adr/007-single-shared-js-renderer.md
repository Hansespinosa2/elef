# ADR-007: One shared JS renderer — used by Rails and desktop alike

- Status: **Proposed**
- Date: 2026-10-01
- Decider: Andres
- Confidence: medium (feasibility items are verified in S1)
- Accepted when: S1's renderer items pass — consumer inventory complete, mini_racer green or fallback recorded, bundle build planned, 10-fixture probe renders through the wrapper
- Supersedes: the renderer portion of the earlier ADR-003 draft (port + golden bridge + "converge later")

## Context

The earlier plan ported the Markdown → HTML pipeline from Ruby to JS and kept both implementations aligned with golden-file tests, converging "later". The elicited preference is explicit: **rewrite over maintaining two systems**; duplication must be visible and temporary, never a permanent tax. "Later" in a solo-maintained codebase means "forever", and every renderer bugfix would be done twice until then.

## Options considered

1. **Port to JS, keep both, converge later** (rejected): no forcing function; perpetual parity cost.
2. **Rust renderer for desktop, Ruby for web** (rejected): two implementations again, plus a third language.
3. **One JS renderer used by both** (chosen): the equivalence work (JS output vs Ruby output against the fixtures) is paid once, then the Ruby renderer is deleted.

## Decision (proposed)

**Author the renderer once as a standalone JS package.** Markdown blocks render to HTML without DOM or browser dependencies; `buildEditorStructure` derives slide/document metadata, `buildEditorMap` maps editable regions to UTF-16 source ranges, and `renderPreview` builds the editable projection. Rails calls these functions through MiniRacer and desktop calls them in a worker. The adapters supply platform-specific document routes, media URLs, IDs, and settings. Rails retains model/view wrappers for read-only presentation/document pages and PPTX generation. Full consumer fixtures, browser-visible parity, the soak, and removal of the Ruby rollback remain open, so this ADR remains proposed.

**Mermaid:** the renderer emits placeholders only and sets strict mode in the markup; diagrams render in the browser/webview, which has the DOM Mermaid needs. Rails therefore never renders diagrams server-side.

**One bundle, two consumers:**
- `bin/build-renderer` (esbuild) produces a single `renderer.bundle.js`.
- **Desktop:** the adapter runs the bundle in a Web Worker (`render_preview` is webview-local — [transport-adapter.md](../transport-adapter.md)), with a wall-clock limit.
- **Rails:** loads the same bundle through **mini_racer** (V8 embedded in the Ruby process). A thin wrapper, `Source::Renderer`, loads the bundle once and exposes `render(source) → html`. Every existing call site (preview endpoint, exports, anything S1's inventory finds) calls the wrapper. Set a timeout and a memory limit on the context; budget contexts for Puma threads and for fork (cluster mode).

**The Ruby renderer is strangled, then deleted.** `Source::HtmlRenderer` stays behind `ELEF_RENDERER=ruby` only until the JS renderer passes 100% of the fixture suite (normalized comparison — [test-strategy.md](../test-strategy.md) §3). Then it is deleted. Dual existence is measured in weeks and ends in deletion.

## Consequences

Positive
- The fixture suite tests **the** renderer directly, fast, in Node; no bridge to maintain.
- After cutover, expected outputs are regenerated from the JS renderer and comparison is exact; normalization was only the cutover gate.
- The katex gem becomes unused for rendering after cutover; S1 records both pinned versions.
- A CI fitness check asserts Ruby `Source::HtmlRenderer` is gone and Rails and desktop load a bundle with the same hash ([requirements.md](../requirements.md) QS-7).

Negative (honest costs)
1. **A new gem in Rails** (mini_racer, which needs a V8 build). The bundle loads and the targeted Rails tests pass on Omarchy; macOS arm64, full consumer coverage, production latency, memory behavior and Puma cluster behavior remain unverified. Highlight.js is used instead of Shiki, so there is no Shiki WebAssembly engine dependency. A persistent Node sidecar remains a fallback if MiniRacer proves unacceptable on a supported target.
2. **A build step** for the bundle (checked-in vs CI-built — S1 decides); small, but new in the Rails dev loop.
3. **The web app's rendering path changes.** A subtle bug would affect the existing product. Mitigations: the 100% fixture gate, the `ELEF_RENDERER` flag for instant rollback, and a soak period before deletion ([delivery-plan.md](../delivery-plan.md) M3w).

## Revisit when

S1 shows libv8 and the Node sidecar are both unacceptable on a target platform, or in-process render latency regresses the preview endpoint.
