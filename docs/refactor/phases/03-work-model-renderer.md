# Phase 03 — Work model and renderer

**Goal:** give Elef Work semantics and visual projection separate, deep, host-neutral owners.

## DO target

Extract current document/presentation source semantics into `packages/work-model`; reduce `packages/renderer` to projection only.

## PASS criteria

- **P03-01** `work-model` parses both `document` and `presentation` Works and owns front matter, directives, structural ranges, links and pure source transforms used by editors.
- **P03-02** `work-model` imports no DOM/React/Rails/Tauri/filesystem/network code and runs under Node tests.
- **P03-03** renderer takes Work/model input and contains no add/delete/move/editor-control UI, Stimulus actions or persistence behavior.
- **P03-04** renderer is deterministic and hostile-content fixtures are safe.
- **P03-05** identical renderer fixtures pass in Node 22, Chromium, real Tauri webview path, and the actual Rails server-side JS engine if that path still exists.
- **P03-06** one source-semantic fixture corpus covers documents, presentations, directives, math, media, links, malformed source, line endings and source ranges.
- **P03-07** Ruby/Rust do not independently reinterpret Work syntax except schema/format validation explicitly required by `spec`.
- **P03-08** package APIs satisfy the admission/deep-module rules; reviewer records one-sentence justification for each production package.
