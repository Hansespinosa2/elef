# Phase 00 — Baseline and factual verification

**Goal:** establish a reproducible base and replace every migration assumption with repository evidence before structural work.

## PLAN must establish

- campaign branch/base SHA and ancestry relative to `feat/desktop-app-v1`;
- actual execution environment: OS/arch, RAM, swap, CPU count, free disk, display/headless-display mode, Tauri/webview prerequisites, and required toolchains;
- current CI jobs and OS tiers;
- existing architecture/ownership checks and what they actually enforce;
- current renderer entry points, fixtures, build artifact locations and runtimes, including whether Rails still executes it server-side;
- current Playwright/WebdriverIO/shared scenario structure and scenario counts;
- current `docs/desktop`/ADR inventory and contradictions;
- current outside-file watching/recovery/snapshot behavior;
- current graph metadata/identity behavior;
- existing performance probes, ceilings and CI timing;
- cold-bootstrap time separately from warm `quick`/`affected` timing on the 8 GB-class Linux container;
- whether real Linux Tauri/WebdriverIO execution is available in-container; if not, the exact missing prerequisite;
- framework-neutral JS modules versus Stimulus glue;
- current sanitization boundary;
- every web deployment/root-layout dependency, Mac mini watcher/deploy convention and CI path filter;
- npm/Cargo lock/workspace/version state;
- current product URLs/deep links and web-only pages;
- current production Node/runtime requirements.

Record evidence in `docs/refactor/baseline.md` and machine values in `docs/refactor/baseline.json`.

## DO

Only bootstrap campaign state/check skeleton and factual documentation. Do not move production architecture yet.

## PASS criteria

- **P00-01** `status.json` names actual campaign base/head and phase state.
- **P00-02** every PLAN fact above has file/command evidence; unknown facts are explicit blockers, not guesses.
- **P00-03** baseline records renderer fixture hashes, shared scenario names/counts, current architecture violations, current CI durations, existing product-performance probes, environment fingerprint, native-runner capability, cold-bootstrap duration and warm fast-path timings.
- **P00-04** `bin/check` exists with `quick`, `affected`, `phase`, `all`, `arch`, `fresh`, `docs`, `perf`; unimplemented commands fail nonzero rather than silently passing.
- **P00-05** baseline verification is read-only and rerunnable on the same SHA.
- **P00-06** current working web and desktop builds are reproducibly identified as rollback references.

`bin/check phase 0` verifies P00-01/03/04/05 automatically; reviewer verifies P00-02/06 and confirms unavailable native/macOS evidence is recorded rather than silently treated as PASS.
