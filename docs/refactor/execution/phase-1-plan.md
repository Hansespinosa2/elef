# Phase 1 plan — Foundations, contracts, and final persistence location

Status: FROZEN at 2026-10-07 (hash recorded in `docs/refactor/status.json`)
Phase contract: `docs/refactor/phases/01-foundations.md` (sha256 `1bda595270159ae4cbdbb87b31951cdeeb9ef28ea5cadef2cb44b3fb530f80d0`)
Phase base: `64abf6ed087f1b1b2ff232f88123c76ca362a7d0`

## 1. Verified facts

| Fact | Evidence (file:line or command → result) |
|---|---|
| No root npm/Cargo workspace; three npm trees (root, desktop/frontend, desktop/e2e); desktop Cargo workspace members `crates/elef-core` + `src-tauri` | `package.json` has no `workspaces` field; `desktop/Cargo.toml:1` members; `ls` shows no `packages/`, `apps/`, `crates/` |
| `elef-core` is pure-Rust persistence core, zero Tauri deps (lib.rs 3154 lines + update_install.rs); no file watcher/merge — optimistic conflicts via base-hash compare | `desktop/crates/elef-core/Cargo.toml:7` deps; grep zero `tauri` hits; `save_source` conflict at `lib.rs:203,1848` |
| `src-tauri` is thin Tauri adapter: 23 commands, delegates persistence to elef-core | `desktop/src-tauri/src/lib.rs:1217` invoke_handler; `Cargo.toml:21` tauri 2.12.1 + elef-core path dep |
| No TypeScript anywhere; plain JS es2022, node:test + linkedom | No `tsconfig*`/`*.ts`; both package.json `type: module` |
| Single renderer source `app/javascript/lib/renderer.js`, three consumption shapes; committed copies `vendor/javascript/elef-renderer.bundle.js` + `app/assets/builds/tailwind.css`; desktop dist/ NOT committed | `script/build_renderer.mjs:7,11`; `desktop/frontend/build.mjs:106-118`; `git ls-files` shows vendor bundle + tailwind.css, no desktop/frontend/dist |
| `app/javascript/lib/` (37 files) framework-neutral; 28 Stimulus controllers are thin DOM wrappers | Zero stimulus imports in lib; 28 `extends Controller`; `#elef/` aliases in root package.json + `desktop/frontend/build.mjs:12-16` |
| Desktop frontend talks Tauri `invoke` (open_deck/save_source+baseHash, ~18 cmds); Rails via HTTP + Stimulus fetch shims | `desktop/frontend/src/transport-adapter.js:6,26`, `file-library-transport.js:3-20`, `main.js:28-40` |
| Rails ops: LibraryController (index/search), Presentations/DocumentsController CRUD + preview/history/restore/export/import/assets, WorkspaceSettingsController, WorkSearch, WorkPackage exporter/importer; no Jobs/Mailers | `config/routes.rb:1-56`; controllers listed per-file; `app/jobs`, `app/mailers` absent |
| CI: 13-job `ci.yml` (ubuntu desktop-fast/test/sqlite/system/smokes + macos desktop-macos/renderer-macos + native desktop jobs); 6 `desktop/Cargo.*` refs; cargo audit on `desktop/Cargo.lock` | `.github/workflows/ci.yml:15,45,179,227,247-251,325,382-386,448` |
| Ownership checker: no `desktop/` literals under app/bin/config/lib/script; UI-extension ban under desktop/; version parity desktop deps vs importmap; 12 shared workflows; desktop src allowlist (10 adapter files) | `script/check_frontend_ownership.py:13-33,42-57,183-322,324-468` |
| Arch checker pins Tauri command/capability parity + Rails-owns-markup rules | `desktop/scripts/check_architecture.py` (build.rs↔lib.rs↔main.json; desktop/src has no .html/.css) |
| `bin/check`: only `phase 0` runs; other tiers stub exit 2; DESKTOP_PATH_PREFIX avoids `desktop/` literals | `bin/check:25-26,47+`; phase-0 constants (EXPECTED_*_SHA256, 14 scenarios) |
| Local toolchain gaps: system ruby 3.3.8 vs pinned 3.4.3 (bundle gems absent); no Chromium; tauri-driver/WebKitWebDriver/xvfb present | Prereq probe 2026-10-07; round-2 review §Verified/not-verified |
| 14 shared scenarios in `test/e2e/scenarios/`; `hostile-deck` covers sanitizer boundary | `test/e2e/scenarios/` listing; `preview_sanitizer.js:1-21` |

Open questions / unknowns: none blocking. TypeScript compiler availability via npm registry is a DO step-0 check (root node_modules exists; registry reachable in CI regardless).

## 2. Scope

In scope:

- Root npm workspace (`packages/*`) + root Cargo workspace (`crates/local-store`, `desktop/src-tauri`, one root `Cargo.lock`).
- `packages/contracts`: strict-TS public types + operation signatures exactly per contract §Normative interfaces; type-level tests.
- `crates/local-store`: `git mv desktop/crates/elef-core` + package rename `elef-core`→`local-store`; zero behavior change.
- One conformance suite (`tests/host-conformance/`) + three adapters (fake in-memory, rails-http over fetch, tauri-invoke over invoke fn) + `mountElef` minimal client shell; adapters prove P01-02/P01-03/P01-07.
- `tooling/check_boundaries.py`: dependency-direction + package-admission enforcement + forbidden-import canary fixture.
- `bin/check quick/affected/phase/all` real implementations with timing instrumentation; phase-0 path behavior unchanged.
- Canonical `dist/` home for Phase-01-generated artifacts (`packages/contracts/dist/`) + freshness check (P01-08).
- CI updates: Cargo path refs, audit file, conformance steps (system-test rails-http, desktop-job tauri-invoke wdio spec, fake everywhere).

Non-goals (explicitly deferred):

- Migrating renderer/work-model/client features (Phases 03–09); renderer bundle + tailwind committed copies stay until their owning phases.
- Moving Rails app or desktop frontend into `apps/` (Phase 11 host rehome); adapters live in `tests/host-conformance/adapters/` as proof artifacts until hosts rehome.
- Joining `desktop/frontend`, `desktop/e2e` npm trees into the root workspace (native-only deps; rehome phase).
- Durable-docs promotion (Phase 12); `docs/desktop/` + ADRs untouched.
- Any product behavior change: no host consumes new adapters/shell yet.

## 3. Ownership classification

| Change | Semantic owner (constitution §4) | Shared or host-specific (+ concrete reason) |
|---|---|---|
| `packages/contracts` types | `contracts` | Shared: one canonical definition inherited by web/desktop/fake adapters + future client |
| `tests/host-conformance` suite + fake adapter | `tests` (cross-boundary scenarios) | Shared: single suite executed against all three adapters |
| rails-http adapter | web host (proof artifact in tests/ until Phase 11) | Host-specific: HTTP+CSRF against Rails routes is web-only transport |
| tauri-invoke adapter | desktop host (proof artifact in tests/ until Phase 11) | Host-specific: `invoke` transport + native capabilities are desktop-only |
| `mountElef` minimal shell | `client` seed (lives in tests/ until Phase 04) | Shared: host-neutral shell driven only by `ElefHost` + capabilities, no host-name branching |
| `crates/local-store` move+rename | `local-store` | Shared engine; move is structural, zero semantic change |
| Root npm/Cargo workspaces | `tooling` (build topology) | Shared mechanism; member sets grow in later phases |
| `tooling/check_boundaries.py` | `tooling` | Shared enforcement of §4 dependency direction |
| `bin/check` tiers | `tooling` | Shared verification; phase-0 path frozen |

Package admission for `packages/contracts` (§3 law, in writing):

1. One cohesive responsibility: host/client ports + cross-boundary types — yes (contract §5 items only).
2. Small stable public API: the frozen interfaces, versioned by the constitution — yes.
3. Acyclic, machine-enforceable direction: depends on no Elef package; enforced by `tooling/check_boundaries.py` — yes.
4. Meaningful independent tests: strict-`tsc` compile + type tests + consumer conformance suite — yes.
5. Concrete payoff: three adapters + shell share one definition instead of three parallel typings — yes.
6. Interface-centric package, explicitly exempt from hiding-complexity bar — yes (constitution §3).
Driver: multiple architectural consumers across runtimes (Rails-HTTP JS, Tauri-invoke JS, fake, future client) — satisfied. No other package/crate/top-level dir is created.

## 4. Behavior to preserve

| Behavior | Proving test/scenario/fixture |
|---|---|
| Desktop persistence semantics (discovery/atomic save/optimistic conflict/trash recovery/archives/quotas) | `cargo test -p local-store --locked` (same suite, new path) + CI desktop jobs |
| Renderer byte parity + hostile-document sanitization | `test/javascript/renderer_fixtures.test.js`, hostile-deck scenario, `bin/check phase 0` fixture hashes |
| Ownership/architecture rules unweakened | `script/check_frontend_ownership.py`, `desktop/scripts/check_architecture.py` green in CI |
| Unimplemented-tier failure signal (I15) | Stubs that remain unimplemented keep exit-nonzero; implemented tiers exit 0 only on real success |
| All 14 shared scenarios + CI job set green on exact candidate | CI run for the DO candidate |

Intended behavior changes: none (contract names no behavior change; P01-01–P01-08 are seams, not behavior).

## 5. Work breakdown

Ordered steps; structural moves and behavior changes in separate commits:

1. `chore`: step-0 registry check (`npm view typescript version`); root `package.json` `workspaces: ["packages/*"]`; `packages/contracts` scaffold (package.json, strict tsconfig, `src/*.ts` mirroring contract §Normative interfaces verbatim, type tests). Additive only.
2. Structural move commit: `git mv desktop/crates/elef-core crates/local-store`; package rename `elef-core`→`local-store`; root `Cargo.toml` workspace (`members = ["crates/local-store", "desktop/src-tauri"]`, resolver 2); remove `desktop/Cargo.toml` workspace wrapper + `desktop/Cargo.lock` (regenerate root lock via `cargo generate-lockfile` + `cargo test -p local-store --locked`); update `desktop/src-tauri/Cargo.toml` path dep; update 6 CI Cargo refs + audit file; delete nothing else.
3. Conformance commit: `tests/host-conformance/` suite (one case list per port minimum behavior + WorkSession lifecycle incl. conflict path + capability-branching check), three adapters, fake host, `mountElef` shell (`shell.js`: library list via `host.library`, capability-gated, no host-name branches).
4. Tooling commit: `tooling/check_boundaries.py` (+ canary fixture `tooling/canary/` that must be rejected); `bin/check` real `quick/affected/phase/all` with per-command timing + ceiling enforcement (quick 180 s, affected 420 s); phase-0 code path untouched; `packages/contracts/dist/` canonical output + freshness check (rebuild to temp, compare, leave checkout clean).
5. CI commit: conformance steps — `test`/`system-test` jobs run node suite with fake adapter; system-test boots Rails test server and runs rails-http adapter; desktop job adds wdio spec executing the suite against the invoke transport in-app; macOS job runs fake + suite. No thresholds weakened.

## 6. Deletions and temporary compatibility

| Item | Owner | Reason | Deletion condition |
|---|---|---|---|
| `desktop/Cargo.toml` workspace wrapper + `desktop/Cargo.lock` | tooling | Single root Cargo workspace/lockfile per target | This phase; CI updated in same commit |
| Crate name `elef-core` | local-store | Final engine name per constitution §4 | This phase; references updated in same commit |
| `packages/contracts` prose duplication | contracts | Code is the documentation (P01-01) | Never add prose mirrors |

No temporary compatibility paths are introduced (plan records none per I13).

## 7. Risks and rollback triggers

| Risk | Trigger | Response |
|---|---|---|
| Root workspace breaks Tauri build | CI desktop/desktop-macos red on candidate | Revert to `desktop/Cargo.*` layout; keep contracts/conformance (additive) |
| npm workspaces alter install surface | `npm ci` time/behavior drift or ownership parity failure | Restrict members; never pin around the checker |
| Rails-http adapter diverges from real routes | System-test conformance red | Fix adapter to routes (routes are authority); no route changes for conformance |
| Timing ceilings missed on 8 GB container | Warm quick >180 s / affected >420 s | Optimize selection/caching first; owner-approved exception only with evidence/scope/expiry |
| Data-safety regression | Any atomicity/conflict/trash test red | Full rollback to `phase_base_sha`; local-store move re-attempted cleanly |

Rollback reference: `phase_base_sha 64abf6e` (Phase 00 PASS) + CI run 37614783436 evidence.

## 8. Proof map

| Criterion / invariant | Proof (command, test, CI job, reviewer checklist) | Tier | Environment needs |
|---|---|---|---|
| P01-01 types compile strict TS, code-documented | `tsc --noEmit -p packages/contracts` + type tests; reviewer reads `packages/contracts/src` | quick/local | Node 22 + npm TS install |
| P01-02 three adapters pass one suite | `tests/host-conformance` vs fake (local+CI); vs rails-http (CI system-test + booted server); vs tauri-invoke (CI desktop wdio spec) | affected (fake) / CI (rails, tauri) | CI runners; local Ruby gap recorded, not converted to PASS |
| P01-03 WorkSession exact + adaptable policies | Suite session cases (dirty/save/conflict/external/status) on all adapters; reviewer checks no host-name branch in shell/adapters | affected / CI | Same as P01-02 |
| P01-04 local-store tests headless, no Tauri | `cargo test -p local-store --locked`; `tauri` absent from `crates/local-store` (checker+grep) | quick/local | Rust stable (1.99 present) |
| P01-05 checker rejects canary + violations | `tooling/check_boundaries.py` incl. canary fixture must-fail case; reviewer inspects allowlists unchanged-or-smaller | quick/local | python3 |
| P01-06 quick ≤180 s, affected ≤420 s warm | Post-bootstrap warm timing from `bin/check` instrumentation, recorded in execution evidence | quick/affected | 8 GB container, warm caches |
| P01-07 fake host mounts shell, no Rails/Tauri | Headless linkedom/DOM-free mount test with process assertion (no rails/tauri proc); CI desktop-fast | quick/local | Node 22 |
| P01-08 one canonical dist home, fresh, no diff | Freshness check rebuild-to-temp + `git status --porcelain` clean; reviewer confirms no committed copies | affected | Node 22 |
| I01/I16/I17 (new boundaries/packages/features) | Boundary checker + admission record §3 above; client feature rules N.A. (no features yet) | quick + review | — |
| I02–I05/I08/I11/I12 (future owners) | N.A. with introduction phases (03–09); unchanged code reviewed vs locked baseline | review | — |
| I06/I07/I09/I13/I14 (always-on) | Full suite green; no compat paths; no weakened tests; docs/state factual | all tiers + review | — |
| I10 (budgets) | P01-06 timings + locked product baselines unchanged | quick/affected | Warm container |
| I15 | Remaining stubs fail nonzero; covered in gate | phase gate | — |
| I18 (5-minute routing) | `docs/architecture.md` untouched this phase; reviewer unseen-routing exercise uses plan §5 + ownership table | review | — |

Fixed fixture sets / finite reviewer checklists: conformance case list (library: list/create/rename/delete; works: get/save-clean/save-conflict; media: add/list/resolve/remove; settings: get/update; search: requestId echo + hits; transfer: export/import round-trip; session: dirty→flush-saved, stale→conflict, external callback, status transitions); canary fixture must be rejected; timing table from two warm runs.

Human gates touched (constitution §8): none.

## 9. Re-plan log

<!-- Append dated entries: defect found, what changed, new hash. Never rewrite earlier sections silently. -->
- 2026-10-07: initial freeze.
- 2026-10-07 re-plan (DO reality check before new production edits; steps 1–2 already committed stay valid): transport inventory proved three host gaps that P01-02's "transfer/media minimum behavior" cannot be tested through. (a) Tauri exposes no media list/remove seam (`upload_asset` only; reads via `elefasset://` protocol) and no import-bytes seam (`import_elef` needs a native dialog or OS open event; only `ELEF_E2E_EXPORT_PATH` exists for export). (b) Rails serves no JSON list/single-read for works, no settings read, no media list/remove, and HTML-only import. Added scope, reusing existing services only: three Tauri commands (`list_media`, `remove_media` over new core fns, `import_elef_bytes` over the existing `import_archive` helper incl. its conflict machinery) with capability/build-registry updates; one thin `HostApiController` JSON surface (works list/get/create/save/rename/delete, media list/remove, settings get/update over workspace style defaults, import wrapper) reusing `Document`/`Presentation`, `Drafts::Save` (saved/409-conflict), `WorkPackage` exporter/importer, `WorkSearch`, existing asset routes. No existing behavior changes; no new product UX. Proof change: conformance covers all added seams; only `delete_deck`'s native confirm stays dialog-mediated on Tauri (declared skip in suite, covered by the existing `library-create-delete` UI workflow with xdotool/mac-dialog handling). Search on Tauri is adapter-side filtering over `document_graph` (documented policy). Work breakdown step 3 now includes the seam commits before the adapter commit; §8 proof map unchanged in structure.
