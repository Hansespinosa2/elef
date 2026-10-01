# ADR-004: Reuse the editor JS via a transport adapter

- Status: **Proposed** (follows from ADR-002 and ADR-003)
- Date: 2026-09-30 (revised 2026-10-01)
- Decider: Andres
- Confidence: medium-high
- Accepted when: ADR-002 and ADR-003 are accepted and S1 completes the adapter spec

## Context

Preference: the editing experience — visual editor, source editor, the editing flow — must be identical between web and desktop; no native rewrite unless a concrete feel gap is named. The editor is already JavaScript (Stimulus + CodeMirror); the surrounding views are server-rendered Rails.

## Options considered

- **Reuse the JS verbatim behind a transport adapter** (chosen).
- **Native rewrite of the editor.** Rejected: contradicts the preference and creates a second editor to maintain.
- **Full view reuse via bundled Rails.** Rejected in [ADR-003](003-file-backend-no-bundled-rails.md).

## Decision (proposed)

- **Reuse verbatim:** the CodeMirror/Stimulus controllers and the editing flow. They run in the Tauri webview unchanged.
- **Transport adapter:** the one seam. The editor's server calls already speak JSON, so the adapter routes the same calls to Rust commands or to webview-local handlers (the renderer worker) with the same payloads. The controllers don't know which backend answered. The adapter also owns the conflict hash handshake so controllers stay unchanged. Spec: [transport-adapter.md](../transport-adapter.md).
- **Host page:** the editor boots inside a server-rendered ERB view (`works/_form.html.erb`). Desktop reproduces it as a **static host-page template** (part of S1): no ERB at runtime, no Rails.
- **Minimal new for v1:** the library shell (deck list, open/import/export chrome) and the conflict UI are new and minimal. Turbo Drive does not ship; navigation becomes shell view-switching (S1 confirms no controller depends on Turbo events).

## An honest note on "identical library"

The preference said library and graph should ideally be identical too. Full view reuse would require bundled Rails (rejected in ADR-003). Resolution: the **editing experience** — ranked most important — is literally the same code; library chrome converges after v1. Recorded here so no agent "discovers" the tension mid-implementation.

## Consequences

- The adapter gets a contract spec and contract tests on both sides; it is the highest-leverage test target in the desktop codebase.
- The adapter's command allowlist is the security-relevant surface ([security.md](../security.md)).
- **Trigger for a native rewrite of a piece:** a concrete feel gap that the shared JS cannot solve. Named gap first, rewrite second.

## Revisit when

S1 shows a controller that depends on server behavior the adapter cannot reproduce with the same JSON shape.
