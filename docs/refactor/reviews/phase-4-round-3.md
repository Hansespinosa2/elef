# Phase 4 review — round 3
Candidate: 454880c41d2dd1c1298d51bd9de01f6d93652087
Base: 2bdfa86d6c6651b692a9c3bf11988309d52b27be
Review context: independent subagent session 01a11c5f (phase-4-round-3 reviewer), read-only worktree audit

## Identity and gate verification

- Worktree HEAD: `454880c41d2dd1c1298d51bd9de01f6d93652087` (`git rev-parse HEAD`), equals candidate.
- Base ancestry: `2bdfa86d...` is an ancestor of HEAD (`git merge-base --is-ancestor` → ok).
- Frozen plan identity: sha256 of bundled `PLAN.md` = sha256 of worktree `docs/refactor/execution/phase-4-plan.md` = `e197cf4e...43cd5b88` (matches `frozen_plan_sha256` in bundle status and gate snapshot).
- Contract identity: sha256 of worktree `docs/refactor/phases/04-client-library.md` = `1c172f31...fee0a0fd55` (matches plan header and snapshot).
- Immutable gate snapshot: `evidence/phase-4-gate-attempts/825fa85f.../status.json` head=candidate, base=`2bdfa86d`, phase=4/DO, contract/plan hashes match. Stored gate stdout: `{"phase":4,"result":"PASS","head":"454880c4..."}`, `ELEF_PHASE_4=PASS`, exit 0.
- Snapshot replay caveat (recurs from rounds 1–2): `bin/check phase 4 --json` with `ELEF_GATE_STATUS_PATH` set to the bundled snapshot refuses in this worktree (`gate manifest does not own this checkout`), by design (manifest checkout binding + worktree status is CHECK-state, not the DO snapshot). Identity above was verified manually; every technical gate step was rerun directly in the review worktree (see Verified section).

## Phase criteria
| Criterion | PASS/FAIL/BLOCKED | exact evidence | finding (stable ID) | required fix |
|---|---|---|---|---|
| P04-01 | PASS | `git ls-files 'app/views/library/*'` → only `shell.html.erb`; no `library_search*`, `lib/library_*`, `tests/host-conformance/shell.js` in tree; zero `renderLibraryView\|createLibraryCard\|filterLibraryCards` hits in `app/ desktop/ packages/` | — | — |
| P04-02 | PASS | `mountElef` defined `packages/client/src/index.ts:1` + `shell.tsx:11`; called by web `client_shell_controller.js:2,49`, desktop `file_library_application.js:1106`, client tests `test/helpers.tsx:36`; `dist/elef-client.js` contains `mountElef` | — | — |
| P04-03 | PASS | `library-deep-links.js` + `library-create-delete.js` + `library-and-graph.js` imported by both `desktop/e2e/specs/web.spec.js:4-6` and `desktop.spec.js:8-10`; client unit verbs green locally (`npm test --prefix packages/client`: 29 pass, 0 fail); CI exact-candidate run 37807308240: rails conformance 11 passed 1 skipped (suite policy skip), tauri `contract-conformance.spec.js` PASSED in `desktop` (113414840857) and `desktop-macos` (113414841211) | — | — |
| P04-04 | PASS | `test/system/client_library_test.rb:4-25` visits `/`, `/documents`, `/presentations` → `[data-elef-shell]` with per-filter cards/tabs (exactly the plan §8 deep-link set); router unit tests pass in client suite; CI `system-test` job 113414840692: 224 runs, 0 failures | — | — |
| P04-05 | PASS | Boundary R9 (`tooling/check_boundaries.py`) green locally; case-insensitive grep of `packages/client/src/` for host tokens → sole hit `sanitize.ts:164` `media.hostname` (platform-neutral `URL.hostname` comparison inside `isWithinMediaBase`), no host-name/plan branching; only capability branching (allowed) | — | — |
| P04-06 | PASS | Boundary R10 green; `--self-test` canary rejects R1,R10,R2,R4,R6,R7,R8,R9 as required; zero cross-`features/` imports; `ui/` imports neither `features/` nor `application/` | — | — |
| P04-07 | PASS | Exact-candidate CI artifacts (extracted JSON sha256 `03f74348…`/`9f7e52b7…` and byte sizes 65714/70923 match bundle evidence; same runners/protocol as locked `baseline.json`, n=20 each): linux coldStart 695.0 vs 879.0 (**-20.9%**), open100Slides 883.5 vs 1277.0 (**-30.8%**), warmLibrary 115.5 vs 373.5 (**-69.1%**); darwin coldStart 2018.0 vs 2259.5 (**-10.7%**), open100Slides 917.5 vs 1082.5 (**-15.2%**), warmLibrary 111.0 vs 140.5 (**-21.0%**). Every probe ≤10%-regression rule holds (all improved); miss sets identical to baseline (linux `[open100Slides]`, darwin `[coldStart, open100Slides]`) — no new ceiling crossing. P4R1-PERF-01 (rounds 1–2) is closed | — | — |

## Permanent invariants
| Invariant | PASS/FAIL/BLOCKED/N.A. | exact evidence or N.A. reason | finding (stable ID) | required fix |
|---|---|---|---|---|
| I01 | PASS | `tooling/check_boundaries.py` + `--self-test` green (canary rejects R1,R10,R2,R4,R6,R7,R8,R9); `desktop/scripts/check_architecture.py` green after `desktop/frontend` build (32 commands); round-3 tool deltas strengthen only (ownership check asserts preview-core re-exports rather than forks renderer; `CLIENT_ALLOWED_BARE` gains self-import `@elef/client` for the split entry) | — | — |
| I02 | PASS | Old library implementations deleted (see P04-01); sanitizer has one owner (`packages/client/src/ui/sanitize.ts` → `dist/sanitize.js`); app-side `preview_sanitizer.js:1-5` is a documented temporary re-export with owner/reason/deletion; shared hostile corpus (335 JS tests) executes against the client dist via that re-export | — | — |
| I03 | PASS | `git diff base..HEAD --stat -- packages/work-model crates spec` → empty; round2→round3 contracts delta empty (no new ports) | — | — |
| I04 | PASS | `packages/renderer` source untouched; `npm run renderer:build` + `git diff --exit-code vendor/javascript/elef-renderer.bundle.js` → fresh | — | — |
| I05 | PASS | Same evidence as P04-05 | — | — |
| I06 | PASS | CI exact-candidate: `test` 346 runs 0 fail, `sqlite-test` 346 runs 0 fail, `system-test` 224 runs 0 fail; `cargo test -p local-store --locked` rerun locally: 73 passed 0 failed | — | — |
| I07 | PASS | CI `desktop`/`desktop-macos` jobs green (include offline flows); desktop closure arch check green; no Rails in desktop closure | — | — |
| I08 | PASS | `npm run build --prefix packages/client` + `git diff --exit-code -- packages/client/dist/` → no diff; `config/importmap.rb:41-43` pins canonical `client/dist/elef-client.js` + `client/dist/sanitize.js` (+ round-3 `preview-core.js` entry); no committed host copies | — | — |
| I09 | PASS | Arch doc client row present (`docs/architecture.md:54,71`, incl. R9 reference); bundle `status.json` CHECK state factual | — | — |
| I10 | PASS | Same measurements as P04-07: every probe improved vs locked median; no new ceiling crossing (miss sets unchanged). Warm `affected` ceiling holds (CI `affected` job success). P4R1-PERF-01 (rounds 1–2) is closed | — | — |
| I11 | PASS | `SafeHtml.tsx:10-22` is the sole raw-HTML insertion boundary (`dangerouslySetInnerHTML` appears only in its comment, never used); only other `innerHTML` is inside the sanitizer template element (`sanitize.ts:41`); hostile vectors green in shared corpus + client unit tests | — | — |
| I12 | PASS | Round-3 adds only `packages/client` internals (`features/library/preview-core.ts`, dist split) — no new `shared/`/`common/`/`core/`/`utils/` dumping ground at boundaries | — | — |
| I13 | PASS | Temp re-export documents owner/reason/deletion (`preview_sanitizer.js:1-5`); host-seam temporaries governed by frozen plan §6 table + §9 log (both re-plan entries present); no undocumented compat shims in client/host sources | — | — |
| I14 | PASS | Deleted tests map 1:1 to deleted code; renderer corpus intact; scenarios extended not replaced; stylesheet contract test retained; additive `updatedAt?`/`warnings?` (`contracts/session.ts:13-20`) named in frozen plan §9 re-plan log with all-adapter conformance; round-3 tool-delta strengthens checks (see I01), no weakened evidence | — | — |
| I15 | N.A. | Two clean identical `all` runs are a Phase 12 completion requirement per constitution §7 rollout; phase-4 requirement (stubs fail nonzero) verified: `bin/check all|docs|perf` each exit 2 | — | — |
| I16 | PASS | `packages/client`: one responsibility (host-neutral app), one entry (`mountElef`), acyclic direction (R9/R10 enforced), independent tests (29 unit + both-host scenarios), payoff (deletes desktop boot library + ERB/Stimulus), hides React/router/state; driver = 3 consumers (Rails, Tauri, fake hosts); one-sentence justification in `package.json:8` | — | — |
| I17 | PASS | R10 isolation/acyclic rule green + canary enforcement; `ui/` imports neither `features/` nor `application/` | — | — |
| I18 | PASS | `docs/architecture.md` client row + mount/adapter routing paragraph (`:71`) present; ownership/proof routing present (boundary R9 cited in docs) | — | — |

## Human gates
All five constitution §8 gate classes remain explicitly pending and untouched by this phase (no signing/updater-key, owner-Mac, owner-Linux/Omarchy, Mac-mini-deployment, or soak/acceptance impact; frozen plan §8 confirms none touched). No human acceptance is claimed. Owner merge is not a phase gate.

## Verified / not verified

Local reruns in review worktree (all read-only; only ignored `node_modules`/`dist` build outputs written, worktree `git status` clean, tracked diffs unchanged):
- `npm ci` (root, `desktop/frontend`, `desktop/e2e`) — ok
- `npm run build --prefix packages/client` + `git diff --exit-code -- packages/client/dist/` — fresh, no diff
- `./node_modules/.bin/tsc --noEmit -p packages/client/tsconfig.test.json` — exit 0
- `npm test --prefix packages/client` — 29 pass, 0 fail
- `node --test tests/host-conformance/conformance-fake.test.js` — 12 pass, 0 fail
- `python3 tooling/check_boundaries.py` + `--self-test` (canary rejects R1,R10,R2,R4,R6,R7,R8,R9) + `script/check_frontend_ownership.py` — pass
- `npm run test:javascript` — 335 pass, 0 fail; `npm test --prefix packages/work-model` — 33 pass; `npm test --prefix packages/renderer` — 14 pass; `tsc -p packages/contracts/tsconfig.test.json` — exit 0
- `npm test --prefix desktop/frontend` — 43 pass; `npm run build --prefix desktop/frontend` then `python3 desktop/scripts/check_architecture.py` — pass (32 commands)
- `npm run test:unit --prefix desktop/e2e` — 7 pass; `cargo test -p local-store --locked` — 73 pass
- `npm run renderer:build` + renderer bundle diff — fresh; `bin/check all|docs|perf` — each exit 2 (stubs intact)
- Gate snapshot/identity checks as listed above; full `bin/check phase 4` replay refused by checkout-bound manifest (by design), technical steps rerun individually instead
- Perf: artifacts downloaded via `gh api .../artifacts/{11563838073,11564805810}/zip`; extracted JSON sha256 (`03f74348…`, `9f7e52b7…`) and byte sizes (65714/70923) match bundle evidence; medians computed over n=20 samples per probe against locked `baseline.json` on identical runners/protocol (`6.17.0-1022-azure` x64, `24.6.0` arm64)

Exact-candidate CI evidence (bundle `phase-4-ci-evidence.json`, independently corroborated via `gh api`): run `https://github.com/Hansespinosa2/elef/actions/runs/37807308240` attempt 1, `conclusion: success`, `head_sha: 454880c...` (= candidate), PR #136 → `dev`; jobs API confirms success on `desktop-fast`, `test`, `system-test`, `affected`, `sqlite-test`, `desktop`, `desktop-macos`, `renderer-macos`, `scan_js`, `scan_ruby`, `production-smoke`, `development-smoke`, `record-ci-attestation` (deploy gate skipped as expected); rails conformance 11 passed 1 skipped; tauri conformance PASSED both platforms.
- Not verified locally (no suitable local runner; covered by the above exact-candidate CI evidence): Rails system tests, browser e2e (web + Tauri webview), native release benchmark execution itself (artifacts analyzed, not re-executed — release Tauri build exceeds this review's means).
- Attribution caveat (recurs from rounds 1–2): the benchmark ran on the dev+candidate merge, so dev-tip drift cannot be fully excluded as a contributor; the candidate tree exhibits the improvement vs the locked baseline either way, and the plan's rollback trigger does not condition on attribution.

Result: PASS
