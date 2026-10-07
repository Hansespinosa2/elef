# Campaign state protocol

These mechanics implement constitution §1/§8/§10. They cannot change architecture, criteria or the status schema.

## Evidence and candidate identity

Use integer phase numbers in evidence filenames (`phase-0`, not `phase-00`); phase contract filenames remain padded (`00-baseline.md`).

| File | Content |
|---|---|
| `docs/refactor/status.json` | Current state under the constitution schema |
| `docs/refactor/execution/phase-N-plan.md` | Frozen scope/proof map, with appended re-plan history |
| `docs/refactor/execution/phase-N-gate.json` | Atomic selection of a completed immutable attempt |
| `docs/refactor/execution/phase-N-gate-attempts/ID/` | Started manifest, immutable candidate status snapshot, streamed stdout/stderr, completed result |
| `docs/refactor/reviews/phase-N-round-K.md` | Verbatim independent report |
| `docs/refactor/execution/phase-N-round-K-context.json` | Fresh reviewer launch receipt: phase, round, head, base, mechanism, identity, conversation_inherited=false, launch command/tool call, report_sha256 |
| `docs/refactor/execution/status-reconstruction.md` | Recovery facts, commands, decision and next action |
| `docs/refactor/baseline.{md,json}` | Phase 00 facts and locked comparable measurements |

`tmp/reviews/` holds disposable bundles/worktrees. Ignore them in Git and inspect before cleanup. The source docs and bootstrap report record the verified campaign base; preserve it during recovery.

Use full commit SHAs and exact equality. `head_sha` is the candidate commit, not the later evidence commit. `phase_base_sha` is the previous PASS checkpoint (Phase 00 uses campaign_base_sha). Contract and plan hashes cover the exact UTF-8 file bytes. Evidence commits may change only status/reviews/execution files; even in execution, the frozen plan must equal the candidate's plan.

Use `prepare-gate N` after production is committed. It creates the immutable DO snapshot with head_sha equal to the selected HEAD; the candidate commit's embedded status may describe its earlier checkpoint. Phase 00's `bin/check` skeleton must consume `ELEF_GATE_STATUS_PATH` for its status proof, check exact checkout HEAD/base/phase/plan/contract, and emit the actual checkout SHA. Later CHECK state must match that snapshot's identity. This is an external verification input, not a production source overlay.

Install/warm documented locked dependencies in the owned checkout, retaining trusted caches; do not copy root untracked source/configuration. Run `run-gate N --attempt ID` (optionally under an installed Node 22 runner). It exports the snapshot path and external CI evidence directory `ELEF_GATE_EVIDENCE_DIR`. Each attempt has unique streamed logs and runner/child PID plus process-start identity. An immutable completed result and atomic pointer survive interruption. Never rerun a started attempt. First verify whether its helper, checker or orphaned checkout workers remain active; wait or stop only proved owned processes and record terminal evidence before preparing another. The helpers refuse overlapping attempts and cleanup of active worktrees. Failed/OOM results remain available beside the retry. `cleanup-gate N ID` removes only a clean, inactive owned checkout; ignored dependency artifacts are permitted, source mutations invalidate the attempt.

`last_verified_checks` includes the selected attempt's real metadata, never a fabricated result. Human gate entries use only constitution §8's five classes.

## Transitions and recovery anchors

PLAN → DO → CHECK → ACT → DO/PLAN/PASS/BLOCKED. PASS(N) → PLAN(N+1) is separate; Phase 12 stays PASS. Validate before each state checkpoint, commit explicit paths, then validate committed state and push without force. A pending PLAN→DO freeze uses `validate --prospective` before commit; default validation requires its committed freeze. PASS requires a preceding committed CHECK→ACT for the same review identity and the exact previous phase PASS base.

For a plan defect, commit ACT→PLAN before editing scope, preserving prior legal production changes. Further production edits are prohibited until the new plan is frozen in a new checkpoint, even when its file bytes equal an earlier plan. Clear the old plan hash while in PLAN; preserve review_round. The parent of the first entry into the current PLAN interval defines the re-plan edit boundary; later PLAN notes cannot move it. BLOCKED applies the guards of blocker.resume_state.

A blocker is an object with `code`, `detail`, `evidence`, `unblock` and `resume_state` (PLAN/DO/CHECK/ACT). These are fields within the existing blocker object. Record exact evidence when unblocking and restore that state, or return to DO/PLAN if the candidate/assumptions changed. Never clear a blocker merely because a new agent arrived.

Reserve the round's context file with state `launching` and the mechanism/actual invocation before launch. Immediately record the returned fresh session identity and state `running`; CLI processes also record `pid` and `process_start` (helper process_start(PID) on Linux). Store phase/round/head/base, conversation_inherited=false, mechanism and launch. A fresh conversation excludes implementer history. A bundle/worktree alone is not proof of fresh context.

Await the actual terminal tool response or CLI exit; report-file presence alone does not prove the process stopped. Set receipt state `completed`, `failed` or `interrupted` and `terminal_evidence` to the saved tool completion/exit evidence; preserve abandoned launch receipts in an attempts list before retrying. A completed review also needs the safely collected verbatim report and report_sha256. Cleanup refuses nonterminal/uncollected sessions, live process identities and remaining checkout workers. For a native session with no local PID, query its session status and retain its terminal response. Never infer terminal state from agent age or a partial report.

The report names the same identity. The original review status snapshot is immutable; next_action/environment/blocker bookkeeping does not change the round. Preparation compares candidate/base/round/plan/contract and preserves the original snapshot. Changed decisive evidence needs a new round.

## Reconstruction

Run `reconstruct` and inspect its checkpoint list. A phase is proven only by a committed first-parent status snapshot whose PASS links a committed plan freeze before production, committed CHECK→ACT→PASS authorization, candidate, exit-0 attempt/hash, plan/contract hashes and independent report/launch receipt. Candidate ancestry and the absence of production edits between candidate and PASS checkpoint are required. All thirteen phase contracts must exist exactly once. Each phase base must equal its proven predecessor PASS checkpoint. The helper reads historical snapshots, so later phases cannot accidentally replace earlier proof. Subjects, file presence and a bare Result: PASS never establish completion.

At the earliest unproven phase, inspect the latest valid committed status and pending changes. Keep DO only if its freeze can be proved; keep CHECK/ACT only if its candidate/round/receipts match. Otherwise PLAN with an explicit reconstruction record. If a report passed but ACT was interrupted, resume ACT for the same candidate instead of skipping the phase. Recover base/head, plan hash, review count, human gates and blocker from evidence; do not reset them to defaults.

For missing status only, `init --base <verified campaign base>` creates a Phase 00 skeleton without overwriting files. It is not reconstruction: edit that skeleton to the recovered phase and validate before committing. Contract changes remain criteria conflicts even when status is lost.

## Remote evidence and practical limits

Keep the draft PR from campaign branch to dev using the repository template. Query the GitHub integration or `gh`; do not create duplicates. If remote access/auth is unavailable, record it and continue local work that can be verified. Await remote-required evidence before its phase can PASS.

Native CI is acceptable only for the exact candidate and the required real runner/scenario. Store run URL, workflow/job, event source SHA, tested checkout SHA (PR merge SHA if different), commands, exits and artifact evidence. Explain checkout identity and require equivalence to the reviewed candidate; a green unrelated job is insufficient. The gate must consume that evidence without appending fabricated markers to its stdout.

Local native execution is headless (`xvfb-run`, `tauri-driver`, `WebKitWebDriver`); user-space prerequisite installation is permitted by task scope, system changes require their own authorization. If neither local nor CI proof exists, record the missing prerequisite. macOS/device/signing/live-deployment/soak evidence stays within the constitution's human release gates and is never simulated.

## Final cleanup

Keep the campaign status/constitution/reports available until Phase 12 is committed PASS. For P12-08 use a disposable checkout to delete docs/refactor and retire/repoint the campaign references, then prove steady-state builds/tests/docs work. Record the exact deletion/retirement manifest. Mark temporary machinery for deletion together if needed to preserve final audit evidence; do not delete the active orchestrator/reviewer mid-phase. P12-12 permits this marked retirement. The steady-state AGENTS router and retained skills must refer only to durable SSOT.
