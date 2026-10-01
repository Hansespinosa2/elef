# ADR-004: Reuse the editor JS via a transport adapter

- Status: **Proposed** (follows from ADR-002 and ADR-003)
- Date: 2026-09-30 (revised 2026-10-01)
- Decider: Andres
- Confidence: medium-high
- Accepted when: ADR-002 and ADR-003 are accepted and S1 completes the adapter spec

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
- **Desktop library parity:** the offline library shell exposes the same core browsing views as web: all work, documents, presentations, rendered card previews, and document graph. Its deck actions operate on folders and `.elef` archives. Shared browser scenarios verify the same library and graph flow against Rails and the desktop binary. Turbo Drive does not ship; navigation becomes shell view-switching (S1 confirms no controller depends on Turbo events).

## Library implementation boundary

Rails keeps its server-rendered host and the desktop uses a local file-backed host. They share the library's core behavior through the scenario suite: all/document/presentation browsing, rendered work previews, and opening linked documents from the graph. Revisions, lineage, and server-only actions remain behind their existing flags or outside desktop v1; they do not change the core library flow.

## Consequences

- The adapter gets a contract spec and contract tests on both sides; it is the highest-leverage test target in the desktop codebase.
- The adapter's command allowlist is the security-relevant surface ([security.md](../security.md)).
- **Trigger for a native rewrite of a piece:** a concrete feel gap that the shared JS cannot solve. Named gap first, rewrite second.

## Revisit when

S1 shows a controller that depends on server behavior the adapter cannot reproduce with the same JSON shape.
