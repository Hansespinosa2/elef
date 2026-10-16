---
name: code-change-verification
description: Use after Elef code, build, contract, test, fixture, or runtime behavior changes to choose and run the cheapest sound verification tier (quick → affected → all) and record exactly what ran. Also covers resource limits and environment-unavailable checks.
---

# Code change verification

Tier definitions, time budgets and permanent invariants are owned by `docs/development.md`. This skill is how to apply them.

## 1. Choose the tier from the diff

`git diff --stat <last verified sha>..HEAD` (+ working tree). Map changed paths to owners (`docs/architecture.md`) and pick the smallest sound tier:

| Situation | Tier |
|---|---|
| ordinary edit inside one owner | `bin/check quick` |
| before a coherent behavior/build/contract checkpoint, including an ordinary single-owner change; also after changes visible to other owners | `bin/check affected` after quick |
| release-scale change | `bin/check all` |

Never run full Rails + Tauri/release validation after each small edit. Never skip a tier the change requires.

## 2. Environment rules (owner's Omarchy checkout and the ~8 GB container alike)

- Use the environment checks in `docs/development.md`. Select installed toolchains explicitly; a probe must not install them.
- The owner's server occupies `https://127.0.0.1:3000/`. Never stop, restart, or re-port it, and never point tests at it or at personal data. The e2e harness (`npm test --prefix apps/desktop/e2e`, seeded via `bin/check all`) needs port 3000; it cannot run locally while the server is up — use CI on the PR for that evidence, or make the harness port configurable as planned tooling work.
- Browser automation is headless. Never open visible native windows on the owner's desktop; local real-Tauri runs require `xvfb-run` + `tauri-driver` + `WebKitWebDriver`.
- CI uses Node 22. When local `node` differs, run Node-sensitive checks with Node 22 (e.g. `mise exec node@22 -- <cmd>`) and record the version used.
- Inspect command resolution before using environment wrappers. If a wrapper loops or rewrites global tool configuration, stop only your invocation and use the actual installed executable (inspect the directory reported by `mise where <tool>@<version>`). Do not change the owner's global configuration merely to run a check. This checkout has exhibited recursive `codex` and `gh` wrappers.
- Serialize heavyweight groups (Rails system tests, browser/WebDriver suites, Cargo builds, Tauri builds). Start with conservative workers (`PARALLEL_WORKERS=1`/small `--test-threads`/`-j`), increase only after measured headroom. Keep npm/Cargo/browser caches.
- OOM or resource kill (exit 137, `Killed`, browser crash under memory pressure): reduce concurrency, isolate, rerun before classifying as a product failure. Record both runs.
- Measure `quick`/`affected` budgets warm; record cold bootstrap separately.

## 3. On failure

Fix failures your change caused, then rerun the same tier. Pre-existing failures unrelated to your change: confirm on the merge-base with `dev`, record them in the PR evidence, and do not hide them. Never weaken, skip, `xfail`, loosen thresholds, regenerate baselines/fixtures to match new output, or grow an allowlist to get green.

## 4. Record

For each check that actually ran, record `{"command", "exit", "head", "duration_s", "tier"}` in the commit message or PR description and keep logs attached to the PR. In reports, state the tier, platform and Node/Ruby version actually used, and list what was **not** verified and why (e.g. `native Tauri: unavailable locally — missing tauri-driver; CI run <url> for <sha>`). Distinguish DOM assertions, exact reproduction of user state, and inspected screenshots; never claim a higher level than performed. A check that did not run is never reported as passing.

Native CI evidence must name the exact candidate, real runner, required scenarios, checkout identity, exits and artifacts. CI success alone is not proof.
