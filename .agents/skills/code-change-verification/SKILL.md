---
name: code-change-verification
description: Use after Elef code, build, contract, test, fixture, or runtime behavior changes to choose and run the cheapest sound verification tier (quick → affected → phase → all) and record exactly what ran. Also covers resource limits and environment-unavailable checks.
---

# Code change verification

Tier definitions, time budgets and permanent invariants are owned by `docs/refactor/CONSTITUTION.md` §6–§7 (and, after the campaign, `docs/development.md`). This skill is how to apply them.

## 1. Choose the tier from the diff

`git diff --stat <last verified sha>..HEAD` (+ working tree). Map changed paths to owners (`docs/architecture.md`, constitution §4) and pick the smallest sound tier:

| Situation | Tier |
|---|---|
| ordinary edit inside one owner | `bin/check quick` |
| change visible to other owners (public API, contract, renderer output, shared scenario, styles, build config) or before committing a DO step | `bin/check affected` |
| phase candidate (CHECK) | `bin/check phase N --json` → save stdout to `docs/refactor/execution/phase-N-gate.txt` |
| Phase 12 / release envelope | `bin/check all` (twice on a clean checkout for invariant 15) |

Never run full Rails + Tauri/release validation after each small edit. Never skip a tier the change requires.

**Before `bin/check` exists** (Phase 00 creates the skeleton; Phase 01 implements tiers), use the per-change commands in `docs/development.md` → *Fast checks* and *Generated assets and review*, choosing the narrowest one first (e.g. a focused `bin/rails test path`, `npm run test:javascript`, `cargo test --manifest-path desktop/Cargo.toml -p elef-core --locked`). Once `bin/check` exists it is the canonical entry point; if it lacks a needed selection, improve `bin/check` instead of bypassing it.

## 2. Environment rules (owner's Omarchy checkout and the ~8 GB container alike)

- Run `python3 .agents/skills/elef-campaign/scripts/campaign_state.py probe` before environment-dependent checks.
- The owner's server occupies `https://127.0.0.1:3000/`. Never stop, restart, or re-port it, and never point tests at it or at personal data. Harnesses that need port 3000 (currently `npm test --prefix desktop/e2e`) cannot run locally while it is up: use CI on the draft campaign PR for that evidence (see `elef-campaign/references/state-protocol.md`), or make the harness port configurable as planned tooling work.
- Browser automation is headless. Never open visible native windows on the owner's desktop; local real-Tauri runs require `xvfb-run` + `tauri-driver` + `WebKitWebDriver`.
- CI uses Node 22. When local `node` differs, run Node-sensitive checks with Node 22 (e.g. `mise exec node@22 -- <cmd>`) and record the version used.
- Serialize heavyweight groups (Rails system tests, browser/WebDriver suites, Cargo builds, Tauri builds). Start with conservative workers (`PARALLEL_WORKERS=1`/small `--test-threads`/`-j`), increase only after measured headroom. Keep npm/Cargo/browser caches.
- OOM or resource kill (exit 137, `Killed`, browser crash under memory pressure): reduce concurrency, isolate, rerun before classifying as a product failure. Record both runs.
- Measure `quick`/`affected` budgets warm; record cold bootstrap separately.

## 3. On failure

Fix failures your change caused, then rerun the same tier. Pre-existing failures unrelated to your change: confirm on `phase_base_sha`, record them in the phase evidence, and do not hide them. Never weaken, skip, `xfail`, loosen thresholds, regenerate baselines/fixtures to match new output, or grow an allowlist to get green — unless the frozen phase contract explicitly replaces that evidence with stronger/equivalent evidence.

## 4. Record

For each check that actually ran, add to `status.last_verified_checks` (at checkpoint commits) `{"command", "exit", "head", "duration_s", "tier"}` and keep logs needed by the reviewer under `docs/refactor/execution/`. In reports, state the tier, platform and Node/Ruby version actually used, and list what was **not** verified and why (e.g. `native Tauri: unavailable locally — missing tauri-driver; CI run <url> for <sha>`). Distinguish DOM assertions, exact reproduction of user state, and inspected screenshots; never claim a higher level than performed. A check that did not run is never reported as passing.
