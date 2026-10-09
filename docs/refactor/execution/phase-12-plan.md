# Phase 12 plan — Cleanup, durable docs, and final architecture audit

Status: RE-PLAN DRAFT (v1 frozen 2026-10-09; v2 freeze pending the F1 owner fork — see §9 log 2026-10-10)
Phase contract: `docs/refactor/phases/12-cleanup.md` (sha256 `626b04626484ffda893825753e01de5bf4dcd4fe5c7f3b93ca44554ba3311386`)
Phase base: `15e95a91d8683d32459cfff82b88caa812ff2a22`

## 1. Verified facts
| Fact | Evidence (file:line or command → result) |
|---|---|
| No temporary compatibility paths remain open | **v1 CLAIM WITHDRAWN — see §9 log 2026-10-10.** The v1 `grep shim/compat → ∅` audit missed the word "Temporary": `apps/web/app/javascript/lib/preview_sanitizer.js:1-4` ("Temporary re-export … this file is deleted then", condition = phases 05+08, both PASS) and `preview_chrome.js:4` ("keeps the document-editor chrome until Phase 09", PASS) are live temp-compat with expired conditions (F3). Re-audit: `grep -rni 'temporar\|until Phase\|compat\|shim' apps packages crates tooling` + per-file disposition in DO-9 |
| F1: desktop consumes ~70% of web-host JS host→host | Static+dynamic import closure from `apps/desktop/frontend/src` into `apps/web/app/javascript`: 45 files, ~9,900 lines (closure script `/tmp/fullclosure.py`; seeds `lib/file_library_application`, `lib/editor_runtime`, `lib/authoring_registry_merge`, `lib/renderer_worker`, `controllers/authoring_registry`). `editor_runtime.js` dynamically boots 13 web Stimulus controllers. Violates frozen §4 "hosts never depend on each other" (`CONSTITUTION.md:193`) and §5 "navigation → client application" (`:227`). No phase 4–9 contract scoped a de-Stimulus of the editor core (phase 8 scoped P08-01 to session/text ownership, "controller holds no buffer (only adapter shell)") — owner fork required (DO-8) |
| F2: vim preferences implemented twice | `apps/web/app/javascript/controllers/vim_preferences.js` (web `editor_controller.js:24` importer) and `packages/client/src/features/settings/vimPreferences.ts` (client `VimSettings.tsx` importer) define the same `elef.editor.vim.*` keys + helpers (`normalizeEscapeKey`, `escapeKeyDisplay`, `vimKeyFromEvent`) |
| F4: contracts `mountElef` is phantom | `packages/contracts/src/host.ts:24-28` declares sync `mountElef(hostElement, host, options?): {unmount}`; real entry is async `packages/client/src/application/shell.tsx:16` returning `Promise<ElefShell>`; zero value-importers of the contracts declaration (`grep import.*mountElef` → only `@elef/client` sources) |
| F5: frozen `spec/` never created, no ADR | Constitution §4 freezes `spec/` (`CONSTITUTION.md:147,164`: persisted format, schema/version rules, archive layout, compat fixtures); `ls spec` → absent; no ADR mentions it; format truth split across `docs/desktop/data-format.md` (61 lines), `crates/local-store` manifest/archive code, Ruby `apps/web/app/lib/source/*.rb`, work-model parsing |
| F6/F7 duplication | Group `position_close`-range logic in 3 places (`work-model/document_transforms.js:88-92`, client `document_editor.js:319-340,455-456`, client `presentation/editor.js:311,381`); align position vocabulary in host `authoring_registry_merge.js:12-19` and work-model `document_map.js:759-766` |
| F8/F9/F10/F11 client hygiene | Client barrel exports ~20 pptx internals (`packages/client/src/index.ts:24`); 14 files under `apps/web/test` + `apps/desktop/e2e` deep-import package `src/` (checker `tooling/check_boundaries.py:73-95` scans only inside `packages/`); server↔client editor-markup vocabulary (`data-editor-block-id`, `visual-editor#*`) coherent but unpinned (`block_renderer.rb:25-38` ↔ `document_editor.js:135-260`); `@elef/work-model/document-transforms` imported by client sources but missing from `packages/client/package.json` dependencies |
| F13 renderer home violates §6 | "canonical generated JS/CSS artifacts live once in the producing package `dist/`" (`CONSTITUTION.md:236`); actual: host-owned entry `apps/web/app/javascript/lib/renderer_global.js`, host-owned build `apps/web/script/build_renderer.mjs`, host-owned output `apps/web/vendor/javascript/elef-renderer.bundle.js`; 8 consumer references (importmap, `javascript_renderer.rb`, desktop `build.mjs`, corpus spec, fixtures test, update script, build script, `bin/check`) |
| F14/F15 docs contradictions | ADR-004 "Status: Proposed" still says "Rails `app/` owns shareable product UI" (pre-rehome paths); `apps/desktop/README.md:3` says shared UI lives under `apps/web/app/` while root `README.md:9` says `packages/client` |
| N1 dead importmap pins | `package.json:10-11` `#elef/authoring-settings` + `#elef/authoring-registry-write` point at deleted files; zero references |
| Phase-9 retained server projection partials (8 files) are permanent web-host code, not temp-compat | `phase-9-plan.md` §6: "retained pages render them"; deletion condition is a possible future port, not a compat removal. Position for reviewer judgment under P12-04/P12-10 |
| `scripts/elef-agent` is dead and banned | `phase-11-plan.md` §6 "explicitly untouched"; `AGENTS.md` Safety bans its use; single tracked file, zero importers (`grep elef-agent` outside AGENTS/retired-note → ∅) |
| `RANGE_WRAPPER_ALLOW` is a dead exception | `grep -E` of `REINTERPRET_PATTERN` over `apps/web/app/lib/source/document.rb` → zero matches; the `continue` branch in `tooling/check_boundaries.py:338-342` is unreachable |
| `*_ALLOWED_BARE` tuples are permanent dependency-direction definitions | `tooling/check_boundaries.py:98-114`: bare-import vocabularies per package (rule definitions, not rule exceptions). Position for reviewer judgment under P12-02 |
| Exactly the 5 contract packages exist | `ls packages/ crates/` → client, contracts, renderer, work-model, local-store. `apps/desktop/{frontend,e2e}/package.json` are host-owned build/test harnesses (single consumer), not architectural packages — position for P12-03 |
| `bin/check all/docs/perf` are unimplemented stubs | `bin/check all` → "not implemented in Phase 01" (same docs, perf) |
| Steady tiers never read `docs/refactor/` | `grep docs/refactor bin/check` hits only `STATUS_PATH`/`BASELINE_PATH` constants + `check_phase*`/`run_phase*` consumers; quick/affected/arch/fresh/stubs are docs-free; the three checker scripts contain zero `docs/refactor`/`baseline` references |
| Zero durable links depend on `docs/refactor/` | `rg "docs/refactor" AGENTS.md README.md docs .agents/skills` → ∅ (verified Phase 11 CHECK) |
| `AGENTS.md` (71 lines) is a campaign router | `cat AGENTS.md`: Start-here chain, skill router, campaign autonomy/safety/git rules — must become the steady-state router (P12-06/P12-12) |
| State-ownership finite checklist | Constitution §5 (`CONSTITUTION.md:227`): 9 mappings (work-model, renderer, editor, client application, WorkSession, web/database, local-store/filesystem, web auth, desktop lifecycle/updater) |
| Exercise precedent format | `docs/refactor/execution/phase-10-exercises/ex{1,1b,2,3}-*.md` seeds + `phase-10-exercise-transcripts.md` verdicts (route-only, ≤5 min, durable docs only) |
| Remote CI posture | PR #136 DIRTY/CONFLICTING (deferred rule applies); Docker Hub unauthenticated rate limits broke container-service jobs twice in Phase 11 (evidence pattern: deferred + local battery) |

Open questions / unknowns (each is a blocker or has a resolution step):
- OQ-1 (reviewer-resolved, not blocking): do the phase-9 retained partials or `*_ALLOWED_BARE` count as P12-01/P12-02 register items? Plan positions NO with the evidence above; a FAIL finding converts the item into a register entry or a deletion, decided in ACT.
- OQ-2 (DO-resolved): exact `all`-tier suite list and wall-clock (must fit the 45-min CI ceiling; measured in DO-1, frozen in the gate).

## 2. Scope
In scope (DO-1..DO-7, ordered; structural/prose/tooling commits separated):
- DO-1: implement `bin/check all` (full release/integration envelope: quick + affected + arch + fresh + stubs + rails unit + rails system + desktop e2e + web e2e + native benchmark) with measured wall-clock.
- DO-2: delete dead code: `scripts/elef-agent` + `RANGE_WRAPPER_ALLOW` (constant + use) + the `AGENTS.md` ban note it obsoletes.
- DO-3: run-output hygiene so `all` leaves no diff: ignore repo-root `/tmp/` + `apps/desktop/e2e/{logs,test-results,playwright-report,native-scenarios.log}` (all regenerable diagnostics; CI uploads them as artifacts regardless).
- DO-4: durable-docs completion (P12-06): audit that doctrine/architecture/development/runbooks hold every durable rule still living only in constitution/phases (package one-sentence justifications per I16, change-routing, validation tiers, data-safety); rewrite `AGENTS.md` as the steady-state short router.
- DO-5: P12-07 five unseen routing exercises (new seeds + fresh-agent transcripts, phase-10 format).
- DO-6: P12-08 deletion proof in a throwaway checkout (`rm -rf docs/refactor`, proof set below) + P12-12 retirement manifest (removed-vs-marked record).
- DO-7: phase-12 gate in `bin/check` + evidence; freeze candidate. (v1 candidate `92d9d3b` SUPERSEDED by the §9 2026-10-10 re-plan; gate stands, evidence re-runs at the new candidate.)
- DO-8 (F1 endgame — scope set by the owner fork; no edits until the fork resolves):
  - Fork A (full migration): move the 45-file desktop-consumed closure into `packages/client` (application/ + feature slices), de-Stimulus the editor shell, delete the desktop alias plugin; `check_frontend_ownership.py` transitional rule retires.
  - Fork B (neutral package + ADR, recommended): rehome the shared Stimulus shell into a new neutral package with a narrowed boot API (both hosts consume the package; no host→host), retire the alias + transitional rule, owner-approved ADR amends the §4 client definition; package-admission law applied in writing in this plan before the move.
  - Fork C (waiver): owner ADR blesses the alias as steady state; no moves (not recommended — abandons the structural goal).
- DO-9 (unconditional remediation batch, separate commits per finding): F2 vim single-owner; F3 temp-compat deletion (sanitizer re-export + document chrome; chrome target follows the F1 fork); F4 contracts phantom deletion; F5 minimal `spec/` (deck-manifest + archive schemas, version rules, compat fixtures, one wired consumer); F6 work-model `blockOperationRange` + both editors call it; F7 grammar derives from work-model; F8 narrow client barrel; F9 tests through barrels + repo-wide deep-import check; F10 markup-vocabulary pin test; F11 missing dep; F12 `local-store` module split; F13 renderer entry/build/dist into `packages/renderer`; F14/F15 docs reconciliation; N1 dead pins. N2–N5: N2 share-or-leave at fix time, N3/N5 fix, N4 accept (commented, don't extend).
- DO-10: new candidate battery (`all` ×2 P12-09 evidence at the post-remediation candidate), CHECK, independent review, ACT/PASS.

Non-goals (explicitly deferred/out of scope):
- No product behavior change of any kind (contract names none; every move is behavior-preserving, proven by the existing suites).
- No `docs`/`perf` tier implementation: unspecified by every phase contract; honest stubs retained (decision recorded here for P12-10).
- No committed `docs/refactor/` deletion: proven deletable + marked; deletion itself is post-campaign (status.json final PASS must exist first, P12-11).
- No campaign-skill removal before final PASS (would orphan the running campaign); skills are marked per the retirement manifest instead.
- No owner-gate execution: H1–H5 stay pending (all five explicitly named in status since DO-7).
- No new packages/crates/top-level dirs except fork B's editor-runtime package (admission law in writing below) and frozen `spec/` (F5 implements the frozen target, not a new invention).

## 3. Ownership classification
| Change | Semantic owner (constitution §4) | Shared or host-specific (+ concrete reason) |
|---|---|---|
| `bin/check all` tier | `tooling` (via `bin/`) | Shared repo verification; suites keep their own owners |
| Delete `scripts/elef-agent` | `tooling` (retired) | Dead code removal; zero consumers |
| Delete `RANGE_WRAPPER_ALLOW` | `tooling` (boundary checker) | Dead exception removal; R8 rule unchanged and still enforced |
| `.gitignore` run-output rules | `tooling` | Repo hygiene; outputs regenerable on every machine |
| Durable-docs completion + `AGENTS.md` rewrite | `docs/` | Shared; docs describe the tree at every checkpoint (I09) |
| P12-07/P12-08/P12-12 evidence + retirement manifest | `docs/refactor/execution/` (campaign) | Temporary phase evidence, deleted with `docs/refactor/` post-campaign |
| Phase-12 gate | `tooling` (via `bin/`) | Shared repo verification |

| F1 fork A: closure → client | `client` (`application/` orchestration + `features/` slices + `session/` lifecycle + `ui/` chrome) | Shared: both hosts mount the same client entries; Tauri/Rails transports stay host-side, injected through contracts ports |
| F1 fork B: shell → new package | new `packages/editor-runtime` (name fixed at freeze) | Shared: both hosts consume the package; narrowed boot API (`registerEditorRuntime`, `mountEditorHosts`, `startFileLibraryApplication`) — no per-controller deep imports |
| F2 vim single owner | `client` (`features/settings/vimPreferences.ts`) | Shared; web `editor_controller.js` imports the client subpath (new export) |
| F3 sanitizer deletion | `client` (`ui/sanitize.ts` + `/sanitize` subpath already exist) | Shared; 3 importers repointed, `#elef/preview-sanitizer` pin removed |
| F3 chrome move | `client` (`ui/` or `features/document/`) under fork A; the neutral package under fork B | Shared; `preview_chrome.js` leaves the web host either way |
| F4 contracts phantom | `contracts` (deletion) + `client` (true owner already) | Shared; contracts keeps types/ports only |
| F5 `spec/` | `spec/` (frozen §4 home) | Shared declarative truth; one wired consumer (local-store manifest test reads the fixture) |
| F6 range unification | `work-model` (`document_transforms.js`) | Shared; both client editors call the one function |
| F7 grammar source | `work-model` (vocabulary) | Shared; host merge derives/validates, never restates |
| F8 barrel narrowing | `client` (API surface) | Shared; internals leave `index.ts`, tests use the model export |
| F9 test barrels | tests + `tooling` (checker) | Shared; `check_deep_imports` extended repo-wide |
| F10 vocabulary pin | `tooling` (architecture test) + `client`/`apps/web` (both sides pinned) | Shared string vocabulary, single test owner |
| F11 missing dep | `client` (`package.json`) | Shared; declaration matches reality |
| F12 local-store split | `local-store` (internal modules) | Host-neutral engine; no API change |
| F13 renderer home | `renderer` (entry + build + `dist/`) | Shared; hosts consume the canonical bundle |
| F14/F15/N1 docs + pins | `docs/` + `package.json` | Shared; one home per fact ($docs-sync) |

Package admission for fork B's editor-runtime package (written before any move; fork A/C need no new package):
1. One cohesive responsibility: the Stimulus editor-shell runtime (controllers + editor lib + desktop bootstrap) — yes.
2. Small stable public API: narrowed boot entries only (`registerEditorRuntime`, `mountEditorHosts`, `startFileLibraryApplication`, mount tokens); per-controller imports forbidden by checker — must hold at freeze or the fork fails back to A.
3. Acyclic machine-enforceable direction: package → client/work-model/contracts; hosts → package; enforced by `check_boundaries.py` + ownership checker — yes.
4. Meaningful independent tests: the existing `apps/web/test/javascript` suite runs against package paths — yes (relocated, not rewritten).
5. Concrete architectural payoff: eliminates all host→host imports; retires the transitional ownership rule — yes.
6. Hides more than exposes: ~10k lines behind ~4 entries — yes, conditional on (2).
Driver: multiple architectural consumers (both hosts boot the same runtime) — yes.
P12-03 reviewer judgment then covers six packages; the "why it earns its boundary" record extends to the new one.

## 4. Behavior to preserve
| Behavior | Proving test/scenario/fixture |
|---|---|
| All Phase 00–11 behavior incl. the 16 shared scenario names/results | Full battery at candidate (quick, affected, rails 346, system 224, JS 348, client 99, work-model 51, renderer 14, frontend 48, e2e-unit 7, conformance 12, local-store 73, desktop e2e, web e2e 43, benchmark 20/20 with baseline-identical miss) |
| Checker strictness (no weakening, I14) | Boundary/ownership/arch suites + self-tests green; `RANGE_WRAPPER_ALLOW` removal changes no verdict (dead branch; proven by green rerun) |
| Release authorization + deploy-ref gating semantics | Untouched files; `tooling/release/*` + workflow `needs` unchanged (diff audit) |

| Desktop application bootstrap + Stimulus editor shell (F1 moves) | Desktop e2e suite (native scenarios incl. save/quiet-save/open-flows) + web system suite (224) + JS suite (348) green on moved-but-identical code; `ELEF_E2E_BUILD` debug + release builds |
| Vim preferences behavior (F2) | Same storage keys + editor push semantics; settings + editor specs green |
| Sanitizer + document chrome (F3) | Preview projection tests + renderer corpus + e2e preview scenarios green; shipped-bytes identity for the renderer bundle (existing freshness check) |
| Renderer bundle bytes (F13) | `renderPreviewCore` output identical: renderer fixtures test + corpus spec + freshness-compare green; consumers (importmap, MiniRacer bridge, desktop build) resolve the new home |
| local-store API (F12) | `cargo test -p local-store` 73 green; no public signature change (diff audit on `pub` items) |
| Client public API consumers (F8/F9) | Full JS + client + e2e suites green after barrel narrowing; repo-wide deep-import check green |

Intended behavior changes (only those named by the phase contract):
- None. Path/surface/behavior changes: none. (Every remediation is a behavior-preserving move/deletion/narrowing; import surfaces change but user-visible behavior does not. `bin/check all` is new verification surface, not product behavior.)

## 5. Work breakdown
Ordered steps; structural moves and behavior changes in separate commits.
1. DO-1 (tooling): implement `bin/check all` (suite list + ceiling measurement). Commit.
2. DO-2 (deletion): remove `scripts/elef-agent` + `RANGE_WRAPPER_ALLOW`; update the `AGENTS.md` ban note. Boundary self-tests green. Commit.
3. DO-3 (hygiene): `.gitignore` run-output rules; prove `all` leaves no diff. Commit.
4. DO-4 (docs): durable-docs completion audit + `AGENTS.md` steady-state rewrite (`$docs-sync`). Commit.
5. DO-5 (exercises): five unseen P12-07 seeds + fresh-agent transcripts (all PASS ≤5 min or docs-fixed + reseed per phase-10 precedent). Commit.
6. DO-6 (deletion proof): throwaway-checkout P12-08 proof + P12-12 retirement manifest. Commit.
7. DO-7 (tooling): phase-12 gate in `bin/check` (P12-09 evidence validation + P12-11 transition preconditions); full proof map (§8); freeze candidate. (v1 candidate superseded; gate code stands.)
8. DO-8 (F1 endgame per the frozen fork): fork A — closure moves in per-slice commits (bootstrap → application/, editor shell → features/ui, helpers → session/work-model), alias deletion, ownership-checker retirement, durable-docs path updates in the same commits (I09); fork B — package scaffold + narrowed boot API + bulk rehome + consumer repoint + alias/checker retirement + ADR; fork C — ADR only. Each commit: affected tier + targeted e2e proof.
9. DO-9 (unconditional batch, one commit per finding, ordered F11 → F4 → F2 → F3-sanitizer → F8 → F9 → F6 → F7 → F10 → F5 → F13 → F12 → F14/F15/N1/N3/N5): each commit proves its own scope (named suite green); F3-chrome follows the DO-8 fork target.
10. DO-10 (candidate): re-run `all` ×2 at the post-remediation candidate (P12-09 evidence); prepare-gate/run-gate ×2; CHECK; independent review round 1; ACT→PASS; `reconstruct` 13 checkpoints; handoff.

## 6. Deletions and temporary compatibility
| Item | Owner | Reason | Deletion condition |
|---|---|---|---|
| `scripts/elef-agent` | tooling | Dead retired workflow, banned from use, zero consumers | This phase (DO-2) |
| `RANGE_WRAPPER_ALLOW` + its use | tooling | Dead R8 exception (proven unreachable, §1) | This phase (DO-2); rule strictness unchanged |
| `apps/web/app/javascript/lib/preview_sanitizer.js` + `#elef/preview-sanitizer` pin | client (true owner already) | Temp-compat with expired condition (phases 05+08 PASS); 3 importers repoint to `@elef/client/sanitize` | This phase (DO-9) |
| `apps/web/app/javascript/lib/preview_chrome.js` (web-host home) | client or neutral package per F1 fork | Temp-compat with expired condition (phase 09 PASS); moves, not deleted | This phase (DO-8/DO-9) |
| `apps/web/app/javascript/controllers/vim_preferences.js` | client (true owner already) | Duplicate implementation; web importer repoints to the client subpath | This phase (DO-9) |
| `mountElef` in `packages/contracts` | contracts (deletion) | Phantom declaration; true entry already owned by client | This phase (DO-9) |
| Desktop alias plugin + `#elef/*` web-host pins (forks A/B) | desktop host build | Host→host mechanism; consumers repoint to package entries | This phase (DO-8) |
| `apps/web/vendor/javascript/elef-renderer.bundle.js` (host home) + host build script | renderer (true home) | §6 canonical-home rule; moves to `packages/renderer/dist/` | This phase (DO-9) |
| Temporary compatibility paths introduced | — | None: every move is atomic per commit (old path deleted, new path live, no shims) | — |
| Temp-compat register position | — | Empty after DO-9: F3 items deleted/moved (this table); v1 §6 audit corrected per §9 log; F1 transitional ownership rule retired (forks A/B) or owner-ADR'd (fork C); OQ-1 positions the two judgment calls for the reviewer | Reviewer verdict (ACT resolves any FAIL) |

## 7. Risks and rollback triggers
| Risk | Trigger | Response |
|---|---|---|
| `all` exceeds the 45-min ceiling | Measured wall-clock > 45 min | Trim suite list only by contract priority (benchmark last); never by weakening — else re-plan the tier definition |
| `all` leaves a diff | `git status` non-clean after a run | Route the output to ignored paths (DO-3 pattern); never delete user files |
| Reviewer judges OQ-1 items as register entries | P12-01/P12-02 FAIL finding | ACT: add the register entry with an owner-approved condition (owner decision → pending human input) or delete the item; re-freeze if scope changes |
| Fresh-agent exercise fails | Any P12-07 run misroutes or exceeds 5 min | Fix durable docs first (the exercise measures the docs); reseed an equivalent unseen exercise; original attempt retained |
| Deletion proof fails | Any proof-set command needs `docs/refactor/` | Remove the coupling (tooling/docs fix) or narrow the proof set with reviewer agreement; never fake the deletion |
| OOM/resource kill under `all` | Exit 137 / tab-crash under load | Serialize suites, clear `/tmp/elef-*`, rerun before classification (Phase 11 probe mitigations) |
| F1 move breaks desktop boot | Desktop e2e red after a move commit | Revert the single move commit (moves are atomic); re-scope the slice; never shim the old path back |
| Barrel narrowing (F8) breaks an importer | Suite/e2e import error | The narrowing commit repoints the importer in the same commit; grep-gate proves zero stragglers before commit |
| Renderer bundle bytes drift (F13) | Freshness-compare or corpus red | Byte-identity is the gate: diff the old/new bundle output on the fixture corpus; no drift accepted |
| local-store split changes API (F12) | `pub`-item diff non-empty | Split is internal-only; any signature change fails the commit |
| Fork B API cannot narrow honestly | Boot still needs per-controller imports | Fork fails back to A (admission item 2 in §3); re-freeze with fork A scope |

Rollback reference: `phase_base_sha` `15e95a91d8683d32459cfff82b88caa812ff2a22`.

## 8. Proof map
| Criterion / invariant | Proof (command, test, CI job, reviewer checklist) | Tier | Environment needs |
|---|---|---|---|
| P12-01 temp-compat register | Empty after DO-9: corrected audit (`grep -rni 'temporar\|until Phase\|compat\|shim'` + per-file disposition in evidence); F3 items deleted/moved (§6); F1 transitional rule retired (A/B) or ADR'd (C); OQ-1 reviewer judgment | reviewer + gate tripwires | — |
| P12-02 arch allowlist | `RANGE_WRAPPER_ALLOW` removed (diff); `*_ALLOWED_BARE` positioned as rule definitions (reviewer judges); `check_boundaries.py` + self-test green; never-grown diff audit | quick + reviewer | — |
| P12-03 package admission | Reviewer records justifications for the 5 (plan §1 inventory + admission-law analysis); fork B adds the 6th with §3 admission record; `ls packages/ crates/ spec/` shows no extras; frontend/e2e positioned as host tooling | reviewer | — |
| P12-04 no duplicate implementation | Ownership/boundary/arch green; F2/F6/F7/F8 deletions in diff; duplicate-implementation sweep zero hits; phase-9 partials positioned web-only (reviewer judges) | quick + reviewer | — |
| P12-05 state ownership | §5 9-row table as reviewer checklist against code; F1 end state evidenced (navigation in client application/ under A, in the neutral package with ADR scoping under B); F2 single vim owner | reviewer | — |
| P12-06 durable docs | Completion audit diff (every durable rule homed); `AGENTS.md` short router (line count + no campaign refs); link check green; F14/F15 reconciled in the same commits that change the code (I09); `spec/` rules homed | reviewer | — |
| P12-07 fresh-agent routing | Five unseen seeds + timed transcripts, all PASS ≤5 min (phase-10 format) | exercises | fresh subagent, docs only |
| P12-08 deletion proof | Throwaway checkout: `rm -rf docs/refactor` then `npm ci` + `npm run test:javascript` + `bin/rails test` (subset) + `cargo test -p local-store` + `tailwindcss:build` + `bin/check quick` + `bin/check all` — all green; durable link check ∅ | deletion proof | PG + toolchains |
| P12-09 `all` twice | Two `bin/check all` runs on clean checkout: identical PASS verdicts, `git status` clean before/after each (durations + verdicts in evidence) | all × 2 | PG + browsers + Tauri |
| P12-10 arch review | Contract 10-item checklist, every item PASS with file:line evidence | reviewer | — |
| P12-11 ACT postcondition | Gate + reviewer verify transition preconditions, record `PENDING(ACT)`; ACT commits final PASS status; `reconstruct` proves 13 checkpoints before handoff | gate + ACT | — |
| P12-12 retirement | Manifest lists every campaign-only item as removed (elef-agent, dead exception) or marked (docs/refactor/, campaign skills, phase gates); retained skills reference durable SSOT | reviewer | — |
| I15 `all` twice clean | Same as P12-09 (this phase's completion requirement) | all × 2 | PG + browsers + Tauri |
| I18 fresh-agent routing | Same as P12-07 | exercises | fresh subagent |
| I01–I14, I16, I17 | Quick/arch green + reviewer audit (no weakening: diff audit; I16 justifications written in durable docs) | quick + reviewer | — |

Fixed fixture sets / finite reviewer checklists required by the contract:
- §5 state-ownership table (9 rows) for P12-05.
- P12-10 ten-item architecture checklist (contract-quoted).
- Five P12-07 unseen exercise seeds (fixed at DO-5).
- P12-08 proof-set command list (fixed above).
- P12-12 retirement manifest (fixed at DO-6).

Human gates touched (constitution §8): none triggered; H1–H5 remain pending, all five explicitly named in `status.json` since DO-7 (`state(phase-12)` checkpoint). Final handoff names them.

## 9. Re-plan log
<!-- Append dated entries: defect found, what changed, new hash. Never rewrite earlier sections silently. -->

### 2026-10-10 — adversarial-review re-plan (plan defect: v1 end-state audit missed live leftovers)
- Defect found: owner-ordered adversarial review of v1 candidate `92d9d3b` returned FAIL with 5 must-fix findings, each verified against the tree by the implementer: F1 desktop consumes 45 files/~9.9k lines of web-host JS host→host (frozen §4 + §5 violation; v1 §1 never audited the desktop alias closure); F2 vim preferences duplicated; F3 two live "Temporary/until Phase 09" shims with expired conditions (v1 `grep shim/compat` missed the word "Temporary", invalidating the P12-01 empty-register claim); F4 phantom `mountElef` in contracts; F5 frozen `spec/` never created with no ADR. 10 should-fix + 5 nits verified and triaged into scope (F12 split included; N4 accepted as-is).
- Invalidated assumptions: v1 §1 "no temp-compat" row (withdrawn, corrected above); v1 candidate `92d9d3b` (superseded — remediation changes production code; its `all` ×2 evidence runs were terminated before completion); v1 "no new packages" non-goal (fork B needs one; fork A/C do not).
- Added scope: DO-8 F1 endgame (owner fork A/B/C — §2; no edits until resolved), DO-9 unconditional remediation batch (ordered commits), DO-10 new-candidate battery. Preserved legal work: DO-1..DO-7 commits, the phase-12 gate code (evidence re-runs at the new candidate), P12-07 exercises (docs-routing still valid; reviewer re-verifies), P12-08 deletion proof (unaffected by production moves), five named human gates.
- Proof changes: P12-01 corrected audit command + per-file disposition; P12-03 sixth-package branch; P12-04/05/06/10 evidence extended per finding; P12-09 re-runs at the new candidate.
- Resolution: re-plan entry `d7eb4e7` (DO→PLAN, hash cleared); this v2 draft freezes on the owner fork answer (hash recorded in status + DO resume in the freeze commit).
