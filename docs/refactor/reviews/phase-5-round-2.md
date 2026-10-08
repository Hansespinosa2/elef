# Phase 5 review — round 2

Review context: fresh-context read-only child session 01a11de8-8900-7143-a030-9236a785f8fb, role phase-5-round-2-reviewer
Candidate: 20f9e6e68da778a614570c369c48ae7b8ee77c74
Base: 0f62a074ee5783cc6510801be2e39074264bc4ab
Gate attempt: `1eb1345b615841bbb9d7514642c4a797` (`bin/check phase 5 --json`, exit 0)
CI run: `37858163598` (attempt 1, `success`; PR `feat/refactor-desktop-and-web` → `dev`)
Round-1 finding under retest: `P05R1-RESIDUAL-VIM-UI`

## Phase criteria

| Criterion | PASS/FAIL/BLOCKED | exact evidence | finding (stable ID) | required fix |
|---|---|---|---|---|
| P05-01 | PASS | Round-1 residual fully removed: `app/javascript/controllers/vim_settings_controller.js`, `app/javascript/lib/vim_settings_view.js`, `test/javascript/shared/vim_settings_view.test.js` all absent (`ls` → No such file); vim pin gone from `config/importmap.rb` (only vendor `codemirror-vim` + editor-coupled `lib/vim_line_numbers` remain); `app/javascript/lib/editor_runtime.js` has zero vim import/registration; `test/javascript/shared/desktop_host.test.js:50` asserts `doesNotMatch(editorRuntime, /vim_settings_controller/)` and `:60` asserts no `data-controller="vim-settings"` in served markup; repo-wide erb grep finds no Stimulus vim mount (only a settings-nav anchor link and the client-owned `#vim-settings-mount` divs, now filled by `mountVimSettings` from `@elef/client` per `app/javascript/lib/file_library_application.js:14,158-168`). No other dual-owner remnants: authoring dialog/server form/`authoring_settings*`/`authoring_registry_write`/Rails-transport-`lib/` copy all absent; Rails transport lives only at `app/javascript/host/rails-authoring-settings-transport.js`; Tauri seam only at `desktop/frontend/src/tauri-authoring-transport.js`; settings UI only under `packages/client/src/features/settings/` (6 files). Built-in registry data is a single copy (`find` → only `app/javascript/data/default_authoring_registry.json`; client receives built-ins at runtime through the transport seam, no second copy). | `P05R1-RESIDUAL-VIM-UI` closed; note `P05R2-NOTE-BUILTIN-RETENTION` (plan §2 move line stale, single-source fact holds; rationale in live `status.json` `next_action`) | — |
| P05-02 | PASS | Conformance `settings.round-trip` byte-identical to plan baseline (`tests/host-conformance/suite.js:226-236`: get → update `{theme:"light"}` → reread → restore). Stored CI on exact candidate: rails leg `conformance rails: 11 passed, 1 skipped, 0 failed` in `system-test` job `113587694653`; tauri `specs/contract-conformance.spec.js` PASSED in `desktop` job `113587694666` and `desktop-macos` job `113587694802`; fake leg green inside stored gate quick tier (exit 0). Invalid-input rejection implemented (`workspace_settings_controller.rb:24-29`, 422 JSON / redirect) and controller-covered. Adapters untouched by the round-2 delta. | none | — |
| P05-03 | PASS | `showUpdater = host.capabilities.updater && options.updater !== undefined` (`SettingsApp.tsx:75`, rendered at `:138`); reviewer grep over `packages/client/src/{features/settings,application}` finds zero `__TAURI__`/`hostName`/`ActiveRecord` and zero `tauri`/`rails` tokens; e2e matrix shows Updates affordance on desktop and count 0 on web (plan checklist). | none | — |
| P05-04 | PASS | Reviewer `find` (excl. node_modules/dist/tmp): exactly one prod `*settings*.css` (`app/assets/stylesheets/components/settings.css`) plus the deliberate canary (`tooling/canary/.../settings-duplicate.css`). Rerun green locally: `python3 tooling/check_boundaries.py` exit 0 (`settings styles single-owned`), `--self-test` exit 0 (`canary rejected as required`, R11 listed). Desktop-host-stylesheet / class-resolution assertions gate-proven (see Not verified). | none | — |
| P05-05 | PASS | Shared `test/e2e/scenarios/authoring-settings.js` imported by both `desktop/e2e/specs/desktop.spec.js:14` and `desktop/e2e/specs/web.spec.js:10`; stored CI marks `shared_scenarios: success` on both `desktop` and `desktop-macos` jobs (all three previously failing authoring specs pass in both binaries); `/settings` renders the client shell (`shared/settings_page.html.erb` + `_client_settings_mount.html.erb`, no settings UI in markup); client fake-host unit/integration green via stored gate quick tier (exit 0); `dist/` is the same 3-file set (no deferred chunk). | none | — |

## Permanent invariants

| Invariant | PASS/FAIL/BLOCKED/N.A. | exact evidence or N.A. reason | finding (stable ID) | required fix |
|---|---|---|---|---|
| I01 | PASS | Rerun `python3 tooling/check_boundaries.py` exit 0; `--self-test` exit 0 with R11 rejecting the canary. Added-lines grep over `diff.patch`: zero new allowlist/skip/deselect lines in source (only round-1 prose mentions inside the committed review doc). | none | — |
| I02 | PASS | The round-1 second vim-settings UI is deleted (see P05-01); no duplicate platform-neutral settings implementation remains in-tree. Retained `controllers/vim_preferences.js`, `lib/vim_line_numbers.js`, `controllers/authoring_registry.js`, `lib/authoring_registry_merge.js` are editor-coupled (phases 08/09), not settings UI — same keep set round-1 prescribed. | `P05R1-RESIDUAL-VIM-UI` closed | — |
| I03 | PASS | Diff touches no `packages/work-model` file; per-document appearance stays on `@elef/work-model` per plan non-goals. | none | — |
| I04 | PASS | Diff touches no `packages/renderer` file; dialog previews render through `SafeHtml`. | none | — |
| I05 | PASS | Zero host-name tokens in client settings/application sources (reviewer grep, this round). | none | — |
| I06 | PASS | No `crates/` or persistence-path changes; CI `test`, `system-test`, `sqlite-test`, `affected` jobs success on the exact-candidate run. | none | — |
| I07 | PASS | No Rails/Ruby dependency added to the desktop path; `desktop` + `desktop-macos` CI jobs success; updater endpoint config untouched. | none | — |
| I08 | PASS | Canonical `dist/` rebuilt once and committed (same 3-file set, settings in main bundle); freshness enforced by `run_fresh` inside the stored exit-0 gate; retired server markup asserted unpackaged. | none | — |
| I09 | PASS | `docs/architecture.md` settings rows present; live `status.json` accurately CHECK/round-2 at the candidate with the round-1→2 history (`5a87def`, `c3b765f`, `19196b2`, `e4d0d76`, `20f9e6e`) and an explicit `next_action` recording the built-in-retention rationale. Note: frozen plan §2 still names the built-in move that was deliberately not executed; the rationale lives in `status.json`, not the §9 re-plan log (bytes restored to keep the frozen hash). Stale-scope wording, not a factual misstatement of the shipped code. | `P05R2-NOTE-BUILTIN-RETENTION` (info) | Optional: log the retention line in the §9 re-plan log of a future re-freeze; not required for PASS. |
| I10 | PASS | Warm ceilings: stored exact-candidate `affected` job success; phase gate 31.687 s. Exact-candidate `native-performance-linux`/`darwin` artifacts listed in stored evidence; `dist/` chunk set unchanged. Limitation: probe-median arithmetic not re-performed (artifact zips need auth; see Not verified) — same standing as round-1. | none | — |
| I11 | PASS | `SafeHtml` remains the sole raw-HTML boundary for the new UI; sanitizer unit test + hostile/markdown-identical shared scenario coverage unchanged by the round-2 delta. | none | — |
| I12 | PASS | Settings is a module inside its semantic owner (`packages/client/src/features/settings/`); no new `shared/`/`common/`/`core/`/`utils/` boundary directory. | none | — |
| I13 | PASS | Plan §6 names owner/reason/deletion for every removal and the round-2 delta executes exactly those rows (commit `c3b765f`: 6 files, 3 insertions, 153 deletions — precisely the prescribed fix). Updater seam documented permanent. | none | — |
| I14 | PASS | No baseline/threshold/allowlist change in source; deleted JS tests correspond 1:1 to deleted implementations and are replaced by client unit tests plus extended shared scenarios per plan §8 (explicitly permitted). | none | — |
| I15 | N.A. | Two clean identical `all` runs are a Phase 12 completion requirement per §7 rollout; `all|docs|perf` stub discipline enforced inside the stored gate. | none | — |
| I16 | PASS | No new package/crate/top-level directory (only files under existing owners plus the `tooling/canary` negative fixture). | none | — |
| I17 | PASS | R10 isolation/acyclic rule green in the rerun (`--self-test` lists R10 among enforced); settings modules import via router/index seams. | none | — |
| I18 | PASS | Ownership/proof routing intact (`docs/architecture.md` client/settings rows; mount-seam routing documented). | none | — |

## Human gates

All five constitution §8 gate classes explicitly pending, with zero phase impact: (1) signing/updater keys and backups — updater endpoint/pubkey untouched; (2) owner-Mac first-install acceptance — not exercised; (3) owner-Linux/Omarchy acceptance — not exercised; (4) live Mac mini web deployment — untouched; (5) real-use soak and residual-risk acceptance — none claimed. No technical result above pretends human acceptance occurred.

## Verified

- Worktree HEAD `20f9e6e68da778a614570c369c48ae7b8ee77c74` confirmed (`git rev-parse`); base `0f62a07` is an ancestor (`merge-base --is-ancestor` OK); tree clean before and after (`git status --porcelain` empty; reviewer ran read-only commands only, no edits/commits/pushes).
- Immutable gate snapshot: `head_sha` equals candidate HEAD; `phase_base_sha`/`current_phase` 5/`phase_contract_sha256` `94bb77f5`/`frozen_plan_sha256` `7476c2d4` all match reviewed state. Stored attempt `1eb1345b`: exit 0, stdout `{"phase":5,"result":"PASS","head":"20f9e6e6..."} plus exactly `ELEF_PHASE_5=PASS`.
- Frozen plan/contract identity: `sha256sum` of bundled `PLAN.md` = `7476c2d4…67751` and `PHASE.md` = `94bb77f5…40fd19e`, both equal the status/snapshot hashes and the worktree `phase-5-plan.md` / `phases/05-settings.md` bytes.
- Locally rerun, exit 0 (serialized): `python3 tooling/check_boundaries.py` (`settings styles single-owned`) and `--self-test` (`canary rejected as required`, R9/R10/R11 enforced).
- Round-1 fix fidelity: commit `c3b765f` touches exactly the 6 prescribed files; residual-absence proven by `ls`, importmap, `editor_runtime`, erb, and test-assertion greps above.
- Stored CI evidence for the exact candidate: run `37858163598` (attempt 1, `https://github.com/Hansespinosa2/elef/actions/runs/37858163598`), tested merge parents `3ce290e5` (dev) + `20f9e6e` (candidate); 13 jobs success (`desktop-fast`, `test`, `system-test`, `affected`, `sqlite-test`, `desktop`, `desktop-macos`, `renderer-macos`, `scan_js`, `scan_ruby`, `production-smoke`, `development-smoke`, `record-ci-attestation`) plus `Authorize deployment after CI` skipped by design; rails conformance command/result, tauri conformance per-job results, shared-scenario success notes, and perf/attestation artifact IDs recorded in `evidence/phase-5-ci-evidence.json`.
- No criteria conflicts found; no weakened evidence admitted (test deletions are plan-§8-permitted replacements).

## Not verified

- Node-dependent checks in this read-only worktree: tsc/JS/client/desktop-unit tests, `check_architecture.py`, `check_frontend_ownership.py` — `node_modules` absent so they fail only on the missing environment prerequisite (observed: `FileNotFoundError: .../desktop/frontend/node_modules/...`); tree left clean, nothing installed. All are proven green for the exact candidate by the stored gate (exit 0, which embeds the quick/arch tiers) and the CI jobs above.
- Live CI re-verification: unauthenticated GitHub API returns 404 for this repo (`curl` check); no credentials invented or used. Stored evidence stands as the record.
- Perf median-vs-baseline arithmetic not re-performed (artifact zips need auth) — same standing as round-1; no regression signal (chunk set unchanged, `affected` green).
- A full-gate rerun inside this review worktree was not attempted beyond the evidence: the immutable snapshot binds to its DO-time isolated checkout, so a rerun here would be correctly rejected rather than prove anything new (round-1 established this behavior).

Result: PASS
