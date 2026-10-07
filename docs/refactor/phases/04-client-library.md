# Phase 04 — Shared client shell and library slice

**Goal:** prove the complete host-neutral client model with the library as the first real vertical slice.

## PASS criteria

- **P04-01** `packages/client` is the only implementation of product library behavior/UI; old product-library Stimulus/ERB implementations are deleted after switch-over.
- **P04-02** both hosts call the same `mountElef` entry point; fake host still mounts it.
- **P04-03** list/search/filter/create/open/rename/delete library scenarios are specified once and pass against Rails and Tauri adapters.
- **P04-04** existing web library deep links resolve through the client shell.
- **P04-05** client imports no Rails/Tauri/filesystem/ActiveRecord code and contains no host-name branch.
- **P04-06** library feature has no direct deep import into unrelated features; cross-feature composition stays in `application/`.
- **P04-07** library cold/open/filter probes remain within locked performance policy.
