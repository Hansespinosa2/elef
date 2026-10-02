# ADR-004: Reuse the editor JS via a transport adapter

- Status: **Proposed** (follows from ADR-002 and ADR-003)
- Date: 2026-09-30 (revised 2026-10-01)
- Decider: Andres
- Confidence: medium-high
- Accepted when: ADR-002 and ADR-003 are accepted, S1 completes the adapter spec, and [issue #126](https://github.com/Hansespinosa2/elef/issues/126) demonstrates library and final-preview parity through the shared scenarios

## Context

Preference: the editing experience — visual editor, source editor, and editing flow — plus the core library views and document graph must behave identically between web and desktop; no native rewrite unless a concrete feel gap is named. The editor is already JavaScript (Stimulus + CodeMirror); the web host and library are server-rendered Rails.

## Options considered

- **Reuse the JS verbatim behind a transport adapter** (chosen).
- **Native rewrite of the editor.** Rejected: contradicts the preference and creates a second editor to maintain.
- **Full view reuse via bundled Rails.** Rejected in [ADR-003](003-file-backend-no-bundled-rails.md).

## Decision (proposed)

- **Reuse verbatim:** the CodeMirror/Stimulus controllers and the editing flow. They run in the Tauri webview unchanged.
- **Transport adapter:** the one seam. The editor's server calls already speak JSON, so the adapter routes the same calls to Rust commands or to webview-local handlers (the renderer worker) with the same payloads. The controllers don't know which backend answered. The adapter also owns the conflict hash handshake so controllers stay unchanged. Spec: [transport-adapter.md](../transport-adapter.md).
- **Host page:** the editor boots inside a server-rendered ERB view (`works/_form.html.erb`). Desktop reproduces it as a **static host-page template** (part of S1): no ERB at runtime, no Rails.
- **Desktop library and graph parity:** expose the same core views and behavior as web: all work, documents, presentations, search/filter, rendered card previews, and document graph. Native file actions operate on folders and `.elef` archives. Shared scenarios verify the common flows. The current desktop library uses separate markup and local handlers, and its preview assembly differs from Rails; that implementation gap remains open in [issue #126](https://github.com/Hansespinosa2/elef/issues/126). Turbo Drive does not ship; navigation becomes shell view-switching (S1 confirms no controller depends on Turbo events).

## Library implementation boundary

Rails keeps its server-rendered host and the desktop uses a local file-backed host. The acceptance bar is the same user-visible core behavior through shared scenarios: all/document/presentation browsing, search/filter, rendered work previews, and opening linked documents from the graph. The existing desktop views are separate implementations, so scenario coverage alone does not close markup or interaction parity. Revisions, lineage, and server-only actions remain behind their existing flags or outside desktop v1; they do not change the core library flow.

## Consequences

- The adapter gets a contract spec and contract tests on both sides; it is the highest-leverage test target in the desktop codebase.
- The adapter's command allowlist is the security-relevant surface ([security.md](../security.md)).
- **Trigger for a native rewrite of a piece:** a concrete feel gap that the shared JS cannot solve. Named gap first, rewrite second.

## Revisit when

S1 shows a controller that depends on server behavior the adapter cannot reproduce with the same JSON shape, or parity scenarios expose a concrete feel gap that the shared implementation cannot address.
