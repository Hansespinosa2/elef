- source_spec: none
  summary: Add semantic component and automatic layout support.
  evidence: Deferred from the initial broad product concept so the first build can focus on the renderer vertical slice.
- source_spec: none
  summary: Add LaTeX, charts, diagrams, and Python computation.
  evidence: Deferred from the initial broad product concept so the first build can focus on the renderer vertical slice.
- source_spec: none
  summary: Add deterministic overflow validation and pinned presentation snapshots.
  evidence: Deferred from the initial broad product concept so the first build can focus on the renderer vertical slice.
- source_spec: none
  summary: Add a synchronized visual editor and canvas.
  evidence: Deferred from the initial broad product concept so the first build can focus on the renderer vertical slice.
- source_spec: none
  summary: Add export formats and AI-assisted authoring.
  evidence: Deferred from the initial broad product concept so the first build can focus on the renderer vertical slice.
- source_spec: `_bmad-output/implementation-artifacts/spec-live-markdown-editor.md`
  summary: Add application-level integration coverage for editor, preview, and replacement flows.
  evidence: The current verification covers parser and dirty-state helpers, but does not render App or exercise browser file selection, live preview synchronization, or confirmation cancellation.
- source_spec: `_bmad-output/implementation-artifacts/spec-live-markdown-editor.md`
  summary: Improve accessible dirty-state communication and long-document-name toolbar behavior.
  evidence: Dirty state is currently conveyed with a visual asterisk and long source names have no overflow treatment, which can reduce clarity or toolbar usability.
- source_spec: `_bmad-output/implementation-artifacts/spec-domain-inspired-editor-architecture.md`
  summary: Add browser and Tauri adapter integration coverage for picker cancellation and platform-specific read failures.
  evidence: The refactor now isolates both adapters, but current tests cover only browser document loading through a simplified integration path and do not exercise cancellation or Tauri error normalization.
- source_spec: `_bmad-output/implementation-artifacts/spec-domain-inspired-editor-architecture.md`
  summary: Add UI-level coverage for replacement cancellation and the hidden browser input wiring.
  evidence: Application session tests cover core synchronization, but no rendered App test verifies that user cancellation preserves the editor or that browser file selection reaches the session.
- source_spec: none
  summary: Add an in-app flow for creating a new Elef World folder from the setup screen.
  evidence: The user chose to handle the Rust future-incompatibility warning before returning to folder creation.
