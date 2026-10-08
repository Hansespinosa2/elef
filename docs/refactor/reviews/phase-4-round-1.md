# Phase 4 review — round 1
Candidate: ddbc69599fb9caf9d8ca82d79a7acf35494a3e50
Base: 2bdfa86d6c6651b692a9c3bf11988309d52b27be
Review context: independent subagent session 01a11b3c (phase-4-round-1 reviewer), read-only worktree audit

## Identity and gate verification

- Worktree HEAD: `ddbc69599fb9caf9d8ca82d79a7acf35494a3e50` (`git rev-parse HEAD`), equals candidate.
- Base ancestry: `2bdfa86d...` is an ancestor of HEAD (`git merge-base --is-ancestor` → ok).
- Frozen plan identity: sha256 of bundled `PLAN.md` = sha256 of worktree `docs/refactor/execution/phase-4-plan.md` = `c3ed1d50...07828f` (matches `frozen_plan_sha256` in bundle status and gate snapshot).
- Contract identity: sha256 of worktree `docs/refactor/phases/04-client-library.md` = `1c172f31...fee0a0fd55` (matches plan header and snapshot).
- Immutable gate snapshot: `evidence/phase-4-gate-attempts/cc637a37.../status.json` sha256 `9b6cdce2...91d62c` matches its `started.json` manifest; manifest phase=4 head=candidate; snapshot head=candidate, base=`2bdfa86d`, phase=4/DO, contract/plan hashes match. Stored gate stdout: `{"phase":4,"result":"PASS","head":"ddbc6959..."}`, `ELEF_PHASE_4=PASS`, exit 0.
- Snapshot replay caveat (OBS-03): `bin/check phase 4 --json` with `ELEF_GATE_STATUS_PATH` set to the bundled snapshot correctly refuses in this worktree (`gate manifest does not own this checkout`, exit 1), because the manifest binds to its original gate checkout path. Identity above was verified manually instead, and every technical gate step was rerun directly in the review worktree (see Verified section).

## Phase criteria
| Criterion | PASS/FAIL/BLOCKED | exact evidence | finding (stable ID) | required fix |
|---|---|---|---|---|
| P04-01 | PASS | `git ls-files 'app/views/library/*'` → only `shell.html.erb`; `library_search*`, `lib/library_*`, `tests/host-conformance/shell.js` gone; no `renderLibraryView\|createLibraryCard\|filterLibraryCards` hits in `app/ desktop/ packages/`; `file_library_application.js:16,1093` mounts `@elef/client` | — | — |
| P04-02 | PASS | `packages/client/src/index.ts:1` + `shell.tsx:11` define `mountElef`; web `app/javascript/controllers/client_shell_controller.js:2,49`, desktop `file_library_application.js:1093`, client tests `test/helpers.tsx:36` all call it; `packages/client/dist/elef-client.js` (853877 B) contains `mountElef` | — | — |
| P04-03 | PASS | `test/e2e/scenarios/library-deep-links.js` (new) + `library-create-delete.js` + `library-and-graph.js` imported and invoked in both `desktop/e2e/specs/web.spec.js:918,922,926` and `desktop.spec.js:1900` (+2 DesktopLibraryUi create-delete/deep-link calls); client unit verbs green locally (`npm test --prefix packages/client`: 21 pass — tabs/search/create/rename/delete/batch/empty/host-extras); CI exact-candidate: rails conformance 11 passed 1 skipped (dialog-mediated skip is suite policy), tauri `contract-conformance.spec.js` PASSED in `desktop` (113272484776) and `desktop-macos` (113272485016) | — | — |
| P04-04 | PASS | `test/system/client_library_test.rb:3-28` visits `/`, `/documents`, `/presentations` → `[data-elef-shell]` with per-filter cards/tabs; `application/router` unit tests (`router resolves the three library deep links`, full-URL/trailing-slash tolerance, non-library rejection) pass locally; CI `system-test` job 113272526909: 224 runs, 0 failures | — | — |
| P04-05 | PASS | New boundary R9 (`tooling/check_boundaries.py:184-220`) green locally; grep of `packages/client/src/` for `userAgent\|isTauri\|__TAURI__\|MiniRacer\|ActiveRecord\|hostName` → only `media.hostname` URL comparison in `sanitize.ts:162`; capability branch (`capabilities.updater`) is allowed, no host-name/plan branching | — | — |
| P04-06 | PASS | New boundary R10 (`tooling/check_boundaries.py:234-276`) green; `--self-test` canary rejects R10 (and R9) as required; no cross-`features/` imports (client imports no `work-model`; `grep work-model packages/client/src/` empty) | — | — |
| P04-07 | FAIL | Exact-candidate CI artifacts (hashes match bundle evidence): `native-performance-linux.json` (sha256 `7fa34867…`, release `6.17.0-1022-azure` x64) and `native-performance-darwin.json` (sha256 `4c5b8351…`, release `24.6.0` arm64) — same runners/protocol as locked `baseline.json`. Medians (n=20, tight distributions, not outliers): linux coldStart 1102.5 vs 879.0 (**+25.4%**), linux open100Slides 1646.0 vs 1277.0 (**+28.9%**), linux warmLibrary p95 601 vs budget 500 (**new ceiling crossing**; baseline p95 455, misses were `[open100Slides]` only, now `[open100Slides, warmLibrary]`), darwin warmLibrary 248.5 vs 140.5 (**+76.9%**). Policy requires ≤10% and no new ceiling cross | P4R1-PERF-01 | Apply plan §7 rollback-trigger response: shrink/defer client-bundle cost (code-split, defer non-library code), re-run the 20-process benchmark comparison via CI artifacts on both platforms, confirm ≤10% on every probe and no new ceiling crossing, then re-review |

## Permanent invariants
| Invariant | PASS/FAIL/BLOCKED/N.A. | exact evidence or N.A. reason | finding (stable ID) | required fix |
|---|---|---|---|---|
| I01 | PASS | `tooling/check_boundaries.py` + `--self-test` green; `desktop/scripts/check_architecture.py` green (after required `desktop/frontend` build); R9/R10 are additive rules for the new package, no existing allowlist grew | — | — |
| I02 | PASS | Old library implementations deleted (see P04-01); sanitizer has one owner (`packages/client/src/ui/sanitize.ts` → `dist/sanitize.js`), app-side `preview_sanitizer.js:1-5` is a documented temporary re-export (owner: editor Ph08/settings Ph05, deletion condition stated); old-harness hostile matrix (333 JS tests incl. full corpus) executes against the client dist via that re-export | — | — |
| I03 | PASS | `git diff base..HEAD --stat -- packages/work-model crates spec` → no changes (only `contracts/session.ts` +8 optional fields, canary fixtures) | — | — |
| I04 | PASS | `packages/renderer` source untouched; `npm run renderer:build` + `git diff --exit-code vendor/javascript/elef-renderer.bundle.js` → fresh; renderer boundary rules green | — | — |
| I05 | PASS | Same evidence as P04-05 | — | — |
| I06 | PASS | CI exact-candidate: `test` 346 runs 0 failures, `sqlite-test` 346 runs 0 failures, `system-test` 224 runs 0 failures, `cargo test -p local-store` rerun locally: 73 passed 0 failed | — | — |
| I07 | PASS | CI `desktop`/`desktop-macos` jobs green (include `desktop.spec.js` offline flows); desktop closure arch check green; no Rails in desktop closure | — | — |
| I08 | PASS | `npm run build --prefix packages/client` + `git diff --exit-code -- packages/client/dist/` → no diff; `config/importmap.rb` pins canonical `client/dist/elef-client.js` + `client/dist/sanitize.js`; no committed host copies | — | — |
| I09 | PASS | Arch doc client row added (`docs/architecture.md` diff, incl. R9 reference); bundle `status.json` CHECK state factual; OBS-02: `sanitize.ts:1-5` comment cites non-existent `sanitize-parity.test.ts` (parity is actually via shared cases → dist re-export, green) — stale filename only | OBS-P4R1-02 (nit) | Correct the comment to name the shared-cases path |
| I10 | FAIL | Same measurements as P04-07: ≤10%-of-median rule breached on three probes; linux coldStart p95 1445 vs 1500 budget leaves 3.7% headroom. Warm `affected` ceiling holds (CI `affected` job 53.1s vs 420s ceiling) | P4R1-PERF-01 | Same as P04-07 |
| I11 | PASS | `SafeHtml.tsx:10-22` is the sole raw-HTML insertion boundary (ref+sanitize effect, never `dangerouslySetInnerHTML`); only other `innerHTML` is inside the sanitizer template element (`sanitize.ts:39`); hostile vectors (script, `javascript:`, remote media, event handlers, malformed) green in shared corpus + client unit test + `hostile-deck` e2e scenario | — | — |
| I12 | PASS | New dirs are `packages/client/{application,features/library,ui}`, `tooling/canary`, `test/architecture` — no `shared/`, `common/`, `core/`, `utils/` dumping ground at boundaries | — | — |
| I13 | PASS | Temp re-export documents owner/reason/deletion (`preview_sanitizer.js:1-5`); host-seam temporaries governed by frozen plan §6 table + §9 log; no undocumented compat shims found in client/host sources | — | — |
| I14 | PASS | Deleted tests map 1:1 to deleted code (`library_card/filter/preview/view`, `incremental_list`, `library_card` producers + their ruby tests); renderer corpus intact; scenarios extended not replaced; new stylesheet contract test added (`test/architecture/*`); OBS-01: `contracts/session.ts` adds optional `updatedAt?`/`warnings?` with all-three-adapter conformance — additive, not a new port operation, but unnamed in the frozen plan | OBS-P4R1-01 (note) | Name the additive contract fields in the re-plan log or revert them |
| I15 | N.A. | Two clean identical `all` runs are a Phase 12 completion requirement per constitution §7 rollout; phase-4 requirement (stubs fail nonzero) verified: `bin/check all|docs|perf` each exit 2 | — | — |
| I16 | PASS | `packages/client`: one responsibility (host-neutral app), one entry (`mountElef`), acyclic direction (R9/R10 enforced), independent tests (21 unit + both-host scenarios), payoff (deletes 1223-line desktop boot + ERB/Stimulus), hides React/router/state; driver = 3 consumers (Rails, Tauri, fake hosts); one-sentence justification in `package.json` description | — | — |
| I17 | PASS | R10 isolation/acyclic rule green + canary enforcement; `ui/` imports neither `features/` nor `application/` | — | — |
| I18 | PASS | `docs/architecture.md` client row + mount/adapter routing paragraph added; ownership/proof routing present (boundary R9 cited in docs) | — | — |

## Human gates
All five constitution §8 gate classes remain explicitly pending and untouched by this phase (no signing/updater-key, owner-Mac, owner-Linux/Omarchy, Mac-mini-deployment, or soak/acceptance impact; frozen plan §8 confirms none touched). No human acceptance is claimed. Owner merge is not a phase gate.

## Verified / not verified

Local reruns in review worktree (all read-only; only ignored `node_modules`/`dist` build outputs written, worktree `git status` clean, tracked diffs unchanged):
- `npm ci --prefer-offline` (root, `desktop/frontend`, `desktop/e2e`) — ok
- `npm run build --prefix packages/client` + `git diff --exit-code -- packages/client/dist/` — fresh, no diff
- `./node_modules/.bin/tsc --noEmit -p packages/client/tsconfig.test.json` — exit 0
- `npm test --prefix packages/client` — 21 pass, 0 fail
- `node --test tests/host-conformance/conformance-fake.test.js` — 12 pass, 0 fail
- `python3 tooling/check_boundaries.py` + `--self-test` (canary rejects R1,R10,R2,R4,R6,R7,R8,R9) + `script/check_frontend_ownership.py` — pass
- `npm run test:javascript` — 333 pass, 0 fail; `npm test --prefix packages/work-model` / `packages/renderer` — 0 fail; `tsc -p packages/contracts/tsconfig.test.json` — exit 0
- `npm test --prefix desktop/frontend` — 38 pass; `npm run build --prefix desktop/frontend` then `python3 desktop/scripts/check_architecture.py` — pass (32 commands)
- `npm run test:unit --prefix desktop/e2e` — 7 pass; `cargo test -p local-store --locked` — 73 pass
- `npm run renderer:build` + renderer bundle diff — fresh; `bin/check all|docs|perf` — each exit 2 (stubs intact)
- Gate snapshot/identity checks as listed above; full `bin/check phase 4` replay refused by checkout-bound manifest (by design), technical steps rerun individually instead
- Perf: artifacts downloaded via `gh api .../artifacts/{11546880319,11544767671}/zip` (run 37764313771); extracted JSON sha256 match bundle evidence (`7fa34867…`, `4c5b8351…`); medians computed over n=20 samples per probe

Exact-candidate CI evidence (bundle `phase-4-ci-evidence.json`, corroborated: run URL `https://github.com/Hansespinosa2/elef/actions/runs/37764313771` attempt 2, tested merge `6384df85` parents `[26d6ad24(dev), ddbc69599(candidate)]`, PR #136 → `dev`; page title confirms `elef@ddbc695`, detail rows login-walled so job-level reliance rests on the attested evidence file + downloaded artifacts): `desktop-fast`, `test` (346 runs 0 fail), `system-test` (224 runs 0 fail; rails conformance 11 passed 1 skipped), `affected` (PASS 53.1s), `sqlite-test`, `desktop`, `desktop-macos`, `renderer-macos`, `production-smoke`, `development-smoke`, `record-ci-attestation` all success; `scan_js`/`scan_ruby` success.
- Not verified locally (no suitable local runner; covered by the above exact-candidate CI evidence): Rails system tests, browser e2e (web + Tauri webview), native release benchmark execution itself (artifacts analyzed, not re-executed — release Tauri build exceeds this review's means; local Tauri prerequisites not provisioned).
- Attribution caveat: the benchmark ran on the dev+candidate merge, so dev-tip drift cannot be fully excluded as a contributor; the candidate tree itself exhibits the regression vs the locked baseline either way, and the plan's rollback trigger does not condition on attribution.

Result: FAIL
