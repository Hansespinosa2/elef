---
name: code-change-verification
description: Use after Elef code, build, contract, test, or runtime behavior changes to select and run the cheapest sound verification.
---

# Code change verification

Inspect the diff and affected architectural owners.

Use the smallest sound tier:
1. `bin/check quick`
2. `bin/check affected`
3. `bin/check phase N` at a phase/integration gate
4. `bin/check all` only at full/release gates

Run focused unit/component/contract tests when they shorten iteration, but canonical PASS comes from repository checks.

## 8 GB Linux policy
- serialize unrelated heavyweight jobs;
- start with conservative workers;
- preserve safe caches;
- measure ordinary feedback warm, excluding first dependency/bootstrap compile;
- if OOM/resource-killed, reduce concurrency/isolate and rerun before classifying a product failure;
- never weaken tests or silently skip a required check;
- never claim macOS or unavailable real-Tauri behavior passed.

Record exactly what ran, result, duration, and what remains unverified.
