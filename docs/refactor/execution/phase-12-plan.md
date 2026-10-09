# Phase 12 plan — Cleanup, durable docs, and final architecture audit

Status: FROZEN at 2026-10-09 (hash recorded in `docs/refactor/status.json`)
Phase contract: `docs/refactor/phases/12-cleanup.md` (sha256 `626b04626484ffda893825753e01de5bf4dcd4fe5c7f3b93ca44554ba3311386`)
Phase base: `15e95a91d8683d32459cfff82b88caa812ff2a22`

## 1. Verified facts
| Fact | Evidence (file:line or command → result) |
|---|---|
| No temporary compatibility paths remain open | All 12 plans §6 audited: 0/1/2/3/6/7/10/11 record none; 4 seams resolved (fork/publish are full features: `apps/web/config/routes.rb` + `presentations_controller.rb` + `client_shell_controller.js:90-97` menus; navigate/updater permanent frozen seams; graph slots migrated in 6); 5 settings rule is a boundary rule, not temp; 8 shims never materialized (`grep shim/compat → ∅`); 9 Stimulus internals removed in-phase |
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
- DO-7: phase-12 gate in `bin/check` + evidence; freeze candidate.

Non-goals (explicitly deferred/out of scope):
- No product behavior change of any kind (contract names none).
- No `docs`/`perf` tier implementation: unspecified by every phase contract; honest stubs retained (decision recorded here for P12-10).
- No committed `docs/refactor/` deletion: proven deletable + marked; deletion itself is post-campaign (status.json final PASS must exist first, P12-11).
- No campaign-skill removal before final PASS (would orphan the running campaign); skills are marked per the retirement manifest instead.
- No owner-gate execution: H1–H5 stay pending (H4 recorded; 1–3, 5 pending as before).
- No new packages/crates/top-level dirs (I16 minimization; none needed).

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

Package admission (only if a package/crate/top-level dir is added): no new package. P12-03 is reviewer judgment over the existing five.

## 4. Behavior to preserve
| Behavior | Proving test/scenario/fixture |
|---|---|
| All Phase 00–11 behavior incl. the 16 shared scenario names/results | Full battery at candidate (quick, affected, rails 346, system 224, JS 348, client 99, work-model 51, renderer 14, frontend 48, e2e-unit 7, conformance 12, local-store 73, desktop e2e, web e2e 43, benchmark 20/20 with baseline-identical miss) |
| Checker strictness (no weakening, I14) | Boundary/ownership/arch suites + self-tests green; `RANGE_WRAPPER_ALLOW` removal changes no verdict (dead branch; proven by green rerun) |
| Release authorization + deploy-ref gating semantics | Untouched files; `tooling/release/*` + workflow `needs` unchanged (diff audit) |

Intended behavior changes (only those named by the phase contract):
- None. Path/surface/behavior changes: none. (`bin/check all` is new verification surface, not product behavior.)

## 5. Work breakdown
Ordered steps; structural moves and behavior changes in separate commits.
1. DO-1 (tooling): implement `bin/check all` (suite list + ceiling measurement). Commit.
2. DO-2 (deletion): remove `scripts/elef-agent` + `RANGE_WRAPPER_ALLOW`; update the `AGENTS.md` ban note. Boundary self-tests green. Commit.
3. DO-3 (hygiene): `.gitignore` run-output rules; prove `all` leaves no diff. Commit.
4. DO-4 (docs): durable-docs completion audit + `AGENTS.md` steady-state rewrite (`$docs-sync`). Commit.
5. DO-5 (exercises): five unseen P12-07 seeds + fresh-agent transcripts (all PASS ≤5 min or docs-fixed + reseed per phase-10 precedent). Commit.
6. DO-6 (deletion proof): throwaway-checkout P12-08 proof + P12-12 retirement manifest. Commit.
7. DO-7 (tooling): phase-12 gate in `bin/check` (P12-09 evidence validation + P12-11 transition preconditions); full proof map (§8); freeze candidate.

## 6. Deletions and temporary compatibility
| Item | Owner | Reason | Deletion condition |
|---|---|---|---|
| `scripts/elef-agent` | tooling | Dead retired workflow, banned from use, zero consumers | This phase (DO-2) |
| `RANGE_WRAPPER_ALLOW` + its use | tooling | Dead R8 exception (proven unreachable, §1) | This phase (DO-2); rule strictness unchanged |
| Temporary compatibility paths introduced | — | None | — |
| Temp-compat register position | — | Empty: §1 audits every prior §6 to closure; OQ-1 positions the two judgment calls for the reviewer | Reviewer verdict (ACT resolves any FAIL) |

## 7. Risks and rollback triggers
| Risk | Trigger | Response |
|---|---|---|
| `all` exceeds the 45-min ceiling | Measured wall-clock > 45 min | Trim suite list only by contract priority (benchmark last); never by weakening — else re-plan the tier definition |
| `all` leaves a diff | `git status` non-clean after a run | Route the output to ignored paths (DO-3 pattern); never delete user files |
| Reviewer judges OQ-1 items as register entries | P12-01/P12-02 FAIL finding | ACT: add the register entry with an owner-approved condition (owner decision → pending human input) or delete the item; re-freeze if scope changes |
| Fresh-agent exercise fails | Any P12-07 run misroutes or exceeds 5 min | Fix durable docs first (the exercise measures the docs); reseed an equivalent unseen exercise; original attempt retained |
| Deletion proof fails | Any proof-set command needs `docs/refactor/` | Remove the coupling (tooling/docs fix) or narrow the proof set with reviewer agreement; never fake the deletion |
| OOM/resource kill under `all` | Exit 137 / tab-crash under load | Serialize suites, clear `/tmp/elef-*`, rerun before classification (Phase 11 probe mitigations) |

Rollback reference: `phase_base_sha` `15e95a91d8683d32459cfff82b88caa812ff2a22`.

## 8. Proof map
| Criterion / invariant | Proof (command, test, CI job, reviewer checklist) | Tier | Environment needs |
|---|---|---|---|
| P12-01 temp-compat register | Empty-by-audit: §1 per-phase §6 closure table + `grep` proofs (no shims, fork/publish real); OQ-1 reviewer judgment | reviewer + gate tripwires | — |
| P12-02 arch allowlist | `RANGE_WRAPPER_ALLOW` removed (diff); `*_ALLOWED_BARE` positioned as rule definitions (reviewer judges); `check_boundaries.py` + self-test green; never-grown diff audit | quick + reviewer | — |
| P12-03 package admission | Reviewer records justifications for the 5 (plan §1 inventory + admission-law analysis in DO-6 evidence); `ls packages/ crates/` shows no extras; frontend/e2e positioned as host tooling | reviewer | — |
| P12-04 no duplicate implementation | Ownership/boundary/arch green; duplicate-implementation sweep (renderer/Work/feature/stylesheet) zero hits; phase-9 partials positioned web-only (reviewer judges) | quick + reviewer | — |
| P12-05 state ownership | §5 9-row table as reviewer checklist against code (each mapping evidenced to its owner module) | reviewer | — |
| P12-06 durable docs | Completion audit diff (every durable rule homed); `AGENTS.md` short router (line count + no campaign refs); link check green | reviewer | — |
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

Human gates touched (constitution §8): none triggered; H1–H5 remain pending (H4 recorded; 1–3, 5 pending as before). Final handoff names them.

## 9. Re-plan log
<!-- Append dated entries: defect found, what changed, new hash. Never rewrite earlier sections silently. -->
