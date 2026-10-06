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
- **Host page:** the web editor boots inside the Rails ERB view (`works/_form.html.erb`). The standalone file-backed host template and its styles live under Rails `app/` at `app/views/desktop_host.html` and `app/assets/stylesheets/file_library_host.css`; desktop packages those sources without running ERB or Rails. The product workflow also lives under `app/javascript/lib/file_library_application.js`. Tauri's entry point only injects native services and adapters.
- **Desktop library and graph parity:** both hosts mount the same library view component for all work, documents, presentations, search/filter, rendered card previews, and the document graph. `app/javascript/lib/library_card.js` produces the card markup for both hosts; Rails calls it through the shared bundle, and desktop imports it directly. Rails passes trusted route/action slots; desktop binds native file and `.elef` operations. Both hosts use the same Rails styles, graph view, and `presentation-canvas` sizing controller. Shared scenarios verify browsing, previews, inline rename, search/filter, and graph navigation. Renderer-consumer parity and the Rails cutover evidence remain open in [issue #126](https://github.com/Hansespinosa2/elef/issues/126). Turbo Drive does not ship; navigation becomes shell view-switching (S1 confirms no controller depends on Turbo events).
- **Conflict resolution parity:** `app/javascript/lib/editor_view.js` owns one dialog for both hosts, including the disk/current, local, and merged-source choices. Rails' `autosave` controller and the desktop file save flow connect those choices to their own write contracts. The shared external-edit scenario runs each resolution through Playwright and WebdriverIO.

## Library implementation boundary

Rails keeps its server-rendered host and the desktop uses a local file-backed host. The library view, card markup, styles, search normalization, and graph/canvas views are shared; each host supplies trusted data/action slots and binds its own persistence actions. Unit tests compare bundle and direct card output, assert metadata escaping, and keep the native preview read-only after sanitization. Scenario coverage establishes the named common flows; it does not establish every read-only/export consumer or physical-device feel. Revisions, lineage, and server-only actions remain behind their existing flags or outside desktop v1; they do not change the core library flow.

## Consequences

- The adapter gets a contract spec and contract tests on both sides; it is the highest-leverage test target in the desktop codebase.
- The adapter's command allowlist is the security-relevant surface ([security.md](../security.md)).
- **Trigger for a native rewrite of a piece:** a concrete feel gap that the shared JS cannot solve. Named gap first, rewrite second.

## Revisit when

S1 shows a controller that depends on server behavior the adapter cannot reproduce with the same JSON shape, or parity scenarios expose a concrete feel gap that the shared implementation cannot address.
