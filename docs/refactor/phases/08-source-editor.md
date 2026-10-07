# Phase 08 — Source editor

**Goal:** one shared source editor using Work transforms and WorkSession only.

## PASS criteria

- **P08-01** source editor exists only in client; CodeMirror remains an imperative editor adapter hosted behind a narrow client interface.
- **P08-02** editor text mutation reaches persistence only through `WorkSession`; structural source operations use `work-model` transforms rather than duplicated string surgery.
- **P08-03** cursor/selection/undo/redo remain editor-owned and survive expected client rerenders/navigation.
- **P08-04** stale preview/save/search/graph responses after work switch are rejected by identity/generation.
- **P08-05** web policy matches baseline; desktop still passes every Phase 02 save criterion.
- **P08-06** edit-to-visible and typing probes satisfy locked performance policy with no dropped input.
- **P08-07** fresh reviewer performs a dedicated data-safety path audit with a finite checklist enumerated in the PLAN.
