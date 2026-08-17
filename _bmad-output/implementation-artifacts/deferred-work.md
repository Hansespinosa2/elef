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
