# Phase 10 plan — Full product parity and change-locality proof

Status: FROZEN at 2026-10-09 (hash recorded in `docs/refactor/status.json`)
Phase contract: `docs/refactor/phases/10-parity.md` (sha256 `181dbe440cf7b66ee058fbc5fbce9b0de26886c1ce5a0973d4186a706fb247fc`)
Phase base: `7556161a411bb211063b7a362814c43fd79f7926`

## 1. Verified facts
| Fact | Evidence (file:line or command → result) |
|---|---|
| 15 shared scenario modules live once in `test/e2e/scenarios/` | `find test/e2e -type f` → 15 `.js` files: appearance, authoring-palettes, authoring-settings, document-page-aspect-ratio, edit-and-preview, external-edit-conflict, hostile-deck, insert-image, library-and-graph, library-create-delete, library-deep-links, media-fixture, presentation-mode, undo-redo-session, vim-relative-line-numbers |
| Both real-host runners import the same 13 scenario modules directly | `grep ^import desktop/e2e/specs/{web,desktop}.spec.js` → identical 13-module lists (Playwright web runner + wdio Tauri runner) |
| Remaining 2 modules run nested inside edit-and-preview on both runners | `test/e2e/scenarios/edit-and-preview.js:1-2` imports `undoRedoSessionWorkflow` + `insertImageWorkflow`; all 15 modules reachable from both runners |
| Sampled workflows execute on both runners | `grep -c hostileDeckNeutralizedWorkflow/presentationModeWorkflow/vimRelativeLineNumbersWorkflow` → 6 hits in each spec file |
| One contract conformance suite, three adapters | `tests/host-conformance/suite.js` (`SUITE_VERSION=1`, runner-agnostic cases); adapters: `adapters/fake-host.js`, `app/javascript/host/rails-http-host.js` (`createRailsHost`), desktop via `desktop/e2e/specs/contract-conformance.spec.js` |
| Fake-host conformance runs standalone | `node tests/host-conformance/run-node.js fake` → 12/12 pass, ~12 ms, no Rails/Tauri process |
| Client suite mounts via `mountElef` + fake host under plain node | `packages/client/test/helpers.tsx:6-7,12,36` (`createFakeHost`, `mountElef`); `packages/client/run-tests.mjs` bundles with esbuild and runs under `node:test` into an OS temp dir (never dirties checkout) |
| Quiet-save (13 tests) is desktop/wdio-only | `desktop/e2e/specs/quiet-save.spec.js:1` imports `@wdio/globals`; web save/conflict covered by `external-edit-conflict` scenario + Rails system tests |
| Export is shared-client logic with web-only surface | `packages/client/src/features/export/{pptx.js,registry.js}` exported from `index.ts`; web: `app/javascript/controllers/pptx_export_host_controller.js` + `config/routes.rb:45,65` (`get :export`); desktop: zero export consumers; shared scenarios: zero pptx/pdf coverage (`grep -i pptx/pdfExport` → empty) |
| No host-differences inventory exists | `grep -ri host-differences docs packages desktop tests tooling` → no matches |
| No change-routing exercise mechanism exists | `grep -ri change-routing/routing exercise` in docs/tests/tooling/bin → no matches (only contract/constitution mentions) |
| Capability-disabled assertions are nearly absent | `grep -i capabilit` over specs+scenarios → 2 hits only (`web.spec.js:957` updater-absent, `desktop.spec.js:1949` status-line comment) |
| Warm `quick`/`affected` far under hard ceilings | `bin/check quick` → PASS 17.0s (ceiling 180s); `PGPASSWORD=postgres bin/check affected` → PASS 48.8s (ceiling 420s) |
| `baseline.json` scenario record (14 names) is Phase-00-locked | `check_scenarios` runs only in the phase-0 gate (`bin/check:447-502`); live tree has 15 files; baseline stays untouched (I14) |
| Local PG procedure is evidenced | `docs/refactor/execution/phase-9-ci-evidence.json` records `PGPASSWORD=postgres bin/check affected` → exit 0 |
| Durable routing docs exist | `docs/architecture.md` code map + `docs/development.md` fast-checks table; change-routing examples to be verified by DO-6 exercises |
| Toolchains | `node --version` → v22.23.2 (matches CI); `ruby` 3.3.8; `rustc` 1.99.0 |

Open questions / unknowns (each is a blocker or has a resolution step):
- None. Export-on-desktop support is resolved as absent (evidence above); the plan asserts it explicitly rather than building it (desktop export UI is out of scope — no phase contract requires it, and YAGNI forbids speculative product surface).

## 2. Scope
In scope:
- `tests/host-differences.md`: the host-differences inventory. One entry per concrete platform/capability difference, each naming the `HostCapabilities` key(s), the concrete reason (OS/API/data-shape fact, never "desktop/web can be different"), the supported side's proof and the disabled side's explicit assertion + proof location (P10-03).
- Capability matrix proof: every `HostCapabilities` key (accounts, collaboration, entitlements, updater, nativeMenus, localFilesystem) asserted on both runners — supported behavior runs, disabled behavior asserts absence explicitly (P10-02). Missing assertions are added to the specs (new `test()` blocks, no runner changes).
- `test/e2e/scenarios/export.js`: shared export definition. Web branch runs the client `features/export` flow against Rails; desktop branch asserts the explicit capability-disabled path. Wired into both runners (P10-01 export limb + P10-02).
- P10-01 coverage map: every listed area (library, create/open/rename/delete, source/visual editing, preview, presentation, graph, authoring, media, settings, save/conflict/recovery, supported export) mapped to its scenario module(s) + both-runner execution proof. Gaps found during mapping are closed by scenario/suite additions in this phase, not by reinterpretation.
- P10-04: three seeded unseen exercises under `docs/refactor/execution/phase-10-exercises/` (one shared feature, one web-only bug, one desktop/local-store bug), each completed by a fresh subagent in ≤5 min wall-clock (spawn delivery → correct owner + proof commands). Transcripts + timings + verdicts committed as evidence.
- P10-05: one representative 5-line behavior-preserving client change, kept in the tree, with warm `quick` + `affected` timings recorded (no full host E2E during the iteration).
- P10-06 machine proof: client suite + fake-host conformance pass with no Rails/Tauri process (procedure asserts zero listeners/servers first); enforced by the phase gate.
- `bin/check` Phase 10 gate (`phase 10 --json` + `ELEF_PHASE_10=PASS`): live scenario inventory (16 files incl. new export), both-runner wiring assertion, host-differences shape check, exercise-evidence check, P10-05/P10-06 evidence check, no budget/baseline/threshold/contract drift.

Non-goals (explicitly deferred to later phases):
- Building desktop export UI or any new product surface (no contract requires it).
- `baseline.json` / Phase-00 locked facts: untouched (I14).
- `bin/check all` implementation (Phase 12; I15 stays N.A. with the same reason).
- `dev` reconciliation (deferred to endgame per `docs/refactor/deferred-dev-reconciliation.md`).
- No new packages.

## 3. Ownership classification
| Change | Semantic owner (constitution §4) | Shared or host-specific (+ concrete reason) |
|---|---|---|
| `tests/host-differences.md` inventory | `tests/` (parity scenarios) | Shared: one inventory describing both hosts, consumed by both runners' assertions |
| `test/e2e/scenarios/export.js` + runner wiring | `tests/` + existing runner specs | Shared definition; per-runner branches keyed on capability, never host name (§5) |
| New capability-disabled `test()` assertions | `tests/` (runner specs) | Shared definitions; each asserts its own host's declared capability |
| P10-05 5-line client change | `client` | Shared: one implementation at its semantic owner |
| Phase 10 gate in `bin/check` | `tooling` (via `bin/`) | Shared: repo-level verification command |
| P10-04 exercise seeds + transcripts | `docs/refactor/execution/` (temporary campaign evidence) | Shared campaign evidence, deleted with `docs/refactor/` after final PASS |
| Durable-doc routing fixes (only if exercises expose a gap) | `docs/` | Shared; only touched when an exercise proves the docs unroutable |

Package admission (only if a package/crate/top-level dir is added): no new package (`tests/` additions live in the existing parity directory; gate lives in existing `bin/check`). Negative six-criteria case as in Phase 08.

## 4. Behavior to preserve
| Behavior | Proving test/scenario/fixture |
|---|---|
| All Phase 00–09 behavior (rendering, editing, save/conflict/recovery, deep links, graph, export UX) | Full proof set re-run at candidate: quick + affected + Rails 346 + system 224 + desktop e2e 89 + client/work-model/renderer/cargo suites |
| Scenario file inventory stays machine-checked | Phase-0 gate untouched; Phase-10 gate asserts the live 16-file inventory + wiring |
| Typing never drops input; perf locked | Native benchmark `inputPreservedRuns == samples`; no budget/baseline/threshold file touched (diff gate) |

Intended behavior changes (only those named by the phase contract):
- None. The phase contract names proof work only. The P10-05 change is behavior-preserving by construction (test/refactor/clarity edit inside `client`); any accidental behavior delta fails DO and is reverted.

## 5. Work breakdown
Ordered steps; structural moves and behavior changes in separate commits:
1. DO-1 (new, tested): write `tests/host-differences.md` from the `HostCapabilities` keys + fake/rails/desktop policies; every entry has capability key(s), concrete reason, supported-side proof, disabled-side assertion location.
2. DO-2 (new, tested): add `test/e2e/scenarios/export.js` (web-run branch + desktop-disabled branch), wire into `web.spec.js` + `desktop.spec.js`, run both.
3. DO-3 (new, tested): add the remaining explicit capability-disabled assertions per the DO-1 matrix; run both runners.
4. DO-4 (prove): P10-01 coverage map (area → modules → both-runner execution evidence); close any gap found with scenario/suite additions (same commit discipline).
5. DO-5 (behavior-preserving change + measure): land the representative 5-line client change; record warm `quick` + `affected` wall-clock with no host E2E in the loop.
6. DO-6 (prove): seed the 3 P10-04 exercises; run each against a fresh subagent with wall-clock timing; commit transcripts + verdicts. Usable-routing fixes (if any) land here as durable-doc edits with their own quick/affected proof.
7. DO-7 (prove): P10-06 server-free procedure (assert zero Rails/Tauri listeners → run client suite + fake conformance); record evidence.
8. DO-8 (tooling): implement the Phase 10 gate in `bin/check`; full proof map (§8); freeze candidate.

## 6. Deletions and temporary compatibility
| Item | Owner | Reason | Deletion condition |
|---|---|---|---|
| (none expected) | — | Proof phase; no product surface moves | — |
| P10-04 exercise seeds + transcripts | Campaign | Temporary phase evidence | Deleted with `docs/refactor/` after final technical PASS (Phase 12) |

## 7. Risks and rollback triggers
| Risk | Trigger | Response |
|---|---|---|
| Export scenario cannot run shared code on web | Web branch fails against Rails adapter | Narrow the web branch to the client `features/export` unit seam + host-controller path already covered by `pptx_export` tests; desktop-disabled branch stays |
| Capability assertion breaks a runner | Either spec file fails in DO-2/DO-3 | Revert per-assertion; matrix entry keeps its reason, assertion relands fixed |
| Fresh-agent exercise exceeds 5 min or misroutes | Any P10-04 run fails | Fix durable docs first (the exercise measures the docs, not the agent); reseed an equivalent unseen exercise; original attempt retained as evidence |
| 5-line change accidentally changes behavior | Any suite delta in DO-5 | Revert and pick a different representative edit |
| /tmp pressure crashes browser suites (512M tmpfs) | Selenium tab-crash / ENOSPC | Clear `/tmp/elef-client-tests-*` + rerun; serialize browser groups (proven Phase-08 procedure) |
| OOM/resource kill under parallel load | Exit 137 / `Killed` / tab-crash under pressure | Reduce concurrency, isolate, rerun before classification (constitution §6); record both runs |

Rollback reference: `phase_base_sha` `7556161a411bb211063b7a362814c43fd79f7926`.

## 8. Proof map
| Criterion / invariant | Proof (command, test, CI job, reviewer checklist) | Tier | Environment needs |
|---|---|---|---|
| P10-01 shared scenario coverage | Coverage map (16 modules × 12 areas) + both runners green (`npm test --prefix desktop/e2e` incl. web + desktop specs) + gate inventory/wiring assertions | affected + gate + reviewer | headless Chromium + Tauri runner |
| P10-02 both-adapter execution | Execution matrix: every scenario runs on both runners where capable; every disabled limb has an explicit assertion (reviewer: matrix rows × spec line refs); conformance suite green on fake + rails + desktop | affected + gate + reviewer | as above + tier-booted Rails |
| P10-03 host-differences inventory | `tests/host-differences.md` exists; every entry has capability key + concrete reason + both-side proof refs; reviewer audits zero "can be different" justifications (finite checklist = the file) | reviewer + gate shape check | — |
| P10-04 change-routing exercises | 3 committed transcripts, each ≤300 s wall-clock fresh-subagent, correct owner + proof commands (reviewer: timestamps + answer correctness) | reviewer | subagent mechanism |
| P10-05 edit-loop ceilings | Committed 5-line client diff + warm `quick` + `affected` timings both under hard ceilings with no host E2E in the loop (reviewer: diff size + timing evidence) | quick + affected | warm caches |
| P10-06 fake-host contract suite | Server-free procedure evidence (zero-listener assertion + green client suite + 12/12 fake conformance) + gate enforcement | quick + gate | — |
| I01/I16/I17 boundaries | `bin/check arch` green; no allowlist growth (diff) | quick | — |
| I09 docs/state reality | Durable docs describe the tree at candidate (reviewer); status validates | reviewer | — |
| I10 perf locked | No budget/baseline/threshold file touched (diff gate); native benchmark rerun `inputPreservedRuns == samples`, miss profile within baseline | benchmark | Tauri runner |
| I14 no weakening | Zero test/baseline/threshold weakening (diff audit; scenario additions only) | reviewer | — |
| I15 `all` twice clean | N.A. — Phase 12 requirement per §7 schedule; stubs verified nonzero | quick (stubs) | — |
| I18 routing | P10-04 exercises are the dedicated timed proof | reviewer | subagent mechanism |

Fixed fixture sets / finite reviewer checklists required by the contract:
- P10-03: the inventory file itself is the finite checklist (every entry audited).
- P10-04: the 3 committed exercise transcripts + timing records.
- P10-01/P10-02: the coverage/execution matrix with spec line references.

Human gates touched (constitution §8): none — no signing/updater/owner-acceptance/deploy/soak step is triggered by this phase.

## 9. Re-plan log
<!-- Append dated entries: defect found, what changed, new hash. Never rewrite earlier sections silently. -->
