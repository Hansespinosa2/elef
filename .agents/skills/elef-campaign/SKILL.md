---
name: elef-campaign
description: Use when the owner says "go", continue, resume, finish the refactor, or run the campaign. Resumes the Elef v9 desktop+web refactor from repository state alone and drives PLAN → DO → CHECK → ACT phase after phase until final technical PASS or a constitution-defined BLOCKED/human gate.
---

# Elef campaign

Architecture, phase criteria, the status schema, PASS marker, reviewer rules and human gates live in `docs/refactor/CONSTITUTION.md` and `docs/refactor/phases/NN-*.md`. This skill is the operating loop only. Mechanical conventions (status transitions, file names, commits, reconstruction) are in [references/state-protocol.md](references/state-protocol.md) — read it on first use in a session.

Helper: `python3 .agents/skills/elef-campaign/scripts/campaign_state.py {validate|reconstruct|probe|set-env|init|sha256 PATH}`.

## 1. Start / resume (every session, no chat history assumed)

1. **Git safety.** `git status --porcelain`, `git branch --show-current`, `git worktree list`, `git fetch origin`.
   - Must be on `feat/refactor-desktop-and-web` (constitution header). If it is checked out in another worktree, work there; never check it out twice.
   - Unknown uncommitted changes that you did not make: do not discard, stash-drop, or commit them as yours. If they block the phase, `BLOCKED(unknown-local-changes)`.
   - If `origin/feat/refactor-desktop-and-web` has commits not in local HEAD, fast-forward only. Diverged histories → `BLOCKED(branch-diverged)`; never pick a side silently.
2. **State.** Run `campaign_state.py validate`.
   - `STATUS_VALID` → continue.
   - Missing/invalid/stale → follow *Reconstruction* in the reference, record evidence, commit the corrected status, then continue.
   - Environment-drift warning → `set-env`, note the change in the current phase evidence, commit with the next status change.
3. **Load only:** `AGENTS.md`, the constitution, `status.json`, the current phase contract, `docs/refactor/execution/phase-N-plan.md` if it exists, and `git diff --stat <phase_base_sha>..HEAD`. Do not read other phase contracts; open durable docs/code only as the current step requires.
4. Execute `status.next_action`, then continue the loop below. Do not ask the owner whether to continue.

## 2. Phase loop

**PLAN** (`phase_state: PLAN`, production edits forbidden)
- Invoke `$implementation-strategy` to verify current facts and write `docs/refactor/execution/phase-N-plan.md`.
- Freeze: record `frozen_plan_sha256` (helper `sha256`), set `phase_state: DO`, `next_action`, commit (`Freeze phase N plan`).

**DO** (`phase_state: DO`)
- Implement only the frozen plan, in small coherent commits. Structural moves and behavior changes go in separate commits.
- After each behavior-affecting change use `$code-change-verification` (`quick`, then `affected`). Fix failures you caused before moving on.
- If reality contradicts the plan: stop DO, return to PLAN (re-plan section in the plan, re-freeze, new hash, commit). If it contradicts the constitution/phase contract: `BLOCKED(criteria-conflict)`.
- Use `$docs-sync` whenever an enduring rule, contract, path or command changes.

**CHECK** (candidate ready)
- Run the phase tier via `$code-change-verification`; save the exact stdout of `bin/check phase N --json` to `docs/refactor/execution/phase-N-gate.txt`.
- Set `head_sha` = candidate commit, increment `review_round`, `phase_state: CHECK`, commit (`Request phase N review round K`).
- Invoke `$independent-phase-review`. Never self-certify.

**ACT** (`phase_state: ACT` after the report is stored)
- Classify each finding: implementation defect → DO; plan defect → PLAN; architecture/criteria conflict → BLOCKED; human gate → add to `pending_human_gates` (BLOCKED only if it prevents all further technical progress); all green → PASS.
- Caps: >10 rounds → `BLOCKED(review-cap)`; same finding failing 3 consecutive rounds → `BLOCKED(repeat-finding)`.

**PASS** — requires all three: gate file with exactly one `ELEF_PHASE_N=PASS` and matching JSON head; latest review `Result: PASS` for that head; status transition.
- Commit `Record phase N PASS` (status `PASS`, `last_completed_phase: N`, `last_verified_checks`).
- Push the campaign branch (`git push origin feat/refactor-desktop-and-web`, never force).
- Immediately open phase N+1: `current_phase`, `phase_state: PLAN`, `phase_base_sha` = the PASS commit, new `phase_contract_sha256`, `frozen_plan_sha256: null`, `review_round: 0`, `next_action`; commit `Start phase N+1`; continue.

## 3. Resource discipline

Probe before environment-dependent checks. Treat the constitution's ~8 GB container policy as the default even on larger machines: serialize heavyweight jobs, conservative workers, preserve caches, release processes before review, rerun after OOM before classifying. Never stop or reuse the owner's `https://127.0.0.1:3000/` server for test harnesses (see `$code-change-verification`).

## 4. Stopping

Stop only when:
- Phase 12 is PASS and `status.json` is final `PASS` → produce the final handoff (reference §Final handoff); or
- a constitution-defined BLOCKED state or human gate prevents *all* further technical progress → status `BLOCKED` with `blocker` and `next_action` that names exactly what the owner must do, committed and pushed.

Finishing one phase, one attempt, or one session's budget is not a stopping condition: before a session ends for any external reason, commit work-in-progress with an accurate `next_action` and push, so the next agent resumes from the repository alone.

Never: merge to `dev`, publish a production release, touch signing/updater keys, invent credentials, or mark a human gate passed.
