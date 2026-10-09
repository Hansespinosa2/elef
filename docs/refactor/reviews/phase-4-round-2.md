# Phase 4 review — round 2
Candidate: df7580eedbb1effc4850805d02266aba09b3ac94
Base: 2bdfa86d6c6651b692a9c3bf11988309d52b27be
Review context: independent subagent session 01a11bee (phase-4-round-2 reviewer), read-only worktree audit

## Identity and gate verification

- Worktree HEAD: `df7580eedbb1effc4850805d02266aba09b3ac94` (`git rev-parse HEAD`), equals candidate.
- Base ancestry: `2bdfa86d...` is an ancestor of HEAD (`git merge-base --is-ancestor` → ok).
- Frozen plan identity: sha256 of bundled `PLAN.md` = sha256 of worktree `docs/refactor/execution/phase-4-plan.md` = `e197cf4e...43cd5b88` (matches `frozen_plan_sha256` in bundle status and gate snapshot).
- Contract identity: sha256 of worktree `docs/refactor/phases/04-client-library.md` = `1c172f31...fee0a0fd55` (matches plan header and snapshot).
- Immutable gate snapshot: `evidence/phase-4-gate-attempts/59626213.../status.json` sha256 `2c6d132b...961d08231`; snapshot head=candidate, base=`2bdfa86d`, phase=4/DO, contract/plan hashes match. Stored gate stdout: `{"phase":4,"result":"PASS","head":"df7580ed..."}`, `ELEF_PHASE_4=PASS`, exit 0 (stdout sha `234b25fc...` matches manifest).
- Snapshot replay caveat (recurs from round 1, OBS-P4R1-03): `bin/check phase 4` refuses in this worktree by design (manifest checkout binding + worktree status is CHECK-state, not the DO snapshot). Identity above was verified manually; every technical gate step was rerun directly in the review worktree (see Verified section).
- Evidence-placement note: the candidate tree's committed `docs/refactor/execution/phase-4-ci-evidence.json` still names the round-1 candidate (fresh round-2 evidence was recorded in CHECK commit `7bf0f8a` on top, same protocol shape as round 1). The selected gate PASS consumed the round-2 evidence externally; this is inherent to post-CI evidence recording, not a candidate defect. Two earlier gate attempts at this candidate failed on checkout preparation only (missing `desktop/frontend/dist` build; missing `node_modules`), superseded by the clean PASS attempt `59626213`.

## Phase criteria
| Criterion | PASS/FAIL/BLOCKED | exact evidence | finding (stable ID) | required fix |
|---|---|---|---|---|
| P04-01 | PASS | `git ls-files 'app/views/library/*'` → only `shell.html.erb`; `library_search*`, `lib/library_*`, `tests/host-conformance/shell.js` gone; zero `renderLibraryView\|createLibraryCard\|filterLibraryCards` hits in `app/ desktop/ packages/` | — | — |
| P04-02 | PASS | `packages/client/src/index.ts:1` + `shell.tsx` define `mountElef`; web `app/javascript/controllers/client_shell_controller.js:2,49`, desktop `app/javascript/lib/file_library_application.js:1097`, client tests `test/helpers.tsx:36` all call it; `packages/client/dist/elef-client.js` contains `mountElef` | — | — |
| P04-03 | PASS | `test/e2e/scenarios/library-deep-links.js` + `library-create-delete.js` + `library-and-graph.js` imported by both `desktop/e2e/specs/web.spec.js:4-6` and `desktop.spec.js:8-10`; client unit verbs green locally (`npm test --prefix packages/client`: 27 pass, 0 fail); CI exact-candidate run 37788950740: rails conformance 11 passed 1 skipped (suite policy skip), tauri `contract-conformance.spec.js` PASSED in `desktop` (113350881498) and `desktop-macos` (113350881535) | — | — |
| P04-04 | PASS | `test/system/client_library_test.rb:4-25` visits `/`, `/documents`, `/presentations` → `[data-elef-shell]` with per-filter cards/tabs (exactly the plan §8 deep-link set); router unit tests pass in client suite; CI `system-test` job 113350881368: 224 runs, 0 failures | — | — |
| P04-05 | PASS | Boundary R9 (`tooling/check_boundaries.py`) green locally; grep of `packages/client/src/` for `userAgent\|isTauri\|__TAURI__\|MiniRacer\|ActiveRecord\|hostName` → zero hits; only capability branching (allowed) | — | — |
| P04-06 | PASS | Boundary R10 green; `--self-test` canary rejects R9/R10 as required; zero cross-`features/` imports; `ui/` imports neither `features/` nor `application/` | — | — |
| P04-07 | FAIL | Exact-candidate CI artifacts (sha256 match bundle evidence, same runners/protocol as locked `baseline.json`, n=20 each, tight non-outlier distributions): linux coldStart median 1017.0 vs 879.0 (**+15.7%**, zero distribution overlap — 0/20 cand samples below base median), linux open100Slides 1534.5 vs 1277.0 (**+20.2%**, zero overlap), darwin coldStart 2509.5 vs 2259.5 (**+11.1%**). Policy requires ≤10% on every probe. No new ceiling crossing (miss sets identical to baseline). Round-2 ACT improved warmLibrary to -54.5% linux / +1.1% darwin but did not reach the policy line | P4R1-PERF-01 (recurs from round 1) | Continue plan §7 rollback-trigger response: further shrink/defer client-bundle cost on the cold/open paths, re-run the 20-process benchmark comparison via CI artifacts on both platforms, confirm ≤10% on every probe and no new ceiling crossing, then re-review |

## Permanent invariants
| Invariant | PASS/FAIL/BLOCKED/N.A. | exact evidence or N.A. reason | finding (stable ID) | required fix |
|---|---|---|---|---|
| I01 | PASS | `tooling/check_boundaries.py` + `--self-test` green (canary rejects R1,R10,R2,R4,R6,R7,R8,R9); `desktop/scripts/check_architecture.py` green after `desktop/frontend` build (32 commands); R9/R10 additive for the new package, no existing allowlist grew | — | — |
| I02 | PASS | Old library implementations deleted (see P04-01); sanitizer has one owner (`packages/client/src/ui/sanitize.ts` → `dist/sanitize.js`); app-side `preview_sanitizer.js:1-5` is a documented temporary re-export with owner/reason/deletion; shared hostile corpus (335 JS tests) executes against the client dist via that re-export | — | — |
| I03 | PASS | `git diff base..HEAD --stat -- packages/work-model crates spec` → empty; contracts delta round1→round2 is empty (no new ports) | — | — |
| I04 | PASS | `packages/renderer` source untouched; `npm run renderer:build` + `git diff --exit-code vendor/javascript/elef-renderer.bundle.js` → fresh | — | — |
| I05 | PASS | Same evidence as P04-05 | — | — |
| I06 | PASS | CI exact-candidate: `test` 346 runs 0 fail, `sqlite-test` 346 runs 0 fail, `system-test` 224 runs 0 fail; `cargo test -p local-store --locked` rerun locally: 73 passed 0 failed | — | — |
| I07 | PASS | CI `desktop`/`desktop-macos` jobs green (include offline flows); desktop closure arch check green; no Rails in desktop closure | — | — |
| I08 | PASS | `npm run build --prefix packages/client` + `git diff --exit-code -- packages/client/dist/` → no diff; `config/importmap.rb:41-42` pins canonical `client/dist/elef-client.js` + `client/dist/sanitize.js`; no committed host copies | — | — |
| I09 | PASS | Arch doc client row added (`docs/architecture.md:54,71`, incl. R9 reference); bundle `status.json` CHECK state factual. OBS-P4R1-02 fixed: `sanitize.ts:1-8` comment now names the shared-cases corpus path (stale `sanitize-parity.test.ts` filename gone) | — | — |
| I10 | FAIL | Same measurements as P04-07: ≤10%-of-median rule breached on three probes (linux coldStart +15.7%, linux open100Slides +20.2%, darwin coldStart +11.1%). No new ceiling crossing (miss sets unchanged). Warm `affected` ceiling holds (CI `affected` job success) | P4R1-PERF-01 (recurs from round 1) | Same as P04-07 |
| I11 | PASS | `SafeHtml.tsx:10-22` is the sole raw-HTML insertion boundary (never `dangerouslySetInnerHTML`); only other `innerHTML` is inside the sanitizer template element (`sanitize.ts:41`); hostile vectors green in shared corpus + client unit tests | — | — |
| I12 | PASS | No new `shared/`/`common/`/`core/`/`utils/` dumping ground at boundaries (only pre-existing `test/javascript/shared/` paths touched, several deleted) | — | — |
| I13 | PASS | Temp re-export documents owner/reason/deletion (`preview_sanitizer.js:1-5`); host-seam temporaries governed by frozen plan §6 table + §9 log (both re-plan entries present); no undocumented compat shims in client/host sources | — | — |
| I14 | PASS | Deleted tests map 1:1 to deleted code; renderer corpus intact; scenarios extended not replaced; new stylesheet contract test retained. OBS-P4R1-01 closed: `contracts/session.ts:13-20` additive `updatedAt?`/`warnings?` named in frozen plan §9 re-plan log, populated by all three adapters (`fake-host.js:38-39,73,81`, `rails-http-host.js:115-116`, `tauri-host.js:55,59`) with conformance assertions (`suite.js:57-59`); no contract change round1→round2 | — | — |
| I15 | N.A. | Two clean identical `all` runs are a Phase 12 completion requirement per constitution §7 rollout; phase-4 requirement (stubs fail nonzero) verified: `bin/check all|docs|perf` each exit 2 | — | — |
| I16 | PASS | `packages/client`: one responsibility (host-neutral app), one entry (`mountElef`), acyclic direction (R9/R10 enforced), independent tests (27 unit + both-host scenarios), payoff (deletes desktop boot library + ERB/Stimulus), hides React/router/state; driver = 3 consumers (Rails, Tauri, fake hosts); one-sentence justification in `package.json:8` | — | — |
| I17 | PASS | R10 isolation/acyclic rule green + canary enforcement; `ui/` imports neither `features/` nor `application/` | — | — |
| I18 | PASS | `docs/architecture.md` client row + mount/adapter routing paragraph (`:71`) present; ownership/proof routing present (boundary R9 cited in docs) | — | — |

## Human gates
All five constitution §8 gate classes remain explicitly pending and untouched by this phase (no signing/updater-key, owner-Mac, owner-Linux/Omarchy, Mac-mini-deployment, or soak/acceptance impact; frozen plan §8 confirms none touched). No human acceptance is claimed. Owner merge is not a phase gate.

## Verified / not verified

Local reruns in review worktree (all read-only; only ignored `node_modules`/`dist` build outputs written, worktree `git status` clean, tracked diffs unchanged):
- `npm ci` (root, `desktop/frontend`, `desktop/e2e`) — ok (note: a first `npm ci --prefer-offline` left a partial tree resolving toolchain via the parent checkout; a full `npm ci` completed it and all results below use the complete local install)
- `npm run build --prefix packages/client` + `git diff --exit-code -- packages/client/dist/` — fresh, no diff
- `./node_modules/.bin/tsc --noEmit -p packages/client/tsconfig.test.json` — exit 0
- `npm test --prefix packages/client` — 27 pass, 0 fail
- `node --test tests/host-conformance/conformance-fake.test.js` — 12 pass, 0 fail
- `python3 tooling/check_boundaries.py` + `--self-test` (canary rejects R1,R10,R2,R4,R6,R7,R8,R9) + `script/check_frontend_ownership.py` — pass
- `npm run test:javascript` — 335 pass, 0 fail; `npm test --prefix packages/work-model` / `packages/renderer` — 0 fail; `tsc -p packages/contracts/tsconfig.test.json` — exit 0
- `npm test --prefix desktop/frontend` — 43 pass; `npm run build --prefix desktop/frontend` then `python3 desktop/scripts/check_architecture.py` — pass (32 commands)
- `npm run test:unit --prefix desktop/e2e` — 7 pass; `cargo test -p local-store --locked` — 73 pass
- `npm run renderer:build` + renderer bundle diff — fresh; `bin/check all|docs|perf` — each exit 2 (stubs intact)
- Gate snapshot/identity checks as listed above; full `bin/check phase 4` replay refused by checkout-bound manifest (by design), technical steps rerun individually instead

Exact-candidate CI evidence (bundle `phase-4-ci-evidence.json`, independently corroborated via `gh api`): run `https://github.com/Hansespinosa2/elef/actions/runs/37788950740` attempt 1, `conclusion: success`, `head_sha: df7580e...` (= candidate), PR #136 → `dev`; jobs API confirms success on `desktop-fast`, `test`, `system-test`, `affected`, `sqlite-test`, `desktop`, `desktop-macos`, `renderer-macos`, `scan_js`, `scan_ruby`, `production-smoke`, `development-smoke`, `record-ci-attestation` (deploy gate skipped as expected); rails conformance 11 passed 1 skipped; tauri conformance PASSED both platforms.
- Perf: artifacts downloaded via `gh api .../artifacts/{11556622261,11555644749}/zip`; extracted JSON sha256 (`5b5de8b4…`, `21b587be…`) and byte sizes (65950/69864) match bundle evidence; medians computed over n=20 samples per probe against locked `baseline.json` on identical runners/protocol (`6.17.0-1022-azure` x64, `24.6.0` arm64).
- Not verified locally (no suitable local runner; covered by the above exact-candidate CI evidence): Rails system tests, browser e2e (web + Tauri webview), native release benchmark execution itself (artifacts analyzed, not re-executed — release Tauri build exceeds this review's means).
- Attribution caveat (recurs from round 1): the benchmark ran on the dev+candidate merge, so dev-tip drift cannot be fully excluded as a contributor; the candidate tree exhibits the regression vs the locked baseline either way, and the plan's rollback trigger does not condition on attribution.

Result: FAIL
