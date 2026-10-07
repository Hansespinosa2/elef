---
name: elef-campaign
description: Resume and run the Elef v9 refactor when asked to go, continue, resume or finish the campaign. Reconstructs repository state and drives phases through independent review and committed PASS.
---

# Elef campaign

Read [references/state-protocol.md](references/state-protocol.md) on first use. Constitution and current phase contracts own architecture and success criteria; this skill owns execution. A request to prepare or audit these skills retains that scope.

Helper: `python3 .agents/skills/elef-campaign/scripts/campaign_state.py` with `validate [--prospective]`, `reconstruct`, `probe`, `set-env`, `sha256 PATH`, `prepare-gate N`, `run-gate N [--attempt ID]`, `cleanup-gate N ID`, or `init --base SHA`.

## Start or resume

1. Inspect branch, worktrees and committed/staged/unstaged/untracked changes. Preserve unknown changes and stage explicit paths. Use the campaign branch; if absent follow constitution §10's verified ancestry rule. Fetch when available and fast-forward only. If fetch fails, record that remote state is unverified; continue safe local work, retaining the failed push as a handoff action. Never silently resolve divergence.
2. Read `AGENTS.md`, constitution, status, current phase, frozen plan, and the full phase diff including pending changes. Load other phase documents only when a current criterion requires them.
3. Run helper `validate`. If inconsistent, inspect its errors and follow Reconstruction in the reference. A changed contract is a conflict to resolve, never a hash to refresh silently. Record actual environment drift; retain the original comparable baseline.
4. Dispatch by the saved state below. Treat `next_action` as a suggested action subject to current authority and evidence.

## Execute the saved state

- **PLAN:** use `$implementation-strategy`; verify facts and map all phase criteria to proof. Freeze the plan hash, set DO, use `validate --prospective`, commit the freeze, then use normal `validate` before production edits. Prospective validation never authorizes DO work. On re-plan, preserve legal earlier DO work, commit entry to PLAN, append the defect and resolution to the plan, then re-freeze before new production edits.
- **DO:** implement the frozen scope in coherent commits; separate moves from behavior changes. Use `$code-change-verification` for quick iteration and affected checks before a behavior/build/contract checkpoint. Apply `$docs-sync` for state or enduring knowledge changes. Implementation defects remain DO; a plan defect returns through ACT to PLAN; an authority conflict is BLOCKED.
- **CHECK preparation:** commit production changes, select that full candidate SHA, and use `prepare-gate N` to create an owned isolated checkout. Prepare locked dependencies there using the documented setup, then `run-gate N --attempt ID` under the required toolchain. It captures immutable stdout/stderr/exit/SHA/timing evidence and atomically selects the completed attempt. Root untracked files never enter that checkout. Preserve failed/interrupted attempts, release its heavy processes, and clean it only through `cleanup-gate` after inspecting changes. Copy its metadata into `last_verified_checks`. Set head_sha to that candidate, increment review_round (maximum 10), set CHECK, validate and commit the request. Evidence/status commits after the candidate must not alter production, its plan or contract.
- **CHECK resume:** if the recorded round has a complete report for the same candidate, collect it and proceed to ACT. If a recorded reviewer is running, monitor it. Otherwise resume its owned input bundle or launch a fresh reviewer for that round through `$independent-phase-review`. Never treat an old report or a partial report as a new review; use a new round for a changed candidate. Record the reviewer session/process identity so a restart can recover it.
- **ACT:** store the report verbatim, its launch receipt and report hash; commit ACT. Resolve every finding: implementation → DO; plan → PLAN; criteria conflict → BLOCKED; human release gate → pending unless it prevents all further technical progress. Record stable finding IDs to detect three consecutive failures; an unsuccessful tenth review blocks further rounds. Preserve review_round across fixes and re-plans.
- **PASS:** validate linked evidence, set last_completed_phase=N and PASS, commit the status transition, then use `reconstruct` to prove that checkpoint. Push. For N<12, create PLAN(N+1) in a separate commit: base/head are the PASS checkpoint, new contract hash, no frozen plan, round 0, updated next action. For N=12, keep final PASS and produce the handoff.
- **BLOCKED:** inspect blocker.resume_state, evidence and unblock condition. If unmet, preserve BLOCKED and report the required change. If met, record exact new evidence, restore the saved state, clear blocker, validate and commit. Preserve the candidate, plan and round unless that evidence requires DO or PLAN. Pending human release gates do not halt unrelated technical progress.

## Completion and interrupted sessions

A final PASS needs all thirteen committed phase checkpoints, Phase 12's clean reproducible checks, durable documentation and final architecture review. After committing final PASS, reconstruct all thirteen exact predecessor checkpoints and verify P12-11. The final handoff lists final state/HEAD, proof paths/CI runs, pending human gates and draft PR.

Before an external session limit, checkpoint coherent work and an accurate next action. Interrupted DO work is resumed from repository facts; interrupted review is recovered from its bundle and session/process receipt. Commit/push failures are explicit outstanding actions. One completed phase is followed by the next phase without owner confirmation.

Follow constitution §6's resource policy. Release agent-owned heavy processes before review; preserve the owner's server and data. Signing, production release and merge remain owner actions.
